// ポイント（コイン）の規則。計算と付与はサーバー側（フェーズ1 はモックサーバー）で行う。

/** 100 歩 = 1 コイン */
export const STEPS_PER_POINT = 100
/** ガチャ 1 回のコイン */
export const GACHA_COST = 50

/**
 * その日の歩数から得られる歩数コイン（端数切り捨て）。1 日の上限は設けない。
 * 明らかな異常値はサーバー側の入力検証（1 日 100,000 歩まで）で弾く
 */
export function pointsForSteps(steps: number): number {
  if (!Number.isFinite(steps) || steps <= 0) return 0
  return Math.floor(Math.floor(steps) / STEPS_PER_POINT)
}

/**
 * 今回の同期で新たに付与するコイン。
 * 付与済みコインとの差分だけを返すため、同じ歩数で何度同期しても二重付与されない。
 * 歩数が減っても負の値は返さない（減算は管理者による訂正として扱う）。
 */
export function pointsToAward(steps: number, alreadyAwarded: number): number {
  return Math.max(0, pointsForSteps(steps) - Math.max(0, alreadyAwarded))
}

/** ガチャに必要なコインのうち不足している分 */
export function pointsShortForGacha(balance: number, draws = 1): number {
  return Math.max(0, GACHA_COST * draws - balance)
}
