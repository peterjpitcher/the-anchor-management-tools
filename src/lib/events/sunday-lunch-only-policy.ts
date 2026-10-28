import { getMotheringSunday, toLocalIsoDate } from '@/lib/dateUtils'

export type SundayLunchOnlyEventInput = {
  id?: string | null
  name?: string | null
  date?: string | null
  start_datetime?: string | null
}

/**
 * Mother's Day is sold as Sunday lunch table bookings, not event places, so diners sit inside
 * kitchen pacing and one system holds them. Owner decision D35 (BK-153): the date is worked out
 * each year (Mothering Sunday, the fourth Sunday of Lent), matching the website's
 * lib/mothers-day-booking.ts, instead of a hard-coded 15 March 2026.
 */
const SUNDAY_LUNCH_ONLY_NAME_PATTERNS = [
  /\bmother['’]?s day\b/i,
  /\bmothering sunday\b/i
]

export const SUNDAY_LUNCH_ONLY_EVENT_MESSAGE =
  "Mother's Day is booked as a Sunday lunch table booking, not as an event. Please book a table for that day instead."

/** The event's London calendar date, YYYY-MM-DD. */
function toLondonIsoDate(value?: string | null): string | null {
  if (!value) {
    return null
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value
  }

  const parsedMs = Date.parse(value)
  if (!Number.isFinite(parsedMs)) {
    return null
  }

  return toLocalIsoDate(new Date(parsedMs))
}

export function isMotheringSundayDate(isoDate: string): boolean {
  const year = Number(isoDate.slice(0, 4))
  return Number.isInteger(year) && getMotheringSunday(year) === isoDate
}

export function isSundayLunchOnlyEvent(input: SundayLunchOnlyEventInput): boolean {
  const eventDate = toLondonIsoDate(input.date) || toLondonIsoDate(input.start_datetime)
  if (!eventDate || !isMotheringSundayDate(eventDate)) {
    return false
  }

  const eventName = (input.name || '').trim()
  if (!eventName) {
    return false
  }

  return SUNDAY_LUNCH_ONLY_NAME_PATTERNS.some((pattern) => pattern.test(eventName))
}
