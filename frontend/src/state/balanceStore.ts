// 所持コインの共通ストア。ヘッダーと各画面はここから同じ残高を読む。
// 残高を変える操作（歩数の付与・ガチャ・重複変換・デモ操作）があると、API が onBalanceChange で知らせる。
import type { GameApi, PointBalance } from '../api'

export type BalanceState =
  | { status: 'loading' }
  | { status: 'ready'; balance: PointBalance }
  | { status: 'error'; balance: PointBalance | null }

type Listener = () => void

export class BalanceStore {
  private state: BalanceState = { status: 'loading' }
  private readonly listeners = new Set<Listener>()
  private readonly api: GameApi
  private started = false

  constructor(api: GameApi) {
    this.api = api
  }

  getSnapshot = (): BalanceState => this.state

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    if (!this.started) {
      this.started = true
      this.api.onBalanceChange((balance) => this.set({ status: 'ready', balance }))
      void this.refresh()
    }
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** サーバー（モック）から最新の残高を読み直す */
  async refresh(): Promise<void> {
    try {
      const balance = await this.api.getPointBalance()
      this.set({ status: 'ready', balance })
    } catch {
      // 読めなかったときも、直前に表示していた値は残す
      const previous = this.state.status === 'loading' ? null : this.state.balance
      this.set({ status: 'error', balance: previous })
    }
  }

  private set(state: BalanceState) {
    this.state = state
    this.listeners.forEach((listener) => listener())
  }
}
