// 公開版（Vercel）の AWS 認証。長期のキーは使わない。
// Vercel は関数への各リクエストに OIDC トークン（x-vercel-oidc-token ヘッダー）を付ける。
// それを AWS STS の AssumeRoleWithWebIdentity で IAM ロールの一時的な認証情報（15 分）と交換する。
// https://vercel.com/docs/oidc/aws
// - ロールを引き受けられるのは、AWS 側の信頼ポリシーで許可した Vercel のプロジェクト・環境（本番）だけ
// - トークンと認証情報はログに出さない
import { AsyncLocalStorage } from 'node:async_hooks'
import { fromWebToken } from '@aws-sdk/credential-provider-web-identity'
import type { AwsCredentialIdentity } from '@smithy/types'

const requestToken = new AsyncLocalStorage<{ oidcToken: string | null }>()

/** リクエストの処理中だけ、そのリクエストの OIDC トークンを使えるようにする */
export function runWithOidcToken<T>(oidcToken: string | null, fn: () => T): T {
  return requestToken.run({ oidcToken }, fn)
}

export function currentOidcToken(): string | null {
  return requestToken.getStore()?.oidcToken ?? null
}

/** OIDC トークンがない（Vercel の外で動いている、など）ため、AWS の認証情報を得られない */
export class OidcTokenMissingError extends Error {
  constructor() {
    super('Vercel の OIDC トークンがありません')
    this.name = 'OidcTokenMissingError'
  }
}

export type AssumeRole = (oidcToken: string) => Promise<AwsCredentialIdentity>

/** 一時的な認証情報の長さ（秒）。STS の最小値 */
const SESSION_SECONDS = 900
/** 期限の少し前に取り直す */
const REFRESH_BEFORE_MS = 2 * 60 * 1000

export function stsAssumeRole(options: { roleArn: string; region: string }): AssumeRole {
  return (oidcToken) =>
    fromWebToken({
      roleArn: options.roleArn,
      webIdentityToken: oidcToken,
      roleSessionName: 'ehime-walk-ai-quest',
      durationSeconds: SESSION_SECONDS,
      clientConfig: { region: options.region },
    })()
}

/**
 * AWS SDK の credentials に渡す関数。期限まで使い回し（同じ実行環境の次のリクエストでも使う）、
 * 切れそうになったら、いま処理中のリクエストの OIDC トークンで取り直す
 */
export function vercelOidcCredentials(options: { assumeRole: AssumeRole; now?: () => number }) {
  const now = options.now ?? Date.now
  let cached: AwsCredentialIdentity | null = null
  let pending: Promise<AwsCredentialIdentity> | null = null

  return async function credentials(): Promise<AwsCredentialIdentity> {
    if (cached && cached.expiration && cached.expiration.getTime() - now() > REFRESH_BEFORE_MS) return cached
    const token = currentOidcToken()
    if (!token) throw new OidcTokenMissingError()
    pending ??= options
      .assumeRole(token)
      .then((value) => {
        cached = value
        return value
      })
      .finally(() => {
        pending = null
      })
    return pending
  }
}
