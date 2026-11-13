// 愛媛県の冒険マップ。地図は OpenStreetMap（API キー不要）を Leaflet で表示する。
// OpenStreetMap のタイル利用規約に従い、出典を地図の右下に表示する。利用者が増えたら、商用利用できる地図サービスに切り替える。
// 現在地は、利用者が許可したときだけ、この地図を開いている間に取得して自分のキャラクターで表示する。
// 現在地は端末の外に送らず、保存もしない（チェックインのときだけ、判定のためにその時点の位置を送る）。
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { pixelSvgString } from '../../components/pixelSvg'
import { getItem } from '../../data/items'
import { SPOTS } from '../../data/spots'
import type { Character, Visit } from '../../domain/types'
import { buildCharacterLayers } from '../character/characterLayers'
import { CHARACTER_HEIGHT, CHARACTER_WIDTH } from '../character/sprites'
import { SPOT_OBJECT_SIZE, spotObject } from './spotObjects'

/** 愛媛県の中心付近 */
const EHIME_CENTER: L.LatLngTuple = [33.84, 132.77]
/** 現在地がこの範囲（愛媛県のまわり）なら、現在地に地図を寄せる */
const EHIME_BOUNDS = L.latLngBounds([32.8, 131.9], [34.5, 133.8])

export interface MapPosition {
  latitude: number
  longitude: number
  accuracyM: number
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)

/** スポットのオブジェクト（ドット絵）を丸い台座にのせたピン */
function spotIcon(spotIndex: number, visited: boolean): L.DivIcon {
  const spot = SPOTS[spotIndex]
  const art = pixelSvgString(SPOT_OBJECT_SIZE, SPOT_OBJECT_SIZE, [spotObject(spot).layer], { width: 34, height: 34 })
  const badge = visited
    ? '<span style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;background:#4caf50;border:2px solid #3d2b1f;color:#fff;font-size:12px;font-weight:bold;display:flex;align-items:center;justify-content:center">✓</span>'
    : ''
  return L.divIcon({
    className: '',
    iconSize: [48, 60],
    iconAnchor: [24, 58],
    popupAnchor: [0, -54],
    html: `<div style="position:relative;width:48px;height:60px">
      <div style="width:48px;height:48px;border-radius:50%;background:${visited ? '#eef8ee' : '#fff8ee'};border:3px solid #3d2b1f;box-shadow:2px 3px 0 #3d2b1f;display:flex;align-items:center;justify-content:center">${art}</div>
      <div style="position:absolute;left:19px;top:46px;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:12px solid #3d2b1f"></div>
      ${badge}
    </div>`,
  })
}

/** 現在地を表す、自分のキャラクター（歩いているように揺れる） */
function walkerIcon(character: Character): L.DivIcon {
  const art = pixelSvgString(CHARACTER_WIDTH, CHARACTER_HEIGHT, buildCharacterLayers(character), { width: 36, height: 50 })
  return L.divIcon({
    className: '',
    iconSize: [36, 58],
    iconAnchor: [18, 56],
    html: `<div class="map-walker" style="position:relative;width:36px;height:58px">
      <div class="map-walker-body">${art}</div>
      <div style="position:absolute;left:6px;bottom:0;width:24px;height:7px;border-radius:50%;background:rgba(61,43,31,.35)"></div>
    </div>`,
  })
}

export function SpotMap({
  visits,
  character,
  trackLocation,
  focusSpotId,
  onPosition,
  onLocationError,
}: {
  visits: readonly Visit[]
  character: Character
  /** 現在地を表示するか（利用者が許可したとき true） */
  trackLocation: boolean
  /** このスポットに地図を寄せて情報を開く（値が変わるたびに動く） */
  focusSpotId?: { spotId: string; at: number }
  onPosition?: (position: MapPosition) => void
  onLocationError?: (code: number) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const walker = useRef<L.Marker | null>(null)
  const accuracyCircle = useRef<L.Circle | null>(null)
  const spotMarkers = useRef(new Map<string, L.Marker>())
  const centeredOnMe = useRef(false)
  const lastPosition = useRef<MapPosition | null>(null)
  const [hasPosition, setHasPosition] = useState(false)
  const navigate = useNavigate()
  const visitedKey = visits.map((v) => v.spotId).sort().join(',')
  // コールバックは毎回新しくなるため、最新のものを ref に入れて使う
  const callbacks = useRef({ onPosition, onLocationError })
  const characterRef = useRef(character)
  useEffect(() => {
    callbacks.current = { onPosition, onLocationError }
    characterRef.current = character
  }, [onPosition, onLocationError, character])

  // 地図とスポットのピン
  useEffect(() => {
    if (!container.current) return
    const visited = new Set(visitedKey ? visitedKey.split(',') : [])
    const m = L.map(container.current, { center: EHIME_CENTER, zoom: 9, scrollWheelZoom: false, zoomControl: true })
    map.current = m
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m)

    const markers = spotMarkers.current
    const bounds: L.LatLngTuple[] = []
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
      const marker = L.marker(position, { icon: spotIcon(index, isVisited), title: spot.name, alt: spot.name }).addTo(m).bindPopup(popup)
      markers.set(spot.spotId, marker)
    })
    if (bounds.length > 0) m.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 })

    // 前に取得していた現在地があれば、キャラクターを置き直す
    if (lastPosition.current) {
      const { latitude, longitude } = lastPosition.current
      walker.current = L.marker([latitude, longitude], { icon: walkerIcon(characterRef.current), title: '現在地', alt: '現在地', zIndexOffset: 1000 }).addTo(m)
    }

    return () => {
      m.remove()
      map.current = null
      walker.current = null
      accuracyCircle.current = null
      markers.clear()
    }
  }, [visitedKey, navigate])

  // キャラクターの見た目が変わったら、現在地のアイコンを差し替える
  useEffect(() => {
    walker.current?.setIcon(walkerIcon(character))
  }, [character])

  // 現在地（地図を開いている間だけ追いかける）
  useEffect(() => {
    if (!trackLocation || typeof navigator === 'undefined' || !navigator.geolocation) return
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const next: MapPosition = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyM: position.coords.accuracy,
        }
        lastPosition.current = next
        setHasPosition(true)
        callbacks.current.onPosition?.(next)
        const m = map.current
        if (!m) return
        const latLng: L.LatLngTuple = [next.latitude, next.longitude]
        if (walker.current) walker.current.setLatLng(latLng)
        else walker.current = L.marker(latLng, { icon: walkerIcon(characterRef.current), title: '現在地', alt: '現在地', zIndexOffset: 1000 }).addTo(m)
        // GPS の誤差の範囲を薄い円で示す
        if (accuracyCircle.current) accuracyCircle.current.setLatLng(latLng).setRadius(next.accuracyM)
        else
          accuracyCircle.current = L.circle(latLng, {
            radius: next.accuracyM,
            color: '#2aa5bd',
            weight: 1,
            fillColor: '#4cc3d9',
            fillOpacity: 0.12,
            interactive: false,
          }).addTo(m)
        // 最初の 1 回だけ、愛媛県内にいれば現在地に地図を寄せる
        if (!centeredOnMe.current && EHIME_BOUNDS.contains(latLng)) {
          centeredOnMe.current = true
          m.setView(latLng, 15)
        }
      },
      (error) => callbacks.current.onLocationError?.(error.code),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [trackLocation])

  // 一覧などから選んだスポットに地図を寄せる
  useEffect(() => {
    if (!focusSpotId) return
    const marker = spotMarkers.current.get(focusSpotId.spotId)
    if (!marker || !map.current) return
    // アニメーションさせると、情報を開いたときの自動移動で拡大が打ち消されるため、拡大を先に終わらせる
    map.current.setView(marker.getLatLng(), 15, { animate: false })
    marker.openPopup()
    container.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusSpotId])

  const goToMe = () => {
    const position = lastPosition.current
    if (position && map.current) map.current.setView([position.latitude, position.longitude], 16)
  }
  const showAll = () => {
    map.current?.fitBounds(
      SPOTS.map((s): L.LatLngTuple => [s.latitude, s.longitude]),
      { padding: [40, 40], maxZoom: 13 },
    )
  }

  return (
    <div className="relative">
      <div
        ref={container}
        role="region"
        aria-label="愛媛県の観光スポットの地図"
        className="relative z-0 h-[52vh] min-h-72 overflow-hidden rounded-2xl border-[3px] border-ink lg:h-[60vh]"
      />
      <div className="pointer-events-none absolute right-2 bottom-8 z-[500] flex flex-col gap-2">
        {hasPosition && (
          <button
            type="button"
            onClick={goToMe}
            className="pointer-events-auto min-h-11 rounded-full border-[3px] border-ink bg-white px-3 text-sm font-bold shadow-[0_3px_0_0_var(--color-ink)]"
          >
            現在地へ
          </button>
        )}
        <button
          type="button"
          onClick={showAll}
          className="pointer-events-auto min-h-11 rounded-full border-[3px] border-ink bg-white px-3 text-sm font-bold shadow-[0_3px_0_0_var(--color-ink)]"
        >
          全体を見る
        </button>
      </div>
    </div>
  )
}
