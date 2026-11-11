// 画面とデータ取得の境界。フェーズ1 は MockGameApi、フェーズ2 で HttpGameApi に切り替える。
import type { Character, DateKey, StepRecord, StepSource, UserProfile } from '../domain/types'

export type ApiMode = 'mock' | 'aws'

export interface StepSyncResult {
  source: StepSource
  syncedDays: number
  /** 今回の同期で新たに付与されたポイント */
  awardedPoints: number
  syncedAt: string
}

export interface PointBalance {
  balance: number
  /** 今日付与済みの歩数ポイント */
  todayStepPoints: number
  dailyStepPointCap: number
}

export interface QuestSpot {
  spotId: string
  name: string
  municipality: string
  rewardItemId: string
}

export interface QuestEstimate {
  /**
   * straight_line：直線距離 × 迂回係数からの目安（経路検索をしていない）
   * route：経路検索サービスで計算した値（フェーズ2 以降）
   */
  basis: 'straight_line' | 'route'
  distanceM: number
  steps: number
  minutes: number
}

export interface QuestSuggestion {
  questId: string
  title: string
  summary: string
  /** なぜこのクエストを提案したか */
  reason: string
  spots: QuestSpot[]
  /** 2 か所以上のときだけ計算する。1 か所のみの場合は null */
  estimate: QuestEstimate | null
  generatedBy: 'mock' | 'bedrock'
}

export interface GameApi {
  readonly mode: ApiMode
  getProfile(): Promise<UserProfile>
  getCharacter(): Promise<Character>
  /** 歩数プロバイダーから歩数を取り込み、サーバー側の規則でポイントを付与する */
  syncSteps(): Promise<StepSyncResult>
  getStepRecords(from: DateKey, to: DateKey): Promise<StepRecord[]>
  getPointBalance(): Promise<PointBalance>
  getRecommendedQuest(): Promise<QuestSuggestion>
}

/** 利用者に見せてよいエラー */
export class ApiError extends Error {
  readonly userMessage: string

  constructor(userMessage: string, options?: { cause?: unknown }) {
    super(userMessage, options)
    this.name = 'ApiError'
    this.userMessage = userMessage
  }
}
