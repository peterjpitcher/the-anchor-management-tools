/**
 * Repeating events ("repeats weekly"): the one place that works out which dates a weekly
 * night runs on. Every screen, the API, the calendar sync and the FOH and rota lines call
 * resolveSeriesOccurrences; nothing else does date maths for a series.
 *
 * Times are London wall-clock times with a weekday, never instants. Each date is turned into
 * instants through dateUtils, so the night stays at 7pm across both clock changes.
 */
import {
  eachIsoDateInRange,
  getIsoWeekday,
  isValidIsoDate,
  shiftIsoDate,
  toLocalIsoDate,
  whenLondonClockReaches,
} from '@/lib/dateUtils'

export type EventSeriesStatus = 'active' | 'paused' | 'ended'

export interface EventSeriesRule {
  id: string
  /** ISO weekday: Monday 1 to Sunday 7. */
  weekday: number
  /** London wall-clock time, HH:MM or HH:MM:SS. */
  startTime: string
  /** London wall-clock time; at or before startTime means the night ends after midnight. */
  endTime: string
  startsOn: string
  endsOn: string | null
  status: EventSeriesStatus
  skipWhenClosed: boolean
}

export interface EventSeriesSkip {
  skipDate: string
  reason: string | null
  replacedByEventId: string | null
}

/** The special_hours fields the resolver reads: only a full closure skips a night. */
export interface SeriesSpecialHoursDay {
  date: string
  isClosed: boolean
}

export interface SeriesOccurrence {
  date: string
  /** HH:MM, London. */
  startTime: string
  /** HH:MM, London. */
  endTime: string
  startsAt: string
  endsAt: string
}

/**
 * manual: skipped by hand. closed: the pub is fully closed that day in special hours.
 * replaced: the date was made a full event, which shows in its own right, so the website names
 * nothing special for it.
 */
export type SeriesSkipKind = 'manual' | 'closed' | 'replaced'

export interface SeriesSkippedDate {
  date: string
  kind: SeriesSkipKind
  reason: string | null
  replacedByEventId: string | null
}

export interface SeriesOccurrenceResult {
  occurrences: SeriesOccurrence[]
  skipped: SeriesSkippedDate[]
}

/** "19:00:00" -> "19:00". */
export function toHhMm(time: string): string {
  return time.trim().slice(0, 5)
}

function minutesOf(time: string): number {
  const [h, m] = toHhMm(time).split(':').map(Number)
  return h * 60 + m
}

/** True when the night ends on the following calendar day. */
export function seriesCrossesMidnight(series: Pick<EventSeriesRule, 'startTime' | 'endTime'>): boolean {
  return minutesOf(series.endTime) <= minutesOf(series.startTime)
}

function buildOccurrence(series: EventSeriesRule, date: string): SeriesOccurrence | null {
  const startTime = toHhMm(series.startTime)
  const endTime = toHhMm(series.endTime)
  const endDate = seriesCrossesMidnight(series) ? shiftIsoDate(date, 1) : date
  const startsAt = whenLondonClockReaches(date, startTime)
  const endsAt = endDate ? whenLondonClockReaches(endDate, endTime) : null
  if (!startsAt || !endsAt) return null
  return { date, startTime, endTime, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }
}

/**
 * Every date from `from` to `to` (inclusive, YYYY-MM-DD) on which the series runs, and,
 * separately, each date in that range it would have run but is skipped (by hand, or because the
 * pub is fully closed that day in special hours). A kitchen-only closure does not skip it.
 * A series that is not active returns nothing.
 */
export function resolveSeriesOccurrences(
  series: EventSeriesRule,
  skips: readonly EventSeriesSkip[],
  specialHours: readonly SeriesSpecialHoursDay[],
  from: string,
  to: string
): SeriesOccurrenceResult {
  const result: SeriesOccurrenceResult = { occurrences: [], skipped: [] }
  if (series.status !== 'active') return result
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) return result

  const start = from > series.startsOn ? from : series.startsOn
  const end = series.endsOn && series.endsOn < to ? series.endsOn : to
  if (end < start) return result

  const skipByDate = new Map(skips.map((skip) => [skip.skipDate, skip]))
  const closedDates = new Set(specialHours.filter((day) => day.isClosed).map((day) => day.date))

  for (const date of eachIsoDateInRange(start, end)) {
    if (getIsoWeekday(date) !== series.weekday) continue

    const skip = skipByDate.get(date)
    if (skip) {
      result.skipped.push({
        date,
        kind: skip.replacedByEventId ? 'replaced' : 'manual',
        reason: skip.reason,
        replacedByEventId: skip.replacedByEventId,
      })
      continue
    }
    if (series.skipWhenClosed && closedDates.has(date)) {
      result.skipped.push({ date, kind: 'closed', reason: null, replacedByEventId: null })
      continue
    }

    const occurrence = buildOccurrence(series, date)
    if (occurrence) result.occurrences.push(occurrence)
  }

  return result
}

/**
 * The next date the series runs, counting today (London) until its end time has passed. A
 * night that runs past midnight is still "next" in the small hours after it started.
 */
export function nextSeriesOccurrence(
  series: EventSeriesRule,
  skips: readonly EventSeriesSkip[],
  specialHours: readonly SeriesSpecialHoursDay[],
  now: Date = new Date(),
  horizonDays = 400
): SeriesOccurrence | null {
  const today = toLocalIsoDate(now)
  const from = shiftIsoDate(today, -1)
  const to = shiftIsoDate(today, horizonDays)
  if (!from || !to) return null
  const { occurrences } = resolveSeriesOccurrences(series, skips, specialHours, from, to)
  return occurrences.find((occurrence) => new Date(occurrence.endsAt).getTime() > now.getTime()) ?? null
}

/** True when the date falls on the series weekday; a skip on any other day is refused. */
export function isSeriesWeekday(series: Pick<EventSeriesRule, 'weekday'>, isoDate: string): boolean {
  return isValidIsoDate(isoDate) && getIsoWeekday(isoDate) === series.weekday
}

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

/** "Thursday" for ISO weekday 4. */
export function isoWeekdayName(weekday: number): string {
  return WEEKDAY_NAMES[weekday - 1] ?? ''
}

/** "7pm", "7:30pm", "midnight", "midday". */
export function formatSeriesTime(time: string): string {
  const [h, m] = toHhMm(time).split(':').map(Number)
  if (h === 0 && m === 0) return 'midnight'
  if (h === 12 && m === 0) return 'midday'
  const suffix = h < 12 ? 'am' : 'pm'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, '0')}${suffix}`
}

/** "Every Thursday, 7pm to 10pm". The day name is derived from the weekday, never typed. */
export function describeSeriesSchedule(series: Pick<EventSeriesRule, 'weekday' | 'startTime' | 'endTime'>): string {
  return `Every ${isoWeekdayName(series.weekday)}, ${formatSeriesTime(series.startTime)} to ${formatSeriesTime(series.endTime)}`
}

/** One line for a staff screen describing a day: "Ladies Darts Night, 7pm to 10pm". */
export function describeOccurrenceLine(name: string, occurrence: Pick<SeriesOccurrence, 'startTime' | 'endTime'>): string {
  return `${name}, ${formatSeriesTime(occurrence.startTime)} to ${formatSeriesTime(occurrence.endTime)}`
}
