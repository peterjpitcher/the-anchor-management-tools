/**
 * Christmas table-booking constants and helpers.
 *
 * Christmas is a distinct `table_booking_type` (alongside `regular` and
 * `sunday_lunch`). The database function `create_table_booking_v05` accepts
 * `p_booking_purpose = 'christmas'`, stamps `booking_type = 'christmas'` and
 * then maps the purpose internally to `'food'`, so `booking_purpose` on the
 * stored row is `'food'` and the Christmas signal lives in `booking_type`.
 *
 * Business rules (owner-confirmed):
 *   - Service window 10 November to 20 December 2026 inclusive.
 *   - Minimum 6 guests, maximum 20 guests (above 20 is private hire).
 *   - A deposit of GBP 10 per person is ALWAYS taken, at any party size.
 *   - At least 24 hours notice, unless staff override the cut-off.
 *
 * The party-size minimum and the 24-hour notice rule are enforced in the
 * database, as is the 21-or-more block. The service window is NOT enforced
 * anywhere yet: nothing currently stops a Christmas booking being taken for a
 * date outside 10 November to 20 December 2026. Whoever adds the customer-
 * facing Christmas form must restrict the date picker, or the window needs
 * adding to the database function.
 *
 * This module only carries the values the UI needs to show and the type helpers
 * the application layer needs to route deposits correctly.
 */

export const CHRISTMAS_BOOKING_TYPE = 'christmas'

/** Minimum party size for a Christmas booking (enforced in the database). */
export const CHRISTMAS_MIN_PARTY_SIZE = 6

/** Maximum party size for a table booking of any type; above this is private hire. */
export const CHRISTMAS_MAX_PARTY_SIZE = 20

/** Minimum notice in hours for a Christmas booking (staff can override). */
export const CHRISTMAS_MIN_NOTICE_HOURS = 24

/**
 * True when a stored booking row (or an RPC result) is a Christmas booking.
 * Accepts the raw `booking_type` value, which may be null on partial selects.
 */
export function isChristmasBookingType(bookingType: string | null | undefined): boolean {
  return bookingType === CHRISTMAS_BOOKING_TYPE
}

/**
 * True when a create-booking request purpose asks for a Christmas booking.
 * The public and FOH APIs both accept `'christmas'` as a booking purpose.
 */
export function isChristmasPurpose(purpose: string | null | undefined): boolean {
  return purpose === CHRISTMAS_BOOKING_TYPE
}

/**
 * The value that ends up in the `booking_purpose` column for a given request
 * purpose. Christmas maps to `'food'` (kitchen hours, duration and pacing all
 * behave exactly as for a food booking); everything else passes through.
 */
export function toStoredBookingPurpose<T extends string>(
  purpose: T,
): Exclude<T, typeof CHRISTMAS_BOOKING_TYPE> | 'food' {
  return isChristmasPurpose(purpose)
    ? 'food'
    : (purpose as Exclude<T, typeof CHRISTMAS_BOOKING_TYPE>)
}

/**
 * The `booking_type` a given request purpose produces.
 */
export function toBookingType(purpose: string): 'christmas' | 'regular' {
  return isChristmasPurpose(purpose) ? CHRISTMAS_BOOKING_TYPE : 'regular'
}

/**
 * The database raises customer-appropriate exceptions for Christmas rule
 * breaches (party size below the minimum, insufficient notice). Those messages
 * are safe to show verbatim, so surface them rather than a generic 500.
 * Returns the message when the error is one of ours, otherwise null.
 */
export function extractChristmasRuleErrorMessage(
  error: { message?: string | null } | null | undefined,
): string | null {
  const message = error?.message?.trim()
  if (!message) return null
  return message.startsWith('Christmas bookings ') ? message : null
}
