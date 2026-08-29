// src/lib/checklists/window.ts
// London-zoned window-instant helpers for the checklists engine (spec 5.3).
// Converts a business date plus wall-clock open/close strings into UTC instants,
// handling BST/GMT and cross-midnight windows. All zoning goes through
// date-fns-tz `fromZonedTime` against Europe/London so DST is always correct.

import { addDays, format, parseISO } from 'date-fns'
import { fromZonedTime } from 'date-fns-tz'
import type { WindowInstants } from '@/lib/checklists/types'

const TZ = 'Europe/London'
// Fallback only: the real value lives in checklist_settings.business_day_start_hour.
// Kept aligned with CLOSING_GRACE_END_HOUR below so a settings read failure cannot
// reintroduce the dead hour between closing grace ending and the day flipping.
const DEFAULT_BUSINESS_DAY_START_HOUR = 5

/** Trim an 'HH:MM' or 'HH:MM:SS' string down to 'HH:MM'. */
function normaliseTime(value: string): string {
  return value.slice(0, 5)
}

/** Zero-pad an hour (0-23) to a two-digit string. */
function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** Shift a 'YYYY-MM-DD' string by a whole number of calendar days. */
function addCalendarDays(businessDate: string, days: number): string {
  return format(addDays(parseISO(businessDate), days), 'yyyy-MM-dd')
}

/**
 * The London business day runs from `startHour` on `businessDate` to the same
 * wall-clock hour on the next calendar day. Adding the day at the calendar level
 * (not on the instant) keeps the bound DST-correct across clock changes.
 */
export function businessDayBounds(
  businessDate: string,
  startHour: number = DEFAULT_BUSINESS_DAY_START_HOUR,
): { start: Date; end: Date } {
  const startTime = `${pad2(startHour)}:00:00`
  const start = fromZonedTime(`${businessDate}T${startTime}`, TZ)
  const end = fromZonedTime(`${addCalendarDays(businessDate, 1)}T${startTime}`, TZ)
  return { start, end }
}

/**
 * Closing tasks stay completable until this hour the following morning.
 *
 * The default grace (60 minutes) put the cutoff an hour after close, so a
 * 22:00 close expired at 23:00 and a night that ran late lost its closing
 * checks to `missed` while staff were still locking up.
 *
 * This now matches the business-day boundary rather than sitting an hour before
 * it. When the boundary was 06:00 there was a dead hour from 05:00, where the
 * night's closing tasks were locked but the new day's were not yet shown.
 */
export const CLOSING_GRACE_END_HOUR = 5

/** The instant closing tasks stop being completable: 05:00 London, next day. */
export function closingGraceEnd(
  businessDate: string,
  hour: number = CLOSING_GRACE_END_HOUR,
): Date {
  return fromZonedTime(`${addCalendarDays(businessDate, 1)}T${pad2(hour)}:00:00`, TZ)
}

/**
 * Expand a trading window into UTC instants (spec 5.3). When `closes <= opens`
 * (string compare on HH:MM) the close falls on the next calendar day. A close
 * strictly past the business-day end is rejected as `invalid_hours`; a close
 * landing exactly on the boundary (e.g. 06:00 next day) is valid (spec 5.3).
 */
export function expandInstants(
  businessDate: string,
  opens: string,
  closes: string,
  businessDayStartHour: number = DEFAULT_BUSINESS_DAY_START_HOUR,
): WindowInstants | { error: 'invalid_hours' } {
  const opensNorm = normaliseTime(opens)
  const closesNorm = normaliseTime(closes)

  const opensAt = fromZonedTime(`${businessDate}T${opensNorm}:00`, TZ)

  const closeDate = closesNorm <= opensNorm ? addCalendarDays(businessDate, 1) : businessDate
  const closesAt = fromZonedTime(`${closeDate}T${closesNorm}:00`, TZ)

  const { end } = businessDayBounds(businessDate, businessDayStartHour)
  if (closesAt.getTime() > end.getTime()) {
    return { error: 'invalid_hours' }
  }

  return { opensAt, closesAt }
}

/**
 * How long before close the FOH pop-up starts nudging about the closing checklist.
 *
 * Deliberately shorter than `close_lead_minutes` (60), which is when the tasks become
 * visible and tickable on the checklist screen. Staff can get ahead an hour out if they
 * want to; the pop-up only interrupts service at the half-hour mark.
 */
export const CLOSE_PROMPT_LEAD_MINUTES = 30

/**
 * Has this task's window opened? The staff screen shows only tasks that answer yes.
 *
 * Compares parsed instants, never the raw strings. PostgREST renders timestamptz with
 * whatever offset the connection uses ('...+00:00') while `toISOString()` produces
 * '...Z'; a lexical compare of the two is only accidentally correct while that offset
 * happens to be zero, and silently wrong the moment it is not. The SQL filter this
 * replaced had no such problem, because Postgres parsed both sides.
 *
 * `window_start` is NOT NULL in the database, but a missing or unparseable value is
 * treated as not-yet-due rather than due, matching the old `.lte('window_start', now)`:
 * a SQL comparison against NULL is false, so such a row was excluded.
 */
export function isDueNow(windowStart: string | null | undefined, now: Date): boolean {
  if (!windowStart) return false
  const at = Date.parse(windowStart)
  if (!Number.isFinite(at)) return false
  return at <= now.getTime()
}

/**
 * The earliest window that has not opened yet, or null when everything is already due.
 *
 * This is what lets the screen arm a single timer for the moment its content changes
 * instead of polling. Past, missing and unparseable values are ignored. The returned
 * string is the original input, so the caller hands the client exactly what the
 * database gave it.
 */
export function earliestFutureWindow(
  windowStarts: (string | null | undefined)[],
  now: Date,
): string | null {
  let earliest: string | null = null
  let earliestAt = Infinity
  for (const start of windowStarts) {
    if (!start) continue
    const at = Date.parse(start)
    if (!Number.isFinite(at) || at <= now.getTime()) continue
    if (at < earliestAt) {
      earliestAt = at
      earliest = start
    }
  }
  return earliest
}
