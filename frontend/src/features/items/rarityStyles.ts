import type { Rarity } from '../../domain/types'

/** レア度ごとの色（バッジ・枠・光） */
export const RARITY_STYLES: Record<Rarity, { badge: string; frame: string; glow: string }> = {
  N: { badge: 'bg-gray-100 text-gray-700 border-gray-500', frame: 'border-ink/25', glow: '#ffffff' },
  R: { badge: 'bg-seto-100 text-seto-700 border-seto-600', frame: 'border-seto-500', glow: '#6fd3e6' },
  SR: { badge: 'bg-mikan-200 text-mikan-800 border-mikan-700', frame: 'border-mikan-500', glow: '#ffd27a' },
}
