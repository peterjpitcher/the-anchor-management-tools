import { eachIsoDateInRange, getIsoWeekday, shiftIsoDate, toLocalIsoDate, whenLondonClockReaches } from '@/lib/dateUtils'
import type { DateRange, InsightWindows } from './types'

/**
 * Report windows are whole London calendar dates, never multiples of 24 hours, so a
 * week containing a clock change is still seven days (spec 4.3).
 */

function shift(isoDate: string, days: number): string {
  const shifted = shiftIsoDate(isoDate, days)
  if (!shifted) throw new Error(`Invalid report date ${isoDate}`)
  return shifted
}

export function dateRange(start: string, end: string): DateRange {
  const days = eachIsoDateInRange(start, end).length
  if (days === 0) throw new Error(`Invalid report range ${start} to ${end}`)
  return { start, end, days }
}

export function computeWindows(now: Date): InsightWindows {
  if (Number.isNaN(now.getTime())) throw new Error('Report time is invalid')
  const today = toLocalIsoDate(now)
  const day = (offset: number): string => shift(today, offset)
  return {
    today,
    yesterday: day(-1),
    thisWeek: dateRange(day(-7), day(-1)),
    lastWeek: dateRange(day(-14), day(-8)),
    previous4Weeks: dateRange(day(-35), day(-8)),
    previous13Weeks: dateRange(day(-98), day(-8)),
    next7: dateRange(today, day(6)),
    next14: dateRange(today, day(13)),
    last14: dateRange(day(-14), day(-1)),
    last28: dateRange(day(-28), day(-1)),
    last91: dateRange(day(-91), day(-1)),
  }
}

/** The instant a London calendar date begins, as an ISO string for timestamptz filters. */
export function londonDayStartIso(isoDate: string): string {
  const instant = whenLondonClockReaches(isoDate, '00:00')
  if (!instant) throw new Error(`Invalid report date ${isoDate}`)
  return instant.toISOString()
}

/**
 * Timestamptz bounds for a London date range: `from` inclusive, `toExclusive` is the
 * start of the day after the range. Use as `.gte(col, from).lt(col, toExclusive)`.
 */
export function rangeInstants(range: DateRange): { from: string; toExclusive: string } {
  return { from: londonDayStartIso(range.start), toExclusive: londonDayStartIso(shift(range.end, 1)) }
}

/** London calendar date of a timestamp string or Date. */
export function londonDateOf(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) throw new Error('Invalid timestamp')
  return toLocalIsoDate(date)
}

export function isInRange(isoDate: string, range: DateRange): boolean {
  const date = isoDate.slice(0, 10)
  return date >= range.start && date <= range.end
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00Z`)
  const end = Date.parse(`${to.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end)) throw new Error(`Invalid dates ${from}, ${to}`)
  return Math.round((end - start) / 86_400_000)
}

export function addDays(isoDate: string, days: number): string {
  return shift(isoDate, days)
}

/** Every date in the range, in order. */
export function datesIn(range: DateRange): string[] {
  return eachIsoDateInRange(range.start, range.end)
}

/** ISO weekday, 1 = Monday to 7 = Sunday. */
export function weekdayOf(isoDate: string): number {
  const weekday = getIsoWeekday(isoDate)
  if (weekday === null) throw new Error(`Invalid report date ${isoDate}`)
  return weekday
}

/** The Monday on or before a date. */
export function mondayOf(isoDate: string): string {
  return shift(isoDate, 1 - weekdayOf(isoDate))
}

export function weeksIn(range: DateRange): number {
  return range.days / 7
}
