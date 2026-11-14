import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { api, type CheckInResult, type SpotGuide } from '../api'
import { Badge, Card, CardTitle, ErrorMessage, LoadingCards } from '../components/ui'
import { getItem } from '../data/items'
import { getSpot } from '../data/spots'
import { MAX_ACCEPTABLE_ACCURACY_M } from '../domain/checkin'
import { googleMapsWalkingUrl } from '../domain/questPlanner'
import type { TouristSpot, Visit } from '../domain/types'
import { ItemThumbnail } from '../features/character/ItemThumbnail'
import { getCurrentPosition } from '../features/geo/getCurrentPosition'
import { useAction } from '../hooks/useAction'
import { useAsyncData } from '../hooks/useAsyncData'
import { NotFoundPage } from './NotFoundPage'

const formatKm = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`)

function CheckInResultMessage({ result }: { result: CheckInResult }) {
  if (result.status === 'success') {
    const reward = result.rewardItemId ? getItem(result.rewardItemId) : undefined
    return result.firstVisit ? (
      <div role="status" className="rounded-xl border-[3px] border-leaf-600 bg-leaf-50 p-3">
        <p className="font-pixel text-xl text-leaf-700">チェックイン成功！</p>
        {reward && <p className="mt-1">限定アイテム「{reward.name}」を手に入れました。</p>}
        {result.visit.via === 'ai_quest' && <p className="mt-1 text-sm">AIクエストからの訪問として記録しました。</p>}
        <Link to="/gacha/wardrobe" className="mt-2 inline-block font-bold text-seto-700 underline">
          着せ替えで身につける
        </Link>
      </div>
    ) : (
      <p role="status" className="rounded-xl bg-leaf-50 p-3 font-bold text-leaf-700">
        また来てくれたね！限定アイテムは初回の訪問でだけもらえます。
      </p>
    )
  }
  if (result.status === 'too_far') {
    return (
      <p role="status" className="rounded-xl bg-mikan-50 p-3">
        スポットまで約{formatKm(result.distanceM)}離れています（チェックインできる範囲：約{formatKm(result.allowedM)}以内）。
      </p>
    )
  }
  return (
    <p role="status" className="rounded-xl bg-mikan-50 p-3">
      位置情報の誤差が大きすぎます（約{formatKm(Math.round(result.accuracyM))}）。屋外で少し待ってから、もう一度お試しください。
    </p>
  )
}

function CheckInCard({
  spot,
  visit,
  onVisited,
}: {
  spot: TouristSpot
  visit: Visit | undefined
  onVisited: (visit: Visit) => void
}) {
  const [params] = useSearchParams()
  const via = params.get('via') === 'ai_quest' ? 'ai_quest' : 'list'
  const questId = params.get('questId') ?? undefined
  const [result, setResult] = useState<CheckInResult | null>(null)
  const reward = getItem(spot.rewardItemId)

  const checkIn = useAction(async (demoLocation: boolean) => {
    const position = demoLocation ? { latitude: 0, longitude: 0, accuracyM: 0 } : await getCurrentPosition()
    const res = await api.checkIn({ spotId: spot.spotId, ...position, via, questId, demoLocation })
    setResult(res)
    if (res.status === 'success') onVisited(res.visit)
  })

  return (
    <Card>
      <CardTitle aside={visit ? <Badge tone="leaf">訪問済み</Badge> : <Badge tone="gray">未訪問</Badge>}>チェックイン</CardTitle>
      {via === 'ai_quest' && (
        <p className="mb-3 rounded-lg bg-seto-50 px-3 py-2 text-sm">AIクエストから来ました。チェックインするとAI経由の訪問として記録します。</p>
      )}
      <div className="flex items-center gap-3">
        <div className="flex size-24 shrink-0 items-center justify-center rounded-lg border-2 border-ink/20 bg-mikan-50">
          {reward && <ItemThumbnail item={reward} size={80} />}
        </div>
        <div>
          <p className="text-sm text-ink-soft">はじめて訪れるともらえる限定アイテム</p>
          <p className="font-pixel text-xl text-mikan-800">{reward?.name}</p>
        </div>
      </div>
      <p className="mt-3 text-sm">
        スポットから約{spot.checkinRadiusM}m以内（GPSの誤差を少し考慮します）でチェックインできます。
      </p>
      <button
        type="button"
        onClick={() => void checkIn.run(false)}
        disabled={checkIn.pending}
        className="rpg-button mt-3 w-full bg-mikan-500 text-xl text-white [text-shadow:1px_1px_0_var(--color-ink)] disabled:opacity-60"
      >
        {checkIn.pending ? '位置を確認しています…' : '現在地でチェックインする'}
      </button>
      {/* デモ用チェックインは、モックと、オンラインのデモ用アカウントだけ（サーバー側でも確かめる） */}
      {(api.mode === 'mock' || api.demo !== null) && (
        <button
          type="button"
          onClick={() => void checkIn.run(true)}
          disabled={checkIn.pending}
          className="rpg-button mt-2 w-full bg-white text-base disabled:opacity-60"
        >
          デモ用：現地にいるものとしてチェックイン
        </button>
      )}
      {checkIn.error && (
        <p role="alert" className="mt-3 text-sm font-bold text-red-700">
          {checkIn.error}
        </p>
      )}
      {result && (
        <div className="mt-3">
          <CheckInResultMessage result={result} />
        </div>
      )}
      <p className="mt-3 text-xs text-ink-soft">
        位置情報はボタンを押したときに1回だけ取得し、判定に使ったあとは保存しません。精度が{MAX_ACCEPTABLE_ACCURACY_M}mより悪いときは判定しません。
        {(api.mode === 'mock' || api.demo !== null) && 'デモ用チェックインは、現地確認なしの記録として区別されます。'}
      </p>
    </Card>
  )
}

function GuideCard({ spotId }: { spotId: string }) {
  const [guide, setGuide] = useState<SpotGuide | null>(null)
  const ask = useAction(async () => setGuide(await api.getSpotGuide(spotId)))

  return (
    <Card className="bg-seto-50">
      <CardTitle aside={<Badge tone="gray">モック</Badge>}>AI観光ガイド</CardTitle>
      {!guide ? (
        <>
          <p className="text-sm">登録している情報（情報源付き）をもとに、このスポットの魅力を紹介します。</p>
          <button type="button" onClick={() => void ask.run()} disabled={ask.pending} className="rpg-button mt-3 w-full bg-seto-400 disabled:opacity-60">
            {ask.pending ? '調べています…' : 'ガイドに聞く'}
          </button>
        </>
      ) : (
        <div className="space-y-3">
          {guide.sections.map((section) => (
            <section key={section.heading}>
              <h3 className="font-bold">{section.heading}</h3>
              <p className={section.body ? '' : 'text-sm text-ink-soft'}>{section.body ?? '登録情報がありません。'}</p>
            </section>
          ))}
          <p className="text-xs text-ink-soft">
            登録情報以外のことは推測で答えません。いまはAI未接続のため、登録情報をそのまま表示しています。
          </p>
        </div>
      )}
      {ask.error && (
        <p role="alert" className="mt-2 text-sm font-bold text-red-700">
          {ask.error}
        </p>
      )}
    </Card>
  )
}

const loadVisits = () => api.getVisits()

export function SpotDetailPage() {
  const { spotId = '' } = useParams()
  const spot = getSpot(spotId)
  const { state, reload } = useAsyncData(loadVisits)
  // チェックイン直後の訪問記録。再読み込みせずに表示へ反映する（結果メッセージを消さないため）
  const [justVisited, setJustVisited] = useState<Visit | null>(null)

  if (!spot) return <NotFoundPage />

  const visit =
    (justVisited?.spotId === spot.spotId ? justVisited : undefined) ??
    (state.status === 'ready' ? state.data.find((v) => v.spotId === spot.spotId) : undefined)
  const nearby = spot.nearbySpotIds.map(getSpot).filter((s): s is TouristSpot => Boolean(s))
  const mapUrl = `https://www.google.com/maps/search/?${new URLSearchParams({ api: '1', query: `${spot.latitude},${spot.longitude}` })}`
  const routeUrl = googleMapsWalkingUrl(null, [spot])

  return (
    <div className="space-y-4">
      <Link to="/adventure" className="inline-block font-bold text-seto-700 underline">
        ← 冒険へもどる
      </Link>

      <div className="grid gap-4 md:grid-cols-2 md:items-start">
        <div className="space-y-4">
          <Card className="overflow-hidden p-0">
            <div
              className="flex h-40 items-end justify-center bg-gradient-to-b from-seto-100 to-seto-300"
              role="img"
              aria-label="写真は権利確認後に掲載します"
            >
              <p className="mb-3 rounded-lg bg-white/80 px-3 py-1 text-sm text-ink-soft">写真は権利を確認してから掲載します</p>
            </div>
            <div className="p-4">
              <p className="text-sm text-ink-soft">{spot.municipality}</p>
              <h1 className="font-pixel text-2xl">{spot.name}</h1>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {spot.tags.map((tag) => (
                  <Badge key={tag} tone="seto">
                    {tag}
                  </Badge>
                ))}
              </div>
              <p className="mt-3">{spot.description}</p>
              <p className="mt-2 text-sm text-ink-soft">所在地：{spot.address}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="rpg-button bg-white text-base">
                  地図で場所を見る
                </a>
                {routeUrl && (
                  <a href={routeUrl} target="_blank" rel="noopener noreferrer" className="rpg-button bg-white text-base">
                    ここまでの徒歩ルート
                  </a>
                )}
              </div>
              <p className="mt-2 text-xs text-ink-soft">地図と徒歩ルートは Googleマップ（外部サイト）で開きます。</p>
            </div>
          </Card>

          {nearby.length > 0 && (
            <Card>
              <CardTitle>周辺のスポット</CardTitle>
              <ul className="space-y-2">
                {nearby.map((s) => (
                  <li key={s.spotId}>
                    <Link to={`/adventure/spots/${s.spotId}`} className="font-bold text-seto-700 underline">
                      {s.name}
                    </Link>
                    <span className="ml-2 text-sm text-ink-soft">{s.municipality}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {state.status === 'loading' && <LoadingCards count={1} />}
          {state.status === 'error' && <ErrorMessage message={state.message} onRetry={reload} />}
          {state.status === 'ready' && <CheckInCard key={spot.spotId} spot={spot} visit={visit} onVisited={setJustVisited} />}
          <GuideCard spotId={spot.spotId} />
          <Card>
            <CardTitle>情報源</CardTitle>
            <ul className="space-y-1 text-sm">
              {spot.sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-seto-700 underline">
                    {source.label}
                  </a>
                </li>
              ))}
            </ul>
          </Card>
          <p className="text-sm text-ink-soft">
            歩きスマホはやめましょう。立入禁止の場所には入らず、施設の開館時間やルールを守って楽しんでください。
          </p>
        </div>
      </div>
    </div>
  )
}
