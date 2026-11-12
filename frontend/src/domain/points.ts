// ポイントの規則。計算と付与はサーバー側（フェーズ1 はモックサーバー）で行う。

/** 100 歩 = 1 ポイント */
export const STEPS_PER_POINT = 100
/** 1 日にポイント対象となる歩数の上限 */
export const DAILY_STEP_CAP = 10_000
/** 1 日の歩数ポイントの上限（= 100pt） */
export const DAILY_STEP_POINT_CAP = DAILY_STEP_CAP / STEPS_PER_POINT
/** ガチャ 1 回のコイン。重複時の変換コインは data/items.ts の GACHA_DUPLICATE_COINS */
export const GACHA_COST = 50

/** その日の歩数から得られる歩数ポイント（上限あり、端数切り捨て） */
export function pointsForSteps(steps: number): number {
  if (!Number.isFinite(steps) || steps <= 0) return 0
  const capped = Math.min(Math.floor(steps), DAILY_STEP_CAP)
  return Math.floor(capped / STEPS_PER_POINT)
}

/**
 * 今回の同期で新たに付与するポイント。
 * 付与済みポイントとの差分だけを返すため、同じ歩数で何度同期しても二重付与されない。
 * 歩数が減っても負の値は返さない（減算は管理者による訂正として扱う）。
 */
export function pointsToAward(steps: number, alreadyAwarded: number): number {
  return Math.max(0, pointsForSteps(steps) - Math.max(0, alreadyAwarded))
}

/** ガチャに必要なポイントのうち不足している分 */
export function pointsShortForGacha(balance: number, draws = 1): number {
  return Math.max(0, GACHA_COST * draws - balance)
}
