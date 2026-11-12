import { useMemo } from 'react'
import { PixelArt, type PixelLayer } from '../../components/PixelArt'
import type { ItemMaster } from '../../data/items'
import { BODY_OFFSET_Y, BODY_ROWS, CHARACTER_HEIGHT, CHARACTER_WIDTH } from './sprites'

/** 衣装を着せて見せるための、色のない体 */
const MANNEQUIN: PixelLayer = { rows: BODY_ROWS, offsetY: BODY_OFFSET_Y, palette: { O: '#cfc6bd', S: '#f1ece6' } }
/** 拡大表示の最小範囲（ドット） */
const MIN_VIEW = 12

/** 色のあるドットの範囲 */
function bounds(layers: PixelLayer[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const layer of layers) {
    layer.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] === '.') continue
        const px = x + (layer.offsetX ?? 0)
        const py = y + (layer.offsetY ?? 0)
        minX = Math.min(minX, px)
        maxX = Math.max(maxX, px)
        minY = Math.min(minY, py)
        maxY = Math.max(maxY, py)
      }
    })
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null
}

/** アイテムの部分を中心にした正方形の表示範囲 */
function focusViewBox(layers: PixelLayer[]) {
  const b = bounds(layers)
  if (!b) return { x: (CHARACTER_WIDTH - CHARACTER_HEIGHT) / 2, y: 0, width: CHARACTER_HEIGHT, height: CHARACTER_HEIGHT }
  const size = Math.min(CHARACTER_HEIGHT, Math.max(MIN_VIEW, b.maxX - b.minX + 3, b.maxY - b.minY + 3))
  const cx = (b.minX + b.maxX + 1) / 2
  const cy = (b.minY + b.maxY + 1) / 2
  return { x: cx - size / 2, y: Math.min(Math.max(0, cy - size / 2), CHARACTER_HEIGHT - size), width: size, height: size }
}

/** アイテム単体の絵（衣装はマネキンに着せ、その部分を拡大する） */
export function ItemThumbnail({ item, size = 64 }: { item: ItemMaster; size?: number }) {
  const art = useMemo(() => {
    const { visual } = item
    if (visual.kind === 'outfit') {
      const itemLayers = [...(visual.back ? [visual.back] : []), visual.front]
      const layers = [...(visual.back ? [visual.back] : []), MANNEQUIN, visual.front]
      return { width: CHARACTER_WIDTH, height: CHARACTER_HEIGHT, layers, viewBox: focusViewBox(itemLayers) }
    }
    if (visual.kind === 'pet') return { width: 8, height: 8, layers: [visual.sprite], viewBox: undefined }
    return null
  }, [item])

  if (!art) {
    // 背景は色見本として表示する
    const css = item.visual.kind === 'background' ? item.visual.css : undefined
    return <div aria-hidden="true" className="rounded-lg border-2 border-ink/30" style={{ width: size, height: size, background: css }} />
  }
  return (
    <PixelArt width={art.width} height={art.height} layers={art.layers} viewBox={art.viewBox} style={{ width: size, height: size }} />
  )
}
