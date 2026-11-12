import { useEffect, useState } from 'react'
import { api, ApiError, DEMO_COIN_AMOUNTS, DEMO_STEP_AMOUNTS, type DemoHistoryEntry, type DemoTools } from '../../api'
import { ActionError, Badge, Card, CardTitle } from '../../components/ui'

const formatTime = (iso: string) =>
  new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  )

/**
 * 開発用のデモ操作（コイン・歩数の追加）。
 * 開発モードのモック API でだけ表示し、本番ビルドでは api.demo が null になるため何も出ない。
 */
export function DemoToolsCard({ onStepsChanged }: { onStepsChanged?: () => void }) {
  const demo = import.meta.env.DEV ? api.demo : null
  if (!demo) return null
  return <DemoToolsPanel demo={demo} onStepsChanged={onStepsChanged} />
}

function DemoToolsPanel({ demo, onStepsChanged }: { demo: DemoTools; onStepsChanged?: () => void }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<DemoHistoryEntry[]>([])

  useEffect(() => {
    let ignore = false
    demo.getHistory(5).then(
      (entries) => !ignore && setHistory(entries),
      () => undefined,
    )
    return () => {
      ignore = true
    }
  }, [demo])

  const run = async (action: () => Promise<string>) => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      setMessage(await action())
      setHistory(await demo.getHistory(5))
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : 'デモ操作に失敗しました。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="border-dashed bg-seto-50">
      <CardTitle aside={<Badge tone="seto">開発モードのみ</Badge>}>デモ操作</CardTitle>
      <p className="text-sm text-ink-soft">動作確認用です。本番環境では表示されず、操作もできません。</p>

      <p className="mt-3 text-sm font-bold">コインを追加</p>
      <div className="mt-1 grid grid-cols-3 gap-2">
        {DEMO_COIN_AMOUNTS.map((amount) => (
          <button
            key={amount}
            type="button"
            disabled={busy}
            className="rpg-button bg-white px-1 text-base"
            onClick={() =>
              void run(async () => {
                const balance = await demo.addCoins(amount)
                return `${amount.toLocaleString('ja-JP')}コイン追加しました（残高 ${balance.balance.toLocaleString('ja-JP')}）`
              })
            }
          >
            +{amount.toLocaleString('ja-JP')}
          </button>
        ))}
      </div>

      <p className="mt-3 text-sm font-bold">今日の歩数を追加（100歩 = 1コイン、1日100コインまで）</p>
      <div className="mt-1 grid grid-cols-3 gap-2">
        {DEMO_STEP_AMOUNTS.map((steps) => (
          <button
            key={steps}
            type="button"
            disabled={busy}
            className="rpg-button bg-white px-1 text-base"
            onClick={() =>
              void run(async () => {
                const result = await demo.addSteps(steps)
                onStepsChanged?.()
                return `${steps.toLocaleString('ja-JP')}歩追加しました（今日 ${result.todaySteps.toLocaleString('ja-JP')}歩・+${result.awardedPoints}コイン）`
              })
            }
          >
            +{steps.toLocaleString('ja-JP')}歩
          </button>
        ))}
      </div>

      <p role="status" className="mt-2 min-h-5 text-sm font-bold text-leaf-700">
        {message}
      </p>
      {error && <ActionError message={error} />}

      {history.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer py-1 font-bold">最近のデモ操作</summary>
          <ul className="mt-1 space-y-0.5">
            {history.map((entry) => (
              <li key={entry.id} className="flex justify-between gap-2">
                <span>{formatTime(entry.createdAt)}</span>
                <span>
                  {entry.kind === 'coins'
                    ? `+${entry.amount.toLocaleString('ja-JP')}コイン`
                    : `+${entry.amount.toLocaleString('ja-JP')}歩（+${entry.awardedCoins}コイン）`}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  )
}
