// ブラウザの加速度センサー（devicemotion）を使った歩数計。アプリ全体で 1 つだけ動かす。
// - iPhone（Safari）は、ボタンを押したときに「動作と方向」へのアクセス許可が必要
// - 画面を開いている間だけ数える。計測中は画面が消えないようにする（Screen Wake Lock に対応している端末のみ）
// - HTTPS（Vercel など）か localhost でだけ使える
import { motionStepStore } from '../../api/stepProviders/deviceMotionStepProvider'
import { StepDetector } from './stepDetector'

export type PedometerStatus =
  | 'idle'
  /** 許可の確認・センサーの準備中 */
  | 'starting'
  | 'counting'
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
}

type Listener = () => void

interface MotionPermissionApi {
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>
}

/** センサーの値が届かないときに「使えない」と判断するまでの時間 */
const NO_SENSOR_TIMEOUT_MS = 3000

class Pedometer {
  private state: PedometerState = { status: 'idle', todaySteps: motionStepStore.today(), sessionSteps: 0, wakeLock: false }
  private readonly listeners = new Set<Listener>()
  private readonly detector = new StepDetector()
  private sensorSeen = false
  private noSensorTimer: ReturnType<typeof setTimeout> | undefined
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

  /** 計測を始める。iPhone ではボタン操作の中から呼ぶ必要がある */
  async start(): Promise<void> {
    if (this.state.status === 'counting' || this.state.status === 'starting') return
    if (!this.isSupported()) {
      this.set({ status: 'unsupported' })
      return
    }
    this.set({ status: 'starting', todaySteps: motionStepStore.today() })
    const permissionApi = window.DeviceMotionEvent as unknown as MotionPermissionApi
    if (typeof permissionApi.requestPermission === 'function') {
      try {
        if ((await permissionApi.requestPermission()) !== 'granted') {
          this.set({ status: 'denied' })
          return
        }
      } catch {
        this.set({ status: 'denied' })
        return
      }
    }
    this.detector.reset()
    this.sensorSeen = false
    window.addEventListener('devicemotion', this.onMotion)
    document.addEventListener('visibilitychange', this.onVisibility)
    this.noSensorTimer = setTimeout(() => {
      if (!this.sensorSeen) {
        this.stopListening()
        this.set({ status: 'unsupported' })
      }
    }, NO_SENSOR_TIMEOUT_MS)
    this.set({ status: 'counting', sessionSteps: 0 })
    void this.requestWakeLock()
  }

  stop(): void {
    this.stopListening()
    this.set({ status: 'idle' })
  }

  /** データ削除のあとなどに、保存されている歩数を読み直す */
  reloadToday(): void {
    this.set({ todaySteps: motionStepStore.today() })
  }

  private stopListening() {
    clearTimeout(this.noSensorTimer)
    window.removeEventListener('devicemotion', this.onMotion)
    document.removeEventListener('visibilitychange', this.onVisibility)
    void this.releaseWakeLock()
  }

  private onMotion = (event: DeviceMotionEvent) => {
    const a = event.accelerationIncludingGravity ?? event.acceleration
    if (!a || a.x === null || a.y === null || a.z === null) return
    this.sensorSeen = true
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
