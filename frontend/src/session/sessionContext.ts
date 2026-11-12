import { createContext, useContext } from 'react'
import type { SessionData } from '../api'
import type { Character } from '../domain/types'

/**
 * プロフィール・キャラクター・称号の共有。
 * 所持コインはここでは持たず、hooks/useBalance（balanceStore）で共有する。
 */
export interface SessionContextValue {
  session: SessionData
  /** API の応答で受け取った最新の値を画面全体に反映する */
  setSession: (session: SessionData) => void
  applyCharacter: (character: Character) => void
  /** 読み込み表示を出さずに、最新の値を読み直す */
  refresh: () => Promise<void>
}

export const SessionContext = createContext<SessionContextValue | null>(null)

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession は SessionProvider の内側で使ってください')
  return value
}
