import { Card, CardTitle, ComingSoon, PageTitle } from '../components/ui'
import { NORMAL_GACHA_RATES, RARITY_LABELS } from '../data/items'
import { GACHA_COST } from '../domain/points'
import type { Rarity } from '../domain/types'

const RARITY_ORDER: Rarity[] = ['SR', 'R', 'N']

export function GachaPage() {
  return (
    <div className="space-y-4">
      <PageTitle lead="歩いて貯めたポイントで衣装やペットを手に入れよう。">ガチャ・着せ替え</PageTitle>

      <div className="grid gap-4 md:grid-cols-2 md:items-start">
        <Card>
          <CardTitle>通常ガチャ</CardTitle>
          <p>
            1回 <span className="font-bold">{GACHA_COST}pt</span>。手に入れたアイテムは自動で持ち物に入ります。
          </p>
          <table className="mt-3 w-full border-collapse text-left">
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
        </Card>

        <ComingSoon
          items={[
            { label: 'ガチャを引く（レア度別の演出）', task: 'タスク 1.9' },
            { label: '持ち物と着せ替え', task: 'タスク 1.10' },
            { label: 'アイテム図鑑', task: 'タスク 1.10' },
          ]}
        />
      </div>
    </div>
  )
}
