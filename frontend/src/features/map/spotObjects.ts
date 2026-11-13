// 地図や図鑑に置く、スポットのドット絵のオブジェクト（12 × 12）。スポットのタグから種類を決める。
import type { PixelLayer } from '../../components/PixelArt'
import type { TouristSpot } from '../../domain/types'

export const SPOT_OBJECT_SIZE = 12

const OUTLINE = '#3d2b1f'

const OBJECTS = {
  castle: {
    label: 'お城',
    layer: {
      rows: [
        '....Y..Y....',
        '...KKKKKK...',
        '..KKKKKKKK..',
        '....WBBW....',
        '.KKKKKKKKKK.',
        'KKKKKKKKKKKK',
        '..WWBWWBWW..',
        '..WWWWWWWW..',
        '..WWWBBWWW..',
        '.SSSSSSSSSS.',
        'SSSSSSSSSSSS',
        'SSSSSSSSSSSS',
      ],
      palette: { K: '#3a3f58', W: '#f5f0e6', B: OUTLINE, S: '#9a8f86', Y: '#e9b949' },
    },
  },
  onsen: {
    label: '温泉',
    layer: {
      rows: [
        '..V...V...V.',
        '.V...V...V..',
        '..V...V...V.',
        '.V...V...V..',
        '............',
        '.OOOOOOOOOO.',
        'OAAAAAAAAAAO',
        'OAaAAAAAAAAO',
        'OAAAAAAAAAAO',
        '.OAAAAAAAAO.',
        '..OOOOOOOO..',
        '............',
      ],
      palette: { V: '#e0565b', O: OUTLINE, A: '#4cc3d9', a: '#cdf2f9' },
    },
  },
  seaview: {
    label: '海の絶景',
    layer: {
      rows: [
        '............',
        '....YYYY....',
        '...YYYYYY...',
        '..YYYYYYYY..',
        '..YYYYYYYY..',
        'HHHHHHHHHHHH',
        'AAAAAAAAAAAA',
        'AaaAAAAAaaAA',
        'AAAAAaaAAAAA',
        'AAAAAAAAAAAA',
        'PPPPPPPPPPPP',
        'OOOOOOOOOOOO',
      ],
      palette: { Y: '#f39800', H: '#f7c873', A: '#2aa5bd', a: '#cdf2f9', P: '#9a8f86', O: OUTLINE },
    },
  },
  landmark: {
    label: 'スポット',
    layer: {
      rows: [
        '...BRRRRR...',
        '...BRRRRRR..',
        '...BRRRRRRR.',
        '...BRRRRRR..',
        '...BRRRRR...',
        '...B........',
        '...B........',
        '...B........',
        '...B........',
        '..GGGGG.....',
        '.GGGGGGG....',
        '............',
      ],
      palette: { B: OUTLINE, R: '#f39800', G: '#4caf50' },
    },
  },
} satisfies Record<string, { label: string; layer: PixelLayer }>

export type SpotObjectKind = keyof typeof OBJECTS

export function spotObjectKind(spot: TouristSpot): SpotObjectKind {
  if (spot.tags.includes('城')) return 'castle'
  if (spot.tags.includes('温泉')) return 'onsen'
  if (spot.tags.includes('海')) return 'seaview'
  return 'landmark'
}

export function spotObject(spot: TouristSpot): { label: string; layer: PixelLayer } {
  return OBJECTS[spotObjectKind(spot)]
}
