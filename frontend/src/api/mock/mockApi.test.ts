import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toJstDateKey } from '../../domain/date'
import type { DailySteps } from '../../domain/types'
import type { StepDataProvider } from '../stepProviders/types'
import { ApiError } from '../types'
import { AI_QUEST_DAILY_LIMIT, MockGameApi } from './mockApi'

/** テスト用の localStorage（Node には無いため） */
function stubLocalStorage() {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  })
}

/** 今日の歩数を自由に決められる歩数プロバイダー */
class FixedStepProvider implements StepDataProvider {
  readonly source = 'demo' as const
  steps = 6000
  async isAvailable() {
    return true
  }
  async getDailySteps(): Promise<DailySteps[]> {
    return [{ date: toJstDateKey(), steps: this.steps }]
  }
}

const onboarding = {
  username: 'テスト',
  characterName: 'ミカ',
  appearance: { hairStyle: 'short', hairColor: 'brown', skinTone: 'light', eyeColor: 'brown' },
  topItemId: 'top_adventure_tee',
  bottomItemId: 'bottom_denim',
} as const

describe('MockGameApi', () => {
  let provider: FixedStepProvider
  let api: MockGameApi

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    stubLocalStorage()
    provider = new FixedStepProvider()
    api = new MockGameApi(provider)
  })

  // 通信の遅延を待たずに結果を受け取る。
  // 失敗する呼び出しでも「未処理の拒否」にならないよう、先に結果を受け取る準備をしてからタイマーを進める
  async function call<T>(promise: Promise<T>): Promise<T> {
    const settled = promise.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    await vi.runAllTimersAsync()
    const result = await settled
    if (!result.ok) throw result.error
    return result.value
  }

  it('同じ歩数で何度同期しても、ポイントは1回分だけ', async () => {
    expect((await call(api.syncSteps())).awardedPoints).toBe(60)
    expect((await call(api.syncSteps())).awardedPoints).toBe(0)
    provider.steps = 8000
    expect((await call(api.syncSteps())).awardedPoints).toBe(20)
    expect((await call(api.getPointBalance())).balance).toBe(80)
  })

  it('1日の歩数ポイントは100ptまで', async () => {
    provider.steps = 30_000
    await call(api.syncSteps())
    expect((await call(api.getPointBalance())).todayStepPoints).toBe(100)
  })

  it('デモ歩数は正式ランキングの対象外', async () => {
    await call(api.syncSteps())
    const ranking = await call(api.getRanking('all'))
    expect(ranking.me.eligible).toBe(false)
    expect(ranking.me.excludedReason).toBe('demo_data')
    expect(ranking.entries.some((entry) => entry.isMe)).toBe(false)
  })

  it('ログインボーナスは1日1回', async () => {
    expect((await call(api.claimLoginBonus())).granted).toBe(true)
    expect((await call(api.claimLoginBonus())).granted).toBe(false)
    expect((await call(api.getPointBalance())).balance).toBe(10)
  })

  it('ポイントが足りないとガチャを引けない', async () => {
    await expect(call(api.drawGacha())).rejects.toBeInstanceOf(ApiError)
  })

  it('ガチャで50pt減り、アイテムが持ち物に入る', async () => {
    await call(api.syncSteps()) // 60pt
    const result = await call(api.drawGacha())
    expect(result.balance.balance).toBe(10)
    const inventory = await call(api.getInventory())
    expect(inventory.find((entry) => entry.itemId === result.itemId)?.quantity).toBeGreaterThanOrEqual(1)
  })

  it('持っていないアイテムは装備できない', async () => {
    await expect(call(api.equipItem('head', 'head_mikan_hat'))).rejects.toBeInstanceOf(ApiError)
  })

  it('着せ替えは保存され、次に読み込んでも反映される', async () => {
    await call(api.completeOnboarding({ ...onboarding }))
    await call(api.equipItem('bottom', 'bottom_denim'))
    await call(api.equipItem('background', null))
    const reloaded = new MockGameApi(provider)
    const session = await call(reloaded.getSession())
    expect(session.character.equipped.background).toBeUndefined()
    expect(session.profile.onboarded).toBe(true)
  })

  it('名前が長すぎると保存しない', async () => {
    await expect(call(api.completeOnboarding({ ...onboarding, characterName: 'あ'.repeat(13) }))).rejects.toBeInstanceOf(ApiError)
  })

  it('遠い場所からはチェックインできない', async () => {
    const result = await call(
      api.checkIn({ spotId: 'matsuyama_castle', latitude: 35.68, longitude: 139.76, accuracyM: 10, via: 'list' }),
    )
    expect(result.status).toBe('too_far')
  })

  it('チェックインで限定アイテムは初回だけもらえる', async () => {
    const request = { spotId: 'dogo_onsen_honkan', latitude: 33.852, longitude: 132.7864, accuracyM: 10, via: 'list' as const }
    const first = await call(api.checkIn(request))
    const second = await call(api.checkIn(request))
    expect(first.status === 'success' && first.rewardItemId).toBe('top_onsen_yukata')
    expect(second.status === 'success' && second.rewardItemId).toBe(null)
  })

  it('AIクエスト経由の訪問は、サーバーが提案したクエストのスポットだけ認める', async () => {
    const generated = await call(
      api.generateQuest({ startSpotId: 'matsuyama_castle', minutes: 45, interests: ['歴史'], load: 'normal' }),
    )
    expect(generated.status).toBe('ok')
    if (generated.status !== 'ok') return
    const spotId = generated.quest.spots[0].spotId
    const viaQuest = await call(
      api.checkIn({ spotId, latitude: 0, longitude: 0, accuracyM: 0, via: 'ai_quest', questId: generated.quest.questId, demoLocation: true }),
    )
    expect(viaQuest.status === 'success' && viaQuest.visit.via).toBe('ai_quest')

    const fakeQuest = await call(
      api.checkIn({ spotId: 'imabari_castle', latitude: 0, longitude: 0, accuracyM: 0, via: 'ai_quest', questId: 'fake', demoLocation: true }),
    )
    expect(fakeQuest.status === 'success' && fakeQuest.visit.via).toBe('list')
  })

  it('AIクエストは1日の回数に上限がある', async () => {
    const request = { startSpotId: 'matsuyama_castle', minutes: 30, interests: [], load: 'normal' as const }
    for (let i = 0; i < AI_QUEST_DAILY_LIMIT; i++) await call(api.generateQuest(request))
    expect((await call(api.generateQuest(request))).status).toBe('quota_exceeded')
  })

  it('目標は1,000〜20,000歩の範囲だけ', async () => {
    await expect(call(api.updateProfile({ dailyGoal: 50_000 }))).rejects.toBeInstanceOf(ApiError)
    expect((await call(api.updateProfile({ dailyGoal: 8000 }))).profile.dailyGoal).toBe(8000)
  })
})
