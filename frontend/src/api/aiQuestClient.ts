// AI 散策クエストの API（backend）の呼び出し。Bedrock の API キーはブラウザに置かない：
// ブラウザ → backend（/api/ai/quests/...）→ Amazon Bedrock の順に呼ぶ。
// 開発中は Vite が /api を backend（http://127.0.0.1:8787）へ中継する（vite.config.ts）。
import { ApiError } from './types'

/** backend の場所。未設定なら同じオリジンの /api（開発サーバーの中継）を使う。ここに秘密情報を書かない */
const BASE_URL = (import.meta.env.VITE_AI_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''

/**
 * AI 散策クエストの API を使える環境か。
 * 開発サーバー（中継あり）か、VITE_AI_API_BASE_URL を設定したときだけ使う。
 * それ以外（GitHub Pages など backend がない公開版）は、従来のブラウザ内モックの画面を出す
 */
export const AI_QUEST_API_AVAILABLE: boolean = import.meta.env.DEV || BASE_URL !== ''

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

const CONNECT_ERROR = 'AIサーバーに接続できませんでした。AIサーバー（backend）が起動しているか確認してください。'
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
