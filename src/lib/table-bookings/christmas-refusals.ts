/**
 * Why the website cannot take a Christmas booking, as a code the website can branch on and a
 * sentence the guest can read (spec tasks/christmas-food-link/spec.md section 3.6, owner decisions
 * D2 and D15 of 6 November 2026).
 *
 * The database refuses a Christmas booking in two ways, depending on how the website asked:
 *
 *  - The old payload (purpose `christmas`, or course counts through create_table_booking_christmas_v01)
 *    is refused with an exception whose text starts "Christmas bookings ". Those texts are matched
 *    here, exactly as the migrations raise them:
 *      create_table_booking_core_v06 (20260913120622_booking_start_inside_trading_day.sql):
 *        "Christmas bookings are for 4 guests or more."
 *        "Christmas bookings need at least % hours notice."
 *        (Until 20261110195056_christmas_online_26 it also raised "Christmas bookings for more than 20
 *        guests are arranged as private hire. ..."; still matched here for a request in flight while
 *        that migration lands. A party above the caller's ceiling is now the blocked answer
 *        `too_large_party` instead.)
 *      create_table_booking_christmas_v01 (20261110195056_christmas_online_26.sql):
 *        "Christmas bookings are for 4 to N guests.", N the online Christmas ceiling (26)
 *        "Christmas bookings are not open for that date."
 *        "Christmas bookings for two or three courses need a pre-order by noon % before the booking. ..."
 *  - The new payload (purpose `food` with the Christmas period accepted) is refused with a blocked
 *    result, because core_v06 only raises for the legacy purpose: `period_party_too_small` and
 *    `period_party_too_large` from resolve_table_booking_deposit, `too_large_party` from the public
 *    entry point's online limit, `cut_off` inside the period's min_notice_hours, and `outside_hours`
 *    or a `period_*` code for a Monday, a closed kitchen or a date outside the window.
 *
 * Every message gives the phone number, and the route answers each with status 400, never a success
 * status, so the website cannot mistake a refusal for a booking.
 *
 * Pure: no database and no clock beyond the `now` passed in.
 */

import { whenLondonClockReaches } from '@/lib/dateUtils'
import { GUEST_CONTACT } from '@/lib/guest-contact'

export type ChristmasRefusalCode =
  | 'CHRISTMAS_NOTICE'
  | 'CHRISTMAS_PARTY_TOO_SMALL'
  | 'CHRISTMAS_PARTY_TOO_LARGE'
  | 'CHRISTMAS_NOT_AVAILABLE'
  | 'CHRISTMAS_EMAIL_REQUIRED'

export type ChristmasRefusalFacts = {
  /** The period's min_notice_hours, when it could be read. */
  minNoticeHours?: number | null
  /** The period's min_party_size, when it could be read. */
  minPartySize?: number | null
  /** The online Christmas ceiling (table_booking_max_party_christmas_online, 26), when it could be read. */
  onlinePartyLimit?: number | null
}

/** Whole days of notice, rounded up, from the period's hours. Null when the hours are unknown. */
export function christmasNoticeDays(minNoticeHours: number | null | undefined): number | null {
  const hours = Number(minNoticeHours)
  if (minNoticeHours === null || minNoticeHours === undefined || !Number.isFinite(hours) || hours <= 0) return null
  return Math.ceil(hours / 24)
}

function positiveWhole(value: number | null | undefined): number | null {
  const number = Number(value)
  if (value === null || value === undefined || !Number.isInteger(number) || number < 1) return null
  return number
}

/** The guest-ready sentence for a refusal. Every one gives the phone number. */
export function christmasRefusalMessage(code: ChristmasRefusalCode, facts: ChristmasRefusalFacts = {}): string {
  const phone = GUEST_CONTACT.phoneDisplay
  switch (code) {
    case 'CHRISTMAS_NOTICE': {
      const days = christmasNoticeDays(facts.minNoticeHours)
      return days
        ? `We take Christmas bookings online up to ${days} days ahead, so you've time to choose your food. ` +
            `For a sooner date, call us on ${phone} and we'll see what we can do.`
        : `We take Christmas bookings online with enough notice for you to choose your food. ` +
            `For a sooner date, call us on ${phone} and we'll see what we can do.`
    }
    case 'CHRISTMAS_PARTY_TOO_SMALL': {
      const min = positiveWhole(facts.minPartySize)
      return min
        ? `Christmas bookings are for ${min} guests or more. For a smaller table, call us on ${phone} and we'll see what we can do.`
        : `That's too few guests for a Christmas booking online. Call us on ${phone} and we'll see what we can do.`
    }
    case 'CHRISTMAS_PARTY_TOO_LARGE': {
      const limit = positiveWhole(facts.onlinePartyLimit)
      return limit
        ? `We take Christmas bookings online for up to ${limit} guests. For a bigger group, call us on ${phone} and we'll book it for you.`
        : `That's a bigger group than we can book online. Call us on ${phone} and we'll book it for you.`
    }
    case 'CHRISTMAS_NOT_AVAILABLE':
      return `We can't take a Christmas booking online for that date or time. Call us on ${phone} and we'll help you find one.`
    case 'CHRISTMAS_EMAIL_REQUIRED':
      return (
        "Please add your email address. We'll email you the link to choose everyone's food. " +
        `If you'd rather book by phone, call us on ${phone}.`
      )
  }
}

/** The hours in "Christmas bookings need at least 192 hours notice.", for when the period is unread. */
export function noticeHoursFromRuleMessage(message: string | null | undefined): number | null {
  const match = /^Christmas bookings need at least (\d+) hours notice/.exec(message?.trim() ?? '')
  return match ? Number(match[1]) : null
}

/**
 * The refusal behind a database exception, or null when it is not one of the four. A null answer
 * keeps the route's older behaviour: the exception's own text, as a validation error.
 */
export function classifyChristmasRuleError(
  message: string | null | undefined,
  input: { partySize: number; minPartySize?: number | null },
): ChristmasRefusalCode | null {
  const text = message?.trim() ?? ''
  if (!text.startsWith('Christmas bookings ')) return null
  if (/^Christmas bookings are for \d+ guests or more\./.test(text)) return 'CHRISTMAS_PARTY_TOO_SMALL'
  if (/^Christmas bookings for more than \d+ guests are arranged as private hire/.test(text)) {
    return 'CHRISTMAS_PARTY_TOO_LARGE'
  }
  if (/^Christmas bookings need at least \d+ hours notice/.test(text)) return 'CHRISTMAS_NOTICE'
  // Inside the pre-order deadline is inside the notice too: the notice (192 hours) is longer.
  if (/^Christmas bookings for two or three courses need a pre-order by noon/.test(text)) return 'CHRISTMAS_NOTICE'
  const range = /^Christmas bookings are for (\d+) to (\d+) guests\./.exec(text)
  if (range) {
    const min = positiveWhole(input.minPartySize) ?? Number(range[1])
    return input.partySize < min ? 'CHRISTMAS_PARTY_TOO_SMALL' : 'CHRISTMAS_PARTY_TOO_LARGE'
  }
  if (text === 'Christmas bookings are not open for that date.') return 'CHRISTMAS_NOT_AVAILABLE'
  return null
}

/** Blocked reasons that mean the date or time cannot take a Christmas booking at all. */
const NOT_AVAILABLE_REASONS: ReadonlySet<string> = new Set([
  'outside_hours',
  'outside_service_window',
  'hours_not_configured',
  'period_not_available',
  'period_date_mismatch',
  'period_not_found',
  'period_inactive',
  'period_archived',
  'period_menu_not_ready',
  'seasonal_needs_v06',
])

/** True when the booking's London start is inside the period's notice, as core_v06 tests it. */
export function isInsideChristmasNotice(input: {
  bookingDate: string
  bookingTime: string
  minNoticeHours: number | null | undefined
  now: Date
}): boolean {
  const hours = Number(input.minNoticeHours)
  if (input.minNoticeHours === null || input.minNoticeHours === undefined || !Number.isFinite(hours) || hours <= 0) {
    return false
  }
  const start = whenLondonClockReaches(input.bookingDate, input.bookingTime)
  if (!start) return false
  return start.getTime() < input.now.getTime() + hours * 60 * 60 * 1000
}

/**
 * The refusal behind a blocked result on an accepted Christmas booking, or null when the answer is
 * an ordinary one the website already words (a full slot, no table, a time too near closing).
 *
 * `cut_off` is both "inside the notice" and "too near the kitchen closing", so it is a notice
 * refusal only when the booking really is inside the period's notice.
 */
export function classifyChristmasBlockedReason(
  reason: string | null | undefined,
  input: { bookingDate: string; bookingTime: string; minNoticeHours: number | null | undefined; now: Date },
): ChristmasRefusalCode | null {
  if (!reason) return null
  if (reason === 'period_party_too_small') return 'CHRISTMAS_PARTY_TOO_SMALL'
  if (reason === 'too_large_party' || reason === 'period_party_too_large') return 'CHRISTMAS_PARTY_TOO_LARGE'
  if (reason === 'cut_off') return isInsideChristmasNotice(input) ? 'CHRISTMAS_NOTICE' : null
  if (NOT_AVAILABLE_REASONS.has(reason)) return 'CHRISTMAS_NOT_AVAILABLE'
  return null
}
