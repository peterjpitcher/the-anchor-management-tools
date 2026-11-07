/**
 * The guest invite the Christmas food page sends (spec section 3.3, owner decisions D5 and A4 of
 * 6 November 2026): one guest's own link to choose their dinner, sent because the organiser typed
 * their address on the food page. The organiser's "Email me a copy" reuses
 * `buildTableBookingPreorderChoicesEmail` in guest-emails.ts.
 *
 * Pure functions, no database and no clock, so they render in tests with fixture data. The house
 * layout comes from `renderTableBookingEmail`, so the venue number and sign-off match every other
 * booking email. Dates are read on the London calendar through the shared helpers.
 */

import { formatDateInLondon, formatTime12Hour, formatTimeInLondon } from '@/lib/dateUtils'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import {
  formatBookingDateForEmail,
  formatBookingMomentForEmail,
  formatBookingTimeForEmail,
  renderTableBookingEmail,
  type TableBookingEmail,
} from '@/lib/table-bookings/guest-emails'

/**
 * "noon on Friday 4 December 2026", for a pre-order cutoff instant. The cutoff is always noon
 * London (`getPreorderCutoff`), but the time is still read from the instant so a change to that
 * rule cannot leave this saying noon when it is not.
 */
export function formatPreorderCutoffForGuest(closesAt: Date): string {
  const time = formatTime12Hour(formatTimeInLondon(closesAt))
  const weekday = formatDateInLondon(closesAt, { weekday: 'long' })
  const date = formatDateInLondon(closesAt, { day: 'numeric', month: 'long', year: 'numeric' })
  return `${time === '12pm' ? 'noon' : time} on ${weekday} ${date}`
}

/** The line every locked food page and refused save shows (D8). */
export function preorderClosedMessage(closesAt: Date | null): string {
  const when = closesAt ? ` at ${formatPreorderCutoffForGuest(closesAt)}` : ''
  return `Choices closed${when}. Call ${GUEST_CONTACT.phoneDisplay} if something needs to change.`
}

function firstWord(value: string | null | undefined): string | null {
  const word = value?.trim().split(/\s+/)[0]
  return word ? word : null
}

export type PreorderGuestInviteEmailInput = {
  /** The name the organiser gave this guest's line, if any. Only the first word is used. */
  guestName: string | null
  /** The organiser's first name. Never their surname, phone or email (D5). */
  organiserFirstName: string
  bookingDate: string
  bookingTime: string | null
  startDateTime?: string | null
  /** The cutoff instant, the moment the link stops working. */
  closesAt: Date
  /** The guest's own link, `/g/<token>/christmas-choice`. */
  url: string
}

/**
 * One guest's invite to choose their own Christmas dinner (D5). Says who asked us to send it, the
 * day and time, the deadline and the link, that we send one reminder if they have not chosen, and
 * that their address is used for nothing else (A4).
 */
export function buildPreorderGuestInviteEmail(input: PreorderGuestInviteEmailInput): TableBookingEmail {
  const organiser = firstWord(input.organiserFirstName) ?? 'Your organiser'
  const greeting = firstWord(input.guestName)
  const moment = formatBookingMomentForEmail(input.bookingDate, input.bookingTime, input.startDateTime)
  const deadline = formatPreorderCutoffForGuest(input.closesAt)

  return renderTableBookingEmail({
    subject: 'Choose your Christmas dinner at The Anchor',
    preheader: `${organiser} asked us to send you this. Choose by ${deadline}.`,
    heading: 'Choose your Christmas dinner',
    opening: [
      `Hi${greeting ? ` ${greeting}` : ''}, ${organiser} asked us to send you this link so you can choose your own ` +
        `Christmas dinner for their booking at The Anchor${moment ? ` on ${moment}` : ''}.`,
      `Please choose by ${deadline}. The link stops working then, because that's when the kitchen orders.`,
    ],
    details: [
      { label: 'Date', value: formatBookingDateForEmail(input.bookingDate, input.startDateTime) },
      { label: 'Time', value: formatBookingTimeForEmail(input.bookingTime, input.startDateTime) },
      { label: 'Choose by', value: deadline },
    ],
    closing: ["It only takes a minute: your name, any allergies, how many courses and your dishes."],
    cta: { label: 'Choose your food', url: input.url },
    afterCta: [
      "If you haven't chosen by the day before the deadline, we'll send you one reminder. We won't use your email address for anything else.",
    ],
    beforeContact: [
      `If you have a serious allergy, please ring us on ${GUEST_CONTACT.phoneDisplay} as well, so we can talk it through.`,
    ],
  })
}
