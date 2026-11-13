// 設定から、AI の呼び出し口・回数管理・HTTP の処理を組み立てる（ローカルサーバーとテストで共通）。
import { isBedrockConfigured, type ServerConfig } from './config'
import { createHandler } from './http/handler'
import { FileQuotaStore, MemoryQuotaStore, type QuotaStore } from './limits/quota'
import { log, registerSecret } from './log'
import { BedrockQuestProvider, type FetchLike } from './quests/providers/bedrock'
import { MockQuestProvider } from './quests/providers/mock'
import type { AiQuestProvider } from './quests/providers/types'
import { QuestService } from './quests/service'

export interface AppOptions {
  config: ServerConfig
  quotaStore?: QuotaStore
  provider?: AiQuestProvider
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
      ? new BedrockQuestProvider(config, options.fetchImpl)
      : new MockQuestProvider({ delayMs: options.mockDelayMs }))

  if (config.provider === 'bedrock' && !isBedrockConfigured(config)) {
    // キーの値は出さず、未設定であることだけを知らせる
    log.warn('bedrock_api_key_missing', { message: 'AWS_BEARER_TOKEN_BEDROCK が未設定です。AI の提案は作れません。' })
  }

  const quotaStore = options.quotaStore ?? (config.quotaFile ? new FileQuotaStore(config.quotaFile) : new MemoryQuotaStore())
  const service = new QuestService({ config, provider, quotaStore, now: options.now })
  return { service, handle: createHandler({ config, service }) }
}
