/**
 * Whether a private booking text still waiting in the approval queue is past its date (BK-064,
 * customer bookings review of 24 October 2026).
 *
 * Texts that waited for an approval nobody gave sat in the queue for weeks: approving one late
 * would have told a guest their balance was "due tomorrow" after the date had gone, or reminded
 * them about an event that had already happened. A text is out of date when:
 * - a balance reminder's deadline (metadata.balance_due_date) has passed;
 * - a deposit reminder's hold date (metadata.hold_expiry_date) has passed;
 * - a balance, deposit, event-day or setup reminder is for an event that has already happened;
 * - the booking has been cancelled, for anything other than the cancellation or expiry notice.
 *
 * An unknown date never makes a text stale, so a row with no metadata is left for staff to judge.
 * Kept free of imports so the queue service and the daily sweep read the one rule.
 */

export type QueuedTextForStaleness = {
  trigger_type?: string | null
  metadata?: Record<string, unknown> | null
}

export type BookingForStaleness = {
  status?: string | null
  event_date?: string | null
} | null

export type QueuedTextStaleReason =
  | 'deadline_passed'
  | 'hold_date_passed'
  | 'event_passed'
  | 'booking_cancelled'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isoDateOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const date = value.slice(0, 10)
  return ISO_DATE.test(date) ? date : null
}

const EVENT_BOUND_PREFIXES = ['balance_reminder_', 'deposit_reminder_']
const EVENT_BOUND_TRIGGERS = new Set(['event_reminder_1d', 'setup_reminder'])

/** Null while the text may still go; otherwise why it must not. `todayIso` is the London date. */
export function queuedPrivateBookingTextStaleReason(
  row: QueuedTextForStaleness,
  booking: BookingForStaleness,
  todayIso: string,
): QueuedTextStaleReason | null {
  const trigger = row.trigger_type ?? ''
  const metadata = row.metadata ?? {}

  if (booking?.status === 'cancelled' && !trigger.startsWith('booking_cancelled') && trigger !== 'booking_expired') {
    return 'booking_cancelled'
  }

  if (trigger.startsWith('balance_reminder_')) {
    const due = isoDateOf(metadata.balance_due_date)
    if (due && due < todayIso) return 'deadline_passed'
  }

  if (trigger.startsWith('deposit_reminder_')) {
    const hold = isoDateOf(metadata.hold_expiry_date)
    if (hold && hold < todayIso) return 'hold_date_passed'
  }

  const eventBound = EVENT_BOUND_TRIGGERS.has(trigger) || EVENT_BOUND_PREFIXES.some((prefix) => trigger.startsWith(prefix))
  if (eventBound) {
    const event = isoDateOf(booking?.event_date)
    if (event && event < todayIso) return 'event_passed'
  }

  return null
}

export const STALE_QUEUED_TEXT_REFUSAL =
  'This message is out of date: its date has passed, so it will not be sent. Reject it to clear it from the queue.'
