// キャラクターの体・顔・髪と、衣装の共通の形。
// キャンバスは 16 × 22 ピクセル。体は上に 2 ピクセルの余白（帽子用）を空けて描く。
import type { PixelLayer } from '../../components/PixelArt'
import type { EyeColorId, HairColorId, HairStyleId, SkinToneId } from '../../domain/types'

export const CHARACTER_WIDTH = 16
export const CHARACTER_HEIGHT = 22
export const BODY_OFFSET_Y = 2

export const OUTLINE = '#3d2b1f'

export const SKIN_TONES: Record<SkinToneId, { label: string; S: string }> = {
  light: { label: 'あかるい', S: '#ffe0c4' },
  medium: { label: 'ふつう', S: '#f4c48f' },
  tan: { label: 'こんがり', S: '#c98a55' },
  deep: { label: 'こい', S: '#8d5a3b' },
}

export const HAIR_COLORS: Record<HairColorId, { label: string; H: string; h: string }> = {
  black: { label: 'くろ', H: '#2f2a33', h: '#1c181f' },
  brown: { label: 'ちゃいろ', H: '#7a4a2a', h: '#55321b' },
  mikan: { label: 'みかん', H: '#f39800', h: '#c46f00' },
  blonde: { label: 'きんいろ', H: '#e9c46a', h: '#c9a043' },
  seto: { label: 'うみいろ', H: '#4cc3d9', h: '#2a8fa3' },
  pink: { label: 'さくら', H: '#f4a3c0', h: '#d77a9b' },
}

export const EYE_COLORS: Record<EyeColorId, { label: string; E: string }> = {
  brown: { label: 'ちゃいろ', E: '#5a3520' },
  black: { label: 'くろ', E: '#1f1a1a' },
  blue: { label: 'あお', E: '#2a6fb0' },
  green: { label: 'みどり', E: '#2e7031' },
}

export const BODY_ROWS = [
  '................',
  '................',
  '.....OOOOOO.....',
  '....OSSSSSSO....',
  '...OSSSSSSSSO...',
  '...OSSSSSSSSO...',
  '...OSSSSSSSSO...',
  '...OSSSSSSSSO...',
  '...OSSSSSSSSO...',
  '....OSSSSSSO....',
  '.....OOSSOO.....',
  '...OOSSSSSSOO...',
  '..OSOSSSSSSOSO..',
  '..OSOSSSSSSOSO..',
  '..OSOSSSSSSOSO..',
  '..OSOSSSSSSOSO..',
  '..OOOSSOOSSOOO..',
  '....OSSOOSSO....',
  '....OSSOOSSO....',
  '....OOOOOOOO....',
] as const

export const FACE_LAYER_ROWS = ['.....E....E.....', '.....E....E.....', '....M..RR..M....'] as const
export const FACE_OFFSET_Y = BODY_OFFSET_Y + 6
export const FACE_PALETTE = { M: '#f6a5a5', R: '#c0504d' } as const

export const HAIR_STYLES: Record<HairStyleId, { label: string; rows: readonly string[] }> = {
  short: {
    label: 'ショート',
    rows: [
      '.....OOOOOO.....',
      '...OOHHHHHHOO...',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHHO..',
      '..OHHhHHHHhHHO..',
      '..OHh......hHO..',
      '..OH........HO..',
      '...O........O...',
    ],
  },
  bob: {
    label: 'ボブ',
    rows: [
      '.....OOOOOO.....',
      '...OOHHHHHHOO...',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHHO..',
      '..OHHh....hHHO..',
      '..OHh......hHO..',
      '..OHh......hHO..',
      '..OHh......hHO..',
      '..OHHO....OHHO..',
      '...OO......OO...',
    ],
  },
  long: {
    label: 'ロング',
    rows: [
      '.....OOOOOO.....',
      '...OOHHHHHHOO...',
      '..OHHHHHHHHHHO..',
      '..OHHHHHHHHHHO..',
      '..OHHhHHHHhHHO..',
      '..OHh......hHO..',
      '..OHh......hHO..',
      '..OHh......hHO..',
      '..OHh......hHO..',
      '..OHH......HHO..',
      '..OHHO....OHHO..',
      '..OHHO....OHHO..',
      '..OHHO....OHHO..',
      '...OO......OO...',
    ],
  },
}

// 衣装の共通の形（体の座標に合わせたオフセット付き）
export const TOP_OFFSET_Y = BODY_OFFSET_Y + 11
export const TOP_SHIRT_ROWS = [
  '...OOTTSSTTOO...',
  '..OTOTTTTTTOTO..',
  '..OTOTTTTTTOTO..',
  '..OtOTTTTTTOtO..',
  '....OttttttO....',
] as const

export const BOTTOM_OFFSET_Y = BODY_OFFSET_Y + 16
export const BOTTOM_PANTS_ROWS = ['....OBBBBBBO....', '....OBBOOBBO....'] as const
export const BOTTOM_SKIRT_ROWS = ['...OBBBBBBBBO...', '...ObbbbbbbbO...'] as const

export const SHOES_OFFSET_Y = BODY_OFFSET_Y + 18
export const SHOES_ROWS = ['....OKKOOKKO....', '...OKKKOOKKKO...'] as const

/** 形と色から衣装レイヤーを作る */
export function outfitLayer(
  rows: readonly string[],
  offsetY: number,
  palette: Record<string, string>,
): PixelLayer {
  return { rows, offsetY, palette: { O: OUTLINE, ...palette } }
}
