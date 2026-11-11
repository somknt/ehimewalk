import type { ReactNode } from 'react'

interface ChoiceOption<T extends string> {
  value: T
  label: ReactNode
  /** 色見本など、ラベルの前に出す見た目 */
  swatch?: string
}

/** ボタン型の単一選択（ラジオボタン相当） */
export function ChoiceGroup<T extends string>({
  legend,
  options,
  value,
  onChange,
  columns = 3,
}: {
  legend: string
  options: readonly ChoiceOption<T>[]
  value: T
  onChange: (value: T) => void
  columns?: number
}) {
  return (
    <fieldset>
      <legend className="mb-2 font-bold">{legend}</legend>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {options.map((option) => {
          const checked = option.value === value
          return (
            <label
              key={option.value}
              className={`flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border-[3px] px-2 py-1 text-center has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-seto-500 ${
                checked ? 'border-ink bg-mikan-100 font-bold' : 'border-ink/25 bg-white'
              }`}
            >
              <input
                type="radio"
                className="sr-only"
                checked={checked}
                onChange={() => onChange(option.value)}
                name={legend}
              />
              {option.swatch && (
                <span aria-hidden="true" className="size-5 shrink-0 rounded-full border-2 border-ink" style={{ background: option.swatch }} />
              )}
              <span>{option.label}</span>
              {checked && <span className="sr-only">（選択中）</span>}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

/** オン・オフの切り替え */
export function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-2">
      <span>
        <span className="font-bold">{label}</span>
        {description && <span className="mt-0.5 block text-sm text-ink-soft">{description}</span>}
      </span>
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="h-8 w-14 rounded-full border-[3px] border-ink bg-gray-200 transition-colors peer-checked:bg-leaf-500 peer-focus-visible:outline-3 peer-focus-visible:outline-seto-500 peer-disabled:opacity-50" />
        <span className="absolute top-1 left-1 size-6 rounded-full border-2 border-ink bg-white transition-transform peer-checked:translate-x-6" />
        <span className="sr-only">{checked ? 'オン' : 'オフ'}</span>
      </span>
    </label>
  )
}

export function TextField({
  label,
  value,
  onChange,
  maxLength,
  hint,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  maxLength?: number
  hint?: string
}) {
  return (
    <label className="block">
      <span className="font-bold">{label}</span>
      <input
        type="text"
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block min-h-12 w-full rounded-xl border-[3px] border-ink bg-white px-3 text-lg"
      />
      {hint && <span className="mt-1 block text-sm text-ink-soft">{hint}</span>}
    </label>
  )
}
