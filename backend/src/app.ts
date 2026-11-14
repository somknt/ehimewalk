// 設定から、AI の呼び出し口・回数管理・HTTP の処理を組み立てる（ローカルサーバー・Vercel・テストで共通）。
import { isBedrockConfigured, type ServerConfig } from './config'
import { createHandler } from './http/handler'
import { FileQuotaStore, MemoryQuotaStore, StoreQuotaCounter, type QuotaCounter, type QuotaLike, type QuotaStore } from './limits/quota'
import { log, registerSecret } from './log'
import { ApiKeyTransport, BedrockQuestProvider, type ConverseTransport, type FetchLike } from './quests/providers/bedrock'
import { MockQuestProvider } from './quests/providers/mock'
import type { AiQuestProvider } from './quests/providers/types'
import { QuestService } from './quests/service'

export interface AppOptions {
  config: ServerConfig
  /** 回数を数える場所。省略時は設定に応じてファイルかメモリ */
  quotaCounter?: QuotaCounter
  /** 回数の管理そのものを差し替える（Supabase で数えるとき） */
  quota?: QuotaLike
  quotaStore?: QuotaStore
  provider?: AiQuestProvider
  /** Bedrock への送信の方法。省略時は API キー（ローカル開発） */
  transport?: ConverseTransport
  fetchImpl?: FetchLike
  now?: () => Date
  mockDelayMs?: number
}

export function createApp(options: AppOptions) {
  const { config } = options
  // API キーを、ログで伏せ字にする対象として登録する
  registerSecret(config.bedrock.apiKey)

  const provider =
    options.provider ??
    (config.provider === 'bedrock'
      ? new BedrockQuestProvider(config, options.transport ?? new ApiKeyTransport(config, options.fetchImpl))
      : new MockQuestProvider({ delayMs: options.mockDelayMs }))

  if (config.provider === 'bedrock' && !isBedrockConfigured(config)) {
    // キーの値は出さず、未設定であることだけを知らせる
    log.warn('bedrock_credentials_missing', { message: 'Bedrock の認証情報が未設定です。AI の提案は作れません。' })
  }

  const quotaCounter =
    options.quotaCounter ??
    new StoreQuotaCounter(options.quotaStore ?? (config.quotaFile ? new FileQuotaStore(config.quotaFile) : new MemoryQuotaStore()))
  const service = new QuestService({ config, provider, quotaCounter, quota: options.quota, now: options.now })
  return { service, handle: createHandler({ config, service }) }
}
