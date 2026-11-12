import { useBalance } from '../hooks/useBalance'
import { PixelArt, type PixelLayer } from './PixelArt'

/** 8 × 8 のコインのアイコン */
const COIN_ICON: PixelLayer = {
  rows: ['..OOOO..', '.OYYYYO.', 'OYYyyYYO', 'OYyYYYYO', 'OYyYYYYO', 'OYYyyYYO', '.OYYYYO.', '..OOOO..'],
  palette: { O: '#8a4a05', Y: '#ffd27a', y: '#d97f00' },
}

export function CoinIcon({ size = 20 }: { size?: number }) {
  return <PixelArt width={8} height={8} layers={[COIN_ICON]} style={{ width: size, height: size }} />
}

/** ヘッダーに出す所持コイン。すべての画面で共通の残高ストアを参照する */
export function CoinBadge() {
  const state = useBalance()
  const value = state.status === 'loading' ? null : (state.balance?.balance ?? null)
  const text = value === null ? '—' : value.toLocaleString('ja-JP')
  const label = value === null ? '所持コインを読み込み中' : `所持コイン ${text}枚`

  return (
    <p
      className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border-[3px] border-ink bg-white px-2.5 py-0.5 shadow-[0_2px_0_0_var(--color-ink)]"
      aria-label={label}
      aria-live="polite"
    >
      <CoinIcon />
      <span className="font-pixel text-lg leading-none tabular-nums">{text}</span>
      <span className="text-xs font-bold text-ink-soft">コイン</span>
    </p>
  )
}
