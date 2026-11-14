// Supabase のクライアント。公開用のキー（publishable / anon）だけを使う。
// このキーはブラウザに入る前提のキーで、データは Supabase 側の RLS と RPC の検証で守る。
// 秘密のキー（secret / service_role）は、ここにも VITE_ で始まる環境変数にも絶対に置かない。
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? ''
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? ''

/** 秘密のキーを入れてしまっていないか（入っていたら使わない） */
function looksSecret(value: string): boolean {
  if (value.startsWith('sb_secret_')) return true
  // 旧形式のキー（JWT）は、中身の role で見分ける
  try {
    const payload = JSON.parse(atob(value.split('.')[1] ?? '')) as { role?: string }
    return payload.role === 'service_role'
  } catch {
    return false
  }
}

function create(): SupabaseClient | null {
  if (!url || !key) return null
  if (looksSecret(key)) {
    console.error('VITE_SUPABASE_ANON_KEY に秘密のキーが入っています。公開用のキー（sb_publishable_…）に替えてください。')
    return null
  }
  return createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'ewq.supabase.auth' },
  })
}

/** 設定されていなければ null（その場合はモック API を使う） */
export const supabase: SupabaseClient | null = create()
