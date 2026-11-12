// GPS チェックインの判定。サーバー側で行い、生の座標は判定後に保存しない。
import { distanceMeters, type LatLng } from './geo'

/** これより精度が悪い（誤差が大きい）位置は判定に使わず、再取得を促す */
export const MAX_ACCEPTABLE_ACCURACY_M = 200
/** GPS の誤差として判定半径に足す距離の上限 */
export const ACCURACY_ALLOWANCE_CAP_M = 50

export interface PositionReading extends LatLng {
  accuracyM: number
}

export type CheckInJudgement =
  | { status: 'success'; distanceM: number }
  | { status: 'too_far'; distanceM: number; allowedM: number }
  | { status: 'low_accuracy'; accuracyM: number }

export function judgeCheckIn(spot: LatLng & { checkinRadiusM: number }, position: PositionReading): CheckInJudgement {
  if (!Number.isFinite(position.accuracyM) || position.accuracyM > MAX_ACCEPTABLE_ACCURACY_M) {
    return { status: 'low_accuracy', accuracyM: position.accuracyM }
  }
  const distanceM = Math.round(distanceMeters(spot, position))
  const allowedM = spot.checkinRadiusM + Math.min(Math.max(0, position.accuracyM), ACCURACY_ALLOWANCE_CAP_M)
  return distanceM <= allowedM ? { status: 'success', distanceM } : { status: 'too_far', distanceM, allowedM }
}

export function isValidLatLng(value: LatLng): boolean {
  return (
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude) &&
    Math.abs(value.latitude) <= 90 &&
    Math.abs(value.longitude) <= 180
  )
}
