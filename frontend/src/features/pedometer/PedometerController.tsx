import { useEffect, useRef, useState } from 'react'
import { api } from '../../api'
import { pedometer, STEPS_SYNCED_EVENT } from './pedometer'
import { usePedometer } from './usePedometer'

/** 計測中、数えた歩数をサーバー（モック）に送ってコインに変える間隔 */
const SYNC_INTERVAL_MS = 10_000

/**
 * アプリ全体の歩数計の管理（共通レイアウトに 1 つだけ置く）。
 * - アプリを開いたら自動で計測を始める
 * - どの画面を開いていても、計測中は一定間隔で歩数を同期する。画面を離れるときにも同期する
 * - iPhone などで許可が必要なときは、許可を求めるお知らせを出す
 */
export function PedometerController() {
  const state = usePedometer()
  const counting = state.status === 'counting'
  const lastSynced = useRef<number | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    pedometer.autoStart()
  }, [])

  useEffect(() => {
    if (!counting) return
    const sync = async () => {
      const steps = pedometer.getSnapshot().todaySteps
      if (steps === lastSynced.current) return
      lastSynced.current = steps
      try {
        await api.syncSteps()
        window.dispatchEvent(new Event(STEPS_SYNCED_EVENT))
      } catch {
        // 次の間隔で送り直す
        lastSynced.current = null
      }
    }
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void sync()
    }
    const timer = setInterval(() => void sync(), SYNC_INTERVAL_MS)
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', onHidden)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', onHidden)
      // 止めたときに、最後の歩数を送る
      void sync()
    }
  }, [counting])

  if (state.status !== 'needs_permission' || dismissed) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pedometer-permission-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/60 p-4 sm:items-center"
    >
      <div className="w-full max-w-sm rounded-2xl border-[4px] border-ink bg-white p-5 shadow-[0_6px_0_0_var(--color-ink)]">
        <h2 id="pedometer-permission-title" className="font-pixel text-xl">
          歩数を数えてもいいですか？
        </h2>
        <p className="mt-2">
          スマートフォンの動きのセンサーを使って、歩いた歩数を数えます。このあと表示される確認で「許可」を選んでください。
        </p>
        <p className="mt-2 text-sm text-ink-soft">センサーの値は歩数を数えるためだけに使い、外部には送りません。</p>
        <button
          type="button"
          onClick={() => void pedometer.start()}
          className="rpg-button mt-4 w-full bg-leaf-500 text-white [text-shadow:1px_1px_0_var(--color-ink)]"
        >
          許可して計測をはじめる
        </button>
        <button type="button" onClick={() => setDismissed(true)} className="rpg-button mt-2 w-full bg-white">
          あとで
        </button>
      </div>
    </div>
  )
}
