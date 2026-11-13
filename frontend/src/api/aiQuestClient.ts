// AI 散策クエストの API（backend）の呼び出し。Bedrock の API キーはブラウザに置かない：
// ブラウザ → backend（/api/ai/quests/...）→ Amazon Bedrock の順に呼ぶ。
// 開発中は Vite が /api を backend（http://127.0.0.1:8787）へ中継する（vite.config.ts）。
import { ApiError } from './types'

/**
 * backend の場所。未設定なら同じオリジンの /api を使う（開発中は Vite の中継、公開版は Vercel Functions）。
 * ここに秘密情報を書かない
 */
const BASE_URL = (import.meta.env.VITE_AI_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''

let availability: Promise<boolean> | null = null

/**
 * AI 散策クエストの API を使える環境か。
 * - 開発サーバー：常に使う（backend が起動していなければ、画面で接続エラーを知らせる）
 * - 公開版：API に 1 回だけ問い合わせ、AI の設定が済んでいるときだけ使う。
 *   API がない・未設定の環境（AI を設定していない Vercel のプロジェクトなど）では、従来のブラウザ内の提案を出す
 */
export function checkAiQuestApi(): Promise<boolean> {
  if (import.meta.env.DEV) return Promise.resolve(true)
  availability ??= aiQuestClient.getStatus().then(
    (status) => status.configured,
    () => false,
  )
  return availability
}

export const AI_QUEST_MINUTES = [15, 30, 45, 60] as const
export const AI_QUEST_DISTANCES_M = [1000, 2000, 3000, 5000] as const

export interface AiQuestRequest {
  startSpotId: string
  currentLocation?: { latitude: number; longitude: number }
  minutes: (typeof AI_QUEST_MINUTES)[number]
  genre: string
  maxDistanceM: (typeof AI_QUEST_DISTANCES_M)[number] | null
  load: 'easy' | 'normal' | 'active'
}

export interface AiQuest {
  questId: string
  title: string
  description: string
  estimatedMinutes: number
  startLabel: string
  spots: { order: number; spotId: string; name: string; municipality: string; description: string; legM: number }[]
  route: { basis: 'straight_line'; distanceM: number; minutes: number; steps: number }
  generatedBy: 'mock' | 'bedrock'
  model: string | null
  createdAt: string
}

export type AiQuestResult =
  | { status: 'ok'; quest: AiQuest; cached: boolean; remainingToday: number; dailyLimit: number }
  | { status: 'no_spots'; nearest: { spotId: string; name: string; distanceM: number } | null; remainingToday: number; dailyLimit: number }

export interface AiQuestStatus {
  remainingToday: number
  dailyLimit: number
  provider: 'mock' | 'bedrock'
  model: string | null
  configured: boolean
}

/** API のエラー。message は backend が返した、画面にそのまま出せる日本語 */
export class AiQuestError extends ApiError {
  readonly apiCode: string
  readonly remainingToday: number | undefined
  constructor(message: string, apiCode: string, remainingToday?: number) {
    super(message)
    this.apiCode = apiCode
    this.remainingToday = remainingToday
  }
}

const CONNECT_ERROR = import.meta.env.DEV
  ? 'AIサーバーに接続できませんでした。AIサーバー（backend）が起動しているか確認してください。'
  : 'AIサーバーに接続できませんでした。時間をおいて、もう一度お試しください。'
/** ブラウザ側の待ち時間の上限（backend 側のタイムアウトより少し長くする） */
const CLIENT_TIMEOUT_MS = 30_000

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, { ...init, signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS) })
  } catch {
    throw new AiQuestError(CONNECT_ERROR, 'network')
  }
  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    // JSON でない応答（中継先の backend が起動していないときなど）
  }
  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string; remainingToday?: number } } | null)?.error
    if (error?.message) throw new AiQuestError(error.message, error.code ?? 'error', error.remainingToday)
    throw new AiQuestError(CONNECT_ERROR, 'network')
  }
  if (data === null) throw new AiQuestError(CONNECT_ERROR, 'network')
  return data as T
}

export const aiQuestClient = {
  getStatus: () => request<AiQuestStatus>('/api/ai/quests/quota'),
  generate: (body: AiQuestRequest) =>
    request<AiQuestResult>('/api/ai/quests/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
}
