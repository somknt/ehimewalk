import type { ReactNode } from 'react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rpg-card p-4 ${className}`}>{children}</section>
}

export function CardTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="font-pixel text-lg">{children}</h2>
      {aside}
    </div>
  )
}

const BADGE_TONES = {
  mikan: 'bg-mikan-100 text-mikan-800 border-mikan-600',
  seto: 'bg-seto-100 text-seto-700 border-seto-600',
  leaf: 'bg-leaf-100 text-leaf-700 border-leaf-600',
  gray: 'bg-gray-100 text-gray-700 border-gray-500',
} as const

export function Badge({ children, tone = 'mikan' }: { children: ReactNode; tone?: keyof typeof BADGE_TONES }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border-2 px-2 py-0.5 text-xs font-bold ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  )
}

/** 0〜1 の割合を表すバー。1 を超えた分は満タン表示にする */
export function ProgressBar({ value, label }: { value: number; label: string }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-5 overflow-hidden rounded-full border-[3px] border-ink bg-mikan-50"
    >
      <div
        className={`h-full ${percent >= 100 ? 'bg-leaf-500' : 'bg-mikan-500'}`}
        style={{
          width: `${percent}%`,
          // ドット絵風の目盛り
          backgroundImage: 'repeating-linear-gradient(90deg, transparent 0 10px, rgb(255 255 255 / 0.35) 10px 12px)',
        }}
      />
    </div>
  )
}

export function Stat({ label, value, unit, note }: { label: string; value: string; unit?: string; note?: string }) {
  return (
    <div className="rounded-xl border-2 border-ink/20 bg-cream p-3">
      <p className="text-sm text-ink-soft">{label}</p>
      <p className="font-pixel text-2xl leading-tight">
        {value}
        {unit && <span className="ml-1 text-base">{unit}</span>}
      </p>
      {note && <p className="mt-0.5 text-xs text-ink-soft">{note}</p>}
    </div>
  )
}

export function PageTitle({ children, lead }: { children: ReactNode; lead?: ReactNode }) {
  return (
    <div className="mb-4">
      <h1 className="font-pixel text-2xl">{children}</h1>
      {lead && <p className="mt-1 text-ink-soft">{lead}</p>}
    </div>
  )
}

/** まだ実装していない機能の案内。どのタスクで作るかを明示する */
export function ComingSoon({ items }: { items: { label: string; task: string }[] }) {
  return (
    <Card className="bg-mikan-50">
      <CardTitle aside={<Badge tone="gray">準備中</Badge>}>今後できること</CardTitle>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.label} className="flex items-start justify-between gap-3">
            <span>・{item.label}</span>
            <span className="shrink-0 text-sm text-ink-soft">{item.task}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function LoadingCards({ count = 3 }: { count?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">読み込み中です</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rpg-card h-32 animate-pulse bg-mikan-50 motion-reduce:animate-none" />
      ))}
    </div>
  )
}

export function ErrorMessage({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="border-red-700 bg-red-50">
      <div role="alert">
        <h2 className="font-pixel text-lg text-red-800">うまく読み込めませんでした</h2>
        <p className="mt-2">{message}</p>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="rpg-button mt-4 w-full bg-white">
          もう一度読み込む
        </button>
      )}
    </Card>
  )
}
