import { useState } from 'react'
import { api, type CheerReaction } from '../../api'
import { useAction } from '../../hooks/useAction'

/** 応援は決まった種類だけ（自由文による嫌がらせを防ぐ） */
const CHEERS: { id: CheerReaction; label: string }[] = [
  { id: 'nice', label: '👏 ナイス' },
  { id: 'fight', label: '💪 ファイト' },
  { id: 'thanks', label: '🙌 いっしょに歩こう' },
]

/** フレンドへの応援ボタン。onSent：送ったあとに呼ぶ（送った回数の表示を更新するため） */
export function CheerButtons({ userId, onSent }: { userId: string; onSent?: () => void }) {
  const [sent, setSent] = useState<CheerReaction | null>(null)
  const send = useAction(async (reaction: CheerReaction) => {
    await api.sendCheer(userId, reaction)
    setSent(reaction)
    onSent?.()
  })
  if (sent) {
    return (
      <p role="status" className="text-sm font-bold text-leaf-700">
        「{CHEERS.find((c) => c.id === sent)?.label}」を送りました
      </p>
    )
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {CHEERS.map((cheer) => (
        <button
          key={cheer.id}
          type="button"
          onClick={() => void send.run(cheer.id)}
          disabled={send.pending}
          className="min-h-10 rounded-full border-2 border-ink bg-white px-3 text-sm"
        >
          {cheer.label}
        </button>
      ))}
      {send.error && (
        <p role="alert" className="w-full text-sm text-red-700">
          {send.error}
        </p>
      )}
    </div>
  )
}
