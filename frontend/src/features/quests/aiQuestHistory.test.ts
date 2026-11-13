import { describe, expect, it } from 'vitest'
import type { AiQuest } from '../../api/aiQuestClient'
import { AI_QUEST_HISTORY_KEY, AiQuestHistory, MAX_FAVORITE_QUESTS, MAX_RECENT_QUESTS } from './aiQuestHistory'

class MemoryStorage {
  data = new Map<string, string>()
  failWrites = false
  getItem(k: string) {
    return this.data.get(k) ?? null
  }
  setItem(k: string, v: string) {
    if (this.failWrites) throw new Error('QuotaExceededError')
    this.data.set(k, v)
  }
  removeItem(k: string) {
    this.data.delete(k)
  }
}

const quest = (n: number): AiQuest => ({
  questId: `q${n}`,
  title: `クエスト${n}`,
  description: '説明',
  estimatedMinutes: 30,
  startLabel: '松山城周辺',
  spots: [{ order: 1, spotId: 'matsuyama_castle', name: '松山城', municipality: '松山市', description: '案内', legM: 0 }],
  route: { basis: 'straight_line', distanceM: 0, minutes: 0, steps: 0 },
  generatedBy: 'bedrock',
  model: 'jp.amazon.nova-2-lite-v1:0',
  createdAt: `2026-11-14T0${n % 10}:00:00.000Z`,
})

describe('AIが提案したコースの保存', () => {
  it('最近の提案は新しい順に5件まで残り、再読み込み後も残る', () => {
    const storage = new MemoryStorage()
    const h = new AiQuestHistory(storage)
    for (let i = 1; i <= 7; i++) h.addRecent(quest(i))
    expect(h.getSnapshot().recent.map((q) => q.questId)).toEqual(['q7', 'q6', 'q5', 'q4', 'q3'])
    expect(MAX_RECENT_QUESTS).toBe(5)
    expect(new AiQuestHistory(storage).getSnapshot().recent).toHaveLength(5)
  })

  it('同じ提案（キャッシュの再利用）は重ねずに先頭へ移す', () => {
    const h = new AiQuestHistory(new MemoryStorage())
    h.addRecent(quest(1))
    h.addRecent(quest(2))
    h.addRecent(quest(1))
    expect(h.getSnapshot().recent.map((q) => q.questId)).toEqual(['q1', 'q2'])
  })

  it('星マークでお気に入りに保存・解除でき、最近の提案から消えても残る', () => {
    const storage = new MemoryStorage()
    const h = new AiQuestHistory(storage)
    h.addRecent(quest(1))
    expect(h.toggleFavorite(quest(1))).toBe('added')
    for (let i = 2; i <= 7; i++) h.addRecent(quest(i))
    const reloaded = new AiQuestHistory(storage)
    expect(reloaded.getSnapshot().recent.map((q) => q.questId)).not.toContain('q1')
    expect(reloaded.isFavorite('q1')).toBe(true)
    expect(reloaded.toggleFavorite(quest(1))).toBe('removed')
    expect(reloaded.isFavorite('q1')).toBe(false)
  })

  it('お気に入りは10件まで。11件目は古いものを消さずに断る', () => {
    const h = new AiQuestHistory(new MemoryStorage())
    for (let i = 1; i <= MAX_FAVORITE_QUESTS; i++) expect(h.toggleFavorite(quest(i))).toBe('added')
    expect(h.toggleFavorite(quest(11))).toBe('full')
    expect(h.getSnapshot().favorites).toHaveLength(10)
    expect(h.isFavorite('q1')).toBe(true)
    // 1 つ外せば保存できる
    h.toggleFavorite(quest(3))
    expect(h.toggleFavorite(quest(11))).toBe('added')
  })

  it('壊れた保存データでも止まらず、正しい形のものだけを読む', () => {
    const storage = new MemoryStorage()
    storage.setItem(AI_QUEST_HISTORY_KEY, '{not json')
    expect(new AiQuestHistory(storage).getSnapshot()).toEqual({ recent: [], favorites: [] })
    storage.setItem(AI_QUEST_HISTORY_KEY, JSON.stringify({ recent: [quest(1), { title: 'broken' }, null], favorites: 'x' }))
    expect(new AiQuestHistory(storage).getSnapshot()).toEqual({ recent: [quest(1)], favorites: [] })
  })

  it('保存に失敗しても、開いている間は表示し、失敗したことが分かる', () => {
    const storage = new MemoryStorage()
    storage.failWrites = true
    const h = new AiQuestHistory(storage)
    h.addRecent(quest(1))
    expect(h.getSnapshot().recent).toHaveLength(1)
    expect(h.saveFailed).toBe(true)
  })

  it('すべて消せる', () => {
    const storage = new MemoryStorage()
    const h = new AiQuestHistory(storage)
    h.addRecent(quest(1))
    h.toggleFavorite(quest(1))
    h.clear()
    expect(h.getSnapshot()).toEqual({ recent: [], favorites: [] })
    expect(storage.getItem(AI_QUEST_HISTORY_KEY)).toBeNull()
  })
})
