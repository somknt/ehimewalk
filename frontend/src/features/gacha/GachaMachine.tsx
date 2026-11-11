import { useEffect, useRef, useState } from 'react'
import { api, type GachaDrawResult } from '../../api'
import { Card, CardTitle } from '../../components/ui'
import { NORMAL_GACHA_RATES, RARITY_LABELS, getItem } from '../../data/items'
import { GACHA_COST, pointsShortForGacha } from '../../domain/points'
import type { Rarity } from '../../domain/types'
import { useAction } from '../../hooks/useAction'
import { useSession } from '../../session/sessionContext'
import { ItemPreview } from '../items/ItemPreview'
import { RARITY_STYLES } from '../items/rarityStyles'

const RARITY_ORDER: Rarity[] = ['SR', 'R', 'N']
const CAPSULE_COLORS = ['#f39800', '#4cc3d9', '#4caf50', '#f4a3c0', '#ffd27a', '#ffffff']
/** 演出の長さ（ms）。レア度が高いほど少し長くする */
const ROLL_MS: Record<Rarity, number> = { N: 1400, R: 1800, SR: 2400 }

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

type Phase = { kind: 'idle' } | { kind: 'rolling'; result: GachaDrawResult } | { kind: 'reveal'; result: GachaDrawResult }

function Machine({ rolling, capsuleColor }: { rolling: boolean; capsuleColor: string }) {
  return (
    <div className="relative mx-auto w-48" aria-hidden="true">
      <div className={rolling ? 'animate-gacha-shake' : ''} style={{ transformOrigin: '50% 90%' }}>
        {/* ドーム */}
        <div className="relative mx-auto size-40 overflow-hidden rounded-full border-[4px] border-ink bg-seto-50">
          {CAPSULE_COLORS.concat(CAPSULE_COLORS).map((color, i) => (
            <span
              key={i}
              className="absolute size-9 rounded-full border-[3px] border-ink"
              style={{
                background: `linear-gradient(180deg, ${color} 50%, #fff 50%)`,
                left: `${10 + ((i * 37) % 70)}%`,
                top: `${40 + ((i * 23) % 45)}%`,
                transform: 'translate(-50%, -50%)',
              }}
            />
          ))}
          <span className="absolute top-3 left-6 h-8 w-4 rotate-30 rounded-full bg-white/70" />
        </div>
        {/* 本体 */}
        <div className="relative -mt-3 h-24 rounded-b-2xl rounded-t-md border-[4px] border-ink bg-mikan-500">
          <span className="absolute top-3 left-1/2 size-10 -translate-x-1/2 rounded-full border-[3px] border-ink bg-white" />
          <span className="absolute top-[30px] left-1/2 h-1.5 w-7 -translate-x-1/2 rounded bg-ink" />
          <span className="absolute bottom-2 left-1/2 h-8 w-16 -translate-x-1/2 rounded-t-xl border-[3px] border-ink bg-ink/80" />
        </div>
      </div>
      {rolling && (
        <span
          className="animate-capsule-drop absolute bottom-1 left-1/2 -ml-5 size-10 rounded-full border-[3px] border-ink"
          style={{ background: `linear-gradient(180deg, ${capsuleColor} 50%, #fff 50%)`, animationDelay: '0.9s' }}
        />
      )}
    </div>
  )
}

function RevealDialog({
  result,
  onClose,
  onEquip,
  onAgain,
  canDrawAgain,
  equipping,
}: {
  result: GachaDrawResult
  onClose: () => void
  onEquip: () => void
  onAgain: () => void
  canDrawAgain: boolean
  equipping: boolean
}) {
  const { session } = useSession()
  const item = getItem(result.itemId)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const style = RARITY_STYLES[result.rarity]
  const equipped = item ? session.character.equipped[item.category] === item.itemId : false

  useEffect(() => {
    headingRef.current?.focus()
  }, [result])

  if (!item) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4" role="dialog" aria-modal="true" aria-labelledby="gacha-result-title">
      <div className="animate-reveal-pop relative w-full max-w-sm overflow-hidden rounded-2xl border-[4px] border-ink bg-white p-5 text-center shadow-[0_6px_0_0_var(--color-ink)]">
        {result.rarity !== 'N' && (
          <div
            aria-hidden="true"
            className="animate-spin-slow pointer-events-none absolute -inset-1/2"
            style={{
              background:
                result.rarity === 'SR'
                  ? 'conic-gradient(from 0deg, #ffd27a33, #f4a3c055, #6fd3e655, #86c98855, #ffd27a33)'
                  : 'conic-gradient(from 0deg, #6fd3e622, #6fd3e655, #6fd3e622)',
            }}
          />
        )}
        <div className="relative">
          <span className={`inline-block rounded-full border-2 px-3 py-0.5 font-pixel ${style.badge}`}>
            {RARITY_LABELS[result.rarity]}
          </span>
          {result.rarity === 'SR' && (
            <p aria-hidden="true" className="animate-twinkle mt-1 font-pixel text-mikan-600">★ ☆ ★ ☆ ★</p>
          )}
          <h2 id="gacha-result-title" ref={headingRef} tabIndex={-1} className="mt-2 font-pixel text-2xl outline-none">
            {item.name}
          </h2>
          <div
            className={`mx-auto mt-3 h-52 w-40 overflow-hidden rounded-xl border-[3px] bg-cream ${style.frame}`}
            style={{ boxShadow: `0 0 24px 6px ${style.glow}` }}
          >
            <ItemPreview item={item} base={session.character} scale={7} className="h-full w-full" />
          </div>
          <p className="mt-3 text-sm text-ink-soft">{item.description}</p>
          <p className="mt-2 font-bold">
            {result.isNew ? <span className="text-leaf-700">NEW！ はじめて手に入れました</span> : `所持数が ${result.quantity} 個になりました`}
          </p>

          <div className="mt-4 grid gap-2">
            <button
              type="button"
              onClick={onEquip}
              disabled={equipped || equipping}
              className="rpg-button bg-seto-400 disabled:opacity-60"
            >
              {equipped
                ? '装備中です'
                : item.visual.kind === 'pet'
                  ? 'いっしょに連れていく'
                  : item.visual.kind === 'background'
                    ? '背景にする'
                    : 'さっそく着る'}
            </button>
            <button
              type="button"
              onClick={onAgain}
              disabled={!canDrawAgain}
              className="rpg-button bg-mikan-500 text-white [text-shadow:1px_1px_0_var(--color-ink)] disabled:opacity-50"
            >
              もう1回引く（{GACHA_COST}pt）
            </button>
            <button type="button" onClick={onClose} className="rpg-button bg-white">
              閉じる
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function GachaMachine({ onDrawn }: { onDrawn: (result: GachaDrawResult) => void }) {
  const { session, applyBalance, applyCharacter } = useSession()
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const timer = useRef<number | undefined>(undefined)
  const short = pointsShortForGacha(session.balance.balance)
  const skipEffects = session.profile.reduceGachaEffects || prefersReducedMotion()

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const draw = useAction(async () => {
    const result = await api.drawGacha()
    applyBalance(result.balance)
    onDrawn(result)
    if (skipEffects) {
      setPhase({ kind: 'reveal', result })
      return
    }
    setPhase({ kind: 'rolling', result })
    timer.current = window.setTimeout(() => setPhase({ kind: 'reveal', result }), ROLL_MS[result.rarity])
  })

  const equip = useAction(async (result: GachaDrawResult) => {
    const item = getItem(result.itemId)
    if (!item) return
    applyCharacter(await api.equipItem(item.category, item.itemId))
  })

  const rolling = phase.kind === 'rolling'
  const capsuleColor =
    phase.kind === 'idle' ? CAPSULE_COLORS[0] : phase.result.rarity === 'SR' ? '#ffd27a' : phase.result.rarity === 'R' ? '#4cc3d9' : '#f39800'

  return (
    <Card>
      <CardTitle>通常ガチャ</CardTitle>
      <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
        <Machine rolling={rolling} capsuleColor={capsuleColor} />
        <div>
          <p>
            1回 <span className="font-bold">{GACHA_COST}pt</span>。手に入れたアイテムは自動で持ち物に入ります。
          </p>
          <p className="mt-2">
            所持ポイント：<span className="font-pixel text-2xl text-mikan-700">{session.balance.balance.toLocaleString('ja-JP')}pt</span>
          </p>
          <button
            type="button"
            onClick={() => void draw.run()}
            disabled={short > 0 || draw.pending || rolling}
            className="rpg-button mt-3 w-full bg-mikan-500 text-xl text-white [text-shadow:1px_1px_0_var(--color-ink)] disabled:opacity-50"
          >
            {rolling ? 'ガラガラ…' : `ガチャを引く（${GACHA_COST}pt）`}
          </button>
          <p role="status" className="mt-2 min-h-6 text-center text-sm">
            {short > 0 ? `あと ${short}pt で引けます。歩いてポイントを貯めよう！` : rolling ? 'なにが出るかな…' : ''}
          </p>
          {draw.error && (
            <p role="alert" className="text-center text-sm font-bold text-red-700">
              {draw.error}
            </p>
          )}
        </div>
      </div>

      <table className="mt-4 w-full border-collapse text-left">
        <caption className="mb-1 text-left text-sm text-ink-soft">排出確率（現在の設定値）</caption>
        <thead>
          <tr className="border-b-2 border-ink">
            <th scope="col" className="py-1.5">
              レア度
            </th>
            <th scope="col" className="py-1.5 text-right">
              確率
            </th>
          </tr>
        </thead>
        <tbody>
          {RARITY_ORDER.map((rarity) => (
            <tr key={rarity} className="border-b border-ink/20">
              <td className="py-1.5">{RARITY_LABELS[rarity]}</td>
              <td className="py-1.5 text-right font-bold">{Math.round(NORMAL_GACHA_RATES[rarity] * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-ink-soft">
        同じレア度の中では、どのアイテムも同じ確率です。ガチャはポイントだけで引けます（課金はありません）。
      </p>

      {phase.kind === 'reveal' && (
        <RevealDialog
          result={phase.result}
          onClose={() => setPhase({ kind: 'idle' })}
          onEquip={() => void equip.run(phase.result)}
          onAgain={() => void draw.run()}
          canDrawAgain={short <= 0 && !draw.pending}
          equipping={equip.pending}
        />
      )}
    </Card>
  )
}
