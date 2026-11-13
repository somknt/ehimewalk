// ブラウザ内で動くモックサーバー。フェーズ2 の Lambda と同じ規則（domain/）でポイントを計算する。
// データは localStorage に保存する。URL に ?mockError を付けると通信エラーを再現できる。
// 保存データは読み込むたびに検証し、壊れた項目は初期値に戻す（アプリを止めない）。
import { isValidLatLng, judgeCheckIn } from '../domain/checkin'
import { COMMON_QUESTS, getCommonQuest, questClaimKey, type CommonQuest } from '../domain/commonQuests'
import { addDays, dateRange, dayOfWeek, isDateKey, startOfMonth, startOfWeek, toJstDateKey } from '../domain/date'
import { drawItem, secureRandom, type RandomSource } from '../domain/gacha'
import { proposeWeeklyGoal } from '../domain/mission'
import { GACHA_COST, pointsShortForGacha, pointsToAward } from '../domain/points'
import { googleMapsWalkingUrl, planQuest, type QuestPlan } from '../domain/questPlanner'
import { clampDailyGoal, DEFAULT_DAILY_GOAL, MAX_DAILY_GOAL, MIN_DAILY_GOAL, summarizeSteps } from '../domain/steps'
import { DEFAULT_TITLE_ID, evaluateTitles, TITLES, titleIdFromName, titleName } from '../domain/titles'
import type {
  Appearance,
  Character,
  DateKey,
  EquipSlot,
  PointReason,
  PointTransaction,
  StepRecord,
  StepSource,
  StepVerification,
  UserProfile,
  Visit,
  VisitVia,
  WalkingLoad,
} from '../domain/types'
import {
  GACHA_DUPLICATE_COINS,
  ITEMS,
  NORMAL_GACHA_CANDIDATES,
  NORMAL_GACHA_RATES,
  STARTER_BOTTOM_IDS,
  STARTER_EQUIPMENT,
  STARTER_TOP_IDS,
} from '../data/items'
import { EHIME_PREFECTURE_CODE, getSpot, QUEST_INTERESTS, SPOTS } from '../data/spots'
import { EYE_COLORS, HAIR_COLORS, HAIR_STYLES, SKIN_TONES } from '../features/character/sprites'
import {
  FRIEND_CODE_CHARS,
  SAMPLE_ACCEPT_DELAY_MS,
  SAMPLE_INCOMING_REQUEST_IDS,
  SAMPLE_USERS,
  sampleWeeklySteps,
  type SampleUser,
} from './sampleUsers'
import { DeviceMotionStepProvider } from './stepProviders/deviceMotionStepProvider'
import type { StepDataProvider } from './stepProviders/types'
import {
  ApiError,
  DEMO_COIN_AMOUNTS,
  DEMO_STEP_AMOUNTS,
  type ActivitySummary,
  type BalanceListener,
  type CharacterPatch,
  type CheckInRequest,
  type CheckInResult,
  type CheerReaction,
  type CommonQuestStatus,
  type QuestClaimResult,
  type FriendCandidate,
  type FriendEntry,
  type FriendRelation,
  type FriendsData,
  type DemoCoinAmount,
  type DemoHistoryEntry,
  type DemoStepAmount,
  type DemoTools,
  type GachaDrawResult,
  type GameApi,
  type InventoryItem,
  type LoginBonusResult,
  type OnboardingInput,
  type PointBalance,
  type ProfilePatch,
  type QuestGenerationResult,
  type QuestRequest,
  type QuestSuggestion,
  type RankingEntry,
  type RankingResult,
  type RankingScope,
  type SessionData,
  type SpotGuide,
  type StepSyncResult,
  type WeeklyMission,
} from './types'

export const STORAGE_KEY = 'ewq.mock.v1'
/** 読めなかった保存データの退避先（原因調査用。アプリでは読み込まない） */
export const BROKEN_STORAGE_KEY = 'ewq.mock.v1.broken'
/**
 * 保存データの形のバージョン。
 * 3：キャラクター作成・称号・訪問記録・AI クエストの記録などを追加（1・2 のデータは読み込み時に移行する）
 */
const CURRENT_VERSION = 3
/** 同期で受け付ける期間（今日を含む日数）。これより前の日付は受け付けない */
const SYNC_WINDOW_DAYS = 7
/** 入力値として受け付ける 1 日の歩数の上限（明らかな異常値を弾くため） */
const MAX_ACCEPTED_DAILY_STEPS = 100_000
const MAX_CHARACTER_NAME_LENGTH = 12

const EQUIP_SLOTS: readonly EquipSlot[] = ['head', 'hair', 'top', 'bottom', 'shoes', 'accessory', 'background', 'pet']
const STEP_SOURCES: readonly StepSource[] = ['device_motion', 'demo', 'healthkit', 'health_connect']
/** デモ操作で歩数を足せる取得元（端末内で完結するもの。OS の健康データには混ぜない） */
const DEMO_BOOSTABLE_SOURCES: readonly StepSource[] = ['device_motion', 'demo']
const VERIFICATIONS: readonly StepVerification[] = ['trusted', 'pending', 'excluded']
const POINT_REASONS: readonly PointReason[] = [
  'step_reward',
  'login_bonus',
  'gacha_draw',
  'gacha_refund',
  'demo_grant',
  'admin_adjustment',
  'quest_reward',
]
/** デモ操作の履歴として残す件数 */
const MAX_DEMO_HISTORY = 200
/** ログインボーナスのコイン（1 日 1 回） */
export const LOGIN_BONUS_POINTS = 10
/** AI クエスト生成の 1 日の上限回数（AI の利用料金を抑えるため） */
export const AI_QUEST_DAILY_LIMIT = 5
/** 覚えておく AI クエストの件数（チェックインを AI 経由と判定するために使う） */
const MAX_REMEMBERED_QUESTS = 30
const MAX_QUEST_LOG = 500
const MAX_ACTIVE_DATES = 400
const VISIT_VIAS: readonly VisitVia[] = ['ai_quest', 'list']
const WALKING_LOADS: readonly WalkingLoad[] = ['easy', 'normal', 'active']
const CHEER_REACTIONS: readonly CheerReaction[] = ['nice', 'fight', 'thanks']
const RANKING_SCOPES: readonly RankingScope[] = ['all', 'ehime', 'friends']
const LOAD_LABELS: Record<WalkingLoad, string> = { easy: 'ゆったり', normal: 'ふつう', active: 'しっかり' }

interface RememberedQuest {
  questId: string
  title: string
  spotIds: string[]
}

interface MockDb {
  version: typeof CURRENT_VERSION
  profile: UserProfile
  character: Character
  stepRecords: Record<DateKey, StepRecord>
  /** 日付ごとの付与済み歩数ポイント（二重付与の防止に使う） */
  stepAwards: Record<DateKey, number>
  transactions: PointTransaction[]
  balance: number
  /** 所持アイテム。重複は所持しない（ガチャで重複したときはコインに変換する） */
  inventory: Record<string, { acquiredAt: string }>
  /** 日付ごとの、デモ操作で追加した歩数（デモ歩数・実際の歩数とは別に持ち、同期のたびに足し合わせる） */
  demoStepBoosts: Record<DateKey, number>
  /** デモ操作の履歴（新しい順） */
  demoHistory: DemoHistoryEntry[]
  /** 観光スポットの訪問記録（スポットごとに初回の訪問だけを持つ。座標は保存しない） */
  visits: Record<string, Visit>
  /** AI クエストの生成記録（効果検証用） */
  questLog: { questId: string; createdAt: string; spotIds: string[] }[]
  /** AI クエストの今日の利用回数 */
  aiQuota: { date: DateKey; count: number }
  /** 直近に提案したクエスト（チェックインを AI 経由と判定するため） */
  quests: Record<string, RememberedQuest>
  /** フレンドへ送った応援の回数 */
  cheers: Record<string, number>
  /** アプリを利用した日（効果検証の「利用日数」） */
  activeDates: DateKey[]
  /** フレンド関係（相手のユーザー ID ごと）。フレンド・申請中・申請が届いている */
  friendships: Record<string, Friendship>
  /** みんな共通のクエストの報酬を受け取った記録（「クエスト ID:期間」→ 受け取った日時） */
  questClaims: Record<string, string>

}

interface Friendship {
  status: 'accepted' | 'pending_sent' | 'pending_received'
  /** フレンドになった日時、または申請した日時 */
  since: string
}

const FRIENDSHIP_STATUSES: readonly Friendship['status'][] = ['accepted', 'pending_sent', 'pending_received']
/** フレンドにできる最大の人数（フレンドランキングの取得を重くしないため） */
export const MAX_FRIENDS = 100
const FRIEND_CODE_PATTERN = new RegExp(`^[${FRIEND_CODE_CHARS}]{8}$`)

/** 入力されたフレンドコードを正規化する（小文字・空白・ハイフンを許す） */
export function normalizeFriendCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '')
}

/** 初めて使うときのフレンド関係（サンプルユーザーから申請が届いている） */
function initialFriendships(createdAt: string): MockDb['friendships'] {
  return Object.fromEntries(SAMPLE_INCOMING_REQUEST_IDS.map((id) => [id, { status: 'pending_received', since: createdAt }]))
}

/** localStorage と同じ形の保存先（テストではメモリに差し替える） */
export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export class MemoryStorage implements KeyValueStorage {
  readonly data = new Map<string, string>()
  getItem(key: string) {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.data.set(key, value)
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
}

/** localStorage が使えない環境（プライベートモードの制限など）ではメモリに保存する */
function resolveStorage(): { storage: KeyValueStorage; persistent: boolean } {
  try {
    const storage = globalThis.localStorage
    const probe = `${STORAGE_KEY}.probe`
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    return { storage, persistent: true }
  } catch {
    return { storage: new MemoryStorage(), persistent: false }
  }
}

function generateFriendCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (b) => FRIEND_CODE_CHARS[b % FRIEND_CODE_CHARS.length]).join('')
}

const DEFAULT_APPEARANCE: Appearance = { hairStyle: 'short', hairColor: 'brown', skinTone: 'light', eyeColor: 'brown' }

function createInitialDb(now: Date): MockDb {
  const createdAt = now.toISOString()
  return {
    version: CURRENT_VERSION,
    profile: {
      userId: crypto.randomUUID(),
      username: 'ぼうけんしゃ',
      friendCode: generateFriendCode(),
      selectedRegion: EHIME_PREFECTURE_CODE,
      ehimeRankingOptIn: true,
      titleId: DEFAULT_TITLE_ID,
      title: titleName(DEFAULT_TITLE_ID),
      dailyGoal: DEFAULT_DAILY_GOAL,
      onboarded: false,
      reduceGachaEffects: false,
      createdAt,
    },
    character: { name: 'ミカ', appearance: { ...DEFAULT_APPEARANCE }, equipped: { ...STARTER_EQUIPMENT } },
    stepRecords: {},
    stepAwards: {},
    transactions: [],
    balance: 0,
    inventory: Object.fromEntries(Object.values(STARTER_EQUIPMENT).map((id) => [id, { acquiredAt: createdAt }])),
    demoStepBoosts: {},
    demoHistory: [],
    visits: {},
    questLog: [],
    aiQuota: { date: '', count: 0 },
    quests: {},
    cheers: {},
    activeDates: [],
    friendships: initialFriendships(createdAt),
    questClaims: {},
  }
}

// ---- 保存データの検証 ----

type Loose = Record<string, unknown>
const isObject = (v: unknown): v is Loose => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'
const isNonNegativeInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0
const pick = <T>(value: unknown, valid: (v: unknown) => v is T, fallback: T): T => (valid(value) ? value : fallback)
const oneOf =
  <T extends string>(options: readonly T[]) =>
  (v: unknown): v is T =>
    options.includes(v as T)

/**
 * legacy：キャラクター作成画面ができる前のデータ（バージョン 1・2）。
 * 作成済みかの記録が無ければ、すでに遊んでいた利用者として作成済みに扱う
 */
function normalizeProfile(raw: unknown, fallback: UserProfile, legacy: boolean): UserProfile {
  const p = isObject(raw) ? raw : {}
  const nonEmpty = (v: unknown): v is string => isString(v) && v.length > 0
  // 称号は ID で持つ。名前で保存していた古いデータは名前から ID を探す
  const titleId =
    isString(p.titleId) && TITLES.some((t) => t.titleId === p.titleId)
      ? p.titleId
      : ((isString(p.title) ? titleIdFromName(p.title) : undefined) ?? fallback.titleId)
  return {
    userId: pick(p.userId, nonEmpty, fallback.userId),
    username: pick(p.username, nonEmpty, fallback.username),
    friendCode: pick(p.friendCode, nonEmpty, fallback.friendCode),
    selectedRegion: pick(p.selectedRegion, nonEmpty, fallback.selectedRegion),
    ehimeRankingOptIn: typeof p.ehimeRankingOptIn === 'boolean' ? p.ehimeRankingOptIn : fallback.ehimeRankingOptIn,
    titleId,
    title: titleName(titleId),
    dailyGoal: typeof p.dailyGoal === 'number' && Number.isFinite(p.dailyGoal) ? clampDailyGoal(p.dailyGoal) : fallback.dailyGoal,
    onboarded: typeof p.onboarded === 'boolean' ? p.onboarded : legacy || fallback.onboarded,
    reduceGachaEffects: typeof p.reduceGachaEffects === 'boolean' ? p.reduceGachaEffects : fallback.reduceGachaEffects,
    createdAt: pick(p.createdAt, (v): v is string => isString(v) && !Number.isNaN(Date.parse(v)), fallback.createdAt),
  }
}

function normalizeInventory(raw: unknown, createdAt: string): MockDb['inventory'] {
  const inventory: MockDb['inventory'] = {}
  if (isObject(raw)) {
    for (const [itemId, value] of Object.entries(raw)) {
      if (!ITEMS.has(itemId)) continue
      // バージョン 1 は所持数（数値）で保存していた
      if (typeof value === 'number' && value > 0) inventory[itemId] = { acquiredAt: createdAt }
      else if (isObject(value) && isString(value.acquiredAt)) inventory[itemId] = { acquiredAt: value.acquiredAt }
      // shiomi ブランチの試作版は { quantity, firstAcquiredAt } で保存していた
      else if (isObject(value) && isNonNegativeInt(value.quantity) && value.quantity > 0) {
        inventory[itemId] = { acquiredAt: isString(value.firstAcquiredAt) ? value.firstAcquiredAt : createdAt }
      }
    }
  }
  // 初期衣装は必ず持っている
  for (const itemId of Object.values(STARTER_EQUIPMENT)) inventory[itemId] ??= { acquiredAt: createdAt }
  return inventory
}

function normalizeCharacter(raw: unknown, fallback: Character, inventory: MockDb['inventory']): Character {
  const c = isObject(raw) ? raw : {}
  const a = isObject(c.appearance) ? c.appearance : {}
  const name = isString(c.name) && c.name.trim().length > 0 && [...c.name].length <= MAX_CHARACTER_NAME_LENGTH ? c.name : fallback.name
  const appearance: Appearance = {
    hairStyle: pick(a.hairStyle, oneOf(Object.keys(HAIR_STYLES) as Appearance['hairStyle'][]), DEFAULT_APPEARANCE.hairStyle),
    hairColor: pick(a.hairColor, oneOf(Object.keys(HAIR_COLORS) as Appearance['hairColor'][]), DEFAULT_APPEARANCE.hairColor),
    skinTone: pick(a.skinTone, oneOf(Object.keys(SKIN_TONES) as Appearance['skinTone'][]), DEFAULT_APPEARANCE.skinTone),
    eyeColor: pick(a.eyeColor, oneOf(Object.keys(EYE_COLORS) as Appearance['eyeColor'][]), DEFAULT_APPEARANCE.eyeColor),
  }
  // 存在しない・持っていない・スロットの合わないアイテムの装備は外す
  const equipped: Character['equipped'] = {}
  const rawEquipped = isObject(c.equipped) ? c.equipped : fallback.equipped
  for (const slot of EQUIP_SLOTS) {
    const itemId = rawEquipped[slot]
    if (isString(itemId) && inventory[itemId] && ITEMS.get(itemId)?.category === slot) equipped[slot] = itemId
  }
  return { name, appearance, equipped }
}

function normalizeStepRecords(raw: unknown): MockDb['stepRecords'] {
  const records: MockDb['stepRecords'] = {}
  if (!isObject(raw)) return records
  for (const [date, value] of Object.entries(raw)) {
    if (!isDateKey(date) || !isObject(value)) continue
    const { steps, source, syncTimestamp, verification } = value
    if (!isNonNegativeInt(steps) || steps > MAX_ACCEPTED_DAILY_STEPS || !oneOf(STEP_SOURCES)(source)) continue
    const demoAdded = value.demoAddedSteps
    records[date] = {
      date,
      steps,
      source,
      ...(isNonNegativeInt(demoAdded) && demoAdded > 0 && demoAdded <= steps ? { demoAddedSteps: demoAdded } : {}),
      syncTimestamp: isString(syncTimestamp) ? syncTimestamp : new Date(0).toISOString(),
      verification: oneOf(VERIFICATIONS)(verification) ? verification : source === 'demo' ? 'excluded' : 'pending',
    }
  }
  return records
}

function normalizeStepAwards(raw: unknown): MockDb['stepAwards'] {
  const awards: MockDb['stepAwards'] = {}
  if (!isObject(raw)) return awards
  for (const [date, value] of Object.entries(raw)) {
    if (isDateKey(date) && isNonNegativeInt(value)) awards[date] = value
  }
  return awards
}

function normalizeDemoStepBoosts(raw: unknown): MockDb['demoStepBoosts'] {
  const boosts: MockDb['demoStepBoosts'] = {}
  if (!isObject(raw)) return boosts
  for (const [date, value] of Object.entries(raw)) {
    if (isDateKey(date) && isNonNegativeInt(value) && value <= MAX_ACCEPTED_DAILY_STEPS) boosts[date] = value
  }
  return boosts
}

function normalizeDemoHistory(raw: unknown): DemoHistoryEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (e): e is DemoHistoryEntry =>
        isObject(e) &&
        isString(e.id) &&
        (e.kind === 'coins' || e.kind === 'steps') &&
        isNonNegativeInt(e.amount) &&
        isNonNegativeInt(e.awardedCoins) &&
        isString(e.createdAt),
    )
    .slice(0, MAX_DEMO_HISTORY)
}

function normalizeTransactions(raw: unknown): PointTransaction[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (t): t is PointTransaction =>
      isObject(t) &&
      isString(t.transactionId) &&
      Number.isInteger(t.amount) &&
      oneOf(POINT_REASONS)(t.reason) &&
      isString(t.createdAt) &&
      (t.refKey === undefined || isString(t.refKey)),
  )
}

function normalizeVisits(raw: unknown): MockDb['visits'] {
  const visits: MockDb['visits'] = {}
  if (!isObject(raw)) return visits
  for (const [spotId, value] of Object.entries(raw)) {
    if (!getSpot(spotId) || !isObject(value) || !isString(value.visitedAt)) continue
    visits[spotId] = {
      spotId,
      visitedAt: value.visitedAt,
      via: oneOf(VISIT_VIAS)(value.via) ? value.via : 'list',
      ...(isString(value.questId) ? { questId: value.questId } : {}),
      verified: value.verified === true,
    }
  }
  return visits
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString)

function normalizeQuestLog(raw: unknown): MockDb['questLog'] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (q): q is MockDb['questLog'][number] =>
        isObject(q) && isString(q.questId) && isString(q.createdAt) && isStringArray(q.spotIds),
    )
    .map(({ questId, createdAt, spotIds }) => ({ questId, createdAt, spotIds }))
    .slice(-MAX_QUEST_LOG)
}

function normalizeQuests(raw: unknown): MockDb['quests'] {
  const quests: MockDb['quests'] = {}
  if (!isObject(raw)) return quests
  for (const [questId, value] of Object.entries(raw)) {
    if (isObject(value) && isString(value.title) && isStringArray(value.spotIds)) {
      quests[questId] = { questId, title: value.title, spotIds: value.spotIds }
    }
  }
  return quests
}

function normalizeAiQuota(raw: unknown): MockDb['aiQuota'] {
  return isObject(raw) && isString(raw.date) && isNonNegativeInt(raw.count)
    ? { date: raw.date, count: raw.count }
    : { date: '', count: 0 }
}

function normalizeCheers(raw: unknown): MockDb['cheers'] {
  const cheers: MockDb['cheers'] = {}
  if (!isObject(raw)) return cheers
  for (const [userId, count] of Object.entries(raw)) if (isNonNegativeInt(count)) cheers[userId] = count
  return cheers
}

/** フレンド関係が保存されていない古いデータは、初めて使うときと同じ状態にする */
function normalizeFriendships(raw: unknown, createdAt: string): MockDb['friendships'] {
  if (!isObject(raw)) return initialFriendships(createdAt)
  const friendships: MockDb['friendships'] = {}
  for (const [userId, value] of Object.entries(raw)) {
    if (!SAMPLE_USERS.some((u) => u.userId === userId) || !isObject(value)) continue
    if (oneOf(FRIENDSHIP_STATUSES)(value.status) && isString(value.since)) {
      friendships[userId] = { status: value.status, since: value.since }
    }
  }
  return friendships
}

function normalizeActiveDates(raw: unknown): DateKey[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter((d): d is string => isString(d) && isDateKey(d)))].sort().slice(-MAX_ACTIVE_DATES)
}

/**
 * 保存データを検証し、壊れた項目は初期値に置き換えた正しい形にする。
 * 形そのものが違う（バージョンが違う・オブジェクトでない）場合は null を返す。
 */
export function normalizeDb(raw: unknown, now: Date = new Date()): MockDb | null {
  if (!isObject(raw) || (raw.version !== 1 && raw.version !== 2 && raw.version !== CURRENT_VERSION)) return null
  const fallback = createInitialDb(now)
  const profile = normalizeProfile(raw.profile, fallback.profile, raw.version !== CURRENT_VERSION)
  const inventory = normalizeInventory(raw.inventory, profile.createdAt)
  const transactions = normalizeTransactions(raw.transactions)
  // 残高が壊れていたら取引記録から計算し直す。残高はマイナスにしない
  const balance = isNonNegativeInt(raw.balance)
    ? raw.balance
    : Math.max(0, transactions.reduce((sum, t) => sum + t.amount, 0))
  return {
    version: CURRENT_VERSION,
    profile,
    character: normalizeCharacter(raw.character, fallback.character, inventory),
    stepRecords: normalizeStepRecords(raw.stepRecords),
    stepAwards: normalizeStepAwards(raw.stepAwards),
    transactions,
    balance,
    inventory,
    demoStepBoosts: normalizeDemoStepBoosts(raw.demoStepBoosts),
    demoHistory: normalizeDemoHistory(raw.demoHistory),
    visits: normalizeVisits(raw.visits),
    questLog: normalizeQuestLog(raw.questLog),
    aiQuota: normalizeAiQuota(raw.aiQuota),
    quests: normalizeQuests(raw.quests),
    cheers: normalizeCheers(raw.cheers),
    activeDates: normalizeActiveDates(raw.activeDates),
    friendships: normalizeFriendships(raw.friendships, profile.createdAt),
    questClaims: normalizeQuestClaims(raw.questClaims),
  }
}

function normalizeQuestClaims(raw: unknown): MockDb['questClaims'] {
  const claims: MockDb['questClaims'] = {}
  if (!isObject(raw)) return claims
  for (const [key, claimedAt] of Object.entries(raw)) {
    if (isString(claimedAt) && getCommonQuest(key.split(':')[0])) claims[key] = claimedAt
  }
  return claims
}

// ---- モックサーバー ----

export interface MockGameApiOptions {
  /** 歩数の取得元。省略時はデモ歩数（ユーザー ID から決まる疑似乱数） */
  provider?: StepDataProvider
  storage?: KeyValueStorage
  /** 通信の待ち時間（ミリ秒）。省略時は 150〜300ms のランダム */
  latencyMs?: number
  /** ガチャの乱数（テストで固定する） */
  random?: RandomSource
  now?: () => Date
  /**
   * デモ操作（コイン・歩数の追加）を使えるようにするか。省略時は true（発表・動作確認用）。
   * デモで足した歩数とコインは記録上区別し、正式ランキングには入れない
   */
  enableDemoTools?: boolean
}

const shouldSimulateError = () =>
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('mockError')

function addTransaction(db: MockDb, amount: number, reason: PointReason, createdAt: string, refKey?: string) {
  db.transactions.push({ transactionId: crypto.randomUUID(), amount, reason, refKey, createdAt })
  db.balance += amount
}

function addDemoHistory(db: MockDb, entry: Omit<DemoHistoryEntry, 'id'>) {
  db.demoHistory = [{ id: crypto.randomUUID(), ...entry }, ...db.demoHistory].slice(0, MAX_DEMO_HISTORY)
}

// ---- 入力の検証（クライアントからの値は信用しない） ----

function invalid(message: string): ApiError {
  return new ApiError(message, { code: 'invalid_input' })
}

function validateName(value: unknown, label: string): string {
  const trimmed = isString(value) ? value.trim() : ''
  if (trimmed.length === 0) throw invalid(`${label}を入力してください。`)
  if ([...trimmed].length > MAX_CHARACTER_NAME_LENGTH) {
    throw invalid(`${label}は${MAX_CHARACTER_NAME_LENGTH}文字以内で入力してください。`)
  }
  return trimmed
}

function validateAppearance(value: Partial<Appearance>): Partial<Appearance> {
  const options: [keyof Appearance, Record<string, unknown>][] = [
    ['hairStyle', HAIR_STYLES],
    ['hairColor', HAIR_COLORS],
    ['skinTone', SKIN_TONES],
    ['eyeColor', EYE_COLORS],
  ]
  const result: Partial<Appearance> = {}
  for (const [key, allowed] of options) {
    const v = value[key]
    if (v === undefined) continue
    if (!isString(v) || !Object.hasOwn(allowed, v)) throw invalid('選べない外見が指定されました。')
    Object.assign(result, { [key]: v })
  }
  return result
}

// ---- 保存データからの計算 ----

function loginBonusClaimed(db: MockDb, today: DateKey): boolean {
  return db.transactions.some((t) => t.reason === 'login_bonus' && t.refKey === today)
}

function gachaDrawCount(db: MockDb): number {
  return db.transactions.filter((t) => t.reason === 'gacha_draw').length
}

function titlesOf(db: MockDb, today: DateKey) {
  const goalDaysLast7 = dateRange(addDays(today, -6), today).filter(
    (date) => (db.stepRecords[date]?.steps ?? 0) >= db.profile.dailyGoal,
  ).length
  return evaluateTitles({
    visitedSpotCount: Object.keys(db.visits).length,
    gachaDraws: gachaDrawCount(db),
    goalDaysLast7,
    ownedItemKinds: Object.keys(db.inventory).length,
  })
}

/** 散策時間の初期値。普段の歩数が少ない人ほど短くする */
export function walkingBudgetMinutes(average7Days: number): number {
  if (average7Days < 4000) return 30
  if (average7Days < 8000) return 45
  return 60
}

interface SuggestionOptions {
  questId: string
  startLabel: string
  origin: { latitude: number; longitude: number } | null
  interests: readonly string[]
  minutes: number
  load: WalkingLoad
  reason?: string
}

/** 規則で選んだ訪問先から、画面に出すクエストを作る（モック。AI 接続後は文章を AI に作らせる） */
function toSuggestion(plan: QuestPlan, options: SuggestionOptions): QuestSuggestion {
  const first = plan.spots[0]
  const interestLabel = options.interests[0] ?? 'ぶらり'
  const legBySpot = new Map(plan.legs.map((leg) => [leg.toSpotId, leg.estimatedM]))
  return {
    questId: options.questId,
    title: `${first.municipality} ${interestLabel}さんぽクエスト`,
    summary: plan.spots.map((spot) => spot.name).join(' → '),
    reason:
      options.reason ??
      `${options.minutes}分以内・${LOAD_LABELS[options.load]}のペースで回れる${plan.spots.length}か所を、${
        options.interests.length > 0 ? `「${options.interests.join('・')}」に合うもの` : '近いもの'
      }とまだ訪れていない場所を優先して選びました。`,
    startLabel: options.startLabel,
    spots: plan.spots.map((spot) => ({
      spotId: spot.spotId,
      name: spot.name,
      municipality: spot.municipality,
      rewardItemId: spot.rewardItemId,
      intro: spot.description,
      legM: legBySpot.get(spot.spotId) ?? 0,
    })),
    estimate:
      plan.legs.length > 0
        ? { basis: 'straight_line', distanceM: plan.distanceM, steps: plan.steps, minutes: plan.minutes }
        : null,
    mapsUrl: googleMapsWalkingUrl(options.origin, plan.spots),
    generatedBy: 'mock',
  }
}

function rememberQuest(db: MockDb, quest: QuestSuggestion): void {
  db.quests[quest.questId] = { questId: quest.questId, title: quest.title, spotIds: quest.spots.map((s) => s.spotId) }
  const ids = Object.keys(db.quests)
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_REMEMBERED_QUESTS))) delete db.quests[id]
}

/** 同じ歩数なら同じ順位にする */
function assignRanks<T extends { weeklySteps: number }>(rows: T[]): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => b.weeklySteps - a.weeklySteps)
  return sorted.map((row) => ({ ...row, rank: 1 + sorted.filter((other) => other.weeklySteps > row.weeklySteps).length }))
}

export class MockGameApi implements GameApi {
  readonly mode = 'mock' as const
  readonly persistent: boolean
  readonly demo: DemoTools | null
  private readonly storage: KeyValueStorage
  private readonly provider: StepDataProvider | undefined
  private readonly latencyMs: number | undefined
  private readonly random: RandomSource
  private readonly now: () => Date
  private readonly balanceListeners = new Set<BalanceListener>()

  constructor(options: MockGameApiOptions = {}) {
    if (options.storage) {
      this.storage = options.storage
      this.persistent = true
    } else {
      const resolved = resolveStorage()
      this.storage = resolved.storage
      this.persistent = resolved.persistent
    }
    this.provider = options.provider
    this.latencyMs = options.latencyMs
    this.random = options.random ?? secureRandom
    this.now = options.now ?? (() => new Date())
    // import.meta.env.DEV は本番ビルドで false に置き換わるため、本番ではデモ操作の入口ができない
    // モック（端末内で動く版）では公開版でもデモ操作を使える。本番の API（HttpGameApi）には作らない
    this.demo = (options.enableDemoTools ?? true) ? this.createDemoTools() : null
  }

  // ---- 保存 ----

  private loadDb(): MockDb {
    let raw: string | null = null
    try {
      raw = this.storage.getItem(STORAGE_KEY)
    } catch {
      raw = null
    }
    if (raw) {
      let parsed: unknown = null
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = null
      }
      const db = normalizeDb(parsed, this.now())
      if (db) return db
      // 読めないデータは原因を調べられるよう退避してから作り直す
      try {
        this.storage.setItem(BROKEN_STORAGE_KEY, raw)
      } catch {
        // 退避できなくても作り直しは続ける
      }
    }
    const db = createInitialDb(this.now())
    this.saveDb(db)
    return db
  }

  private saveDb(db: MockDb): void {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(db))
    } catch (error) {
      throw new ApiError('データを保存できませんでした。端末の空き容量を確認して、もう一度お試しください。', {
        cause: error,
        code: 'storage_failed',
      })
    }
  }

  /** 通信の遅延とエラーを再現する */
  private async simulateNetwork<T>(work: () => T | Promise<T>): Promise<T> {
    const delay = this.latencyMs ?? 150 + Math.random() * 150
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    if (shouldSimulateError()) {
      throw new ApiError('サーバーに接続できませんでした。通信環境を確認して、もう一度お試しください。')
    }
    return work()
  }

  // ---- 残高の通知 ----

  onBalanceChange(listener: BalanceListener): () => void {
    this.balanceListeners.add(listener)
    return () => {
      this.balanceListeners.delete(listener)
    }
  }

  private toBalance(db: MockDb): PointBalance {
    const today = toJstDateKey(this.now())
    return {
      balance: db.balance,
      todayStepPoints: db.stepAwards[today] ?? 0,
      loginBonusClaimedToday: loginBonusClaimed(db, today),
      loginBonusAmount: LOGIN_BONUS_POINTS,
    }
  }

  private sessionOf(db: MockDb): SessionData {
    return { profile: db.profile, character: db.character, titles: titlesOf(db, toJstDateKey(this.now())) }
  }

  /** 保存してから、残高の変化を画面に知らせる */
  private commit(db: MockDb, balanceChanged: boolean): PointBalance {
    this.saveDb(db)
    const balance = this.toBalance(db)
    if (balanceChanged) this.balanceListeners.forEach((listener) => listener(balance))
    return balance
  }

  // ---- 読み取り ----

  getProfile(): Promise<UserProfile> {
    return this.simulateNetwork(() => this.loadDb().profile)
  }

  getCharacter(): Promise<Character> {
    return this.simulateNetwork(() => this.loadDb().character)
  }

  getStepRecords(from: DateKey, to: DateKey): Promise<StepRecord[]> {
    return this.simulateNetwork(() =>
      Object.values(this.loadDb().stepRecords)
        .filter((record) => record.date >= from && record.date <= to)
        .sort((a, b) => a.date.localeCompare(b.date)),
    )
  }

  getPointBalance(): Promise<PointBalance> {
    return this.simulateNetwork(() => this.toBalance(this.loadDb()))
  }

  getInventory(): Promise<InventoryItem[]> {
    return this.simulateNetwork(() =>
      Object.entries(this.loadDb().inventory).map(([itemId, { acquiredAt }]) => ({ itemId, acquiredAt })),
    )
  }

  getRecommendedQuest(): Promise<QuestSuggestion> {
    return this.simulateNetwork(() => {
      const db = this.loadDb()
      const today = toJstDateKey(this.now())
      const { average7Days } = summarizeSteps(Object.values(db.stepRecords), today, db.profile.dailyGoal)
      const minutes = walkingBudgetMinutes(average7Days)
      const start = SPOTS[0]
      const interests = ['歴史']
      const plan = planQuest({
        start,
        startSpotId: start.spotId,
        minutes,
        interests,
        load: 'normal',
        visitedSpotIds: Object.keys(db.visits),
        spots: SPOTS,
      })
      const quest = toSuggestion(plan, {
        questId: `recommended-${today}-${minutes}`,
        startLabel: `${start.name}周辺`,
        origin: null,
        interests,
        minutes,
        load: 'normal',
        reason: `過去7日間の平均は約${average7Days.toLocaleString('ja-JP')}歩。無理なく歩ける${minutes}分以内のコースを選びました。`,
      })
      // おすすめから訪れたスポットも AI 経由として記録できるよう、提案内容を覚えておく
      rememberQuest(db, quest)
      this.saveDb(db)
      return quest
    })
  }

  // ---- 歩数とコイン ----

  private stepProvider(): StepDataProvider {
    // 省略時は、この端末のセンサーで数えた歩数（はじめは 0 歩）
    return this.provider ?? new DeviceMotionStepProvider(undefined, this.now)
  }

  /**
   * 取得した歩数（＋デモ操作で追加した歩数）を記録し、付与済みとの差分だけコインを付与する。
   * 呼び出し側は読み込みから保存までの間に await を挟まないこと（二重付与を防ぐため）
   */
  private applySteps(
    db: MockDb,
    fetched: readonly { date: DateKey; steps: number }[],
    range: { from: DateKey; today: DateKey; windowStart: DateKey },
    source: StepSource,
    syncedAt: string,
  ): { awardedPoints: number; syncedDays: number } {
    let awardedPoints = 0
    let syncedDays = 0
    // デモ操作で歩数を追加した日が取得結果に含まれていなくても、追加分を反映する（元の歩数は前回の記録か 0）
    const entries = [...fetched]
    for (const date of Object.keys(db.demoStepBoosts)) {
      if (date < range.from || date > range.today || entries.some((e) => e.date === date)) continue
      const previous = db.stepRecords[date]
      entries.push({ date, steps: previous ? previous.steps - (previous.demoAddedSteps ?? 0) : 0 })
    }
    for (const { date, steps: providerSteps } of entries) {
      // クライアントからの値を信用せず、サーバー側で検証する
      if (!isDateKey(date) || date > range.today || date < range.from) continue
      if (!Number.isInteger(providerSteps) || providerSteps < 0 || providerSteps > MAX_ACCEPTED_DAILY_STEPS) continue

      const demoAdded = db.demoStepBoosts[date] ?? 0
      const steps = Math.min(MAX_ACCEPTED_DAILY_STEPS, providerSteps + demoAdded)
      db.stepRecords[date] = {
        date,
        steps,
        source,
        ...(demoAdded > 0 ? { demoAddedSteps: demoAdded } : {}),
        syncTimestamp: syncedAt,
        // デモの歩数・デモ操作で足した歩数は正式ランキングの対象外。センサーの歩数は検証待ち（pending）
        verification: source === 'demo' || demoAdded > 0 ? 'excluded' : 'pending',
      }
      syncedDays += 1

      if (date < range.windowStart) continue
      const alreadyAwarded = db.stepAwards[date] ?? 0
      const award = pointsToAward(steps, alreadyAwarded)
      if (award > 0) {
        db.stepAwards[date] = alreadyAwarded + award
        addTransaction(db, award, 'step_reward', syncedAt, date)
        awardedPoints += award
      }
    }
    return { awardedPoints, syncedDays }
  }

  syncSteps(): Promise<StepSyncResult> {
    return this.simulateNetwork(async () => {
      const now = this.now()
      const today = toJstDateKey(now)
      const windowStart = addDays(today, -(SYNC_WINDOW_DAYS - 1))
      const before = this.loadDb()
      const isFirstImport = Object.keys(before.stepRecords).length === 0
      // 初回だけは月間歩数を表示できるよう月初から取り込む（コインは直近 7 日分のみ）
      const from = isFirstImport && startOfMonth(today) < windowStart ? startOfMonth(today) : windowStart
      const provider = this.stepProvider()
      const fetched = await provider.getDailySteps(from, today)

      // ここから保存までは await を挟まない。同時に呼ばれても読み込み〜保存が割り込まれず、二重付与しない
      const db = this.loadDb()
      const syncedAt = now.toISOString()
      const { awardedPoints, syncedDays } = this.applySteps(db, fetched, { from, today, windowStart }, provider.source, syncedAt)
      // 効果検証の「利用日数」として、同期した日を記録する
      if (!db.activeDates.includes(today)) db.activeDates = [...db.activeDates, today].slice(-MAX_ACTIVE_DATES)
      this.commit(db, awardedPoints > 0)
      return { source: provider.source, syncedDays, awardedPoints, syncedAt }
    })
  }

  // ---- ガチャ ----

  drawGacha(): Promise<GachaDrawResult> {
    return this.simulateNetwork(() => {
      // 読み込みから保存まで await を挟まないので、連打しても残高の確認と消費が割り込まれない
      const db = this.loadDb()
      const short = pointsShortForGacha(db.balance)
      if (short > 0) {
        throw new ApiError(`コインが足りません。あと ${short} コインでガチャを引けます。`, { code: 'insufficient_points' })
      }

      const { itemId, rarity } = drawItem(NORMAL_GACHA_CANDIDATES, NORMAL_GACHA_RATES, this.random)
      const createdAt = this.now().toISOString()
      const drawId = crypto.randomUUID()
      const isDuplicate = Boolean(db.inventory[itemId])
      const refund = isDuplicate ? GACHA_DUPLICATE_COINS[rarity] : 0

      addTransaction(db, -GACHA_COST, 'gacha_draw', createdAt, drawId)
      if (isDuplicate) {
        // 重複は所持せず、レア度に応じたコインに変換する
        if (refund > 0) addTransaction(db, refund, 'gacha_refund', createdAt, drawId)
      } else {
        db.inventory[itemId] = { acquiredAt: createdAt }
      }
      // コイン消費・アイテム追加・変換を 1 回の書き込みで保存する（失敗したらどれも反映されない）
      const balance = this.commit(db, true)
      return { itemId, isDuplicate, cost: GACHA_COST, refund, balance: balance.balance }
    })
  }

  // ---- 着せ替え ----

  equipItem(slot: EquipSlot, itemId: string | null): Promise<Character> {
    return this.simulateNetwork(() => {
      if (!EQUIP_SLOTS.includes(slot)) throw new ApiError('装備する場所が正しくありません。', { code: 'invalid_slot' })
      const db = this.loadDb()
      if (itemId === null) {
        delete db.character.equipped[slot]
      } else {
        const item = ITEMS.get(itemId)
        if (!item || !db.inventory[itemId]) {
          throw new ApiError('まだ持っていないアイテムは装備できません。', { code: 'item_not_owned' })
        }
        if (item.category !== slot) {
          throw new ApiError('このアイテムは、ここには装備できません。', { code: 'invalid_slot' })
        }
        db.character.equipped[slot] = itemId
      }
      this.saveDb(db)
      return db.character
    })
  }

  // ---- プロフィール・キャラクター ----

  getSession(): Promise<SessionData> {
    return this.simulateNetwork(() => this.sessionOf(this.loadDb()))
  }

  completeOnboarding(input: OnboardingInput): Promise<SessionData> {
    return this.simulateNetwork(() => {
      // 画面の入力欄と同じ順に確認する
      const characterName = validateName(input.characterName, 'キャラクターの名前')
      const username = validateName(input.username, 'ユーザー名')
      const appearance = validateAppearance(input.appearance)
      if (Object.keys(appearance).length !== 4) throw invalid('見た目をすべて選んでください。')
      if (!(STARTER_TOP_IDS as readonly string[]).includes(input.topItemId)) throw invalid('選べない服が指定されました。')
      if (!(STARTER_BOTTOM_IDS as readonly string[]).includes(input.bottomItemId)) throw invalid('選べない服が指定されました。')

      const db = this.loadDb()
      if (db.profile.onboarded) throw invalid('キャラクターはすでに作成済みです。')
      const acquiredAt = this.now().toISOString()
      for (const itemId of [input.topItemId, input.bottomItemId]) db.inventory[itemId] ??= { acquiredAt }
      db.character = {
        name: characterName,
        appearance: appearance as Appearance,
        equipped: { ...STARTER_EQUIPMENT, top: input.topItemId, bottom: input.bottomItemId },
      }
      db.profile = { ...db.profile, username, onboarded: true }
      this.saveDb(db)
      return this.sessionOf(db)
    })
  }

  updateProfile(patch: ProfilePatch): Promise<SessionData> {
    return this.simulateNetwork(() => {
      const db = this.loadDb()
      const next = { ...db.profile }
      if (patch.username !== undefined) next.username = validateName(patch.username, 'ユーザー名')
      if (patch.dailyGoal !== undefined) {
        if (!Number.isInteger(patch.dailyGoal) || patch.dailyGoal < MIN_DAILY_GOAL || patch.dailyGoal > MAX_DAILY_GOAL) {
          throw invalid(
            `目標は${MIN_DAILY_GOAL.toLocaleString('ja-JP')}〜${MAX_DAILY_GOAL.toLocaleString('ja-JP')}歩の範囲で設定してください。`,
          )
        }
        next.dailyGoal = patch.dailyGoal
      }
      if (patch.ehimeRankingOptIn !== undefined) next.ehimeRankingOptIn = patch.ehimeRankingOptIn === true
      if (patch.reduceGachaEffects !== undefined) next.reduceGachaEffects = patch.reduceGachaEffects === true
      if (patch.titleId !== undefined) {
        const title = titlesOf(db, toJstDateKey(this.now())).find((t) => t.titleId === patch.titleId)
        if (!title?.unlocked) throw invalid('まだ獲得していない称号です。')
        next.titleId = title.titleId
        next.title = title.name
      }
      db.profile = next
      this.saveDb(db)
      return this.sessionOf(db)
    })
  }

  updateCharacter(patch: CharacterPatch): Promise<Character> {
    return this.simulateNetwork(() => {
      const db = this.loadDb()
      if (patch.name !== undefined) db.character.name = validateName(patch.name, 'キャラクターの名前')
      if (patch.appearance) db.character.appearance = { ...db.character.appearance, ...validateAppearance(patch.appearance) }
      this.saveDb(db)
      return db.character
    })
  }

  // ---- ログインボーナス ----

  claimLoginBonus(): Promise<LoginBonusResult> {
    return this.simulateNetwork(() => {
      // 読み込みから保存まで await を挟まないので、連打しても 2 回付与されない
      const db = this.loadDb()
      const now = this.now()
      const today = toJstDateKey(now)
      if (loginBonusClaimed(db, today)) return { granted: false, amount: 0, balance: this.toBalance(db) }
      addTransaction(db, LOGIN_BONUS_POINTS, 'login_bonus', now.toISOString(), today)
      return { granted: true, amount: LOGIN_BONUS_POINTS, balance: this.commit(db, true) }
    })
  }

  // ---- ランキング ----

  getRanking(scope: RankingScope): Promise<RankingResult> {
    return this.simulateNetwork(() => {
      if (!RANKING_SCOPES.includes(scope)) throw invalid('ランキングの種類が正しくありません。')
      const db = this.loadDb()
      if (this.settleSampleRequests(db)) this.saveDb(db)
      const today = toJstDateKey(this.now())
      const weekStart = startOfWeek(today)
      const daysElapsed = ((dayOfWeek(today) + 6) % 7) + 1

      const users = SAMPLE_USERS.filter((user) =>
        scope === 'ehime' ? user.ehimeOptIn : scope === 'friends' ? db.friendships[user.userId]?.status === 'accepted' : true,
      )
      const weekRecords = Object.values(db.stepRecords).filter((r) => r.date >= weekStart && r.date <= today)
      const myWeeklySteps = weekRecords.reduce((sum, r) => sum + r.steps, 0)
      // 正式ランキングには信頼済みの歩数だけを使う（デモ歩数は入れない）
      const trusted = weekRecords.length > 0 && weekRecords.every((r) => r.verification === 'trusted')
      const hasDemo = weekRecords.some((r) => r.source === 'demo' || (r.demoAddedSteps ?? 0) > 0)
      const optedOut = scope === 'ehime' && !db.profile.ehimeRankingOptIn

      const rows: Omit<RankingEntry, 'rank'>[] = users.map((user) => ({
        userId: user.userId,
        username: user.username,
        character: user.character,
        weeklySteps: sampleWeeklySteps(user.userId, weekStart, daysElapsed),
        title: user.titleName,
        isMe: false,
        isSample: true,
      }))
      if (trusted && !optedOut) {
        rows.push({
          userId: db.profile.userId,
          username: db.profile.username,
          character: db.character,
          weeklySteps: myWeeklySteps,
          title: db.profile.title,
          isMe: true,
          isSample: false,
        })
      }

      return {
        scope,
        weekStart,
        entries: assignRanks(rows).slice(0, 50),
        me: {
          weeklySteps: myWeeklySteps,
          eligible: trusted && !optedOut,
          referenceRank: 1 + rows.filter((row) => !row.isMe && row.weeklySteps > myWeeklySteps).length,
          excludedReason: optedOut ? 'not_opted_in' : trusted ? undefined : hasDemo ? 'demo_data' : 'unverified',
        },
      }
    })
  }

  sendCheer(friendUserId: string, reaction: CheerReaction): Promise<void> {
    return this.simulateNetwork(() => {
      const db = this.loadDb()
      if (db.friendships[friendUserId]?.status !== 'accepted') throw new ApiError('フレンドが見つかりません。', { code: 'not_found' })
      // 応援は定型のものだけ（自由文による嫌がらせを防ぐ）
      if (!CHEER_REACTIONS.includes(reaction)) throw invalid('送れない応援です。')
      db.cheers[friendUserId] = (db.cheers[friendUserId] ?? 0) + 1
      this.saveDb(db)
    })
  }

  // ---- フレンド ----

  /**
   * モックだけ：サンプルユーザーに送った申請は、少し時間がたつと承認されたことにする。
   * 実際のサーバーでは、相手が承認したときに状態が変わる。変更があれば true
   */
  private settleSampleRequests(db: MockDb): boolean {
    const now = this.now().getTime()
    let changed = false
    for (const [userId, friendship] of Object.entries(db.friendships)) {
      if (friendship.status !== 'pending_sent') continue
      const sentAt = Date.parse(friendship.since)
      if (Number.isFinite(sentAt) && now - sentAt >= SAMPLE_ACCEPT_DELAY_MS) {
        db.friendships[userId] = { status: 'accepted', since: new Date(now).toISOString() }
        changed = true
      }
    }
    return changed
  }

  private relationOf(db: MockDb, userId: string): FriendRelation {
    if (userId === db.profile.userId) return 'self'
    const status = db.friendships[userId]?.status
    return status === 'accepted' ? 'friend' : (status ?? 'none')
  }

  private toFriendsData(db: MockDb): FriendsData {
    const today = toJstDateKey(this.now())
    const weekStart = startOfWeek(today)
    const daysElapsed = ((dayOfWeek(today) + 6) % 7) + 1
    const entry = (user: SampleUser, friendship: Friendship): FriendEntry => {
      const relation = this.relationOf(db, user.userId)
      return {
        userId: user.userId,
        username: user.username,
        character: user.character,
        title: user.titleName,
        // 歩数はフレンドにだけ見せる
        weeklySteps: relation === 'friend' ? sampleWeeklySteps(user.userId, weekStart, daysElapsed) : null,
        relation,
        since: friendship.since,
        cheersSent: db.cheers[user.userId] ?? 0,
        isSample: true,
      }
    }
    const listOf = (status: Friendship['status']) =>
      SAMPLE_USERS.flatMap((user) => {
        const friendship = db.friendships[user.userId]
        return friendship?.status === status ? [entry(user, friendship)] : []
      }).sort((a, b) => b.since.localeCompare(a.since))
    return {
      myFriendCode: db.profile.friendCode,
      friends: listOf('accepted').sort((a, b) => (b.weeklySteps ?? 0) - (a.weeklySteps ?? 0)),
      incoming: listOf('pending_received'),
      outgoing: listOf('pending_sent'),
      limit: MAX_FRIENDS,
      // 試しに申請できるよう、まだ関係の無いサンプルユーザーのコードを 3 人分出す
      sampleCodes: SAMPLE_USERS.filter((user) => !db.friendships[user.userId])
        .slice(0, 3)
        .map((user) => ({ username: user.username, friendCode: user.friendCode })),
    }
  }

  getFriends(): Promise<FriendsData> {
    return this.simulateNetwork(() => {
      const db = this.loadDb()
      if (this.settleSampleRequests(db)) this.saveDb(db)
      return this.toFriendsData(db)
    })
  }

  findUserByFriendCode(friendCode: string): Promise<FriendCandidate | null> {
    return this.simulateNetwork(() => {
      const code = normalizeFriendCode(isString(friendCode) ? friendCode : '')
      if (!FRIEND_CODE_PATTERN.test(code)) throw invalid('フレンドコードは英数字8文字で入力してください。')
      const db = this.loadDb()
      if (this.settleSampleRequests(db)) this.saveDb(db)
      if (code === db.profile.friendCode) {
        return { userId: db.profile.userId, username: db.profile.username, character: db.character, title: db.profile.title, relation: 'self' }
      }
      const user = SAMPLE_USERS.find((u) => u.friendCode === code)
      if (!user) return null
      // 見つかった相手には、名前・見た目・称号だけを見せる（歩数・位置情報は見せない）
      return { userId: user.userId, username: user.username, character: user.character, title: user.titleName, relation: this.relationOf(db, user.userId) }
    })
  }

  sendFriendRequest(friendCode: string): Promise<FriendsData> {
    return this.simulateNetwork(() => {
      const code = normalizeFriendCode(isString(friendCode) ? friendCode : '')
      if (!FRIEND_CODE_PATTERN.test(code)) throw invalid('フレンドコードは英数字8文字で入力してください。')
      const db = this.loadDb()
      if (code === db.profile.friendCode) throw invalid('自分のフレンドコードです。')
      const user = SAMPLE_USERS.find((u) => u.friendCode === code)
      if (!user) throw new ApiError('このフレンドコードのユーザーは見つかりませんでした。', { code: 'not_found' })
      const current = db.friendships[user.userId]
      const now = this.now().toISOString()
      if (current?.status === 'accepted') throw invalid('すでにフレンドです。')
      if (current?.status === 'pending_received') {
        // 相手からも申請が届いていれば、そのままフレンドになる
        db.friendships[user.userId] = { status: 'accepted', since: now }
      } else if (!current) {
        const count = Object.values(db.friendships).filter((f) => f.status !== 'pending_received').length
        if (count >= MAX_FRIENDS) throw invalid(`フレンドと申請中の人数は${MAX_FRIENDS}人までです。`)
        db.friendships[user.userId] = { status: 'pending_sent', since: now }
      }
      this.saveDb(db)
      return this.toFriendsData(db)
    })
  }

  respondFriendRequest(userId: string, accept: boolean): Promise<FriendsData> {
    return this.simulateNetwork(() => {
      const db = this.loadDb()
      if (db.friendships[userId]?.status !== 'pending_received') throw new ApiError('この申請は見つかりませんでした。', { code: 'not_found' })
      if (accept) {
        const friends = Object.values(db.friendships).filter((f) => f.status === 'accepted').length
        if (friends >= MAX_FRIENDS) throw invalid(`フレンドは${MAX_FRIENDS}人までです。`)
        db.friendships[userId] = { status: 'accepted', since: this.now().toISOString() }
      } else {
        delete db.friendships[userId]
      }
      this.saveDb(db)
      return this.toFriendsData(db)
    })
  }

  removeFriend(userId: string): Promise<FriendsData> {
    return this.simulateNetwork(() => {
      const db = this.loadDb()
      const status = db.friendships[userId]?.status
      if (status !== 'accepted' && status !== 'pending_sent') throw new ApiError('フレンドが見つかりません。', { code: 'not_found' })
      delete db.friendships[userId]
      delete db.cheers[userId]
      this.saveDb(db)
      return this.toFriendsData(db)
    })
  }

  // ---- 観光 ----

  getVisits(): Promise<Visit[]> {
    return this.simulateNetwork(() => Object.values(this.loadDb().visits))
  }

  checkIn(request: CheckInRequest): Promise<CheckInResult> {
    return this.simulateNetwork(() => {
      const spot = getSpot(request.spotId)
      if (!spot) throw new ApiError('スポットが見つかりません。', { code: 'not_found' })

      // デモ用チェックインはモックだけで使える。現地確認していない訪問として記録する
      const position = request.demoLocation
        ? { latitude: spot.latitude, longitude: spot.longitude, accuracyM: 10 }
        : { latitude: request.latitude, longitude: request.longitude, accuracyM: request.accuracyM }
      if (!isValidLatLng(position)) throw invalid('位置情報が正しくありません。')

      // 生の座標は判定にだけ使い、保存しない
      const judgement = judgeCheckIn(spot, position)
      if (judgement.status !== 'success') return judgement

      const db = this.loadDb()
      const existing = db.visits[spot.spotId]
      if (existing) {
        return { status: 'success', distanceM: judgement.distanceM, visit: existing, rewardItemId: null, firstVisit: false }
      }
      // AI 経由かどうかは、サーバーが提案したクエストに含まれるスポットかで判定する（クライアントの申告を信用しない）
      const quest = request.questId ? db.quests[request.questId] : undefined
      const viaQuest = request.via === 'ai_quest' && quest?.spotIds.includes(spot.spotId) === true
      const visitedAt = this.now().toISOString()
      const visit: Visit = {
        spotId: spot.spotId,
        visitedAt,
        via: viaQuest ? 'ai_quest' : 'list',
        ...(viaQuest && quest ? { questId: quest.questId } : {}),
        verified: !request.demoLocation,
      }
      db.visits[spot.spotId] = visit
      // 限定アイテムは初回の訪問でだけ付与する
      db.inventory[spot.rewardItemId] ??= { acquiredAt: visitedAt }
      this.saveDb(db)
      return { status: 'success', distanceM: judgement.distanceM, visit, rewardItemId: spot.rewardItemId, firstVisit: true }
    })
  }

  getSpotGuide(spotId: string): Promise<SpotGuide> {
    return this.simulateNetwork(() => {
      const spot = getSpot(spotId)
      if (!spot) throw new ApiError('スポットが見つかりません。', { code: 'not_found' })
      const nearby = spot.nearbySpotIds.map((id) => getSpot(id)?.name).filter(Boolean)
      return {
        spotId,
        // 登録情報をそのまま使い、無い項目は null（画面では「登録情報がありません」と表示し、推測で埋めない）
        sections: [
          { heading: 'どんなところ？', body: spot.description },
          { heading: '歴史', body: spot.guide.history ?? null },
          { heading: '文化・見どころ', body: spot.guide.culture ?? null },
          { heading: '特産品', body: spot.guide.specialties ?? null },
          { heading: '周辺のスポット', body: nearby.length > 0 ? `${nearby.join('、')}（登録スポット）` : null },
        ],
        sources: spot.sources,
        generatedBy: 'mock',
      }
    })
  }

  // ---- AI（モック） ----

  generateQuest(request: QuestRequest): Promise<QuestGenerationResult> {
    return this.simulateNetwork(() => {
      if (!Number.isInteger(request.minutes) || request.minutes < 15 || request.minutes > 120) {
        throw invalid('散策時間は15〜120分で指定してください。')
      }
      if (!WALKING_LOADS.includes(request.load)) throw invalid('歩くペースが正しくありません。')
      const interests = (Array.isArray(request.interests) ? request.interests : []).filter((tag) => QUEST_INTERESTS.includes(tag))

      let start: { latitude: number; longitude: number }
      let startLabel: string
      let startSpotId: string | undefined
      let origin: { latitude: number; longitude: number } | null = null
      if (request.startSpotId === 'current') {
        if (!request.currentLocation || !isValidLatLng(request.currentLocation)) {
          throw invalid('現在地を取得できませんでした。出発地点をスポットから選んでください。')
        }
        start = { latitude: request.currentLocation.latitude, longitude: request.currentLocation.longitude }
        origin = start
        startLabel = '現在地'
      } else {
        const spot = getSpot(request.startSpotId)
        if (!spot) throw new ApiError('出発地点が見つかりません。', { code: 'not_found' })
        start = spot
        startSpotId = spot.spotId
        startLabel = `${spot.name}周辺`
      }

      const db = this.loadDb()
      const now = this.now()
      const today = toJstDateKey(now)
      const used = db.aiQuota.date === today ? db.aiQuota.count : 0
      if (used >= AI_QUEST_DAILY_LIMIT) return { status: 'quota_exceeded', remainingToday: 0 }
      db.aiQuota = { date: today, count: used + 1 }
      const remainingToday = AI_QUEST_DAILY_LIMIT - used - 1

      // 訪問先は登録スポットからだけ選ぶ。距離は直線距離 × 迂回係数の目安
      const plan = planQuest({
        start,
        startSpotId,
        minutes: request.minutes,
        interests,
        load: request.load,
        visitedSpotIds: Object.keys(db.visits),
        spots: SPOTS,
      })
      if (plan.spots.length === 0) {
        this.saveDb(db)
        const nearest = plan.nearest
          ? { spotId: plan.nearest.spot.spotId, name: plan.nearest.spot.name, distanceM: plan.nearest.distanceM }
          : null
        return { status: 'no_spots', nearest, remainingToday }
      }

      const quest = toSuggestion(plan, {
        questId: crypto.randomUUID(),
        startLabel,
        origin,
        interests,
        minutes: request.minutes,
        load: request.load,
      })
      rememberQuest(db, quest)
      db.questLog = [...db.questLog, { questId: quest.questId, createdAt: now.toISOString(), spotIds: plan.spots.map((s) => s.spotId) }].slice(
        -MAX_QUEST_LOG,
      )
      this.saveDb(db)
      return { status: 'ok', quest, remainingToday }
    })
  }

  // ---- みんな共通のクエスト ----

  /** クエストの期間を表すキー（毎日なら日付、毎週なら週の月曜、1 回だけなら once） */
  private questPeriodKey(quest: CommonQuest, today: DateKey): string {
    return quest.period === 'daily' ? today : quest.period === 'weekly' ? startOfWeek(today) : 'once'
  }

  private commonQuestStatuses(db: MockDb): CommonQuestStatus[] {
    const today = toJstDateKey(this.now())
    const weekStart = startOfWeek(today)
    const daysElapsed = ((dayOfWeek(today) + 6) % 7) + 1
    const todaySteps = db.stepRecords[today]?.steps ?? 0
    const weekSteps = Object.values(db.stepRecords)
      .filter((r) => r.date >= weekStart && r.date <= today)
      .reduce((sum, r) => sum + r.steps, 0)

    return COMMON_QUESTS.map((quest) => {
      const claimed = Boolean(db.questClaims[questClaimKey(quest, this.questPeriodKey(quest, today))])
      const resetsOn = quest.period === 'daily' ? addDays(today, 1) : quest.period === 'weekly' ? addDays(weekStart, 7) : undefined
      switch (quest.kind) {
        case 'daily_steps':
          return { quest, progress: todaySteps, completed: todaySteps >= quest.target, claimed, resetsOn }
        case 'weekly_steps':
          return { quest, progress: weekSteps, completed: weekSteps >= quest.target, claimed, resetsOn }
        case 'community_steps': {
          // モック：参加者は自分とサンプルユーザー。実際のサーバーでは参加者全員の集計値を返す
          const others = SAMPLE_USERS.reduce((sum, user) => sum + sampleWeeklySteps(user.userId, weekStart, daysElapsed), 0)
          const total = others + weekSteps
          const enough = weekSteps >= (quest.minContribution ?? 0)
          return {
            quest,
            progress: total,
            completed: total >= quest.target && enough,
            claimed,
            myContribution: weekSteps,
            participants: SAMPLE_USERS.length + 1,
            resetsOn,
          }
        }
        case 'visit_spots': {
          const visitedSpotIds = (quest.spotIds ?? []).filter((id) => db.visits[id])
          return { quest, progress: visitedSpotIds.length, completed: visitedSpotIds.length >= quest.target, claimed, visitedSpotIds }
        }
      }
    })
  }

  getCommonQuests(): Promise<CommonQuestStatus[]> {
    return this.simulateNetwork(() => this.commonQuestStatuses(this.loadDb()))
  }

  claimCommonQuest(questId: string): Promise<QuestClaimResult> {
    return this.simulateNetwork(() => {
      const quest = getCommonQuest(questId)
      if (!quest) throw new ApiError('クエストが見つかりません。', { code: 'not_found' })
      // 読み込みから保存まで await を挟まないので、連打しても 2 回受け取れない
      const db = this.loadDb()
      const status = this.commonQuestStatuses(db).find((s) => s.quest.questId === questId)
      if (!status?.completed) throw invalid('まだクエストを達成していません。')
      if (status.claimed) throw invalid('この報酬はもう受け取りました。')
      const now = this.now()
      const key = questClaimKey(quest, this.questPeriodKey(quest, toJstDateKey(now)))
      db.questClaims[key] = now.toISOString()
      addTransaction(db, quest.rewardCoins, 'quest_reward', now.toISOString(), key)
      const balance = this.commit(db, true)
      return { reward: quest.rewardCoins, balance, quests: this.commonQuestStatuses(db) }
    })
  }

  getWeeklyMission(): Promise<WeeklyMission> {
    return this.simulateNetwork(() => {
      const db = this.loadDb()
      const today = toJstDateKey(this.now())
      const { average7Days } = summarizeSteps(Object.values(db.stepRecords), today, db.profile.dailyGoal)
      // 目標値は規則で決める（AI に任せない）。極端に高い目標は出さない
      return { ...proposeWeeklyGoal(average7Days), average7Days, currentGoal: db.profile.dailyGoal, generatedBy: 'mock' }
    })
  }

  getActivitySummary(): Promise<ActivitySummary> {
    return this.simulateNetwork(() => {
      const db = this.loadDb()
      const records = Object.values(db.stepRecords)
      const visits = Object.values(db.visits)
      return {
        activeDays: db.activeDates.length,
        goalAchievedDays: records.filter((r) => r.steps >= db.profile.dailyGoal).length,
        recordedDays: records.length,
        questGenerations: db.questLog.length,
        visitsViaQuest: visits.filter((v) => v.via === 'ai_quest').length,
        visitsViaList: visits.filter((v) => v.via === 'list').length,
        gachaDraws: gachaDrawCount(db),
      }
    })
  }

  deleteAllData(): Promise<void> {
    return this.simulateNetwork(() => {
      try {
        this.storage.removeItem(STORAGE_KEY)
        this.storage.removeItem(BROKEN_STORAGE_KEY)
        // センサーで数えた歩数も消す（次は 0 歩から）
        this.stepProvider().clear?.()
      } catch (error) {
        throw new ApiError('データを削除できませんでした。もう一度お試しください。', { cause: error, code: 'storage_failed' })
      }
    })
  }

  // ---- デモ操作（開発モードのみ） ----

  private createDemoTools(): DemoTools {
    return {
      addCoins: (amount: DemoCoinAmount) =>
        this.simulateNetwork(() => {
          if (!DEMO_COIN_AMOUNTS.includes(amount)) throw new ApiError('追加できるコインの数ではありません。', { code: 'demo_unavailable' })
          const db = this.loadDb()
          const createdAt = this.now().toISOString()
          addTransaction(db, amount, 'demo_grant', createdAt)
          addDemoHistory(db, { kind: 'coins', amount, awardedCoins: amount, createdAt })
          return this.commit(db, true)
        }),

      addSteps: (steps: DemoStepAmount) =>
        this.simulateNetwork(async () => {
          if (!DEMO_STEP_AMOUNTS.includes(steps)) throw new ApiError('追加できる歩数ではありません。', { code: 'demo_unavailable' })
          const now = this.now()
          const today = toJstDateKey(now)
          const provider = this.stepProvider()
          // 実際の歩数（HealthKit など）にはデモの歩数を混ぜない
          if (!DEMO_BOOSTABLE_SOURCES.includes(provider.source)) {
            throw new ApiError('実際の歩数データには、デモの歩数を追加できません。', { code: 'demo_unavailable' })
          }
          const fetched = await provider.getDailySteps(today, today)

          // 読み込みから保存までは await を挟まない（同期と同じ規則で、差分だけコインを付与する）
          const db = this.loadDb()
          const createdAt = now.toISOString()
          db.demoStepBoosts[today] = Math.min(MAX_ACCEPTED_DAILY_STEPS, (db.demoStepBoosts[today] ?? 0) + steps)
          const { awardedPoints } = this.applySteps(db, fetched, { from: today, today, windowStart: today }, provider.source, createdAt)
          addDemoHistory(db, { kind: 'steps', amount: steps, awardedCoins: awardedPoints, createdAt })
          const balance = this.commit(db, true)
          return { todaySteps: db.stepRecords[today]?.steps ?? 0, awardedPoints, balance }
        }),

      getHistory: (limit = 10) => this.simulateNetwork(() => this.loadDb().demoHistory.slice(0, limit)),

      prepareShowcase: () =>
        this.simulateNetwork(() => {
          const provider = this.stepProvider()
          if (!DEMO_BOOSTABLE_SOURCES.includes(provider.source)) {
            throw new ApiError('実際の歩数データがある環境では、デモ用データを作れません。', { code: 'demo_unavailable' })
          }
          const now = this.now()
          const createdAt = now.toISOString()
          const today = toJstDateKey(now)
          const windowStart = addDays(today, -(SYNC_WINDOW_DAYS - 1))
          // いまのデータは消して、作り直す（センサーの歩数も消す）
          provider.clear?.()
          const db = createInitialDb(now)
          db.profile = { ...db.profile, username: SHOWCASE.username, onboarded: true }
          db.character = {
            name: SHOWCASE.characterName,
            appearance: { ...SHOWCASE.appearance },
            equipped: { ...STARTER_EQUIPMENT, ...SHOWCASE.equipped },
          }
          for (const itemId of SHOWCASE.items) db.inventory[itemId] = { acquiredAt: createdAt }
          // 過去 7 日分の歩数は「デモ操作で追加した歩数」として入れる（正式ランキングには入らない）
          dateRange(windowStart, today).forEach((date, i) => {
            db.demoStepBoosts[date] = SHOWCASE.steps[i % SHOWCASE.steps.length]
          })
          const { awardedPoints } = this.applySteps(db, [], { from: windowStart, today, windowStart }, provider.source, createdAt)
          addTransaction(db, SHOWCASE.coins, 'demo_grant', createdAt)
          addDemoHistory(db, { kind: 'coins', amount: SHOWCASE.coins, awardedCoins: SHOWCASE.coins, createdAt })
          addDemoHistory(db, {
            kind: 'steps',
            amount: SHOWCASE.steps.reduce((sum, s) => sum + s, 0),
            awardedCoins: awardedPoints,
            createdAt,
          })
          db.visits[SHOWCASE.visitedSpotId] = {
            spotId: SHOWCASE.visitedSpotId,
            visitedAt: addDays(today, -2) + 'T01:00:00.000Z',
            via: 'list',
            verified: false,
          }
          db.inventory[getSpot(SHOWCASE.visitedSpotId)!.rewardItemId] = { acquiredAt: createdAt }
          db.activeDates = dateRange(windowStart, today)
          // フレンド 3 人と、届いている申請 1 件
          db.friendships = {
            ...Object.fromEntries(SHOWCASE.friendIds.map((id) => [id, { status: 'accepted' as const, since: createdAt }])),
            [SHOWCASE.incomingFriendId]: { status: 'pending_received', since: createdAt },
          }
          this.commit(db, true)
        }),
    }
  }
}

/** 発表用のデモ用データ（途中まで遊んだ状態）。歩数は過去 7 日分（古い順） */
const SHOWCASE = {
  username: 'デモユーザー',
  characterName: 'ミカン',
  appearance: { hairStyle: 'bob', hairColor: 'mikan', skinTone: 'light', eyeColor: 'brown' } satisfies Appearance,
  equipped: { head: 'head_mikan_hat', pet: 'pet_koromikan', bottom: 'bottom_seto_skirt' } satisfies Partial<Record<EquipSlot, string>>,
  items: ['head_mikan_hat', 'pet_koromikan', 'bottom_seto_skirt', 'top_traveler', 'accessory_mikan_pendant', 'bg_mikan_field'],
  steps: [5200, 7400, 6100, 9300, 4800, 8200, 3500],
  coins: 300,
  visitedSpotId: 'dogo_onsen_honkan',
  friendIds: ['sample-2', 'sample-6', 'sample-9'],
  incomingFriendId: 'sample-1',
} as const
