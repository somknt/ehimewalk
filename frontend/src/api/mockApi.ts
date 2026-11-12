// ブラウザ内で動くモックサーバー。フェーズ2 の Lambda と同じ規則（domain/）でポイントを計算する。
// データは localStorage に保存する。URL に ?mockError を付けると通信エラーを再現できる。
// 保存データは読み込むたびに検証し、壊れた項目は初期値に戻す（アプリを止めない）。
import { addDays, isDateKey, startOfMonth, toJstDateKey } from '../domain/date'
import { drawItem, secureRandom, type RandomSource } from '../domain/gacha'
import { DAILY_STEP_POINT_CAP, GACHA_COST, pointsShortForGacha, pointsToAward } from '../domain/points'
import { clampDailyGoal, DEFAULT_DAILY_GOAL, summarizeSteps } from '../domain/steps'
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
} from '../domain/types'
import { GACHA_DUPLICATE_COINS, ITEMS, NORMAL_GACHA_CANDIDATES, NORMAL_GACHA_RATES, STARTER_EQUIPMENT } from '../data/items'
import { EHIME_PREFECTURE_CODE } from '../data/spots'
import { EYE_COLORS, HAIR_COLORS, HAIR_STYLES, SKIN_TONES } from '../features/character/sprites'
import { buildMockQuest } from './mockQuest'
import { DemoStepProvider } from './stepProviders/demoStepProvider'
import type { StepDataProvider } from './stepProviders/types'
import {
  ApiError,
  DEMO_COIN_AMOUNTS,
  DEMO_STEP_AMOUNTS,
  type BalanceListener,
  type DemoCoinAmount,
  type DemoHistoryEntry,
  type DemoStepAmount,
  type DemoTools,
  type GachaDrawResult,
  type GameApi,
  type InventoryItem,
  type PointBalance,
  type QuestSuggestion,
  type StepSyncResult,
} from './types'

export const STORAGE_KEY = 'ewq.mock.v1'
/** 読めなかった保存データの退避先（原因調査用。アプリでは読み込まない） */
export const BROKEN_STORAGE_KEY = 'ewq.mock.v1.broken'
const CURRENT_VERSION = 2
/** 同期で受け付ける期間（今日を含む日数）。これより前の日付は受け付けない */
const SYNC_WINDOW_DAYS = 7
/** 入力値として受け付ける 1 日の歩数の上限（明らかな異常値を弾くため） */
const MAX_ACCEPTED_DAILY_STEPS = 100_000
const MAX_CHARACTER_NAME_LENGTH = 12

const EQUIP_SLOTS: readonly EquipSlot[] = ['head', 'hair', 'top', 'bottom', 'shoes', 'accessory', 'background', 'pet']
const STEP_SOURCES: readonly StepSource[] = ['demo', 'healthkit', 'health_connect']
const VERIFICATIONS: readonly StepVerification[] = ['trusted', 'pending', 'excluded']
const POINT_REASONS: readonly PointReason[] = [
  'step_reward',
  'login_bonus',
  'gacha_draw',
  'gacha_refund',
  'demo_grant',
  'admin_adjustment',
]
/** デモ操作の履歴として残す件数 */
const MAX_DEMO_HISTORY = 200

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

const FRIEND_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

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
      title: 'みかん見習い',
      dailyGoal: DEFAULT_DAILY_GOAL,
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

function normalizeProfile(raw: unknown, fallback: UserProfile): UserProfile {
  const p = isObject(raw) ? raw : {}
  const nonEmpty = (v: unknown): v is string => isString(v) && v.length > 0
  return {
    userId: pick(p.userId, nonEmpty, fallback.userId),
    username: pick(p.username, nonEmpty, fallback.username),
    friendCode: pick(p.friendCode, nonEmpty, fallback.friendCode),
    selectedRegion: pick(p.selectedRegion, nonEmpty, fallback.selectedRegion),
    ehimeRankingOptIn: typeof p.ehimeRankingOptIn === 'boolean' ? p.ehimeRankingOptIn : fallback.ehimeRankingOptIn,
    title: pick(p.title, nonEmpty, fallback.title),
    dailyGoal: typeof p.dailyGoal === 'number' && Number.isFinite(p.dailyGoal) ? clampDailyGoal(p.dailyGoal) : fallback.dailyGoal,
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
    if (isDateKey(date) && isNonNegativeInt(value)) awards[date] = Math.min(value, DAILY_STEP_POINT_CAP)
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

/**
 * 保存データを検証し、壊れた項目は初期値に置き換えた正しい形にする。
 * 形そのものが違う（バージョンが違う・オブジェクトでない）場合は null を返す。
 */
export function normalizeDb(raw: unknown, now: Date = new Date()): MockDb | null {
  if (!isObject(raw) || (raw.version !== 1 && raw.version !== CURRENT_VERSION)) return null
  const fallback = createInitialDb(now)
  const profile = normalizeProfile(raw.profile, fallback.profile)
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
  }
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
   * デモ操作（コイン・歩数の追加）を使えるようにするか。
   * 省略時は開発モード（npm run dev）のときだけ true。本番ビルドでは常に false になる
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
    this.demo = (options.enableDemoTools ?? import.meta.env.DEV) ? this.createDemoTools() : null
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
    return {
      balance: db.balance,
      todayStepPoints: db.stepAwards[toJstDateKey(this.now())] ?? 0,
      dailyStepPointCap: DAILY_STEP_POINT_CAP,
    }
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
      const summary = summarizeSteps(Object.values(db.stepRecords), today, db.profile.dailyGoal)
      return buildMockQuest({ average7Days: summary.average7Days })
    })
  }

  // ---- 歩数とコイン ----

  private stepProvider(db: MockDb): StepDataProvider {
    // デモ歩数はユーザー ID から決まる（データを作り直すと別のユーザーとして別の歩数になる）
    return this.provider ?? new DemoStepProvider(db.profile.userId, this.now)
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
        // デモ歩数は正式ランキングの対象外
        verification: source === 'demo' ? 'excluded' : 'pending',
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
      const provider = this.stepProvider(before)
      const fetched = await provider.getDailySteps(from, today)

      // ここから保存までは await を挟まない。同時に呼ばれても読み込み〜保存が割り込まれず、二重付与しない
      const db = this.loadDb()
      const syncedAt = now.toISOString()
      const { awardedPoints, syncedDays } = this.applySteps(db, fetched, { from, today, windowStart }, provider.source, syncedAt)
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
          const provider = this.stepProvider(this.loadDb())
          // 実際の歩数（HealthKit など）にはデモの歩数を混ぜない
          if (provider.source !== 'demo') {
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
    }
  }
}
