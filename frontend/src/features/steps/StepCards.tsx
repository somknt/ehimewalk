import { Badge, Card, CardTitle, ProgressBar, Stat } from '../../components/ui'
import { ESTIMATE_ASSUMPTION_LABEL, estimateCaloriesKcal, estimateDistanceKm } from '../../domain/health'
import type { StepSummary } from '../../domain/steps'
import type { StepSource } from '../../domain/types'
import { WeeklyStepChart } from './WeeklyStepChart'

const SOURCE_LABELS: Record<StepSource, string> = {
  demo: 'デモデータ',
  healthkit: 'ヘルスケア',
  health_connect: 'ヘルスコネクト',
}

const formatSteps = (steps: number) => steps.toLocaleString('ja-JP')

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  )
}

export function TodayStepsCard({
  steps,
  source,
  syncedAt,
  demoAddedSteps = 0,
}: {
  steps: StepSummary
  source: StepSource
  syncedAt: string
  /** 今日の歩数のうちデモ操作で追加した分（実際の歩数と区別して表示する） */
  demoAddedSteps?: number
}) {
  const remaining = Math.max(0, steps.goal - steps.todaySteps)
  const percent = Math.round(steps.goalRate * 100)

  return (
    <Card>
      <CardTitle aside={<Badge tone={source === 'demo' ? 'gray' : 'seto'}>{SOURCE_LABELS[source]}</Badge>}>
        今日の歩数
      </CardTitle>
      <p className="font-pixel text-5xl leading-none tracking-wide">
        {formatSteps(steps.todaySteps)}
        <span className="ml-2 text-xl">歩</span>
      </p>
      {demoAddedSteps > 0 && (
        <p className="mt-1 text-sm text-seto-700">うちデモ操作で追加：{formatSteps(demoAddedSteps)} 歩</p>
      )}
      <p className="mt-2 text-ink-soft">
        今日の目標 <span className="font-bold text-ink">{formatSteps(steps.goal)}</span> 歩
      </p>
      <div className="mt-3">
        <ProgressBar value={steps.goalRate} label="今日の目標達成率" />
        <div className="mt-1.5 flex items-center justify-between text-sm">
          <span className="font-bold">達成率 {percent}%</span>
          <span>{remaining > 0 ? `あと ${formatSteps(remaining)} 歩` : '目標達成！'}</span>
        </div>
      </div>
      <p className="mt-3 text-xs text-ink-soft">
        最終同期 {formatTime(syncedAt)}
        {source === 'demo' && '・デモデータは正式ランキングに反映されません'}
      </p>
    </Card>
  )
}

export function HealthDashboard({ steps }: { steps: StepSummary }) {
  const month = Number(steps.today.slice(5, 7))
  const distance = estimateDistanceKm(steps.todaySteps)
  const calories = estimateCaloriesKcal(steps.todaySteps)

  return (
    <Card>
      <CardTitle>健康ダッシュボード</CardTitle>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="今週の合計" value={formatSteps(steps.weekSteps)} unit="歩" note="月曜〜今日" />
        <Stat label={`${month}月の合計`} value={formatSteps(steps.monthSteps)} unit="歩" note={`${month}/1〜今日`} />
        <Stat label="今日の推定距離" value={distance.toFixed(1)} unit="km" />
        <Stat label="今日の推定消費" value={Math.round(calories).toLocaleString('ja-JP')} unit="kcal" />
      </div>
      <p className="mt-2 text-xs text-ink-soft">
        距離とカロリーは{ESTIMATE_ASSUMPTION_LABEL}です。医療的な判断には使わないでください。
      </p>
      <div className="mt-5">
        <WeeklyStepChart days={steps.last7Days} goal={steps.goal} today={steps.today} />
      </div>
      <p className="mt-3 text-sm text-ink-soft">
        過去7日間の平均：<span className="font-bold text-ink">{formatSteps(steps.average7Days)}</span> 歩
      </p>
    </Card>
  )
}
