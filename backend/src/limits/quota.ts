// AI の利用回数の管理（日本時間の日付ごと）。
// - 1 ユーザーの上限と、アプリ全体の上限の両方を数える
// - 「予約 → 呼び出し → 結果に応じて確定 / 取り消し」の順で使い、上限を超える呼び出しは AI を呼ぶ前に止める
// - 数える場所（QuotaCounter）は差し替えられる：ローカル開発はファイル、公開版（Vercel）は DynamoDB（dynamoQuota.ts）
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

export type CountResult = 'ok' | 'user_limit' | 'global_limit'

/** 回数を数える場所。increment は「上限の確認と加算」を 1 回の操作で行い、同時に呼ばれても上限を超えない */
export interface QuotaCounter {
  used(date: string, userKey: string): Promise<number>
  increment(date: string, userKey: string, limits: { user: number; global: number }): Promise<CountResult>
  /** increment を取り消す（その日付の回数だけを戻す） */
  decrement(date: string, userKey: string): Promise<void>
}

/** QuotaStore（メモリ・ファイル）で数える。1 つのプロセスの中だけで使う（ローカル開発・テスト用） */
export class StoreQuotaCounter implements QuotaCounter {
  private readonly store: QuotaStore
  constructor(store: QuotaStore) {
    this.store = store
  }

  private state(date: string): QuotaState {
    const saved = this.store.load()
    return saved && saved.date === date ? saved : { date, global: 0, users: {} }
  }

  async used(date: string, userKey: string) {
    return this.state(date).users[userKey] ?? 0
  }

  // 読み込み〜保存の間に await を挟まないので、同じプロセスの中では同時に呼ばれても上限を超えない
  async increment(date: string, userKey: string, limits: { user: number; global: number }): Promise<CountResult> {
    const state = this.state(date)
    const used = state.users[userKey] ?? 0
    if (used >= limits.user) return 'user_limit'
    if (state.global >= limits.global) return 'global_limit'
    state.users[userKey] = used + 1
    state.global += 1
    this.store.save(state)
    return 'ok'
  }

  async decrement(date: string, userKey: string) {
    const saved = this.store.load()
    // 日付が変わっていたら戻さない（新しい日の回数を減らさないため）
    if (!saved || saved.date !== date) return
    saved.users[userKey] = Math.max(0, (saved.users[userKey] ?? 1) - 1)
    saved.global = Math.max(0, saved.global - 1)
    this.store.save(saved)
  }
}

export type ReserveResult =
  | {
      ok: true
      remaining: number
      release: () => Promise<void>
      /** 提案ができたときに呼ぶ（Supabase では提案したクエストを記録する。チェックインの「AI 経由」の判定に使う） */
      commit?: (quest: { questId: string; title: string; spotIds: string[]; model: string | null; generatedBy: 'mock' | 'bedrock' }) => Promise<void>
    }
  | { ok: false; reason: 'user_limit' | 'global_limit'; remaining: number }

/** 回数の管理（QuotaManager か、Supabase で数える SupabaseQuota） */
export interface QuotaLike {
  remaining(identity: string): Promise<number>
  reserve(identity: string): Promise<ReserveResult>
}

export class QuotaManager implements QuotaLike {
  private readonly counter: QuotaCounter
  private readonly userLimit: number
  private readonly globalLimit: number
  private readonly today: () => string

  constructor(options: { counter: QuotaCounter; userLimit: number; globalLimit: number; today: () => string }) {
    this.counter = options.counter
    this.userLimit = options.userLimit
    this.globalLimit = options.globalLimit
    this.today = options.today
  }

  async remaining(identity: string): Promise<number> {
    const used = await this.counter.used(this.today(), hashIdentity(identity))
    return Math.max(0, this.userLimit - used)
  }

  /**
   * 1 回分を予約する。
   * release() は、AI に請求されていない失敗（未設定・Bedrock が拒否した等）のときに呼び、回数を戻す
   */
  async reserve(identity: string): Promise<ReserveResult> {
    const key = hashIdentity(identity)
    const date = this.today()
    const result = await this.counter.increment(date, key, { user: this.userLimit, global: this.globalLimit })
    if (result === 'user_limit') return { ok: false, reason: 'user_limit', remaining: 0 }
    const used = await this.counter.used(date, key)
    if (result === 'global_limit') return { ok: false, reason: 'global_limit', remaining: Math.max(0, this.userLimit - used) }

    let released = false
    return {
      ok: true,
      remaining: Math.max(0, this.userLimit - used),
      release: async () => {
        if (released) return
        released = true
        await this.counter.decrement(date, key)
      },
    }
  }
}
