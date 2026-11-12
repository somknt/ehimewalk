import { useSyncExternalStore } from 'react'
import { api } from '../api'
import { BalanceStore, type BalanceState } from '../state/balanceStore'

/** アプリ全体で 1 つだけの残高ストア */
export const balanceStore = new BalanceStore(api)

/** 所持コイン（ヘッダー・ホーム・ガチャで同じ値を表示する） */
export function useBalance(): BalanceState {
  return useSyncExternalStore(balanceStore.subscribe, balanceStore.getSnapshot)
}
