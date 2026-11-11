import { Card, CardTitle } from '../../components/ui'
import { ALL_ITEMS, RARITY_LABELS, type ItemMaster } from '../../data/items'
import { SPOTS } from '../../data/spots'
import type { InventoryEntry } from '../../domain/types'
import { useSession } from '../../session/sessionContext'
import { ItemPreview } from './ItemPreview'
import { RARITY_STYLES } from './rarityStyles'

function acquisitionHint(item: ItemMaster): string {
  switch (item.acquisitionType) {
    case 'starter':
      return 'はじめから持っている'
    case 'gacha':
      return '通常ガチャで出る'
    case 'login_bonus':
      return 'ログインボーナス'
    case 'spot': {
      const spot = SPOTS.find((s) => s.rewardItemId === item.itemId)
      return spot ? `地域限定：${spot.name}を訪れる` : '地域限定'
    }
  }
}

/** アイテム図鑑。未入手は形だけを表示する */
export function ItemCollection({ inventory }: { inventory: readonly InventoryEntry[] }) {
  const { session } = useSession()
  const owned = new Map(inventory.map((entry) => [entry.itemId, entry.quantity]))
  const ownedCount = ALL_ITEMS.filter((item) => owned.has(item.itemId)).length

  return (
    <Card>
      <CardTitle aside={<span className="font-pixel">{ownedCount} / {ALL_ITEMS.length}</span>}>アイテム図鑑</CardTitle>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {ALL_ITEMS.map((item) => {
          const quantity = owned.get(item.itemId) ?? 0
          const has = quantity > 0
          return (
            <li
              key={item.itemId}
              className={`flex flex-col items-center gap-1 rounded-xl border-[3px] p-2 text-center text-sm ${
                has ? `bg-white ${RARITY_STYLES[item.rarity].frame}` : 'border-dashed border-ink/25 bg-cream'
              }`}
            >
              <ItemPreview item={item} base={session.character} scale={3} silhouette={!has} className="h-20 w-14" />
              <span className={`rounded-full border px-1.5 text-xs ${RARITY_STYLES[item.rarity].badge}`}>{RARITY_LABELS[item.rarity]}</span>
              <span className="font-bold leading-tight">{has ? item.name : '？？？'}</span>
              <span className="text-xs leading-tight text-ink-soft">{has ? `所持 ${quantity}` : acquisitionHint(item)}</span>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
