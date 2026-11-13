import type { QuestGenreId, WalkingLoad } from '../shared'

export const QUEST_MINUTE_OPTIONS = [15, 30, 45, 60] as const
export const QUEST_DISTANCE_OPTIONS_M = [1000, 2000, 3000, 5000] as const
export const WALKING_LOADS: readonly WalkingLoad[] = ['easy', 'normal', 'active']

/** 検証済みの散策条件 */
export interface QuestConditions {
  /** 登録スポットの ID、または 'current'（現在地） */
  startSpotId: string
  currentLocation: { latitude: number; longitude: number } | null
  minutes: (typeof QUEST_MINUTE_OPTIONS)[number]
  genre: QuestGenreId
  maxDistanceM: (typeof QUEST_DISTANCE_OPTIONS_M)[number] | null
  load: WalkingLoad
}

/** AI に渡す候補スポット（AI はこの中からだけ選ぶ） */
export interface CandidateForAi {
  spotId: string
  name: string
  municipality: string
  tags: string[]
  description: string
  /** 出発地点からの距離の目安（km、直線距離 × 迂回係数） */
  fromStartKm: number
  matchesGenre: boolean
}

export interface AiQuestPrompt {
  startLabel: string
  minutes: number
  maxDistanceKm: number | null
  genreLabel: string
  loadLabel: string
  candidates: CandidateForAi[]
}

/** AI の回答を検証したもの */
export interface AiQuestDraft {
  title: string
  description: string
  estimatedMinutes: number
  spotIds: string[]
  steps: { spotId: string; description: string }[]
}

export interface AiUsage {
  inputTokens: number | null
  outputTokens: number | null
}

/** 画面に返すクエスト */
export interface GeneratedQuest {
  questId: string
  title: string
  description: string
  /** AI が見積もった所要時間（見学時間を含むことがある推定値。正確な徒歩時間ではない） */
  estimatedMinutes: number
  startLabel: string
  spots: { order: number; spotId: string; name: string; municipality: string; description: string; legM: number }[]
  /** サーバーが直線距離 × 迂回係数で計算し直した目安 */
  route: { basis: 'straight_line'; distanceM: number; minutes: number; steps: number }
  generatedBy: 'mock' | 'bedrock'
  model: string | null
  createdAt: string
}

export type GenerateResult =
  | { status: 'ok'; quest: GeneratedQuest; cached: boolean; remainingToday: number; dailyLimit: number }
  | {
      status: 'no_spots'
      nearest: { spotId: string; name: string; distanceM: number } | null
      remainingToday: number
      dailyLimit: number
    }

/** 利用者に見せてよいエラー。message は画面にそのまま出す日本語 */
export type QuestErrorCode =
  | 'invalid_input'
  | 'quota_exceeded'
  | 'busy'
  | 'service_limit'
  | 'ai_not_configured'
  | 'ai_unavailable'
  | 'ai_timeout'
  | 'ai_invalid_response'

const STATUS: Record<QuestErrorCode, number> = {
  invalid_input: 400,
  quota_exceeded: 429,
  busy: 429,
  service_limit: 503,
  ai_not_configured: 503,
  ai_unavailable: 502,
  ai_timeout: 504,
  ai_invalid_response: 502,
}

export class QuestError extends Error {
  readonly code: QuestErrorCode
  readonly status: number
  readonly remainingToday: number | undefined

  constructor(code: QuestErrorCode, message: string, remainingToday?: number) {
    super(message)
    this.name = 'QuestError'
    this.code = code
    this.status = STATUS[code]
    this.remainingToday = remainingToday
  }
}
