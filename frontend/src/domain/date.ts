// 日本時間（JST）の日付計算。週は月曜始まり。
import type { DateKey } from './types'

const jstFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isDateKey(value: string): value is DateKey {
  return DATE_KEY_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

/** 指定した瞬間の JST の日付（YYYY-MM-DD） */
export function toJstDateKey(instant: Date = new Date()): DateKey {
  return jstFormatter.format(instant)
}

// DateKey を「UTC の 0 時」として扱うと、暦の計算をタイムゾーンに左右されずに行える
function toUtcMidnight(key: DateKey): Date {
  return new Date(`${key}T00:00:00Z`)
}

function fromUtcMidnight(date: Date): DateKey {
  return date.toISOString().slice(0, 10)
}

export function addDays(key: DateKey, days: number): DateKey {
  const date = toUtcMidnight(key)
  date.setUTCDate(date.getUTCDate() + days)
  return fromUtcMidnight(date)
}

/** 0 = 日曜 … 6 = 土曜 */
export function dayOfWeek(key: DateKey): number {
  return toUtcMidnight(key).getUTCDay()
}

/** その週の月曜日 */
export function startOfWeek(key: DateKey): DateKey {
  const offsetFromMonday = (dayOfWeek(key) + 6) % 7
  return addDays(key, -offsetFromMonday)
}

export function startOfMonth(key: DateKey): DateKey {
  return `${key.slice(0, 8)}01`
}

/** from から to まで（両端を含む）の日付を順に返す */
export function dateRange(from: DateKey, to: DateKey): DateKey[] {
  const keys: DateKey[] = []
  for (let key = from; key <= to; key = addDays(key, 1)) {
    keys.push(key)
  }
  return keys
}

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const

export function weekdayLabel(key: DateKey): string {
  return WEEKDAY_LABELS[dayOfWeek(key)]
}

/** 「11/11」の形式 */
export function formatMonthDay(key: DateKey): string {
  const [, month, day] = key.split('-')
  return `${Number(month)}/${Number(day)}`
}
