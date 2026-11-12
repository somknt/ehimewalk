import { beforeEach, describe, expect, it } from 'vitest'
import { getItem, NORMAL_GACHA_POOL } from '../data/items'
import { toJstDateKey } from '../domain/date'
import type { DailySteps, DateKey } from '../domain/types'
import { BROKEN_STORAGE_KEY, MemoryStorage, MockGameApi, STORAGE_KEY } from './mockApi'
import type { StepDataProvider } from './stepProviders/types'
import { ApiError } from './types'

/** 2026-11-11 12:00 JST */
const NOW = new Date('2026-11-11T03:00:00Z')
const TODAY = toJstDateKey(NOW)

/** テスト用の歩数（日付ごとに値を決められる） */
class FixedStepProvider implements StepDataProvider {
  readonly source = 'demo' as const
  steps: Record<DateKey, number> = {}
  async isAvailable() {
    return true
  }
  async getDailySteps(from: DateKey, to: DateKey): Promise<DailySteps[]> {
    return Object.entries(this.steps)
      .filter(([date]) => date >= from && date <= to)
      .map(([date, steps]) => ({ date, steps }))
  }
}

/** 決まった値を順番に返す乱数 */
const sequence = (...values: number[]) => {
  let i = 0
  return () => values[i++ % values.length]
}

let storage: MemoryStorage
let provider: FixedStepProvider

const createApi = (random = sequence(0, 0)) =>
  new MockGameApi({ storage, provider, latencyMs: 0, random, now: () => NOW, enableDemoTools: true })

/** 歩数を設定して同期し、残高を所定の値にする */
async function earn(api: MockGameApi, steps: number) {
  provider.steps[TODAY] = steps
  return api.syncSteps()
}

beforeEach(() => {
  storage = new MemoryStorage()
  provider = new FixedStepProvider()
})

describe('歩数とポイント', () => {
  it('1,000歩で10ポイント獲得できる', async () => {
    const api = createApi()
    const result = await earn(api, 1000)
    expect(result.awardedPoints).toBe(10)
    expect((await api.getPointBalance()).balance).toBe(10)
  })

  it('同じ歩数を再同期してもポイントが二重付与されない', async () => {
    const api = createApi()
    await earn(api, 1234)
    expect((await api.syncSteps()).awardedPoints).toBe(0)
    expect((await api.getPointBalance()).balance).toBe(12)
    // 増えた分だけ付与される
    expect((await earn(api, 2000)).awardedPoints).toBe(8)
    expect((await api.getPointBalance()).balance).toBe(20)
  })

  it('同時に同期しても二重付与されない', async () => {
    const api = createApi()
    provider.steps[TODAY] = 3000
    await Promise.all([api.syncSteps(), api.syncSteps(), api.syncSteps()])
    expect((await api.getPointBalance()).balance).toBe(30)
  })

  it('ポイントは再読み込み（新しいインスタンス）後も保持される', async () => {
    await earn(createApi(), 5000)
    expect((await createApi().getPointBalance()).balance).toBe(50)
  })
})

describe('ガチャ', () => {
  it('50ポイントで1回引け、獲得したアイテムが保存される', async () => {
    const api = createApi()
    await earn(api, 5000)
    const result = await api.drawGacha()
    expect(result).toMatchObject({ isDuplicate: false, cost: 50, refund: 0, balance: 0 })
    expect(getItem(result.itemId)?.acquisitionType).toBe('gacha')
    const inventory = await createApi().getInventory()
    expect(inventory.map((i) => i.itemId)).toContain(result.itemId)
  })

  it('50ポイント未満では引けず、残高もアイテムも変わらない', async () => {
    const api = createApi()
    await earn(api, 4900)
    const before = await api.getInventory()
    await expect(api.drawGacha()).rejects.toMatchObject({ code: 'insufficient_points' })
    await expect(api.drawGacha()).rejects.toBeInstanceOf(ApiError)
    expect((await api.getPointBalance()).balance).toBe(49)
    expect(await api.getInventory()).toEqual(before)
  })

  it.each([
    ['N', 0.1, 5],
    ['R', 0.7, 15],
    ['SR', 0.95, 30],
    ['SSR', 0.995, 50],
  ] as const)('重複した %s は所持数を増やさず、%s の乱数で %i コインに変換する', async (rarity, roll, coins) => {
    const api = createApi(sequence(roll, 0)) // 毎回同じアイテムが出る
    await earn(api, 10_000)
    const first = await api.drawGacha()
    expect(getItem(first.itemId)?.rarity).toBe(rarity)
    const second = await api.drawGacha()
    expect(second.itemId).toBe(first.itemId)
    expect(second).toMatchObject({ isDuplicate: true, refund: coins, balance: 100 - 50 - 50 + coins })
    const owned = (await api.getInventory()).filter((i) => i.itemId === first.itemId)
    expect(owned).toHaveLength(1)
    // 再読み込みしても残高は同じ
    expect((await createApi().getPointBalance()).balance).toBe(coins)
  })

  it('連打しても残高がマイナスにならない', async () => {
    const api = createApi(sequence(0.5))
    await earn(api, 7000) // 70pt → 1 回だけ引ける
    const results = await Promise.allSettled([api.drawGacha(), api.drawGacha(), api.drawGacha()])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((await api.getPointBalance()).balance).toBe(20)
  })

  it('乱数に応じて各レアリティのアイテムが出る', async () => {
    const rarities = new Set<string>()
    for (const roll of [0.1, 0.7, 0.95, 0.995]) {
      const api = createApi(sequence(roll, 0))
      await earn(api, 5000)
      rarities.add(getItem((await api.drawGacha()).itemId)!.rarity)
      storage = new MemoryStorage()
    }
    expect([...rarities].sort()).toEqual(['N', 'R', 'SR', 'SSR'])
  })
})

describe('着せ替え', () => {
  it('初期衣装を所持・装備した状態で始まる', async () => {
    const character = await createApi().getCharacter()
    expect(character.equipped).toEqual({
      top: 'top_adventure_tee',
      bottom: 'bottom_denim',
      shoes: 'shoes_travel_boots',
      background: 'bg_seto_sea',
    })
  })

  it('所持アイテムを装備・解除でき、再読み込み後も保持される', async () => {
    const api = createApi()
    await earn(api, 5000)
    const { itemId } = await api.drawGacha()
    const slot = getItem(itemId)!.category
    expect((await api.equipItem(slot, itemId)).equipped[slot]).toBe(itemId)
    expect((await createApi().getCharacter()).equipped[slot]).toBe(itemId)
    expect((await api.equipItem('background', null)).equipped.background).toBeUndefined()
    expect((await createApi().getCharacter()).equipped.background).toBeUndefined()
  })

  it('持っていないアイテム・違うスロットには装備できない', async () => {
    const api = createApi()
    const notOwned = NORMAL_GACHA_POOL.find((i) => i.rarity === 'SSR')!
    await expect(api.equipItem(notOwned.category, notOwned.itemId)).rejects.toMatchObject({ code: 'item_not_owned' })
    await expect(api.equipItem('head', 'top_adventure_tee')).rejects.toMatchObject({ code: 'invalid_slot' })
    expect((await api.getCharacter()).equipped.top).toBe('top_adventure_tee')
  })
})

describe('残高の通知（ヘッダーと各画面で同じ残高を表示するため）', () => {
  it('歩数の付与・ガチャ・重複変換・デモ操作のたびに新しい残高を通知する', async () => {
    const api = createApi()
    const seen: number[] = []
    const off = api.onBalanceChange((b) => seen.push(b.balance))
    await earn(api, 10_000) // +100
    await api.syncSteps() // 変化なし → 通知しない
    await api.drawGacha() // -50
    await api.drawGacha() // -50 +5（重複）
    await api.demo!.addCoins(100)
    off()
    await api.demo!.addCoins(100) // 解除後は通知されない
    expect(seen).toEqual([100, 50, 5, 105])
  })
})

describe('デモ操作（開発モード）', () => {
  it('デモ操作を無効にすると api.demo は null（本番ビルドの状態）', () => {
    expect(new MockGameApi({ storage, provider, latencyMs: 0, enableDemoTools: false }).demo).toBeNull()
  })

  it('+100 / +500 / +1,000 コインを追加でき、履歴と残高が再読み込み後も残る', async () => {
    const api = createApi()
    await api.demo!.addCoins(100)
    await api.demo!.addCoins(500)
    const balance = await api.demo!.addCoins(1000)
    expect(balance.balance).toBe(1600)
    const reloaded = createApi()
    expect((await reloaded.getPointBalance()).balance).toBe(1600)
    const history = await reloaded.demo!.getHistory()
    expect(history.map((h) => [h.kind, h.amount])).toEqual([
      ['coins', 1000],
      ['coins', 500],
      ['coins', 100],
    ])
    const stored = JSON.parse(storage.getItem(STORAGE_KEY)!) as { transactions: { reason: string; amount: number }[] }
    expect(stored.transactions.filter((t) => t.reason === 'demo_grant').map((t) => t.amount)).toEqual([100, 500, 1000])
  })

  it('決められた量以外は追加できない', async () => {
    const api = createApi()
    await expect(api.demo!.addCoins(999 as 100)).rejects.toMatchObject({ code: 'demo_unavailable' })
    await expect(api.demo!.addSteps(123 as 100)).rejects.toMatchObject({ code: 'demo_unavailable' })
  })

  it('歩数を追加すると今日の歩数が増え、100歩につき1コイン付与される', async () => {
    const api = createApi()
    provider.steps[TODAY] = 2050
    await api.syncSteps() // 20 コイン
    const result = await api.demo!.addSteps(1000)
    expect(result).toMatchObject({ todaySteps: 3050, awardedPoints: 10, balance: { balance: 30, todayStepPoints: 30 } })
    const [record] = await api.getStepRecords(TODAY, TODAY)
    // デモ操作で追加した歩数は別に記録する
    expect(record).toMatchObject({ steps: 3050, demoAddedSteps: 1000, source: 'demo' })
  })

  it('同期し直しても追加した歩数は残り、コインは二重付与されない', async () => {
    const api = createApi()
    provider.steps[TODAY] = 1000
    await api.demo!.addSteps(5000)
    expect((await api.getPointBalance()).balance).toBe(60)
    await api.syncSteps()
    await api.syncSteps()
    expect((await api.getPointBalance()).balance).toBe(60)
    expect((await api.getStepRecords(TODAY, TODAY))[0].steps).toBe(6000)
    // 元の歩数が増えたときは、その差分だけ付与される
    provider.steps[TODAY] = 1500
    expect((await api.syncSteps()).awardedPoints).toBe(5)
  })

  it('1日10,000歩（100コイン）の上限を超えて付与しない', async () => {
    const api = createApi()
    for (let i = 0; i < 3; i++) await api.demo!.addSteps(5000)
    const balance = await api.getPointBalance()
    expect(balance).toMatchObject({ balance: 100, todayStepPoints: 100 })
    expect((await api.getStepRecords(TODAY, TODAY))[0].steps).toBe(15_000)
    const history = await api.demo!.getHistory()
    expect(history.map((h) => h.awardedCoins)).toEqual([0, 50, 50])
  })

  it('実際の歩数データ（デモ以外）にはデモの歩数を追加できない', async () => {
    const real: StepDataProvider = { source: 'healthkit', isAvailable: async () => true, getDailySteps: async () => [] }
    const api = new MockGameApi({ storage, provider: real, latencyMs: 0, now: () => NOW, enableDemoTools: true })
    await expect(api.demo!.addSteps(1000)).rejects.toMatchObject({ code: 'demo_unavailable' })
    expect((await api.getPointBalance()).balance).toBe(0)
  })
})

describe('保存データ', () => {
  it('JSONとして読めないデータは退避してから初期化し、異常終了しない', async () => {
    storage.setItem(STORAGE_KEY, '{not json')
    const api = createApi()
    expect((await api.getPointBalance()).balance).toBe(0)
    expect(storage.getItem(BROKEN_STORAGE_KEY)).toBe('{not json')
    expect((await api.getCharacter()).name).toBe('ミカ')
  })

  it('形が壊れたデータは、壊れた項目だけ初期値に戻す', async () => {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        profile: { userId: 'u-1', username: 42 },
        character: { name: '', appearance: { hairColor: 'rainbow' }, equipped: { top: 'no_such_item', head: 'head_golden_crown' } },
        stepRecords: null,
        stepAwards: { [TODAY]: 'x' },
        transactions: 'oops',
        balance: 'abc',
        inventory: { top_mikan_tee: 1, unknown_item: 1 },
      }),
    )
    const api = createApi()
    const [profile, character, balance, inventory] = await Promise.all([
      api.getProfile(),
      api.getCharacter(),
      api.getPointBalance(),
      api.getInventory(),
    ])
    expect(profile.userId).toBe('u-1')
    expect(profile.username).toBe('ぼうけんしゃ')
    expect(character.name).toBe('ミカ')
    expect(character.appearance.hairColor).toBe('brown')
    // 存在しない・持っていないアイテムの装備は外す
    expect(character.equipped.top).toBeUndefined()
    expect(character.equipped.head).toBeUndefined()
    expect(balance.balance).toBe(0)
    const ids = inventory.map((i) => i.itemId)
    expect(ids).toContain('top_mikan_tee')
    expect(ids).toContain('top_adventure_tee')
    expect(ids).not.toContain('unknown_item')
    // 壊れたデータでも、その後の操作は続けられる
    expect((await earn(api, 1000)).awardedPoints).toBe(10)
  })

  it('バージョン1の所持数データを引き継ぐ', async () => {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        profile: { userId: 'u-2', createdAt: '2026-11-01T00:00:00.000Z' },
        character: { name: 'ミカ', equipped: { top: 'top_mikan_tee' } },
        stepRecords: {},
        stepAwards: {},
        transactions: [],
        balance: 120,
        inventory: { top_mikan_tee: 3 },
      }),
    )
    const api = createApi()
    expect((await api.getPointBalance()).balance).toBe(120)
    expect((await api.getCharacter()).equipped.top).toBe('top_mikan_tee')
    expect((await api.getInventory()).filter((i) => i.itemId === 'top_mikan_tee')).toHaveLength(1)
  })

  it('保存に失敗したときは利用者向けのエラーを返し、変更は反映しない', async () => {
    const api = createApi()
    await earn(api, 5000)
    const failing = new MemoryStorage()
    failing.data.set(STORAGE_KEY, storage.getItem(STORAGE_KEY)!)
    failing.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    const broken = new MockGameApi({ storage: failing, provider, latencyMs: 0, random: sequence(0, 0), now: () => NOW })
    await expect(broken.drawGacha()).rejects.toMatchObject({ code: 'storage_failed' })
    expect((await broken.getPointBalance()).balance).toBe(50)
  })
})
