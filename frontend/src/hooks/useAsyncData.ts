import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../api'

export type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T }

const FALLBACK_ERROR = 'データを読み込めませんでした。時間をおいて、もう一度お試しください。'

function toErrorState(error: unknown): LoadState<never> {
  return { status: 'error', message: error instanceof ApiError ? error.userMessage : FALLBACK_ERROR }
}

/** 非同期の読み込みと、読み込み中・エラー・再試行の状態をまとめて扱う */
export function useAsyncData<T>(loader: () => Promise<T>) {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    // 画面を離れた後や再読み込み後に、古い結果で状態を上書きしない
    let ignore = false
    loader().then(
      (data) => {
        if (!ignore) setState({ status: 'ready', data })
      },
      (error: unknown) => {
        if (!ignore) setState(toErrorState(error))
      },
    )
    return () => {
      ignore = true
    }
  }, [loader, reloadKey])

  /** 再試行・再読み込み（ボタン操作から呼ぶ） */
  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setReloadKey((key) => key + 1)
  }, [])

  /** 表示を「読み込み中」に戻さずに読み直す（操作の後に最新の値へ更新するとき） */
  const refresh = useCallback(async () => {
    try {
      const data = await loader()
      setState({ status: 'ready', data })
    } catch (error) {
      setState(toErrorState(error))
    }
  }, [loader])

  /** 操作の結果を、読み込み直さずに画面へ反映する（読み込み済みのときだけ） */
  const update = useCallback((updater: (data: T) => T) => {
    setState((current) => (current.status === 'ready' ? { status: 'ready', data: updater(current.data) } : current))
  }, [])

  return { state, reload, refresh, update }
}
