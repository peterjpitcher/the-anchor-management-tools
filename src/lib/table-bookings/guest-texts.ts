/**
 * The words of the table booking texts that go by email first and can come back as a text when
 * the email bounces.
 *
 * Each builder is the one place its text lives. The sender builds the text with it, and the bounce
 * fallback (src/lib/table-bookings/fallback-renderer.ts) rebuilds the same text with it from the
 * booking as it is now, so the two cannot drift apart. The flag-off paths use the same builders,
 * so every route to the guest's phone says the same thing.
 *
 * Pure: no database, no provider and no clock. Dates are formatted in Europe/London whatever zone
 * the server runs in.
 */

import { formatDateWithTimeForSms } from '@/lib/dateUtils'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { buildConfirmReminderMessage } from '@/lib/table-bookings/confirm-reminder'
import { LARGE_GROUP_DEPOSIT_PER_PERSON_GBP } from '@/lib/table-bookings/deposit'

/** The number the reply instruction names, read exactly as the table booking texts always have. */
function supportPhone(): string | undefined {
  return process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
}

/** "Sat 17 Oct, 7:00 pm": a booking's start as the table booking texts show it. */
export function formatLondonDateTime(isoDateTime?: string | null): string {
  if (!isoDateTime) return 'your booking time'

  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h12'
    }).format(new Date(isoDateTime))
  } catch {
    return 'your booking time'
  }
}

export function describeChristmasCourseCounts(counts?: number[] | null): string {
  if (!counts?.length) return ''
  const summary = [1, 2, 3].map(course => {
    const guests = counts.filter(count => count === course).length
    return guests ? `${guests} x ${course} course${course === 1 ? '' : 's'}` : null
  }).filter(Boolean).join(', ')
  return `Christmas courses: ${summary}. One course needs no pre-order.`
}

// ---------------------------------------------------------------------------
// Cancellation (table_booking_cancelled)
// ---------------------------------------------------------------------------

export type TableBookingCancellationRefundResult =
  | { refunded: false; reason: string; depositOwed?: boolean; amountOwedPence?: number }
  | { refunded: true; amountPence: number; tier: string }

function formatGbpFromPence(pence: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100)
}

/**
 * What the cancellation message says about the deposit: the sentence after "has been cancelled."
 * The text and the email both use it, so the amount and the refund timing the guest reads are the
 * same on either channel.
 */
export function describeTableBookingCancellationRefund(refundResult: TableBookingCancellationRefundResult): string {
  if (refundResult.refunded) {
    const amountGbp = formatGbpFromPence(refundResult.amountPence)

    // Name the half tier. Saying only "your £75 refund" to someone who paid £150 reads as a
    // full refund of a £75 deposit, so the one number they can check looks wrong.
    return refundResult.tier === 'half'
      ? `As it's within a week, half the deposit is refundable: your ${amountGbp} refund will land within 5-10 days.`
      : `Your ${amountGbp} refund will land within 5-10 days. Hope to see you again soon!`
  }

  if (refundResult.reason === 'zero_tier') {
    return "As it's within 3 days, the deposit can't be refunded. Hope to see you another time!"
  }

  if (refundResult.reason === 'refund_failed' || refundResult.depositOwed) {
    // Never go quiet about money we still hold. Silence here is what made a failed refund
    // indistinguishable from a booking that never had a deposit.
    const owed = refundResult.amountOwedPence
    return owed
      ? `We couldn't process your ${formatGbpFromPence(owed)} deposit refund automatically, so we'll sort it by hand and be in touch.`
      : "We couldn't process your deposit refund automatically, so we'll sort it by hand and be in touch."
  }

  if (refundResult.reason === 'terms_unreadable') {
    return "We'll check your deposit and be in touch about it shortly."
  }

  return 'Hope to see you again soon!'
}

/** "Sat 14 Mar 2026", as the cancellation text has always shown the date. */
function formatCancellationTextDate(bookingDate: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(`${bookingDate}T12:00:00`))
  } catch {
    // fall back to raw date string
    return bookingDate
  }
}

/** The cancellation text, word for word as it has always read, ready to send. */
export function buildTableBookingCancelledText(input: {
  /** As the text shows it (getSmartFirstName). */
  firstName: string
  /** The booking's London date, YYYY-MM-DD. */
  bookingDate: string
  refundResult: TableBookingCancellationRefundResult
}): string {
  const body = `The Anchor: ${input.firstName}, your booking on ${formatCancellationTextDate(input.bookingDate)} has been cancelled. ${describeTableBookingCancellationRefund(input.refundResult)}`
  return ensureReplyInstruction(body, supportPhone())
}

// ---------------------------------------------------------------------------
// Deposit confirmation (table_booking_deposit_confirmed)
// ---------------------------------------------------------------------------

/** The booking fields the deposit confirmation states. */
export type DepositConfirmedTextBooking = {
  start_datetime: string | null
  party_size: number | null
  is_outside_seating: boolean | null
  high_chair_count: number | null
  christmas_course_counts?: number[] | null
}

/**
 * The deposit-confirmed text, word for word as it has always read, ready to send. `manageLink` is
 * left out when there is none.
 */
export function buildDepositConfirmedText(input: {
  booking: DepositConfirmedTextBooking
  /** As the text shows it (getSmartFirstName). */
  firstName: string
  manageLink: string | null
}): string {
  const partySize = Math.max(1, Number(input.booking.party_size ?? 1))
  const seatWord = partySize === 1 ? 'person' : 'people'
  // Outside bookings hold no indoor table: booking/outside wording and the granted chair count.
  const isOutside = Boolean(input.booking.is_outside_seating)
  const grantedHighChairs = Math.max(0, Number(input.booking.high_chair_count ?? 0))
  const highChairSuffix = grantedHighChairs > 0 ? ` High chair reserved x${grantedHighChairs}.` : ''
  const outsideSuffix = isOutside ? ' Outside seating (weather permitting).' : ''
  const bookingNoun = isOutside ? 'outside booking' : 'table'
  const bookingMoment = formatLondonDateTime(input.booking.start_datetime)
  const christmasCourseSummary = describeChristmasCourseCounts(input.booking.christmas_course_counts)

  const body = `The Anchor: ${input.firstName}! Deposit sorted, your ${bookingNoun} for ${partySize} ${seatWord} on ${bookingMoment} is locked in. See you then!${highChairSuffix}${outsideSuffix}${input.manageLink ? ` ${input.manageLink}` : ''}${christmasCourseSummary ? ` ${christmasCourseSummary}` : ''}`
  return ensureReplyInstruction(body, supportPhone())
}

// ---------------------------------------------------------------------------
// Deposit request after the party grows past the threshold (table_booking_pending_payment)
// ---------------------------------------------------------------------------

export type PartySizeDepositWording = {
  newPartySize: number
  seatWord: string
  depositKindLabel: string
  depositLabel: string
  breakdownNote: string
}

/** The parts of the deposit request both the text and the email say, worded as the text has always said them. */
export function describePartySizeDeposit(input: {
  newPartySize: number
  depositAmount: number
  isChristmas: boolean
  bookingType: string | null
}): PartySizeDepositWording {
  const expectedSimpleTotal = input.newPartySize * LARGE_GROUP_DEPOSIT_PER_PERSON_GBP
  return {
    newPartySize: input.newPartySize,
    seatWord: input.newPartySize === 1 ? 'person' : 'people',
    depositKindLabel: input.isChristmas
      ? 'Christmas deposit'
      : input.bookingType === 'sunday_lunch'
        ? 'Sunday lunch deposit'
        : 'table deposit',
    depositLabel: new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(input.depositAmount),
    breakdownNote: input.depositAmount === expectedSimpleTotal
      ? ` (${input.newPartySize} x GBP ${LARGE_GROUP_DEPOSIT_PER_PERSON_GBP})`
      : '',
  }
}

/** The deposit request text, word for word as it has always read, ready to send. */
export function buildPartySizeDepositText(input: {
  /** As the text shows it (getSmartFirstName). */
  firstName: string
  wording: PartySizeDepositWording
  paymentUrl: string
}): string {
  const { wording } = input
  const body = `The Anchor: Hi ${input.firstName}, your party size has been updated to ${wording.newPartySize} ${wording.seatWord}. A ${wording.depositKindLabel} of ${wording.depositLabel}${wording.breakdownNote} is now required to secure your booking. Pay now: ${input.paymentUrl}`
  return ensureReplyInstruction(body, supportPhone())
}

// ---------------------------------------------------------------------------
// "Are you still coming?" (table_booking_confirm_reminder)
// ---------------------------------------------------------------------------

/** The tap-to-confirm text, ready to send. The words live in buildConfirmReminderMessage. */
export function buildConfirmReminderText(input: {
  /** The customer's first name as stored; the message makes it presentable. */
  firstName: string | null
  /** The booking's London date, YYYY-MM-DD. */
  bookingDate: string
  bookingTime: string | null
  partySize: number | null
  confirmUrl: string
}): string {
  return buildConfirmReminderMessage({
    firstName: input.firstName,
    bookingMoment: formatDateWithTimeForSms(input.bookingDate, input.bookingTime),
    partySize: input.partySize,
    confirmUrl: input.confirmUrl,
  })
}

// ---------------------------------------------------------------------------
// Seasonal pre-order chase (table_booking_preorder_reminder)
// ---------------------------------------------------------------------------

/**
 * The pre-order reminder text, word for word as it has always read. Straight apostrophes and no
 * dashes: one curly character drops the segment limit from 160 to 70.
 */
export function buildPreorderReminderText(input: {
  /** As the text shows it (getSmartFirstName). */
  firstName: string
  /** The booking's London date, YYYY-MM-DD. */
  bookingDate: string
  bookingTime: string | null
  manageLink: string
}): string {
  const bookingMoment = formatDateWithTimeForSms(input.bookingDate, input.bookingTime)
  return (
    `The Anchor: ${input.firstName}, we still need the food choices for your booking on ` +
    `${bookingMoment}. Every guest needs a main course. Choose here: ${input.manageLink}`
  )
}
