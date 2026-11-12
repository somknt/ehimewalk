// ガチャの抽選規則。フェーズ2 で Lambda と共有する（画面や保存方法には依存しない）。
// 1. 排出確率でレアリティを決める
// 2. そのレアリティの対象アイテムから等確率で 1 つ選ぶ
import type { Rarity } from './types'

/** 抽選の順番（確率の累積はこの順に足す） */
export const RARITY_ORDER: readonly Rarity[] = ['N', 'R', 'SR', 'SSR']

/** レアリティごとの排出確率（0〜1、合計 1） */
export type GachaRates = Record<Rarity, number>

/** 0 以上 1 未満の乱数 */
export type RandomSource = () => number

const RATE_SUM_TOLERANCE = 1e-9

/** 確率の設定が正しいか（各値が 0 以上で、合計が 1） */
export function validateRates(rates: GachaRates): void {
  let sum = 0
  for (const rarity of RARITY_ORDER) {
    const rate = rates[rarity]
    if (!Number.isFinite(rate) || rate < 0) throw new Error(`ガチャの確率（${rarity}）が正しくありません`)
    sum += rate
  }
  if (Math.abs(sum - 1) > RATE_SUM_TOLERANCE) throw new Error(`ガチャの確率の合計が 100% ではありません（${sum * 100}%）`)
}

/** 0 以上 1 未満の値からレアリティを決める */
export function pickRarity(rates: GachaRates, roll: number): Rarity {
  let cumulative = 0
  let last: Rarity = 'N'
  for (const rarity of RARITY_ORDER) {
    if (rates[rarity] <= 0) continue
    cumulative += rates[rarity]
    last = rarity
    if (roll < cumulative) return rarity
  }
  // 小数の丸め誤差で合計がわずかに 1 未満になった場合は、確率が 0 でない最後のレアリティにする
  return last
}

/** 0 以上 max 未満の整数 */
export function pickIndex(max: number, roll: number): number {
  if (!Number.isInteger(max) || max <= 0) throw new RangeError('候補がありません')
  return Math.min(max - 1, Math.floor(roll * max))
}

/** 暗号論的に安全な乱数（偏りや予測を避けるため Math.random は使わない） */
export const secureRandom: RandomSource = () => {
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return buffer[0] / 2 ** 32
}

export interface GachaCandidate {
  itemId: string
  rarity: Rarity
}

/** レアリティを決めてから、そのレアリティの候補を等確率で選ぶ */
export function drawItem<T extends GachaCandidate>(pool: readonly T[], rates: GachaRates, random: RandomSource): T {
  const rarity = pickRarity(rates, random())
  const candidates = pool.filter((item) => item.rarity === rarity)
  if (candidates.length === 0) throw new Error(`ガチャの ${rarity} にアイテムがありません`)
  return candidates[pickIndex(candidates.length, random())]
}

/** 重複時の変換コインが 0 以上の整数で、ガチャ 1 回のコストを超えないか（超えると引くほど増えてしまう） */
export function validateDuplicateCoins(coins: Record<Rarity, number>, cost: number): void {
  for (const rarity of RARITY_ORDER) {
    const value = coins[rarity]
    if (!Number.isInteger(value) || value < 0 || value > cost) {
      throw new Error(`重複時の変換コイン（${rarity}）は 0〜${cost} の整数にしてください`)
    }
  }
}

/** 確率が 0 でないレアリティに、必ず候補があるかを確かめる */
export function validatePool(pool: readonly GachaCandidate[], rates: GachaRates): void {
  validateRates(rates)
  for (const rarity of RARITY_ORDER) {
    if (rates[rarity] > 0 && !pool.some((item) => item.rarity === rarity)) {
      throw new Error(`ガチャの ${rarity}（${rates[rarity] * 100}%）の対象アイテムがありません`)
    }
  }
}
