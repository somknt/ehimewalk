// 愛媛県の観光マップ。地図は OpenStreetMap（API キー不要）を Leaflet で表示する。
// OpenStreetMap のタイル利用規約に従い、出典を地図の右下に表示する。利用者が増えたら、商用利用できる地図サービスに切り替える。
// 現在地はボタンを押したときに 1 回だけ取得して表示し、保存も送信もしない。
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { toUserMessage } from '../../api'
import { getItem } from '../../data/items'
import { SPOTS } from '../../data/spots'
import type { Visit } from '../../domain/types'
import { getCurrentPosition } from '../geo/getCurrentPosition'

/** 愛媛県の中心付近 */
const EHIME_CENTER: L.LatLngTuple = [33.84, 132.77]

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)

/** ドット絵風のピン（画像ファイルを使わず CSS で描く） */
function pinIcon(visited: boolean, label: string): L.DivIcon {
  const color = visited ? '#4caf50' : '#f39800'
  return L.divIcon({
    className: '',
    iconSize: [36, 44],
    iconAnchor: [18, 42],
    popupAnchor: [0, -38],
    html: `<div aria-hidden="true" style="width:36px;height:36px;border:3px solid #3d2b1f;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};box-shadow:2px 3px 0 #3d2b1f;display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg);color:#fff;font-weight:bold;font-size:16px;text-shadow:1px 1px 0 #3d2b1f">${escapeHtml(label)}</span></div>`,
  })
}

const youAreHereIcon = L.divIcon({
  className: '',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  html: '<div aria-hidden="true" style="width:22px;height:22px;border-radius:50%;background:#2aa5bd;border:4px solid #fff;box-shadow:0 0 0 3px #3d2b1f"></div>',
})

export function SpotMap({ visits }: { visits: readonly Visit[] }) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const meMarker = useRef<L.Marker | null>(null)
  /** スポットごとのピン（下のボタンから、そのスポットへ移動するため） */
  const spotMarkers = useRef(new Map<string, L.Marker>())
  const navigate = useNavigate()
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const visitedKey = visits.map((v) => v.spotId).sort().join(',')

  useEffect(() => {
    if (!container.current) return
    const visited = new Set(visitedKey ? visitedKey.split(',') : [])
    const m = L.map(container.current, { center: EHIME_CENTER, zoom: 9, scrollWheelZoom: false })
    map.current = m
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m)

    const bounds: L.LatLngTuple[] = []
    const markers = spotMarkers.current
    SPOTS.forEach((spot, index) => {
      const isVisited = visited.has(spot.spotId)
      const position: L.LatLngTuple = [spot.latitude, spot.longitude]
      bounds.push(position)
      const reward = getItem(spot.rewardItemId)
      const popup = document.createElement('div')
      popup.innerHTML = `<p style="font-weight:bold;font-size:16px;margin:0">${escapeHtml(spot.name)}</p>
        <p style="margin:2px 0 0;color:#6b5546">${escapeHtml(spot.municipality)}・${isVisited ? '訪問済み' : '未訪問'}</p>
        <p style="margin:4px 0 0">限定アイテム：${escapeHtml(reward?.name ?? '―')}</p>`
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = 'くわしく見る・チェックイン'
      button.style.cssText =
        'margin-top:8px;min-height:40px;width:100%;border:3px solid #3d2b1f;border-radius:10px;background:#ffd27a;font-weight:bold;cursor:pointer'
      button.addEventListener('click', () => navigate(`/adventure/spots/${spot.spotId}`))
      popup.appendChild(button)
      const marker = L.marker(position, { icon: pinIcon(isVisited, String(index + 1)), title: spot.name, alt: spot.name })
        .addTo(m)
        .bindPopup(popup)
      markers.set(spot.spotId, marker)
    })
    if (bounds.length > 0) m.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 })

    return () => {
      m.remove()
      map.current = null
      meMarker.current = null
      markers.clear()
    }
  }, [visitedKey, navigate])

  /** 近くのスポットはピンが重なるため、ボタンからスポットへ移動して情報を開けるようにする */
  const focusSpot = (spotId: string) => {
    const marker = spotMarkers.current.get(spotId)
    if (!marker || !map.current) return
    // アニメーションさせると、情報を開いたときの自動移動で拡大が打ち消されるため、拡大を先に終わらせる
    map.current.setView(marker.getLatLng(), 15, { animate: false })
    marker.openPopup()
    container.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  const showMe = async () => {
    setLocating(true)
    setError(null)
    try {
      const { latitude, longitude } = await getCurrentPosition()
      const m = map.current
      if (!m) return
      meMarker.current?.remove()
      meMarker.current = L.marker([latitude, longitude], { icon: youAreHereIcon, title: '現在地', alt: '現在地' }).addTo(m)
      m.setView([latitude, longitude], 14)
    } catch (e) {
      setError(toUserMessage(e, '現在地を取得できませんでした。'))
    } finally {
      setLocating(false)
    }
  }

  return (
    <div>
      <div
        ref={container}
        role="region"
        aria-label="愛媛県の観光スポットの地図"
        className="relative z-0 h-[60vh] min-h-80 overflow-hidden rounded-2xl border-[3px] border-ink"
      />
      <div role="group" aria-label="スポットへ移動" className="mt-3 flex flex-wrap gap-2">
        {SPOTS.map((spot, index) => (
          <button
            key={spot.spotId}
            type="button"
            onClick={() => focusSpot(spot.spotId)}
            className="min-h-11 rounded-full border-2 border-ink bg-white px-3 text-sm font-bold"
          >
            {index + 1}. {spot.name}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <button type="button" onClick={() => void showMe()} disabled={locating} className="rpg-button bg-white text-base disabled:opacity-60">
          {locating ? '現在地を取得しています…' : '現在地を表示'}
        </button>
        <span className="flex items-center gap-1">
          <span aria-hidden="true" className="inline-block size-4 rounded-full border-2 border-ink bg-mikan-500" />
          未訪問
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden="true" className="inline-block size-4 rounded-full border-2 border-ink bg-leaf-500" />
          訪問済み
        </span>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm font-bold text-red-700">
          {error}
        </p>
      )}
      <p className="mt-2 text-xs text-ink-soft">
        ピンを押すとスポットの情報が出ます。現在地はボタンを押したときに1回だけ取得し、保存しません。
        地図：© OpenStreetMap contributors
      </p>
    </div>
  )
}
