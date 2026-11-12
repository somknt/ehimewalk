import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { api, ApiError, type InventoryItem } from '../api'
import { ActionError, Badge, Card, CardTitle, ErrorMessage, LoadingCards, PageTitle, RarityBadge } from '../components/ui'
import { getItem, ITEMS, type ItemMaster } from '../data/items'
import type { Character, EquipSlot, Rarity } from '../domain/types'
import { CharacterAvatar } from '../features/character/CharacterAvatar'
import { ItemThumbnail } from '../features/character/ItemThumbnail'
import { GachaTabs } from '../features/gacha/GachaTabs'
import { SLOT_LABELS, WARDROBE_SLOTS } from '../features/wardrobe/slots'
import { useAsyncData } from '../hooks/useAsyncData'

interface WardrobeData {
  character: Character
  inventory: InventoryItem[]
}

async function loadWardrobe(): Promise<WardrobeData> {
  const [character, inventory] = await Promise.all([api.getCharacter(), api.getInventory()])
  return { character, inventory }
}

const RARITY_RANK: Record<Rarity, number> = { N: 0, R: 1, SR: 2, SSR: 3 }
const TOTAL_BY_SLOT = Object.fromEntries(
  WARDROBE_SLOTS.map((slot) => [slot, [...ITEMS.values()].filter((item) => item.category === slot).length]),
) as Record<EquipSlot, number>

export function WardrobePage() {
  const { state, reload, update } = useAsyncData(loadWardrobe)
  const [slot, setSlot] = useState<EquipSlot>('head')
  const [saving, setSaving] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const shell = (children: ReactNode) => (
    <div className="space-y-4">
      <PageTitle lead="持っているアイテムをタップして着替えよう。変更はすぐに保存されます。">ガチャ・着せ替え</PageTitle>
      <GachaTabs />
      {children}
    </div>
  )

  if (state.status === 'loading') return shell(<LoadingCards count={2} />)
  if (state.status === 'error') return shell(<ErrorMessage message={state.message} onRetry={reload} />)

  const { character, inventory } = state.data
  const owned: ItemMaster[] = inventory
    .map((entry) => getItem(entry.itemId))
    .filter((item): item is ItemMaster => item !== undefined)
  const countBySlot = (s: EquipSlot) => owned.filter((item) => item.category === s).length
  const slotItems = owned
    .filter((item) => item.category === slot)
    .sort((a, b) => RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity] || a.name.localeCompare(b.name, 'ja'))
  const equippedId = character.equipped[slot]

  const equip = async (target: EquipSlot, itemId: string | null) => {
    setError(null)
    setMessage(null)
    setSaving(itemId ?? `remove:${target}`)
    try {
      const next = await api.equipItem(target, itemId)
      update((data) => ({ ...data, character: next }))
      setMessage(itemId ? `${getItem(itemId)?.name}を装備しました（保存済み）` : `${SLOT_LABELS[target]}の装備を外しました（保存済み）`)
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : '着せ替えできませんでした。もう一度お試しください。')
    } finally {
      setSaving(null)
    }
  }

  return shell(
    <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:items-start">
      <div className="space-y-4 md:sticky md:top-28">
        <section className="rpg-card overflow-hidden" aria-label="着せ替えのプレビュー">
          <CharacterAvatar character={character} scale={11} className="h-64 pb-3" />
        </section>
        <Card>
          <CardTitle aside={<Badge tone="leaf">保存済み</Badge>}>いまの装備</CardTitle>
          <dl className="divide-y divide-ink/15">
            {WARDROBE_SLOTS.map((s) => (
              <div key={s} className="flex items-center justify-between gap-3 py-1.5">
                <dt className="text-ink-soft">{SLOT_LABELS[s]}</dt>
                <dd className="font-bold">{getItem(character.equipped[s])?.name ?? 'なし'}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <div className="space-y-3">
        <div role="tablist" aria-label="装備する場所" className="grid grid-cols-4 gap-1.5">
          {WARDROBE_SLOTS.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={slot === s}
              onClick={() => setSlot(s)}
              className={`flex min-h-12 flex-col items-center justify-center rounded-xl border-[3px] px-0.5 text-xs leading-tight font-bold ${
                slot === s ? 'border-ink bg-mikan-200' : 'border-ink/20 bg-white text-ink-soft'
              }`}
            >
              <span>{SLOT_LABELS[s]}</span>
              <span className="font-normal">
                {countBySlot(s)}/{TOTAL_BY_SLOT[s]}
              </span>
            </button>
          ))}
        </div>

        <Card>
          <CardTitle aside={<span className="text-sm text-ink-soft">所持 {countBySlot(slot)} / {TOTAL_BY_SLOT[slot]}</span>}>
            {SLOT_LABELS[slot]}
          </CardTitle>

          <p role="status" className="min-h-6 text-sm font-bold text-leaf-700">
            {message}
          </p>
          {error && <ActionError message={error} />}

          {equippedId && (
            <button
              type="button"
              className="rpg-button mt-2 w-full bg-white"
              disabled={saving !== null}
              onClick={() => void equip(slot, null)}
            >
              {SLOT_LABELS[slot]}の装備を外す
            </button>
          )}

          {slotItems.length === 0 ? (
            <p className="mt-3 text-ink-soft">
              この場所のアイテムはまだ持っていません。
              <Link to="/gacha" className="font-bold text-seto-700 underline">
                ガチャ
              </Link>
              で集めよう。
            </p>
          ) : (
            <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {slotItems.map((item) => {
                const isEquipped = equippedId === item.itemId
                return (
                  <li key={item.itemId}>
                    <button
                      type="button"
                      aria-pressed={isEquipped}
                      disabled={saving !== null}
                      onClick={() => void equip(slot, isEquipped ? null : item.itemId)}
                      className={`flex h-full min-h-32 w-full flex-col items-center gap-1 rounded-xl border-[3px] p-2 text-center ${
                        isEquipped ? 'border-ink bg-mikan-100' : 'border-ink/25 bg-white'
                      }`}
                    >
                      <ItemThumbnail item={item} size={64} />
                      <span className="flex items-center gap-1">
                        <RarityBadge rarity={item.rarity} />
                        {isEquipped && <Badge tone="leaf">装備中</Badge>}
                      </span>
                      <span className="text-sm leading-tight font-bold">{item.name}</span>
                      <span className="text-xs text-ink-soft">{isEquipped ? 'タップで外す' : 'タップで装備'}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle aside={<span className="text-sm text-ink-soft">{owned.length} 個</span>}>持ち物</CardTitle>
          <ul className="flex flex-wrap gap-1.5">
            {owned.map((item) => (
              <li key={item.itemId}>
                <button
                  type="button"
                  onClick={() => setSlot(item.category)}
                  className="flex min-h-11 items-center gap-1 rounded-lg border-2 border-ink/20 bg-cream px-2 text-sm"
                >
                  <RarityBadge rarity={item.rarity} />
                  {item.name}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>,
  )
}
