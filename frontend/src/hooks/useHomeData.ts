import { api, type PointBalance, type QuestSuggestion, type StepSyncResult, type WeeklyMission } from '../api'
import { addDays, startOfMonth, toJstDateKey } from '../domain/date'
import { summarizeSteps, type StepSummary } from '../domain/steps'
import type { Character, UserProfile } from '../domain/types'
import { useAsyncData } from './useAsyncData'

export interface HomeData {
  profile: UserProfile
  character: Character
  steps: StepSummary
  /** 今日の歩数のうち、開発用のデモ操作で追加した歩数 */
  todayDemoAddedSteps: number
  balance: PointBalance
  quest: QuestSuggestion
  /** 今週の健康ミッション（過去 7 日間の歩数から提案） */
  mission: WeeklyMission
  /** 訪問済みのスポット（おすすめクエストの進行状況に使う） */
  visitedSpotIds: string[]
  lastSync: StepSyncResult
}

async function loadHomeData(): Promise<HomeData> {
  // 先に歩数を同期し、付与されたポイントを反映した残高を取得する
  const lastSync = await api.syncSteps()
  const today = toJstDateKey()
  const sevenDaysAgo = addDays(today, -6)
  const monthStart = startOfMonth(today)
  const from = monthStart < sevenDaysAgo ? monthStart : sevenDaysAgo
  const [profile, character, records, balance, quest, mission, visits] = await Promise.all([
    api.getProfile(),
    api.getCharacter(),
    api.getStepRecords(from, today),
    api.getPointBalance(),
    api.getRecommendedQuest(),
    api.getWeeklyMission(),
    api.getVisits(),
  ])
  return {
    profile,
    character,
    steps: summarizeSteps(records, today, profile.dailyGoal),
    todayDemoAddedSteps: records.find((record) => record.date === today)?.demoAddedSteps ?? 0,
    balance,
    quest,
    mission,
    visitedSpotIds: visits.map((visit) => visit.spotId),
    lastSync,
  }
}

export function useHomeData() {
  return useAsyncData(loadHomeData)
}
