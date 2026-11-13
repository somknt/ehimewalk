// ログ。秘密情報（API キー）と個人に関わる情報（位置・IP アドレス）を出さない。
// 念のため、出力する文字列に API キーが含まれていたら伏せ字にする（二重の防御）。

const secrets = new Set<string>()

/** ログに出してはいけない値を登録する（起動時に API キーを登録する） */
export function registerSecret(value: string | null | undefined): void {
  if (value && value.length >= 8) secrets.add(value)
}

export function redact(text: string): string {
  let out = text
  for (const secret of secrets) out = out.split(secret).join('[REDACTED]')
  // Authorization ヘッダーの形をした文字列も伏せる
  return out.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[REDACTED]')
}

type Fields = Record<string, string | number | boolean | null | undefined>

function write(level: 'info' | 'warn' | 'error', event: string, fields: Fields = {}): void {
  const line = redact(JSON.stringify({ level, event, ...fields, at: new Date().toISOString() }))
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const log = {
  info: (event: string, fields?: Fields) => write('info', event, fields),
  warn: (event: string, fields?: Fields) => write('warn', event, fields),
  error: (event: string, fields?: Fields) => write('error', event, fields),
}

/** エラーの種類だけを取り出す（メッセージに秘密情報や外部の応答が含まれることがあるため、本文は出さない） */
export function errorKind(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}
