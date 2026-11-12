import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { api, ApiError, type GachaDrawResult } from '../api'
import { CoinIcon } from '../components/CoinBadge'
import { ActionError, Card, CardTitle, ComingSoon, ErrorMessage, LoadingCards, PageTitle, RarityBadge } from '../components/ui'
import { GACHA_DUPLICATE_COINS, getItem, NORMAL_GACHA_POOL, NORMAL_GACHA_RATES, RARITY_LABELS } from '../data/items'
import { RARITY_ORDER } from '../domain/gacha'
import { GACHA_COST, pointsShortForGacha, STEPS_PER_POINT } from '../domain/points'
import type { Character } from '../domain/types'
import { GachaResultCard, GachaReveal } from '../features/gacha/GachaResultView'
import { GachaTabs } from '../features/gacha/GachaTabs'
import { useAsyncData } from '../hooks/useAsyncData'
import { balanceStore, useBalance } from '../hooks/useBalance'
import { useSession } from '../session/sessionContext'

async function loadGachaPage(): Promise<{ character: Character }> {
  return { character: await api.getCharacter() }
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'drawing' }
  | { kind: 'revealing'; result: GachaDrawResult }
  | { kind: 'result'; result: GachaDrawResult }

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

function toMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.userMessage : fallback
}

export function GachaPage() {
  const { state, reload, update } = useAsyncData(loadGachaPage)
  // マイページの「ガチャの演出を短くする」設定（OS の「視差効果を減らす」と同じく演出を省く）
  const { reduceGachaEffects } = useSession().session.profile
  // 所持コインはヘッダーと同じ共通の残高を使う（ガチャの結果は API から通知され、即座に反映される）
  const balanceState = useBalance()
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const [equipping, setEquipping] = useState(false)

  if (state.status === 'loading' || balanceState.status === 'loading') {
    return (
      <Shell>
        <LoadingCards count={2} />
      </Shell>
    )
  }
  if (state.status === 'error' || balanceState.balance === null) {
    const message = state.status === 'error' ? state.message : 'コインの残高を読み込めませんでした。'
    return (
      <Shell>
        <ErrorMessage
          message={message}
          onRetry={() => {
            reload()
            void balanceStore.refresh()
          }}
        />
      </Shell>
    )
  }

  const { character } = state.data
  const balance = balanceState.balance.balance
  const short = pointsShortForGacha(balance)
  const busy = phase.kind === 'drawing' || phase.kind === 'revealing'

  const draw = async () => {
    setError(null)
    setPhase({ kind: 'drawing' })
    try {
      // 抽選結果は保存まで終わってから返ってくる。演出の途中で画面を閉じても結果は失われない
      const result = await api.drawGacha()
      setPhase(reduceGachaEffects || prefersReducedMotion() ? { kind: 'result', result } : { kind: 'revealing', result })
    } catch (e) {
      setError(toMessage(e, 'ガチャを引けませんでした。もう一度お試しください。'))
      setPhase({ kind: 'idle' })
      // 残高の表示がずれないよう、失敗時は読み直す
      void balanceStore.refresh()
    }
  }

  const result = phase.kind === 'result' ? phase.result : null
  const resultItem = result ? getItem(result.itemId) : undefined
  const wearing = resultItem ? character.equipped[resultItem.category] === resultItem.itemId : false

  const wear = async () => {
    if (!resultItem) return
    setError(null)
    setEquipping(true)
    try {
      const next = await api.equipItem(resultItem.category, resultItem.itemId)
      update((data) => ({ ...data, character: next }))
    } catch (e) {
      setError(toMessage(e, '装備できませんでした。もう一度お試しください。'))
    } finally {
      setEquipping(false)
    }
  }

  return (
    <Shell>
      <div className="grid gap-4 md:grid-cols-2 md:items-start">
        <Card className="text-center">
          <CardTitle>通常ガチャ</CardTitle>
          <p className="text-sm text-ink-soft">所持コイン</p>
          <p className="flex items-center justify-center gap-2 font-pixel text-5xl leading-tight text-mikan-700">
            <CoinIcon size={36} />
            {balance.toLocaleString('ja-JP')}
            <span className="text-xl">コイン</span>
          </p>

          {phase.kind === 'revealing' && (
            <GachaReveal result={phase.result} onDone={() => setPhase({ kind: 'result', result: phase.result })} />
          )}

          {result && (
            <div className="mt-4 space-y-3">
              <GachaResultCard result={result} />
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" className="rpg-button bg-seto-300" disabled={wearing || equipping} onClick={() => void wear()}>
                  {wearing ? '装備中' : equipping ? '装備しています…' : 'すぐに装備する'}
                </button>
                <Link to="/gacha/wardrobe" className="rpg-button bg-white">
                  着せ替えへ
                </Link>
              </div>
            </div>
          )}

          {phase.kind !== 'revealing' ? (
            <div className="mt-4 space-y-2">
              <button
                type="button"
                className="rpg-button min-h-16 w-full bg-mikan-500 text-2xl text-white [text-shadow:1px_1px_0_var(--color-ink)] disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-ink-soft disabled:[text-shadow:none]"
                disabled={short > 0 || busy}
                onClick={() => void draw()}
              >
                {phase.kind === 'drawing'
                  ? '抽選しています…'
                  : result
                    ? `もう1回引く（${GACHA_COST}コイン）`
                    : `1回引く（${GACHA_COST}コイン）`}
              </button>
              {short > 0 && (
                <p className="font-bold text-mikan-800">
                  コインが足りません。あと {short} コイン（約{(short * STEPS_PER_POINT).toLocaleString('ja-JP')}歩）で引けます。
                </p>
              )}
            </div>
          ) : null}

          {error && (
            <div className="mt-3 text-left">
              <ActionError message={error} />
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardTitle>排出確率</CardTitle>
            <table className="w-full border-collapse text-left">
              <caption className="mb-1 text-left text-sm text-ink-soft">現在の設定値（1回 {GACHA_COST}コイン）</caption>
              <thead>
                <tr className="border-b-2 border-ink text-sm">
                  <th scope="col" className="py-1.5">
                    レア度
                  </th>
                  <th scope="col" className="py-1.5 text-right">
                    確率
                  </th>
                  <th scope="col" className="py-1.5 text-right">
                    種類
                  </th>
                  <th scope="col" className="py-1.5 text-right">
                    重複時
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...RARITY_ORDER].reverse().map((rarity) => (
                  <tr key={rarity} className="border-b border-ink/20">
                    <td className="flex items-center gap-2 py-1.5">
                      <RarityBadge rarity={rarity} />
                      <span className="text-sm">{RARITY_LABELS[rarity]}</span>
                    </td>
                    <td className="py-1.5 text-right font-bold">{Math.round(NORMAL_GACHA_RATES[rarity] * 100)}%</td>
                    <td className="py-1.5 text-right text-sm">
                      {NORMAL_GACHA_POOL.filter((item) => item.rarity === rarity).length}種
                    </td>
                    <td className="py-1.5 text-right text-sm whitespace-nowrap">{GACHA_DUPLICATE_COINS[rarity]}コイン</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-soft">
              <li>同じレア度の中では、どのアイテムも同じ確率で出ます。</li>
              <li>持っているアイテムが出たときは、アイテムは増えず、レア度に応じたコイン（表の「重複時」）に自動で変換します。</li>
              <li>実際のお金は使いません。</li>
            </ul>
          </Card>

          <ComingSoon items={[{ label: 'アイテム図鑑（未所持アイテムの一覧）', task: 'タスク 1.10' }]} />
        </div>
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4">
      <PageTitle lead="歩いて貯めたコインで衣装やペットを手に入れよう。">ガチャ・着せ替え</PageTitle>
      <GachaTabs />
      {children}
    </div>
  )
}
