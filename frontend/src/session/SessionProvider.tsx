import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError, type PointBalance, type SessionData } from '../api'
import { ErrorMessage } from '../components/ui'
import type { Character } from '../domain/types'
import { SessionContext, type SessionContextValue } from './sessionContext'

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; session: SessionData }

/** プロフィール・キャラクター・ポイント残高を読み込み、全画面で共有する */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let ignore = false
    api.getSession().then(
      (session) => {
        if (!ignore) setState({ status: 'ready', session })
      },
      (error: unknown) => {
        if (!ignore) {
          setState({
            status: 'error',
            message: error instanceof ApiError ? error.userMessage : 'データを読み込めませんでした。',
          })
        }
      },
    )
    return () => {
      ignore = true
    }
  }, [reloadKey])

  const setSession = useCallback((session: SessionData) => setState({ status: 'ready', session }), [])
  const update = useCallback((patch: Partial<SessionData>) => {
    setState((prev) => (prev.status === 'ready' ? { status: 'ready', session: { ...prev.session, ...patch } } : prev))
  }, [])
  const applyBalance = useCallback((balance: PointBalance) => update({ balance }), [update])
  const applyCharacter = useCallback((character: Character) => update({ character }), [update])
  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setReloadKey((key) => key + 1)
  }, [])

  const value = useMemo<SessionContextValue | null>(
    () => (state.status === 'ready' ? { session: state.session, setSession, applyBalance, applyCharacter, reload } : null),
    [state, setSession, applyBalance, applyCharacter, reload],
  )

  if (state.status === 'loading') {
    return (
      <div role="status" className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-mikan-500">
        <p className="font-pixel text-2xl text-white [text-shadow:2px_2px_0_var(--color-ink)]">えひめウォーククエスト</p>
        <p className="font-pixel text-white">よみこみ中…</p>
      </div>
    )
  }
  if (state.status === 'error' || !value) {
    return (
      <div className="mx-auto max-w-md p-4 pt-16">
        <ErrorMessage message={state.status === 'error' ? state.message : ''} onRetry={reload} />
      </div>
    )
  }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
