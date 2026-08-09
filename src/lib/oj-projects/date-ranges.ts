import { eachIsoDateInRange, getIsoWeekday, getTodayIsoDate, shiftIsoDate } from '@/lib/dateUtils'

export function getCurrentMonthEntryDateRange(): { startDate: string; endDate: string } {
  const today = getTodayIsoDate()
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const startDate = `${today.slice(0, 7)}-01`
  const nextMonthStartUtc = new Date(Date.UTC(year, month, 1))
  const endDate = new Date(nextMonthStartUtc.getTime() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)

  return { startDate, endDate }
}

/* ---------- Work history chart ---------- */

/**
 * The windows offered by the Work History chart. Longer windows are totalled into
 * coarser buckets so the bar count stays readable: 30 daily bars, 13 weekly bars,
 * 13 monthly bars.
 */
export const WORK_HISTORY_RANGES = [
  { days: 30, label: '30 days', bucketNoun: 'day', granularity: 'day' },
  { days: 90, label: '90 days', bucketNoun: 'week', granularity: 'week' },
  { days: 365, label: '365 days', bucketNoun: 'month', granularity: 'month' },
] as const

export type WorkHistoryRange = (typeof WORK_HISTORY_RANGES)[number]
export type WorkHistoryRangeDays = WorkHistoryRange['days']
export type WorkHistoryGranularity = WorkHistoryRange['granularity']

export const DEFAULT_WORK_HISTORY_DAYS: WorkHistoryRangeDays = 30

/** Falls back to the default window for anything that is not one of the offered ranges. */
export function parseWorkHistoryDays(value: unknown): WorkHistoryRangeDays {
  const days = Number(value)
  const match = WORK_HISTORY_RANGES.find((range) => range.days === days)
  return match ? match.days : DEFAULT_WORK_HISTORY_DAYS
}

export function getWorkHistoryRange(days: WorkHistoryRangeDays): WorkHistoryRange {
  return WORK_HISTORY_RANGES.find((range) => range.days === days) ?? WORK_HISTORY_RANGES[0]
}

/**
 * The window ending today, inclusive of today. 30 days means today plus the 29 before it.
 */
export function getWorkHistoryDateRange(
  days: WorkHistoryRangeDays,
  today: string = getTodayIsoDate(),
): { startDate: string; endDate: string } {
  return {
    startDate: shiftIsoDate(today, -(days - 1)) ?? today,
    endDate: today,
  }
}

export interface WorkHistoryPoint {
  /** YYYY-MM-DD */
  date: string
  hours: number
}

export interface WorkHistoryBucket {
  day: string
  amount: number
}

function bucketStartDate(isoDate: string, granularity: WorkHistoryGranularity): string {
  if (granularity === 'month') return `${isoDate.slice(0, 7)}-01`
  if (granularity === 'week') {
    const weekday = getIsoWeekday(isoDate)
    if (weekday === null) return isoDate
    return shiftIsoDate(isoDate, -(weekday - 1)) ?? isoDate
  }
  return isoDate
}

function bucketLabel(bucketStart: string, granularity: WorkHistoryGranularity): string {
  const date = new Date(`${bucketStart}T12:00:00Z`)
  if (granularity === 'month') {
    return date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })
  }
  const dayLabel = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return granularity === 'week' ? `w/c ${dayLabel}` : dayLabel
}

/**
 * Totals daily hours into chart buckets, keeping empty buckets so gaps in the work
 * are visible rather than silently closed up. The first bucket of a weekly or monthly
 * series can be partial, because the window is measured back from today rather than
 * snapped to a week or month boundary.
 */
export function buildWorkHistorySeries(
  points: WorkHistoryPoint[],
  options: { startDate: string; endDate: string; granularity: WorkHistoryGranularity },
): WorkHistoryBucket[] {
  const { startDate, endDate, granularity } = options
  const dates = eachIsoDateInRange(startDate, endDate)
  if (dates.length === 0) return []

  const hoursByDate = new Map<string, number>()
  for (const point of points) {
    const date = String(point.date || '')
    if (date < startDate || date > endDate) continue
    const hours = Number(point.hours)
    if (!Number.isFinite(hours) || hours <= 0) continue
    hoursByDate.set(date, (hoursByDate.get(date) ?? 0) + hours)
  }

  // Insertion order follows the date walk, so buckets come out oldest first.
  const totals = new Map<string, number>()
  for (const date of dates) {
    const key = bucketStartDate(date, granularity)
    totals.set(key, (totals.get(key) ?? 0) + (hoursByDate.get(date) ?? 0))
  }

  return Array.from(totals, ([key, hours]) => ({
    day: bucketLabel(key, granularity),
    amount: Math.round(hours * 100) / 100,
  }))
}
