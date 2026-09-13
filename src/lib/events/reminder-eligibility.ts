import { shiftIsoDate, toLocalIsoDate } from '@/lib/dateUtils'
import { evaluateSmsQuietHours } from '@/lib/sms/quiet-hours'

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const MIN_CONFIRMATION_TO_REMINDER_GAP_MS = ONE_DAY_MS

type ReminderWindowInput = {
  bookingCreatedAt: string
  eventStartAt: string
}

/** The day the one-day reminder names, as seen on the London day the guest reads it. */
export type EventReminderDay = 'tomorrow' | 'today'

/**
 * Whether a one-day reminder sent now reaches the guest on the London day before the event
 * ('tomorrow') or on the event day itself ('today'), or null when it would only reach them
 * after the event has started.
 *
 * A text lands when it is sent, or at 09:00 when quiet hours (21:00 to 09:00 London) hold it.
 * The reminder falls due 24 hours before the start and the cron runs every 15 minutes, so for
 * anything starting after 20:45 it is first sent in quiet hours and lands at 09:00 on the event
 * day, where it used to say "is tomorrow". On Sunday 25 October 2026 it is anything starting
 * after 19:45, because the clocks go back overnight and 24 hours before is an hour later on the
 * Saturday.
 */
export function resolveEventReminderDay({
  eventStartAt,
  now = new Date(),
}: {
  eventStartAt: string
  now?: Date
}): EventReminderDay | null {
  const eventStartMs = Date.parse(eventStartAt)
  if (!Number.isFinite(eventStartMs)) return null

  const quietHours = evaluateSmsQuietHours(now)
  const landsAt = quietHours.inQuietHours ? quietHours.nextAllowedSendAt : now
  if (eventStartMs <= landsAt.getTime()) return null

  const landingDate = toLocalIsoDate(landsAt)
  const eventDate = toLocalIsoDate(new Date(eventStartMs))
  if (landingDate === eventDate) return 'today'
  if (shiftIsoDate(landingDate, 1) === eventDate) return 'tomorrow'
  // Two or more days ahead is not a one-day reminder; the cron's due check never gets here.
  return null
}

/**
 * Only send the one-day reminder when the booking confirmation will be at
 * least a day old. Later bookings already have a fresh confirmation containing
 * the event date and time, so the reminder would be a near-duplicate.
 */
export function shouldSuppressEventReminderForLateBooking({
  bookingCreatedAt,
  eventStartAt,
}: ReminderWindowInput): boolean {
  const bookingCreatedMs = Date.parse(bookingCreatedAt)
  const eventStartMs = Date.parse(eventStartAt)

  if (!Number.isFinite(bookingCreatedMs) || !Number.isFinite(eventStartMs)) {
    return false
  }

  const reminderDueMs = eventStartMs - ONE_DAY_MS
  return bookingCreatedMs > reminderDueMs - MIN_CONFIRMATION_TO_REMINDER_GAP_MS
}
