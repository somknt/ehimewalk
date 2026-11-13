// HTTP の処理（ルーティング・入力の受け取り・応答の形）。フレームワークに依存しない形にしておき、
// ローカルでは node:http（src/local/server.ts）、将来は Lambda のハンドラーから同じ関数を呼ぶ。
import type { ServerConfig } from '../config'
import { errorKind, log } from '../log'
import { QuestError } from '../quests/types'
import type { QuestService } from '../quests/service'
import { validateQuestRequest } from '../quests/validateRequest'

/** 受け付ける本文の大きさの上限（選択肢の値しか送らないため小さくてよい） */
export const MAX_BODY_BYTES = 2048

export interface HttpRequest {
  method: string
  path: string
  headers: Record<string, string | undefined>
  /** 本文（文字列のまま）。大きすぎる場合は呼び出し側で 413 にしている */
  body: string
  /**
   * 利用者の識別子。サーバー側で決める（クライアントが送る値は使わない）。
   * ローカル開発では接続元の IP アドレス、公開運用では Cognito のユーザー ID にする
   */
  identity: string
}

export interface HttpResponse {
  status: number
  headers: Record<string, string>
  body: string
}

const SECURITY_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
}

function json(status: number, data: unknown, extra: Record<string, string> = {}): HttpResponse {
  return { status, headers: { ...SECURITY_HEADERS, ...extra }, body: JSON.stringify(data) }
}

function errorBody(status: number, code: string, message: string, remainingToday?: number) {
  return json(status, { error: { code, message, ...(remainingToday !== undefined ? { remainingToday } : {}) } })
}

export function createHandler(deps: { config: ServerConfig; service: QuestService }) {
  const { config, service } = deps

  return async function handle(request: HttpRequest): Promise<HttpResponse> {
    const origin = request.headers.origin
    // ほかのサイトからの呼び出し（回数を勝手に使われる）を防ぐ。Origin があるときは許可した配信元だけ
    if (origin && origin !== config.allowedOrigin) {
      return errorBody(403, 'forbidden_origin', 'このページからは利用できません。')
    }
    const cors: Record<string, string> = origin ? { 'Access-Control-Allow-Origin': config.allowedOrigin, Vary: 'Origin' } : {}

    if (request.method === 'OPTIONS') {
      return { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' }
    }

    const withCors = (response: HttpResponse): HttpResponse => ({ ...response, headers: { ...response.headers, ...cors } })

    if (request.path === '/api/health' && request.method === 'GET') {
      return withCors(json(200, { ok: true }))
    }

    if (request.path === '/api/ai/quests/quota' && request.method === 'GET') {
      return withCors(json(200, service.status(request.identity)))
    }

    if (request.path === '/api/ai/quests/generate') {
      if (request.method !== 'POST') return withCors(errorBody(405, 'method_not_allowed', 'この操作はできません。'))
      // JSON 以外（フォームの送信など）は受け付けない
      if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
        return withCors(errorBody(415, 'unsupported_media_type', 'リクエストの形式が正しくありません。'))
      }
      let body: unknown
      try {
        body = JSON.parse(request.body)
      } catch {
        return withCors(errorBody(400, 'invalid_input', 'リクエストの形式が正しくありません。'))
      }
      try {
        const conditions = validateQuestRequest(body)
        const result = await service.generate(conditions, request.identity)
        return withCors(json(200, result))
      } catch (error) {
        if (error instanceof QuestError) {
          const remaining = error.remainingToday ?? service.status(request.identity).remainingToday
          return withCors(errorBody(error.status, error.code, error.message, remaining))
        }
        // 想定外のエラーの詳細は返さない（ログにも種類だけを残す）
        log.error('unexpected_error', { kind: errorKind(error), path: request.path })
        return withCors(errorBody(500, 'server_error', 'サーバーでエラーが起きました。時間をおいて、もう一度お試しください。'))
      }
    }

    return withCors(errorBody(404, 'not_found', '見つかりません。'))
  }
}
