export type SundayLunchOnlyEventInput = {
  id?: string | null
  name?: string | null
  date?: string | null
  start_datetime?: string | null
}

// Mother's Day 2026: bookings must run through Sunday Lunch with pre-order.
const SUNDAY_LUNCH_ONLY_DATES = new Set([
  '2026-03-15'
])

const SUNDAY_LUNCH_ONLY_NAME_PATTERNS = [
  /\bmother['’]?s day\b/i
]

export const SUNDAY_LUNCH_ONLY_EVENT_MESSAGE =
  "Mother's Day bookings are handled as Sunday lunch bookings with pre-order. Please use the Sunday lunch booking flow."

function toIsoDate(value?: string | null): string | null {
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

  return new Date(parsedMs).toISOString().slice(0, 10)
}

export function isSundayLunchOnlyEvent(input: SundayLunchOnlyEventInput): boolean {
  const eventDate = toIsoDate(input.date) || toIsoDate(input.start_datetime)
  if (!eventDate || !SUNDAY_LUNCH_ONLY_DATES.has(eventDate)) {
    return false
  }

  const eventName = (input.name || '').trim()
  if (!eventName) {
    return false
  }

  return SUNDAY_LUNCH_ONLY_NAME_PATTERNS.some((pattern) => pattern.test(eventName))
}
