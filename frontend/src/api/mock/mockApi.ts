// ブラウザ内で動くモックサーバー。フェーズ2 の Lambda と同じ規則（domain/）で処理する。
// クライアントからの値は信用せず、ここで検証する（Lambda に移すときもこの検証を残す）。
// URL に ?mockError を付けると通信エラーを再現できる。
import {
  ITEMS,
  NORMAL_GACHA_POOL,
  NORMAL_GACHA_RATES,
  STARTER_BOTTOM_IDS,
  STARTER_EQUIPMENT,
  STARTER_TOP_IDS,
} from '../../data/items'
import { QUEST_INTERESTS, SPOTS, getSpot } from '../../data/spots'
import { isValidLatLng, judgeCheckIn } from '../../domain/checkin'
import { addDays, dateRange, dayOfWeek, isDateKey, startOfMonth, startOfWeek, toJstDateKey } from '../../domain/date'
import { drawFromPool } from '../../domain/gacha'
import { proposeWeeklyGoal } from '../../domain/mission'
import { DAILY_STEP_POINT_CAP, GACHA_COST, pointsShortForGacha, pointsToAward } from '../../domain/points'
import { googleMapsWalkingUrl, planQuest, type QuestPlan } from '../../domain/questPlanner'
import { MAX_DAILY_GOAL, MIN_DAILY_GOAL, summarizeSteps } from '../../domain/steps'
import { evaluateTitles, titleName } from '../../domain/titles'
import type {
  Appearance,
  Character,
  DateKey,
  EquipSlot,
  PointReason,
  StepRecord,
  Visit,
  WalkingLoad,
} from '../../domain/types'
import { EYE_COLORS, HAIR_COLORS, HAIR_STYLES, SKIN_TONES } from '../../features/character/sprites'
import { DemoStepProvider } from '../stepProviders/demoStepProvider'
import type { StepDataProvider } from '../stepProviders/types'
import {
  ApiError,
  type ActivitySummary,
  type CharacterPatch,
  type CheckInRequest,
  type CheckInResult,
  type CheerReaction,
  type GachaDrawResult,
  type GameApi,
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
} from '../types'
import { clearDb, loadDb, saveDb, type MockDb } from './db'
import { SAMPLE_USERS, sampleWeeklySteps } from './sampleUsers'

/** 同期で受け付ける期間（今日を含む日数）。これより前の日付は受け付けない */
const SYNC_WINDOW_DAYS = 7
/** 入力値として受け付ける 1 日の歩数の上限（明らかな異常値を弾くため） */
const MAX_ACCEPTED_DAILY_STEPS = 100_000
export const LOGIN_BONUS_POINTS = 10
/** AI クエスト生成の 1 日の上限回数 */
export const AI_QUEST_DAILY_LIMIT = 10
const MAX_NAME_LENGTH = 12

const EQUIP_SLOTS: readonly EquipSlot[] = ['head', 'hair', 'top', 'bottom', 'shoes', 'accessory', 'background', 'pet']
const REQUIRED_SLOTS: readonly EquipSlot[] = ['top', 'bottom']
const WALKING_LOADS: readonly WalkingLoad[] = ['easy', 'normal', 'active']
const CHEER_REACTIONS: readonly CheerReaction[] = ['nice', 'fight', 'thanks']
const LOAD_LABELS: Record<WalkingLoad, string> = { easy: 'ゆったり', normal: 'ふつう', active: 'しっかり' }

const shouldSimulateError = () =>
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('mockError')

/** 通信の遅延とエラーを再現する */
async function simulateNetwork<T>(work: () => T | Promise<T>): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 120 + Math.random() * 130))
  if (shouldSimulateError()) {
    throw new ApiError('サーバーに接続できませんでした。通信環境を確認して、もう一度お試しください。')
  }
  return work()
}

/** 暗号論的乱数（0 以上 1 未満） */
function secureRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32
}

function validateName(value: unknown, label: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (trimmed.length === 0) throw new ApiError(`${label}を入力してください。`)
  if ([...trimmed].length > MAX_NAME_LENGTH) throw new ApiError(`${label}は${MAX_NAME_LENGTH}文字以内で入力してください。`)
  return trimmed
}

function validateAppearance(value: Partial<Appearance>): Partial<Appearance> {
  const checks: [keyof Appearance, Record<string, unknown>][] = [
    ['hairStyle', HAIR_STYLES],
    ['hairColor', HAIR_COLORS],
    ['skinTone', SKIN_TONES],
    ['eyeColor', EYE_COLORS],
  ]
  for (const [key, options] of checks) {
    const v = value[key]
    if (v !== undefined && !(v in options)) throw new ApiError('選べない外見が指定されました。')
  }
  return value
}

// ---------- 保存データからの計算 ----------

function balanceOf(db: MockDb): PointBalance {
  const today = toJstDateKey()
  return {
    balance: db.balance,
    todayStepPoints: db.stepAwards[today] ?? 0,
    dailyStepPointCap: DAILY_STEP_POINT_CAP,
    loginBonusClaimedToday: db.loginBonusDates.includes(today),
    loginBonusAmount: LOGIN_BONUS_POINTS,
  }
}

function goalDaysLast7(db: MockDb): number {
  const today = toJstDateKey()
  return dateRange(addDays(today, -6), today).filter(
    (date) => (db.stepRecords[date]?.steps ?? 0) >= db.profile.dailyGoal,
  ).length
}

function titlesOf(db: MockDb) {
  return evaluateTitles({
    visitedSpotCount: Object.keys(db.visits).length,
    gachaDraws: db.gachaDraws,
    goalDaysLast7: goalDaysLast7(db),
    ownedItemKinds: Object.values(db.inventory).filter((entry) => entry.quantity > 0).length,
  })
}

function sessionOf(db: MockDb): SessionData {
  return { profile: db.profile, character: db.character, balance: balanceOf(db), titles: titlesOf(db) }
}

function addPoints(db: MockDb, amount: number, reason: PointReason, refKey?: string): void {
  db.balance += amount
  db.transactions.push({
    transactionId: crypto.randomUUID(),
    amount,
    reason,
    refKey,
    createdAt: new Date().toISOString(),
  })
}

function grantItem(db: MockDb, itemId: string): { isNew: boolean; quantity: number } {
  const existing = db.inventory[itemId]
  if (existing) {
    existing.quantity += 1
    return { isNew: false, quantity: existing.quantity }
  }
  db.inventory[itemId] = { itemId, quantity: 1, firstAcquiredAt: new Date().toISOString() }
  return { isNew: true, quantity: 1 }
}

function stepSummary(db: MockDb) {
  return summarizeSteps(Object.values(db.stepRecords), toJstDateKey(), db.profile.dailyGoal)
}

/** 散策時間の初期値。普段の歩数が少ない人ほど短くする */
export function walkingBudgetMinutes(average7Days: number): number {
  if (average7Days < 4000) return 30
  if (average7Days < 8000) return 45
  return 60
}

function toSuggestion(
  plan: QuestPlan,
  options: { questId: string; startLabel: string; origin: { latitude: number; longitude: number } | null; interests: string[]; minutes: number; load: WalkingLoad; reason?: string },
): QuestSuggestion {
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
      plan.legs.length > 0 ? { basis: 'straight_line', distanceM: plan.distanceM, steps: plan.steps, minutes: plan.minutes } : null,
    mapsUrl: googleMapsWalkingUrl(options.origin, plan.spots),
    generatedBy: 'mock',
  }
}

function rememberQuest(db: MockDb, quest: QuestSuggestion): void {
  db.quests[quest.questId] = { questId: quest.questId, title: quest.title, spotIds: quest.spots.map((s) => s.spotId) }
  // 古いクエストは 30 件まで残す
  const ids = Object.keys(db.quests)
  for (const id of ids.slice(0, Math.max(0, ids.length - 30))) delete db.quests[id]
}

/** 同じ歩数なら同じ順位にする */
function assignRanks<T extends { weeklySteps: number }>(rows: T[]): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => b.weeklySteps - a.weeklySteps)
  return sorted.map((row) => ({ ...row, rank: 1 + sorted.filter((other) => other.weeklySteps > row.weeklySteps).length }))
}

export class MockGameApi implements GameApi {
  readonly mode = 'mock' as const
  private readonly provider: StepDataProvider

  constructor(provider?: StepDataProvider) {
    this.provider = provider ?? new DemoStepProvider(loadDb().profile.userId)
  }

  // ---------- プロフィール・キャラクター ----------

  getSession(): Promise<SessionData> {
    return simulateNetwork(() => sessionOf(loadDb()))
  }

  completeOnboarding(input: OnboardingInput): Promise<SessionData> {
    return simulateNetwork(() => {
      // 画面の入力欄と同じ順に確認する
      const characterName = validateName(input.characterName, 'キャラクターの名前')
      const username = validateName(input.username, 'ユーザー名')
      const appearance = validateAppearance(input.appearance) as Appearance
      if (!(STARTER_TOP_IDS as readonly string[]).includes(input.topItemId)) throw new ApiError('選べない服が指定されました。')
      if (!(STARTER_BOTTOM_IDS as readonly string[]).includes(input.bottomItemId)) throw new ApiError('選べない服が指定されました。')

      const db = loadDb()
      for (const itemId of [input.topItemId, input.bottomItemId]) {
        if (!db.inventory[itemId]) grantItem(db, itemId)
      }
      db.character = {
        name: characterName,
        appearance,
        equipped: { ...STARTER_EQUIPMENT, top: input.topItemId, bottom: input.bottomItemId },
      }
      db.profile = { ...db.profile, username, onboarded: true }
      saveDb(db)
      return sessionOf(db)
    })
  }

  updateProfile(patch: ProfilePatch): Promise<SessionData> {
    return simulateNetwork(() => {
      const db = loadDb()
      const next = { ...db.profile }
      if (patch.username !== undefined) next.username = validateName(patch.username, 'ユーザー名')
      if (patch.dailyGoal !== undefined) {
        if (!Number.isInteger(patch.dailyGoal) || patch.dailyGoal < MIN_DAILY_GOAL || patch.dailyGoal > MAX_DAILY_GOAL) {
          throw new ApiError(
            `目標は${MIN_DAILY_GOAL.toLocaleString('ja-JP')}〜${MAX_DAILY_GOAL.toLocaleString('ja-JP')}歩の範囲で設定してください。`,
          )
        }
        next.dailyGoal = patch.dailyGoal
      }
      if (patch.ehimeRankingOptIn !== undefined) next.ehimeRankingOptIn = patch.ehimeRankingOptIn === true
      if (patch.reduceGachaEffects !== undefined) next.reduceGachaEffects = patch.reduceGachaEffects === true
      if (patch.titleId !== undefined) {
        const title = titlesOf(db).find((t) => t.titleId === patch.titleId)
        if (!title?.unlocked) throw new ApiError('まだ獲得していない称号です。')
        next.titleId = patch.titleId
      }
      db.profile = next
      saveDb(db)
      return sessionOf(db)
    })
  }

  updateCharacter(patch: CharacterPatch): Promise<Character> {
    return simulateNetwork(() => {
      const db = loadDb()
      if (patch.name !== undefined) db.character.name = validateName(patch.name, 'キャラクターの名前')
      if (patch.appearance) db.character.appearance = { ...db.character.appearance, ...validateAppearance(patch.appearance) }
      saveDb(db)
      return db.character
    })
  }

  equipItem(slot: EquipSlot, itemId: string | null): Promise<Character> {
    return simulateNetwork(() => {
      if (!EQUIP_SLOTS.includes(slot) || slot === 'hair') throw new ApiError('この場所には装備できません。')
      const db = loadDb()
      if (itemId === null) {
        if (REQUIRED_SLOTS.includes(slot)) throw new ApiError('上半身と下半身は外せません。ほかの服に着替えてください。')
        delete db.character.equipped[slot]
      } else {
        const item = ITEMS.get(itemId)
        if (!item || item.category !== slot) throw new ApiError('この場所には装備できないアイテムです。')
        if ((db.inventory[itemId]?.quantity ?? 0) <= 0) throw new ApiError('持っていないアイテムは装備できません。')
        db.character.equipped[slot] = itemId
      }
      saveDb(db)
      return db.character
    })
  }

  // ---------- 歩数・ポイント ----------

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
        if (!isDateKey(date) || date > today || date < from) continue
        if (!Number.isInteger(steps) || steps < 0 || steps > MAX_ACCEPTED_DAILY_STEPS) continue

        const record: StepRecord = {
          date,
          steps,
          source: this.provider.source,
          syncTimestamp: syncedAt,
          // デモ歩数は正式ランキングの対象外
          verification: this.provider.source === 'demo' ? 'excluded' : 'pending',
        }
        db.stepRecords[date] = record
        syncedDays += 1

        if (date < windowStart) continue
        const alreadyAwarded = db.stepAwards[date] ?? 0
        const award = pointsToAward(steps, alreadyAwarded)
        if (award > 0) {
          db.stepAwards[date] = alreadyAwarded + award
          addPoints(db, award, 'step_reward', date)
          awardedPoints += award
        }
      }
      if (!db.activeDates.includes(today)) db.activeDates.push(today)

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
    return simulateNetwork(() => balanceOf(loadDb()))
  }

  claimLoginBonus(): Promise<LoginBonusResult> {
    return simulateNetwork(() => {
      const db = loadDb()
      const today = toJstDateKey()
      if (db.loginBonusDates.includes(today)) {
        return { granted: false, amount: 0, balance: balanceOf(db) }
      }
      db.loginBonusDates.push(today)
      addPoints(db, LOGIN_BONUS_POINTS, 'login_bonus', today)
      saveDb(db)
      return { granted: true, amount: LOGIN_BONUS_POINTS, balance: balanceOf(db) }
    })
  }

  // ---------- ガチャ・持ち物 ----------

  drawGacha(): Promise<GachaDrawResult> {
    return simulateNetwork(() => {
      const db = loadDb()
      const short = pointsShortForGacha(db.balance)
      if (short > 0) throw new ApiError(`ポイントが足りません。あと${short}pt必要です。`)
      // 減算・抽選・付与をまとめて行い、まとめて保存する（片方だけ成功する状態を作らない）
      const drawn = drawFromPool(NORMAL_GACHA_POOL, NORMAL_GACHA_RATES, secureRandom)
      addPoints(db, -GACHA_COST, 'gacha_draw', drawn.itemId)
      const { isNew, quantity } = grantItem(db, drawn.itemId)
      db.gachaDraws += 1
      saveDb(db)
      return { itemId: drawn.itemId, rarity: drawn.rarity, isNew, quantity, balance: balanceOf(db) }
    })
  }

  getInventory() {
    return simulateNetwork(() => Object.values(loadDb().inventory).filter((entry) => entry.quantity > 0))
  }

  // ---------- ランキング ----------

  getRanking(scope: RankingScope): Promise<RankingResult> {
    return simulateNetwork(() => {
      if (!['all', 'ehime', 'friends'].includes(scope)) throw new ApiError('ランキングの種類が正しくありません。')
      const db = loadDb()
      const today = toJstDateKey()
      const weekStart = startOfWeek(today)
      const daysElapsed = ((dayOfWeek(today) + 6) % 7) + 1

      const users = SAMPLE_USERS.filter((user) =>
        scope === 'ehime' ? user.ehimeOptIn : scope === 'friends' ? user.isFriend : true,
      )
      const weekRecords = Object.values(db.stepRecords).filter((r) => r.date >= weekStart && r.date <= today)
      const myWeeklySteps = weekRecords.reduce((sum, r) => sum + r.steps, 0)
      // 正式ランキングには信頼済みの歩数だけを使う
      const eligible = weekRecords.length > 0 && weekRecords.every((r) => r.verification === 'trusted')
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
      if (eligible && !optedOut) {
        rows.push({
          userId: db.profile.userId,
          username: db.profile.username,
          character: db.character,
          weeklySteps: myWeeklySteps,
          title: titleName(db.profile.titleId),
          isMe: true,
          isSample: false,
        })
      }

      const entries = assignRanks(rows).slice(0, 50)
      return {
        scope,
        weekStart,
        entries,
        me: {
          weeklySteps: myWeeklySteps,
          eligible: eligible && !optedOut,
          referenceRank: 1 + rows.filter((row) => !row.isMe && row.weeklySteps > myWeeklySteps).length,
          excludedReason: optedOut ? 'not_opted_in' : !eligible ? 'demo_data' : undefined,
        },
      }
    })
  }

  sendCheer(friendUserId: string, reaction: CheerReaction): Promise<void> {
    return simulateNetwork(() => {
      const friend = SAMPLE_USERS.find((user) => user.userId === friendUserId && user.isFriend)
      if (!friend) throw new ApiError('フレンドが見つかりません。')
      if (!CHEER_REACTIONS.includes(reaction)) throw new ApiError('送れない応援です。')
      const db = loadDb()
      db.cheers[friendUserId] = (db.cheers[friendUserId] ?? 0) + 1
      saveDb(db)
    })
  }

  // ---------- 観光 ----------

  getVisits(): Promise<Visit[]> {
    return simulateNetwork(() => Object.values(loadDb().visits))
  }

  checkIn(request: CheckInRequest): Promise<CheckInResult> {
    return simulateNetwork(() => {
      const spot = getSpot(request.spotId)
      if (!spot) throw new ApiError('スポットが見つかりません。')

      // デモ用チェックインはモックだけで使える。現地確認していない訪問として記録する
      const position = request.demoLocation
        ? { latitude: spot.latitude, longitude: spot.longitude, accuracyM: 10 }
        : { latitude: request.latitude, longitude: request.longitude, accuracyM: request.accuracyM }
      if (!isValidLatLng(position)) throw new ApiError('位置情報が正しくありません。')

      // 生の座標は判定にだけ使い、保存しない
      const judgement = judgeCheckIn(spot, position)
      if (judgement.status !== 'success') return judgement

      const db = loadDb()
      const existing = db.visits[spot.spotId]
      if (existing) {
        return { status: 'success', distanceM: judgement.distanceM, visit: existing, rewardItemId: null, firstVisit: false }
      }
      // AI 経由かどうかは、サーバーが提案したクエストに含まれるスポットかで判定する
      const quest = request.questId ? db.quests[request.questId] : undefined
      const viaQuest = request.via === 'ai_quest' && quest?.spotIds.includes(spot.spotId) === true
      const visit: Visit = {
        spotId: spot.spotId,
        visitedAt: new Date().toISOString(),
        via: viaQuest ? 'ai_quest' : 'list',
        questId: viaQuest ? quest?.questId : undefined,
        verified: !request.demoLocation,
      }
      db.visits[spot.spotId] = visit
      grantItem(db, spot.rewardItemId)
      saveDb(db)
      return { status: 'success', distanceM: judgement.distanceM, visit, rewardItemId: spot.rewardItemId, firstVisit: true }
    })
  }

  getSpotGuide(spotId: string): Promise<SpotGuide> {
    return simulateNetwork(() => {
      const spot = getSpot(spotId)
      if (!spot) throw new ApiError('スポットが見つかりません。')
      const nearby = spot.nearbySpotIds.map((id) => getSpot(id)?.name).filter(Boolean)
      return {
        spotId,
        // 登録情報をそのまま使い、無い項目は null（画面では「登録情報がありません」）
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

  // ---------- AI ----------

  getRecommendedQuest(): Promise<QuestSuggestion> {
    return simulateNetwork(() => {
      const db = loadDb()
      const average = stepSummary(db).average7Days
      const minutes = walkingBudgetMinutes(average)
      const start = SPOTS[0]
      const plan = planQuest({
        start,
        startSpotId: start.spotId,
        minutes,
        interests: ['歴史'],
        load: 'normal',
        visitedSpotIds: Object.keys(db.visits),
        spots: SPOTS,
      })
      const quest = toSuggestion(plan, {
        questId: `recommended-${toJstDateKey()}-${minutes}`,
        startLabel: `${start.name}周辺`,
        origin: null,
        interests: ['歴史'],
        minutes,
        load: 'normal',
        reason: `過去7日間の平均は約${average.toLocaleString('ja-JP')}歩。無理なく歩ける${minutes}分以内のコースを選びました。`,
      })
      rememberQuest(db, quest)
      saveDb(db)
      return quest
    })
  }

  generateQuest(request: QuestRequest): Promise<QuestGenerationResult> {
    return simulateNetwork(() => {
      if (!Number.isInteger(request.minutes) || request.minutes < 15 || request.minutes > 120) {
        throw new ApiError('散策時間は15〜120分で指定してください。')
      }
      if (!WALKING_LOADS.includes(request.load)) throw new ApiError('歩くペースが正しくありません。')
      const interests = request.interests.filter((tag) => QUEST_INTERESTS.includes(tag))

      let start: { latitude: number; longitude: number }
      let startLabel: string
      let startSpotId: string | undefined
      let origin: { latitude: number; longitude: number } | null = null
      if (request.startSpotId === 'current') {
        if (!request.currentLocation || !isValidLatLng(request.currentLocation)) {
          throw new ApiError('現在地を取得できませんでした。出発地点をスポットから選んでください。')
        }
        start = request.currentLocation
        origin = request.currentLocation
        startLabel = '現在地'
      } else {
        const spot = getSpot(request.startSpotId)
        if (!spot) throw new ApiError('出発地点が見つかりません。')
        start = spot
        startSpotId = spot.spotId
        startLabel = `${spot.name}周辺`
      }

      const db = loadDb()
      const today = toJstDateKey()
      const used = db.aiQuota.date === today ? db.aiQuota.count : 0
      if (used >= AI_QUEST_DAILY_LIMIT) return { status: 'quota_exceeded', remainingToday: 0 }
      db.aiQuota = { date: today, count: used + 1 }
      const remainingToday = AI_QUEST_DAILY_LIMIT - used - 1

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
        saveDb(db)
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
      db.questLog.push({ questId: quest.questId, createdAt: new Date().toISOString(), spotIds: plan.spots.map((s) => s.spotId) })
      saveDb(db)
      return { status: 'ok', quest, remainingToday }
    })
  }

  getWeeklyMission(): Promise<WeeklyMission> {
    return simulateNetwork(() => {
      const db = loadDb()
      const average = stepSummary(db).average7Days
      const proposal = proposeWeeklyGoal(average)
      return { ...proposal, average7Days: average, currentGoal: db.profile.dailyGoal, generatedBy: 'mock' }
    })
  }

  getActivitySummary(): Promise<ActivitySummary> {
    return simulateNetwork(() => {
      const db = loadDb()
      const records = Object.values(db.stepRecords)
      const visits = Object.values(db.visits)
      return {
        activeDays: db.activeDates.length,
        goalAchievedDays: records.filter((r) => r.steps >= db.profile.dailyGoal).length,
        recordedDays: records.length,
        questGenerations: db.questLog.length,
        visitsViaQuest: visits.filter((v) => v.via === 'ai_quest').length,
        visitsViaList: visits.filter((v) => v.via === 'list').length,
        gachaDraws: db.gachaDraws,
      }
    })
  }

  deleteAllData(): Promise<void> {
    return simulateNetwork(() => clearDb())
  }
}
