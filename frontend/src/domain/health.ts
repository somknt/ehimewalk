// 移動距離と消費カロリーの推定。画面では必ず「推定値」と前提を併記する。

export const DEFAULT_STRIDE_M = 0.7
export const DEFAULT_WEIGHT_KG = 60
/** 普通歩行（平地・時速 4km）の METs。出典：厚生労働省 e-ヘルスネット「生活活動のメッツ表」（docs/evidence.md） */
export const WALKING_METS = 3.0
export const WALKING_SPEED_KMH = 4.0

export interface EstimateOptions {
  strideM?: number
  weightKg?: number
}

export function estimateDistanceKm(steps: number, { strideM = DEFAULT_STRIDE_M }: EstimateOptions = {}): number {
  if (steps <= 0) return 0
  return (steps * strideM) / 1000
}

/** METs × 体重(kg) × 時間(h) × 1.05 */
export function estimateCaloriesKcal(steps: number, options: EstimateOptions = {}): number {
  const weightKg = options.weightKg ?? DEFAULT_WEIGHT_KG
  const hours = estimateDistanceKm(steps, options) / WALKING_SPEED_KMH
  return WALKING_METS * weightKg * hours * 1.05
}

export const ESTIMATE_ASSUMPTION_LABEL = `推定値（歩幅${DEFAULT_STRIDE_M}m・体重${DEFAULT_WEIGHT_KG}kg・時速${WALKING_SPEED_KMH}kmで概算）`
