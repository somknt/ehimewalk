import { Link } from 'react-router'
import { Card, CardTitle } from '../../components/ui'
import { getItem } from '../../data/items'
import { SPOTS } from '../../data/spots'
import type { Visit } from '../../domain/types'
import { useSession } from '../../session/sessionContext'
import { ItemPreview } from '../items/ItemPreview'

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric' }).format(new Date(iso))

/** 愛媛冒険図鑑。未訪問のスポットはシルエットで表示する */
export function AdventureZukan({ visits }: { visits: readonly Visit[] }) {
  const { session } = useSession()
  const byId = new Map(visits.map((visit) => [visit.spotId, visit]))

  return (
    <Card>
      <CardTitle aside={<span className="font-pixel">{byId.size} / {SPOTS.length}</span>}>愛媛冒険図鑑</CardTitle>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SPOTS.map((spot, index) => {
          const visit = byId.get(spot.spotId)
          const reward = getItem(spot.rewardItemId)
          return (
            <li key={spot.spotId}>
              <Link
                to={`/adventure/spots/${spot.spotId}`}
                className={`flex h-full gap-3 rounded-xl border-[3px] p-3 ${visit ? 'border-ink bg-white' : 'border-dashed border-ink/30 bg-cream'}`}
              >
                <div className="h-24 w-16 shrink-0 overflow-hidden rounded-lg border-2 border-ink/20 bg-mikan-50">
                  {reward && <ItemPreview item={reward} base={session.character} scale={3} silhouette={!visit} className="h-full w-full" />}
                </div>
                <div className="min-w-0">
                  <p className="font-pixel text-sm text-ink-soft">No.{String(index + 1).padStart(3, '0')}</p>
                  <p className="font-pixel text-lg">{visit ? spot.name : '？？？'}</p>
                  <p className="text-sm text-ink-soft">{spot.municipality}</p>
                  {visit ? (
                    <>
                      <p className="mt-1 text-sm">訪問日：{formatDate(visit.visitedAt)}</p>
                      <p className="text-sm text-mikan-800">獲得：{reward?.name}</p>
                      {!visit.verified && <p className="text-xs text-ink-soft">（デモ用チェックイン）</p>}
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-ink-soft">訪れると解放されます</p>
                  )}
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
      <p className="mt-3 text-xs text-ink-soft">今後、愛媛県20市町のスポットを追加していきます。</p>
    </Card>
  )
}
