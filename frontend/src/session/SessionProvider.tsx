import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { api, toUserMessage, type SessionData } from '../api'
import { ErrorMessage } from '../components/ui'
import type { Character } from '../domain/types'
import { SessionContext, type SessionContextValue } from './sessionContext'

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; session: SessionData }

/** プロフィール・キャラクター・称号を読み込み、全画面で共有する */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const { pathname } = useLocation()
  const ready = state.status === 'ready'
  const firstPath = useRef(pathname)

  useEffect(() => {
    let ignore = false
    api.getSession().then(
      (session) => {
        if (!ignore) setState({ status: 'ready', session })
      },
      (error: unknown) => {
        if (!ignore) setState({ status: 'error', message: toUserMessage(error, 'データを読み込めませんでした。') })
      },
    )
    return () => {
      ignore = true
    }
  }, [reloadKey])

  const refresh = useCallback(async () => {
    try {
      const session = await api.getSession()
      setState({ status: 'ready', session })
    } catch {
      // 読み直しに失敗しても、表示中の値をそのまま使う
    }
  }, [])

  // 着せ替え画面など、別の画面での変更（装備・称号の獲得）を反映するため、画面を移るたびに静かに読み直す
  useEffect(() => {
    if (!ready || pathname === firstPath.current) return
    firstPath.current = pathname
    void refresh()
  }, [pathname, ready, refresh])

  const setSession = useCallback((session: SessionData) => setState({ status: 'ready', session }), [])
  const applyCharacter = useCallback((character: Character) => {
    setState((prev) => (prev.status === 'ready' ? { status: 'ready', session: { ...prev.session, character } } : prev))
  }, [])
  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setReloadKey((key) => key + 1)
  }, [])

  const value = useMemo<SessionContextValue | null>(
    () => (state.status === 'ready' ? { session: state.session, setSession, applyCharacter, refresh } : null),
    [state, setSession, applyCharacter, refresh],
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
        <ErrorMessage message={state.status === 'error' ? state.message : ''} onRetry={retry} />
      </div>
    )
  }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
