import { Badge, Card, ComingSoon, PageTitle } from '../components/ui'
import { getItem } from '../data/items'
import { SPOTS } from '../data/spots'

export function AdventurePage() {
  return (
    <div className="space-y-4">
      <PageTitle lead="愛媛の観光スポットを歩いてめぐろう。訪れると限定アイテムがもらえます。">冒険</PageTitle>

      <ul className="grid gap-4 md:grid-cols-2" aria-label="観光スポット一覧">
        {SPOTS.map((spot) => (
          <li key={spot.spotId}>
            <Card className="h-full">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-pixel text-xl">{spot.name}</h2>
                <span className="shrink-0 text-sm text-ink-soft">{spot.municipality}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {spot.tags.map((tag) => (
                  <Badge key={tag} tone="seto">
                    {tag}
                  </Badge>
                ))}
              </div>
              <p className="mt-3">{spot.description}</p>
              <p className="mt-2 text-sm text-ink-soft">所在地：{spot.address}</p>
              <p className="mt-2 rounded-lg bg-mikan-50 px-3 py-2 text-sm">
                訪問で獲得：<span className="font-bold text-mikan-800">{getItem(spot.rewardItemId)?.name}</span>
                <span className="ml-1 text-ink-soft">（チェックインはフェーズ3で対応）</span>
              </p>
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer py-1 font-bold text-seto-700">情報源</summary>
                <ul className="mt-1 space-y-1">
                  {spot.sources.map((source) => (
                    <li key={source.url}>
                      <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-seto-700 underline">
                        {source.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            </Card>
          </li>
        ))}
      </ul>

      <ComingSoon
        items={[
          { label: 'AI散策ルート生成（条件入力）', task: 'タスク 1.13' },
          { label: 'スポットの詳細画面', task: 'タスク 1.12' },
          { label: '観光マップ', task: 'フェーズ3' },
          { label: 'GPSチェックイン', task: 'フェーズ3' },
          { label: '愛媛冒険図鑑', task: 'フェーズ3' },
        ]}
      />
    </div>
  )
}
