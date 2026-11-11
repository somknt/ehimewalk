import type { PixelLayer } from '../../components/PixelArt'
import { getItem, type ItemMaster } from '../../data/items'
import type { Character, EquipSlot } from '../../domain/types'
import {
  BODY_OFFSET_Y,
  BODY_ROWS,
  EYE_COLORS,
  FACE_LAYER_ROWS,
  FACE_OFFSET_Y,
  FACE_PALETTE,
  HAIR_COLORS,
  HAIR_STYLES,
  OUTLINE,
  SKIN_TONES,
} from './sprites'

/** 体の前に重ねる順（先に描いたものが下になる） */
const FRONT_ORDER: readonly EquipSlot[] = ['bottom', 'shoes', 'top']
const OVER_HAIR_ORDER: readonly EquipSlot[] = ['head', 'accessory']

function outfitFront(item: ItemMaster | undefined): PixelLayer[] {
  return item?.visual.kind === 'outfit' ? [item.visual.front] : []
}

function outfitBack(item: ItemMaster | undefined): PixelLayer[] {
  return item?.visual.kind === 'outfit' && item.visual.back ? [item.visual.back] : []
}

/**
 * 外見と装備から、描画するレイヤーを下から順に並べる。
 * 順番：体の後ろ（マント等）→ 体 → 顔 → 下半身 → 靴 → 上半身 → 髪 → 頭 → アクセサリー
 */
export function buildCharacterLayers(character: Character): PixelLayer[] {
  const { appearance, equipped } = character
  const item = (slot: EquipSlot) => getItem(equipped[slot])
  const hair = HAIR_COLORS[appearance.hairColor]

  return [
    ...(Object.keys(equipped) as EquipSlot[]).flatMap((slot) => outfitBack(item(slot))),
    { rows: BODY_ROWS, offsetY: BODY_OFFSET_Y, palette: { O: OUTLINE, S: SKIN_TONES[appearance.skinTone].S } },
    { rows: FACE_LAYER_ROWS, offsetY: FACE_OFFSET_Y, palette: { ...FACE_PALETTE, E: EYE_COLORS[appearance.eyeColor].E } },
    ...FRONT_ORDER.flatMap((slot) => outfitFront(item(slot))),
    { rows: HAIR_STYLES[appearance.hairStyle].rows, offsetY: BODY_OFFSET_Y, palette: { O: OUTLINE, H: hair.H, h: hair.h } },
    ...OVER_HAIR_ORDER.flatMap((slot) => outfitFront(item(slot))),
  ]
}
