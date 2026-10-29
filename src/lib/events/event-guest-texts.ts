/**
 * The words of every event booking text, one pure builder each (BK-221, customer bookings review
 * of 24 October 2026).
 *
 * Since owner decision D14 these texts are the fallback: an event message goes by email first and
 * a text only when there is no usable email or the email fails (src/lib/events/event-guest-notify.ts).
 * Each builder is the one place its text lives, so the senders and the fixture tests read the same
 * words. Calm and exact, as SSOT section 1 asks of booking and money messages (BK-171, owner
 * decision D15): no "nice one", "locked in" or "belter".
 *
 * Pure: no database, no provider and no clock. Dates are worked out in Europe/London whatever zone
 * the server runs in. A missing date is left out of the sentence, never replaced with a stand-in
 * such as "your event time". Plain ASCII punctuation only, so every text stays in GSM-7.
 */

import { formatEventWhenCompactLondon } from '@/lib/events/event-when'
import { GUEST_CONTACT } from '@/lib/guest-contact'

/** "Wed 16 Sep at 7pm", or null when the record has no usable start. */
export function formatEventTextWhen(startIso: string | null | undefined): string | null {
  return formatEventWhenCompactLondon(startIso)
}

/** " on Wed 16 Sep at 7pm", or "" when the date is not known. */
function onWhen(when: string | null | undefined): string {
  return when ? ` on ${when}` : ''
}

function wholeCount(value: number | null | undefined): number {
  const count = Math.floor(Number(value) || 0)
  return count > 0 ? count : 1
}

/**
 * What one booked place is called on this night: a standing ticket, a place on a shared or
 * general night, otherwise a seat. Never promises a table on shared seating.
 */
export function describeEventPlaces(input: {
  seats: number | null | undefined
  seatingType?: string | null
  bookingMode?: string | null
}): string {
  const count = wholeCount(input.seats)
  if (input.seatingType === 'standing') return `${count} standing ${count === 1 ? 'ticket' : 'tickets'}`
  if (input.bookingMode === 'communal' || input.bookingMode === 'general') {
    return `${count} ${count === 1 ? 'place' : 'places'}`
  }
  return `${count} ${count === 1 ? 'seat' : 'seats'}`
}

type GuestFacts = {
  /** As the text shows it (getSmartFirstName): "there" when the name is missing. */
  firstName: string
  eventName: string
  /** formatEventTextWhen of the event start, or null. */
  when: string | null
}

/** A free or pay-on-the-night booking, confirmed (event_booking_confirmed). */
export function buildEventBookingConfirmedText(input: GuestFacts & {
  seats: number
  seatingType?: string | null
  bookingMode?: string | null
  manageLink?: string | null
}): string {
  const places = describeEventPlaces(input)
  const manage = input.manageLink ? ` Manage your booking: ${input.manageLink}` : ''
  return `The Anchor: Hi ${input.firstName}, you're booked in for ${input.eventName}${onWhen(input.when)}, ${places}.${manage}`
}

/** A booking held while it waits for payment (event_booking_pending_payment). */
export function buildEventBookingHeldText(input: GuestFacts & {
  seats: number
  seatingType?: string | null
  bookingMode?: string | null
  /** "7:42pm", or "Wed 29 Oct at 7:42pm": when the hold ends (formatHoldUntilLondon). */
  holdUntil?: string | null
  paymentLink?: string | null
  manageLink?: string | null
}): string {
  const places = describeEventPlaces(input)
  const until = input.holdUntil ? ` until ${input.holdUntil}` : ''
  const manage = input.manageLink ? ` ${input.manageLink}` : ''
  const opening = `The Anchor: Hi ${input.firstName}, we're holding ${places} for ${input.eventName}${onWhen(input.when)}${until}.`
  if (input.paymentLink) {
    return `${opening} Pay here to confirm: ${input.paymentLink}${manage}`
  }
  return `${opening} We couldn't send your payment link just now, so we'll be in touch, or call us on ${GUEST_CONTACT.phoneDisplay}.${manage}`
}

/** Payment taken and the booking confirmed (event_payment_confirmed). */
export function buildEventPaymentConfirmedText(input: GuestFacts & {
  seats: number
  seatingType?: string | null
  /** " (1x Adult, 1x Child)" for a multi-type booking, else "". */
  breakdown?: string | null
  manageLink?: string | null
}): string {
  const places = describeEventPlaces({ seats: input.seats, seatingType: input.seatingType })
  const manage = input.manageLink ? ` Manage booking: ${input.manageLink}` : ''
  return `The Anchor: Hi ${input.firstName}, payment received. Your booking for ${input.eventName}${onWhen(input.when)} is confirmed for ${places}${input.breakdown ?? ''}.${manage}`
}

/** Payment taken but the booking needs a person to check it (event_payment_manual_review). */
export function buildEventPaymentManualReviewText(input: Pick<GuestFacts, 'firstName' | 'eventName'>): string {
  return `The Anchor: Hi ${input.firstName}, we've received your payment for ${input.eventName}. We need to check your booking before we confirm it, and we'll be in touch shortly. You don't need to pay again.`
}

/** Staff or the guest changed the number of seats (event_booking_seats_updated). */
export function buildEventSeatUpdateText(input: Pick<GuestFacts, 'firstName' | 'eventName'> & {
  oldSeats: number
  newSeats: number
  manageLink?: string | null
}): string {
  const label = (count: number) => `${wholeCount(count)} ${wholeCount(count) === 1 ? 'seat' : 'seats'}`
  const manage = input.manageLink ? ` Manage booking: ${input.manageLink}` : ''
  return `The Anchor: Hi ${input.firstName}, your booking for ${input.eventName} has been updated from ${label(input.oldSeats)} to ${label(input.newSeats)}.${manage}`
}

/** The payment reminder for a phone, bar or text booking (event_payment_retry, BK-142). */
export function buildEventPaymentReminderText(input: {
  firstName: string
  eventName: string
  heldUntil: string | null
  paymentLink: string
}): string {
  const until = input.heldUntil ? ` are held until ${input.heldUntil}` : ' are held for you'
  return `The Anchor: Hi ${input.firstName}, your seats for ${input.eventName}${until}. Pay here: ${input.paymentLink}`
}

/** The hold ran out unpaid and the seats went back on sale (event_hold_expired, BK-173). */
export function buildEventHoldReleasedText(input: GuestFacts & {
  seats: number
  seatingType?: string | null
  bookingMode?: string | null
  /** The event's public page, so the guest can book again. */
  rebookLink?: string | null
}): string {
  const places = describeEventPlaces(input)
  const rebook = input.rebookLink
    ? ` To book again: ${input.rebookLink}`
    : ` To book again, call us on ${GUEST_CONTACT.phoneDisplay}.`
  return `The Anchor: Hi ${input.firstName}, we've released the ${places} we were holding for ${input.eventName}${onWhen(input.when)}, as payment wasn't made in time.${rebook}`
}

/** The review request the morning after (event_review_followup). */
export function buildEventReviewAskText(input: {
  firstName: string
  eventName: string
  /** "last night", "on Saturday": describeEventDayForReview. */
  dayText: string
  reviewLink: string
}): string {
  return `The Anchor: Hi ${input.firstName}, thanks for coming to ${input.eventName} ${input.dayText}. If you have 30 seconds, we'd love to know how it went: ${input.reviewLink}`
}

/**
 * The reminder to add missing guest details a few days before the night (BK-132, owner decision
 * D5: 3 days before). Sent by text only to a booker with no usable email.
 */
export function buildEventGuestDetailsReminderText(input: GuestFacts & {
  missingCount: number
  detailsLink: string
}): string {
  const missing = input.missingCount === 1 ? '1 ticket still needs' : `${wholeCount(input.missingCount)} tickets still need`
  return `The Anchor: Hi ${input.firstName}, ${missing} a guest name or answers for ${input.eventName}${onWhen(input.when)}. Add them here: ${input.detailsLink}`
}

/** Staff cancelled the booking (event_booking_cancelled_admin). */
export function buildEventBookingCancelledText(input: Pick<GuestFacts, 'firstName' | 'eventName' | 'when'> & {
  seats: number
  /** A reminder-only guest entry, with no seats, is "removed" rather than cancelled. */
  isReminderOnly: boolean
  /** What happens to their money (buildStaffCancellationRefundNote), or null. */
  refundNote?: string | null
}): string {
  if (input.isReminderOnly) {
    return `The Anchor: ${input.firstName}, your reminder guest entry for ${input.eventName}${onWhen(input.when)} has been removed. Reply if you need help rejoining.`
  }
  const count = Math.max(0, Math.floor(Number(input.seats) || 0))
  const seatPart = count > 0 ? ` (${count} ${count === 1 ? 'seat' : 'seats'})` : ''
  const refundPart = input.refundNote ? ` ${input.refundNote}` : ''
  return `The Anchor: ${input.firstName}, your booking for ${input.eventName}${onWhen(input.when)} has been cancelled${seatPart}.${refundPart} Reply if you need help rebooking.`
}
