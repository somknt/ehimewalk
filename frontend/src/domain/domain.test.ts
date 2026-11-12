// ポイントとガチャの規則は points.test.ts / gacha.test.ts でテストしている
import { describe, expect, it } from 'vitest'
import { SPOTS } from '../data/spots'
import { judgeCheckIn } from './checkin'
import { addDays, startOfWeek, toJstDateKey } from './date'
import { proposeWeeklyGoal } from './mission'
import { planQuest } from './questPlanner'
import { evaluateTitles, titleIdFromName, titleName } from './titles'

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

describe('称号', () => {
  const none = { visitedSpotCount: 0, gachaDraws: 0, goalDaysLast7: 0, ownedItemKinds: 0 }

  it('はじめは「みかん見習い」だけ獲得している', () => {
    expect(evaluateTitles(none).filter((t) => t.unlocked).map((t) => t.name)).toEqual(['みかん見習い'])
  })

  it('条件を満たすと獲得する', () => {
    const titles = evaluateTitles({ ...none, gachaDraws: 1, visitedSpotCount: 3 })
    expect(titles.find((t) => t.titleId === 'gacha_debut')?.unlocked).toBe(true)
    expect(titles.find((t) => t.titleId === 'ehime_explorer')?.unlocked).toBe(true)
  })

  it('称号の名前と ID を相互に変換できる', () => {
    expect(titleIdFromName('ガチャデビュー')).toBe('gacha_debut')
    expect(titleIdFromName('存在しない称号')).toBeUndefined()
    expect(titleName('gacha_debut')).toBe('ガチャデビュー')
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
