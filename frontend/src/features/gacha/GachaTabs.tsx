import { NavLink } from 'react-router'

const TABS = [
  { to: '/gacha', label: 'ガチャを引く' },
  { to: '/gacha/wardrobe', label: '着せ替え' },
] as const

/** 「ガチャ・着せ替え」画面の中の切り替え。下部ナビの「ガチャ」はどちらでも選択中になる */
export function GachaTabs() {
  return (
    <nav aria-label="ガチャ・着せ替えの切り替え" className="mb-4 grid grid-cols-2 gap-2">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end
          className={({ isActive }) =>
            `flex min-h-12 items-center justify-center rounded-xl border-[3px] border-ink font-bold ${
              isActive ? 'bg-mikan-500 text-white shadow-[0_4px_0_0_var(--color-ink)]' : 'bg-white text-ink-soft'
            }`
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}
