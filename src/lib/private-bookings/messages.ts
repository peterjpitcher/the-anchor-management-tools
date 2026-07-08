import { getSmartFirstName } from '@/lib/sms/bulk'
import { sanitiseSmsVariable } from '@/lib/sms/sanitise'

const MAX_FIELD = 80
const MAX_BODY = 306

function name(raw: string | null | undefined): string {
  return getSmartFirstName(sanitiseSmsVariable(raw, MAX_FIELD))
}

function money(n: number): string {
  // £ prefix, no decimals unless non-whole.
  return Number.isInteger(n) ? `£${n}` : `£${n.toFixed(2)}`
}

function cap(body: string): string {
  return body.length <= MAX_BODY ? body : body.slice(0, MAX_BODY - 1) + '…'
}

// --- Templates ---

export function privateBookingCreatedMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  depositAmount: number
  holdExpiry: string | null
}): string {
  const securesPart = input.holdExpiry
    ? `${money(input.depositAmount)} deposit secures it by ${input.holdExpiry}.`
    : `${money(input.depositAmount)} deposit secures it.`
  return cap(
    `Hi ${name(input.customerFirstName)} — your date at The Anchor on ${input.eventDate} is penciled in. ${securesPart} We'll be in touch with next steps.`
  )
}

export function depositReminder7DayMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  depositAmount: number
  daysRemaining: number
  /** The actual expiry date — states the deadline and varies the body so a moved expiry re-arms dedup. */
  holdExpiry?: string | null
}): string {
  const expiresPart = input.holdExpiry
    ? `expires in ${input.daysRemaining} days, on ${input.holdExpiry}`
    : `expires in ${input.daysRemaining} days`
  return cap(
    `Hi ${name(input.customerFirstName)} — quick nudge. Your hold on ${input.eventDate} ${expiresPart}. ${money(input.depositAmount)} deposit and the date's yours.`
  )
}

export function depositReminder3DayMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  depositAmount: number
  /** The actual expiry date — states the deadline and varies the body so a moved expiry re-arms dedup. */
  holdExpiry?: string | null
}): string {
  const expiresPart = input.holdExpiry ? ` expires on ${input.holdExpiry}` : ' is expiring soon'
  return cap(
    `Hi ${name(input.customerFirstName)} — your hold on ${input.eventDate}${expiresPart}. ${money(input.depositAmount)} deposit locks the date in before it's released.`
  )
}

export function depositReminder1DayMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  depositAmount: number
  /** The actual expiry date — states the deadline and varies the body so a moved expiry re-arms dedup. */
  holdExpiry?: string | null
}): string {
  const datePart = input.holdExpiry ? ` (${input.holdExpiry})` : ''
  return cap(
    `Hi ${name(input.customerFirstName)} — your hold on ${input.eventDate} expires tomorrow${datePart}. Get the ${money(input.depositAmount)} deposit in today and you're locked in.`
  )
}

export function depositReceivedMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — deposit received. ${input.eventDate} is yours. We'll be in touch closer to the time.`
  )
}

export function bookingConfirmedMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
}): string {
  return cap(`Hi ${name(input.customerFirstName)} — you're all confirmed for ${input.eventDate}. Can't wait.`)
}

// Balance & final-details reminders are keyed to the due date (14 calendar
// days before the event) per SOP §13: sent 7 days, 2 days and 1 day before
// the deadline, and on the day itself. Late-created bookings get the next
// relevant reminder immediately (windowing handled by the cron).

export function balanceReminder21DayMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  balanceAmount: number
  balanceDueDate: string
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — ${money(input.balanceAmount)} balance and your final details (numbers, menus, suppliers) are due by ${input.balanceDueDate} for ${input.eventDate}.`
  )
}

export function balanceReminder16DayMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  balanceAmount: number
  balanceDueDate: string
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — 2 days to go: ${money(input.balanceAmount)} balance and final details due by ${input.balanceDueDate} for ${input.eventDate}.`
  )
}

export function balanceReminder15DayMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  balanceAmount: number
  /** The actual deadline, so "tomorrow" is anchored to a date the customer can check. */
  balanceDueDate?: string | null
}): string {
  const datePart = input.balanceDueDate ? ` (${input.balanceDueDate})` : ''
  return cap(
    `Hi ${name(input.customerFirstName)} — your ${money(input.balanceAmount)} balance and final details for ${input.eventDate} are due tomorrow${datePart}.`
  )
}

export function balanceReminderDueMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  balanceAmount: number
  /** The actual deadline, so "today" is anchored to a date the customer can check. */
  balanceDueDate?: string | null
}): string {
  const datePart = input.balanceDueDate ? ` (${input.balanceDueDate})` : ''
  return cap(
    `Hi ${name(input.customerFirstName)} — ${money(input.balanceAmount)} balance and your final details for ${input.eventDate} are due today${datePart}. Get them in and you're all set.`
  )
}

export function finalPaymentMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — balance paid in full. You're all set for ${input.eventDate} — see you then.`
  )
}

export function setupReminderMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — ${input.eventDate} is nearly here. Send any final setup details our way so we can make it perfect.`
  )
}

export function dateChangedMessage(input: {
  customerFirstName: string | null | undefined
  newEventDate: string
  /** Included when the balance & final-details deadline moved with the event. */
  balanceDueDate?: string | null
}): string {
  const duePart = input.balanceDueDate
    ? ` Balance and final details are now due by ${input.balanceDueDate}.`
    : ''
  return cap(
    `Hi ${name(input.customerFirstName)} — your booking's moved to ${input.newEventDate}.${duePart} All sorted our end.`
  )
}

/**
 * Sent when the balance & final-details deadline moves without the event
 * itself moving — a customer who was told one date must hear the new one
 * (discovery 2026-07-08: silent due-date changes produced contradictory
 * contract/email dates).
 */
export function balanceDueDateChangedMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  balanceDueDate: string
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — quick update for ${input.eventDate}: your balance and final details are now due by ${input.balanceDueDate}. Everything else stays the same.`
  )
}

export function eventReminder1DayMessage(input: {
  customerFirstName: string | null | undefined
  guestPart: string
}): string {
  const suffix = input.guestPart ? ` ${input.guestPart}` : ''
  return cap(`Hi ${name(input.customerFirstName)} — tomorrow's the day. Everything's ready${suffix}. See you then.`)
}

export function holdExtendedMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  newExpiryDate: string
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — good news. We've extended your hold on ${input.eventDate}. New deadline: ${input.newExpiryDate}.`
  )
}

export function bookingCancelledHoldMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — your hold on ${input.eventDate} is cancelled. No money changed hands. Shout if you'd like another date.`
  )
}

export function bookingCancelledRefundableMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  refundAmount: number
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — your booking on ${input.eventDate} is cancelled. We'll refund ${money(input.refundAmount)} within 10 working days and confirm once it's on the way.`
  )
}

export function bookingCancelledPartialRefundMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  refundAmount: number
  deductionAmount: number
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — your booking on ${input.eventDate} is cancelled. Your deposit will be refunded less the ${money(input.deductionAmount)} cancellation administration deduction. We'll refund ${money(input.refundAmount)} within 10 working days.`
  )
}

/**
 * Sent once a manager has decided the retention for a sub-30-day
 * cancellation (SOP §14: retention may be up to the full deposit where
 * reasonable and evidenced — never automatic).
 */
export function bookingCancelledRetentionMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  retainedAmount: number
  refundAmount: number
}): string {
  const refundPart = input.refundAmount > 0
    ? ` ${money(input.refundAmount)} will be refunded within 10 working days.`
    : ''
  return cap(
    `Hi ${name(input.customerFirstName)} — your booking on ${input.eventDate} is cancelled. Following review, ${money(input.retainedAmount)} of your deposit has been retained to cover costs from the cancellation.${refundPart} We'll send a breakdown on request.`
  )
}

/**
 * Sent when a sub-30-day cancellation is processed before the retention
 * decision has been made — no amounts are asserted to the customer.
 */
export function bookingCancelledReviewPendingMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — your booking on ${input.eventDate} is cancelled. We're reviewing payments and your deposit, and will confirm any refund shortly.`
  )
}

export function bookingCancelledManualReviewMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — your booking on ${input.eventDate} is cancelled. A member of our team will be in touch shortly to confirm next steps on payment.`
  )
}

export function bookingExpiredMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — your hold on ${input.eventDate} has lapsed. No worries — shout if you'd like to rebook.`
  )
}

export function bookingCompletedThanksMessage(input: {
  customerFirstName: string | null | undefined
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — thanks for choosing The Anchor. Hope it was everything you wanted.`
  )
}

export function reviewRequestMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  reviewLink: string
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — glad ${input.eventDate} went well. If you've got 30 seconds, a Google review would mean a lot: ${input.reviewLink}`
  )
}
