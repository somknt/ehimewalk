// AI 散策クエストの生成。HTTP にも Bedrock にも依存しない（Lambda に移すときもそのまま使う）。
// 順番：候補の絞り込み → キャッシュ → 設定の確認 → 同時実行の枠 → 回数の予約 → AI → 回答の検証 → 距離の再計算
import { randomUUID } from 'node:crypto'
import type { ServerConfig } from '../config'
import { TtlCache, cacheKey } from '../limits/cache'
import { ConcurrencyLimiter } from '../limits/concurrency'
import { QuotaManager, hashIdentity, type QuotaCounter, type QuotaLike } from '../limits/quota'
import { errorKind, log } from '../log'
import {
  buildRouteFromSpotIds,
  distanceMeters,
  getQuestGenre,
  getSpot,
  selectQuestCandidates,
  SPOT_DATA_VERSION,
  SPOTS,
  toJstDateKey,
  type LatLng,
  type WalkingLoad,
} from '../shared'
import { validateAiQuest } from './parseResponse'
import { PROMPT_VERSION } from './prompt'
import { ProviderError, type AiQuestProvider } from './providers/types'
import { QuestError, type AiQuestPrompt, type GenerateResult, type GeneratedQuest, type QuestConditions } from './types'

const LOAD_LABELS: Record<WalkingLoad, string> = { easy: 'ゆったり', normal: 'ふつう', active: 'しっかり' }

export interface QuestServiceDeps {
  config: ServerConfig
  provider: AiQuestProvider
  quotaCounter: QuotaCounter
  /** 回数の管理を差し替える（Supabase で数えるとき）。省略時は quotaCounter で数える */
  quota?: QuotaLike
  now?: () => Date
}

export class QuestService {
  private readonly config: ServerConfig
  private readonly provider: AiQuestProvider
  private readonly quota: QuotaLike
  private readonly cache: TtlCache<GeneratedQuest>
  private readonly limiter: ConcurrencyLimiter
  private readonly now: () => Date

  constructor(deps: QuestServiceDeps) {
    this.config = deps.config
    this.provider = deps.provider
    this.now = deps.now ?? (() => new Date())
    this.quota =
      deps.quota ??
      new QuotaManager({
        counter: deps.quotaCounter,
        userLimit: deps.config.limits.userDailyLimit,
        globalLimit: deps.config.limits.globalDailyLimit,
        today: () => toJstDateKey(this.now()),
      })
    this.cache = new TtlCache({ ttlMs: deps.config.limits.cacheTtlMs, now: () => this.now().getTime() })
    this.limiter = new ConcurrencyLimiter(deps.config.limits.maxConcurrency)
  }

  /** 今日の残り回数と、AI の接続状態（画面表示用） */
  async status(identity: string) {
    return {
      remainingToday: await this.quota.remaining(identity),
      dailyLimit: this.config.limits.userDailyLimit,
      provider: this.provider.name,
      model: this.provider.model,
      configured: this.provider.isConfigured(),
    }
  }

  async generate(conditions: QuestConditions, identity: string): Promise<GenerateResult> {
    const dailyLimit = this.config.limits.userDailyLimit
    const { start, startSpotId, startLabel } = resolveStart(conditions)
    const genre = getQuestGenre(conditions.genre)!

    // 1. 候補の絞り込み（登録スポットのうち、希望時間・距離で行けるものだけ。AI に渡す件数にも上限）
    const candidates = selectQuestCandidates({
      start,
      startSpotId,
      minutes: conditions.minutes,
      load: conditions.load,
      maxDistanceM: conditions.maxDistanceM,
      genreTags: genre.tags,
      spots: SPOTS,
      maxCandidates: this.config.limits.maxCandidates,
    })
    if (candidates.length === 0) {
      const nearest = SPOTS.map((spot) => ({ spot, distanceM: Math.round(distanceMeters(start, spot)) })).sort(
        (a, b) => a.distanceM - b.distanceM,
      )[0]
      return {
        status: 'no_spots',
        nearest: nearest ? { spotId: nearest.spot.spotId, name: nearest.spot.name, distanceM: nearest.distanceM } : null,
        remainingToday: await this.quota.remaining(identity),
        dailyLimit,
      }
    }

    // 2. キャッシュ（同じ条件なら AI を呼ばず、回数も減らさない）
    const key = cacheKey({
      prompt: PROMPT_VERSION,
      spotData: SPOT_DATA_VERSION,
      provider: this.provider.name,
      model: this.provider.model,
      // 現在地は約 100m 単位に丸める（キーに細かい座標を残さない）
      start: startSpotId ?? `${start.latitude.toFixed(3)},${start.longitude.toFixed(3)}`,
      minutes: conditions.minutes,
      genre: conditions.genre,
      maxDistanceM: conditions.maxDistanceM,
      load: conditions.load,
    })
    const cached = this.cache.get(key)
    if (cached) {
      log.info('ai_quest_cache_hit', { provider: this.provider.name })
      return { status: 'ok', quest: cached, cached: true, remainingToday: await this.quota.remaining(identity), dailyLimit }
    }

    // 3. 設定の確認（API キーがなければ呼ばない。回数も減らさない）
    if (!this.provider.isConfigured()) {
      throw new QuestError('ai_not_configured', 'AIの設定が完了していないため、提案を作れません。管理者にお問い合わせください。')
    }

    // 4. 同時実行の枠（同じ利用者の連打と、全体の同時呼び出しを抑える）
    const releaseSlot = this.limiter.tryAcquire(hashIdentity(identity))
    if (!releaseSlot) {
      throw new QuestError('busy', 'ただいま提案を作成中です。少し待ってから、もう一度お試しください。', await this.quota.remaining(identity))
    }

    try {
      // 5. 回数の予約（上限を超えるなら AI を呼ばない）
      const reservation = await this.quota.reserve(identity)
      if (!reservation.ok) {
        if (reservation.reason === 'user_limit') {
          throw new QuestError('quota_exceeded', '今日のAI提案の回数（1日' + dailyLimit + '回）を使い切りました。また明日お試しください。', 0)
        }
        throw new QuestError('service_limit', 'アプリ全体の今日のAI利用回数の上限に達しました。また明日お試しください。', reservation.remaining)
      }

      // 6. AI を呼ぶ
      const prompt: AiQuestPrompt = {
        startLabel,
        minutes: conditions.minutes,
        maxDistanceKm: conditions.maxDistanceM === null ? null : conditions.maxDistanceM / 1000,
        genreLabel: genre.label,
        loadLabel: LOAD_LABELS[conditions.load],
        candidates: candidates.map((c) => ({
          spotId: c.spot.spotId,
          name: c.spot.name,
          municipality: c.spot.municipality,
          tags: [...c.spot.tags],
          description: c.spot.description,
          fromStartKm: Math.round(c.fromStartM / 100) / 10,
          matchesGenre: c.matchesGenre,
        })),
      }
      const startedAt = Date.now()
      let raw: unknown
      let usage
      try {
        ;({ raw, usage } = await this.provider.generate(prompt))
      } catch (error) {
        throw await this.toQuestError(error, reservation.release, reservation.remaining)
      }

      // 7. 回答の検証（候補にないスポットが 1 つでもあれば採用しない。回数は戻さない：AI は呼ばれている）
      const candidateIds = new Set(prompt.candidates.map((c) => c.spotId))
      let draft
      try {
        draft = validateAiQuest(raw, candidateIds)
      } catch (error) {
        log.warn('ai_quest_rejected', { reason: (error as { detail?: string }).detail ?? errorKind(error), provider: this.provider.name })
        throw error
      }

      // 8. 距離と時間はサーバーの規則で計算し直す（AI の見積もりをそのまま使わない）
      const route = buildRouteFromSpotIds({
        start,
        startSpotId,
        startName: startLabel,
        spotIds: draft.spotIds,
        spots: SPOTS,
        minutes: conditions.minutes,
        load: conditions.load,
        maxDistanceM: conditions.maxDistanceM,
      })
      if (route.spots.length === 0) {
        log.warn('ai_quest_rejected', { reason: 'route exceeds limits', provider: this.provider.name })
        throw new QuestError('ai_invalid_response', 'AIの提案が条件に合いませんでした。もう一度お試しください。', reservation.remaining)
      }

      const legBySpot = new Map(route.legs.map((leg) => [leg.toSpotId, leg.estimatedM]))
      const stepBySpot = new Map(draft.steps.map((step) => [step.spotId, step.description]))
      const quest: GeneratedQuest = {
        questId: randomUUID(),
        title: draft.title,
        description: draft.description,
        estimatedMinutes: draft.estimatedMinutes,
        startLabel,
        spots: route.spots.map((spot, index) => ({
          order: index + 1,
          spotId: spot.spotId,
          name: spot.name,
          municipality: spot.municipality,
          // AI の案内がない場合は、登録済みの説明を使う
          description: stepBySpot.get(spot.spotId) ?? spot.description,
          legM: legBySpot.get(spot.spotId) ?? 0,
        })),
        route: { basis: 'straight_line', distanceM: route.distanceM, minutes: route.minutes, steps: route.steps },
        generatedBy: this.provider.name,
        model: this.provider.model,
        createdAt: this.now().toISOString(),
      }
      this.cache.set(key, quest)
      // 提案したクエストを記録する（Supabase のとき。チェックインの「AI 経由」の判定と効果検証に使う）
      await reservation.commit?.({
        questId: quest.questId,
        title: quest.title,
        spotIds: quest.spots.map((spot) => spot.spotId),
        model: quest.model,
        generatedBy: quest.generatedBy,
      })
      log.info('ai_quest_generated', {
        provider: this.provider.name,
        model: this.provider.model,
        spots: quest.spots.length,
        latencyMs: Date.now() - startedAt,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
      })
      return { status: 'ok', quest, cached: false, remainingToday: reservation.remaining, dailyLimit }
    } finally {
      releaseSlot()
    }
  }

  /** AI 呼び出しの失敗を、画面に出せるエラーにする。請求されていない失敗では回数を戻す */
  private async toQuestError(error: unknown, releaseQuota: () => Promise<void>, remaining: number): Promise<QuestError> {
    // 回答の解析で起きたエラー（AI は呼ばれている）は、そのまま返す。回数は戻さない
    if (error instanceof QuestError) {
      log.warn('ai_quest_rejected', { reason: (error as { detail?: string }).detail ?? error.code, provider: this.provider.name })
      return new QuestError(error.code, error.message, remaining)
    }
    const kind = error instanceof ProviderError ? error.kind : 'network'
    const httpStatus = error instanceof ProviderError ? error.httpStatus : null
    log.warn('ai_quest_failed', { kind, httpStatus, provider: this.provider.name })
    switch (kind) {
      case 'not_configured':
        await releaseQuota()
        return new QuestError('ai_not_configured', 'AIの設定が完了していないため、提案を作れません。管理者にお問い合わせください。')
      case 'throttled':
        await releaseQuota()
        return new QuestError('ai_unavailable', 'AIが混み合っています。少し時間をおいてからお試しください。', remaining + 1)
      case 'rejected':
      case 'network':
        await releaseQuota()
        return new QuestError('ai_unavailable', 'AIに接続できませんでした。時間をおいて、もう一度お試しください。', remaining + 1)
      case 'timeout':
        // 時間切れでも AI 側で処理され、料金がかかった可能性があるため、回数は戻さない
        return new QuestError('ai_timeout', 'AIの応答に時間がかかったため、中止しました。もう一度お試しください。', remaining)
      case 'bad_response':
        return new QuestError('ai_invalid_response', 'AIの回答を確認できませんでした。もう一度お試しください。', remaining)
    }
  }
}

function resolveStart(conditions: QuestConditions): { start: LatLng; startSpotId?: string; startLabel: string } {
  if (conditions.startSpotId === 'current' && conditions.currentLocation) {
    return { start: conditions.currentLocation, startLabel: '現在地' }
  }
  const spot = getSpot(conditions.startSpotId)
  if (!spot) throw new QuestError('invalid_input', '出発地点が登録スポットにありません。')
  return { start: spot, startSpotId: spot.spotId, startLabel: `${spot.name}周辺` }
}
