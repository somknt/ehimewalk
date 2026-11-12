import type { EquipSlot } from '../../domain/types'

/** 着せ替え画面で選べるスロット（髪は外見の設定で変えるため、アイテムのスロットには含めない） */
export const WARDROBE_SLOTS: readonly EquipSlot[] = ['head', 'top', 'bottom', 'shoes', 'accessory', 'background', 'pet']

export const SLOT_LABELS: Record<EquipSlot, string> = {
  head: '頭',
  hair: '髪',
  top: '上の服',
  bottom: '下の服',
  shoes: '靴',
  accessory: 'アクセサリー',
  background: '背景',
  pet: 'ペット',
}
