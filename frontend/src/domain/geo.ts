// 2 点間の距離（球面三角法・ハーバーサイン公式）

const EARTH_RADIUS_M = 6_371_000

export interface LatLng {
  latitude: number
  longitude: number
}

const toRad = (deg: number) => (deg * Math.PI) / 180

export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude)
  const dLng = toRad(b.longitude - a.longitude)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

/** 直線距離に掛ける迂回係数。実際の道のりは直線より長いため、目安としてのみ使う */
export const DETOUR_FACTOR = 1.3
