import { useCallback, useState } from 'react'
import { toUserMessage } from '../api'

/** ボタン操作などの更新処理。実行中の状態とエラーメッセージを持つ */
export function useAction<A extends unknown[], R>(action: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setPending(true)
      setError(null)
      try {
        return await action(...args)
      } catch (e) {
        setError(toUserMessage(e))
        return undefined
      } finally {
        setPending(false)
      }
    },
    [action],
  )

  const clearError = useCallback(() => setError(null), [])

  return { run, pending, error, clearError }
}
