// 開発・デモ用の歩数。日付から決まる疑似乱数なので、同じ日なら何度取得しても同じ値になる。
// 今日の分は時刻に合わせて増えていく。source は必ず 'demo' で、正式ランキングには使わない。
import { dateRange, dayOfWeek, toJstDateKey } from '../../domain/date'
import type { DailySteps, DateKey } from '../../domain/types'
import type { StepDataProvider } from './types'

/** 文字列から 32bit のシード値を作る（FNV-1a） */
function hashString(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** シード付きの疑似乱数（mulberry32）。0 以上 1 未満 */
function seededRandom(seed: number): number {
  let t = (seed + 0x6d2b79f5) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** その日に最終的に歩く歩数（3,000〜10,000 歩程度、週末はやや多め） */
function fullDaySteps(date: DateKey, seed: string): number {
  const base = 3000 + seededRandom(hashString(`${seed}:${date}`)) * 7000
  const dow = dayOfWeek(date)
  const weekendBoost = dow === 0 || dow === 6 ? 1.15 : 1
  return Math.round(base * weekendBoost)
}

/** JST の 6 時〜22 時で 0→1 に進む、1 日の活動の進み具合 */
function dayProgress(now: Date): number {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const hours = jst.getUTCHours() + jst.getUTCMinutes() / 60
  return Math.min(1, Math.max(0, (hours - 6) / 16))
}

export class DemoStepProvider implements StepDataProvider {
  readonly source = 'demo' as const
  private readonly seed: string
  private readonly now: () => Date

  constructor(seed: string, now: () => Date = () => new Date()) {
    this.seed = seed
    this.now = now
  }

  async isAvailable(): Promise<boolean> {
    return true
  }

  async getDailySteps(from: DateKey, to: DateKey): Promise<DailySteps[]> {
    const now = this.now()
    const today = toJstDateKey(now)
    return dateRange(from, to)
      .filter((date) => date <= today)
      .map((date) => {
        const full = fullDaySteps(date, this.seed)
        return { date, steps: date === today ? Math.round(full * dayProgress(now)) : full }
      })
  }
}
