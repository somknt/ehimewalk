import { NavLink } from 'react-router'
import { NAV_ICONS } from './icons'
import { NAV_ITEMS } from './navItems'
import { PixelArt } from './PixelArt'

/** パソコン用（幅 1024px 以上）の左側メニュー */
export function SideNav() {
  return (
    <nav aria-label="メインメニュー" className="hidden lg:sticky lg:top-28 lg:block lg:w-56 lg:shrink-0 lg:self-start">
      <ul className="rpg-card space-y-1 p-2">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                [
                  'flex min-h-12 items-center gap-3 rounded-xl border-2 px-3 text-lg',
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
                    style={{ width: 28, height: 28 }}
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
