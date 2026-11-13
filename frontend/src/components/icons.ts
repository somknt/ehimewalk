// ナビゲーション用の 8 × 8 ドットアイコン。X は currentColor（文字色）で塗る。
import type { PixelLayer } from './PixelArt'

const icon = (rows: string[]): PixelLayer => ({ rows, palette: { X: 'currentColor' } })

export const NAV_ICONS = {
  home: icon(['...XX...', '..XXXX..', '.XXXXXX.', 'XXXXXXXX', '.XXXXXX.', '.XX..XX.', '.XX..XX.', '.XX..XX.']),
  adventure: icon(['.XXXXX..', '.XXXXXXX', '.XXXXX..', '.X......', '.X......', '.X......', 'XXX.....', 'XXXXX...']),
  gacha: icon(['..XXXX..', '.X....X.', 'X......X', 'XXXXXXXX', 'XXXXXXXX', 'XXX..XXX', '.XXXXXX.', '..XXXX..']),
  friends: icon(['.XX..XX.', '.XX..XX.', '.XX..XX.', '........', 'XXXX.XXX', 'XXXX.XXX', 'XXXX.XXX', 'XXXX.XXX']),
  ranking: icon(['XXXXXXXX', 'X.XXXX.X', '.XXXXXX.', '..XXXX..', '...XX...', '...XX...', '..XXXX..', '.XXXXXX.']),
  mypage: icon(['..XXXX..', '..XXXX..', '..XXXX..', '...XX...', '.XXXXXX.', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX']),
} as const

export type NavIconName = keyof typeof NAV_ICONS
