import { useId, useState, type KeyboardEvent } from 'react'
import { Card, ComingSoon, PageTitle } from '../components/ui'

const TABS = [
  { id: 'all', label: '全ユーザー', description: 'アプリを使っている全員の週間歩数ランキングです。' },
  { id: 'ehime', label: '愛媛県', description: '愛媛県ランキングへの参加を選んだ人どうしのランキングです。' },
  { id: 'friends', label: 'フレンド', description: 'フレンド登録した人どうしのランキングです。' },
] as const

type TabId = (typeof TABS)[number]['id']

export function RankingPage() {
  const [active, setActive] = useState<TabId>('all')
  const baseId = useId()
  const activeTab = TABS.find((tab) => tab.id === active) ?? TABS[0]

  // 左右キーでタブを移動できるようにする（WAI-ARIA のタブの操作）
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    const index = TABS.findIndex((tab) => tab.id === active)
    const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]
    setActive(next.id)
    document.getElementById(`${baseId}-tab-${next.id}`)?.focus()
  }

  return (
    <div className="space-y-4">
      <PageTitle lead="週間歩数で競おう。毎週月曜 0:00（日本時間）に更新されます。">ランキング</PageTitle>

      <div role="tablist" aria-label="ランキングの種類" className="grid grid-cols-3 gap-2">
        {TABS.map((tab) => {
          const selected = tab.id === active
          return (
            <button
              key={tab.id}
              id={`${baseId}-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.id)}
              onKeyDown={onKeyDown}
              className={`min-h-12 rounded-xl border-[3px] border-ink font-bold ${
                selected ? 'bg-mikan-500 text-white shadow-[0_4px_0_0_var(--color-ink)]' : 'bg-white text-ink-soft'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${active}`}>
        <Card>
          <h2 className="font-pixel text-lg">{activeTab.label}ランキング</h2>
          <p className="mt-2">{activeTab.description}</p>
          <p className="mt-3 rounded-lg bg-cream px-3 py-2 text-sm text-ink-soft">
            ランキングの表示はタスク 1.11 で実装します。正式なランキングには、信頼できる歩数データ（デモデータ以外）だけが反映されます。
          </p>
        </Card>
      </div>

      <ComingSoon
        items={[
          { label: '順位・キャラクター・週間歩数・称号の表示', task: 'タスク 1.11' },
          { label: '複数ユーザーでのランキング', task: 'フェーズ2' },
          { label: 'フレンド申請・応援リアクション', task: 'フェーズ2' },
        ]}
      />
    </div>
  )
}
