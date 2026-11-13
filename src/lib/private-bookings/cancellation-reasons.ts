/**
 * Why staff cancelled a private booking or enquiry (growth review of 13 November 2026).
 *
 * Of 13 website private hire enquiries cancelled since May 2026, 10 were stored as "Cancelled by
 * staff" or "Cancelled from list view", so nobody could say why enquiries were being lost. Every
 * cancellation a member of staff makes now names one of these reasons. The list is the owner's:
 * add to it only when asked.
 *
 * One definition, shared by the two cancel dialogs and the server action's validation, so they
 * cannot drift apart. Automatic cancellations (a deposit hold that ran out) keep their own wording
 * and do not come through here.
 *
 * Kept free of server imports so the client dialogs can read the same list.
 */

export const PRIVATE_BOOKING_CANCELLATION_REASONS = [
  { code: 'date_unavailable', label: 'Date not available', needsNote: false },
  { code: 'price', label: 'Price', needsNote: false },
  { code: 'group_too_big', label: 'Group too big for the space', needsNote: false },
  { code: 'no_reply', label: 'Customer did not reply', needsNote: false },
  { code: 'chose_elsewhere', label: 'Customer chose somewhere else', needsNote: false },
  { code: 'duplicate_or_test', label: 'Duplicate or test enquiry', needsNote: false },
  { code: 'other', label: 'Other', needsNote: true },
] as const

export type PrivateBookingCancellationReasonCode = (typeof PRIVATE_BOOKING_CANCELLATION_REASONS)[number]['code']

export type PrivateBookingCancellationReasonInput = {
  code: PrivateBookingCancellationReasonCode
  /** Optional, except for "Other", where a short note is required. */
  note?: string | null
}

export const PRIVATE_BOOKING_CANCELLATION_NOTE_MAX_LENGTH = 300

export const CANCELLATION_REASON_REQUIRED_MESSAGE = 'Choose why this booking is being cancelled'
export const CANCELLATION_NOTE_REQUIRED_MESSAGE = 'Add a short note saying why this booking is being cancelled'

function findReason(code: unknown) {
  return typeof code === 'string'
    ? PRIVATE_BOOKING_CANCELLATION_REASONS.find((reason) => reason.code === code) ?? null
    : null
}

function cleanNote(note: unknown): string {
  return typeof note === 'string'
    ? note.trim().replace(/\s+/g, ' ').slice(0, PRIVATE_BOOKING_CANCELLATION_NOTE_MAX_LENGTH)
    : ''
}

/**
 * Checks a reason and builds what is written to `private_bookings.cancellation_reason`.
 *
 * The stored value is the code on its own, or `code: note`, the same shape table bookings use
 * (src/lib/table-bookings/cancellation-reasons.ts): a report can split on the first colon to count
 * by reason without losing what staff typed. The existing column fits, so there is no new one.
 */
export function resolvePrivateBookingCancellationReason(
  input: unknown
): { ok: true; stored: string } | { ok: false; error: string } {
  const record = input && typeof input === 'object' ? (input as { code?: unknown; note?: unknown }) : null
  const reason = findReason(record?.code)
  if (!reason) return { ok: false, error: CANCELLATION_REASON_REQUIRED_MESSAGE }

  const note = cleanNote(record?.note)
  if (reason.needsNote && note.length === 0) return { ok: false, error: CANCELLATION_NOTE_REQUIRED_MESSAGE }

  return { ok: true, stored: note.length > 0 ? `${reason.code}: ${note}` : reason.code }
}

/**
 * The label for a stored value, for staff screens and reports. Older free text ("Cancelled by
 * staff") and the automatic wordings ("Deposit hold expired") come back as they were written.
 */
export function privateBookingCancellationReasonLabel(stored: string | null | undefined): string | null {
  if (!stored) return null
  const separator = stored.indexOf(':')
  const code = separator === -1 ? stored : stored.slice(0, separator).trim()
  const reason = findReason(code)
  if (!reason) return stored
  const note = separator === -1 ? '' : stored.slice(separator + 1).trim()
  return note ? `${reason.label}: ${note}` : reason.label
}
