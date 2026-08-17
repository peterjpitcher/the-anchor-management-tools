/**
 * Shared date and hours maths for the rota hours report.
 *
 * The screen at /rota/hours and the PDF at /api/rota/hours/pdf each carried their own
 * copy of these ten functions. Every copy was byte-identical, so the two agreed today,
 * but they are the arithmetic behind hours the pub pays against: if someone had fixed
 * a rounding or overnight-shift bug on the screen and missed the PDF, the printed
 * sheet and the screen would have quietly disagreed about how long people worked.
 *
 * Kept free of React and of request handling so both callers can use it unchanged.
 */

import { calculatePaidHours } from '@/lib/rota/pay-calculator'

/** The clock-in/out pair a worked session is measured from. */
export type HoursSession = {
  clock_in_at: string
  clock_out_at: string | null
}

/** The scheduled shift a planned figure is measured from. */
export type HoursPlannedShift = {
  start_time: string
  end_time: string
  unpaid_break_minutes: number
  is_overnight: boolean
}

export function isIsoDate(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))
}

export function toIsoDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

export function addDaysIso(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return toIsoDate(date)
}

export function addWeeksIso(isoDate: string, weeks: number): string {
  return addDaysIso(isoDate, weeks * 7)
}

/**
 * UTC arithmetic throughout, deliberately. These are whole calendar dates rather than
 * instants, so doing the maths in UTC keeps the result independent of the server's
 * timezone and of British Summer Time changeovers.
 */
export function mondayOfWeekIso(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  const day = date.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setUTCDate(date.getUTCDate() + diff)
  return toIsoDate(date)
}

export function weekLabel(weekStart: string): string {
  return new Date(`${weekStart}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  })
}

/** Hours actually worked. A session still clocked in counts as zero, not as running. */
export function actualHours(session: HoursSession): number {
  if (!session.clock_out_at) return 0
  const diffMs = new Date(session.clock_out_at).getTime() - new Date(session.clock_in_at).getTime()
  return Math.max(0, diffMs / 3_600_000)
}

export function roundHours(value: number): number {
  return Math.round(value * 10) / 10
}

export function plannedShiftHours(shift: HoursPlannedShift): number {
  return calculatePaidHours(
    shift.start_time,
    shift.end_time,
    shift.unpaid_break_minutes,
    shift.is_overnight,
  )
}

export function generateWeeks(fromDate: string, toDate: string): string[] {
  const start = mondayOfWeekIso(fromDate)
  const end = mondayOfWeekIso(toDate)
  const weeks: string[] = []
  for (let current = start; current <= end; current = addWeeksIso(current, 1)) {
    weeks.push(current)
  }
  return weeks
}
