import { formatMonthDay, weekdayLabel } from '../../domain/date'
import type { DailySteps, DateKey } from '../../domain/types'

interface WeeklyStepChartProps {
  days: DailySteps[]
  goal: number
  today: DateKey
}

const thousands = (steps: number) => (steps / 1000).toFixed(1)

/** 過去 7 日間の歩数の棒グラフ。読み上げ用に同じ内容の表も持つ */
export function WeeklyStepChart({ days, goal, today }: WeeklyStepChartProps) {
  const max = Math.max(goal, ...days.map((d) => d.steps), 1)
  const goalPercent = (goal / max) * 100

  return (
    <figure>
      <figcaption className="mb-2">
        <span className="font-bold">過去7日間の歩数</span>
        <span className="mt-0.5 block text-sm text-ink-soft">
          単位：千歩／<span className="font-bold text-leaf-700">緑の点線</span>：目標 {goal.toLocaleString('ja-JP')} 歩
        </span>
      </figcaption>

      <div aria-hidden="true">
        {/* 上の余白は、いちばん高い棒の数値ラベル用 */}
        <div className="h-44 border-b-[3px] border-ink pt-5">
          <div className="relative flex h-full items-end gap-1.5 px-1">
            <div
              className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-dashed border-leaf-600"
              style={{ bottom: `${goalPercent}%` }}
            />
            {days.map((day) => {
              const isToday = day.date === today
              const reached = day.steps >= goal
              const percent = Math.max(2, (day.steps / max) * 100)
              return (
                <div key={day.date} className="relative flex h-full flex-1 items-end">
                  <div
                    className={`w-full rounded-t-md border-2 border-b-0 border-ink ${
                      reached ? 'bg-leaf-500' : isToday ? 'bg-mikan-500' : 'bg-mikan-300'
                    }`}
                    style={{ height: `${percent}%` }}
                  />
                  <span
                    className="absolute inset-x-0 text-center font-pixel text-xs"
                    style={{ bottom: `calc(${percent}% + 2px)` }}
                  >
                    {thousands(day.steps)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
        <div className="mt-1 flex gap-1.5 px-1">
          {days.map((day) => (
            <div
              key={day.date}
              className={`flex-1 text-center text-xs leading-tight ${day.date === today ? 'font-bold text-mikan-800' : 'text-ink-soft'}`}
            >
              <div>{day.date === today ? '今日' : weekdayLabel(day.date)}</div>
              <div>{formatMonthDay(day.date)}</div>
            </div>
          ))}
        </div>
      </div>

      <table className="sr-only">
        <caption>過去7日間の歩数（目標 {goal.toLocaleString('ja-JP')} 歩）</caption>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}>
              <th scope="row">
                {formatMonthDay(day.date)}（{weekdayLabel(day.date)}）
              </th>
              <td>{day.steps.toLocaleString('ja-JP')} 歩</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
