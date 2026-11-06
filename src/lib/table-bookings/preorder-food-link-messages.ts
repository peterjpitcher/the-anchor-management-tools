/**
 * The organiser's food link, sent by staff from the booking page (spec section 3.5, "Send food link").
 *
 * One email, or one text when there is no usable email address, telling the organiser where to
 * choose everyone's food and when choices close. It goes out through
 * `notifyTableBookingGuestEmailFirst` under the pre-order reminder's template key, so a bounced email
 * falls back to the reminder text the fallback renderer already knows how to rebuild.
 *
 * Pure functions: no database and no clock, so they can be rendered with fixture data in tests.
 * Dates are London dates, from the project's date helpers.
 */

import { formatDateInLondon, formatDateWithTimeForSms, isValidIsoDate } from '@/lib/dateUtils'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import {
  formatBookingDateForEmail,
  formatBookingMomentForEmail,
  formatBookingTimeForEmail,
  renderTableBookingEmail,
  type TableBookingEmail,
} from '@/lib/table-bookings/guest-emails'

export type PreorderFoodLinkFacts = {
  /** As the message greets them (getSmartFirstName). */
  firstName: string
  bookingReference: string | null
  /** The booking's London date, YYYY-MM-DD. */
  bookingDate: string
  /** HH:MM or HH:MM:SS, London wall-clock time. */
  bookingTime: string | null
  partySize: number | null
  /** The organiser's manage link, short when shortening worked. */
  link: string
  /** When choices close (`getPreorderCutoff().closesAt`), as an ISO instant. Null when the period does not say. */
  closesAtIso: string | null
}

/** "Saturday 5 December", the London day choices close on. Null for anything unreadable. */
function cutoffDay(closesAtIso: string | null): string | null {
  if (!closesAtIso) return null
  const closesAt = new Date(closesAtIso)
  if (Number.isNaN(closesAt.getTime())) return null
  return formatDateInLondon(closesAt, { weekday: 'long', day: 'numeric', month: 'long' })
}

function partySizeLabel(partySize: number | null): string | null {
  const size = Number(partySize)
  if (!Number.isFinite(size) || size < 1) return null
  const whole = Math.floor(size)
  return `${whole} ${whole === 1 ? 'person' : 'people'}`
}

export function buildPreorderFoodLinkEmail(facts: PreorderFoodLinkFacts): TableBookingEmail {
  const date = formatBookingDateForEmail(facts.bookingDate)
  const moment = formatBookingMomentForEmail(facts.bookingDate, facts.bookingTime)
  const closes = cutoffDay(facts.closesAtIso)
  const reference = facts.bookingReference ? ` (reference ${facts.bookingReference})` : ''

  return renderTableBookingEmail({
    subject: date ? `Choose everyone's food for ${date}` : "Choose everyone's food",
    preheader: closes ? `Your food link. Choices close at noon on ${closes}.` : 'Your link to choose the food',
    heading: "Choose everyone's food",
    opening: [
      `Hi ${facts.firstName}, here's your link to choose the food for your booking at The Anchor` +
        `${moment ? ` on ${moment}` : ''}${reference}.`,
      'Each guest needs a name, their allergies, their number of courses and their dishes. You can save part-way and come back to it.',
      ...(closes ? [`Choices close at noon on ${closes}.`] : []),
    ],
    details: [
      { label: 'Reference', value: facts.bookingReference },
      { label: 'Date', value: date },
      { label: 'Time', value: formatBookingTimeForEmail(facts.bookingTime) },
      { label: 'Party size', value: partySizeLabel(facts.partySize) },
    ],
    cta: { label: 'Choose the food', url: facts.link },
    afterCta: [`Prefer to do it over the phone? Ring us on ${GUEST_CONTACT.phoneDisplay}.`],
    beforeContact: [],
  })
}

export function buildPreorderFoodLinkText(facts: PreorderFoodLinkFacts): string {
  const moment = isValidIsoDate(facts.bookingDate)
    ? formatDateWithTimeForSms(`${facts.bookingDate}T12:00:00Z`, facts.bookingTime)
    : null
  const closes = cutoffDay(facts.closesAtIso)
  return (
    `The Anchor: Hi ${facts.firstName}, here's your link to choose everyone's food` +
    `${moment ? ` for your booking on ${moment}` : ''}.` +
    `${closes ? ` Choices close at noon on ${closes}.` : ''} ${facts.link}`
  )
}
