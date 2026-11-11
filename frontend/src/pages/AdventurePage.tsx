import { Link, useSearchParams } from 'react-router'
import { api } from '../api'
import { Tabs } from '../components/Tabs'
import { Badge, Card, ErrorMessage, LoadingCards, PageTitle } from '../components/ui'
import { getItem } from '../data/items'
import { SPOTS } from '../data/spots'
import type { Visit } from '../domain/types'
import { QuestPlanner } from '../features/quests/QuestPlanner'
import { AdventureZukan } from '../features/zukan/AdventureZukan'
import { useAsyncData } from '../hooks/useAsyncData'

const TABS = [
  { id: 'spots', label: 'スポット' },
  { id: 'quest', label: 'AIクエスト' },
  { id: 'zukan', label: '図鑑' },
] as const
type TabId = (typeof TABS)[number]['id']
const isTab = (value: string | null): value is TabId => TABS.some((tab) => tab.id === value)
const loadVisits = () => api.getVisits()

function SpotList({ visits }: { visits: readonly Visit[] }) {
  const visited = new Set(visits.map((v) => v.spotId))
  return (
    <ul className="grid gap-4 md:grid-cols-2" aria-label="観光スポット一覧">
      {SPOTS.map((spot) => (
        <li key={spot.spotId}>
          <Card className="flex h-full flex-col">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-pixel text-xl">{spot.name}</h2>
              {visited.has(spot.spotId) ? <Badge tone="leaf">訪問済み</Badge> : <Badge tone="gray">未訪問</Badge>}
            </div>
            <p className="text-sm text-ink-soft">{spot.municipality}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {spot.tags.map((tag) => (
                <Badge key={tag} tone="seto">
                  {tag}
                </Badge>
              ))}
            </div>
            <p className="mt-3 flex-1">{spot.description}</p>
            <p className="mt-2 rounded-lg bg-mikan-50 px-3 py-2 text-sm">
              訪問で獲得：<span className="font-bold text-mikan-800">{getItem(spot.rewardItemId)?.name}</span>
            </p>
            <Link to={`/adventure/spots/${spot.spotId}`} className="rpg-button mt-3 w-full bg-white">
              くわしく見る・チェックイン
            </Link>
          </Card>
        </li>
      ))}
    </ul>
  )
}

export function AdventurePage() {
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const tab: TabId = isTab(tabParam) ? tabParam : 'spots'
  const { state, reload } = useAsyncData(loadVisits)

  return (
    <div className="space-y-4">
      <PageTitle lead="愛媛の観光スポットを歩いてめぐろう。訪れると限定アイテムがもらえます。">冒険</PageTitle>
      <Tabs label="冒険の切り替え" tabs={TABS} active={tab} onChange={(id) => setParams({ tab: id }, { replace: true })}>
        {tab === 'quest' && <QuestPlanner />}
        {tab !== 'quest' && state.status === 'loading' && <LoadingCards count={2} />}
        {tab !== 'quest' && state.status === 'error' && <ErrorMessage message={state.message} onRetry={reload} />}
        {tab === 'spots' && state.status === 'ready' && <SpotList visits={state.data} />}
        {tab === 'zukan' && state.status === 'ready' && <AdventureZukan visits={state.data} />}
      </Tabs>
      <p className="text-sm text-ink-soft">観光マップは、利用規約に合う地図サービスを決めてから追加します。</p>
    </div>
  )
}
