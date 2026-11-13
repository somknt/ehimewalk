// Amazon Bedrock の Converse API の呼び出し（API キーによる Bearer 認証）。
// https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys-use.html
// - API キーは Authorization ヘッダーにだけ入れ、ログ・エラー・戻り値に含めない
// - 自動の再試行はしない（料金と回数制限を守るため）
// - タイムアウトと maxTokens を必ず付ける
import type { ServerConfig } from '../../config'
import { buildUserMessage, QUEST_TOOL_NAME, questToolSchema, SYSTEM_PROMPT } from '../prompt'
import { extractJson } from '../parseResponse'
import type { AiQuestPrompt, AiUsage } from '../types'
import { ProviderError, type AiQuestProvider } from './types'

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/** temperature を指定できるモデルか（2026-11-13 の実接続で確認） */
export function supportsTemperature(modelId: string): boolean {
  return modelId.startsWith('jp.amazon.nova-')
}

interface ConverseResponse {
  output?: { message?: { content?: { text?: string; toolUse?: { name?: string; input?: unknown } }[] } }
  usage?: { inputTokens?: number; outputTokens?: number }
}

export class BedrockQuestProvider implements AiQuestProvider {
  readonly name = 'bedrock' as const
  readonly model: string
  private readonly config: ServerConfig
  private readonly fetchImpl: FetchLike

  constructor(config: ServerConfig, fetchImpl: FetchLike = fetch) {
    this.config = config
    this.model = config.bedrock.modelId
    this.fetchImpl = fetchImpl
  }

  isConfigured(): boolean {
    return this.config.bedrock.apiKey !== null
  }

  /** Converse API の URL。モデル ID の「:」などはエンコードする */
  endpoint(): string {
    const { region, modelId } = this.config.bedrock
    return `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/converse`
  }

  /** 送信する本文（テストで中身を確かめられるよう分けている） */
  requestBody(prompt: AiQuestPrompt) {
    return {
      system: [{ text: SYSTEM_PROMPT }],
      messages: [{ role: 'user', content: [{ text: buildUserMessage(prompt) }] }],
      inferenceConfig: {
        maxTokens: this.config.limits.maxTokens,
        // Claude Haiku 5.5 は temperature を受け付けない（400 ValidationException になる）ため、Nova にだけ付ける
        ...(supportsTemperature(this.model) ? { temperature: 0.2 } : {}),
      },
      toolConfig: {
        tools: [
          {
            toolSpec: {
              name: QUEST_TOOL_NAME,
              description: '散策クエストの提案を返す',
              inputSchema: { json: questToolSchema(prompt.candidates.map((c) => c.spotId)) },
            },
          },
        ],
        toolChoice: { tool: { name: QUEST_TOOL_NAME } },
      },
    }
  }

  async generate(prompt: AiQuestPrompt): Promise<{ raw: unknown; usage: AiUsage }> {
    const apiKey = this.config.bedrock.apiKey
    if (!apiKey) throw new ProviderError('not_configured')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.limits.timeoutMs)
    let response: Response
    try {
      response = await this.fetchImpl(this.endpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(this.requestBody(prompt)),
        signal: controller.signal,
      })
    } catch {
      // 元のエラーには URL やヘッダーが含まれることがあるため、種類だけを伝える
      throw new ProviderError(controller.signal.aborted ? 'timeout' : 'network')
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      // 応答の本文（エラーの詳細）は読まずに捨てる
      await response.body?.cancel().catch(() => undefined)
      throw new ProviderError(response.status === 429 ? 'throttled' : 'rejected', response.status)
    }

    let data: ConverseResponse
    try {
      data = (await response.json()) as ConverseResponse
    } catch {
      throw new ProviderError('bad_response')
    }

    const usage: AiUsage = {
      inputTokens: data.usage?.inputTokens ?? null,
      outputTokens: data.usage?.outputTokens ?? null,
    }
    const content = data.output?.message?.content ?? []
    const toolUse = content.find((block) => block.toolUse?.name === QUEST_TOOL_NAME)?.toolUse
    if (toolUse) return { raw: toolUse.input, usage }

    // ツールを使わずに文章で返したときは、その中の JSON を読む（検証は呼び出し側）
    const text = content
      .map((block) => block.text ?? '')
      .join('\n')
      // Nova は <thinking> タグで考えを出すことがあるため除く
      .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
    return { raw: extractJson(text), usage }
  }
}
