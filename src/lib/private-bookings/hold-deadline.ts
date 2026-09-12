import { isValidIsoDate, toLocalIsoDate } from '@/lib/dateUtils'

/**
 * How long a guest has left on a deposit hold, counted the way the guest counts it.
 *
 * The reminders say "expires tomorrow (17 September)" and "expires in 7 days, on 20 September".
 * Those are calendar statements about London days, but they were worked out from elapsed hours and
 * rounded up, so they drifted against the date printed beside them: a hold ending at the close of
 * 17 September was 14 hours away at the 09:00 monitor run ON the 17th, which rounded to 1 and sent
 * "expires tomorrow (17 September)" on the 17th itself (review PB-BR-1).
 *
 * Counting London calendar dates instead makes the words and the date agree: 0 means the hold ends
 * today, 1 means tomorrow, and the reminder windows skip 0 because the expire-holds cron owns the
 * day itself.
 */
export function daysUntilHoldExpiry(holdExpiry: string | Date | null | undefined, now: Date): number | null {
  if (!holdExpiry) return null
  const expiryDate = toLondonIsoDate(holdExpiry)
  if (!expiryDate) return null
  return londonCalendarDaysBetween(toLocalIsoDate(now), expiryDate)
}

/** The London calendar date of an instant, or of a date-only value as written. */
export function toLondonIsoDate(value: string | Date): string | null {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isFinite(parsed.getTime()) ? toLocalIsoDate(parsed) : null
}

/**
 * Whole days from one calendar date to another, anchored in UTC so the count never changes with
 * the host zone or across a clock change.
 */
export function londonCalendarDaysBetween(fromIsoDate: string, toIsoDate: string): number | null {
  if (!isValidIsoDate(fromIsoDate) || !isValidIsoDate(toIsoDate)) return null
  const from = Date.parse(`${fromIsoDate}T00:00:00Z`)
  const to = Date.parse(`${toIsoDate}T00:00:00Z`)
  return Math.round((to - from) / 86400000)
}
