/**
 * Whether a booking start falls inside a table hold, read in London time (BK-211).
 *
 * The hold's columns are London service-local (supabase/migrations/20260801000100_table_holds.sql):
 * starts_on and ends_on are inclusive dates, ends_on null means open ended, day_of_week null means
 * every day (0 = Sunday, as EXTRACT(DOW)), and starts_at to ends_at is the daily window, which
 * crosses midnight when ends_at is not after starts_at.
 */
import { formatTimeInLondon, getIsoWeekday, shiftIsoDate, toLocalIsoDate, whenLondonClockReaches } from '@/lib/dateUtils'

export type HoldWindow = {
  starts_on: string
  ends_on?: string | null
  day_of_week?: number | null
  starts_at?: string | null
  ends_at?: string | null
}

function hhmm(value: string | null | undefined, fallback: string): string {
  return (value ?? fallback).slice(0, 5)
}

/** The instants to read assignments between: London midnight on starts_on, and (when the hold ends)
 * London midnight two days after ends_on, which covers a window crossing midnight. Null upper bound
 * means open ended. */
export function holdSearchBounds(hold: HoldWindow): { fromIso: string | null; beforeIso: string | null } {
  const from = whenLondonClockReaches(hold.starts_on, '00:00')
  const endDay = hold.ends_on ? shiftIsoDate(hold.ends_on, 2) : null
  const before = endDay ? whenLondonClockReaches(endDay, '00:00') : null
  return { fromIso: from?.toISOString() ?? null, beforeIso: before?.toISOString() ?? null }
}

export function holdCoversStart(hold: HoldWindow, startIso: string): boolean {
  const startMs = Date.parse(startIso)
  if (!Number.isFinite(startMs)) return false
  const instant = new Date(startMs)
  const londonDate = toLocalIsoDate(instant)
  const londonTime = formatTimeInLondon(instant)

  const windowStart = hhmm(hold.starts_at, '00:00')
  const windowEnd = hhmm(hold.ends_at, '23:59')
  const crossesMidnight = windowEnd <= windowStart

  let holdDay: string | null = londonDate
  if (crossesMidnight) {
    if (londonTime < windowEnd) holdDay = shiftIsoDate(londonDate, -1)
    else if (londonTime < windowStart) return false
  } else if (londonTime < windowStart || londonTime > windowEnd) {
    return false
  }
  if (!holdDay) return false

  if (holdDay < hold.starts_on) return false
  if (hold.ends_on && holdDay > hold.ends_on) return false

  if (hold.day_of_week !== null && hold.day_of_week !== undefined) {
    const isoWeekday = getIsoWeekday(holdDay)
    if (isoWeekday === null || isoWeekday % 7 !== hold.day_of_week) return false
  }
  return true
}
