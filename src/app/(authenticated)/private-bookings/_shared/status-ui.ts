/**
 * How private booking statuses and payment states look on staff screens: the DS Badge tone and
 * the words. Pure module, safe to import from server and client components.
 *
 * Before 18 September 2026 the list, the booking page, the calendar and the customer page each
 * coloured a booking their own way: a completed booking was sky blue on the list, a raw blue chip
 * on the calendar and green on the customer page, and a cancelled one red. Render every status
 * chip as
 *   <Badge tone={privateBookingStatusTone(status)} dot>{privateBookingStatusLabel(status)}</Badge>
 * and every payment chip with privateBookingPaymentTone(state), so the same booking looks the
 * same everywhere. Colours follow the table booking map (owner decision D4): confirmed is the
 * brand colour, a draft (a provisional hold waiting for its deposit) is amber like a booking
 * pending payment, finished states (completed, cancelled) are quiet, and only money that is late
 * is red.
 */

export type PrivateBookingBadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

// Maps rather than object literals, so a status such as "constructor" can never resolve to an
// inherited Object property.
const BOOKING_STATUS_TONES = new Map<string, PrivateBookingBadgeTone>([
  // A draft is a hold waiting for its deposit: pending payment in D4 terms.
  ['draft', 'warning'],
  // No live booking is tentative (checked 18 Sep 2026); an old or future one reads as waiting.
  ['tentative', 'warning'],
  ['confirmed', 'primary'],
  // Finished states are quiet (D4), as completed and cancelled table bookings are.
  ['completed', 'neutral'],
  ['cancelled', 'neutral'],
])

const BOOKING_STATUS_LABELS = new Map<string, string>([
  ['draft', 'Draft'],
  ['tentative', 'Tentative'],
  ['confirmed', 'Confirmed'],
  ['completed', 'Completed'],
  ['cancelled', 'Cancelled'],
])

/**
 * Payment states as the screens show them. `deposit_due` is a deposit still owed ("Deposit
 * Required"), `deposit_to_be_confirmed` is one waiting for a manager to confirm it, and
 * `balance_due` is money still owed on the booking.
 */
export type PrivateBookingPaymentState =
  | 'deposit_due'
  | 'deposit_to_be_confirmed'
  | 'deposit_paid'
  | 'balance_due'
  | 'overdue'
  | 'paid_in_full'
  | 'partially_refunded'
  | 'refunded'
  | 'not_required'

const PAYMENT_STATE_TONES = new Map<PrivateBookingPaymentState, PrivateBookingBadgeTone>([
  ['deposit_due', 'warning'],
  ['deposit_to_be_confirmed', 'warning'],
  ['deposit_paid', 'success'],
  ['balance_due', 'warning'],
  ['overdue', 'danger'],
  ['paid_in_full', 'success'],
  ['partially_refunded', 'warning'],
  ['refunded', 'info'],
  ['not_required', 'neutral'],
])

export function privateBookingStatusTone(status: string | null | undefined): PrivateBookingBadgeTone {
  return BOOKING_STATUS_TONES.get(String(status ?? '')) ?? 'neutral'
}

/** Sentence case with spaces. Tolerates a missing status from loosely typed rows. */
export function privateBookingStatusLabel(status: string | null | undefined): string {
  const known = BOOKING_STATUS_LABELS.get(String(status ?? ''))
  if (known) return known
  const words = String(status ?? '').replace(/_/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Unknown'
}

export function privateBookingPaymentTone(state: PrivateBookingPaymentState): PrivateBookingBadgeTone {
  return PAYMENT_STATE_TONES.get(state) ?? 'neutral'
}

// Readable text colours for each tone on a white or soft panel (the -fg shades pass 4.5:1).
const TONE_TEXT_CLASSES: Record<PrivateBookingBadgeTone, string> = {
  neutral: 'text-text-muted',
  primary: 'text-primary',
  success: 'text-success-fg',
  warning: 'text-warning-fg',
  danger: 'text-danger-fg',
  info: 'text-info-fg',
}

/** Text colour for a payment state written as words rather than a badge ("Fully paid"). */
export function privateBookingPaymentTextClass(state: PrivateBookingPaymentState): string {
  return TONE_TEXT_CLASSES[privateBookingPaymentTone(state)]
}

// Full class strings, never built from the tone name: Tailwind only generates classes it can
// read in the source. They match DS Badge's tones, so a calendar pill or legend swatch looks
// like the badge for the same status. Neutral is one step darker than the badge because a
// block sits on a white day cell, where the badge's near-white fill would disappear.
const TONE_PANEL_CLASSES: Record<PrivateBookingBadgeTone, string> = {
  neutral: 'bg-surface-hover text-text-muted border-border-strong',
  primary: 'bg-primary-soft text-primary-soft-fg border-primary/20',
  success: 'bg-success-soft text-success-fg border-success-border',
  warning: 'bg-warning-soft text-warning-fg border-warning-border',
  danger: 'bg-danger-soft text-danger-fg border-danger-border',
  info: 'bg-info-soft text-info-fg border-info-border',
}

/**
 * Background, border and text classes for a booking shown as a block rather than a badge (the
 * calendar's day cells and its legend). Cancelled bookings are also struck through: they share
 * the neutral tone with completed bookings, and a day cell has no room for the word.
 */
export function privateBookingStatusBlockClasses(status: string | null | undefined): string {
  const classes = TONE_PANEL_CLASSES[privateBookingStatusTone(status)]
  return status === 'cancelled' ? `${classes} line-through` : classes
}
