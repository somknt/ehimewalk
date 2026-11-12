// shiomi ブランチから取り込んだ機能（キャラクター作成・ログインボーナス・ランキング・チェックイン・
// AI クエスト・健康ミッション・データ削除）と、保存データの移行のテスト。
// 書き方は mockApi.test.ts に合わせる（メモリの保存先・固定の日時・待ち時間なし）。
import { beforeEach, describe, expect, it } from 'vitest'
import { toJstDateKey } from '../domain/date'
import type { DailySteps, DateKey } from '../domain/types'
import { AI_QUEST_DAILY_LIMIT, LOGIN_BONUS_POINTS, MemoryStorage, MockGameApi, STORAGE_KEY } from './mockApi'
import type { StepDataProvider } from './stepProviders/types'
import type { OnboardingInput } from './types'

/** 2026-11-11 12:00 JST */
const NOW = new Date('2026-11-11T03:00:00Z')
const TODAY = toJstDateKey(NOW)

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

let storage: MemoryStorage
let provider: FixedStepProvider

const createApi = () => new MockGameApi({ storage, provider, latencyMs: 0, now: () => NOW, enableDemoTools: true })

const onboarding: OnboardingInput = {
  username: 'てすと',
  characterName: 'ミカン',
  appearance: { hairStyle: 'bob', hairColor: 'mikan', skinTone: 'light', eyeColor: 'brown' },
  topItemId: 'top_leaf_tee',
  bottomItemId: 'bottom_navy_skirt',
}

const stored = () => JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}')

beforeEach(() => {
  storage = new MemoryStorage()
  provider = new FixedStepProvider()
})

describe('キャラクター作成', () => {
  it('はじめは作成前で、作成すると外見・初期衣装・名前が保存される', async () => {
    const api = createApi()
    expect((await api.getSession()).profile.onboarded).toBe(false)
    const session = await api.completeOnboarding(onboarding)
    expect(session.profile).toMatchObject({ onboarded: true, username: 'てすと' })
    expect(session.character).toMatchObject({ name: 'ミカン', appearance: onboarding.appearance })
    expect(session.character.equipped).toMatchObject({ top: 'top_leaf_tee', bottom: 'bottom_navy_skirt' })
    // 選んだ初期衣装は持ち物に入る
    const inventory = (await createApi().getInventory()).map((item) => item.itemId)
    expect(inventory).toEqual(expect.arrayContaining(['top_leaf_tee', 'bottom_navy_skirt']))
  })

  it('名前が空・長すぎる場合や、選べない服は保存しない', async () => {
    const api = createApi()
    await expect(api.completeOnboarding({ ...onboarding, characterName: '  ' })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(api.completeOnboarding({ ...onboarding, username: 'あ'.repeat(13) })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(api.completeOnboarding({ ...onboarding, topItemId: 'head_castle_kabuto' })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      api.completeOnboarding({ ...onboarding, appearance: { ...onboarding.appearance, hairColor: 'gold' as 'mikan' } }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect((await api.getSession()).profile.onboarded).toBe(false)
  })
})

describe('プロフィール', () => {
  it('目標は1,000〜20,000歩の範囲だけ', async () => {
    const api = createApi()
    await expect(api.updateProfile({ dailyGoal: 50_000 })).rejects.toMatchObject({ code: 'invalid_input' })
    expect((await api.updateProfile({ dailyGoal: 8000 })).profile.dailyGoal).toBe(8000)
  })

  it('獲得していない称号は選べず、獲得した称号は名前も変わる', async () => {
    const api = createApi()
    await expect(api.updateProfile({ titleId: 'gacha_debut' })).rejects.toMatchObject({ code: 'invalid_input' })
    // ガチャを 1 回引くと「ガチャデビュー」を獲得する
    await api.demo!.addCoins(100)
    await api.drawGacha()
    const session = await api.updateProfile({ titleId: 'gacha_debut' })
    expect(session.profile).toMatchObject({ titleId: 'gacha_debut', title: 'ガチャデビュー' })
  })
})

describe('ログインボーナス', () => {
  it('1日1回だけ受け取れ、残高の変化が通知される', async () => {
    const api = createApi()
    const seen: number[] = []
    api.onBalanceChange((balance) => seen.push(balance.balance))
    const first = await api.claimLoginBonus()
    expect(first).toMatchObject({ granted: true, amount: LOGIN_BONUS_POINTS })
    expect(first.balance.loginBonusClaimedToday).toBe(true)
    expect((await api.claimLoginBonus()).granted).toBe(false)
    expect((await api.getPointBalance()).balance).toBe(LOGIN_BONUS_POINTS)
    expect(seen).toEqual([LOGIN_BONUS_POINTS])
  })

  it('連打しても2回付与されない', async () => {
    const api = createApi()
    await Promise.all([api.claimLoginBonus(), api.claimLoginBonus(), api.claimLoginBonus()])
    expect((await api.getPointBalance()).balance).toBe(LOGIN_BONUS_POINTS)
  })
})

describe('ランキング', () => {
  it('デモ歩数は正式ランキングに入らず、参考順位だけ出る', async () => {
    const api = createApi()
    provider.steps[TODAY] = 6000
    await api.syncSteps()
    const ranking = await api.getRanking('all')
    expect(ranking.me).toMatchObject({ eligible: false, excludedReason: 'demo_data', weeklySteps: 6000 })
    expect(ranking.entries.some((entry) => entry.isMe)).toBe(false)
    expect(ranking.entries.every((entry) => entry.isSample)).toBe(true)
  })

  it('愛媛県ランキングに参加しない設定なら、その理由を返す', async () => {
    const api = createApi()
    await api.updateProfile({ ehimeRankingOptIn: false })
    expect((await api.getRanking('ehime')).me.excludedReason).toBe('not_opted_in')
  })

  it('応援はフレンドにだけ、決まった種類だけ送れる', async () => {
    const api = createApi()
    const friend = (await api.getRanking('friends')).entries[0]
    await expect(api.sendCheer(friend.userId, 'nice')).resolves.toBeUndefined()
    await expect(api.sendCheer('sample-0', 'nice')).rejects.toMatchObject({ code: 'not_found' })
    await expect(api.sendCheer(friend.userId, 'bad' as 'nice')).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe('チェックイン', () => {
  const dogo = { spotId: 'dogo_onsen_honkan', latitude: 33.852, longitude: 132.7864, accuracyM: 10, via: 'list' as const }

  it('遠い場所からはチェックインできない', async () => {
    const result = await createApi().checkIn({ ...dogo, latitude: 35.68, longitude: 139.76 })
    expect(result.status).toBe('too_far')
  })

  it('誤差が大きい位置では判定しない', async () => {
    expect((await createApi().checkIn({ ...dogo, accuracyM: 500 })).status).toBe('low_accuracy')
  })

  it('限定アイテムは初回だけもらえ、座標は保存しない', async () => {
    const api = createApi()
    const first = await api.checkIn(dogo)
    const second = await api.checkIn(dogo)
    expect(first).toMatchObject({ status: 'success', firstVisit: true, rewardItemId: 'top_onsen_yukata' })
    expect(second).toMatchObject({ status: 'success', firstVisit: false, rewardItemId: null })
    expect((await api.getInventory()).map((i) => i.itemId)).toContain('top_onsen_yukata')
    expect(JSON.stringify(stored().visits)).not.toContain('132.7864')
  })

  it('AI経由の訪問は、サーバーが提案したクエストのスポットだけ認める', async () => {
    const api = createApi()
    const generated = await api.generateQuest({ startSpotId: 'matsuyama_castle', minutes: 45, interests: ['歴史'], load: 'normal' })
    if (generated.status !== 'ok') throw new Error('クエストが作られなかった')
    const spotId = generated.quest.spots[0].spotId
    const viaQuest = await api.checkIn({
      spotId,
      latitude: 0,
      longitude: 0,
      accuracyM: 0,
      via: 'ai_quest',
      questId: generated.quest.questId,
      demoLocation: true,
    })
    expect(viaQuest).toMatchObject({ status: 'success', visit: { via: 'ai_quest', verified: false } })

    const fake = await api.checkIn({ spotId: 'imabari_castle', latitude: 0, longitude: 0, accuracyM: 0, via: 'ai_quest', questId: 'fake', demoLocation: true })
    expect(fake).toMatchObject({ status: 'success', visit: { via: 'list' } })
  })
})

describe('AI散策クエスト（モック）', () => {
  it('登録スポットだけを提案し、モックであることが分かる', async () => {
    const result = await createApi().generateQuest({ startSpotId: 'matsuyama_castle', minutes: 60, interests: ['温泉'], load: 'easy' })
    if (result.status !== 'ok') throw new Error('クエストが作られなかった')
    expect(result.quest.generatedBy).toBe('mock')
    expect(result.quest.spots.map((s) => s.spotId)).toContain('dogo_onsen_honkan')
    expect(result.quest.estimate?.basis).toBe('straight_line')
  })

  it('近くに登録スポットが無い現在地では、いちばん近いスポットを案内する', async () => {
    const result = await createApi().generateQuest({
      startSpotId: 'current',
      currentLocation: { latitude: 35.681, longitude: 139.767 },
      minutes: 30,
      interests: [],
      load: 'normal',
    })
    expect(result.status).toBe('no_spots')
  })

  it('不正な条件は受け付けない', async () => {
    const api = createApi()
    await expect(api.generateQuest({ startSpotId: 'matsuyama_castle', minutes: 500, interests: [], load: 'normal' })).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(api.generateQuest({ startSpotId: 'nowhere', minutes: 30, interests: [], load: 'normal' })).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('1日の回数に上限がある', async () => {
    const api = createApi()
    const request = { startSpotId: 'matsuyama_castle', minutes: 30, interests: [], load: 'normal' as const }
    for (let i = 0; i < AI_QUEST_DAILY_LIMIT; i++) await api.generateQuest(request)
    expect((await api.generateQuest(request)).status).toBe('quota_exceeded')
    expect((await api.getActivitySummary()).questGenerations).toBe(AI_QUEST_DAILY_LIMIT)
  })
})

describe('健康ミッション', () => {
  it('過去7日の平均から、無理のない目標を提案する', async () => {
    const api = createApi()
    provider.steps[TODAY] = 21_000 // 7 日平均 3,000 歩
    await api.syncSteps()
    expect(await api.getWeeklyMission()).toMatchObject({ kind: 'increase', targetSteps: 3300, average7Days: 3000, generatedBy: 'mock' })
  })
})

describe('データ削除', () => {
  it('すべて消え、次に読み込むとキャラクター作成からやり直しになる', async () => {
    const api = createApi()
    await api.completeOnboarding(onboarding)
    await api.claimLoginBonus()
    await api.deleteAllData()
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
    const session = await createApi().getSession()
    expect(session.profile.onboarded).toBe(false)
    expect((await createApi().getPointBalance()).balance).toBe(0)
  })
})

describe('保存データの移行', () => {
  it('sugiyama1 の形（バージョン2）は作成済みとして引き継ぎ、称号の名前を ID に直す', async () => {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        profile: { userId: 'u-1', username: 'すぎやま', title: 'ガチャデビュー', createdAt: '2026-11-01T00:00:00.000Z' },
        character: { name: 'テン', equipped: {} },
        inventory: { top_adventure_tee: { acquiredAt: '2026-11-01T00:00:00.000Z' } },
        balance: 120,
        demoHistory: [],
      }),
    )
    const session = await createApi().getSession()
    expect(session.profile).toMatchObject({ userId: 'u-1', username: 'すぎやま', onboarded: true, titleId: 'gacha_debut' })
    expect((await createApi().getPointBalance()).balance).toBe(120)
    // 移行した形は、次に保存したときにバージョン 3 で書き込まれ、作成済みのまま残る
    await createApi().claimLoginBonus()
    expect(stored().version).toBe(3)
    expect(stored().profile).toMatchObject({ onboarded: true, titleId: 'gacha_debut' })
    expect((await createApi().getSession()).profile.onboarded).toBe(true)
  })

  it('shiomi の試作版の形（所持数・訪問記録）も引き継ぐ', async () => {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        profile: { userId: 'u-2', username: 'しおみ', titleId: 'first_journey', onboarded: false, createdAt: '2026-11-01T00:00:00.000Z' },
        inventory: { head_mikan_hat: { itemId: 'head_mikan_hat', quantity: 2, firstAcquiredAt: '2026-11-05T00:00:00.000Z' } },
        visits: { dogo_onsen_honkan: { spotId: 'dogo_onsen_honkan', visitedAt: '2026-11-06T00:00:00.000Z', via: 'ai_quest', verified: true } },
        balance: 30,
      }),
    )
    const api = createApi()
    const session = await api.getSession()
    // 作成前のまま保存されていた場合は、作成画面から始める
    expect(session.profile).toMatchObject({ onboarded: false, titleId: 'first_journey' })
    expect((await api.getInventory()).find((i) => i.itemId === 'head_mikan_hat')?.acquiredAt).toBe('2026-11-05T00:00:00.000Z')
    expect(await api.getVisits()).toEqual([
      { spotId: 'dogo_onsen_honkan', visitedAt: '2026-11-06T00:00:00.000Z', via: 'ai_quest', verified: true },
    ])
  })
})
