// AI の利用回数を Supabase で数える（supabase/migrations の ai_quota_* 関数）。
// - 利用者は、ブラウザが送る Supabase のアクセストークンを Supabase Auth で確かめて決める（クライアントの申告は使わない）
// - 回数の予約・使用・取り消しは service_role 専用の関数で行う。秘密のキー（SUPABASE_SECRET_KEY）はサーバーだけが持つ
// - 新しい形式のキー（sb_secret_…）は JWT ではないため、apikey ヘッダーで送る（Authorization には入れない）
import { errorKind, log } from '../log'
import type { FetchLike } from '../quests/providers/bedrock'
import type { QuotaLike, ReserveResult } from './quota'

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IDENTITY_PREFIX = 'supabase:'
const TIMEOUT_MS = 8_000

export class SupabaseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SupabaseError'
  }
}

export interface SupabaseAdminOptions {
  url: string
  secretKey: string
  fetchImpl?: FetchLike
}

/** Supabase へのサーバー側の呼び出し（Auth の確認と、service_role 専用の RPC） */
export class SupabaseAdmin {
  private readonly url: string
  private readonly secretKey: string
  private readonly fetchImpl: FetchLike

  constructor(options: SupabaseAdminOptions) {
    this.url = options.url.replace(/\/$/, '')
    this.secretKey = options.secretKey
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  /** アクセストークンが本物なら、そのユーザー ID を返す。偽物・期限切れなら null */
  async verifyUser(accessToken: string): Promise<string | null> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.url}/auth/v1/user`, {
        method: 'GET',
        headers: { apikey: this.secretKey, Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw new SupabaseError('auth_unreachable')
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => undefined)
      return null
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new SupabaseError(`auth_${response.status}`)
    }
    const user = (await response.json().catch(() => null)) as { id?: unknown } | null
    return typeof user?.id === 'string' && USER_ID.test(user.id) ? user.id : null
  }

  async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.url}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { apikey: this.secretKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw new SupabaseError('rpc_unreachable')
    }
    if (!response.ok) {
      // 応答の本文（エラーの詳細）は外に出さない
      await response.body?.cancel().catch(() => undefined)
      throw new SupabaseError(`rpc_${name}_${response.status}`)
    }
    return (await response.json()) as T
  }
}

/** HTTP の識別子（"supabase:<ユーザー ID>"）を作る・読む */
export const supabaseIdentity = (userId: string) => `${IDENTITY_PREFIX}${userId}`
function userIdOf(identity: string): string {
  const id = identity.startsWith(IDENTITY_PREFIX) ? identity.slice(IDENTITY_PREFIX.length) : ''
  if (!USER_ID.test(id)) throw new SupabaseError('not_a_supabase_user')
  return id
}

/** 回数を Supabase で数える（1 人 1 日の上限は SQL 側、アプリ全体の上限は globalLimit） */
export class SupabaseQuota implements QuotaLike {
  private readonly admin: SupabaseAdmin
  private readonly globalLimit: number

  constructor(options: { admin: SupabaseAdmin; globalLimit: number }) {
    this.admin = options.admin
    this.globalLimit = options.globalLimit
  }

  async remaining(identity: string): Promise<number> {
    const status = await this.admin.rpc<{ remainingToday: number }>('ai_quota_status', { p_user_id: userIdOf(identity) })
    return status.remainingToday
  }

  async reserve(identity: string): Promise<ReserveResult> {
    const result = await this.admin.rpc<{ ok: boolean; reason?: 'user_limit' | 'global_limit'; reservationId?: string; remainingToday: number }>(
      'ai_quota_reserve',
      { p_user_id: userIdOf(identity), p_global_limit: this.globalLimit },
    )
    if (!result.ok || !result.reservationId) {
      return { ok: false, reason: result.reason ?? 'user_limit', remaining: result.remainingToday }
    }
    const reservationId = result.reservationId
    return {
      ok: true,
      remaining: result.remainingToday,
      // AI に請求されない失敗のときだけ戻す。戻せなくても利用者の操作は止めない（回数が 1 回多く数えられるだけ）
      release: async () => {
        await this.admin.rpc('ai_quota_release', { p_reservation_id: reservationId }).catch((error: unknown) => {
          log.warn('quota_release_failed', { kind: errorKind(error) })
        })
      },
      commit: async (quest) => {
        await this.admin
          .rpc('ai_quota_commit', {
            p_reservation_id: reservationId,
            p_quest_id: quest.questId,
            p_title: quest.title,
            p_spot_ids: quest.spotIds,
            p_model: quest.model,
            p_generated_by: quest.generatedBy,
          })
          .catch((error: unknown) => {
            // 記録できなくても提案は返す（チェックインが「一覧から」として記録されるだけ）
            log.warn('quota_commit_failed', { kind: errorKind(error) })
          })
      },
    }
  }
}
