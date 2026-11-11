import { Link } from 'react-router'
import { api, type PointBalance } from '../../api'
import { Card, CardTitle, ProgressBar } from '../../components/ui'
import { GACHA_COST, STEPS_PER_POINT, pointsShortForGacha } from '../../domain/points'
import { useAction } from '../../hooks/useAction'
import { useSession } from '../../session/sessionContext'

export function PointsCard({ balance, awardedNow }: { balance: PointBalance; awardedNow: number }) {
  const { applyBalance } = useSession()
  const claim = useAction(async () => {
    const result = await api.claimLoginBonus()
    applyBalance(result.balance)
  })
  const short = pointsShortForGacha(balance.balance)
  const reachedCap = balance.todayStepPoints >= balance.dailyStepPointCap

  return (
    <Card>
      <CardTitle>所持ポイント</CardTitle>
      <div className="flex items-end justify-between gap-2">
        <p className="font-pixel text-4xl leading-none text-mikan-700">
          {balance.balance.toLocaleString('ja-JP')}
          <span className="ml-1 text-xl">pt</span>
        </p>
        {awardedNow > 0 && (
          <p role="status" className="rounded-lg bg-leaf-100 px-2 py-1 text-sm font-bold text-leaf-700">
            歩数で +{awardedNow}pt
          </p>
        )}
      </div>

      <div className="mt-4">
        <div className="mb-1 flex justify-between text-sm">
          <span>今日の歩数ポイント</span>
          <span className="font-bold">
            {balance.todayStepPoints} / {balance.dailyStepPointCap}pt
          </span>
        </div>
        <ProgressBar value={balance.todayStepPoints / balance.dailyStepPointCap} label="今日の歩数ポイントの獲得状況" />
        <p className="mt-1.5 text-sm text-ink-soft">
          {reachedCap
            ? '今日の歩数ポイントは上限に達しました。無理せず休みましょう。'
            : `${STEPS_PER_POINT}歩ごとに1pt。1日${balance.dailyStepPointCap}ptまでもらえます。`}
        </p>
      </div>

      <div className="mt-4 rounded-xl border-2 border-dashed border-mikan-600 bg-mikan-50 p-3">
        {balance.loginBonusClaimedToday ? (
          <p className="text-center text-sm font-bold text-mikan-800">今日のログインボーナスは受け取り済みです</p>
        ) : (
          <>
            <p className="text-sm">歩数が少ない日も、毎日ログインするだけでもらえます。</p>
            <button
              type="button"
              onClick={() => void claim.run()}
              disabled={claim.pending}
              className="rpg-button mt-2 w-full bg-white disabled:opacity-60"
            >
              ログインボーナスを受け取る（+{balance.loginBonusAmount}pt）
            </button>
          </>
        )}
        {claim.error && (
          <p role="alert" className="mt-2 text-sm font-bold text-red-700">
            {claim.error}
          </p>
        )}
      </div>

      <Link to="/gacha" className="rpg-button mt-4 w-full bg-mikan-500 text-white [text-shadow:1px_1px_0_var(--color-ink)]">
        ガチャを引く（1回 {GACHA_COST}pt）
      </Link>
      {short > 0 && <p className="mt-2 text-center text-sm text-ink-soft">あと {short}pt で引けます</p>}
    </Card>
  )
}
