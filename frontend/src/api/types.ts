// 画面とデータ取得の境界。フェーズ1 は MockGameApi、フェーズ2 で HttpGameApi に切り替える。
// ポイント・ガチャ・チェックイン判定・アイテム付与など、結果を決める処理はすべて API（サーバー）側で行う。
import type { MissionKind } from '../domain/mission'
import type { TitleStatus } from '../domain/titles'
import type {
  Appearance,
  Character,
  DateKey,
  EquipSlot,
  StepRecord,
  StepSource,
  UserProfile,
  Visit,
  VisitVia,
  WalkingLoad,
} from '../domain/types'

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
  /** 今日付与済みの歩数コイン（1 日の上限は無い） */
  todayStepPoints: number
  /** 今日のログインボーナスを受け取り済みか */
  loginBonusClaimedToday: boolean
  /** ログインボーナスでもらえるコイン */
  loginBonusAmount: number
}

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
  /** 出発地点の表示名（例：「松山城周辺」「現在地」） */
  startLabel: string
  spots: QuestSpot[]
  /** 2 か所以上のときだけ計算する。1 か所のみの場合は null */
  estimate: QuestEstimate | null
  /** 実際の徒歩経路を確認するための外部地図の URL */
  mapsUrl: string | null
  generatedBy: 'mock' | 'bedrock'
}

export interface GachaDrawResult {
  itemId: string
  /** すでに持っていたアイテムなら true（所持品は増えず、レア度に応じたコインに変換する） */
  isDuplicate: boolean
  cost: number
  /** 重複時にコインへ変換した額（重複でなければ 0） */
  refund: number
  /** 抽選後の所持コイン */
  balance: number
}

/** デモ操作の履歴 */
export interface DemoHistoryEntry {
  id: string
  kind: 'coins' | 'steps'
  /** 追加したコイン数、または歩数 */
  amount: number
  /** 歩数追加でコインが付与されたときの付与額 */
  awardedCoins: number
  createdAt: string
}

export const DEMO_COIN_AMOUNTS = [100, 500, 1000] as const
export const DEMO_STEP_AMOUNTS = [100, 1000, 5000, 10000] as const
export type DemoCoinAmount = (typeof DEMO_COIN_AMOUNTS)[number]
export type DemoStepAmount = (typeof DEMO_STEP_AMOUNTS)[number]

/**
 * 動作確認・発表用のデモ操作。モック API（端末内で動く版）でだけ使える。
 * デモで追加した歩数は記録上区別し、正式ランキングには入れない。
 * 本番の API（フェーズ2 の HttpGameApi）では必ず null にし、サーバー側にもこの操作の入口を作らない。
 */
export interface DemoTools {
  addCoins(amount: DemoCoinAmount): Promise<PointBalance>
  /** 今日の歩数を増やし、通常の規則（100 歩 = 1 コイン、上限なし）でコインを付与する */
  addSteps(steps: DemoStepAmount): Promise<{ todaySteps: number; awardedPoints: number; balance: PointBalance }>
  getHistory(limit?: number): Promise<DemoHistoryEntry[]>
  /**
   * 発表用：いまのデータを消して、途中まで遊んだ状態（キャラクター作成済み・過去 7 日分の歩数・
   * コイン・アイテム・訪問済みスポット 1 か所）にする
   */
  prepareShowcase(): Promise<void>
}

export interface InventoryItem {
  itemId: string
  /** 最初に手に入れた日時（ISO 8601）。初期衣装はデータ作成日時 */
  acquiredAt: string
}

export type BalanceListener = (balance: PointBalance) => void

// ---------- プロフィール・キャラクター ----------

export interface SessionData {
  profile: UserProfile
  character: Character
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

export interface LoginBonusResult {
  granted: boolean
  amount: number
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
    /**
     * demo_data：デモで作った・追加した歩数を含む
     * unverified：端末のセンサーで数えた歩数（不正防止の仕組みができるまで正式な順位に入れない）
     * not_opted_in：愛媛県ランキングに参加していない
     */
    excludedReason?: 'demo_data' | 'unverified' | 'not_opted_in'
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

export interface GameApi {
  readonly mode: ApiMode
  /** 進行状況を端末に保存できるか。false のときは再読み込みで消える（画面で知らせる） */
  readonly persistent: boolean
  getProfile(): Promise<UserProfile>
  getCharacter(): Promise<Character>
  /** 歩数プロバイダーから歩数を取り込み、サーバー側の規則でポイントを付与する */
  syncSteps(): Promise<StepSyncResult>
  getStepRecords(from: DateKey, to: DateKey): Promise<StepRecord[]>
  getPointBalance(): Promise<PointBalance>
  getRecommendedQuest(): Promise<QuestSuggestion>
  /** 通常ガチャを 1 回引く。ポイント消費・アイテム追加・返還はまとめて保存する */
  drawGacha(): Promise<GachaDrawResult>
  /** 所持アイテムの一覧 */
  getInventory(): Promise<InventoryItem[]>
  /** スロットにアイテムを装備する。itemId が null なら外す。所持していないアイテムは装備できない */
  equipItem(slot: EquipSlot, itemId: string | null): Promise<Character>
  /**
   * 所持コインが変わったときに呼ばれる（歩数の付与・ガチャ・重複変換・デモ操作）。
   * ヘッダーと各画面が同じ残高を表示するために使う。戻り値の関数で登録を解除する
   */
  onBalanceChange(listener: BalanceListener): () => void
  /** 開発用のデモ操作。使えない環境（本番）では null */
  readonly demo: DemoTools | null

  // ---- プロフィール・キャラクター ----
  /** プロフィール・キャラクター・称号をまとめて取得する（全画面で共有する） */
  getSession(): Promise<SessionData>
  /** 初回のキャラクター作成 */
  completeOnboarding(input: OnboardingInput): Promise<SessionData>
  updateProfile(patch: ProfilePatch): Promise<SessionData>
  updateCharacter(patch: CharacterPatch): Promise<Character>

  // ---- ログインボーナス ----
  /** 1 日 1 回。受け取り済みなら granted: false */
  claimLoginBonus(): Promise<LoginBonusResult>

  // ---- ランキング ----
  getRanking(scope: RankingScope): Promise<RankingResult>
  sendCheer(friendUserId: string, reaction: CheerReaction): Promise<void>

  // ---- 観光 ----
  getVisits(): Promise<Visit[]>
  /** 位置の判定と限定アイテムの付与はサーバー側で行う。座標は保存しない */
  checkIn(request: CheckInRequest): Promise<CheckInResult>
  getSpotGuide(spotId: string): Promise<SpotGuide>

  // ---- AI ----
  generateQuest(request: QuestRequest): Promise<QuestGenerationResult>
  getWeeklyMission(): Promise<WeeklyMission>
  getActivitySummary(): Promise<ActivitySummary>

  /** アカウントと関連データをすべて削除する */
  deleteAllData(): Promise<void>
}

export type ApiErrorCode =
  | 'network'
  | 'insufficient_points'
  | 'item_not_owned'
  | 'invalid_slot'
  | 'storage_failed'
  | 'demo_unavailable'
  | 'invalid_input'
  | 'not_found'
  | 'sensor_unavailable'

/** 利用者に見せてよいエラー */
export class ApiError extends Error {
  readonly userMessage: string
  readonly code: ApiErrorCode

  constructor(userMessage: string, options?: { cause?: unknown; code?: ApiErrorCode }) {
    super(userMessage, options)
    this.name = 'ApiError'
    this.userMessage = userMessage
    this.code = options?.code ?? 'network'
  }
}

/** 想定外のエラーの詳細は利用者に見せず、決まった文言にする */
export function toUserMessage(error: unknown, fallback = '処理に失敗しました。時間をおいて、もう一度お試しください。'): string {
  return error instanceof ApiError ? error.userMessage : fallback
}
