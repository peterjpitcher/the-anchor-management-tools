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

export function assertCleanRender(email: { subject: string; html: string; text: string }): void {
  for (const part of [email.subject, email.html, email.text]) {
    expect(part).not.toMatch(/undefined|Invalid Date|NaN|£0\.00|\bnull\b/)
    expectNoBannedDashes(part)
  }
  // The venue number, readable and dialable, and the sign-off every booking email carries.
  expect(email.text).toContain('01753 682707')
  expect(email.html).toContain('href="tel:+441753682707"')
  expect(email.text.endsWith('The Anchor')).toBe(true)
}

/** A text message body: no broken values, no banned dashes. */
export function assertCleanText(body: string): void {
  expect(body).not.toMatch(/undefined|Invalid Date|NaN|£0\.00|\bnull\b/)
  expectNoBannedDashes(body)
}
