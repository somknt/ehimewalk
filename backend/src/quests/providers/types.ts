import type { AiQuestPrompt, AiUsage } from '../types'

/** AI の呼び出し口。Bedrock とモックを同じ形で扱う（HTTP の処理とは分けておく） */
export interface AiQuestProvider {
  readonly name: 'mock' | 'bedrock'
  readonly model: string | null
  /** 呼び出せる状態か（API キーが設定されているか） */
  isConfigured(): boolean
  /** 回答（検証前）を返す。検証は呼び出し側で行う */
  generate(prompt: AiQuestPrompt): Promise<{ raw: unknown; usage: AiUsage }>
}

/**
 * kind：not_configured＝未設定（呼んでいない） / rejected＝Bedrock が HTTP エラーを返した（課金されない想定） /
 * timeout＝時間切れ（課金された可能性がある） / network＝通信の失敗 / bad_response＝回答の形が想定外
 */
export type ProviderErrorKind = 'not_configured' | 'rejected' | 'throttled' | 'timeout' | 'network' | 'bad_response'

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind
  /** Bedrock の HTTP ステータス（あれば） */
  readonly httpStatus: number | null

  constructor(kind: ProviderErrorKind, httpStatus: number | null = null) {
    // メッセージには外部の応答や秘密情報を入れない
    super(`AI provider error: ${kind}${httpStatus ? ` (${httpStatus})` : ''}`)
    this.name = 'ProviderError'
    this.kind = kind
    this.httpStatus = httpStatus
  }
}
