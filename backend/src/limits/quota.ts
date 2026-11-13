// AI の利用回数の管理（日本時間の日付ごと）。
// - 1 ユーザーの上限と、アプリ全体の上限の両方を数える
// - 「予約 → 呼び出し → 結果に応じて確定 / 取り消し」の順で使い、上限を超える呼び出しは AI を呼ぶ前に止める
// - 公開運用では Cognito のユーザー ID と DynamoDB（共有ストレージ）での管理が必須。これはローカル開発用
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface QuotaState {
  date: string
  global: number
  users: Record<string, number>
}

export interface QuotaStore {
  load(): QuotaState | null
  save(state: QuotaState): void
}

export class MemoryQuotaStore implements QuotaStore {
  state: QuotaState | null = null
  load() {
    return this.state
  }
  save(state: QuotaState) {
    this.state = structuredClone(state)
  }
}

/** ファイルに保存する（サーバーを再起動しても回数が戻らないようにする） */
export class FileQuotaStore implements QuotaStore {
  private readonly path: string
  constructor(path: string) {
    this.path = path
  }
  load(): QuotaState | null {
    try {
      const data = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<QuotaState>
      if (typeof data.date !== 'string' || typeof data.global !== 'number' || typeof data.users !== 'object' || !data.users) return null
      return { date: data.date, global: data.global, users: data.users as Record<string, number> }
    } catch {
      return null
    }
  }
  save(state: QuotaState): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temp = `${this.path}.tmp`
    writeFileSync(temp, JSON.stringify(state))
    renameSync(temp, this.path)
  }
}

/** 保存するのは識別子のハッシュだけ（IP アドレスなどをそのまま残さない） */
export function hashIdentity(identity: string): string {
  return createHash('sha256').update(`ewq-ai-quota:${identity}`).digest('hex').slice(0, 24)
}

export type ReserveResult =
  | { ok: true; remaining: number; release: () => void }
  | { ok: false; reason: 'user_limit' | 'global_limit'; remaining: number }

export class QuotaManager {
  private readonly store: QuotaStore
  private readonly userLimit: number
  private readonly globalLimit: number
  private readonly today: () => string

  constructor(options: { store: QuotaStore; userLimit: number; globalLimit: number; today: () => string }) {
    this.store = options.store
    this.userLimit = options.userLimit
    this.globalLimit = options.globalLimit
    this.today = options.today
  }

  /** 今日の状態（日付が変わっていたら 0 から） */
  private current(): QuotaState {
    const date = this.today()
    const saved = this.store.load()
    return saved && saved.date === date ? saved : { date, global: 0, users: {} }
  }

  remaining(identity: string): number {
    const used = this.current().users[hashIdentity(identity)] ?? 0
    return Math.max(0, this.userLimit - used)
  }

  /**
   * 1 回分を予約する。読み込み〜保存の間に await を挟まないので、同時に呼ばれても上限を超えない。
   * release() は、AI に請求されていない失敗（未設定・Bedrock が拒否した等）のときに呼び、回数を戻す
   */
  reserve(identity: string): ReserveResult {
    const key = hashIdentity(identity)
    const state = this.current()
    const used = state.users[key] ?? 0
    if (used >= this.userLimit) return { ok: false, reason: 'user_limit', remaining: 0 }
    if (state.global >= this.globalLimit) return { ok: false, reason: 'global_limit', remaining: this.userLimit - used }
    state.users[key] = used + 1
    state.global += 1
    this.store.save(state)

    let released = false
    const reservedDate = state.date
    return {
      ok: true,
      remaining: this.userLimit - used - 1,
      release: () => {
        if (released) return
        released = true
        const now = this.current()
        // 日付をまたいだ予約は戻さない（新しい日の回数を減らさないため）
        if (now.date !== reservedDate) return
        now.users[key] = Math.max(0, (now.users[key] ?? 1) - 1)
        now.global = Math.max(0, now.global - 1)
        this.store.save(now)
      },
    }
  }
}
