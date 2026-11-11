// 着せ替え画面。デザインは仮のもので、今後差し替える予定。
// 画面の見た目を変えるときも、装備の変更は api.equipItem / api.updateCharacter を通す（所持チェックはサーバー側）。
import { useState } from 'react'
import { api } from '../../api'
import { Card } from '../../components/ui'
import { ALL_ITEMS, SLOT_LABELS } from '../../data/items'
import type { EquipSlot, InventoryEntry } from '../../domain/types'
import { useAction } from '../../hooks/useAction'
import { useSession } from '../../session/sessionContext'
import { AppearanceFields } from '../character/AppearanceFields'
import { CharacterAvatar } from '../character/CharacterAvatar'
import { ItemPreview } from '../items/ItemPreview'
import { RARITY_STYLES } from '../items/rarityStyles'

const SLOT_ORDER: readonly EquipSlot[] = ['head', 'hair', 'top', 'bottom', 'shoes', 'accessory', 'background', 'pet']
/** 外せないスロット（何も着ていない状態にしない） */
const REQUIRED_SLOTS: readonly EquipSlot[] = ['top', 'bottom']

export function Wardrobe({ inventory }: { inventory: readonly InventoryEntry[] }) {
  const { session, applyCharacter } = useSession()
  const [slot, setSlot] = useState<EquipSlot>('top')
  const { character } = session

  const equip = useAction(async (target: EquipSlot, itemId: string | null) => {
    applyCharacter(await api.equipItem(target, itemId))
  })
  const changeAppearance = useAction(async (appearance: typeof character.appearance) => {
    applyCharacter(await api.updateCharacter({ appearance }))
  })

  const owned = new Map(inventory.map((entry) => [entry.itemId, entry.quantity]))
  const slotItems = ALL_ITEMS.filter((item) => item.category === slot && (owned.get(item.itemId) ?? 0) > 0)
  const equippedId = character.equipped[slot]
  const error = equip.error ?? changeAppearance.error

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:items-start">
      <Card className="overflow-hidden p-0 md:sticky md:top-32">
        <CharacterAvatar character={character} scale={11} animated className="h-64 pb-3" />
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 border-t-[3px] border-ink p-3 text-sm sm:grid-cols-2">
          {SLOT_ORDER.filter((s) => s !== 'hair').map((s) => (
            <div key={s} className="flex justify-between gap-2">
              <dt className="whitespace-nowrap text-ink-soft">{SLOT_LABELS[s]}</dt>
              <dd className="truncate font-bold">{ALL_ITEMS.find((i) => i.itemId === character.equipped[s])?.name ?? 'なし'}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card>
        <div role="group" aria-label="装備する場所" className="grid grid-cols-4 gap-2">
          {SLOT_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={slot === s}
              onClick={() => setSlot(s)}
              className={`min-h-12 rounded-xl border-[3px] px-1 text-sm font-bold ${
                slot === s ? 'border-ink bg-mikan-500 text-white' : 'border-ink/25 bg-white text-ink-soft'
              }`}
            >
              {SLOT_LABELS[s]}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {slot === 'hair' ? (
            <AppearanceFields
              value={character.appearance}
              onChange={(next) => void changeAppearance.run(next)}
              fields={['hairStyle', 'hairColor']}
            />
          ) : slotItems.length === 0 ? (
            <p className="rounded-xl bg-cream p-4 text-center text-ink-soft">
              {SLOT_LABELS[slot]}のアイテムはまだ持っていません。ガチャや観光スポットで集めよう！
            </p>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {!REQUIRED_SLOTS.includes(slot) && (
                <li>
                  <button
                    type="button"
                    aria-pressed={!equippedId}
                    onClick={() => void equip.run(slot, null)}
                    disabled={equip.pending}
                    className={`flex h-full min-h-32 w-full flex-col items-center justify-center rounded-xl border-[3px] p-2 text-sm ${
                      !equippedId ? 'border-ink bg-mikan-100 font-bold' : 'border-ink/25 bg-white'
                    }`}
                  >
                    <span className="font-pixel text-3xl text-ink-soft" aria-hidden="true">
                      ×
                    </span>
                    はずす
                  </button>
                </li>
              )}
              {slotItems.map((item) => {
                const selected = equippedId === item.itemId
                return (
                  <li key={item.itemId}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => void equip.run(slot, item.itemId)}
                      disabled={equip.pending}
                      className={`relative flex w-full flex-col items-center gap-1 rounded-xl border-[3px] p-2 text-sm ${
                        selected ? 'border-ink bg-mikan-100 font-bold' : `bg-white ${RARITY_STYLES[item.rarity].frame}`
                      }`}
                    >
                      <ItemPreview item={item} base={character} scale={3} className="h-20 w-14" />
                      <span className="leading-tight">{item.name}</span>
                      {(owned.get(item.itemId) ?? 0) > 1 && (
                        <span className="absolute top-1 right-1 rounded bg-ink px-1 text-xs text-white">
                          ×{owned.get(item.itemId)}
                        </span>
                      )}
                      {selected && <span className="sr-only">（装備中）</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm font-bold text-red-700">
            {error}
          </p>
        )}
        <p className="mt-4 text-xs text-ink-soft">装備は自動で保存されます。見た目によってポイントや順位が有利になることはありません。</p>
      </Card>
    </div>
  )
}
