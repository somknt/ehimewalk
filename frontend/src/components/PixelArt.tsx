import { useMemo, type CSSProperties } from 'react'
import { toRuns } from './pixelSvg'

/**
 * ドット絵の 1 レイヤー。
 * rows の各文字が 1 ピクセルで、`.` は透明、それ以外は palette の色で塗る。
 */
export interface PixelLayer {
  rows: readonly string[]
  palette: Readonly<Record<string, string>>
  offsetX?: number
  offsetY?: number
}

interface PixelArtProps {
  width: number
  height: number
  layers: readonly PixelLayer[]
  className?: string
  style?: CSSProperties
  /** 読み上げ用の説明。省略すると装飾扱い（aria-hidden） */
  label?: string
  /** 一部だけを拡大して表示するときの範囲（省略時は全体） */
  viewBox?: { x: number; y: number; width: number; height: number }
}

export function PixelArt({ width, height, layers, className, style, label, viewBox }: PixelArtProps) {
  const runs = useMemo(() => layers.flatMap(toRuns), [layers])
  return (
    <svg
      viewBox={viewBox ? `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}` : `0 0 ${width} ${height}`}
      shapeRendering="crispEdges"
      className={className}
      style={style}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {runs.map((run, i) => (
        <rect key={i} x={run.x} y={run.y} width={run.width} height={1} fill={run.color} />
      ))}
    </svg>
  )
}
