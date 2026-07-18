// src/lib/checklists/accountability.ts
// Accountability resolution for the checklists engine (spec section 6).
//
// resolveCloser: the person accountable for a business date. Every missed calendar
//   instance is attributed to this person. Pure time-string math, no timezone maths
//   needed because ordering only compares the rota rows.
// resolveCoverage: context (not blame), which shift in a department covered a due
//   instant, built as London instants for the business date.
//
// Both consume the canonical published-shift filter (spec section 6):
//   status === 'scheduled', isOpenShift === false, employeeId != null.
import { fromZonedTime } from 'date-fns-tz'
import type { ShiftRow } from './types'

const LONDON_TIMEZONE = 'Europe/London'

/** 'HH:MM' or 'HH:MM:SS' to 'HH:MM'. */
function normTime(t: string): string {
  return t.slice(0, 5)
}

/** Minutes since 00:00 for a normalised 'HH:MM'. */
function toMinutes(hhmm: string): number {
  const [h, m] = normTime(hhmm).split(':')
  return Number(h) * 60 + Number(m)
}

/** A finish at or before the start means the shift ends on the next calendar day (spec 5.3). */
function isNextDay(sh: ShiftRow): boolean {
  return toMinutes(sh.endTime) <= toMinutes(sh.startTime)
}

/** Canonical published-shift filter (spec 6): scheduled, not an open shift, has an employee. */
function isCountable(sh: ShiftRow): sh is ShiftRow & { employeeId: string } {
  return sh.status === 'scheduled' && sh.isOpenShift === false && sh.employeeId != null
}

/**
 * The closer for a business date (spec 6). Ordering, most-significant first:
 *   1. next-day finishes are latest (a 00:00 close beats any same-day end)
 *   2. later end time
 *   3. bar shifts preferred (a preference, never a filter, so a non-bar can close)
 *   4. earlier start (the all-day shift over a late arrival)
 *   5. employeeId, so the result is deterministic when everything else ties
 * Returns the top row's employeeId, or null when nobody qualifies (never invent a closer).
 */
export function resolveCloser(shifts: ShiftRow[]): string | null {
  const countable = shifts.filter(isCountable)
  if (countable.length === 0) return null

  const sorted = [...countable].sort((a, b) => {
    const aNext = isNextDay(a) ? 1 : 0
    const bNext = isNextDay(b) ? 1 : 0
    if (aNext !== bNext) return bNext - aNext // next-day finishes first

    const aEnd = toMinutes(a.endTime)
    const bEnd = toMinutes(b.endTime)
    if (aEnd !== bEnd) return bEnd - aEnd // later end first

    const aBar = a.department === 'bar' ? 1 : 0
    const bBar = b.department === 'bar' ? 1 : 0
    if (aBar !== bBar) return bBar - aBar // bar preference

    const aStart = toMinutes(a.startTime)
    const bStart = toMinutes(b.startTime)
    if (aStart !== bStart) return aStart - bStart // earlier start first

    return a.employeeId.localeCompare(b.employeeId) // stable tiebreak
  })

  return sorted[0].employeeId
}

/** Advance a 'YYYY-MM-DD' string by one calendar day (date-only, DST-safe). */
function addOneDay(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * The covering shift's employee for a due instant (spec 6 coverage, context not blame).
 * Among countable shifts in `department` whose shift_date equals `businessDate` and whose
 * [startAt, endAt] London interval contains `dueAt` inclusively, returns the employeeId of
 * the one finishing latest (employeeId break for determinism), or null when none cover it.
 */
export function resolveCoverage(
  shifts: ShiftRow[],
  dueAt: Date,
  businessDate: string,
  department: string
): string | null {
  const due = dueAt.getTime()

  const covering = shifts
    .filter(
      (sh): sh is ShiftRow & { employeeId: string } =>
        isCountable(sh) && sh.department === department && sh.shiftDate === businessDate
    )
    .map((sh) => {
      const startAt = fromZonedTime(`${businessDate}T${normTime(sh.startTime)}:00`, LONDON_TIMEZONE)
      const endDate = isNextDay(sh) ? addOneDay(businessDate) : businessDate
      const endAt = fromZonedTime(`${endDate}T${normTime(sh.endTime)}:00`, LONDON_TIMEZONE)
      return { employeeId: sh.employeeId, start: startAt.getTime(), end: endAt.getTime() }
    })
    .filter((c) => c.start <= due && due <= c.end)

  if (covering.length === 0) return null

  covering.sort((a, b) => b.end - a.end || a.employeeId.localeCompare(b.employeeId))
  return covering[0].employeeId
}
