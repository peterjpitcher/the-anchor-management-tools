import { formatDateInLondon, parseLondonDateTimeLocal, toLocalIsoDate } from '@/lib/dateUtils'
import { isBookingDateTbd } from '@/lib/private-bookings/tbd-detection'
import {
  balanceReminder15DayMessage,
  balanceReminder16DayMessage,
  balanceReminder21DayMessage,
  balanceReminderDueMessage,
  balanceDueDateChangedMessage,
  bookingCancelledHoldMessage,
  bookingCancelledManualReviewMessage,
  bookingCancelledPartialRefundMessage,
  bookingCancelledRefundableMessage,
  bookingCancelledRetentionMessage,
  bookingCancelledReviewPendingMessage,
  bookingCompletedThanksMessage,
  bookingConfirmedMessage,
  bookingExpiredMessage,
  dateChangedMessage,
  depositReceivedMessage,
  depositReminder1DayMessage,
  depositReminder3DayMessage,
  depositReminder7DayMessage,
  eventReminder1DayMessage,
  finalPaymentMessage,
  holdExtendedMessage,
  privateBookingCreatedMessage,
  reviewRequestMessage,
  setupReminderMessage,
} from '@/lib/private-bookings/messages'
import {
  buildBalanceReminderEmail,
  buildCancellationEmail,
  buildDepositReminderEmail,
  type PrivateBookingCancellationVariant,
  type PrivateBookingEmailContent,
} from '@/lib/email/private-booking-emails'
import type { FallbackBookingFacts } from '@/lib/notifications/delayed-fallback/types'

/**
 * Rebuilds a private booking message from the booking as it is now.
 *
 * Two users, both of which must reproduce a message rather than compose a new one:
 * - the bounce fallback (P4), which texts the guest the message their email carried;
 * - Send Now for an approved queued text, which may send the email version instead (P6), but only
 *   when rebuilding the text from the booking gives exactly the text staff approved.
 *
 * Each entry builds the text with the same builder, the same inputs and the same date format as
 * the code that first sends it (mutations.ts, payments.ts, the monitor cron, the expire-holds
 * cron). Only the approval-gated messages carry an email version here; the automated paths build
 * theirs at the call site from the values they already have.
 */

/** The private_bookings columns the catalogue reads. */
export const PRIVATE_BOOKING_MESSAGE_COLUMNS =
  'id, status, customer_id, customer_first_name, customer_last_name, customer_name, contact_phone, contact_email, event_type, event_date, start_time, end_time, end_time_next_day, guest_count, date_tbd, internal_notes, hold_expiry, deposit_amount, deposit_paid_date, deposit_waived, balance_due_date, final_payment_date, setup_date, setup_time'

export type CatalogueBooking = {
  id: string
  status: string | null
  customer_id: string | null
  customer_first_name: string | null
  customer_last_name?: string | null
  customer_name: string | null
  contact_phone: string | null
  contact_email: string | null
  event_type: string | null
  event_date: string | null
  start_time: string | null
  end_time: string | null
  end_time_next_day: boolean | null
  guest_count: number | null
  date_tbd: boolean | null
  internal_notes: string | null
  hold_expiry: string | null
  deposit_amount: number | string | null
  deposit_paid_date: string | null
  deposit_waived: boolean | null
  balance_due_date: string | null
  final_payment_date: string | null
  setup_date: string | null
  setup_time: string | null
}

export type CancellationAmounts = {
  refundAmount: number
  retainedAmount: number
  deductionAmount: number
  retentionReason?: string | null
}

export type CatalogueContext = {
  booking: CatalogueBooking
  now: Date
  /** What is still owed (private_bookings_with_details.balance_remaining), for the balance reminders. */
  balanceAmount?: number | null
  reviewLink?: string | null
  cancellation?: CancellationAmounts | null
  /** The facts stored when the message first went, for the parts a later rebuild cannot infer. */
  storedFacts?: Record<string, unknown> | null
}

export type CatalogueMessage = {
  templateKey: string
  triggerType: string
  smsBody: string
  /** The email version, for the messages that wait for approval. */
  email: (() => PrivateBookingEmailContent) | null
  facts: FallbackBookingFacts
  expectCancelled: boolean
  expectPast: boolean
}

const CANCELLATION_TEMPLATES: Record<string, PrivateBookingCancellationVariant> = {
  booking_cancelled_hold: 'private_booking_cancelled_hold',
  booking_cancelled_refundable: 'private_booking_cancelled_refundable',
  booking_cancelled_partial_refund: 'private_booking_cancelled_partial_refund',
  booking_cancelled_retention: 'private_booking_cancelled_retention',
  booking_cancelled_review_pending: 'private_booking_cancelled_review_pending',
  booking_cancelled_manual_review: 'private_booking_cancelled_manual_review',
}

function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** The date format every private booking text uses: "3 October 2026", London. */
export function formatPrivateBookingSmsDate(value: string | Date | null | undefined): string {
  if (!value) return ''
  return formatDateInLondon(value, { day: 'numeric', month: 'long', year: 'numeric' })
}

function smsEventDateTbdAware(booking: CatalogueBooking): string {
  return isBookingDateTbd(booking) ? 'Date to be confirmed' : formatPrivateBookingSmsDate(booking.event_date)
}

function firstNameChain(booking: CatalogueBooking): string {
  return booking.customer_first_name || booking.customer_name?.split(' ')[0] || 'there'
}

/** A calendar date stays as written; a timestamp becomes its London date. */
function isoDate(value: string | null | undefined): string | null {
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : toLocalIsoDate(parsed)
}

/**
 * The facts a private booking message states, as comparable values: dates as YYYY-MM-DD in London,
 * amounts as numbers. Call sites store these with the email; the bounce fallback compares them
 * with the booking as it is now and sends nothing if any differ.
 */
export function buildPrivateBookingMessageFacts(
  triggerType: string,
  booking: Partial<CatalogueBooking>,
  extras: { balanceAmount?: number | null; cancellation?: CancellationAmounts | null; includeBalanceDueDate?: boolean } = {}
): FallbackBookingFacts {
  const facts: FallbackBookingFacts = { event_date: isoDate(booking.event_date) }
  if (triggerType === 'booking_created' || triggerType.startsWith('deposit_reminder_') || triggerType === 'hold_extended') {
    facts.hold_expiry_date = isoDate(booking.hold_expiry)
  }
  if (triggerType === 'booking_created' || triggerType.startsWith('deposit_reminder_')) {
    facts.deposit_amount = toNumber(booking.deposit_amount)
  }
  if (triggerType === 'balance_due_date_changed' || triggerType.startsWith('balance_reminder_')) {
    facts.balance_due_date = isoDate(booking.balance_due_date)
  }
  if (triggerType === 'date_changed') {
    facts.balance_due_date = extras.includeBalanceDueDate ? isoDate(booking.balance_due_date) : null
  }
  if (triggerType.startsWith('balance_reminder_')) {
    facts.balance_amount = extras.balanceAmount ?? null
  }
  if (triggerType === 'setup_reminder') {
    facts.setup_date = isoDate(booking.setup_date)
    facts.setup_time = booking.setup_time ? booking.setup_time.slice(0, 5) : null
  }
  if (triggerType === 'event_reminder_1d') {
    facts.guest_count = booking.guest_count ?? null
  }
  if (triggerType in CANCELLATION_TEMPLATES && extras.cancellation) {
    facts.refund_amount = extras.cancellation.refundAmount
    facts.retained_amount = extras.cancellation.retainedAmount
    facts.deduction_amount = extras.cancellation.deductionAmount
  }
  return facts
}

/** When the booking starts, as an ISO instant, or null while its date is to be confirmed. */
export function privateBookingStartsAt(booking: Pick<CatalogueBooking, 'event_date' | 'start_time' | 'date_tbd' | 'internal_notes'>): string | null {
  if (!booking.event_date || isBookingDateTbd(booking)) return null
  const time = booking.start_time ? booking.start_time.slice(0, 5) : '00:00'
  return parseLondonDateTimeLocal(`${booking.event_date.slice(0, 10)}T${time}`)?.toISOString() ?? null
}

export function renderPrivateBookingMessage(triggerType: string, ctx: CatalogueContext): CatalogueMessage | null {
  const b = ctx.booking
  const facts = (extras: Parameters<typeof buildPrivateBookingMessageFacts>[2] = {}) =>
    buildPrivateBookingMessageFacts(triggerType, b, extras)
  const base = { triggerType, expectCancelled: false, expectPast: false, email: null }

  switch (triggerType) {
    case 'booking_created': {
      const holdExpiry = b.hold_expiry ? formatPrivateBookingSmsDate(new Date(b.hold_expiry)) : null
      return {
        ...base,
        templateKey: 'private_booking_created',
        smsBody: privateBookingCreatedMessage({
          customerFirstName: b.customer_first_name,
          eventDate: smsEventDateTbdAware(b),
          depositAmount: toNumber(b.deposit_amount),
          holdExpiry,
        }),
        facts: facts(),
      }
    }

    case 'deposit_reminder_7day':
    case 'deposit_reminder_3day':
    case 'deposit_reminder_1day': {
      if (!b.hold_expiry) return null
      const eventDate = formatPrivateBookingSmsDate(b.event_date)
      const holdExpiry = formatPrivateBookingSmsDate(b.hold_expiry)
      const depositAmount = toNumber(b.deposit_amount)
      const daysRemaining = Math.ceil((new Date(b.hold_expiry).getTime() - ctx.now.getTime()) / (1000 * 60 * 60 * 24))
      const stage = triggerType === 'deposit_reminder_7day' ? '7day' : triggerType === 'deposit_reminder_3day' ? '3day' : '1day'
      const smsBody =
        stage === '7day'
          ? depositReminder7DayMessage({ customerFirstName: b.customer_first_name, eventDate, depositAmount, daysRemaining, holdExpiry })
          : stage === '3day'
            ? depositReminder3DayMessage({ customerFirstName: b.customer_first_name, eventDate, depositAmount, holdExpiry })
            : depositReminder1DayMessage({ customerFirstName: b.customer_first_name, eventDate, depositAmount, holdExpiry })
      return {
        ...base,
        templateKey: `private_booking_${triggerType}`,
        smsBody,
        email: () =>
          buildDepositReminderEmail({ booking: b, firstName: b.customer_first_name, stage, depositAmount, holdExpiry, daysRemaining }),
        facts: facts(),
      }
    }

    case 'deposit_received':
      return {
        ...base,
        templateKey: 'private_booking_deposit_received',
        smsBody: depositReceivedMessage({ customerFirstName: b.customer_first_name, eventDate: smsEventDateTbdAware(b) }),
        facts: facts(),
      }

    case 'booking_confirmed':
      return {
        ...base,
        templateKey: 'private_booking_confirmed',
        smsBody: bookingConfirmedMessage({ customerFirstName: firstNameChain(b), eventDate: smsEventDateTbdAware(b) }),
        facts: facts(),
      }

    case 'final_payment_received':
      return {
        ...base,
        templateKey: 'private_booking_final_payment',
        smsBody: finalPaymentMessage({ customerFirstName: b.customer_first_name, eventDate: smsEventDateTbdAware(b) }),
        facts: facts(),
      }

    case 'date_changed': {
      const includeBalanceDueDate = Boolean(ctx.storedFacts?.balance_due_date)
      return {
        ...base,
        templateKey: 'private_booking_date_changed',
        smsBody: dateChangedMessage({
          customerFirstName: b.customer_first_name,
          newEventDate: formatPrivateBookingSmsDate(b.event_date),
          balanceDueDate: includeBalanceDueDate ? formatPrivateBookingSmsDate(b.balance_due_date) : null,
        }),
        facts: facts({ includeBalanceDueDate }),
      }
    }

    case 'balance_due_date_changed':
      if (!b.balance_due_date) return null
      return {
        ...base,
        templateKey: 'private_booking_balance_due_date_changed',
        smsBody: balanceDueDateChangedMessage({
          customerFirstName: b.customer_first_name,
          eventDate: formatPrivateBookingSmsDate(b.event_date),
          balanceDueDate: formatPrivateBookingSmsDate(b.balance_due_date),
        }),
        facts: facts(),
      }

    case 'setup_reminder':
      return {
        ...base,
        templateKey: 'private_booking_setup_reminder',
        smsBody: setupReminderMessage({ customerFirstName: firstNameChain(b), eventDate: formatPrivateBookingSmsDate(b.event_date) }),
        facts: facts(),
      }

    case 'booking_completed':
      return {
        ...base,
        templateKey: 'private_booking_thank_you',
        smsBody: bookingCompletedThanksMessage({ customerFirstName: firstNameChain(b) }),
        facts: facts(),
        expectPast: true,
      }

    case 'booking_expired':
      return {
        ...base,
        templateKey: 'private_booking_expired',
        smsBody: bookingExpiredMessage({ customerFirstName: b.customer_first_name, eventDate: smsEventDateTbdAware(b) }),
        facts: facts(),
        expectCancelled: true,
      }

    case 'hold_extended':
      if (!b.hold_expiry) return null
      return {
        ...base,
        templateKey: 'private_booking_hold_extended',
        smsBody: holdExtendedMessage({
          customerFirstName: b.customer_first_name,
          eventDate: b.event_date ? formatPrivateBookingSmsDate(b.event_date) : 'your event',
          newExpiryDate: formatPrivateBookingSmsDate(new Date(b.hold_expiry)),
        }),
        facts: facts(),
      }

    case 'event_reminder_1d':
      return {
        ...base,
        templateKey: 'private_booking_event_reminder_1d',
        smsBody: eventReminder1DayMessage({
          customerFirstName: b.customer_first_name || b.customer_name?.split(' ')[0],
          guestPart: b.guest_count ? `for your ${b.guest_count} guests` : '',
        }),
        facts: facts(),
      }

    case 'review_request':
      if (!ctx.reviewLink) return null
      return {
        ...base,
        templateKey: 'private_booking_review_request',
        smsBody: reviewRequestMessage({
          customerFirstName: b.customer_first_name,
          eventDate: formatPrivateBookingSmsDate(b.event_date),
          reviewLink: ctx.reviewLink,
        }),
        facts: facts(),
        expectPast: true,
      }

    case 'balance_reminder_21day':
    case 'balance_reminder_16day':
    case 'balance_reminder_15day':
    case 'balance_reminder_due': {
      if (!b.balance_due_date || ctx.balanceAmount == null || !(ctx.balanceAmount > 0)) return null
      const eventDate = formatPrivateBookingSmsDate(b.event_date)
      const balanceDueDate = formatPrivateBookingSmsDate(b.balance_due_date)
      const input = { customerFirstName: b.customer_first_name, eventDate, balanceAmount: ctx.balanceAmount, balanceDueDate }
      const stage =
        triggerType === 'balance_reminder_21day' ? '21day' : triggerType === 'balance_reminder_16day' ? '16day' : triggerType === 'balance_reminder_15day' ? '15day' : 'due'
      const smsBody =
        stage === '21day'
          ? balanceReminder21DayMessage(input)
          : stage === '16day'
            ? balanceReminder16DayMessage(input)
            : stage === '15day'
              ? balanceReminder15DayMessage(input)
              : balanceReminderDueMessage(input)
      const balanceAmount = ctx.balanceAmount
      return {
        ...base,
        templateKey: `private_booking_${triggerType}`,
        smsBody,
        email: () => buildBalanceReminderEmail({ booking: b, firstName: b.customer_first_name, stage, balanceAmount, balanceDueDate }),
        facts: facts({ balanceAmount }),
      }
    }

    default: {
      const variant = CANCELLATION_TEMPLATES[triggerType]
      if (!variant) return null
      const amounts = ctx.cancellation
      if (!amounts && variant !== 'private_booking_cancelled_hold' && variant !== 'private_booking_cancelled_review_pending' && variant !== 'private_booking_cancelled_manual_review') {
        return null
      }
      const cancellation: CancellationAmounts = amounts ?? { refundAmount: 0, retainedAmount: 0, deductionAmount: 0 }
      const common = { customerFirstName: firstNameChain(b), eventDate: smsEventDateTbdAware(b) }
      const smsBody =
        variant === 'private_booking_cancelled_hold'
          ? bookingCancelledHoldMessage(common)
          : variant === 'private_booking_cancelled_refundable'
            ? bookingCancelledRefundableMessage({ ...common, refundAmount: cancellation.refundAmount })
            : variant === 'private_booking_cancelled_partial_refund'
              ? bookingCancelledPartialRefundMessage({ ...common, refundAmount: cancellation.refundAmount, deductionAmount: cancellation.deductionAmount })
              : variant === 'private_booking_cancelled_retention'
                ? bookingCancelledRetentionMessage({ ...common, retainedAmount: cancellation.retainedAmount, refundAmount: cancellation.refundAmount })
                : variant === 'private_booking_cancelled_review_pending'
                  ? bookingCancelledReviewPendingMessage(common)
                  : bookingCancelledManualReviewMessage(common)
      return {
        ...base,
        templateKey: variant,
        smsBody,
        email: () =>
          buildCancellationEmail({
            booking: b,
            firstName: firstNameChain(b),
            variant,
            refundAmount: cancellation.refundAmount,
            retainedAmount: cancellation.retainedAmount,
            deductionAmount: cancellation.deductionAmount,
            retentionReason: cancellation.retentionReason ?? null,
          }),
        facts: facts({ cancellation }),
        expectCancelled: true,
      }
    }
  }
}
