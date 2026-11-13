import { describe, expect, it } from 'vitest'
import { getSpot, QUEST_GENRES, SPOTS } from '../data/spots'
import { ITEMS } from '../data/items'
import { buildRouteFromSpotIds, selectQuestCandidates } from './questPlanner'

const castle = getSpot('matsuyama_castle')!

describe('スポットデータ', () => {
  it('5か所（松山城・道後温泉本館・下灘駅・今治城・宇和島城）があり、必要な情報と出典を持つ', () => {
    expect(SPOTS.map((s) => s.spotId)).toEqual(
      expect.arrayContaining(['matsuyama_castle', 'dogo_onsen_honkan', 'shimonada_station', 'imabari_castle', 'uwajima_castle']),
    )
    for (const spot of SPOTS) {
      expect(spot.name && spot.address && spot.description).toBeTruthy()
      expect(Number.isFinite(spot.latitude) && Number.isFinite(spot.longitude)).toBe(true)
      expect(spot.tags.length).toBeGreaterThan(0)
      expect(spot.sources.length).toBeGreaterThan(0)
      // 報酬アイテムが存在する
      expect(ITEMS.get(spot.rewardItemId)?.acquisitionType).toBe('spot')
    }
  })

  it('ジャンルは観光・歴史・自然・グルメ・おまかせ', () => {
    expect(QUEST_GENRES.map((g) => g.label)).toEqual(['観光', '歴史', '自然', 'グルメ', 'おまかせ'])
  })
})

describe('AIに渡す候補の絞り込み', () => {
  const base = { start: castle, startSpotId: castle.spotId, load: 'normal' as const, spots: SPOTS, genreTags: [] as string[] }

  it('希望時間で行ける登録スポットだけを、件数の上限まで返す', () => {
    const c = selectQuestCandidates({ ...base, minutes: 60, maxCandidates: 5 })
    const ids = c.map((x) => x.spot.spotId)
    expect(ids).toContain('matsuyama_castle')
    expect(ids).toContain('dogo_onsen_honkan')
    // 宇和島城・今治城・下灘駅は松山城から遠く、60分では行けない
    expect(ids).not.toContain('uwajima_castle')
    expect(selectQuestCandidates({ ...base, minutes: 60, maxCandidates: 1 })).toHaveLength(1)
  })

  it('歩く距離の上限でも絞り込む', () => {
    const ids = selectQuestCandidates({ ...base, minutes: 60, maxDistanceM: 1000, maxCandidates: 5 }).map((x) => x.spot.spotId)
    expect(ids).toEqual(['matsuyama_castle'])
  })

  it('ジャンルに合うものを先に並べる', () => {
    const c = selectQuestCandidates({ ...base, minutes: 60, genreTags: ['温泉'], maxCandidates: 5 })
    expect(c[0].spot.spotId).toBe('dogo_onsen_honkan')
    expect(c[0].matchesGenre).toBe(true)
  })
})

describe('AIが選んだ順路の確認', () => {
  it('距離と時間をサーバーの規則で計算し直し、上限を超えるスポットは後ろから削る', () => {
    const input = { start: castle, startSpotId: castle.spotId, startName: '松山城周辺', load: 'normal' as const, spots: SPOTS }
    const ok = buildRouteFromSpotIds({ ...input, spotIds: ['matsuyama_castle', 'dogo_onsen_honkan'], minutes: 60 })
    expect(ok.spots.map((s) => s.spotId)).toEqual(['matsuyama_castle', 'dogo_onsen_honkan'])
    expect(ok.distanceM).toBeGreaterThan(1000)
    const cut = buildRouteFromSpotIds({ ...input, spotIds: ['matsuyama_castle', 'dogo_onsen_honkan'], minutes: 15 })
    expect(cut.spots.map((s) => s.spotId)).toEqual(['matsuyama_castle'])
    // 登録されていない ID は無視する
    const unknown = buildRouteFromSpotIds({ ...input, spotIds: ['nowhere'], minutes: 60 })
    expect(unknown.spots).toHaveLength(0)
  })
})
