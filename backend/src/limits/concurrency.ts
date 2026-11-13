// 同時に実行する AI 呼び出しの数の制限。待たせずに断る（待ち行列で料金と時間がかさむのを避ける）。

export class ConcurrencyLimiter {
  private readonly max: number
  private running = 0
  private readonly holders = new Set<string>()

  constructor(max: number) {
    this.max = max
  }

  /**
   * 実行枠を取る。全体の上限に達しているか、同じ利用者がすでに実行中なら null。
   * 戻り値の関数で枠を返す
   */
  tryAcquire(holder: string): (() => void) | null {
    if (this.running >= this.max || this.holders.has(holder)) return null
    this.running += 1
    this.holders.add(holder)
    let released = false
    return () => {
      if (released) return
      released = true
      this.running -= 1
      this.holders.delete(holder)
    }
  }

  get active(): number {
    return this.running
  }
}
