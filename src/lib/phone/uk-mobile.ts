import { parsePhoneNumberFromString } from 'libphonenumber-js/mobile'

/**
 * True when the number is a real UK mobile, the only kind of number our booking texts reach
 * (BK-162, customer bookings review of 24 October 2026).
 *
 * formatPhoneForStorage (src/lib/phone/index.ts) accepts any number of a possible length, which is
 * right for storing it: landlines, North American numbers and mistyped ones are all kept. But a
 * guest who gives one of those and no email got no confirmation, reminder or payment link, and
 * nobody was told. The booking routes use this to ask for an email instead.
 *
 * Uses libphonenumber's mobile metadata, in which a number is valid only if it is a mobile: a
 * landline, a 070 personal number or Ofcom's 07700 900 drama range is not. +44 covers Guernsey,
 * Jersey and the Isle of Man too, whose mobiles take texts like any UK one. It sits in its own
 * module so the larger metadata never reaches a browser bundle through src/lib/phone/index.ts.
 */
export function isUkMobile(phone: string | null | undefined): boolean {
  if (typeof phone !== 'string' || phone.trim().length === 0) return false
  try {
    const parsed = parsePhoneNumberFromString(phone.trim(), 'GB')
    return Boolean(parsed && parsed.countryCallingCode === '44' && parsed.isValid())
  } catch {
    return false
  }
}

/** The message a public booking route returns for a number that cannot take texts and no email. */
export const EMAIL_REQUIRED_FOR_NON_MOBILE_MESSAGE =
  'We can only text UK mobile numbers. Please add an email address so we can send your booking confirmation.'

export const EMAIL_REQUIRED_FOR_NON_MOBILE_CODE = 'EMAIL_REQUIRED_FOR_NON_MOBILE'
