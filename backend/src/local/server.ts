// ローカル開発用の HTTP サーバー（node:http）。この PC の中からだけ接続できる（127.0.0.1 で待ち受け）。
// 起動：cd backend → npm run dev（backend/.env を読み込み、main.ts から startServer() を呼ぶ）
import { createServer } from 'node:http'
import { createApp } from '../app'
import { ConfigError, loadConfig, toPublicConfig } from '../config'
import { BodyTooLargeError, collectHeaders, readBody, sendError, sendResponse } from '../http/node'
import { errorKind, log } from '../log'

const HOST = '127.0.0.1'

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
      const tooLarge = error instanceof BodyTooLargeError
      sendError(res, tooLarge ? 413 : 400, tooLarge ? 'payload_too_large' : 'invalid_input', 'リクエストが正しくありません。')
      return
    }
    try {
      const response = await handle({
        method: req.method ?? 'GET',
        path: url.pathname,
        headers: collectHeaders(req),
        body,
        // X-Forwarded-For などのヘッダーは書き換えられるため使わない
        identity: `ip:${req.socket.remoteAddress ?? 'unknown'}`,
      })
      sendResponse(res, response)
    } catch (error) {
      log.error('unexpected_error', { kind: errorKind(error) })
      sendError(res, 500, 'server_error', 'サーバーでエラーが起きました。')
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
