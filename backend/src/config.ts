// サーバーの設定。値は環境変数（backend/.env）から読み、ここで検証する。
// 秘密情報（Bedrock の API キー）は ServerConfig の外に出さない：toPublicConfig() やログには含めない。

/** 学校から指定されたモデルだけを使う */
export const ALLOWED_MODEL_IDS = ['jp.amazon.nova-2-lite-v1:0', 'jp.anthropic.claude-haiku-5-5'] as const
export type ModelId = (typeof ALLOWED_MODEL_IDS)[number]
export const DEFAULT_MODEL_ID: ModelId = 'jp.amazon.nova-2-lite-v1:0'

/** 学校から指定されたリージョンだけを使う */
export const ALLOWED_REGIONS = ['ap-northeast-1'] as const

/** 学校の指定：1 ユーザー 1 日最大 10 回。設定でこれより増やすことはできない */
export const MAX_USER_DAILY_LIMIT = 10
/** アプリの既定：1 ユーザー 1 日 5 回（2026-11-14 決定。ブラウザ内モックの AI_QUEST_DAILY_LIMIT と同じ） */
export const DEFAULT_USER_DAILY_LIMIT = 5

export type AiProviderName = 'mock' | 'bedrock'

export interface ServerConfig {
  provider: AiProviderName
  bedrock: {
    region: (typeof ALLOWED_REGIONS)[number]
    modelId: ModelId
    /** API キー。未設定なら null。この値をログ・レスポンスに出さない */
    apiKey: string | null
  }
  limits: {
    userDailyLimit: number
    globalDailyLimit: number
    maxConcurrency: number
    cacheTtlMs: number
    timeoutMs: number
    maxTokens: number
    maxCandidates: number
  }
  port: number
  allowedOrigin: string
  quotaFile: string
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(`設定の誤り：${message}`)
    this.name = 'ConfigError'
  }
}

type Env = Record<string, string | undefined>

function intIn(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} は ${min}〜${max} の整数にしてください`)
  }
  return value
}

export function loadConfig(env: Env = process.env): ServerConfig {
  const provider = (env.AI_PROVIDER?.trim() || 'mock') as AiProviderName
  if (provider !== 'mock' && provider !== 'bedrock') throw new ConfigError('AI_PROVIDER は mock か bedrock にしてください')

  const modelId = (env.BEDROCK_MODEL_ID?.trim() || DEFAULT_MODEL_ID) as ModelId
  if (!ALLOWED_MODEL_IDS.includes(modelId)) {
    throw new ConfigError(`BEDROCK_MODEL_ID は ${ALLOWED_MODEL_IDS.join(' / ')} のどちらかにしてください`)
  }
  const region = (env.BEDROCK_REGION?.trim() || 'ap-northeast-1') as ServerConfig['bedrock']['region']
  if (!ALLOWED_REGIONS.includes(region)) throw new ConfigError(`BEDROCK_REGION は ${ALLOWED_REGIONS.join(' / ')} にしてください`)

  const apiKey = env.AWS_BEARER_TOKEN_BEDROCK?.trim() || null

  return {
    provider,
    bedrock: { region, modelId, apiKey },
    limits: {
      userDailyLimit: intIn(env, 'AI_QUEST_USER_DAILY_LIMIT', DEFAULT_USER_DAILY_LIMIT, 1, MAX_USER_DAILY_LIMIT),
      globalDailyLimit: intIn(env, 'AI_QUEST_GLOBAL_DAILY_LIMIT', 200, 1, 10_000),
      maxConcurrency: intIn(env, 'AI_QUEST_MAX_CONCURRENCY', 2, 1, 10),
      cacheTtlMs: intIn(env, 'AI_QUEST_CACHE_TTL_SECONDS', 600, 0, 86_400) * 1000,
      timeoutMs: intIn(env, 'AI_QUEST_TIMEOUT_MS', 20_000, 1_000, 60_000),
      maxTokens: intIn(env, 'AI_QUEST_MAX_TOKENS', 800, 200, 1_500),
      maxCandidates: intIn(env, 'AI_QUEST_MAX_CANDIDATES', 5, 1, 8),
    },
    port: intIn(env, 'PORT', 8787, 1, 65_535),
    allowedOrigin: env.ALLOWED_ORIGIN?.trim() || 'http://localhost:5173',
    quotaFile: env.AI_QUEST_QUOTA_FILE?.trim() || '.data/ai-quota.json',
  }
}

/** Bedrock を実際に呼べる状態か（API キーの有無だけを返し、値は返さない） */
export function isBedrockConfigured(config: ServerConfig): boolean {
  return config.provider === 'bedrock' && config.bedrock.apiKey !== null
}

/** 画面に返してよい設定だけ */
export function toPublicConfig(config: ServerConfig) {
  return {
    provider: config.provider,
    model: config.provider === 'bedrock' ? config.bedrock.modelId : null,
    configured: config.provider === 'mock' || config.bedrock.apiKey !== null,
    dailyLimit: config.limits.userDailyLimit,
  }
}
