// 散策クエストの候補選び。訪問先は登録スポットだけから選び、距離は直線距離 × 迂回係数の目安で出す。
// Bedrock 接続後も、AI に渡す候補の絞り込みと時間の上限チェックはこの規則で行う。
import { DETOUR_FACTOR, distanceMeters, type LatLng } from './geo'
import { DEFAULT_STRIDE_M } from './health'
import type { TouristSpot, WalkingLoad } from './types'

/** 負荷ごとの想定の歩く速さ（km/h） */
export const WALKING_SPEED_BY_LOAD: Record<WalkingLoad, number> = { easy: 3.2, normal: 4.0, active: 4.8 }
export const MAX_QUEST_SPOTS = 4

export interface QuestPlanInput {
  start: LatLng
  /** 出発地点が登録スポットならその ID（最初の訪問先に含める） */
  startSpotId?: string
  minutes: number
  /** 歩く距離の上限（m、直線距離 × 迂回係数の目安）。省略時は時間だけで決める */
  maxDistanceM?: number | null
  interests: readonly string[]
  load: WalkingLoad
  visitedSpotIds: readonly string[]
  spots: readonly TouristSpot[]
}

export interface QuestLeg {
  fromName: string
  toSpotId: string
  /** 直線距離 × 迂回係数 */
  estimatedM: number
}

export interface QuestPlan {
  spots: TouristSpot[]
  legs: QuestLeg[]
  distanceM: number
  minutes: number
  steps: number
  /** 候補が見つからなかったときの、いちばん近い登録スポット */
  nearest?: { spot: TouristSpot; distanceM: number }
}

export function minutesForMeters(meters: number, load: WalkingLoad): number {
  return (meters / 1000 / WALKING_SPEED_BY_LOAD[load]) * 60
}

interface Limits {
  minutes: number
  load: WalkingLoad
  maxDistanceM?: number | null
}

/** 歩く距離（目安）が、希望時間と希望距離の両方に収まるか */
function withinLimits(totalM: number, limits: Limits): boolean {
  if (limits.maxDistanceM != null && totalM > limits.maxDistanceM) return false
  return minutesForMeters(totalM, limits.load) <= limits.minutes
}

function summarize(route: TouristSpot[], legs: QuestLeg[], totalM: number, load: WalkingLoad): QuestPlan {
  return {
    spots: route,
    legs,
    distanceM: Math.round(totalM),
    minutes: Math.round(minutesForMeters(totalM, load) / 5) * 5,
    steps: Math.round(totalM / DEFAULT_STRIDE_M / 100) * 100,
  }
}

// ---- AI 散策クエスト用（Bedrock に渡す候補の絞り込みと、AI が選んだ順路の確認） ----

export interface QuestCandidate {
  spot: TouristSpot
  /** 出発地点からの距離の目安（直線距離 × 迂回係数、m） */
  fromStartM: number
  /** ジャンルに合うか */
  matchesGenre: boolean
}

export interface CandidateInput extends Limits {
  start: LatLng
  startSpotId?: string
  /** ジャンルに合うスポットのタグ（空ならすべて合う） */
  genreTags: readonly string[]
  spots: readonly TouristSpot[]
  /** AI に渡す候補の最大数（入力のトークン数と料金を抑えるため） */
  maxCandidates: number
}

/**
 * AI に渡す候補スポット。出発地点から 1 か所目として行ける（希望時間・距離に収まる）登録スポットだけを、
 * ジャンルに合うもの → 近いものの順に、最大 maxCandidates 件まで返す。
 */
export function selectQuestCandidates(input: CandidateInput): QuestCandidate[] {
  return input.spots
    .map((spot) => ({
      spot,
      fromStartM: spot.spotId === input.startSpotId ? 0 : distanceMeters(input.start, spot) * DETOUR_FACTOR,
      matchesGenre: input.genreTags.length === 0 || spot.tags.some((tag) => input.genreTags.includes(tag)),
    }))
    .filter((c) => withinLimits(c.fromStartM, input))
    .sort((a, b) => Number(b.matchesGenre) - Number(a.matchesGenre) || a.fromStartM - b.fromStartM)
    .slice(0, input.maxCandidates)
}

export interface RouteInput extends Limits {
  start: LatLng
  startSpotId?: string
  startName: string
  /** AI が選んだ訪問順のスポット ID（登録済みかどうかは事前に確認しておく） */
  spotIds: readonly string[]
  spots: readonly TouristSpot[]
}

/**
 * AI が選んだ順路の距離と時間を、サーバーの規則で計算し直す。
 * 希望時間・距離を超える場合は、後ろのスポットから削る（AI の見積もりをそのまま信用しない）。
 */
export function buildRouteFromSpotIds(input: RouteInput): QuestPlan {
  const route: TouristSpot[] = []
  const legs: QuestLeg[] = []
  let current: LatLng = input.start
  let currentName = input.startName
  let totalM = 0
  for (const spotId of input.spotIds.slice(0, MAX_QUEST_SPOTS)) {
    const spot = input.spots.find((s) => s.spotId === spotId)
    if (!spot || route.includes(spot)) continue
    const legM = spot.spotId === input.startSpotId && route.length === 0 ? 0 : distanceMeters(current, spot) * DETOUR_FACTOR
    if (!withinLimits(totalM + legM, input)) break
    route.push(spot)
    legs.push({ fromName: currentName, toSpotId: spot.spotId, estimatedM: Math.round(legM) })
    totalM += legM
    current = spot
    currentName = spot.name
  }
  return summarize(route, legs, totalM, input.load)
}

/** 興味に合うもの、未訪問のものを優先するための並び順の点数（小さいほど優先） */
function priority(spot: TouristSpot, input: QuestPlanInput): number {
  const interestMiss = input.interests.length > 0 && !spot.tags.some((tag) => input.interests.includes(tag)) ? 2 : 0
  const visited = input.visitedSpotIds.includes(spot.spotId) ? 1 : 0
  return interestMiss + visited
}

export function planQuest(input: QuestPlanInput): QuestPlan {
  const route: TouristSpot[] = []
  const legs: QuestLeg[] = []
  let current: LatLng = input.start
  let currentName = '出発地点'
  let totalM = 0

  const startSpot = input.spots.find((spot) => spot.spotId === input.startSpotId)
  if (startSpot) {
    route.push(startSpot)
    current = startSpot
    currentName = startSpot.name
  }

  while (route.length < MAX_QUEST_SPOTS) {
    const reachable = input.spots
      .filter((spot) => !route.includes(spot))
      .map((spot) => ({ spot, legM: distanceMeters(current, spot) * DETOUR_FACTOR }))
      // 希望時間・希望距離を超えるスポットは選ばない（知名度よりも時間と距離を優先）
      .filter(({ legM }) => withinLimits(totalM + legM, input))
      .sort((a, b) => priority(a.spot, input) - priority(b.spot, input) || a.legM - b.legM)
    const next = reachable[0]
    if (!next) break
    route.push(next.spot)
    legs.push({ fromName: currentName, toSpotId: next.spot.spotId, estimatedM: Math.round(next.legM) })
    totalM += next.legM
    current = next.spot
    currentName = next.spot.name
  }

  const plan = summarize(route, legs, totalM, input.load)

  if (route.length === 0 && input.spots.length > 0) {
    const nearest = input.spots
      .map((spot) => ({ spot, distanceM: Math.round(distanceMeters(input.start, spot)) }))
      .sort((a, b) => a.distanceM - b.distanceM)[0]
    plan.nearest = nearest
  }
  return plan
}

/** Google マップの徒歩経路の URL（API キー不要の URL 形式）。実際の経路はリンク先で確認する */
export function googleMapsWalkingUrl(origin: LatLng | null, spots: readonly LatLng[]): string | null {
  if (spots.length === 0) return null
  const fmt = (p: LatLng) => `${p.latitude},${p.longitude}`
  const destination = spots[spots.length - 1]
  const waypoints = spots.slice(0, -1)
  const params = new URLSearchParams({ api: '1', destination: fmt(destination), travelmode: 'walking' })
  if (origin) params.set('origin', fmt(origin))
  if (waypoints.length > 0) params.set('waypoints', waypoints.map(fmt).join('|'))
  return `https://www.google.com/maps/dir/?${params.toString()}`
}
