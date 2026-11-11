// AI 散策クエストのモック。Bedrock 接続前に画面を完成させるためのもので、画面には「モック」と表示する。
// 本番（フェーズ2）でも、訪問先は登録スポットから選び、距離・時間は AI に作らせない方針は同じ。
import { SPOTS } from '../data/spots'
import { DETOUR_FACTOR, distanceMeters } from '../domain/geo'
import { DEFAULT_STRIDE_M, WALKING_SPEED_KMH } from '../domain/health'
import type { TouristSpot } from '../domain/types'
import type { QuestSuggestion } from './types'

interface MockQuestInput {
  average7Days: number
  interest?: string
  visitedSpotIds?: readonly string[]
}

/** 普段の歩数から、無理のない散策時間（分）を決める */
export function walkingBudgetMinutes(average7Days: number): number {
  if (average7Days < 4000) return 30
  if (average7Days < 8000) return 45
  return 60
}

function minutesForMeters(meters: number): number {
  return (meters / 1000 / WALKING_SPEED_KMH) * 60
}

export function buildMockQuest({ average7Days, interest = '歴史', visitedSpotIds = [] }: MockQuestInput): QuestSuggestion {
  const budget = walkingBudgetMinutes(average7Days)
  const matches = SPOTS.filter((spot) => spot.tags.includes(interest))
  const candidates = matches.length > 0 ? matches : [...SPOTS]
  // まだ訪れていないスポットを優先する
  const start =
    candidates.find((spot) => !visitedSpotIds.includes(spot.spotId)) ?? candidates[0]

  const route: TouristSpot[] = [start]
  let detouredMeters = 0
  for (const nextId of start.nearbySpotIds) {
    const next = SPOTS.find((spot) => spot.spotId === nextId)
    if (!next || route.includes(next)) continue
    const legMeters = distanceMeters(route[route.length - 1], next) * DETOUR_FACTOR
    // 希望時間を超えるスポットは追加しない（知名度よりも時間と距離を優先）
    if (minutesForMeters(detouredMeters + legMeters) > budget) break
    detouredMeters += legMeters
    route.push(next)
  }

  const estimate =
    route.length >= 2
      ? {
          basis: 'straight_line' as const,
          distanceM: Math.round(detouredMeters),
          steps: Math.round(detouredMeters / DEFAULT_STRIDE_M / 100) * 100,
          minutes: Math.round(minutesForMeters(detouredMeters) / 5) * 5,
        }
      : null

  return {
    questId: `mock-${start.spotId}-${budget}`,
    title: `${start.municipality} ${interest}さんぽクエスト`,
    summary: route.map((spot) => spot.name).join(' → '),
    reason: `過去7日間の平均は約${average7Days.toLocaleString('ja-JP')}歩。無理なく歩ける${budget}分以内のコースを選びました。`,
    spots: route.map((spot) => ({
      spotId: spot.spotId,
      name: spot.name,
      municipality: spot.municipality,
      rewardItemId: spot.rewardItemId,
    })),
    estimate,
    generatedBy: 'mock',
  }
}
