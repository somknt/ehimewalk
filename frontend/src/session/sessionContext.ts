import { createContext, useContext } from 'react'
import type { PointBalance, SessionData } from '../api'
import type { Character } from '../domain/types'

export interface SessionContextValue {
  session: SessionData
  /** API の応答で受け取った最新の値を画面全体に反映する */
  setSession: (session: SessionData) => void
  applyBalance: (balance: PointBalance) => void
  applyCharacter: (character: Character) => void
  reload: () => void
}

export const SessionContext = createContext<SessionContextValue | null>(null)

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession は SessionProvider の内側で使ってください')
  return value
}
