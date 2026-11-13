// 公開版（Vercel Functions）の入り口。/api/ai/quests/* と /api/health を処理する。
// 安全のための決まり：
// - 長期の API キー（AWS_BEARER_TOKEN_BEDROCK）は、Vercel に設定されていても使わない
// - Bedrock と DynamoDB へは、Vercel の OIDC トークンで引き受けた IAM ロールの一時的な認証情報で接続する
// - AI_PROVIDER を設定していない Vercel プロジェクトでは、AI の機能を無効にする（画面は従来の提案に切り替わる）
// - 利用者はサーバーが発行した匿名の ID（HttpOnly の Cookie）で見分ける。ログイン機能ができたらユーザー ID にする
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { createApp } from '../app'
import { stsAssumeRole, runWithOidcToken, vercelOidcCredentials, type AssumeRole } from '../aws/oidc'
import { createBedrockClient, SdkConverseTransport, type BedrockClientLike } from '../aws/sdkTransport'
import { ConfigError, loadConfig } from '../config'
import type { HttpRequest, HttpResponse } from '../http/handler'
import { BodyTooLargeError, collectHeaders, readBody, sendError, sendResponse } from '../http/node'
import { DynamoQuotaCounter, type DynamoClientLike } from '../limits/dynamoQuota'
import { MemoryQuotaStore, StoreQuotaCounter } from '../limits/quota'
import { errorKind, log } from '../log'

export const VISITOR_COOKIE = 'ewq_aid'
const VISITOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const VISITOR_MAX_AGE_SECONDS = 365 * 24 * 60 * 60

export interface VercelDeps {
  env: Record<string, string | undefined>
  /** テスト用の差し替え（本番では AWS SDK のクライアントを作る） */
  aws?: { bedrock?: BedrockClientLike; dynamo?: DynamoClientLike; assumeRole?: AssumeRole }
  now?: () => Date
  mockDelayMs?: number
}

type Setup = { ok: true; handle: (request: HttpRequest) => Promise<HttpResponse> } | { ok: false; reason: string }

export function setupVercelApp(deps: VercelDeps): Setup {
  const { env } = deps
  const providerName = env.AI_PROVIDER?.trim()
  if (providerName !== 'bedrock' && providerName !== 'mock') return { ok: false, reason: 'ai_provider_not_set' }
  if (env.AWS_BEARER_TOKEN_BEDROCK?.trim()) {
    log.warn('api_key_ignored', { message: '公開版では API キーを使いません。Vercel の環境変数から AWS_BEARER_TOKEN_BEDROCK を削除してください。' })
  }

  let config
  try {
    config = { ...loadConfig({ ...env, AWS_BEARER_TOKEN_BEDROCK: undefined }), quotaFile: '' }
  } catch (error) {
    log.error('config_error', { message: error instanceof ConfigError ? error.message : '設定を読み込めませんでした。' })
    return { ok: false, reason: 'config_error' }
  }

  if (config.provider === 'mock') {
    // モックは料金がかからないため、回数は実行環境ごとのメモリで数える（目安）
    const app = createApp({ config, quotaCounter: new StoreQuotaCounter(new MemoryQuotaStore()), now: deps.now, mockDelayMs: deps.mockDelayMs })
    return { ok: true, handle: app.handle }
  }

  const { roleArn } = config.bedrock
  const table = config.quotaTable
  if (!roleArn || !table) {
    log.warn('bedrock_not_configured', { roleArn: roleArn !== null, quotaTable: table !== null })
    return { ok: false, reason: 'not_configured' }
  }
  const region = config.bedrock.region
  const credentials = vercelOidcCredentials({ assumeRole: deps.aws?.assumeRole ?? stsAssumeRole({ roleArn, region }) })
  const bedrock = deps.aws?.bedrock ?? createBedrockClient({ region, credentials })
  const dynamo = deps.aws?.dynamo ?? new DynamoDBClient({ region, credentials, maxAttempts: 2 })
  const app = createApp({
    config,
    transport: new SdkConverseTransport(bedrock),
    quotaCounter: new DynamoQuotaCounter(dynamo, table),
    now: deps.now,
  })
  return { ok: true, handle: app.handle }
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
    // OIDC トークンは AWS の認証にだけ使い、ほかの処理には渡さない
    const oidcToken = headers['x-vercel-oidc-token'] ?? null
    delete headers['x-vercel-oidc-token']

    const known = readVisitorId(headers.cookie)
    const visitorId = known ?? randomUUID()
    const setCookie: Record<string, string> = known
      ? {}
      : { 'Set-Cookie': `${VISITOR_COOKIE}=${visitorId}; Path=/api/ai; Max-Age=${VISITOR_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Strict` }

    try {
      const response = await runWithOidcToken(oidcToken, () =>
        setup.handle({ method: req.method ?? 'GET', path: url.pathname, headers, body, identity: `visitor:${visitorId}` }),
      )
      sendResponse(res, response, setCookie)
    } catch (error) {
      log.error('unexpected_error', { kind: errorKind(error) })
      sendError(res, 500, 'server_error', 'サーバーでエラーが起きました。')
    }
  }
}
