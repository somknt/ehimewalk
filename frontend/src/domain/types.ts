// ドメインの型。フェーズ2 で shared/ に移し、Lambda と共有する。

/** JST の日付文字列（YYYY-MM-DD） */
export type DateKey = string

/** 歩数の取得元 */
export type StepSource = 'demo' | 'healthkit' | 'health_connect'

/** サーバー側の検証結果。trusted だけが正式ランキングに反映される */
export type StepVerification = 'trusted' | 'pending' | 'excluded'

export interface DailySteps {
  date: DateKey
  steps: number
}

export interface StepRecord extends DailySteps {
  source: StepSource
  /** steps のうち、開発用のデモ操作で追加した歩数（実際の歩数と区別するため別に持つ） */
  demoAddedSteps?: number
  /** 最後に同期した日時（ISO 8601） */
  syncTimestamp: string
  verification: StepVerification
}

/**
 * gacha_refund：ガチャで持っているアイテムが出たときのコイン変換
 * demo_grant：開発用のデモ操作で追加したコイン（開発モードのデータにだけ存在する）
 */
export type PointReason = 'step_reward' | 'login_bonus' | 'gacha_draw' | 'gacha_refund' | 'demo_grant' | 'admin_adjustment'

export interface PointTransaction {
  transactionId: string
  amount: number
  reason: PointReason
  /** 二重付与の確認などに使う参照キー（例：歩数ポイントなら日付） */
  refKey?: string
  createdAt: string
}

export type EquipSlot =
  | 'head'
  | 'hair'
  | 'top'
  | 'bottom'
  | 'shoes'
  | 'accessory'
  | 'background'
  | 'pet'

export type HairStyleId = 'short' | 'bob' | 'long'
export type HairColorId = 'black' | 'brown' | 'mikan' | 'blonde' | 'seto' | 'pink'
export type SkinToneId = 'light' | 'medium' | 'tan' | 'deep'
export type EyeColorId = 'brown' | 'black' | 'blue' | 'green'

export interface Appearance {
  hairStyle: HairStyleId
  hairColor: HairColorId
  skinTone: SkinToneId
  eyeColor: EyeColorId
}

export interface Character {
  name: string
  appearance: Appearance
  equipped: Partial<Record<EquipSlot, string>>
}

export interface UserProfile {
  userId: string
  username: string
  friendCode: string
  /** 都道府県コード（愛媛県 = 38） */
  selectedRegion: string
  ehimeRankingOptIn: boolean
  /** 表示中の称号の ID（domain/titles.ts） */
  titleId: string
  /** 表示中の称号の名前（titleId から決まる。表示用） */
  title: string
  dailyGoal: number
  /** キャラクター作成が済んでいるか */
  onboarded: boolean
  /** ガチャの演出を短くする */
  reduceGachaEffects: boolean
  createdAt: string
}

/** 観光スポットへの訪問経路。AI 提案の効果を測るため、一覧からの訪問と区別する */
export type VisitVia = 'ai_quest' | 'list'

export interface Visit {
  spotId: string
  visitedAt: string
  via: VisitVia
  questId?: string
  /** GPS で現地確認できた訪問か（デモ用チェックインは false） */
  verified: boolean
}

/** 散策の負荷。歩く速さの想定に使う */
export type WalkingLoad = 'easy' | 'normal' | 'active'

export type Rarity = 'N' | 'R' | 'SR' | 'SSR'
export type ItemAcquisitionType = 'starter' | 'gacha' | 'spot' | 'login_bonus'

export interface SourceRef {
  label: string
  url: string
}

export type SpotKind = 'landmark' | 'shopping_street' | 'culture' | 'shop'

export interface TouristSpot {
  spotId: string
  name: string
  /** 都道府県コード */
  prefectureCode: string
  /** 全国地方公共団体コード（5 桁） */
  municipalityCode: string
  municipality: string
  address: string
  latitude: number
  longitude: number
  /** チェックイン判定の半径（m） */
  checkinRadiusM: number
  kind: SpotKind
  tags: string[]
  description: string
  /**
   * AI 観光ガイドに渡す登録情報。情報源で確認できた内容だけを書き、無い項目は省略する
   * （省略した項目は「登録情報がありません」と表示し、推測で埋めない）
   */
  guide: {
    history?: string
    culture?: string
    specialties?: string
  }
  rewardItemId: string
  nearbySpotIds: string[]
  sources: SourceRef[]
}
