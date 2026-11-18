import { addMonthsToIsoDate, getTodayIsoDate, isValidIsoDate, londonVisitAtIso, shiftIsoDate } from '@/lib/dateUtils'

/**
 * The trimmed event row the events calendar renders.
 *
 * Only what `toCalendarEvent` in EventsClient reads: no capacity snapshot and no
 * link clicks, which the calendar never shows. `booked_count` is the same
 * `totalSeats` figure `getEvents` reports, built from the embedded bookings.
 */
export interface CalendarEventRow {
  id: string
  name: string
  date: string
  time: string
  event_status: string | null
  hero_image_url: string | null
  poster_image_url: string | null
  thumbnail_image_url: string | null
  brief: string | null
  short_description: string | null
  long_description: string | null
  booked_count: number
}

export interface CalendarEventsWindow {
  dateFrom: string
  dateTo: string
}

/** Months either side of today the events calendar loads. */
export const CALENDAR_EVENTS_MONTHS_BACK = 12
export const CALENDAR_EVENTS_MONTHS_AHEAD = 12

function firstOfMonth(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`
}

/**
 * The window of event dates the calendar loads, on London dates.
 *
 * The calendar keeps its month in the URL and has no month-change callback, so
 * it cannot ask for another window when someone pages past the loaded one. The
 * window is therefore wide: from the first day of the month twelve months ago
 * to the last day of the month twelve months ahead.
 */
export function defaultCalendarEventsWindow(todayIso: string = getTodayIsoDate()): CalendarEventsWindow {
  const dateFrom = firstOfMonth(addMonthsToIsoDate(todayIso, -CALENDAR_EVENTS_MONTHS_BACK))
  const firstAfterWindow = firstOfMonth(addMonthsToIsoDate(todayIso, CALENDAR_EVENTS_MONTHS_AHEAD + 1))
  const dateTo = shiftIsoDate(firstAfterWindow, -1) ?? firstAfterWindow
  return { dateFrom, dateTo }
}

/** A caller's window, with anything missing or malformed replaced by the default. */
export function resolveCalendarEventsWindow(
  options?: Partial<CalendarEventsWindow>,
  todayIso: string = getTodayIsoDate(),
): CalendarEventsWindow {
  const fallback = defaultCalendarEventsWindow(todayIso)
  const dateFrom = options?.dateFrom && isValidIsoDate(options.dateFrom) ? options.dateFrom : fallback.dateFrom
  const dateTo = options?.dateTo && isValidIsoDate(options.dateTo) ? options.dateTo : fallback.dateTo
  return { dateFrom, dateTo }
}

/**
 * The earliest parking arrival the events calendar loads: midnight London time
 * on the first day of last month, as an ISO instant. Replaces "the newest 500 of
 * all time", which grows without limit and says nothing about what is on screen.
 */
export function calendarParkingStartFrom(todayIso: string = getTodayIsoDate()): string {
  const firstOfLastMonth = firstOfMonth(addMonthsToIsoDate(todayIso, -1))
  return londonVisitAtIso(firstOfLastMonth, '00:00') ?? `${firstOfLastMonth}T00:00:00Z`
}
