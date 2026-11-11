import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router'
import { api, type GachaDrawResult } from '../api'
import { Tabs } from '../components/Tabs'
import { ErrorMessage, LoadingCards, PageTitle } from '../components/ui'
import type { InventoryEntry } from '../domain/types'
import { GachaMachine } from '../features/gacha/GachaMachine'
import { ItemCollection } from '../features/items/ItemCollection'
import { Wardrobe } from '../features/wardrobe/Wardrobe'
import { useAsyncData } from '../hooks/useAsyncData'

const TABS = [
  { id: 'gacha', label: 'ガチャ' },
  { id: 'wardrobe', label: '着せ替え' },
  { id: 'collection', label: '図鑑' },
] as const
type TabId = (typeof TABS)[number]['id']

const isTab = (value: string | null): value is TabId => TABS.some((tab) => tab.id === value)
// useAsyncData に渡す関数は毎回同じものにする（新しい関数を渡すと読み込みが繰り返される）
const loadInventory = () => api.getInventory()

export function GachaPage() {
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const tab: TabId = isTab(tabParam) ? tabParam : 'gacha'
  const { state, reload } = useAsyncData(loadInventory)
  // ガチャで増えた分。再読み込みせずに持ち物へ反映する
  const [drawn, setDrawn] = useState<Record<string, InventoryEntry>>({})

  const onDrawn = useCallback((result: GachaDrawResult) => {
    setDrawn((prev) => ({
      ...prev,
      [result.itemId]: { itemId: result.itemId, quantity: result.quantity, firstAcquiredAt: new Date().toISOString() },
    }))
  }, [])

  const inventory =
    state.status === 'ready'
      ? Object.values({ ...Object.fromEntries(state.data.map((e) => [e.itemId, e])), ...drawn })
      : []

  return (
    <div className="space-y-4">
      <PageTitle lead="歩いて貯めたポイントで衣装やペットを手に入れて、着せ替えよう。">ガチャ・着せ替え</PageTitle>
      <Tabs label="ガチャ・着せ替えの切り替え" tabs={TABS} active={tab} onChange={(id) => setParams({ tab: id }, { replace: true })}>
        {tab === 'gacha' && <GachaMachine onDrawn={onDrawn} />}
        {tab !== 'gacha' && state.status === 'loading' && <LoadingCards count={1} />}
        {tab !== 'gacha' && state.status === 'error' && <ErrorMessage message={state.message} onRetry={reload} />}
        {tab === 'wardrobe' && state.status === 'ready' && <Wardrobe inventory={inventory} />}
        {tab === 'collection' && state.status === 'ready' && <ItemCollection inventory={inventory} />}
      </Tabs>
    </div>
  )
}
