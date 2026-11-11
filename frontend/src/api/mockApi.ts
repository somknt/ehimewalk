// ブラウザ内で動くモックサーバー。フェーズ2 の Lambda と同じ規則（domain/）でポイントを計算する。
// データは localStorage に保存する。URL に ?mockError を付けると通信エラーを再現できる。
import { addDays, isDateKey, startOfMonth, toJstDateKey } from '../domain/date'
import { DAILY_STEP_POINT_CAP, pointsToAward } from '../domain/points'
import { DEFAULT_DAILY_GOAL, summarizeSteps } from '../domain/steps'
import type { Character, DateKey, PointTransaction, StepRecord, UserProfile } from '../domain/types'
import { STARTER_EQUIPMENT } from '../data/items'
import { EHIME_PREFECTURE_CODE } from '../data/spots'
import { buildMockQuest } from './mockQuest'
import { DemoStepProvider } from './stepProviders/demoStepProvider'
import type { StepDataProvider } from './stepProviders/types'
import { ApiError, type GameApi, type PointBalance, type QuestSuggestion, type StepSyncResult } from './types'

const STORAGE_KEY = 'ewq.mock.v1'
/** 同期で受け付ける期間（今日を含む日数）。これより前の日付は受け付けない */
const SYNC_WINDOW_DAYS = 7
/** 入力値として受け付ける 1 日の歩数の上限（明らかな異常値を弾くため） */
const MAX_ACCEPTED_DAILY_STEPS = 100_000

interface MockDb {
  version: 1
  profile: UserProfile
  character: Character
  stepRecords: Record<DateKey, StepRecord>
  /** 日付ごとの付与済み歩数ポイント（二重付与の防止に使う） */
  stepAwards: Record<DateKey, number>
  transactions: PointTransaction[]
  balance: number
  inventory: Record<string, number>
}

const FRIEND_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generateFriendCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (b) => FRIEND_CODE_CHARS[b % FRIEND_CODE_CHARS.length]).join('')
}

function createInitialDb(): MockDb {
  const now = new Date().toISOString()
  return {
    version: 1,
    profile: {
      userId: crypto.randomUUID(),
      username: 'ぼうけんしゃ',
      friendCode: generateFriendCode(),
      selectedRegion: EHIME_PREFECTURE_CODE,
      ehimeRankingOptIn: true,
      title: 'みかん見習い',
      dailyGoal: DEFAULT_DAILY_GOAL,
      createdAt: now,
    },
    character: {
      name: 'ミカ',
      appearance: { hairStyle: 'short', hairColor: 'brown', skinTone: 'light', eyeColor: 'brown' },
      equipped: { ...STARTER_EQUIPMENT },
    },
    stepRecords: {},
    stepAwards: {},
    transactions: [],
    balance: 0,
    inventory: Object.fromEntries(Object.values(STARTER_EQUIPMENT).map((id) => [id, 1])),
  }
}

function isMockDb(value: unknown): value is MockDb {
  if (typeof value !== 'object' || value === null) return false
  const db = value as Partial<MockDb>
  return db.version === 1 && typeof db.profile === 'object' && typeof db.character === 'object'
}

function loadDb(): MockDb {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (isMockDb(parsed)) return parsed
    }
  } catch {
    // 壊れたデータは作り直す
  }
  const db = createInitialDb()
  saveDb(db)
  return db
}

function saveDb(db: MockDb): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
}

const shouldSimulateError = () =>
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('mockError')

/** 通信の遅延とエラーを再現する */
async function simulateNetwork<T>(work: () => T | Promise<T>): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 150 + Math.random() * 150))
  if (shouldSimulateError()) {
    throw new ApiError('サーバーに接続できませんでした。通信環境を確認して、もう一度お試しください。')
  }
  return work()
}

export class MockGameApi implements GameApi {
  readonly mode = 'mock' as const
  private readonly provider: StepDataProvider

  constructor(provider?: StepDataProvider) {
    this.provider = provider ?? new DemoStepProvider(loadDb().profile.userId)
  }

  getProfile(): Promise<UserProfile> {
    return simulateNetwork(() => loadDb().profile)
  }

  getCharacter(): Promise<Character> {
    return simulateNetwork(() => loadDb().character)
  }

  syncSteps(): Promise<StepSyncResult> {
    return simulateNetwork(async () => {
      const today = toJstDateKey()
      const windowStart = addDays(today, -(SYNC_WINDOW_DAYS - 1))
      const isFirstImport = Object.keys(loadDb().stepRecords).length === 0
      // 初回だけは月間歩数を表示できるよう月初から取り込む（ポイントは直近 7 日分のみ）
      const from = isFirstImport && startOfMonth(today) < windowStart ? startOfMonth(today) : windowStart
      const fetched = await this.provider.getDailySteps(from, today)

      // ここから保存までは await を挟まない。同時に呼ばれても読み込み〜保存が割り込まれず、二重付与しない
      const db = loadDb()
      const syncedAt = new Date().toISOString()
      let awardedPoints = 0
      let syncedDays = 0

      for (const { date, steps } of fetched) {
        // クライアントからの値を信用せず、サーバー側で検証する
        if (!isDateKey(date) || date > today || date < from) continue
        if (!Number.isInteger(steps) || steps < 0 || steps > MAX_ACCEPTED_DAILY_STEPS) continue

        db.stepRecords[date] = {
          date,
          steps,
          source: this.provider.source,
          syncTimestamp: syncedAt,
          // デモ歩数は正式ランキングの対象外
          verification: this.provider.source === 'demo' ? 'excluded' : 'pending',
        }
        syncedDays += 1

        if (date < windowStart) continue
        const alreadyAwarded = db.stepAwards[date] ?? 0
        const award = pointsToAward(steps, alreadyAwarded)
        if (award > 0) {
          db.stepAwards[date] = alreadyAwarded + award
          db.balance += award
          db.transactions.push({
            transactionId: crypto.randomUUID(),
            amount: award,
            reason: 'step_reward',
            refKey: date,
            createdAt: syncedAt,
          })
          awardedPoints += award
        }
      }

      saveDb(db)
      return { source: this.provider.source, syncedDays, awardedPoints, syncedAt }
    })
  }

  getStepRecords(from: DateKey, to: DateKey): Promise<StepRecord[]> {
    return simulateNetwork(() =>
      Object.values(loadDb().stepRecords)
        .filter((record) => record.date >= from && record.date <= to)
        .sort((a, b) => a.date.localeCompare(b.date)),
    )
  }

  getPointBalance(): Promise<PointBalance> {
    return simulateNetwork(() => {
      const db = loadDb()
      return {
        balance: db.balance,
        todayStepPoints: db.stepAwards[toJstDateKey()] ?? 0,
        dailyStepPointCap: DAILY_STEP_POINT_CAP,
      }
    })
  }

  getRecommendedQuest(): Promise<QuestSuggestion> {
    return simulateNetwork(() => {
      const db = loadDb()
      const today = toJstDateKey()
      const summary = summarizeSteps(Object.values(db.stepRecords), today, db.profile.dailyGoal)
      return buildMockQuest({ average7Days: summary.average7Days })
    })
  }
}
