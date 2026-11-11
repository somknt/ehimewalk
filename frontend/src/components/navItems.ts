import type { NavIconName } from './icons'

export interface NavItem {
  to: string
  label: string
  icon: NavIconName
}

/** スマートフォンの下部ナビと、パソコンの左側メニューで共通の項目 */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'ホーム', icon: 'home' },
  { to: '/adventure', label: '冒険', icon: 'adventure' },
  { to: '/gacha', label: 'ガチャ', icon: 'gacha' },
  { to: '/ranking', label: 'ランキング', icon: 'ranking' },
  { to: '/mypage', label: 'マイページ', icon: 'mypage' },
]
