import { Link } from 'react-router'
import { api } from '../../api'
import { Badge, Card, CardTitle } from '../../components/ui'
import { useAction } from '../../hooks/useAction'
import { pedometer } from '../pedometer/pedometer'

/** 発表で見せる順番。健康 → ゲーム → 観光 → AI の循環が伝わるように並べている */
const DEMO_STEPS: { title: string; detail: string; to: string }[] = [
  { title: '歩く', detail: 'ホームで今日の歩数と、センサーの「計測中」を見せる', to: '/' },
  { title: 'コインがたまる', detail: '100歩で1コイン。デモ操作の「+1,000歩」で増える様子を見せる', to: '/' },
  { title: 'ガチャを引く', detail: 'レア度ごとの演出と、排出確率の表示', to: '/gacha' },
  { title: '着せ替える', detail: '手に入れた衣装をすぐに着せ替える', to: '/gacha/wardrobe' },
  { title: '冒険の地図', detail: '現在地に自分のキャラが歩き、スポットが地図上に並ぶ', to: '/adventure' },
  { title: 'みんなのクエスト', detail: '全員共通のクエストを達成してコインを受け取る', to: '/adventure?tab=quests' },
  { title: 'AIが散策を提案', detail: '時間・興味・ペースを変えると提案が変わる（1日5回まで・登録スポットだけから選ぶ）', to: '/adventure?tab=ai' },
  { title: '観光地でチェックイン', detail: '地図でスポットを確認し、限定アイテムを受け取る', to: '/adventure?tab=spots' },
  { title: '図鑑とランキング', detail: '訪れたスポットが図鑑に載り、週間歩数で競える', to: '/adventure?tab=zukan' },
  { title: '健康ミッション', detail: '過去7日間の歩数から、無理のない目標を提案する', to: '/' },
]

/** 発表用：途中まで遊んだ状態を作る、見せる順番の案内 */
export function ShowcaseCard() {
  const demo = api.demo
  const prepare = useAction(async () => {
    if (!demo) return
    await demo.prepareShowcase()
    pedometer.reloadToday()
    // 全画面を新しいデータで読み込み直す
    window.location.assign(import.meta.env.BASE_URL)
  })
  if (!demo) return null

  const onPrepare = () => {
    if (window.confirm('いまのデータを消して、発表用のデモ用データ（途中まで遊んだ状態）にします。よろしいですか？')) {
      void prepare.run()
    }
  }

  return (
    <Card className="border-dashed bg-seto-50">
      <CardTitle aside={<Badge tone="seto">発表用</Badge>}>発表用デモ</CardTitle>
      <p className="text-sm">
        キャラクター作成済みで、過去7日分の歩数・コイン・アイテム・訪問済みスポット1か所がある状態から始められます。
        デモ用データは正式ランキングには入りません。
      </p>
      <button
        type="button"
        onClick={onPrepare}
        disabled={prepare.pending}
        className="rpg-button mt-3 w-full bg-seto-400 disabled:opacity-60"
      >
        {prepare.pending ? '準備しています…' : 'デモ用データで始める'}
      </button>
      {prepare.error && (
        <p role="alert" className="mt-2 text-sm font-bold text-red-700">
          {prepare.error}
        </p>
      )}

      <details className="mt-4">
        <summary className="cursor-pointer py-1 font-bold">発表で見せる順番</summary>
        <ol className="mt-2 space-y-2">
          {DEMO_STEPS.map((step, index) => (
            <li key={step.title}>
              <Link to={step.to} className="flex gap-3 rounded-xl border-2 border-ink/20 bg-white p-2.5 hover:border-ink">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-mikan-500 font-pixel text-sm text-white">
                  {index + 1}
                </span>
                <span>
                  <span className="block font-bold">{step.title}</span>
                  <span className="block text-sm text-ink-soft">{step.detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-ink-soft">発表が終わったら、下の「すべてのデータを削除する」で最初の状態に戻せます。</p>
      </details>
    </Card>
  )
}
