import { api } from '../../api'
import { CoinIcon } from '../../components/CoinBadge'
import { Card, CardTitle } from '../../components/ui'
import { useAction } from '../../hooks/useAction'
import { useBalance } from '../../hooks/useBalance'

/**
 * 1 日 1 回のログインボーナス。歩数が少ない日でも遊べるようにする。
 * 付与はモックサーバー側で行い、残高は onBalanceChange 経由でヘッダーなどに反映される
 */
export function LoginBonusCard() {
  const balanceState = useBalance()
  const claim = useAction(() => api.claimLoginBonus())
  if (balanceState.status !== 'ready') return null
  const { loginBonusClaimedToday, loginBonusAmount } = balanceState.balance

  return (
    <Card className="bg-mikan-50">
      <CardTitle>ログインボーナス</CardTitle>
      {loginBonusClaimedToday ? (
        <p role="status" className="text-center font-bold text-mikan-800">
          今日のログインボーナスは受け取り済みです。また明日！
        </p>
      ) : (
        <>
          <p className="text-sm">歩数が少ない日も、毎日ログインするだけでもらえます。</p>
          <button
            type="button"
            onClick={() => void claim.run()}
            disabled={claim.pending}
            className="rpg-button mt-3 w-full bg-white disabled:opacity-60"
          >
            <CoinIcon size={20} />
            ログインボーナスを受け取る（+{loginBonusAmount} コイン）
          </button>
        </>
      )}
      {claim.error && (
        <p role="alert" className="mt-2 text-sm font-bold text-red-700">
          {claim.error}
        </p>
      )}
    </Card>
  )
}
