// node:http のリクエスト・レスポンスと、handler.ts の形を変換する（ローカルサーバーと Vercel の関数で共通）。
import type { IncomingMessage, ServerResponse } from 'node:http'
import { MAX_BODY_BYTES, type HttpRequest, type HttpResponse } from './handler'

export class BodyTooLargeError extends Error {}

/** 本文を読む。上限を超えたら BodyTooLargeError */
export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new BodyTooLargeError())
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** ヘッダー名を小文字にそろえ、複数ある場合は最初の値を使う */
export function collectHeaders(req: IncomingMessage): HttpRequest['headers'] {
  const headers: HttpRequest['headers'] = {}
  for (const [name, value] of Object.entries(req.headers)) headers[name.toLowerCase()] = Array.isArray(value) ? value[0] : value
  return headers
}

export function sendResponse(res: ServerResponse, response: HttpResponse, extraHeaders: Record<string, string> = {}): void {
  res.writeHead(response.status, { ...response.headers, ...extraHeaders })
  res.end(response.body)
}

export function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify({ error: { code, message } }))
}
