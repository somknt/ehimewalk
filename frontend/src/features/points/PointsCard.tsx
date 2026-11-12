import { Link } from 'react-router'
import type { PointBalance } from '../../api'
import { CoinIcon } from '../../components/CoinBadge'
import { Card, CardTitle } from '../../components/ui'
import { GACHA_COST, STEPS_PER_POINT, pointsShortForGacha } from '../../domain/points'
import { useBalance } from '../../hooks/useBalance'

/** 所持コイン。ヘッダーと同じ共通の残高を表示する（読み込み前は画面の読み込み結果を使う） */
export function PointsCard({ balance: initial, awardedNow }: { balance: PointBalance; awardedNow: number }) {
  const shared = useBalance()
  const balance = shared.status === 'ready' ? shared.balance : initial
  const short = pointsShortForGacha(balance.balance)

  return (
    <Card>
      <CardTitle>所持コイン</CardTitle>
      <div className="flex items-end justify-between gap-2">
        <p className="flex items-center gap-2 font-pixel text-4xl leading-none text-mikan-700">
          <CoinIcon size={32} />
          {balance.balance.toLocaleString('ja-JP')}
          <span className="text-xl">コイン</span>
        </p>
        {awardedNow > 0 && (
          <p role="status" className="rounded-lg bg-leaf-100 px-2 py-1 text-sm font-bold text-leaf-700">
            +{awardedNow} 獲得！
          </p>
        )}
      </div>

      <div className="mt-4 rounded-xl border-2 border-ink/15 bg-cream p-3">
        <div className="flex justify-between text-sm">
          <span>今日の歩数でもらったコイン</span>
          <span className="font-bold">{balance.todayStepPoints.toLocaleString('ja-JP')} コイン</span>
        </div>
        <p className="mt-1.5 text-sm text-ink-soft">
          {STEPS_PER_POINT}歩ごとに1コイン。1日の上限はありません。体調に合わせて、無理のない範囲で歩きましょう。
        </p>
      </div>

      <Link to="/gacha" className="rpg-button mt-4 w-full bg-mikan-500 text-white [text-shadow:1px_1px_0_var(--color-ink)]">
        ガチャを引く（1回 {GACHA_COST}コイン）
      </Link>
      {short > 0 && <p className="mt-2 text-center text-sm text-ink-soft">あと {short} コインで引けます</p>}
    </Card>
  )
}
