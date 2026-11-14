import { supabase } from '../lib/supabase'
import { MockGameApi } from './mockApi'
import { SupabaseGameApi } from './supabaseApi'
import type { GameApi } from './types'

/**
 * VITE_API_MODE で切り替える。
 * - mock（既定）：ブラウザ内のモック。データはこの端末だけ
 * - supabase：Supabase（VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY が必要）。設定が足りなければモックに戻す
 */
function createApi(): GameApi {
  const mode = import.meta.env.VITE_API_MODE ?? 'mock'
  if (mode === 'supabase') {
    if (supabase) return new SupabaseGameApi(supabase)
    console.warn('Supabase の設定（VITE_SUPABASE_URL・VITE_SUPABASE_ANON_KEY）が無いため、モック API を使用します。')
  } else if (mode !== 'mock') {
    console.warn(`VITE_API_MODE=${mode} は使えないため、モック API を使用します。`)
  }
  return new MockGameApi()
}

export const api: GameApi = createApi()
export * from './types'
