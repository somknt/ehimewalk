import { MockGameApi } from './mockApi'
import type { GameApi } from './types'

function createApi(): GameApi {
  const mode = import.meta.env.VITE_API_MODE ?? 'mock'
  if (mode !== 'mock') {
    // HttpGameApi はフェーズ2 で実装する。それまではモックを使い、画面上の「モック」表示で区別する
    console.warn(`VITE_API_MODE=${mode} はまだ実装されていないため、モック API を使用します。`)
  }
  return new MockGameApi()
}

export const api: GameApi = createApi()

export * from './types'
