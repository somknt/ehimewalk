// 歩数記録の集計
import { addDays, dateRange, startOfMonth, startOfWeek } from './date'
import type { DailySteps, DateKey, StepRecord } from './types'

export const MIN_DAILY_GOAL = 1_000
export const MAX_DAILY_GOAL = 20_000
export const DEFAULT_DAILY_GOAL = 6_000

export interface StepSummary {
  today: DateKey
  todaySteps: number
  weekSteps: number
  monthSteps: number
  /** 古い順の 7 日分（記録が無い日は 0） */
  last7Days: DailySteps[]
  average7Days: number
  goal: number
  /** 0〜1 を超えることもある（表示側で上限をかける） */
  goalRate: number
}

function sumBetween(byDate: Map<DateKey, number>, from: DateKey, to: DateKey): number {
  let total = 0
  for (const [date, steps] of byDate) {
    if (date >= from && date <= to) total += steps
  }
  return total
}

export function summarizeSteps(records: StepRecord[], today: DateKey, goal: number): StepSummary {
  const byDate = new Map(records.map((r) => [r.date, r.steps]))
  const last7Days = dateRange(addDays(today, -6), today).map((date) => ({
    date,
    steps: byDate.get(date) ?? 0,
  }))
  const todaySteps = byDate.get(today) ?? 0
  return {
    today,
    todaySteps,
    weekSteps: sumBetween(byDate, startOfWeek(today), today),
    monthSteps: sumBetween(byDate, startOfMonth(today), today),
    last7Days,
    average7Days: Math.round(last7Days.reduce((sum, d) => sum + d.steps, 0) / last7Days.length),
    goal,
    goalRate: goal > 0 ? todaySteps / goal : 0,
  }
}

export function clampDailyGoal(goal: number): number {
  if (!Number.isFinite(goal)) return DEFAULT_DAILY_GOAL
  return Math.min(MAX_DAILY_GOAL, Math.max(MIN_DAILY_GOAL, Math.round(goal / 100) * 100))
}
