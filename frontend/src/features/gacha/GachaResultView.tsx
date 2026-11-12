import { useEffect, useRef } from 'react'
import type { GachaDrawResult } from '../../api'
import { RarityBadge } from '../../components/ui'
import { getItem, RARITY_LABELS } from '../../data/items'
import { ItemThumbnail } from '../character/ItemThumbnail'
import { SLOT_LABELS } from '../wardrobe/slots'

/** 演出の長さ。短く、いつでもスキップできる */
export const REVEAL_MS = 1200

const CAPSULE_COLORS = { N: 'bg-gray-300', R: 'bg-seto-400', SR: 'bg-mikan-500', SSR: 'bg-yellow-400' } as const

/** カプセルが揺れる演出。終わったら（またはスキップしたら）onDone を呼ぶ */
export function GachaReveal({ result, onDone }: { result: GachaDrawResult; onDone: () => void }) {
  const doneRef = useRef(onDone)
  useEffect(() => {
    doneRef.current = onDone
  }, [onDone])
  useEffect(() => {
    const timer = window.setTimeout(() => doneRef.current(), REVEAL_MS)
    return () => window.clearTimeout(timer)
  }, [])

  const rarity = getItem(result.itemId)?.rarity ?? 'N'
  const rare = rarity === 'SR' || rarity === 'SSR'
  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <div className="relative flex h-36 w-36 items-center justify-center" aria-hidden="true">
        {rare && <div className="absolute inset-0 animate-gacha-glow rounded-full bg-yellow-200" />}
        <div className={`relative h-28 w-28 animate-gacha-shake overflow-hidden rounded-full border-[4px] border-ink ${CAPSULE_COLORS[rarity]}`}>
          <div className="absolute inset-x-0 bottom-0 h-1/2 border-t-[4px] border-ink bg-white" />
        </div>
      </div>
      <p role="status" className="font-pixel text-lg">
        {rare ? 'なにか光っている…！' : 'カプセルが出てきた！'}
      </p>
      <button type="button" className="rpg-button bg-white" onClick={onDone}>
        スキップ
      </button>
    </div>
  )
}

/** ガチャの結果。アイテム・レア度・新規か重複か・残りコインを一度に分かるように出す */
export function GachaResultCard({ result }: { result: GachaDrawResult }) {
  const item = getItem(result.itemId)
  if (!item) return null
  return (
    <div className="flex flex-col items-center gap-2 text-center" role="status" aria-live="polite">
      <p className="text-sm text-ink-soft">ガチャの結果</p>
      <div className="animate-gacha-pop rounded-2xl border-[3px] border-ink bg-cream p-3">
        <ItemThumbnail item={item} size={128} />
      </div>
      <p className="flex items-center gap-2">
        <RarityBadge rarity={item.rarity} />
        <span className="text-sm">
          {RARITY_LABELS[item.rarity]}・{SLOT_LABELS[item.category]}
        </span>
      </p>
      <p className="font-pixel text-2xl">{item.name}</p>
      <p className="text-sm text-ink-soft">{item.description}</p>
      {result.isDuplicate ? (
        <p className="rounded-xl border-2 border-seto-600 bg-seto-50 px-3 py-2 font-bold text-seto-700">
          重複アイテムを{result.refund}コインに変換しました
          <span className="block text-sm font-normal">（{item.rarity}・すでに持っているアイテムのため、持ち物は増えません）</span>
        </p>
      ) : (
        <p className="rounded-xl border-2 border-leaf-600 bg-leaf-50 px-3 py-2 font-bold text-leaf-700">
          NEW！ 持ち物に追加しました
        </p>
      )}
      <p className="text-sm">
        使ったコイン {result.cost}
        {result.refund > 0 && `・変換で +${result.refund}`}・残り <span className="font-bold">{result.balance.toLocaleString('ja-JP')}コイン</span>
      </p>
    </div>
  )
}
