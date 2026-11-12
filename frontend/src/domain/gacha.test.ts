import { describe, expect, it } from 'vitest'
import { NORMAL_GACHA_CANDIDATES, NORMAL_GACHA_POOL, NORMAL_GACHA_RATES } from '../data/items'
import { drawItem, pickIndex, pickRarity, secureRandom, validatePool, validateRates, type GachaRates } from './gacha'

describe('ガチャの抽選規則', () => {
  it('排出確率は N60% / R30% / SR9% / SSR1%（合計100%）', () => {
    expect(NORMAL_GACHA_RATES).toEqual({ N: 0.6, R: 0.3, SR: 0.09, SSR: 0.01 })
    expect(() => validateRates(NORMAL_GACHA_RATES)).not.toThrow()
  })

  it('乱数の値に応じて、確率どおりの境界でレアリティが決まる', () => {
    const r = NORMAL_GACHA_RATES
    expect(pickRarity(r, 0)).toBe('N')
    expect(pickRarity(r, 0.5999)).toBe('N')
    expect(pickRarity(r, 0.6)).toBe('R')
    expect(pickRarity(r, 0.8999)).toBe('R')
    expect(pickRarity(r, 0.9)).toBe('SR')
    expect(pickRarity(r, 0.9899)).toBe('SR')
    expect(pickRarity(r, 0.99)).toBe('SSR')
    expect(pickRarity(r, 0.9999999)).toBe('SSR')
  })

  it('20万回の抽選で、排出率が設定値に近い', () => {
    const counts = { N: 0, R: 0, SR: 0, SSR: 0 }
    const n = 200_000
    for (let i = 0; i < n; i++) counts[pickRarity(NORMAL_GACHA_RATES, secureRandom())] += 1
    expect(Math.abs(counts.N / n - 0.6)).toBeLessThan(0.01)
    expect(Math.abs(counts.R / n - 0.3)).toBeLessThan(0.01)
    expect(Math.abs(counts.SR / n - 0.09)).toBeLessThan(0.005)
    expect(Math.abs(counts.SSR / n - 0.01)).toBeLessThan(0.002)
  })

  it('同じレアリティの中では等確率で選ぶ', () => {
    expect(pickIndex(4, 0)).toBe(0)
    expect(pickIndex(4, 0.26)).toBe(1)
    expect(pickIndex(4, 0.9999)).toBe(3)
  })

  it('すべてのレアリティにガチャの対象アイテムがあり、初期衣装・地域限定は出ない', () => {
    expect(() => validatePool(NORMAL_GACHA_CANDIDATES, NORMAL_GACHA_RATES)).not.toThrow()
    expect(NORMAL_GACHA_POOL.every((item) => item.acquisitionType === 'gacha')).toBe(true)
    for (const rarity of ['N', 'R', 'SR', 'SSR'] as const) {
      expect(NORMAL_GACHA_POOL.some((item) => item.rarity === rarity)).toBe(true)
    }
  })

  it('決めたレアリティのアイテムが選ばれる', () => {
    let i = 0
    const rolls = [0.995, 0] // SSR → 候補の先頭
    const item = drawItem(NORMAL_GACHA_CANDIDATES, NORMAL_GACHA_RATES, () => rolls[i++])
    expect(item.rarity).toBe('SSR')
  })

  it('確率の合計が100%でない設定や、候補のないレアリティは誤りにする', () => {
    const bad: GachaRates = { N: 0.6, R: 0.3, SR: 0.09, SSR: 0.02 }
    expect(() => validateRates(bad)).toThrow()
    expect(() => validatePool([{ itemId: 'a', rarity: 'N' }], NORMAL_GACHA_RATES)).toThrow()
  })
})
