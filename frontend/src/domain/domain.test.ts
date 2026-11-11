import { describe, expect, it } from 'vitest'
import { SPOTS } from '../data/spots'
import { NORMAL_GACHA_POOL, NORMAL_GACHA_RATES } from '../data/items'
import { judgeCheckIn } from './checkin'
import { addDays, startOfWeek, toJstDateKey } from './date'
import { assertValidRates, drawFromPool, pickRarity } from './gacha'
import { proposeWeeklyGoal } from './mission'
import { DAILY_STEP_POINT_CAP, pointsForSteps, pointsToAward } from './points'
import { planQuest } from './questPlanner'

describe('ポイント', () => {
  it('100歩 = 1pt、端数は切り捨て', () => {
    expect(pointsForSteps(6000)).toBe(60)
    expect(pointsForSteps(199)).toBe(1)
    expect(pointsForSteps(99)).toBe(0)
  })

  it('1日10,000歩分（100pt）が上限', () => {
    expect(pointsForSteps(10_000)).toBe(100)
    expect(pointsForSteps(25_000)).toBe(DAILY_STEP_POINT_CAP)
  })

  it('不正な値は 0pt', () => {
    expect(pointsForSteps(-500)).toBe(0)
    expect(pointsForSteps(Number.NaN)).toBe(0)
  })

  it('同じ歩数で再同期しても二重付与しない', () => {
    expect(pointsToAward(6000, 60)).toBe(0)
    expect(pointsToAward(7550, 60)).toBe(15)
  })

  it('歩数が減っても付与済みポイントは減らさない', () => {
    expect(pointsToAward(3000, 60)).toBe(0)
  })
})

describe('日付（JST）', () => {
  it('UTC 15:00 で JST の日付が変わる', () => {
    expect(toJstDateKey(new Date('2026-11-10T14:59:59Z'))).toBe('2026-11-10')
    expect(toJstDateKey(new Date('2026-11-10T15:00:00Z'))).toBe('2026-11-11')
  })

  it('週は月曜始まり', () => {
    expect(startOfWeek('2026-11-09')).toBe('2026-11-09') // 月曜
    expect(startOfWeek('2026-11-15')).toBe('2026-11-09') // 日曜
  })

  it('月末・うるう年をまたぐ', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29')
  })
})

describe('ガチャ', () => {
  it('排出確率の合計は 1', () => {
    expect(() => assertValidRates(NORMAL_GACHA_RATES)).not.toThrow()
    expect(() => assertValidRates({ N: 0.7, R: 0.25, SR: 0.1 })).toThrow()
  })

  it('乱数の値に応じたレア度になる（SR 5% → R 25% → N 70%）', () => {
    expect(pickRarity(NORMAL_GACHA_RATES, 0)).toBe('SR')
    expect(pickRarity(NORMAL_GACHA_RATES, 0.0499)).toBe('SR')
    expect(pickRarity(NORMAL_GACHA_RATES, 0.05)).toBe('R')
    expect(pickRarity(NORMAL_GACHA_RATES, 0.2999)).toBe('R')
    expect(pickRarity(NORMAL_GACHA_RATES, 0.3)).toBe('N')
    expect(pickRarity(NORMAL_GACHA_RATES, 0.9999)).toBe('N')
  })

  it('多数回引くと設定した確率に近づく', () => {
    // 再現性のある疑似乱数（線形合同法）
    let seed = 12345
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed / 2 ** 31
    }
    const counts = { N: 0, R: 0, SR: 0 }
    const draws = 50_000
    for (let i = 0; i < draws; i++) counts[drawFromPool(NORMAL_GACHA_POOL, NORMAL_GACHA_RATES, random).rarity] += 1
    expect(counts.N / draws).toBeCloseTo(0.7, 1)
    expect(counts.R / draws).toBeCloseTo(0.25, 1)
    expect(counts.SR / draws).toBeCloseTo(0.05, 1)
  })

  it('該当レア度のアイテムが無ければノーマルから出す', () => {
    const pool = [{ itemId: 'a', rarity: 'N' as const }]
    expect(drawFromPool(pool, NORMAL_GACHA_RATES, () => 0).itemId).toBe('a')
  })
})

describe('GPS チェックイン', () => {
  const spot = { latitude: 33.8456, longitude: 132.7656, checkinRadiusM: 150 }

  it('スポットの座標ちょうどなら成功', () => {
    expect(judgeCheckIn(spot, { ...spot, accuracyM: 10 }).status).toBe('success')
  })

  it('約1km離れていると範囲外', () => {
    const result = judgeCheckIn(spot, { latitude: 33.8546, longitude: 132.7656, accuracyM: 10 })
    expect(result.status).toBe('too_far')
  })

  it('GPS の誤差は最大 50m まで判定範囲に足す', () => {
    // 北に約 190m（150m + 誤差 50m の範囲内）
    const near = { latitude: 33.8473, longitude: 132.7656 }
    expect(judgeCheckIn(spot, { ...near, accuracyM: 50 }).status).toBe('success')
    expect(judgeCheckIn(spot, { ...near, accuracyM: 10 }).status).toBe('too_far')
  })

  it('誤差が 200m を超える位置では判定しない', () => {
    expect(judgeCheckIn(spot, { ...spot, accuracyM: 500 }).status).toBe('low_accuracy')
  })
})

describe('健康ミッション', () => {
  it('普段3,000歩の人には+10%を提案する', () => {
    expect(proposeWeeklyGoal(3000)).toMatchObject({ kind: 'increase', targetSteps: 3300 })
  })

  it('増やす量は最大 +1,000 歩', () => {
    expect(proposeWeeklyGoal(7500).targetSteps).toBeLessThanOrEqual(8500)
  })

  it('8,000歩以上の人には維持を提案する', () => {
    expect(proposeWeeklyGoal(9000)).toMatchObject({ kind: 'maintain', targetSteps: 8000 })
  })

  it('記録が無い人には小さな目標から', () => {
    expect(proposeWeeklyGoal(0).kind).toBe('start')
  })
})

describe('クエストの候補選び', () => {
  const castle = SPOTS.find((s) => s.spotId === 'matsuyama_castle')!

  it('登録スポットだけを選び、希望時間を超えない', () => {
    const plan = planQuest({
      start: castle,
      startSpotId: castle.spotId,
      minutes: 45,
      interests: ['歴史'],
      load: 'normal',
      visitedSpotIds: [],
      spots: SPOTS,
    })
    expect(plan.spots.every((spot) => SPOTS.includes(spot))).toBe(true)
    expect(plan.minutes).toBeLessThanOrEqual(45)
    // 今治城は松山から約30km離れているため、45分では選ばれない
    expect(plan.spots.map((s) => s.spotId)).not.toContain('imabari_castle')
  })

  it('時間が短いと遠いスポットを追加しない', () => {
    const plan = planQuest({
      start: castle,
      startSpotId: castle.spotId,
      minutes: 15,
      interests: [],
      load: 'normal',
      visitedSpotIds: [],
      spots: SPOTS,
    })
    expect(plan.spots.map((s) => s.spotId)).toEqual(['matsuyama_castle'])
  })

  it('近くに登録スポットが無ければ、いちばん近いスポットを返す', () => {
    const tokyo = { latitude: 35.681, longitude: 139.767 }
    const plan = planQuest({ start: tokyo, minutes: 60, interests: [], load: 'normal', visitedSpotIds: [], spots: SPOTS })
    expect(plan.spots).toHaveLength(0)
    expect(plan.nearest?.spot).toBeDefined()
  })
})
