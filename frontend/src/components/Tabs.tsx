import { useId, type KeyboardEvent, type ReactNode } from 'react'

export interface TabItem<T extends string> {
  id: T
  label: ReactNode
}

interface TabsProps<T extends string> {
  label: string
  tabs: readonly TabItem<T>[]
  active: T
  onChange: (id: T) => void
  children: ReactNode
}

/** WAI-ARIA のタブ。左右キーでも切り替えられる */
export function Tabs<T extends string>({ label, tabs, active, onChange, children }: TabsProps<T>) {
  const baseId = useId()

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    const index = tabs.findIndex((tab) => tab.id === active)
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
    onChange(next.id)
    document.getElementById(`${baseId}-tab-${next.id}`)?.focus()
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map((tab) => {
          const selected = tab.id === active
          return (
            <button
              key={tab.id}
              id={`${baseId}-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              onKeyDown={onKeyDown}
              // タブが 4 つ以上のときは、幅 360px の端末でも 1 行に収まるよう文字を小さくする
              className={`min-h-12 rounded-xl border-[3px] border-ink px-1 leading-tight font-bold ${
                tabs.length >= 4 ? 'text-sm sm:text-base' : ''
              } ${
                selected ? 'bg-mikan-500 text-white shadow-[0_4px_0_0_var(--color-ink)]' : 'bg-white text-ink-soft'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
      <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${active}`} className="mt-4">
        {children}
      </div>
    </div>
  )
}
