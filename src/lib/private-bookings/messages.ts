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
  holdExpiry: string
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — your date at The Anchor on ${input.eventDate} is penciled in. ${money(input.depositAmount)} deposit secures it by ${input.holdExpiry}. We'll be in touch with next steps.`
  )
}

export function depositReminder7DayMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  depositAmount: number
  daysRemaining: number
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — quick nudge. Your hold on ${input.eventDate} expires in ${input.daysRemaining} days. ${money(input.depositAmount)} deposit and the date's yours.`
  )
}

export function depositReminder1DayMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  depositAmount: number
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — your hold on ${input.eventDate} expires tomorrow. Get the ${money(input.depositAmount)} deposit in today and you're locked in.`
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

export function balanceReminder14DayMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  balanceAmount: number
  balanceDueDate: string
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — two weeks to go. ${money(input.balanceAmount)} balance due by ${input.balanceDueDate} to keep ${input.eventDate} on track.`
  )
}

export function balanceReminder7DayMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  balanceAmount: number
  balanceDueDate: string
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — one week to go. ${money(input.balanceAmount)} balance still to settle by ${input.balanceDueDate}.`
  )
}

export function balanceReminder1DayMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  balanceAmount: number
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — ${money(input.balanceAmount)} balance due tomorrow for ${input.eventDate}. Get it in today so we can focus on the event.`
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
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — your booking's moved to ${input.newEventDate}. All sorted our end.`
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

export function bookingCancelledNonRefundableMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  retainedAmount: number
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — your booking on ${input.eventDate} is cancelled. The ${money(input.retainedAmount)} already paid is retained per our booking terms. We'll be in touch if anything else is outstanding.`
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
