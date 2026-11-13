import { Link } from 'react-router'
import { PixelArt } from '../../components/PixelArt'
import { Card, ProgressBar } from '../../components/ui'
import { getItem } from '../../data/items'
import { SPOTS } from '../../data/spots'
import type { TouristSpot, Visit } from '../../domain/types'
import { ItemThumbnail } from '../character/ItemThumbnail'
import { SPOT_OBJECT_SIZE, spotObject } from '../map/spotObjects'

/** 未訪問のものは、形だけ（シルエット）を見せる */
const SILHOUETTE = { filter: 'brightness(0)', opacity: 0.22 }

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric' }).format(new Date(iso))

/** 市町ごとにまとめる（スポットの登録順を保つ） */
function groupByMunicipality(spots: readonly TouristSpot[]) {
  const groups = new Map<string, { name: string; spots: { spot: TouristSpot; no: number }[] }>()
  spots.forEach((spot, index) => {
    const group = groups.get(spot.municipalityCode) ?? { name: spot.municipality, spots: [] }
    group.spots.push({ spot, no: index + 1 })
    groups.set(spot.municipalityCode, group)
  })
  return [...groups.values()]
}

/** 訪問済みのしるし（はんこ風） */
function Stamp({ verified }: { verified: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="absolute top-1 right-1 flex size-14 rotate-12 flex-col items-center justify-center rounded-full border-[3px] border-red-600 bg-white/90 font-pixel leading-none text-red-600"
    >
      <span className="text-lg">訪問</span>
      <span className="text-[0.6rem]">{verified ? 'GPS' : 'デモ'}</span>
    </span>
  )
}

function ZukanCard({ spot, no, visit }: { spot: TouristSpot; no: number; visit: Visit | undefined }) {
  const reward = getItem(spot.rewardItemId)
  const object = spotObject(spot)
  return (
    <li>
      <Link
        to={`/adventure/spots/${spot.spotId}`}
        className={`relative flex h-full flex-col rounded-2xl border-[3px] p-3 ${
          visit ? 'border-ink bg-white shadow-[0_4px_0_0_var(--color-ink)]' : 'border-dashed border-ink/30 bg-cream'
        }`}
      >
        {visit && <Stamp verified={visit.verified} />}
        <p className="font-pixel text-sm text-ink-soft">No.{String(no).padStart(3, '0')}</p>
        <div
          className={`mx-auto mt-1 flex size-24 items-center justify-center rounded-2xl ${visit ? 'bg-seto-50' : 'bg-white/60'}`}
          style={visit ? undefined : SILHOUETTE}
        >
          <PixelArt width={SPOT_OBJECT_SIZE} height={SPOT_OBJECT_SIZE} layers={[object.layer]} style={{ width: 80, height: 80 }} />
        </div>
        <p className="mt-2 text-center font-pixel text-lg">{visit ? spot.name : '？？？'}</p>
        <p className="text-center text-sm text-ink-soft">
          {spot.municipality}・{object.label}
        </p>
        {visit ? (
          <div className="mt-2 rounded-xl bg-mikan-50 p-2 text-sm">
            <p>訪問日：{formatDate(visit.visitedAt)}</p>
            <div className="mt-1 flex items-center gap-2">
              {reward && <ItemThumbnail item={reward} size={36} />}
              <span>
                獲得：<span className="font-bold text-mikan-800">{reward?.name}</span>
              </span>
            </div>
          </div>
        ) : (
          <div className="mt-2 rounded-xl bg-white/70 p-2 text-sm text-ink-soft">
            <p>ヒント：{spot.tags.join('・')}</p>
            <div className="mt-1 flex items-center gap-2">
              <span style={SILHOUETTE}>{reward && <ItemThumbnail item={reward} size={36} />}</span>
              <span>限定アイテムあり</span>
            </div>
          </div>
        )}
      </Link>
    </li>
  )
}

/** 愛媛冒険図鑑。市町ごとに並べ、未訪問のスポットはシルエットで表示する */
export function AdventureZukan({ visits }: { visits: readonly Visit[] }) {
  const byId = new Map(visits.map((visit) => [visit.spotId, visit]))
  const visitedCount = SPOTS.filter((spot) => byId.has(spot.spotId)).length
  const complete = visitedCount === SPOTS.length

  return (
    <div className="space-y-4">
      <Card className={complete ? 'bg-leaf-50' : 'bg-mikan-50'}>
        <div className="flex items-end justify-between gap-2">
          <h2 className="font-pixel text-xl">愛媛冒険図鑑</h2>
          <p className="font-pixel text-2xl">
            {visitedCount}
            <span className="text-base"> / {SPOTS.length}</span>
          </p>
        </div>
        <div className="mt-2">
          <ProgressBar value={visitedCount / SPOTS.length} label="図鑑の完成度" />
        </div>
        <p className="mt-2 text-sm">
          {complete
            ? 'すべてのスポットを訪れました！ 新しいスポットの追加をお楽しみに。'
            : `あと ${SPOTS.length - visitedCount} か所で図鑑が完成します。「クエスト」の「愛媛冒険の第一歩」も達成できます。`}
        </p>
      </Card>

      {groupByMunicipality(SPOTS).map((group) => {
        const visitedInGroup = group.spots.filter(({ spot }) => byId.has(spot.spotId)).length
        return (
          <section key={group.name} aria-label={`${group.name}のスポット`}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-pixel text-lg">{group.name}</h3>
              <span className={`rounded-full border-2 px-2 text-sm font-bold ${visitedInGroup === group.spots.length ? 'border-leaf-600 bg-leaf-100 text-leaf-700' : 'border-ink/30 bg-white'}`}>
                {visitedInGroup} / {group.spots.length}
              </span>
            </div>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {group.spots.map(({ spot, no }) => (
                <ZukanCard key={spot.spotId} spot={spot} no={no} visit={byId.get(spot.spotId)} />
              ))}
            </ul>
          </section>
        )
      })}
      <p className="text-xs text-ink-soft">今後、愛媛県20市町のスポットを追加していきます。</p>
    </div>
  )
}
