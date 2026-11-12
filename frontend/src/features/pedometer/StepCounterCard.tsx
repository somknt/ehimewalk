import { useEffect, useRef } from 'react'
import { api } from '../../api'
import { Badge, Card, CardTitle } from '../../components/ui'
import { pedometer } from './pedometer'
import { usePedometer } from './usePedometer'

/** 計測中、数えた歩数をサーバー（モック）に送ってコインに変える間隔 */
const SYNC_INTERVAL_MS = 10_000

/**
 * この端末のセンサーで歩数を数えるカード。
 * onSynced：歩数を同期したあとに、ホームの表示（今日の歩数・グラフ）を読み直すために呼ぶ
 */
export function StepCounterCard({ onSynced }: { onSynced?: () => void }) {
  const state = usePedometer()
  const counting = state.status === 'counting'
  const lastSynced = useRef(state.todaySteps)
  const onSyncedRef = useRef(onSynced)
  useEffect(() => {
    onSyncedRef.current = onSynced
  }, [onSynced])

  // 計測中は一定間隔で同期する。歩数が増えていないときは送らない
  useEffect(() => {
    if (!counting) return
    const sync = async () => {
      const steps = pedometer.getSnapshot().todaySteps
      if (steps === lastSynced.current) return
      lastSynced.current = steps
      try {
        await api.syncSteps()
        onSyncedRef.current?.()
      } catch {
        // 次の間隔で送り直す
        lastSynced.current = -1
      }
    }
    const timer = setInterval(() => void sync(), SYNC_INTERVAL_MS)
    return () => {
      clearInterval(timer)
      // 止めたときに、最後の歩数を送る
      void sync()
    }
  }, [counting])

  return (
    <Card className={counting ? 'border-leaf-600 bg-leaf-50' : ''}>
      <CardTitle aside={counting ? <Badge tone="leaf">計測中</Badge> : <Badge tone="gray">停止中</Badge>}>歩数の計測</CardTitle>

      {counting ? (
        <>
          <p className="font-pixel text-3xl text-leaf-700" aria-live="polite">
            今回 {state.sessionSteps.toLocaleString('ja-JP')} 歩
          </p>
          <p className="mt-1 text-sm">
            スマートフォンを手に持つか、ポケットに入れて歩いてください。10秒ごとに歩数をコインに変えます。
          </p>
          {!state.wakeLock && (
            <p className="mt-1 text-sm font-bold text-mikan-800">画面が消えると計測が止まります。画面をつけたままにしてください。</p>
          )}
          <button type="button" onClick={() => pedometer.stop()} className="rpg-button mt-3 w-full bg-white">
            計測を止める
          </button>
        </>
      ) : (
        <>
          <p className="text-sm">
            スマートフォンの動きのセンサーで、歩いた歩数を数えます。アプリを開いて計測している間だけ数えます。
          </p>
          <button
            type="button"
            onClick={() => void pedometer.start()}
            disabled={state.status === 'starting'}
            className="rpg-button mt-3 w-full bg-leaf-500 text-white [text-shadow:1px_1px_0_var(--color-ink)] disabled:opacity-60"
          >
            {state.status === 'starting' ? '準備しています…' : '歩数の計測をはじめる'}
          </button>
          {state.status === 'denied' && (
            <p role="alert" className="mt-2 text-sm font-bold text-red-700">
              センサーの利用が許可されませんでした。iPhone の場合は、ページを開き直して「許可」を選んでください。
            </p>
          )}
          {state.status === 'unsupported' && (
            <p role="alert" className="mt-2 text-sm font-bold text-red-700">
              この端末・ブラウザでは動きのセンサーを使えません。スマートフォンで開いてください。パソコンでは下の「デモ操作」で歩数を追加できます。
            </p>
          )}
        </>
      )}
      <p className="mt-3 text-xs text-ink-soft">
        センサーで数えた推定の歩数です。正式なランキングには、不正防止の確認ができるまで入りません。
        アプリを閉じている間の歩数は、ヘルスケア／ヘルスコネクト連携（アプリ版）で対応予定です。
      </p>
    </Card>
  )
}
