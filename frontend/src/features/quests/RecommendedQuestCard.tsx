import { Link } from 'react-router'
import type { QuestSuggestion } from '../../api'
import { Badge, Card, CardTitle, ProgressBar } from '../../components/ui'
import { getItem } from '../../data/items'

/** クエストの進行状況（今日の歩数と、クエストの目安歩数の比較） */
function QuestProgress({ quest, todaySteps }: { quest: QuestSuggestion; todaySteps: number }) {
  const target = quest.estimate?.steps ?? null
  return (
    <div className="mt-3 rounded-xl border-2 border-ink/20 bg-white p-3">
      <p className="font-bold">進行状況</p>
      {target ? (
        <>
          <div className="mt-1 mb-1 flex justify-between text-sm">
            <span>今日の歩数／クエストの目安</span>
            <span className="font-bold">
              {todaySteps.toLocaleString('ja-JP')} / {target.toLocaleString('ja-JP')} 歩
            </span>
          </div>
          <ProgressBar value={todaySteps / target} label="クエストの目安歩数に対する今日の歩数" />
        </>
      ) : (
        <p className="mt-1 text-sm">今日の歩数：{todaySteps.toLocaleString('ja-JP')} 歩</p>
      )}
      <p className="mt-2 text-sm">
        スポットの訪問：0 / {quest.spots.length} か所
        <span className="ml-1 text-xs text-ink-soft">（訪問チェックはフェーズ3で対応）</span>
      </p>
    </div>
  )
}

export function RecommendedQuestCard({ quest, todaySteps }: { quest: QuestSuggestion; todaySteps?: number }) {
  const { estimate } = quest
  return (
    <Card className="bg-seto-50">
      <CardTitle
        aside={
          quest.generatedBy === 'mock' ? (
            <Badge tone="gray">
              モック<span className="sr-only">（Bedrock 未接続の仮の提案です）</span>
            </Badge>
          ) : (
            <Badge tone="seto">Bedrock</Badge>
          )
        }
      >
        AIおすすめクエスト
      </CardTitle>
      {quest.generatedBy === 'mock' && (
        <p className="-mt-2 mb-2 text-xs text-ink-soft">AI未接続のため、登録スポットから仮の提案を表示しています。</p>
      )}

      <p className="font-pixel text-xl text-seto-700">{quest.title}</p>
      <p className="mt-1 text-sm text-ink-soft">{quest.reason}</p>

      <ol className="mt-3 space-y-2">
        {quest.spots.map((spot, index) => (
          <li key={spot.spotId} className="flex items-center gap-3 rounded-xl border-2 border-ink/20 bg-white p-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-mikan-500 font-pixel text-white">
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="font-bold">
                {spot.name}
                <span className="ml-2 text-sm font-normal text-ink-soft">{spot.municipality}</span>
              </p>
              <p className="text-sm text-mikan-800">限定アイテム：{getItem(spot.rewardItemId)?.name ?? '―'}</p>
            </div>
          </li>
        ))}
      </ol>

      {estimate ? (
        <div className="mt-3 rounded-xl border-2 border-dashed border-seto-600 bg-white p-3">
          <p className="font-bold">
            約{(estimate.distanceM / 1000).toFixed(1)}km・約{estimate.steps.toLocaleString('ja-JP')}歩・約{estimate.minutes}分
          </p>
          {estimate.basis === 'straight_line' && (
            <p className="mt-1 text-xs text-ink-soft">
              スポット間の直線距離から出した目安です。実際の道のり・所要時間とは異なります（経路検索は今後対応）。
            </p>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-soft">スポット周辺を散策するクエストです。歩数の目安はまだ計算していません。</p>
      )}

      {todaySteps !== undefined && <QuestProgress quest={quest} todaySteps={todaySteps} />}

      <Link to="/adventure" className="rpg-button mt-4 w-full bg-seto-400 text-ink">
        冒険画面でスポットを見る
      </Link>
    </Card>
  )
}
