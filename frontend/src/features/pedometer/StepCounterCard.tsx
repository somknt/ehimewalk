import { useEffect, useRef } from 'react'
import { Badge, Card, CardTitle } from '../../components/ui'
import { pedometer, STEPS_SYNCED_EVENT } from './pedometer'
import { usePedometer } from './usePedometer'

/**
 * 歩数計の状態と、止める・はじめるボタン（ホームに置く）。
 * 計測そのものと同期は PedometerController が行う。
 * onSynced：歩数を同期したあとに、ホームの表示（今日の歩数・グラフ）を読み直すために呼ぶ
 */
export function StepCounterCard({ onSynced }: { onSynced?: () => void }) {
  const state = usePedometer()
  const onSyncedRef = useRef(onSynced)
  useEffect(() => {
    onSyncedRef.current = onSynced
  }, [onSynced])

  useEffect(() => {
    const listener = () => onSyncedRef.current?.()
    window.addEventListener(STEPS_SYNCED_EVENT, listener)
    return () => window.removeEventListener(STEPS_SYNCED_EVENT, listener)
  }, [])

  const counting = state.status === 'counting'
  const badge = counting ? (
    <Badge tone="leaf">計測中</Badge>
  ) : state.status === 'starting' ? (
    <Badge tone="seto">準備中</Badge>
  ) : (
    <Badge tone="gray">停止中</Badge>
  )

  return (
    <Card className={counting ? 'border-leaf-600 bg-leaf-50' : ''}>
      <CardTitle aside={badge}>歩数の計測</CardTitle>

      {counting && (
        <>
          <p className="font-pixel text-3xl text-leaf-700" aria-live="polite">
            今回 {state.sessionSteps.toLocaleString('ja-JP')} 歩
          </p>
          <p className="mt-1 text-sm">アプリを開いている間、自動で歩数を数えています。手に持つか、ポケットに入れて歩いてください。</p>
          {!state.wakeLock && (
            <p className="mt-1 text-sm font-bold text-mikan-800">画面が消えると計測が止まります。画面をつけたままにしてください。</p>
          )}
          <button type="button" onClick={() => pedometer.stop()} className="rpg-button mt-3 w-full bg-white">
            計測を止める
          </button>
        </>
      )}

      {state.status === 'starting' && <p className="text-sm">センサーを準備しています…</p>}

      {(state.status === 'idle' || state.status === 'needs_permission' || state.status === 'denied') && (
        <>
          <p className="text-sm">
            {state.status === 'idle'
              ? '計測を止めています。「はじめる」を押すと、次からはアプリを開いたときに自動で計測します。'
              : 'スマートフォンの動きのセンサーで歩数を数えます。センサーの利用を許可してください。'}
          </p>
          <button
            type="button"
            onClick={() => void pedometer.start()}
            className="rpg-button mt-3 w-full bg-leaf-500 text-white [text-shadow:1px_1px_0_var(--color-ink)]"
          >
            {state.status === 'idle' ? '歩数の計測をはじめる' : '許可して計測をはじめる'}
          </button>
          {state.status === 'denied' && (
            <p role="alert" className="mt-2 text-sm font-bold text-red-700">
              センサーの利用が許可されませんでした。iPhone の場合は、ページを開き直して「許可」を選んでください。
            </p>
          )}
        </>
      )}

      {state.status === 'unsupported' && (
        <p role="alert" className="text-sm font-bold text-red-700">
          この端末・ブラウザでは動きのセンサーを使えません。スマートフォンで開いてください。パソコンでは下の「デモ操作」で歩数を追加できます。
        </p>
      )}

      <p className="mt-3 text-xs text-ink-soft">
        センサーで数えた推定の歩数です。正式なランキングには、不正防止の確認ができるまで入りません。
        アプリを閉じている間の歩数は、ヘルスケア／ヘルスコネクト連携（アプリ版）で数えられるようになります。
      </p>
    </Card>
  )
}
