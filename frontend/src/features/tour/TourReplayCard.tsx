import { useNavigate } from 'react-router'
import { api } from '../../api'
import { Badge, Card, CardTitle } from '../../components/ui'
import { tourStore } from './tourStore'

/** マイページ：操作ガイドをもう一度見る（デモモードのときだけ） */
export function TourReplayCard() {
  const navigate = useNavigate()
  if (!api.demo) return null
  return (
    <Card className="border-dashed bg-mikan-50">
      <CardTitle aside={<Badge tone="mikan">デモ</Badge>}>操作ガイド</CardTitle>
      <p className="text-sm">光る場所と「ここをタップ」で、アプリの使い方を順番に案内します。</p>
      <button
        type="button"
        data-tour="tour-replay"
        onClick={() => {
          tourStore.start()
          navigate('/')
        }}
        className="rpg-button mt-3 w-full bg-mikan-500 text-white [text-shadow:1px_1px_0_var(--color-ink)]"
      >
        操作ガイドを最初から見る
      </button>
    </Card>
  )
}
