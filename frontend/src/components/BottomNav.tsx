import { NavLink } from 'react-router'
import { NAV_ICONS } from './icons'
import { NAV_ITEMS } from './navItems'
import { PixelArt } from './PixelArt'

/** スマートフォン・タブレット用の下部固定ナビ（幅 1024px 以上では左側メニューに切り替える） */
export function BottomNav() {
  return (
    <nav
      aria-label="メインメニュー"
      className="fixed inset-x-0 bottom-0 z-40 border-t-[3px] border-ink bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
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
