import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { QuestSuggestion } from '../../api'
import { Badge, Card, CardTitle } from '../../components/ui'
import { getItem } from '../../data/items'
import { questSpotLink } from './links'

const formatKm = (meters: number) => (meters / 1000).toFixed(1)

export function QuestCard({
  quest,
  heading = 'AIおすすめクエスト',
  showIntro = false,
  footer,
}: {
  quest: QuestSuggestion
  heading?: string
  showIntro?: boolean
  footer?: ReactNode
}) {
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
        {heading}
      </CardTitle>
      {quest.generatedBy === 'mock' && (
        <p className="-mt-2 mb-2 text-xs text-ink-soft">AI未接続のため、登録スポットから規則に沿って選んだ提案です。</p>
      )}

      <p className="font-pixel text-xl text-seto-700">{quest.title}</p>
      <p className="mt-1 text-sm text-ink-soft">{quest.reason}</p>
      <p className="mt-2 text-sm">
        出発：<span className="font-bold">{quest.startLabel}</span>
      </p>

      <ol className="mt-3 space-y-2">
        {quest.spots.map((spot, index) => (
          <li key={spot.spotId}>
            {index > 0 && spot.legM > 0 && (
              <p className="py-1 pl-4 text-xs text-ink-soft" aria-label={`次のスポットまで約${formatKm(spot.legM)}km`}>
                ↓ 約{formatKm(spot.legM)}km（目安）
              </p>
            )}
            <Link
              to={questSpotLink(quest.questId, spot.spotId)}
              className="flex items-center gap-3 rounded-xl border-2 border-ink/20 bg-white p-2.5 hover:border-ink"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-mikan-500 font-pixel text-white">
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block font-bold">
                  {spot.name}
                  <span className="ml-2 text-sm font-normal text-ink-soft">{spot.municipality}</span>
                </span>
                <span className="block text-sm text-mikan-800">限定アイテム：{getItem(spot.rewardItemId)?.name ?? '―'}</span>
                {showIntro && <span className="mt-1 block text-sm text-ink-soft">{spot.intro}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ol>

      {estimate ? (
        <div className="mt-3 rounded-xl border-2 border-dashed border-seto-600 bg-white p-3">
          <p className="font-bold">
            約{formatKm(estimate.distanceM)}km・約{estimate.steps.toLocaleString('ja-JP')}歩・約{estimate.minutes}分
          </p>
          {estimate.basis === 'straight_line' && (
            <p className="mt-1 text-xs text-ink-soft">
              スポット間の直線距離から出した目安です。実際の道のり・所要時間とは異なります。
            </p>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-soft">スポット周辺を散策するクエストです。歩数の目安はまだ計算していません。</p>
      )}

      {quest.mapsUrl && (
        <a
          href={quest.mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 block text-center text-sm font-bold text-seto-700 underline"
        >
          Googleマップで実際の徒歩ルートを確認する（外部サイト）
        </a>
      )}
      <p className="mt-2 text-xs text-ink-soft">
        歩きスマホはやめましょう。立入禁止の場所には入らず、体調に合わせて休憩してください。
      </p>
      {footer}
    </Card>
  )
}
