import { getIsoWeekday, getTodayIsoDate, londonVisitAtIso, shiftIsoDate } from '@/lib/dateUtils'

/**
 * The dates one month of the venue calendar covers.
 *
 * The month grid starts on the Monday on or before the 1st and ends on the Sunday on or after
 * the last day, so a month view shows the tail of the month before and the head of the month
 * after. The window covers the whole grid, so those spill-over days are never drawn empty.
 * Pure calendar-date arithmetic on London dates: nothing here depends on the host's zone.
 */
export interface CalendarMonthWindow {
  /** YYYY-MM */
  month: string
  /** First date on the grid, YYYY-MM-DD (a Monday). */
  startIso: string
  /** Last date on the grid, YYYY-MM-DD (a Sunday). */
  endIso: string
  /** Midnight London time at the start of startIso, as an ISO instant. */
  startInstant: string
  /** Midnight London time at the end of endIso (the start of the next day), as an ISO instant. */
  endInstant: string
}

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/

/** Earliest and latest year the calendar will page to. Nothing in the app predates 2024. */
export const CALENDAR_FIRST_YEAR = 2024
export const CALENDAR_YEARS_AHEAD = 2

export function isCalendarMonth(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = value.match(MONTH_PATTERN)
  if (!match) return false
  const year = Number(match[1])
  return year >= CALENDAR_FIRST_YEAR && year <= Number(getTodayIsoDate().slice(0, 4)) + CALENDAR_YEARS_AHEAD
}

/** This London month, YYYY-MM. */
export function currentCalendarMonth(): string {
  return getTodayIsoDate().slice(0, 7)
}

function lastDayOfMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return `${month}-${String(days).padStart(2, '0')}`
}

/** The grid window for a YYYY-MM month, or null when the month is not one the calendar pages to. */
export function calendarMonthWindow(month: string): CalendarMonthWindow | null {
  if (!isCalendarMonth(month)) return null
  const first = `${month}-01`
  const last = lastDayOfMonth(month)
  const firstWeekday = getIsoWeekday(first)
  const lastWeekday = getIsoWeekday(last)
  if (firstWeekday === null || lastWeekday === null) return null

  const startIso = shiftIsoDate(first, -(firstWeekday - 1))
  const endIso = shiftIsoDate(last, 7 - lastWeekday)
  const dayAfterEnd = endIso ? shiftIsoDate(endIso, 1) : null
  if (!startIso || !endIso || !dayAfterEnd) return null

  const startInstant = londonVisitAtIso(startIso, '00:00')
  const endInstant = londonVisitAtIso(dayAfterEnd, '00:00')
  if (!startInstant || !endInstant) return null

  return { month, startIso, endIso, startInstant, endInstant }
}
