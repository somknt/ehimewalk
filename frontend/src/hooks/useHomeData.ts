import { api, type PointBalance, type QuestSuggestion, type StepSyncResult } from '../api'
import { addDays, startOfMonth, toJstDateKey } from '../domain/date'
import { summarizeSteps, type StepSummary } from '../domain/steps'
import type { Character, UserProfile } from '../domain/types'
import { useAsyncData } from './useAsyncData'

export interface HomeData {
  profile: UserProfile
  character: Character
  steps: StepSummary
  balance: PointBalance
  quest: QuestSuggestion
  lastSync: StepSyncResult
}

async function loadHomeData(): Promise<HomeData> {
  // 先に歩数を同期し、付与されたポイントを反映した残高を取得する
  const lastSync = await api.syncSteps()
  const today = toJstDateKey()
  const sevenDaysAgo = addDays(today, -6)
  const monthStart = startOfMonth(today)
  const from = monthStart < sevenDaysAgo ? monthStart : sevenDaysAgo
  const [profile, character, records, balance, quest] = await Promise.all([
    api.getProfile(),
    api.getCharacter(),
    api.getStepRecords(from, today),
    api.getPointBalance(),
    api.getRecommendedQuest(),
  ])
  return {
    profile,
    character,
    steps: summarizeSteps(records, today, profile.dailyGoal),
    balance,
    quest,
    lastSync,
  }
}

export function useHomeData() {
  return useAsyncData(loadHomeData)
}
