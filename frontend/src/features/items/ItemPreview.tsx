import { PixelArt } from '../../components/PixelArt'
import type { ItemMaster } from '../../data/items'
import type { Character } from '../../domain/types'
import { CharacterAvatar } from '../character/CharacterAvatar'

/**
 * アイテムの見た目。衣装と背景は「今のキャラクターが身につけた姿」で見せ、ペットは単体で見せる。
 * silhouette のときは形だけを見せる（図鑑の未入手表示）。
 */
export function ItemPreview({
  item,
  base,
  scale = 4,
  silhouette = false,
  className = '',
}: {
  item: ItemMaster
  base: Character
  scale?: number
  silhouette?: boolean
  className?: string
}) {
  const style = silhouette ? { filter: 'brightness(0)', opacity: 0.25 } : undefined

  if (item.visual.kind === 'pet') {
    return (
      <div className={`flex items-center justify-center ${className}`} style={style}>
        <PixelArt width={8} height={8} layers={[item.visual.sprite]} style={{ width: 8 * scale * 1.4, height: 8 * scale * 1.4 }} />
      </div>
    )
  }
  const preview: Character = { ...base, equipped: { ...base.equipped, [item.category]: item.itemId } }
  return (
    <div className={className} style={style}>
      <CharacterAvatar
        character={preview}
        scale={scale}
        showPet={false}
        showBackground={item.visual.kind === 'background'}
        className="h-full w-full rounded-lg"
      />
    </div>
  )
}
