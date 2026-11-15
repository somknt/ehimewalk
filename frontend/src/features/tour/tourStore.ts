import { useSyncExternalStore } from 'react'

/** 操作ガイドの進み具合（ページを読み込み直しても続きから表示する） */
export interface TourState {
  active: boolean
  step: number
}

const STORAGE_KEY = 'ewq.tour.v1'
const INACTIVE: TourState = { active: false, step: 0 }

function read(): TourState {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return INACTIVE
    const value: unknown = JSON.parse(raw)
    if (typeof value === 'object' && value !== null) {
      const { active, step } = value as Partial<TourState>
      if (typeof active === 'boolean' && typeof step === 'number' && Number.isInteger(step) && step >= 0) return { active, step }
    }
  } catch {
    // 読めないときはガイドを出さない
  }
  return INACTIVE
}

let state: TourState = read()
const listeners = new Set<() => void>()

function write(next: TourState) {
  state = next
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 保存できなくても、この画面の間はガイドを続ける
  }
  for (const listener of listeners) listener()
}

export const tourStore = {
  /** 最初から始める */
  start: () => write({ active: true, step: 0 }),
  stop: () => write(INACTIVE),
  goTo: (step: number) => write({ active: true, step: Math.max(0, step) }),
  get: () => state,
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

export function useTour(): TourState {
  return useSyncExternalStore(tourStore.subscribe, tourStore.get, tourStore.get)
}

/** デモモードになるユーザー名（サーバーの private.demo_usernames() と同じ） */
const DEMO_USERNAMES = ['デモ', 'demo']

export const isDemoUsername = (username: string) => DEMO_USERNAMES.includes(username.trim().toLowerCase())
