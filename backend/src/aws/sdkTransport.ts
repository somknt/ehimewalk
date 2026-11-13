// 公開版（Vercel）での Bedrock の呼び出し。AWS SDK に一時的な認証情報（oidc.ts）を渡して呼ぶ。
// SDK の自動の再試行は止める（料金と回数制限を守るため）。
import { BedrockRuntimeClient, ConverseCommand, type ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime'
import type { AwsCredentialIdentityProvider } from '@smithy/types'
import { ProviderError } from '../quests/providers/types'
import type { ConverseBody, ConverseResponse, ConverseTransport } from '../quests/providers/bedrock'

/** BedrockRuntimeClient の必要な部分だけ（テストでは偽物を渡す） */
export interface BedrockClientLike {
  send(command: ConverseCommand, options?: { abortSignal?: AbortSignal }): Promise<unknown>
}

export function createBedrockClient(options: { region: string; credentials: AwsCredentialIdentityProvider }): BedrockClientLike {
  return new BedrockRuntimeClient({ region: options.region, credentials: options.credentials, maxAttempts: 1 })
}

interface SdkErrorShape {
  name?: string
  $metadata?: { httpStatusCode?: number }
  $fault?: 'client' | 'server'
}

export class SdkConverseTransport implements ConverseTransport {
  readonly configured: boolean
  private readonly client: BedrockClientLike

  constructor(client: BedrockClientLike, configured = true) {
    this.client = client
    this.configured = configured
  }

  async converse(modelId: string, body: ConverseBody, signal: AbortSignal): Promise<ConverseResponse> {
    try {
      // 本文の形は Converse API と同じ（ツールの JSON スキーマは SDK では DocumentType として渡す）
      const input = { modelId, ...body } as unknown as ConverseCommandInput
      return (await this.client.send(new ConverseCommand(input), { abortSignal: signal })) as ConverseResponse
    } catch (error) {
      if (signal.aborted) throw new ProviderError('timeout')
      const e = (error ?? {}) as SdkErrorShape
      const status = e.$metadata?.httpStatusCode ?? null
      // 認証情報を得られなかった（OIDC トークンがない、ロールを引き受けられない）ときは、Bedrock を呼んでいない
      if (e.name === 'OidcTokenMissingError' || e.name === 'CredentialsProviderError') throw new ProviderError('not_configured')
      if (e.name === 'ThrottlingException' || status === 429) throw new ProviderError('throttled', 429)
      if (typeof status === 'number') throw new ProviderError('rejected', status)
      throw new ProviderError('network')
    }
  }
}
