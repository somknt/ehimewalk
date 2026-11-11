import type { DailySteps, DateKey, StepSource } from '../../domain/types'

/**
 * 歩数の取得元。Web のデモ、iOS HealthKit、Android Health Connect を同じ形で扱う。
 * フェーズ4 でネイティブアプリ化したときに実装を追加する。
 */
export interface StepDataProvider {
  readonly source: StepSource
  isAvailable(): Promise<boolean>
  /** from から to まで（両端を含む）の日別歩数 */
  getDailySteps(from: DateKey, to: DateKey): Promise<DailySteps[]>
}
