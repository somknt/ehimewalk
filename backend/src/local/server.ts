// ローカル開発用の HTTP サーバー（node:http）。この PC の中からだけ接続できる（127.0.0.1 で待ち受け）。
// 起動：cd backend → npm run dev（backend/.env を読み込み、main.ts から startServer() を呼ぶ）
import { createServer, type IncomingMessage } from 'node:http'
import { createApp } from '../app'
import { ConfigError, loadConfig, toPublicConfig } from '../config'
import { MAX_BODY_BYTES, type HttpRequest } from '../http/handler'
import { errorKind, log } from '../log'

const HOST = '127.0.0.1'

class BodyTooLargeError extends Error {}

function readBody(req: IncomingMessage): Promise<string> {
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

export function startServer(port?: number) {
  let config
  try {
    config = loadConfig()
  } catch (error) {
    // 設定の誤りの内容（変数名と範囲）だけを出す。値は出さない
    console.error(error instanceof ConfigError ? error.message : '設定を読み込めませんでした。')
    process.exit(1)
  }
  const { handle } = createApp({ config })

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    let body = ''
    try {
      body = await readBody(req)
    } catch (error) {
      const status = error instanceof BodyTooLargeError ? 413 : 400
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: { code: status === 413 ? 'payload_too_large' : 'invalid_input', message: 'リクエストが正しくありません。' } }))
      return
    }
    const headers: HttpRequest['headers'] = {}
    for (const [name, value] of Object.entries(req.headers)) headers[name.toLowerCase()] = Array.isArray(value) ? value[0] : value
    try {
      const response = await handle({
        method: req.method ?? 'GET',
        path: url.pathname,
        headers,
        body,
        // X-Forwarded-For などのヘッダーは書き換えられるため使わない
        identity: `ip:${req.socket.remoteAddress ?? 'unknown'}`,
      })
      res.writeHead(response.status, response.headers)
      res.end(response.body)
    } catch (error) {
      log.error('unexpected_error', { kind: errorKind(error) })
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: { code: 'server_error', message: 'サーバーでエラーが起きました。' } }))
    }
  })

  const listenPort = port ?? config.port
  server.listen(listenPort, HOST, () => {
    const pub = toPublicConfig(config)
    log.info('server_started', {
      url: `http://${HOST}:${listenPort}`,
      provider: pub.provider,
      model: pub.model,
      apiKeyConfigured: pub.configured,
      dailyLimit: pub.dailyLimit,
    })
  })
  return server
}
