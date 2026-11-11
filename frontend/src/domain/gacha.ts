// ガチャの抽選規則。乱数は呼び出し側から渡す（サーバーでは暗号論的乱数を使う）。
import type { Rarity } from './types'

export type GachaRates = Readonly<Record<Rarity, number>>

export interface GachaPoolEntry {
  itemId: string
  rarity: Rarity
}

/** 高いレア度から順に判定する */
const RARITY_ORDER: readonly Rarity[] = ['SR', 'R', 'N']

export function assertValidRates(rates: GachaRates): void {
  const total = RARITY_ORDER.reduce((sum, rarity) => sum + rates[rarity], 0)
  if (Math.abs(total - 1) > 1e-9 || RARITY_ORDER.some((rarity) => rates[rarity] < 0)) {
    throw new Error(`排出確率の合計が 1 ではありません（${total}）`)
  }
}

/** random は 0 以上 1 未満 */
export function pickRarity(rates: GachaRates, random: number): Rarity {
  let threshold = 0
  for (const rarity of RARITY_ORDER) {
    threshold += rates[rarity]
    if (random < threshold) return rarity
  }
  return 'N'
}

/**
 * レア度を決めてから、そのレア度のアイテムを等確率で選ぶ。
 * 該当レア度のアイテムが無い場合はノーマルから選ぶ。
 */
export function drawFromPool(
  pool: readonly GachaPoolEntry[],
  rates: GachaRates,
  random: () => number,
): GachaPoolEntry {
  if (pool.length === 0) throw new Error('ガチャの排出対象がありません')
  const rarity = pickRarity(rates, random())
  const candidates = pool.filter((entry) => entry.rarity === rarity)
  const fallback = pool.filter((entry) => entry.rarity === 'N')
  const list = candidates.length > 0 ? candidates : fallback.length > 0 ? fallback : pool
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))]
}
