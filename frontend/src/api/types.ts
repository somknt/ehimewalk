// 画面とデータ取得の境界。フェーズ1 は MockGameApi、フェーズ2 で HttpGameApi に切り替える。
// ポイント・ガチャ・チェックイン判定など、結果を決める処理はすべて API（サーバー）側で行う。
import type { TitleStatus } from '../domain/titles'
import type {
  Appearance,
  Character,
  DateKey,
  EquipSlot,
  InventoryEntry,
  Rarity,
  StepRecord,
  StepSource,
  UserProfile,
  Visit,
  VisitVia,
  WalkingLoad,
} from '../domain/types'
import type { MissionKind } from '../domain/mission'

export type ApiMode = 'mock' | 'aws'

// ---------- プロフィール・キャラクター ----------

export interface SessionData {
  profile: UserProfile
  character: Character
  balance: PointBalance
  titles: TitleStatus[]
}

export interface OnboardingInput {
  username: string
  characterName: string
  appearance: Appearance
  topItemId: string
  bottomItemId: string
}

export interface ProfilePatch {
  username?: string
  dailyGoal?: number
  ehimeRankingOptIn?: boolean
  reduceGachaEffects?: boolean
  titleId?: string
}

export interface CharacterPatch {
  name?: string
  appearance?: Partial<Appearance>
}

// ---------- 歩数・ポイント ----------

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
  loginBonusClaimedToday: boolean
  loginBonusAmount: number
}

export interface LoginBonusResult {
  granted: boolean
  amount: number
  balance: PointBalance
}

// ---------- ガチャ・持ち物 ----------

export interface GachaDrawResult {
  itemId: string
  rarity: Rarity
  isNew: boolean
  quantity: number
  balance: PointBalance
}

// ---------- ランキング ----------

export type RankingScope = 'all' | 'ehime' | 'friends'

export interface RankingEntry {
  rank: number
  userId: string
  username: string
  character: Character
  weeklySteps: number
  title: string
  isMe: boolean
  /** モックのサンプルユーザー */
  isSample: boolean
}

export interface RankingResult {
  scope: RankingScope
  /** 週の月曜日（JST） */
  weekStart: DateKey
  entries: RankingEntry[]
  me: {
    weeklySteps: number
    /** 正式ランキングの対象か（デモデータは対象外） */
    eligible: boolean
    /** 対象外の場合、自分の歩数を入れたら何位に相当するか（参考） */
    referenceRank: number
    /** 愛媛県ランキングに参加していない等で表示しない場合 */
    excludedReason?: 'demo_data' | 'not_opted_in'
  }
}

export type CheerReaction = 'nice' | 'fight' | 'thanks'

// ---------- 観光 ----------

export interface CheckInRequest {
  spotId: string
  latitude: number
  longitude: number
  accuracyM: number
  via: VisitVia
  questId?: string
  /** モック専用：現地にいなくても動作を確認するためのデモ用チェックイン */
  demoLocation?: boolean
}

export type CheckInResult =
  | {
      status: 'success'
      distanceM: number
      visit: Visit
      /** 初回訪問で獲得した限定アイテム（2 回目以降は null） */
      rewardItemId: string | null
      firstVisit: boolean
    }
  | { status: 'too_far'; distanceM: number; allowedM: number }
  | { status: 'low_accuracy'; accuracyM: number }

export interface SpotGuideSection {
  heading: string
  /** 登録情報が無い場合は null（推測で埋めない） */
  body: string | null
}

export interface SpotGuide {
  spotId: string
  sections: SpotGuideSection[]
  sources: { label: string; url: string }[]
  generatedBy: 'mock' | 'bedrock'
}

// ---------- AI ----------

export interface QuestSpot {
  spotId: string
  name: string
  municipality: string
  rewardItemId: string
  /** 登録情報をもとにした紹介文 */
  intro: string
  /** 前の地点からの距離の目安（m）。最初のスポットが出発地点の場合は 0 */
  legM: number
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
  startLabel: string
  spots: QuestSpot[]
  /** 2 か所以上のときだけ計算する。1 か所のみの場合は null */
  estimate: QuestEstimate | null
  /** 実際の徒歩経路を確認するための外部地図の URL */
  mapsUrl: string | null
  generatedBy: 'mock' | 'bedrock'
}

export interface QuestRequest {
  /** 登録スポットの ID、または 'current'（現在地） */
  startSpotId: string | 'current'
  currentLocation?: { latitude: number; longitude: number }
  minutes: number
  interests: string[]
  load: WalkingLoad
}

export type QuestGenerationResult =
  | { status: 'ok'; quest: QuestSuggestion; remainingToday: number }
  | {
      status: 'no_spots'
      nearest: { spotId: string; name: string; distanceM: number } | null
      remainingToday: number
    }
  | { status: 'quota_exceeded'; remainingToday: 0 }

export interface WeeklyMission {
  kind: MissionKind
  targetSteps: number
  message: string
  average7Days: number
  currentGoal: number
  generatedBy: 'mock' | 'bedrock'
}

/** 自分の利用状況（効果検証の個人版） */
export interface ActivitySummary {
  activeDays: number
  goalAchievedDays: number
  recordedDays: number
  questGenerations: number
  visitsViaQuest: number
  visitsViaList: number
  gachaDraws: number
}

// ---------- API ----------

export interface GameApi {
  readonly mode: ApiMode

  getSession(): Promise<SessionData>
  completeOnboarding(input: OnboardingInput): Promise<SessionData>
  updateProfile(patch: ProfilePatch): Promise<SessionData>
  updateCharacter(patch: CharacterPatch): Promise<Character>
  /** 所持していないアイテムは装備できない。itemId が null なら外す */
  equipItem(slot: EquipSlot, itemId: string | null): Promise<Character>

  /** 歩数プロバイダーから歩数を取り込み、サーバー側の規則でポイントを付与する */
  syncSteps(): Promise<StepSyncResult>
  getStepRecords(from: DateKey, to: DateKey): Promise<StepRecord[]>
  getPointBalance(): Promise<PointBalance>
  claimLoginBonus(): Promise<LoginBonusResult>

  drawGacha(): Promise<GachaDrawResult>
  getInventory(): Promise<InventoryEntry[]>

  getRanking(scope: RankingScope): Promise<RankingResult>
  sendCheer(friendUserId: string, reaction: CheerReaction): Promise<void>

  getVisits(): Promise<Visit[]>
  checkIn(request: CheckInRequest): Promise<CheckInResult>
  getSpotGuide(spotId: string): Promise<SpotGuide>

  getRecommendedQuest(): Promise<QuestSuggestion>
  generateQuest(request: QuestRequest): Promise<QuestGenerationResult>
  getWeeklyMission(): Promise<WeeklyMission>
  getActivitySummary(): Promise<ActivitySummary>

  /** アカウントと関連データをすべて削除する */
  deleteAllData(): Promise<void>
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

/** 想定外のエラーの詳細は利用者に見せず、決まった文言にする */
export function toUserMessage(error: unknown, fallback = '処理に失敗しました。時間をおいて、もう一度お試しください。'): string {
  return error instanceof ApiError ? error.userMessage : fallback
}
