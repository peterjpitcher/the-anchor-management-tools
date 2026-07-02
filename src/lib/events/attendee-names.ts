/**
 * Per-ticket attendee names for event bookings.
 *
 * Names are an ordered list of full-name strings, one per seat, where index 0
 * is the lead booker ("booker is ticket 1"). They are captured by the public
 * website at booking creation and stored on `bookings.attendee_names`.
 *
 * This module is the single source of truth for validating that list, so the
 * rule is unit-testable and shared by the API route and any future caller.
 */

export const MAX_ATTENDEE_NAME_LENGTH = 120

export type AttendeeNamesResult =
  | { ok: true; names: string[] }
  | { ok: false; error: string }

/**
 * Validate and normalise a caller-supplied attendee-names list.
 *
 * - `undefined`/`null` → treated as "not provided" (valid, empty result). The
 *   caller decides whether names are required (the website enforces them for
 *   paid events; AMS stays lenient so staff/FOH/SMS bookings keep working).
 * - When provided, every entry is trimmed and must be a non-empty string within
 *   {@link MAX_ATTENDEE_NAME_LENGTH}, and the count must equal `seats`.
 */
export function normalizeAttendeeNames(input: unknown, seats: number): AttendeeNamesResult {
  if (input === undefined || input === null) {
    return { ok: true, names: [] }
  }

  if (!Array.isArray(input)) {
    return { ok: false, error: 'attendee_names must be an array of names' }
  }

  const names = input.map((value) => (typeof value === 'string' ? value.trim() : ''))

  if (names.some((name) => name.length === 0)) {
    return { ok: false, error: 'Each ticket needs a name' }
  }

  if (names.some((name) => name.length > MAX_ATTENDEE_NAME_LENGTH)) {
    return {
      ok: false,
      error: `Each name must be ${MAX_ATTENDEE_NAME_LENGTH} characters or fewer`,
    }
  }

  if (names.length !== seats) {
    return {
      ok: false,
      error: `Expected ${seats} ticket name${seats === 1 ? '' : 's'} but received ${names.length}`,
    }
  }

  return { ok: true, names }
}
