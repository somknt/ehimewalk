import { useMemo } from 'react'
import { PixelArt } from '../../components/PixelArt'
import { getItem } from '../../data/items'
import type { Character } from '../../domain/types'
import { buildCharacterLayers } from './characterLayers'
import { CHARACTER_HEIGHT, CHARACTER_WIDTH } from './sprites'

interface CharacterAvatarProps {
  character: Character
  /** 1 ドットの表示サイズ（px） */
  scale?: number
  showBackground?: boolean
  showPet?: boolean
  animated?: boolean
  className?: string
}

export function CharacterAvatar({
  character,
  scale = 10,
  showBackground = true,
  showPet = true,
  animated = false,
  className = '',
}: CharacterAvatarProps) {
  const layers = useMemo(() => buildCharacterLayers(character), [character])
  const background = getItem(character.equipped.background)
  const pet = getItem(character.equipped.pet)

  const equippedNames = Object.values(character.equipped)
    .map((id) => getItem(id)?.name)
    .filter(Boolean)
    .join('、')
  const label = `${character.name}${equippedNames ? `（装備：${equippedNames}）` : ''}`

  const width = CHARACTER_WIDTH * scale
  const height = CHARACTER_HEIGHT * scale

  return (
    <div
      className={`relative flex items-end justify-center overflow-hidden ${className}`}
      style={showBackground && background?.visual.kind === 'background' ? { background: background.visual.css } : undefined}
    >
      <PixelArt
        width={CHARACTER_WIDTH}
        height={CHARACTER_HEIGHT}
        layers={layers}
        label={label}
        className={`relative z-10 ${animated ? 'animate-bob' : ''}`}
        // SVG はサイズ指定が無いと親いっぱいに広がるため、ドット数 × 倍率で固定する
        style={{ width, height }}
      />
      {showPet && pet?.visual.kind === 'pet' && (
        <PixelArt
          width={8}
          height={8}
          layers={[pet.visual.sprite]}
          label={`ペット：${pet.name}`}
          className={`absolute bottom-1 z-20 ${animated ? 'animate-bob' : ''}`}
          style={{ width: 8 * scale * 0.6, height: 8 * scale * 0.6, left: `calc(50% + ${width / 2}px - ${scale}px)` }}
        />
      )}
    </div>
  )
}
