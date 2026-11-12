// ブラウザの加速度センサー（devicemotion）を使った歩数計。アプリ全体で 1 つだけ動かす。
// - アプリを開くと自動で計測を始める（利用者が「止める」を選んだら、次に「はじめる」を押すまで止めたまま）
// - iPhone（Safari）は「動作と方向」へのアクセス許可が必要。許可はボタン操作の中でしか求められないため、
//   まだ許可されていなければ needs_permission にして、画面から許可を求める
// - 画面を開いている間だけ数える（Web アプリの制限）。計測中は画面が消えないようにする（対応端末のみ）
// - HTTPS（Vercel など）か localhost でだけ使える
import { motionStepStore } from '../../api/stepProviders/deviceMotionStepProvider'
import { StepDetector } from './stepDetector'

export type PedometerStatus =
  /** 止めている（利用者が止めた） */
  | 'idle'
  /** センサーの準備中 */
  | 'starting'
  | 'counting'
  /** iPhone などで、センサーの利用許可が必要 */
  | 'needs_permission'
  /** センサーが無い・使えない（パソコンなど） */
  | 'unsupported'
  /** 利用者が許可しなかった */
  | 'denied'

export interface PedometerState {
  status: PedometerStatus
  todaySteps: number
  /** 今回の計測で数えた歩数 */
  sessionSteps: number
  /** 画面が消えないようにできているか */
  wakeLock: boolean
  /** アプリを開いたときに自動で計測するか（利用者が止めたら false） */
  autoStart: boolean
}

type Listener = () => void

interface MotionPermissionApi {
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>
}

const AUTO_START_KEY = 'ewq.pedometer.autostart'
/** センサーの値が届かないときに「使えない」と判断するまでの時間 */
const NO_SENSOR_TIMEOUT_MS = 3000
/** 許可を求めずに試したとき、値が届かなければ「許可が必要」と判断するまでの時間 */
const SILENT_TRY_TIMEOUT_MS = 1500

function readAutoStart(): boolean {
  try {
    return globalThis.localStorage?.getItem(AUTO_START_KEY) !== 'off'
  } catch {
    return true
  }
}

function writeAutoStart(on: boolean) {
  try {
    globalThis.localStorage?.setItem(AUTO_START_KEY, on ? 'on' : 'off')
  } catch {
    // 保存できなくても続ける
  }
}

class Pedometer {
  private state: PedometerState = {
    status: 'idle',
    todaySteps: motionStepStore.today(),
    sessionSteps: 0,
    wakeLock: false,
    autoStart: readAutoStart(),
  }
  private readonly listeners = new Set<Listener>()
  private readonly detector = new StepDetector()
  private sensorSeen = false
  private listening = false
  private sensorTimer: ReturnType<typeof setTimeout> | undefined
  private wakeLockSentinel: { release: () => Promise<void> } | null = null

  getSnapshot = (): PedometerState => this.state

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private set(patch: Partial<PedometerState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((listener) => listener())
  }

  isSupported(): boolean {
    return typeof window !== 'undefined' && 'DeviceMotionEvent' in window && window.isSecureContext
  }

  private permissionApi(): MotionPermissionApi {
    return window.DeviceMotionEvent as unknown as MotionPermissionApi
  }

  /**
   * アプリを開いたときに呼ぶ。自動計測がオンなら、許可を求めずに計測を始める。
   * 許可が必要な端末（iPhone）でまだ許可されていなければ needs_permission にする
   */
  autoStart(): void {
    if (!this.state.autoStart || this.listening) return
    if (!this.isSupported()) {
      this.set({ status: 'unsupported' })
      return
    }
    const needsPermission = typeof this.permissionApi().requestPermission === 'function'
    this.beginListening(needsPermission ? SILENT_TRY_TIMEOUT_MS : NO_SENSOR_TIMEOUT_MS, needsPermission ? 'needs_permission' : 'unsupported')
  }

  /**
   * 計測を始める（ボタン操作から呼ぶ）。iPhone では、ここで許可を求める。
   * 許可の確認は await より前に呼ぶ必要がある（ボタン操作の中でないと許可の画面が出ないため）
   */
  async start(): Promise<void> {
    writeAutoStart(true)
    this.set({ autoStart: true })
    if (this.state.status === 'counting') return
    if (!this.isSupported()) {
      this.set({ status: 'unsupported' })
      return
    }
    const permissionApi = this.permissionApi()
    if (typeof permissionApi.requestPermission === 'function') {
      const request = permissionApi.requestPermission()
      this.set({ status: 'starting' })
      try {
        if ((await request) !== 'granted') {
          this.set({ status: 'denied' })
          return
        }
      } catch {
        this.set({ status: 'denied' })
        return
      }
    }
    if (!this.listening) this.beginListening(NO_SENSOR_TIMEOUT_MS, 'unsupported')
  }

  /** 計測を止める。次にアプリを開いても、「はじめる」を押すまで止めたまま */
  stop(): void {
    writeAutoStart(false)
    this.stopListening()
    this.set({ status: 'idle', autoStart: false })
  }

  /** データを削除したとき：計測を止め、「自動で計測する」を最初の状態（オン）に戻す */
  resetForNewUser(): void {
    this.stopListening()
    try {
      globalThis.localStorage?.removeItem(AUTO_START_KEY)
    } catch {
      // 消せなくても続ける
    }
    this.set({ status: 'idle', autoStart: true, todaySteps: 0, sessionSteps: 0 })
  }

  /** データ削除のあとなどに、保存されている歩数を読み直す */
  reloadToday(): void {
    this.set({ todaySteps: motionStepStore.today(), sessionSteps: 0 })
  }

  /** センサーの値を受け取り始める。timeoutMs の間に値が届かなければ onNoSensor の状態にする */
  private beginListening(timeoutMs: number, onNoSensor: PedometerStatus) {
    this.detector.reset()
    this.sensorSeen = false
    this.listening = true
    window.addEventListener('devicemotion', this.onMotion)
    document.addEventListener('visibilitychange', this.onVisibility)
    clearTimeout(this.sensorTimer)
    this.sensorTimer = setTimeout(() => {
      if (this.sensorSeen) return
      this.stopListening()
      this.set({ status: onNoSensor })
    }, timeoutMs)
    this.set({ status: 'starting', sessionSteps: 0, todaySteps: motionStepStore.today() })
  }

  private stopListening() {
    clearTimeout(this.sensorTimer)
    this.listening = false
    window.removeEventListener('devicemotion', this.onMotion)
    document.removeEventListener('visibilitychange', this.onVisibility)
    void this.releaseWakeLock()
  }

  private onMotion = (event: DeviceMotionEvent) => {
    const a = event.accelerationIncludingGravity ?? event.acceleration
    if (!a || a.x === null || a.y === null || a.z === null) return
    if (!this.sensorSeen) {
      // 最初の値が届いたら、計測中にする
      this.sensorSeen = true
      clearTimeout(this.sensorTimer)
      this.set({ status: 'counting' })
      void this.requestWakeLock()
    }
    const counted = this.detector.push(a.x, a.y, a.z, event.timeStamp || performance.now())
    if (counted > 0) {
      const todaySteps = motionStepStore.add(counted)
      this.set({ todaySteps, sessionSteps: this.state.sessionSteps + counted })
    }
  }

  /** 別のアプリに切り替えて戻ってきたら、画面を消さない設定をかけ直す */
  private onVisibility = () => {
    if (document.visibilityState === 'visible' && this.state.status === 'counting') {
      this.detector.reset()
      void this.requestWakeLock()
    }
  }

  private async requestWakeLock() {
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } })
      .wakeLock
    if (!wakeLock) return
    try {
      this.wakeLockSentinel = await wakeLock.request('screen')
      this.set({ wakeLock: true })
    } catch {
      this.set({ wakeLock: false })
    }
  }

  private async releaseWakeLock() {
    try {
      await this.wakeLockSentinel?.release()
    } catch {
      // 解除に失敗しても続ける
    }
    this.wakeLockSentinel = null
    this.set({ wakeLock: false })
  }
}

export const pedometer = new Pedometer()

/** 歩数をサーバー（モック）に同期したときに、ホームなどへ知らせるイベント名 */
export const STEPS_SYNCED_EVENT = 'ewq:steps-synced'
