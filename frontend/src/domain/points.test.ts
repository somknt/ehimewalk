import { describe, expect, it } from 'vitest'
import { GACHA_DUPLICATE_COINS } from '../data/items'
import { DAILY_STEP_POINT_CAP, pointsForSteps, pointsShortForGacha, pointsToAward } from './points'

describe('歩数ポイント', () => {
  it('100歩につき1ポイント（端数は切り捨て）', () => {
    expect(pointsForSteps(99)).toBe(0)
    expect(pointsForSteps(100)).toBe(1)
    expect(pointsForSteps(1000)).toBe(10)
    expect(pointsForSteps(6050)).toBe(60)
  })

  it('1日の上限は10,000歩（100pt）', () => {
    expect(pointsForSteps(12_000)).toBe(DAILY_STEP_POINT_CAP)
    expect(DAILY_STEP_POINT_CAP).toBe(100)
  })

  it('付与済みとの差分だけを付与する（二重付与しない）', () => {
    expect(pointsToAward(1000, 0)).toBe(10)
    expect(pointsToAward(1000, 10)).toBe(0)
    expect(pointsToAward(1550, 10)).toBe(5)
    // 歩数が減ってもマイナスにはならない
    expect(pointsToAward(500, 10)).toBe(0)
  })

  it('不正な歩数は0ポイント', () => {
    expect(pointsForSteps(Number.NaN)).toBe(0)
    expect(pointsForSteps(-100)).toBe(0)
  })

  it('ガチャの不足コインと、重複時のレア度別の変換コイン（初期設定）', () => {
    expect(pointsShortForGacha(49)).toBe(1)
    expect(pointsShortForGacha(50)).toBe(0)
    expect(GACHA_DUPLICATE_COINS).toEqual({ N: 5, R: 15, SR: 30, SSR: 50 })
  })
})
