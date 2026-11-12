// この端末の加速度センサーで数えた歩数（Web 版の歩数の取得元）。
// 歩数は日付（JST）ごとに端末へ保存し、同期のときにモックサーバーが読み取る。
// はじめは 0 歩。アプリを開いて「歩数の計測」をしている間だけ増える。
import { dateRange, isDateKey, toJstDateKey } from '../../domain/date'
import type { DailySteps, DateKey } from '../../domain/types'
import type { StepDataProvider } from './types'

export const MOTION_STORAGE_KEY = 'ewq.motion.v1'
/** 1 日に保存する歩数の上限（明らかな異常値を保存しない） */
const MAX_DAILY_STEPS = 100_000
/** 保存しておく日数 */
const KEEP_DAYS = 62

interface Storage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

type Days = Record<DateKey, number>

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** 日付ごとの歩数の保存先。センサーの計測（書き込み）と同期（読み取り）で共有する */
export class MotionStepStore {
  private readonly storage: Storage | null
  /** 保存できない環境では、この画面を開いている間だけメモリに持つ */
  private memory: Days = {}

  constructor(storage: Storage | null = defaultStorage()) {
    this.storage = storage
  }

  read(): Days {
    if (!this.storage) return { ...this.memory }
    try {
      const parsed: unknown = JSON.parse(this.storage.getItem(MOTION_STORAGE_KEY) ?? '{}')
      const days: Days = {}
      if (typeof parsed === 'object' && parsed !== null && 'days' in parsed && typeof parsed.days === 'object' && parsed.days) {
        for (const [date, steps] of Object.entries(parsed.days as Record<string, unknown>)) {
          if (isDateKey(date) && Number.isInteger(steps) && (steps as number) >= 0) {
            days[date] = Math.min(steps as number, MAX_DAILY_STEPS)
          }
        }
      }
      return days
    } catch {
      return {}
    }
  }

  private write(days: Days): void {
    // 古い日付は消す
    const keys = Object.keys(days).sort()
    for (const date of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete days[date]
    if (!this.storage) {
      this.memory = days
      return
    }
    try {
      this.storage.setItem(MOTION_STORAGE_KEY, JSON.stringify({ version: 1, days }))
    } catch {
      this.memory = days
    }
  }

  /** 今日（JST）の歩数に足す。足したあとの今日の歩数を返す */
  add(steps: number, now: Date = new Date()): number {
    const today = toJstDateKey(now)
    const days = this.read()
    if (Number.isInteger(steps) && steps > 0) days[today] = Math.min(MAX_DAILY_STEPS, (days[today] ?? 0) + steps)
    this.write(days)
    return days[today] ?? 0
  }

  today(now: Date = new Date()): number {
    return this.read()[toJstDateKey(now)] ?? 0
  }

  clear(): void {
    this.memory = {}
    try {
      this.storage?.removeItem(MOTION_STORAGE_KEY)
    } catch {
      // 消せなくても続ける
    }
  }
}

/** アプリ全体で 1 つの保存先 */
export const motionStepStore = new MotionStepStore()

export class DeviceMotionStepProvider implements StepDataProvider {
  readonly source = 'device_motion' as const
  private readonly store: MotionStepStore
  private readonly now: () => Date

  constructor(store: MotionStepStore = motionStepStore, now: () => Date = () => new Date()) {
    this.store = store
    this.now = now
  }

  async isAvailable(): Promise<boolean> {
    return typeof window !== 'undefined' && 'DeviceMotionEvent' in window
  }

  /** 計測した日の歩数と、今日の歩数（計測していなければ 0）を返す */
  async getDailySteps(from: DateKey, to: DateKey): Promise<DailySteps[]> {
    const today = toJstDateKey(this.now())
    const days = this.store.read()
    return dateRange(from, to)
      .filter((date) => date <= today && (date === today || days[date] !== undefined))
      .map((date) => ({ date, steps: days[date] ?? 0 }))
  }

  clear(): void {
    this.store.clear()
  }
}
