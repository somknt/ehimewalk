import { useCallback, useEffect, useState } from 'react'

/**
 * 地図で現在地を表示してよいか。
 * - unknown：確認中
 * - ask：まだ決めていない（アプリの中で、使い道を説明してから許可を求める）
 * - granted：許可済み（地図を開いている間だけ現在地を取得する）
 * - declined：この画面では使わないと選んだ（このタブを閉じるまで聞き直さない）
 * - denied：ブラウザの設定で許可されていない
 * - unavailable：位置情報を使えない端末・ブラウザ
 */
export type LocationPermission = 'unknown' | 'ask' | 'granted' | 'declined' | 'denied' | 'unavailable'

const DECLINED_KEY = 'ewq.location.declined'

function readDeclined(): boolean {
  try {
    return globalThis.sessionStorage?.getItem(DECLINED_KEY) === '1'
  } catch {
    return false
  }
}

export function useLocationPermission() {
  const [permission, setPermission] = useState<LocationPermission>(() =>
    typeof navigator === 'undefined' || !navigator.geolocation ? 'unavailable' : 'unknown',
  )

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    let ignore = false
    const decide = (state: PermissionState | 'unsupported') => {
      if (ignore) return
      if (state === 'granted') setPermission('granted')
      else if (state === 'denied') setPermission('denied')
      else setPermission(readDeclined() ? 'declined' : 'ask')
    }
    // ブラウザが許可の状態を教えてくれれば使う（iPhone の Safari などは対応していないことがある）
    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: 'geolocation' }).then(
        (status) => decide(status.state),
        () => decide('unsupported'),
      )
    } else {
      decide('unsupported')
    }
    return () => {
      ignore = true
    }
  }, [])

  /** 「許可する」を押したとき。この後の位置の取得でブラウザの確認が表示される */
  const allow = useCallback(() => setPermission('granted'), [])
  const decline = useCallback(() => {
    try {
      globalThis.sessionStorage?.setItem(DECLINED_KEY, '1')
    } catch {
      // 保存できなくても続ける
    }
    setPermission('declined')
  }, [])
  /** 位置の取得に失敗したとき（code 1 は「許可されなかった」） */
  const onError = useCallback((code: number) => {
    if (code === 1) setPermission('denied')
  }, [])

  return { permission, allow, decline, onError }
}
