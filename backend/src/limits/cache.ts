// 生成結果のキャッシュ（有効期限つき・件数の上限つき）。同じ条件なら AI を呼ばずに結果を返す。
import { createHash } from 'node:crypto'

export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>()
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly now: () => number

  constructor(options: { ttlMs: number; maxEntries?: number; now?: () => number }) {
    this.ttlMs = options.ttlMs
    this.maxEntries = options.maxEntries ?? 200
    this.now = options.now ?? Date.now
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: T): void {
    if (this.ttlMs <= 0) return
    this.entries.delete(key)
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs })
    // 古いものから消す（Map は追加した順に並ぶ）
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }

  get size(): number {
    return this.entries.size
  }
}

/** 値の中身から、順番に左右されないキーを作る */
export function cacheKey(parts: Record<string, unknown>): string {
  const sorted = Object.fromEntries(Object.entries(parts).sort(([a], [b]) => a.localeCompare(b)))
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex')
}
