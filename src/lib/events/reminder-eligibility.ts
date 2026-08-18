const ONE_DAY_MS = 24 * 60 * 60 * 1000
const MIN_CONFIRMATION_TO_REMINDER_GAP_MS = ONE_DAY_MS

type ReminderWindowInput = {
  bookingCreatedAt: string
  eventStartAt: string
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
