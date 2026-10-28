import { expect } from 'vitest'
import { getIsoWeekday } from '@/lib/dateUtils'

/**
 * Fixture-render checks for guest emails. Every broken value that has reached a real guest
 * (undefined, Invalid Date, NaN, a zero amount) fails here, and so does a stray dash character
 * the house style bans. Run from tests that execute in both the London and the UTC suite.
 */

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** En dash and em dash, built from their code points so no source file carries them. */
const BANNED_DASH_CHARACTERS = [String.fromCharCode(0x2013), String.fromCharCode(0x2014)]

function expectNoBannedDashes(value: string): void {
  for (const dash of BANNED_DASH_CHARACTERS) {
    expect(value.includes(dash)).toBe(false)
  }
}

/** "Saturday 12 September 2026", worked out from the calendar rather than a date formatter. */
export function expectedLongDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const weekday = getIsoWeekday(isoDate)
  if (!weekday) throw new Error(`Not a calendar date: ${isoDate}`)
  return `${WEEKDAYS[weekday - 1]} ${day} ${MONTHS[month - 1]} ${year}`
}

/**
 * Wording that means a value was missing when the message was built (BK-221): a broken value, a
 * zero amount in any form ("£0", "£0.00", "GBP 0"), a fallback that stands in for a time we did
 * not have, a doubled deposit label, and a greeting that fell back to "there" with no "Hi".
 * A real amount under a pound ("£0.50") is allowed.
 */
export const BROKEN_MESSAGE_PATTERNS: RegExp[] = [
  /undefined|Invalid Date|NaN|\bnull\b/,
  /£\s?0(?:\.0+)?(?![\d.])/,
  /\bGBP\s?0(?:\.0+)?(?![\d.])/,
  /your booking time/i,
  /your event time/i,
  /deposit of the deposit/i,
  /(?:^|[:.!?]\s+)there,/i,
]

function expectNoBrokenValues(value: string): void {
  for (const pattern of BROKEN_MESSAGE_PATTERNS) {
    expect(value).not.toMatch(pattern)
  }
}

export function assertCleanRender(email: { subject: string; html: string; text: string }): void {
  for (const part of [email.subject, email.html, email.text]) {
    expectNoBrokenValues(part)
    expectNoBannedDashes(part)
  }
  // The venue number, readable and dialable, and the sign-off every booking email carries.
  expect(email.text).toContain('01753 682707')
  expect(email.html).toContain('href="tel:+441753682707"')
  expect(email.text.endsWith('The Anchor')).toBe(true)
}

/** A text message body: no broken values, no banned dashes. */
export function assertCleanText(body: string): void {
  expectNoBrokenValues(body)
  expectNoBannedDashes(body)
}

/**
 * A text message body that must also stay in the GSM-7 alphabet: no curly quotes or other
 * characters that switch the message to UCS-2 and cut each segment from 160 characters to 70.
 */
export function assertCleanGsmText(body: string): void {
  assertCleanText(body)
  expect(body).toMatch(/^[A-Za-z0-9 \n\r@£$¥!"#%&'()*+,\-./:;<=>?_¡¿ÄÅÆÇÉÑÖØÜßàäåæèéìñòöøùü§]*$/)
}
