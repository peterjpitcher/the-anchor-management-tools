// src/lib/checklists/window.ts
// London-zoned window-instant helpers for the checklists engine (spec 5.3).
// Converts a business date plus wall-clock open/close strings into UTC instants,
// handling BST/GMT and cross-midnight windows. All zoning goes through
// date-fns-tz `fromZonedTime` against Europe/London so DST is always correct.

import { addDays, format, parseISO } from 'date-fns'
import { fromZonedTime } from 'date-fns-tz'
import type { WindowInstants } from '@/lib/checklists/types'

const TZ = 'Europe/London'
const DEFAULT_BUSINESS_DAY_START_HOUR = 6

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
 * Expand a trading window into UTC instants (spec 5.3). When `closes <= opens`
 * (string compare on HH:MM) the close falls on the next calendar day. A close
 * at or past the business-day end is rejected as `invalid_hours`.
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
  if (closesAt.getTime() >= end.getTime()) {
    return { error: 'invalid_hours' }
  }

  return { opensAt, closesAt }
}
