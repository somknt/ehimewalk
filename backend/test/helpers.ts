import { loadConfig, type ServerConfig } from '../src/config'
import { createApp } from '../src/app'
import { MemoryQuotaStore } from '../src/limits/quota'
import type { FetchLike } from '../src/quests/providers/bedrock'

/** テスト用の偽の API キー（本物ではない） */
export const FAKE_KEY = 'test-fake-bedrock-key-0123456789'

/** 2026-11-12 12:00 JST */
export const NOW = new Date('2026-11-12T03:00:00Z')

export function testConfig(env: Record<string, string> = {}): ServerConfig {
  return { ...loadConfig({ AI_PROVIDER: 'bedrock', AWS_BEARER_TOKEN_BEDROCK: FAKE_KEY, ...env }), quotaFile: '' }
}

export const validRequest = { startSpotId: 'matsuyama_castle', minutes: 60, genre: 'history', load: 'normal' }

/** Converse API の応答（ツールで回答した形） */
export function converseToolResponse(input: unknown) {
  return {
    output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: 't1', name: 'propose_walking_quest', input } }] } },
    usage: { inputTokens: 500, outputTokens: 200 },
    stopReason: 'tool_use',
  }
}

export const goodAiAnswer = {
  title: '松山の歴史さんぽ',
  description: '松山城から道後温泉本館まで、歴史を感じて歩きます。',
  estimatedMinutes: 55,
  spotIds: ['matsuyama_castle', 'dogo_onsen_honkan'],
  steps: [
    { spotId: 'matsuyama_castle', description: '現存12天守の一つを見学します。' },
    { spotId: 'dogo_onsen_honkan', description: '重要文化財の建物を外から眺めます。' },
  ],
}

export interface FakeFetch {
  fetch: FetchLike
  calls: { url: string; init: RequestInit }[]
}

/** 毎回同じ応答を返す偽の fetch（Bedrock には接続しない） */
export function fakeFetch(respond: () => Response | Promise<Response>): FakeFetch {
  const calls: FakeFetch['calls'] = []
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init })
      return respond()
    },
  }
}

export const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

export function makeApp(options: { env?: Record<string, string>; fetch?: FetchLike; now?: () => Date } = {}) {
  const quotaStore = new MemoryQuotaStore()
  const app = createApp({
    config: testConfig(options.env),
    quotaStore,
    fetchImpl: options.fetch,
    now: options.now ?? (() => NOW),
    mockDelayMs: 0,
  })
  return { ...app, quotaStore }
}

export function post(body: unknown, identity = 'ip:127.0.0.1', headers: Record<string, string> = {}) {
  return {
    method: 'POST',
    path: '/api/ai/quests/generate',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5173', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    identity,
  }
}
