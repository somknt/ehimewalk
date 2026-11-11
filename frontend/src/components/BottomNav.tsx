import { NavLink } from 'react-router'
import { NAV_ICONS, type NavIconName } from './icons'
import { PixelArt } from './PixelArt'

const NAV_ITEMS: { to: string; label: string; icon: NavIconName }[] = [
  { to: '/', label: 'ホーム', icon: 'home' },
  { to: '/adventure', label: '冒険', icon: 'adventure' },
  { to: '/gacha', label: 'ガチャ', icon: 'gacha' },
  { to: '/ranking', label: 'ランキング', icon: 'ranking' },
  { to: '/mypage', label: 'マイページ', icon: 'mypage' },
]

export function BottomNav() {
  return (
    <nav
      aria-label="メインメニュー"
      className="fixed inset-x-0 bottom-0 z-40 border-t-[3px] border-ink bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                [
                  // 幅 360px の端末でも「ランキング」「マイページ」が 1 行に収まる文字サイズにしている
                  'mx-0.5 my-1.5 flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl border-2 text-xs leading-tight whitespace-nowrap',
                  isActive
                    ? 'border-ink bg-mikan-100 font-bold text-mikan-800'
                    : 'border-transparent text-ink-soft hover:bg-cream',
                ].join(' ')
              }
            >
              {({ isActive }) => (
                <>
                  <PixelArt
                    width={8}
                    height={8}
                    layers={[NAV_ICONS[item.icon]]}
                    className={isActive ? 'text-mikan-600' : 'text-ink-soft'}
                    style={{ width: 24, height: 24 }}
                  />
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
