import { lazy, Suspense, useCallback, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { api } from '../api'
import { PixelArt } from '../components/PixelArt'
import { Tabs } from '../components/Tabs'
import { Badge, Card, ErrorMessage, LoadingCards, PageTitle } from '../components/ui'
import { getItem } from '../data/items'
import { SPOTS } from '../data/spots'
import { distanceMeters } from '../domain/geo'
import type { Visit } from '../domain/types'
import { AI_QUEST_API_AVAILABLE } from '../api/aiQuestClient'
import { useLocationPermission, type LocationPermission } from '../features/geo/useLocationPermission'
import type { MapPosition } from '../features/map/SpotMap'
import { SPOT_OBJECT_SIZE, spotObject } from '../features/map/spotObjects'
import { AiQuestPlanner } from '../features/quests/AiQuestPlanner'
import { CommonQuests } from '../features/quests/CommonQuests'
import { QuestPlanner } from '../features/quests/QuestPlanner'
import { AdventureZukan } from '../features/zukan/AdventureZukan'
import { useAsyncData } from '../hooks/useAsyncData'
import { useSession } from '../session/sessionContext'

// 地図のライブラリは大きいため、冒険画面を開いたときにだけ読み込む
const SpotMap = lazy(() => import('../features/map/SpotMap').then((m) => ({ default: m.SpotMap })))

const TABS = [
  { id: 'spots', label: 'スポット' },
  { id: 'quests', label: 'クエスト' },
  { id: 'ai', label: 'AIクエスト' },
  { id: 'zukan', label: '図鑑' },
] as const
type TabId = (typeof TABS)[number]['id']
/** 以前の URL（?tab=quest / ?tab=map）も開けるようにする */
const LEGACY_TABS: Record<string, TabId> = { quest: 'ai', map: 'spots' }
const toTab = (value: string | null): TabId =>
  TABS.some((tab) => tab.id === value) ? (value as TabId) : (value && LEGACY_TABS[value]) || 'spots'
const loadVisits = () => api.getVisits()

const formatDistance = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`)

function SpotList({
  visits,
  position,
  onShowOnMap,
}: {
  visits: readonly Visit[]
  position: MapPosition | null
  onShowOnMap: (spotId: string) => void
}) {
  const visited = new Set(visits.map((v) => v.spotId))
  // 現在地が分かれば、近い順に並べる
  const spots = SPOTS.map((spot) => ({ spot, distance: position ? distanceMeters(position, spot) : null })).sort(
    (a, b) => (a.distance ?? 0) - (b.distance ?? 0),
  )
  return (
    <ul className="grid gap-3 md:grid-cols-2" aria-label="観光スポット一覧">
      {spots.map(({ spot, distance }) => (
        <li key={spot.spotId}>
          <Card className="flex h-full flex-col p-3">
            <div className="flex gap-3">
              <div className="flex size-16 shrink-0 items-center justify-center rounded-xl border-2 border-ink/20 bg-seto-50">
                <PixelArt width={SPOT_OBJECT_SIZE} height={SPOT_OBJECT_SIZE} layers={[spotObject(spot).layer]} style={{ width: 48, height: 48 }} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-pixel text-xl">{spot.name}</h2>
                  {visited.has(spot.spotId) ? <Badge tone="leaf">訪問済み</Badge> : <Badge tone="gray">未訪問</Badge>}
                </div>
                <p className="text-sm text-ink-soft">
                  {spot.municipality}
                  {distance !== null && `・現在地から約${formatDistance(distance)}（直線）`}
                </p>
                <p className="mt-1 text-sm">
                  訪問で獲得：<span className="font-bold text-mikan-800">{getItem(spot.rewardItemId)?.name}</span>
                </p>
              </div>
            </div>
            <p className="mt-2 flex-1 text-sm">{spot.description}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => onShowOnMap(spot.spotId)} className="rpg-button bg-white px-2 text-base">
                地図で見る
              </button>
              <Link to={`/adventure/spots/${spot.spotId}`} className="rpg-button bg-mikan-100 px-2 text-base">
                くわしく・チェックイン
              </Link>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  )
}

/** 地図を表示する前に、現在地を使ってよいかを聞く */
function LocationPrompt({ permission, onAllow, onDecline }: { permission: LocationPermission; onAllow: () => void; onDecline: () => void }) {
  if (permission !== 'ask') return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="location-prompt-title"
      className="absolute inset-0 z-[600] flex items-center justify-center rounded-2xl bg-ink/55 p-4"
    >
      <div className="w-full max-w-sm rounded-2xl border-[4px] border-ink bg-white p-5 shadow-[0_6px_0_0_var(--color-ink)]">
        <h2 id="location-prompt-title" className="font-pixel text-xl">
          現在地を地図に表示しますか？
        </h2>
        <p className="mt-2">あなたのキャラクターが、地図の上を現在地に合わせて歩きます。近いスポットも分かるようになります。</p>
        <p className="mt-2 text-sm text-ink-soft">
          位置情報は、冒険画面を開いている間だけ使います。外部に送ったり保存したりしません（チェックインのときだけ、判定に使います）。
        </p>
        <button
          type="button"
          onClick={onAllow}
          className="rpg-button mt-4 w-full bg-leaf-500 text-white [text-shadow:1px_1px_0_var(--color-ink)]"
        >
          許可して地図を見る
        </button>
        <button type="button" onClick={onDecline} className="rpg-button mt-2 w-full bg-white">
          今は使わない
        </button>
      </div>
    </div>
  )
}

const LOCATION_NOTES: Partial<Record<LocationPermission, string>> = {
  declined: '現在地は表示していません。',
  denied: '位置情報が許可されていないため、現在地を表示できません。ブラウザの設定で、このサイトの位置情報を許可してください。',
  unavailable: 'この端末・ブラウザでは位置情報を使えません。',
}

export function AdventurePage() {
  const [params, setParams] = useSearchParams()
  const tab = toTab(params.get('tab'))
  const { session } = useSession()
  const { state, reload } = useAsyncData(loadVisits)
  const location = useLocationPermission()
  const [position, setPosition] = useState<MapPosition | null>(null)
  const [focus, setFocus] = useState<{ spotId: string; at: number } | undefined>()
  const showOnMap = useCallback((spotId: string) => setFocus({ spotId, at: Date.now() }), [])
  const note = LOCATION_NOTES[location.permission]

  return (
    <div className="space-y-4">
      <PageTitle lead="地図を見ながら愛媛の観光スポットを歩いてめぐろう。訪れると限定アイテムがもらえます。">冒険</PageTitle>

      {state.status === 'error' ? (
        <ErrorMessage message={state.message} onRetry={reload} />
      ) : (
        <div className="relative">
          {state.status === 'ready' && location.permission !== 'unknown' ? (
            <Suspense fallback={<div className="h-[52vh] min-h-72 animate-pulse rounded-2xl border-[3px] border-ink bg-seto-50" />}>
              <SpotMap
                visits={state.data}
                character={session.character}
                trackLocation={location.permission === 'granted'}
                focusSpotId={focus}
                onPosition={setPosition}
                onLocationError={location.onError}
              />
            </Suspense>
          ) : (
            <div className="h-[52vh] min-h-72 animate-pulse rounded-2xl border-[3px] border-ink bg-seto-50" />
          )}
          <LocationPrompt permission={location.permission} onAllow={location.allow} onDecline={location.decline} />
        </div>
      )}
      {note && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
          {note}
          {location.permission === 'declined' && (
            <button type="button" onClick={location.allow} className="font-bold text-seto-700 underline">
              現在地を表示する
            </button>
          )}
        </p>
      )}

      <Tabs label="冒険の切り替え" tabs={TABS} active={tab} onChange={(id) => setParams({ tab: id }, { replace: true })}>
        {/* AI の API（backend）がある環境では Bedrock 経由の提案、ない公開版では従来のブラウザ内モック */}
        {tab === 'ai' && (AI_QUEST_API_AVAILABLE ? <AiQuestPlanner /> : <QuestPlanner />)}
        {tab === 'quests' && <CommonQuests />}
        {(tab === 'spots' || tab === 'zukan') && state.status === 'loading' && <LoadingCards count={2} />}
        {tab === 'spots' && state.status === 'ready' && <SpotList visits={state.data} position={position} onShowOnMap={showOnMap} />}
        {tab === 'zukan' && state.status === 'ready' && <AdventureZukan visits={state.data} />}
      </Tabs>
      <p className="text-xs text-ink-soft">
        地図：© OpenStreetMap contributors。歩きスマホはやめましょう。立入禁止の場所には入らないでください。
      </p>
    </div>
  )
}
