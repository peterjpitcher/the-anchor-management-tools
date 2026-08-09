/**
 * Deciding who gets a "are you still coming?" text, and what it says.
 *
 * Kept separate from the cron route for the same reason `decidePreorderChases` is: the
 * rule about who gets messaged is the part that can quietly harm a guest, and it should
 * be testable without a database, a clock or an SMS provider.
 *
 * THE RULE, in one sentence: a confirmed booking whose guest has not already answered,
 * whose sitting is roughly a day away, gets exactly one text.
 *
 * Everything below is a reason why some booking does NOT get one.
 */

import { getSmartFirstName } from '@/lib/sms/name-utils'

/**
 * Only a CONFIRMED booking is chased, as an allow-list rather than a list of dead
 * statuses. The failure modes point opposite ways: miss a status from a deny-list and a
 * guest gets a text they should never have had, miss one here and the sweep stays quiet,
 * which is recoverable.
 *
 * `pending_payment` is the case that matters. That guest has not paid a deposit, their
 * hold can still expire, and the booking may never exist. Asking them to confirm a table
 * they have not secured is the wrong conversation; the deposit chase is the right one.
 * They join this sweep the moment payment lands and they become confirmed.
 */
export const CONFIRMABLE_BOOKING_STATUSES = ['confirmed'] as const

/**
 * ONE SWEEP A DAY, and everyone sitting tomorrow gets asked.
 *
 * An hours-based window was the obvious design and it is wrong here. The sweep must not
 * run overnight, because a text at three in the morning is worse than no text at all, and
 * an hourly cron that sleeps from 9pm to 9am can never catch a booking at 8am tomorrow:
 * that sitting is 24 hours away at 8am today, when nothing is running, and only 23 hours
 * away by the time the first morning run happens. It would fall through the gap forever
 * and nobody would notice, because the absence of a text leaves no trace.
 *
 * Comparing dates instead removes the edge entirely. "Is this booking tomorrow" has the
 * same answer at any hour of the day it is asked.
 */
export type ConfirmCandidate = {
  id: string
  bookingReference: string
  status: string
  /** The booking's local date, as stored: YYYY-MM-DD in Europe/London. */
  bookingDate: string
  guestConfirmedAt: string | null
  reminderAlreadySent: boolean
  customer: {
    id: string
    firstName: string | null
    phone: string | null
    smsActive: boolean
  } | null
}

export type ConfirmDecision =
  | { send: true }
  | { send: false; reason: ConfirmSkipReason }

export type ConfirmSkipReason =
  | 'status_not_confirmable'
  | 'already_answered'
  | 'already_reminded'
  | 'no_customer'
  | 'no_mobile'
  | 'sms_not_active'
  | 'not_tomorrow'

/**
 * Whether this booking should be texted on today's sweep.
 *
 * `todayIsoDate` is passed in rather than read, so the date edges are testable and a test
 * cannot pass or fail depending on when it runs or which timezone the runner is in.
 */
export function decideConfirmReminder(
  candidate: ConfirmCandidate,
  todayIsoDate: string
): ConfirmDecision {
  if (!CONFIRMABLE_BOOKING_STATUSES.includes(candidate.status as 'confirmed')) {
    return { send: false, reason: 'status_not_confirmable' }
  }

  // The guest has already told us. Asking again is noise, and on a booking they confirmed
  // days ago it reads as though we lost their answer.
  if (candidate.guestConfirmedAt) {
    return { send: false, reason: 'already_answered' }
  }

  if (candidate.reminderAlreadySent) {
    return { send: false, reason: 'already_reminded' }
  }

  if (!candidate.customer) {
    return { send: false, reason: 'no_customer' }
  }

  if (!candidate.customer.phone) {
    return { send: false, reason: 'no_mobile' }
  }

  // Opting out of texts is an answer in itself. The pub rings these guests instead, which
  // is the fallback for every skip reason here.
  if (!candidate.customer.smsActive) {
    return { send: false, reason: 'sms_not_active' }
  }

  if (!isTomorrow(candidate.bookingDate, todayIsoDate)) {
    return { send: false, reason: 'not_tomorrow' }
  }

  return { send: true }
}

/**
 * Is this booking date the day after the sweep's date.
 *
 * Plain string arithmetic on YYYY-MM-DD, deliberately. Both values are already local
 * Europe/London dates by the time they reach here, so converting either into a Date and
 * back is an opportunity to shift a booking across midnight in British Summer Time and no
 * opportunity to be more correct.
 */
export function isTomorrow(bookingDate: string, todayIsoDate: string): boolean {
  return bookingDate === addOneDay(todayIsoDate)
}

function addOneDay(isoDate: string): string {
  // Built at UTC noon so a daylight-saving shift in either direction cannot move the
  // result onto the wrong calendar day.
  const noon = new Date(`${isoDate}T12:00:00Z`)
  if (Number.isNaN(noon.getTime())) return ''
  noon.setUTCDate(noon.getUTCDate() + 1)
  return noon.toISOString().slice(0, 10)
}

/**
 * The text itself.
 *
 * Straight apostrophes and no dashes throughout: a single curly character switches the
 * message from GSM-7 to UCS-2 and drops the segment limit from 160 characters to 70,
 * which doubles the cost of every send for no visible benefit.
 *
 * The URL is left long. `shortenUrlsInSmsBody` rewrites every http(s) URL in an outbound
 * body to a tracked short link at send time, so shortening here would only produce a
 * short link to a short link.
 */
export function buildConfirmReminderMessage(input: {
  firstName: string | null
  bookingMoment: string
  partySize: number | null
  confirmUrl: string
}): string {
  const name = getSmartFirstName(input.firstName)
  const greeting = name ? `${name}, ` : ''
  const party = input.partySize && input.partySize > 0 ? ` for ${input.partySize}` : ''

  return (
    `The Anchor: ${greeting}your table${party} is ${input.bookingMoment}. ` +
    `Still coming? Tap to confirm or cancel: ${input.confirmUrl}`
  )
}
