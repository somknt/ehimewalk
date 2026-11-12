// 画面とデータ取得の境界。フェーズ1 は MockGameApi、フェーズ2 で HttpGameApi に切り替える。
import type { Character, DateKey, EquipSlot, StepRecord, StepSource, UserProfile } from '../domain/types'

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

/** デモ操作の履歴（開発モードのデータにだけ存在する） */
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
export const DEMO_STEP_AMOUNTS = [100, 1000, 5000] as const
export type DemoCoinAmount = (typeof DEMO_COIN_AMOUNTS)[number]
export type DemoStepAmount = (typeof DEMO_STEP_AMOUNTS)[number]

/**
 * 開発用のデモ操作。開発モードのモック API でだけ使える。
 * 本番の API（フェーズ2 の HttpGameApi）では必ず null にし、サーバー側にもこの操作の入口を作らない。
 */
export interface DemoTools {
  addCoins(amount: DemoCoinAmount): Promise<PointBalance>
  /** 今日の歩数を増やし、通常の規則（100 歩 = 1 コイン、1 日 100 コインまで）でコインを付与する */
  addSteps(steps: DemoStepAmount): Promise<{ todaySteps: number; awardedPoints: number; balance: PointBalance }>
  getHistory(limit?: number): Promise<DemoHistoryEntry[]>
}

export interface InventoryItem {
  itemId: string
  /** 最初に手に入れた日時（ISO 8601）。初期衣装はデータ作成日時 */
  acquiredAt: string
}

export type BalanceListener = (balance: PointBalance) => void

export interface InventoryItem {
  itemId: string
  /** 最初に手に入れた日時（ISO 8601）。初期衣装はデータ作成日時 */
  acquiredAt: string
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
}

export type ApiErrorCode =
  | 'network'
  | 'insufficient_points'
  | 'item_not_owned'
  | 'invalid_slot'
  | 'storage_failed'
  | 'demo_unavailable'

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
