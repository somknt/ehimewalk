// モックサーバーの保存データ（localStorage）。形が変わったときは migrate で古いデータを移行する。
import { STARTER_EQUIPMENT } from '../../data/items'
import { EHIME_PREFECTURE_CODE } from '../../data/spots'
import { DEFAULT_DAILY_GOAL } from '../../domain/steps'
import { DEFAULT_TITLE_ID } from '../../domain/titles'
import type {
  Character,
  DateKey,
  InventoryEntry,
  PointTransaction,
  StepRecord,
  UserProfile,
  Visit,
} from '../../domain/types'
import type { QuestSuggestion } from '../types'

export const STORAGE_KEY = 'ewq.mock.v1'

export interface MockDb {
  version: 2
  profile: UserProfile
  character: Character
  stepRecords: Record<DateKey, StepRecord>
  /** 日付ごとの付与済み歩数ポイント（二重付与の防止に使う） */
  stepAwards: Record<DateKey, number>
  loginBonusDates: DateKey[]
  transactions: PointTransaction[]
  balance: number
  inventory: Record<string, InventoryEntry>
  visits: Record<string, Visit>
  gachaDraws: number
  /** AI クエストの生成記録（効果検証用） */
  questLog: { questId: string; createdAt: string; spotIds: string[] }[]
  aiQuota: { date: DateKey; count: number }
  /** 直近に提案したクエスト（チェックインを AI 経由と判定するため） */
  quests: Record<string, Pick<QuestSuggestion, 'questId' | 'title'> & { spotIds: string[] }>
  cheers: Record<string, number>
  /** アプリを利用した日（効果検証の「利用日数」） */
  activeDates: DateKey[]
}

const FRIEND_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generateFriendCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (b) => FRIEND_CODE_CHARS[b % FRIEND_CODE_CHARS.length]).join('')
}

export function createInitialDb(): MockDb {
  const now = new Date().toISOString()
  return {
    version: 2,
    profile: {
      userId: crypto.randomUUID(),
      username: 'ぼうけんしゃ',
      friendCode: generateFriendCode(),
      selectedRegion: EHIME_PREFECTURE_CODE,
      ehimeRankingOptIn: true,
      titleId: DEFAULT_TITLE_ID,
      dailyGoal: DEFAULT_DAILY_GOAL,
      onboarded: false,
      reduceGachaEffects: false,
      createdAt: now,
    },
    character: {
      name: 'ミカ',
      appearance: { hairStyle: 'short', hairColor: 'brown', skinTone: 'light', eyeColor: 'brown' },
      equipped: { ...STARTER_EQUIPMENT },
    },
    stepRecords: {},
    stepAwards: {},
    loginBonusDates: [],
    transactions: [],
    balance: 0,
    inventory: Object.fromEntries(
      Object.values(STARTER_EQUIPMENT).map((itemId) => [itemId, { itemId, quantity: 1, firstAcquiredAt: now }]),
    ),
    visits: {},
    gachaDraws: 0,
    questLog: [],
    aiQuota: { date: '', count: 0 },
    quests: {},
    cheers: {},
    activeDates: [],
  }
}

type LegacyDbV1 = Omit<MockDb, 'version' | 'inventory' | 'profile'> & {
  version: 1
  profile: Omit<UserProfile, 'titleId' | 'onboarded' | 'reduceGachaEffects'> & { title?: string }
  inventory: Record<string, number>
}

/** 古い形のデータを現在の形に移行する。判別できないデータは null */
function migrate(value: unknown): MockDb | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as { version?: number }
  if (raw.version === 2) return value as MockDb
  if (raw.version === 1) {
    const v1 = value as LegacyDbV1
    const base = createInitialDb()
    const now = new Date().toISOString()
    const { title: _legacyTitle, ...profile } = v1.profile
    return {
      ...base,
      ...v1,
      version: 2,
      // 旧版はキャラクター作成画面が無かったため、作成済みとして扱う
      profile: { ...base.profile, ...profile, titleId: DEFAULT_TITLE_ID, onboarded: true, reduceGachaEffects: false },
      inventory: Object.fromEntries(
        Object.entries(v1.inventory).map(([itemId, quantity]) => [itemId, { itemId, quantity, firstAcquiredAt: now }]),
      ),
    }
  }
  return null
}

export function loadDb(): MockDb {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const migrated = migrate(JSON.parse(raw))
      if (migrated) return migrated
    }
  } catch {
    // 壊れたデータは作り直す
  }
  const db = createInitialDb()
  saveDb(db)
  return db
}

export function saveDb(db: MockDb): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
}

export function clearDb(): void {
  localStorage.removeItem(STORAGE_KEY)
}
