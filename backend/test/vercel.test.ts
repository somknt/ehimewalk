// 公開版（Vercel）の部品のテスト。AWS には接続しない（SDK のクライアントは偽物を使う）。
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentOidcToken, OidcTokenMissingError, runWithOidcToken, vercelOidcCredentials } from '../src/aws/oidc'
import { SdkConverseTransport, type BedrockClientLike } from '../src/aws/sdkTransport'
import { loadConfig } from '../src/config'
import { DynamoQuotaCounter, expiresAtFor, type DynamoClientLike } from '../src/limits/dynamoQuota'
import { ProviderError } from '../src/quests/providers/types'
import { createVercelHandler, readVisitorId, VISITOR_COOKIE, type VercelDeps } from '../src/vercel/handler'
import { FAKE_KEY, NOW, converseToolResponse, goodAiAnswer, validRequest } from './helpers'

/** 条件付き書き込みを再現する偽の DynamoDB（メモリ上） */
function fakeDynamo() {
  const items = new Map<string, { count: number; expiresAt: number }>()
  const sent: unknown[] = []
  const client: DynamoClientLike = {
    async send(command) {
      sent.push(command)
      if (command instanceof GetItemCommand) {
        const item = items.get(command.input.Key!.pk.S!)
        return { Item: item ? { count: { N: String(item.count) } } : undefined }
      }
      if (command instanceof TransactWriteItemsCommand) {
        const updates = command.input.TransactItems!.map((t) => t.Update!)
        const results = updates.map((u) => {
          const pk = u.Key!.pk.S!
          const current = items.get(pk)?.count
          const delta = Number(u.ExpressionAttributeValues![':delta'].N)
          const ok = delta > 0 ? current === undefined || current < Number(u.ExpressionAttributeValues![':limit'].N) : (current ?? 0) > 0
          return { pk, delta, ok, exp: Number(u.ExpressionAttributeValues![':exp'].N) }
        })
        if (results.some((r) => !r.ok)) {
          throw Object.assign(new Error('cancelled'), {
            name: 'TransactionCanceledException',
            CancellationReasons: results.map((r) => ({ Code: r.ok ? 'None' : 'ConditionalCheckFailed' })),
          })
        }
        for (const r of results) items.set(r.pk, { count: (items.get(r.pk)?.count ?? 0) + r.delta, expiresAt: r.exp })
        return {}
      }
      throw new Error('unexpected command')
    },
  }
  return { client, items, sent }
}

describe('DynamoDB の回数管理', () => {
  const limits = { user: 10, global: 12 }

  it('1 人 1 日 10 回まで数え、11 回目は数えない', async () => {
    const db = fakeDynamo()
    const counter = new DynamoQuotaCounter(db.client, 'ewq-ai-quota')
    for (let i = 0; i < 10; i += 1) expect(await counter.increment('2026-11-14', 'u1', limits)).toBe('ok')
    expect(await counter.increment('2026-11-14', 'u1', limits)).toBe('user_limit')
    expect(await counter.used('2026-11-14', 'u1')).toBe(10)
    // 上限で止めたときは、全体の回数も増えない（トランザクション全体が取り消される）
    expect(db.items.get('2026-11-14#global')?.count).toBe(10)
  })

  it('アプリ全体の上限に達したら、だれも数えない', async () => {
    const db = fakeDynamo()
    const counter = new DynamoQuotaCounter(db.client, 'ewq-ai-quota')
    for (let i = 0; i < 10; i += 1) await counter.increment('2026-11-14', 'u1', limits)
    expect(await counter.increment('2026-11-14', 'u2', limits)).toBe('ok')
    expect(await counter.increment('2026-11-14', 'u2', limits)).toBe('ok')
    expect(await counter.increment('2026-11-14', 'u3', limits)).toBe('global_limit')
    expect(await counter.used('2026-11-14', 'u3')).toBe(0)
  })

  it('取り消しはその日の回数だけを 1 戻し、0 より小さくしない', async () => {
    const db = fakeDynamo()
    const counter = new DynamoQuotaCounter(db.client, 'ewq-ai-quota')
    await counter.increment('2026-11-14', 'u1', limits)
    await counter.decrement('2026-11-14', 'u1')
    await counter.decrement('2026-11-14', 'u1')
    expect(await counter.used('2026-11-14', 'u1')).toBe(0)
    expect(db.items.get('2026-11-14#global')?.count).toBe(0)
  })

  it('日付ごとに別に数え、記録は数日後に自動で消える設定にする', async () => {
    const db = fakeDynamo()
    const counter = new DynamoQuotaCounter(db.client, 'ewq-ai-quota')
    for (let i = 0; i < 10; i += 1) await counter.increment('2026-11-14', 'u1', limits)
    expect(await counter.increment('2026-11-15', 'u1', limits)).toBe('ok')
    expect(db.items.get('2026-11-14#user#u1')?.expiresAt).toBe(expiresAtFor('2026-11-14'))
    // 日本時間 2026-11-14 0:00 の 3 日後
    expect(expiresAtFor('2026-11-14')).toBe(Date.parse('2026-11-17T00:00:00+09:00') / 1000)
  })

  it('送り直しても二重に数えないよう、書き込みごとにトークンを付ける', async () => {
    const db = fakeDynamo()
    await new DynamoQuotaCounter(db.client, 'ewq-ai-quota').increment('2026-11-14', 'u1', limits)
    const write = db.sent.find((c) => c instanceof TransactWriteItemsCommand) as TransactWriteItemsCommand
    expect(write.input.ClientRequestToken).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('AWS SDK での Bedrock 呼び出し', () => {
  const body = { system: [], messages: [], inferenceConfig: { maxTokens: 800 }, toolConfig: { tools: [], toolChoice: { tool: { name: 'x' } } } }
  const failing = (error: unknown): BedrockClientLike => ({ send: async () => Promise.reject(error) })

  it('モデル ID と本文をそのまま渡し、中止の合図も渡す', async () => {
    let seen: { input: unknown; signal: AbortSignal | undefined } | null = null
    const transport = new SdkConverseTransport({
      send: async (command, options) => {
        seen = { input: command.input, signal: options?.abortSignal }
        return converseToolResponse(goodAiAnswer)
      },
    })
    const controller = new AbortController()
    await transport.converse('jp.amazon.nova-2-lite-v1:0', body as never, controller.signal)
    expect(seen!.input).toMatchObject({ modelId: 'jp.amazon.nova-2-lite-v1:0', inferenceConfig: { maxTokens: 800 } })
    expect(seen!.signal).toBe(controller.signal)
  })

  it.each([
    [{ name: 'ThrottlingException', $metadata: { httpStatusCode: 429 } }, 'throttled'],
    [{ name: 'ValidationException', $metadata: { httpStatusCode: 400 } }, 'rejected'],
    [{ name: 'AccessDeniedException', $metadata: { httpStatusCode: 403 } }, 'rejected'],
    [new OidcTokenMissingError(), 'not_configured'],
    [new Error('socket hang up'), 'network'],
  ])('失敗は種類だけのエラーにする（%o → %s）', async (error, kind) => {
    const promise = new SdkConverseTransport(failing(error)).converse('m', body as never, new AbortController().signal)
    await expect(promise).rejects.toBeInstanceOf(ProviderError)
    await expect(promise).rejects.toMatchObject({ kind })
  })

  it('時間切れで中止したときは timeout にする', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(new SdkConverseTransport(failing(new Error('aborted'))).converse('m', body as never, controller.signal)).rejects.toMatchObject({
      kind: 'timeout',
    })
  })
})

describe('Vercel の OIDC による一時的な認証情報', () => {
  const creds = (expiresInMs: number, now: number) => ({ accessKeyId: 'AKIA_TEST', secretAccessKey: 'secret', expiration: new Date(now + expiresInMs) })

  it('リクエストの OIDC トークンがなければ取得しない', async () => {
    const credentials = vercelOidcCredentials({ assumeRole: async () => creds(900_000, Date.now()) })
    await expect(credentials()).rejects.toBeInstanceOf(OidcTokenMissingError)
    await expect(runWithOidcToken(null, () => credentials())).rejects.toBeInstanceOf(OidcTokenMissingError)
  })

  it('期限まで使い回し、切れそうになったら処理中のリクエストのトークンで取り直す', async () => {
    let now = 1_000_000
    const tokens: string[] = []
    const credentials = vercelOidcCredentials({
      now: () => now,
      assumeRole: async (token) => {
        tokens.push(token)
        return creds(900_000, now)
      },
    })
    await runWithOidcToken('token-1', () => Promise.all([credentials(), credentials()]))
    await runWithOidcToken('token-2', () => credentials())
    expect(tokens).toEqual(['token-1'])
    now += 800_000 // 残り 100 秒（取り直す目安の 2 分を切った）
    await runWithOidcToken('token-3', () => credentials())
    expect(tokens).toEqual(['token-1', 'token-3'])
  })
})

describe('Vercel の関数（/api/...）', () => {
  let server: Server | null = null
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
    server = null
  })

  async function start(deps: VercelDeps) {
    const handler = createVercelHandler({ now: () => NOW, mockDelayMs: 0, ...deps })
    server = createServer((req, res) => void handler(req, res))
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`
    return (path: string, init: RequestInit = {}) => fetch(base + path, init)
  }

  const ORIGIN = 'https://ehime-walk.vercel.app'
  const generate = (cookie?: string, extra: Record<string, string> = {}) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...(cookie ? { cookie } : {}), ...extra },
    body: JSON.stringify(validRequest),
  })
  const readJson = async (res: Response): Promise<any> => res.json()
  const cookieOf = (res: Response) => res.headers.get('set-cookie')?.split(';')[0] ?? ''

  it('AI_PROVIDER を設定していない環境では AI の機能を無効にする', async () => {
    const call = await start({ env: {} })
    const res = await call('/api/ai/quests/quota')
    expect(res.status).toBe(404)
    expect((await readJson(res)).error.code).toBe('ai_disabled')
  })

  it('Bedrock を使う設定でも、ロールと回数のテーブルがなければ無効にする（API キーだけでは動かさない）', async () => {
    const call = await start({ env: { AI_PROVIDER: 'bedrock', AWS_BEARER_TOKEN_BEDROCK: FAKE_KEY, ALLOWED_ORIGIN: ORIGIN } })
    expect((await call('/api/ai/quests/quota')).status).toBe(404)
  })

  it('匿名の ID を HttpOnly の Cookie で発行し、ID ごとに回数を数える', async () => {
    const call = await start({ env: { AI_PROVIDER: 'mock', ALLOWED_ORIGIN: ORIGIN } })
    const first = await call('/api/ai/quests/quota')
    expect(first.status).toBe(200)
    const setCookie = first.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(new RegExp(`^${VISITOR_COOKIE}=[0-9a-f-]{36}; Path=/api/ai; Max-Age=\\d+; HttpOnly; Secure; SameSite=Strict$`))
    const cookie = cookieOf(first)

    const res = await call('/api/ai/quests/generate', generate(cookie))
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect((await readJson(res)).remainingToday).toBe(9)
    expect((await readJson(await call('/api/ai/quests/quota', { headers: { cookie } }))).remainingToday).toBe(9)
    // 別の ID は別に数える
    const other = cookieOf(await call('/api/ai/quests/quota'))
    expect(other).not.toBe(cookie)
    expect((await readJson(await call('/api/ai/quests/quota', { headers: { cookie: other } }))).remainingToday).toBe(10)
  })

  it('許可していない配信元からは使えない', async () => {
    const call = await start({ env: { AI_PROVIDER: 'mock', ALLOWED_ORIGIN: ORIGIN } })
    const res = await call('/api/ai/quests/generate', generate(undefined, { origin: 'https://evil.example' }))
    expect(res.status).toBe(403)
  })

  it('Bedrock には OIDC の認証で接続し、Vercel に API キーがあっても使わない', async () => {
    const db = fakeDynamo()
    const seenTokens: (string | null)[] = []
    const bedrock: BedrockClientLike = {
      async send() {
        // AWS SDK が認証情報を求めるのはこの中。処理中のリクエストのトークンが見えること
        seenTokens.push(currentOidcToken())
        return converseToolResponse(goodAiAnswer)
      },
    }
    // Bedrock の URL へ fetch（API キーの方式）で接続しないこと
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const call = await start({
      env: {
        AI_PROVIDER: 'bedrock',
        AWS_BEARER_TOKEN_BEDROCK: FAKE_KEY,
        AWS_ROLE_ARN: 'arn:aws:iam::123456789012:role/ehime-walk-ai-quest',
        AI_QUEST_QUOTA_TABLE: 'ewq-ai-quota',
        ALLOWED_ORIGIN: ORIGIN,
      },
      aws: { bedrock, dynamo: db.client },
    })
    const quota = await call('/api/ai/quests/quota')
    const status = await readJson(quota)
    expect(status).toMatchObject({ provider: 'bedrock', configured: true, remainingToday: 10 })
    const res = await call('/api/ai/quests/generate', generate(cookieOf(quota), { 'x-vercel-oidc-token': 'oidc-test-token' }))
    const data = await readJson(res)
    expect(res.status).toBe(200)
    expect(data.quest.spots.map((s: { spotId: string }) => s.spotId)).toEqual(goodAiAnswer.spotIds)
    expect(seenTokens).toEqual(['oidc-test-token'])
    // 回数は DynamoDB に記録する
    expect([...db.items.values()].map((i) => i.count)).toEqual([1, 1])
    expect(fetchSpy.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('amazonaws'))).toEqual([])
    fetchSpy.mockRestore()
  })

  it('Cookie の ID は形が正しいものだけを使う', () => {
    expect(readVisitorId(`a=1; ${VISITOR_COOKIE}=0f8fad5b-d9cb-469f-a165-70867728950e`)).toBe('0f8fad5b-d9cb-469f-a165-70867728950e')
    expect(readVisitorId(`${VISITOR_COOKIE}=../../etc`)).toBeNull()
    expect(readVisitorId(undefined)).toBeNull()
  })
})

describe('設定', () => {
  it('AWS_ROLE_ARN と ALLOWED_ORIGIN の形を確かめる', () => {
    expect(() => loadConfig({ AWS_ROLE_ARN: 'not-an-arn' })).toThrow(/AWS_ROLE_ARN/)
    expect(() => loadConfig({ ALLOWED_ORIGIN: 'https://ehime-walk.vercel.app/path' })).toThrow(/ALLOWED_ORIGIN/)
    expect(loadConfig({ ALLOWED_ORIGIN: 'https://a.example, https://b.example/' }).allowedOrigins).toEqual(['https://a.example', 'https://b.example'])
  })
})
