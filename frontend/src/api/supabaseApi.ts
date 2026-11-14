// Supabase につないだ API。画面からは MockGameApi と同じ形（GameApi）で使える。
// - ゲームの値を変える処理は、すべて Supabase の RPC（supabase/migrations/001_initial_schema.sql）で行う。
//   ここでは結果を決めない（コイン・ガチャ・チェックインの判定はサーバー側）
// - 自分のデータの読み取りは、RLS で守られたテーブルを直接読む
// - 初めて使うときは匿名でサインインする（あとからメールアドレスを結び付けられる）
// - おすすめクエスト・健康ミッション・観光ガイドは、モックと同じ規則でブラウザ内で計算する（ゲームの値ではないため）
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import { isValidLatLng } from '../domain/checkin'
import { addDays, startOfMonth, toJstDateKey } from '../domain/date'
import { proposeWeeklyGoal } from '../domain/mission'
import { planQuest } from '../domain/questPlanner'
import { summarizeSteps } from '../domain/steps'
import type { Character, DateKey, EquipSlot, StepRecord, UserProfile, Visit, WalkingLoad } from '../domain/types'
import { getSpot, QUEST_INTERESTS, SPOTS } from '../data/spots'
import { toSuggestion, walkingBudgetMinutes } from './mockApi'
import { DeviceMotionStepProvider } from './stepProviders/deviceMotionStepProvider'
import type { StepDataProvider } from './stepProviders/types'
import {
  ApiError,
  type ActivitySummary,
  type ApiErrorCode,
  type BalanceListener,
  type CharacterPatch,
  type CheckInRequest,
  type CheckInResult,
  type CheerReaction,
  type CommonQuestStatus,
  type DemoCoinAmount,
  type DemoHistoryEntry,
  type DemoStepAmount,
  type DemoTools,
  type FriendCandidate,
  type FriendsData,
  type GachaDrawResult,
  type GameApi,
  type InventoryItem,
  type LoginBonusResult,
  type OnboardingInput,
  type PointBalance,
  type ProfilePatch,
  type QuestClaimResult,
  type QuestGenerationResult,
  type QuestRequest,
  type QuestSuggestion,
  type RankingResult,
  type RankingScope,
  type SessionData,
  type SpotGuide,
  type StepSyncResult,
  type WeeklyMission,
} from './types'

/** サーバーが返すエラーコードのうち、画面でそのまま使えるもの */
const KNOWN_CODES: readonly ApiErrorCode[] = [
  'insufficient_points',
  'item_not_owned',
  'invalid_slot',
  'invalid_input',
  'not_found',
  'demo_unavailable',
]
const NETWORK_MESSAGE = 'サーバーに接続できませんでした。通信環境を確認して、もう一度お試しください。'
const WALKING_LOADS: readonly WalkingLoad[] = ['easy', 'normal', 'active']

/** RPC のエラー（message = コード、hint = 日本語）を、画面に出せる ApiError にする */
export function toApiError(error: PostgrestError | null | undefined): ApiError {
  if (error?.code === 'P0001') {
    const code = KNOWN_CODES.find((c) => c === error.message) ?? 'network'
    return new ApiError(error.hint || '処理に失敗しました。時間をおいて、もう一度お試しください。', { code })
  }
  // 想定外のエラーの詳細（SQL・テーブル名など）は画面に出さない
  return new ApiError(NETWORK_MESSAGE, { cause: error })
}

interface StepRow {
  step_date: string
  steps: number
  source: StepRecord['source']
  demo_added_steps: number
  synced_at: string
  verification: StepRecord['verification']
}

interface VisitRow {
  spot_id: string
  visited_at: string
  via: Visit['via']
  quest_id: string | null
  verified: boolean
}

const toStepRecord = (row: StepRow): StepRecord => ({
  date: row.step_date,
  steps: row.steps,
  source: row.source,
  ...(row.demo_added_steps > 0 ? { demoAddedSteps: row.demo_added_steps } : {}),
  syncTimestamp: row.synced_at,
  verification: row.verification,
})

const toVisit = (row: VisitRow): Visit => ({
  spotId: row.spot_id,
  visitedAt: row.visited_at,
  via: row.via,
  ...(row.quest_id ? { questId: row.quest_id } : {}),
  verified: row.verified,
})

export interface SupabaseGameApiOptions {
  provider?: StepDataProvider
  now?: () => Date
}

export class SupabaseGameApi implements GameApi {
  readonly mode = 'supabase' as const
  readonly persistent = true
  private readonly client: SupabaseClient
  private readonly provider: StepDataProvider | undefined
  private readonly now: () => Date
  private readonly balanceListeners = new Set<BalanceListener>()
  private readonly demoTools: DemoTools
  private authReady: Promise<void> | null = null
  /** デモ用アカウントか（get_session で分かる。デモ操作の入口はデモ用アカウントにだけ出す） */
  private isDemo = false

  constructor(client: SupabaseClient, options: SupabaseGameApiOptions = {}) {
    this.client = client
    this.provider = options.provider
    this.now = options.now ?? (() => new Date())
    this.demoTools = this.createDemoTools()
  }

  get demo(): DemoTools | null {
    return this.isDemo ? this.demoTools : null
  }

  // ---- 認証と呼び出し ----

  /** ログインしていなければ匿名でサインインする（同時に呼ばれても 1 回だけ） */
  private ensureAuth(): Promise<void> {
    this.authReady ??= (async () => {
      const { data, error } = await this.client.auth.getSession()
      if (error) throw new ApiError(NETWORK_MESSAGE, { cause: error })
      if (data.session) return
      const { error: signInError } = await this.client.auth.signInAnonymously()
      if (signInError) throw new ApiError('ログインできませんでした。時間をおいて、もう一度お試しください。', { cause: signInError })
    })().catch((error: unknown) => {
      this.authReady = null
      throw error
    })
    return this.authReady
  }

  private async rpc<T>(fn: string, args?: Record<string, unknown>, retried = false): Promise<T> {
    await this.ensureAuth()
    const { data, error } = await this.client.rpc(fn, args)
    if (error) {
      // ログインの期限切れ・ユーザーが消えた場合は、サインインし直して 1 回だけやり直す
      const expired = error.code === 'PGRST301' || error.code === 'PGRST303' || (error.code === 'P0001' && error.message === 'not_authenticated')
      if (expired && !retried) {
        await this.client.auth.signOut({ scope: 'local' }).catch(() => undefined)
        this.authReady = null
        return this.rpc<T>(fn, args, true)
      }
      throw toApiError(error)
    }
    return data as T
  }

  private async rows<T>(build: (client: SupabaseClient) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>): Promise<T[]> {
    await this.ensureAuth()
    const { data, error } = await build(this.client)
    if (error) throw toApiError(error)
    return data ?? []
  }

  private today(): DateKey {
    return toJstDateKey(this.now())
  }

  // ---- 残高の通知 ----

  onBalanceChange(listener: BalanceListener): () => void {
    this.balanceListeners.add(listener)
    return () => {
      this.balanceListeners.delete(listener)
    }
  }

  private notifyBalance(balance: PointBalance): PointBalance {
    this.balanceListeners.forEach((listener) => listener(balance))
    return balance
  }

  // ---- プロフィール・キャラクター ----

  async getSession(): Promise<SessionData> {
    const session = await this.rpc<SessionData & { profile: UserProfile & { isDemo?: boolean } }>('get_session')
    this.isDemo = session.profile.isDemo === true
    return session
  }

  async getProfile(): Promise<UserProfile> {
    return (await this.getSession()).profile
  }

  async getCharacter(): Promise<Character> {
    return (await this.getSession()).character
  }

  completeOnboarding(input: OnboardingInput): Promise<SessionData> {
    return this.rpc<SessionData>('complete_onboarding', {
      p_username: input.username,
      p_character_name: input.characterName,
      p_appearance: input.appearance,
      p_top_item_id: input.topItemId,
      p_bottom_item_id: input.bottomItemId,
    })
  }

  updateProfile(patch: ProfilePatch): Promise<SessionData> {
    return this.rpc<SessionData>('update_profile', { p_patch: patch })
  }

  updateCharacter(patch: CharacterPatch): Promise<Character> {
    return this.rpc<Character>('update_character', { p_patch: patch })
  }

  equipItem(slot: EquipSlot, itemId: string | null): Promise<Character> {
    return this.rpc<Character>('equip_item', { p_slot: slot, p_item_id: itemId })
  }

  // ---- 歩数とコイン ----

  private stepProvider(): StepDataProvider {
    return this.provider ?? new DeviceMotionStepProvider(undefined, this.now)
  }

  async syncSteps(): Promise<StepSyncResult> {
    const today = this.today()
    // サーバーが受け付ける期間（月初か 7 日前の早いほう〜今日）。コインは直近 7 日分だけ付く
    const windowStart = addDays(today, -6)
    const from = startOfMonth(today) < windowStart ? startOfMonth(today) : windowStart
    const provider = this.stepProvider()
    const days = await provider.getDailySteps(from, today)
    const result = await this.rpc<StepSyncResult & { balance: PointBalance }>('sync_steps', {
      p_source: provider.source,
      p_days: days.map(({ date, steps }) => ({ date, steps })),
    })
    if (result.awardedPoints > 0) this.notifyBalance(result.balance)
    return { source: result.source, syncedDays: result.syncedDays, awardedPoints: result.awardedPoints, syncedAt: result.syncedAt }
  }

  async getStepRecords(from: DateKey, to: DateKey): Promise<StepRecord[]> {
    const rows = await this.rows<StepRow>((c) =>
      c
        .from('step_records')
        .select('step_date, steps, source, demo_added_steps, synced_at, verification')
        .gte('step_date', from)
        .lte('step_date', to)
        .order('step_date'),
    )
    return rows.map(toStepRecord)
  }

  getPointBalance(): Promise<PointBalance> {
    return this.rpc<PointBalance>('get_point_balance')
  }

  async claimLoginBonus(): Promise<LoginBonusResult> {
    const result = await this.rpc<LoginBonusResult>('claim_login_bonus')
    if (result.granted) this.notifyBalance(result.balance)
    return result
  }

  // ---- ガチャ・着せ替え ----

  async drawGacha(): Promise<GachaDrawResult> {
    const result = await this.rpc<GachaDrawResult>('draw_gacha')
    // 残高の表示は、ログインボーナスなどの状態も含めて読み直す
    void this.getPointBalance().then((balance) => this.notifyBalance(balance), () => undefined)
    return { itemId: result.itemId, isDuplicate: result.isDuplicate, cost: result.cost, refund: result.refund, balance: result.balance }
  }

  async getInventory(): Promise<InventoryItem[]> {
    const rows = await this.rows<{ item_id: string; acquired_at: string }>((c) => c.from('inventory').select('item_id, acquired_at'))
    return rows.map((row) => ({ itemId: row.item_id, acquiredAt: row.acquired_at }))
  }

  // ---- ランキング・フレンド ----

  getRanking(scope: RankingScope): Promise<RankingResult> {
    // Web 版ランキング（センサーの歩数＝pending も入る）。正式ランキング（trusted だけ）は p_mode = 'official'
    return this.rpc<RankingResult>('get_ranking', { p_scope: scope, p_mode: 'web' })
  }

  async sendCheer(friendUserId: string, reaction: CheerReaction): Promise<void> {
    await this.rpc<null>('send_cheer', { p_friend_user_id: friendUserId, p_reaction: reaction })
  }

  getFriends(): Promise<FriendsData> {
    return this.rpc<FriendsData>('get_friends')
  }

  findUserByFriendCode(friendCode: string): Promise<FriendCandidate | null> {
    return this.rpc<FriendCandidate | null>('find_user_by_friend_code', { p_friend_code: friendCode })
  }

  sendFriendRequest(friendCode: string): Promise<FriendsData> {
    return this.rpc<FriendsData>('send_friend_request', { p_friend_code: friendCode })
  }

  respondFriendRequest(userId: string, accept: boolean): Promise<FriendsData> {
    return this.rpc<FriendsData>('respond_friend_request', { p_user_id: userId, p_accept: accept })
  }

  removeFriend(userId: string): Promise<FriendsData> {
    return this.rpc<FriendsData>('remove_friend', { p_user_id: userId })
  }

  // ---- 観光 ----

  async getVisits(): Promise<Visit[]> {
    const rows = await this.rows<VisitRow>((c) => c.from('visits').select('spot_id, visited_at, via, quest_id, verified'))
    return rows.map(toVisit)
  }

  checkIn(request: CheckInRequest): Promise<CheckInResult> {
    // 座標は判定のためだけに送る。サーバーは保存しない
    return this.rpc<CheckInResult>('check_in', {
      p_spot_id: request.spotId,
      p_latitude: Number.isFinite(request.latitude) ? request.latitude : null,
      p_longitude: Number.isFinite(request.longitude) ? request.longitude : null,
      p_accuracy_m: Number.isFinite(request.accuracyM) ? request.accuracyM : null,
      p_via: request.via,
      p_quest_id: request.questId ?? null,
      p_demo_location: request.demoLocation === true,
    })
  }

  async getSpotGuide(spotId: string): Promise<SpotGuide> {
    const spot = getSpot(spotId)
    if (!spot) throw new ApiError('スポットが見つかりません。', { code: 'not_found' })
    const nearby = spot.nearbySpotIds.map((id) => getSpot(id)?.name).filter(Boolean)
    // 登録情報をそのまま使い、無い項目は null（推測で埋めない）。モックと同じ
    return {
      spotId,
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
  }

  // ---- クエスト（規則で選ぶ提案。AI の提案は backend の API が行う） ----

  private async recentSteps(): Promise<{ records: StepRecord[]; today: DateKey }> {
    const today = this.today()
    return { records: await this.getStepRecords(addDays(today, -6), today), today }
  }

  async getRecommendedQuest(): Promise<QuestSuggestion> {
    const [{ records, today }, visits, profile] = await Promise.all([this.recentSteps(), this.getVisits(), this.getProfile()])
    const { average7Days } = summarizeSteps(records, today, profile.dailyGoal)
    const minutes = walkingBudgetMinutes(average7Days)
    const start = SPOTS[0]
    const interests = ['歴史']
    const plan = planQuest({
      start,
      startSpotId: start.spotId,
      minutes,
      interests,
      load: 'normal',
      visitedSpotIds: visits.map((v) => v.spotId),
      spots: SPOTS,
    })
    return toSuggestion(plan, {
      questId: `recommended-${today}-${minutes}`,
      startLabel: `${start.name}周辺`,
      origin: null,
      interests,
      minutes,
      load: 'normal',
      reason: `過去7日間の平均は約${average7Days.toLocaleString('ja-JP')}歩。無理なく歩ける${minutes}分以内のコースを選びました。`,
    })
  }

  /**
   * AI の API（backend）が無い環境で使う、規則で選ぶ提案。AI を呼ばないので回数は減らさず、
   * 残り回数はサーバーの値をそのまま表示する
   */
  async generateQuest(request: QuestRequest): Promise<QuestGenerationResult> {
    if (!Number.isInteger(request.minutes) || request.minutes < 15 || request.minutes > 120) {
      throw new ApiError('散策時間は15〜120分で指定してください。', { code: 'invalid_input' })
    }
    if (!WALKING_LOADS.includes(request.load)) throw new ApiError('歩くペースが正しくありません。', { code: 'invalid_input' })
    const interests = (Array.isArray(request.interests) ? request.interests : []).filter((tag) => QUEST_INTERESTS.includes(tag))
    let start: { latitude: number; longitude: number }
    let startLabel: string
    let startSpotId: string | undefined
    let origin: { latitude: number; longitude: number } | null = null
    if (request.startSpotId === 'current') {
      if (!request.currentLocation || !isValidLatLng(request.currentLocation)) {
        throw new ApiError('現在地を取得できませんでした。出発地点をスポットから選んでください。', { code: 'invalid_input' })
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
    const [visits, quota] = await Promise.all([this.getVisits(), this.rpc<{ remainingToday: number }>('get_ai_quota')])
    const plan = planQuest({
      start,
      startSpotId,
      minutes: request.minutes,
      interests,
      load: request.load,
      visitedSpotIds: visits.map((v) => v.spotId),
      spots: SPOTS,
    })
    const remainingToday = quota.remainingToday
    if (plan.spots.length === 0) {
      const nearest = plan.nearest
        ? { spotId: plan.nearest.spot.spotId, name: plan.nearest.spot.name, distanceM: plan.nearest.distanceM }
        : null
      return { status: 'no_spots', nearest, remainingToday }
    }
    const quest = toSuggestion(plan, { questId: crypto.randomUUID(), startLabel, origin, interests, minutes: request.minutes, load: request.load })
    return { status: 'ok', quest, remainingToday }
  }

  getCommonQuests(): Promise<CommonQuestStatus[]> {
    return this.rpc<CommonQuestStatus[]>('get_common_quests')
  }

  async claimCommonQuest(questId: string): Promise<QuestClaimResult> {
    const result = await this.rpc<QuestClaimResult>('claim_common_quest', { p_quest_id: questId })
    this.notifyBalance(result.balance)
    return result
  }

  async getWeeklyMission(): Promise<WeeklyMission> {
    const [{ records, today }, profile] = await Promise.all([this.recentSteps(), this.getProfile()])
    const { average7Days } = summarizeSteps(records, today, profile.dailyGoal)
    // 目標値は規則で決める（AI に任せない）。モックと同じ
    return { ...proposeWeeklyGoal(average7Days), average7Days, currentGoal: profile.dailyGoal, generatedBy: 'mock' }
  }

  getActivitySummary(): Promise<ActivitySummary> {
    return this.rpc<ActivitySummary>('get_activity_summary')
  }

  async deleteAllData(): Promise<void> {
    await this.rpc<null>('delete_my_data')
    // この端末のセンサーで数えた歩数も消す（次は 0 歩から）
    this.stepProvider().clear?.()
    this.notifyBalance(await this.getPointBalance())
  }

  // ---- デモ操作（デモ用アカウントだけ。サーバー側でも確かめる） ----

  private createDemoTools(): DemoTools {
    return {
      addCoins: async (amount: DemoCoinAmount) => this.notifyBalance(await this.rpc<PointBalance>('demo_add_coins', { p_amount: amount })),
      addSteps: async (steps: DemoStepAmount) => {
        const result = await this.rpc<{ todaySteps: number; awardedPoints: number; balance: PointBalance }>('demo_add_steps', { p_steps: steps })
        this.notifyBalance(result.balance)
        return result
      },
      getHistory: (limit = 10) => this.rpc<DemoHistoryEntry[]>('demo_get_history', { p_limit: limit }),
      prepareShowcase: async () => {
        this.stepProvider().clear?.()
        await this.rpc<null>('demo_prepare_showcase')
        this.notifyBalance(await this.getPointBalance())
      },
    }
  }
}
