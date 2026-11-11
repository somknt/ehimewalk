// 現在地の取得。ボタンを押したときだけ 1 回取得し、常時追跡はしない。
import { ApiError } from '../../api'

export interface CurrentPosition {
  latitude: number
  longitude: number
  accuracyM: number
}

const MESSAGES: Record<number, string> = {
  1: '位置情報の利用が許可されていません。ブラウザの設定で、このサイトの位置情報を許可してください。',
  2: '現在地を取得できませんでした。屋外や窓の近くで、もう一度お試しください。',
  3: '現在地の取得に時間がかかっています。もう一度お試しください。',
}

export function getCurrentPosition(): Promise<CurrentPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new ApiError('この端末・ブラウザでは位置情報を使えません。'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyM: position.coords.accuracy,
        }),
      (error) => reject(new ApiError(MESSAGES[error.code] ?? MESSAGES[2])),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    )
  })
}
