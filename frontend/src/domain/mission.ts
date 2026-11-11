// 健康ミッション（週の目標）の規則。AI に文面を作らせる場合も、目標値はこの規則で決める。
// 極端に高い目標を出さないため、過去 7 日平均の +10%（最大 +1,000 歩）を上限にする。
import { clampDailyGoal } from './steps'

export const MAINTAIN_THRESHOLD = 8_000
export const MAX_INCREASE_RATE = 0.1
export const MAX_INCREASE_STEPS = 1_000
export const STARTER_GOAL = 3_000

export type MissionKind = 'start' | 'increase' | 'maintain'

export interface WeeklyGoalProposal {
  kind: MissionKind
  targetSteps: number
  message: string
}

const roundTo100 = (steps: number) => Math.round(steps / 100) * 100

export function proposeWeeklyGoal(average7Days: number): WeeklyGoalProposal {
  if (!Number.isFinite(average7Days) || average7Days <= 0) {
    return {
      kind: 'start',
      targetSteps: STARTER_GOAL,
      message: 'まずは1日3,000歩から。歩数の記録をつけてみよう！',
    }
  }
  if (average7Days >= MAINTAIN_THRESHOLD) {
    return {
      kind: 'maintain',
      targetSteps: MAINTAIN_THRESHOLD,
      message: '今週も無理なく運動習慣を維持しよう！疲れた日はしっかり休んでね。',
    }
  }
  const increase = Math.min(average7Days * MAX_INCREASE_RATE, MAX_INCREASE_STEPS)
  const targetSteps = clampDailyGoal(roundTo100(average7Days + increase))
  return {
    kind: 'increase',
    targetSteps,
    message: `今週は1日${targetSteps.toLocaleString('ja-JP')}歩を目標にしてみよう！`,
  }
}
