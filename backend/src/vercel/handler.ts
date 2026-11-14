// 公開版（Vercel Functions）の入り口。/api/ai/quests/* と /api/health を処理する。
// Bedrock への接続方法は 2 つ（上が優先）：
// 1. OIDC：AWS_ROLE_ARN と AI_QUEST_QUOTA_TABLE があるとき。Vercel の OIDC トークンで IAM ロールを引き受け、
//    一時的な認証情報で Bedrock と DynamoDB に接続する。回数は DynamoDB で正確に数える
// 2. API キー：AWS_BEARER_TOKEN_BEDROCK だけがあるとき（AWS の設定ができない場合の簡単な方法）。
//    回数は実行環境ごとのメモリで数えるため目安になる（実行環境が入れ替わると 0 に戻る）
// 回数の数え方と利用者の見分け方：
// - SUPABASE_URL と SUPABASE_SECRET_KEY があるとき：ブラウザが送る Supabase のアクセストークンを確かめて
//   ユーザーを決め、回数は Supabase で数える（どの接続方法でも、こちらを優先する）。トークンが無ければ 401
// - ないとき：サーバーが発行した匿名の ID（HttpOnly の Cookie）で見分ける
// その他の決まり：
// - API キー・秘密のキーは Vercel の環境変数（サーバー側）だけに置く。VITE_ で始まる変数には絶対に置かない
// - AI_PROVIDER を設定していない Vercel プロジェクトでは、AI の機能を無効にする（画面は従来の提案に切り替わる）
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { createApp, type AppOptions } from '../app'
import { stsAssumeRole, runWithOidcToken, vercelOidcCredentials, type AssumeRole } from '../aws/oidc'
import { createBedrockClient, SdkConverseTransport, type BedrockClientLike } from '../aws/sdkTransport'
import { ConfigError, loadConfig } from '../config'
import type { HttpRequest, HttpResponse } from '../http/handler'
import { BodyTooLargeError, collectHeaders, readBody, sendError, sendResponse } from '../http/node'
import { DynamoQuotaCounter, type DynamoClientLike } from '../limits/dynamoQuota'
import { MemoryQuotaStore, StoreQuotaCounter } from '../limits/quota'
import { SupabaseAdmin, SupabaseQuota, supabaseIdentity } from '../limits/supabaseQuota'
import type { FetchLike } from '../quests/providers/bedrock'
import { errorKind, log, registerSecret } from '../log'

export const VISITOR_COOKIE = 'ewq_aid'
const VISITOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const VISITOR_MAX_AGE_SECONDS = 365 * 24 * 60 * 60
const SUPABASE_URL_PATTERN = /^https:\/\/[A-Za-z0-9.-]+$/

export interface VercelDeps {
  env: Record<string, string | undefined>
  /** テスト用の差し替え（本番では AWS SDK のクライアントを作る） */
  aws?: { bedrock?: BedrockClientLike; dynamo?: DynamoClientLike; assumeRole?: AssumeRole }
  /** テスト用：API キーの方式で Bedrock を呼ぶ fetch の差し替え */
  fetch?: FetchLike
  /** テスト用：Supabase を呼ぶ fetch の差し替え */
  supabaseFetch?: FetchLike
  now?: () => Date
  mockDelayMs?: number
}

type Setup =
  | { ok: true; handle: (request: HttpRequest) => Promise<HttpResponse>; supabase: SupabaseAdmin | null }
  | { ok: false; reason: string }

/** Supabase の設定（両方そろっているときだけ使う）。公開用のキーを入れてしまった場合は使わない */
function setupSupabase(deps: VercelDeps): SupabaseAdmin | null | 'invalid' {
  const url = deps.env.SUPABASE_URL?.trim() ?? ''
  const secretKey = deps.env.SUPABASE_SECRET_KEY?.trim() ?? ''
  if (!url && !secretKey) return null
  if (!SUPABASE_URL_PATTERN.test(url.replace(/\/$/, '')) || !secretKey || secretKey.startsWith('sb_publishable_')) {
    log.error('config_error', { message: 'SUPABASE_URL と SUPABASE_SECRET_KEY（sb_secret_ で始まる秘密のキー）を確認してください。' })
    return 'invalid'
  }
  registerSecret(secretKey)
  return new SupabaseAdmin({ url, secretKey, fetchImpl: deps.supabaseFetch })
}

export function setupVercelApp(deps: VercelDeps): Setup {
  const { env } = deps
  const providerName = env.AI_PROVIDER?.trim()
  if (providerName !== 'bedrock' && providerName !== 'mock') return { ok: false, reason: 'ai_provider_not_set' }

  let config
  try {
    config = { ...loadConfig(env), quotaFile: '' }
  } catch (error) {
    log.error('config_error', { message: error instanceof ConfigError ? error.message : '設定を読み込めませんでした。' })
    return { ok: false, reason: 'config_error' }
  }
  const supabase = setupSupabase(deps)
  if (supabase === 'invalid') return { ok: false, reason: 'config_error' }
  // Supabase があれば、回数は Supabase で数える（1 人 1 日の上限は SQL 側、アプリ全体の上限はこの設定）
  const quota: Pick<AppOptions, 'quota'> = supabase ? { quota: new SupabaseQuota({ admin: supabase, globalLimit: config.limits.globalDailyLimit }) } : {}

  if (config.provider === 'mock') {
    // モックは料金がかからないため、Supabase がなければ回数は実行環境ごとのメモリで数える（目安）
    const app = createApp({ config, quotaCounter: new StoreQuotaCounter(new MemoryQuotaStore()), ...quota, now: deps.now, mockDelayMs: deps.mockDelayMs })
    return { ok: true, handle: app.handle, supabase }
  }

  const { roleArn, apiKey } = config.bedrock
  const table = config.quotaTable
  if (!roleArn || !table) {
    if (apiKey) {
      // API キーの方式。Supabase がなければ、回数は実行環境ごとのメモリで数える（目安）
      log.warn('api_key_mode', {
        message: supabase ? 'API キーで Bedrock に接続し、回数は Supabase で数えます。' : 'API キーで Bedrock に接続します。回数の上限は実行環境ごとの目安です。',
      })
      const app = createApp({
        config: { ...config, bedrock: { ...config.bedrock, roleArn: null } },
        quotaCounter: new StoreQuotaCounter(new MemoryQuotaStore()),
        ...quota,
        fetchImpl: deps.fetch,
        now: deps.now,
      })
      return { ok: true, handle: app.handle, supabase }
    }
    log.warn('bedrock_not_configured', { roleArn: roleArn !== null, quotaTable: table !== null, apiKey: false })
    return { ok: false, reason: 'not_configured' }
  }
  // OIDC の方式では API キーを使わない（設定されていても無視する）
  if (apiKey) log.warn('api_key_ignored', { message: 'OIDC の設定があるため、API キーは使いません。' })
  config = { ...config, bedrock: { ...config.bedrock, apiKey: null } }
  const region = config.bedrock.region
  const credentials = vercelOidcCredentials({ assumeRole: deps.aws?.assumeRole ?? stsAssumeRole({ roleArn, region }) })
  const bedrock = deps.aws?.bedrock ?? createBedrockClient({ region, credentials })
  const dynamo = deps.aws?.dynamo ?? new DynamoDBClient({ region, credentials, maxAttempts: 2 })
  const app = createApp({
    config,
    transport: new SdkConverseTransport(bedrock),
    quotaCounter: new DynamoQuotaCounter(dynamo, table),
    ...quota,
    now: deps.now,
  })
  return { ok: true, handle: app.handle, supabase }
}

/** Cookie から匿名の ID を読む（形が正しいものだけ） */
export function readVisitorId(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === VISITOR_COOKIE) {
      const value = rest.join('=').toLowerCase()
      return VISITOR_ID.test(value) ? value : null
    }
  }
  return null
}

/** Authorization: Bearer <トークン> からトークンを読む */
export function readBearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+([A-Za-z0-9._~+/=-]{20,4096})$/.exec(header?.trim() ?? '')
  return match ? match[1] : null
}

export function createVercelHandler(deps: VercelDeps) {
  const setup = setupVercelApp(deps)

  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!setup.ok) {
      sendError(res, 404, 'ai_disabled', 'この環境では AI 散策クエストを利用できません。')
      return
    }
    const url = new URL(req.url ?? '/', 'https://localhost')
    let body = ''
    try {
      body = await readBody(req)
    } catch (error) {
      const tooLarge = error instanceof BodyTooLargeError
      sendError(res, tooLarge ? 413 : 400, tooLarge ? 'payload_too_large' : 'invalid_input', 'リクエストが正しくありません。')
      return
    }

    const headers = collectHeaders(req)
    // OIDC トークンとアクセストークンは認証にだけ使い、ほかの処理には渡さない
    const oidcToken = headers['x-vercel-oidc-token'] ?? null
    const accessToken = readBearerToken(headers.authorization)
    delete headers['x-vercel-oidc-token']
    delete headers.authorization

    let identity: string
    let setCookie: Record<string, string> = {}
    if (setup.supabase && url.pathname.startsWith('/api/ai/')) {
      // ログイン中の Supabase のユーザーだけが使える（ユーザーはトークンを確かめてサーバーが決める）
      let userId: string | null = null
      try {
        userId = accessToken ? await setup.supabase.verifyUser(accessToken) : null
      } catch (error) {
        log.error('supabase_auth_failed', { kind: errorKind(error) })
        sendError(res, 503, 'service_unavailable', 'AIの機能を一時的に利用できません。時間をおいて、もう一度お試しください。')
        return
      }
      if (!userId) {
        sendError(res, 401, 'login_required', 'ログインしてから、もう一度お試しください。')
        return
      }
      identity = supabaseIdentity(userId)
    } else {
      const known = readVisitorId(headers.cookie)
      const visitorId = known ?? randomUUID()
      identity = `visitor:${visitorId}`
      setCookie = known
        ? {}
        : { 'Set-Cookie': `${VISITOR_COOKIE}=${visitorId}; Path=/api/ai; Max-Age=${VISITOR_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Strict` }
    }

    try {
      const response = await runWithOidcToken(oidcToken, () =>
        setup.handle({ method: req.method ?? 'GET', path: url.pathname, headers, body, identity }),
      )
      sendResponse(res, response, setCookie)
    } catch (error) {
      log.error('unexpected_error', { kind: errorKind(error) })
      sendError(res, 500, 'server_error', 'サーバーでエラーが起きました。')
    }
  }
}
