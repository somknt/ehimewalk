// ドット絵（PixelLayer）を SVG の文字列にする。React の外（地図のピンなど）でドット絵を描くときに使う。
import type { PixelLayer } from './PixelArt'

export interface PixelRun {
  x: number
  y: number
  width: number
  color: string
}

/** 横に連続する同じ色のピクセルを 1 つの矩形にまとめる */
export function toRuns(layer: PixelLayer): PixelRun[] {
  const runs: PixelRun[] = []
  const ox = layer.offsetX ?? 0
  const oy = layer.offsetY ?? 0
  layer.rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const char = row[x]
      const color = layer.palette[char]
      if (char === '.' || color === undefined) {
        x += 1
        continue
      }
      let end = x + 1
      while (end < row.length && row[end] === char) end += 1
      runs.push({ x: x + ox, y: y + oy, width: end - x, color })
      x = end
    }
  })
  return runs
}

/** 色の文字列として安全な値だけを通す（#rrggbb・#rgb・currentColor） */
const safeColor = (color: string) => (/^#[0-9a-fA-F]{3,8}$/.test(color) || color === 'currentColor' ? color : '#000')

export function pixelSvgString(width: number, height: number, layers: readonly PixelLayer[], size: { width: number; height: number }): string {
  const rects = layers
    .flatMap(toRuns)
    .map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="1" fill="${safeColor(r.color)}"/>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${size.width}" height="${size.height}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`
}
