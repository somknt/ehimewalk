import { describe, expect, it } from 'vitest'
import { MemoryStorage, MockGameApi } from '../mockApi'
import { DeviceMotionStepProvider, MotionStepStore } from './deviceMotionStepProvider'

/** 2026-11-11 12:00 JST */
const NOW = new Date('2026-11-11T03:00:00Z')

function setup() {
  const store = new MotionStepStore(new MemoryStorage())
  const provider = new DeviceMotionStepProvider(store, () => NOW)
  const api = new MockGameApi({ storage: new MemoryStorage(), provider, latencyMs: 0, now: () => NOW })
  return { store, provider, api }
}

describe('端末のセンサーの歩数', () => {
  it('はじめは0歩で、コインも0', async () => {
    const { api } = setup()
    await api.syncSteps()
    const records = await api.getStepRecords('2026-11-01', '2026-11-11')
    expect(records).toEqual([expect.objectContaining({ date: '2026-11-11', steps: 0, source: 'device_motion' })])
    expect((await api.getPointBalance()).balance).toBe(0)
  })

  it('数えた歩数が同期でコインになり、二重付与されない', async () => {
    const { store, api } = setup()
    store.add(1234, NOW)
    expect((await api.syncSteps()).awardedPoints).toBe(12)
    expect((await api.syncSteps()).awardedPoints).toBe(0)
    store.add(800, NOW)
    expect((await api.syncSteps()).awardedPoints).toBe(8)
    expect((await api.getStepRecords('2026-11-11', '2026-11-11'))[0]).toMatchObject({ steps: 2034, verification: 'pending' })
  })

  it('センサーの歩数にもデモ操作で歩数を足せ、足した分は区別される', async () => {
    const { store, api } = setup()
    store.add(500, NOW)
    const result = await api.demo!.addSteps(1000)
    expect(result).toMatchObject({ todaySteps: 1500, awardedPoints: 15 })
    expect((await api.getStepRecords('2026-11-11', '2026-11-11'))[0]).toMatchObject({ demoAddedSteps: 1000, source: 'device_motion' })
  })

  it('センサーだけの歩数は、検証待ちとして正式ランキングに入らない', async () => {
    const { store, api } = setup()
    store.add(3000, NOW)
    await api.syncSteps()
    expect((await api.getRanking('all')).me).toMatchObject({ eligible: false, excludedReason: 'unverified' })
  })

  it('データを削除するとセンサーの歩数も消える', async () => {
    const { store, api } = setup()
    store.add(3000, NOW)
    await api.deleteAllData()
    expect(store.today(NOW)).toBe(0)
  })

  it('日付ごとに分けて保存する（日本時間の0時で切り替わる）', () => {
    const store = new MotionStepStore(new MemoryStorage())
    store.add(100, new Date('2026-11-10T14:59:00Z')) // 11/10 23:59 JST
    store.add(200, new Date('2026-11-10T15:00:00Z')) // 11/11 0:00 JST
    expect(store.read()).toEqual({ '2026-11-10': 100, '2026-11-11': 200 })
  })
})
