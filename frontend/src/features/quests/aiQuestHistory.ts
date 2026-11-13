// AI が提案した散策コースの保存（この端末のブラウザに保存する）。
// - 最近の提案：新しい順に最大 5 件。それより古いものは消える
// - お気に入り：星マークで保存したもの。最大 10 件。外すまで消えない（最近の提案から消えても残る）
// 利用者の現在地の座標は保存しない（クエストには「現在地」という表示名しか含まれない）。
// 将来ログイン（Cognito）を入れたら、サーバー側の保存に移す。
import type { AiQuest } from '../../api/aiQuestClient'

export const AI_QUEST_HISTORY_KEY = 'ewq.aiQuests.v1'
export const MAX_RECENT_QUESTS = 5
export const MAX_FAVORITE_QUESTS = 10

export interface AiQuestHistoryState {
  recent: AiQuest[]
  favorites: AiQuest[]
}

export type ToggleFavoriteResult = 'added' | 'removed' | 'full'

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const EMPTY: AiQuestHistoryState = { recent: [], favorites: [] }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** 保存データの形を確かめる（壊れたものは読み飛ばす） */
export function isAiQuest(v: unknown): v is AiQuest {
  if (!isObject(v)) return false
  const route = v.route
  return (
    isString(v.questId) &&
    isString(v.title) &&
    isString(v.description) &&
    isNumber(v.estimatedMinutes) &&
    isString(v.startLabel) &&
    isString(v.createdAt) &&
    (v.generatedBy === 'mock' || v.generatedBy === 'bedrock') &&
    (v.model === null || isString(v.model)) &&
    isObject(route) &&
    isNumber(route.distanceM) &&
    isNumber(route.minutes) &&
    isNumber(route.steps) &&
    Array.isArray(v.spots) &&
    v.spots.length > 0 &&
    v.spots.every(
      (s) => isObject(s) && isNumber(s.order) && isString(s.spotId) && isString(s.name) && isString(s.municipality) && isString(s.description) && isNumber(s.legM),
    )
  )
}

function readList(raw: unknown, max: number): AiQuest[] {
  if (!Array.isArray(raw)) return []
  const out: AiQuest[] = []
  for (const q of raw) {
    if (isAiQuest(q) && !out.some((x) => x.questId === q.questId)) out.push(q)
    if (out.length >= max) break
  }
  return out
}

type Listener = () => void

export class AiQuestHistory {
  private state: AiQuestHistoryState
  private readonly storage: StorageLike | null
  private readonly listeners = new Set<Listener>()
  /** 保存に失敗したことがあるか（容量不足など）。画面で知らせる */
  saveFailed = false

  constructor(storage: StorageLike | null) {
    this.storage = storage
    this.state = this.load()
  }

  private load(): AiQuestHistoryState {
    try {
      const raw = this.storage?.getItem(AI_QUEST_HISTORY_KEY)
      if (!raw) return EMPTY
      const data: unknown = JSON.parse(raw)
      if (!isObject(data)) return EMPTY
      return { recent: readList(data.recent, MAX_RECENT_QUESTS), favorites: readList(data.favorites, MAX_FAVORITE_QUESTS) }
    } catch {
      // 壊れたデータでもアプリは止めない
      return EMPTY
    }
  }

  private commit(next: AiQuestHistoryState) {
    this.state = next
    try {
      this.storage?.setItem(AI_QUEST_HISTORY_KEY, JSON.stringify(next))
      this.saveFailed = false
    } catch {
      // 保存できなくても、開いている間は表示する
      this.saveFailed = true
    }
    this.listeners.forEach((listener) => listener())
  }

  getSnapshot = (): AiQuestHistoryState => this.state

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 提案を最近の一覧の先頭に入れる。同じ提案（キャッシュの再利用など）は重ねずに先頭へ移す */
  addRecent(quest: AiQuest): void {
    const recent = [quest, ...this.state.recent.filter((q) => q.questId !== quest.questId)].slice(0, MAX_RECENT_QUESTS)
    this.commit({ ...this.state, recent })
  }

  isFavorite(questId: string): boolean {
    return this.state.favorites.some((q) => q.questId === questId)
  }

  /** お気に入りに入れる・外す。10 件たまっているときは、古いものを勝手に消さずに 'full' を返す */
  toggleFavorite(quest: AiQuest): ToggleFavoriteResult {
    if (this.isFavorite(quest.questId)) {
      this.commit({ ...this.state, favorites: this.state.favorites.filter((q) => q.questId !== quest.questId) })
      return 'removed'
    }
    if (this.state.favorites.length >= MAX_FAVORITE_QUESTS) return 'full'
    this.commit({ ...this.state, favorites: [quest, ...this.state.favorites] })
    return 'added'
  }

  /** 保存した提案をすべて消す（マイページの「すべてのデータを削除する」から呼ぶ） */
  clear(): void {
    this.state = EMPTY
    try {
      this.storage?.removeItem(AI_QUEST_HISTORY_KEY)
    } catch {
      // 消せなくても続ける
    }
    this.listeners.forEach((listener) => listener())
  }
}

function browserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** アプリ全体で 1 つの保存先 */
export const aiQuestHistory = new AiQuestHistory(browserStorage())
