import { useCallback } from 'react'
import { api, type QuestSuggestion, type StepSyncResult, type WeeklyMission } from '../api'
import { addDays, startOfMonth, toJstDateKey } from '../domain/date'
import type { StepRecord } from '../domain/types'
import { useSession } from '../session/sessionContext'
import { useAsyncData } from './useAsyncData'

export interface HomeData {
  records: StepRecord[]
  quest: QuestSuggestion
  mission: WeeklyMission
  lastSync: StepSyncResult
}

export function useHomeData() {
  const { applyBalance } = useSession()

  const loader = useCallback(async (): Promise<HomeData> => {
    // 先に歩数を同期し、付与されたポイントを反映した残高を取得する
    const lastSync = await api.syncSteps()
    const today = toJstDateKey()
    const sevenDaysAgo = addDays(today, -6)
    const monthStart = startOfMonth(today)
    const from = monthStart < sevenDaysAgo ? monthStart : sevenDaysAgo
    const [records, balance, quest, mission] = await Promise.all([
      api.getStepRecords(from, today),
      api.getPointBalance(),
      api.getRecommendedQuest(),
      api.getWeeklyMission(),
    ])
    applyBalance(balance)
    return { records, quest, mission, lastSync }
  }, [applyBalance])

  return useAsyncData(loader)
}
