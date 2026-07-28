/**
 * Why a guest cancelled their table booking.
 *
 * One definition, shared by the guest form, the action route's validation and any reporting, so the
 * three cannot drift apart.
 *
 * Two rules the owner set, and they matter more than the list itself:
 *
 *   1. Answering is OPTIONAL. A guest who will not say why must still be able to cancel. Nothing here
 *      is ever required, and the plain cancel link works without touching this at all.
 *
 *   2. `booking_problem` is deliberately separate from `other`. It is the one answer that says
 *      something went wrong at our end rather than theirs, and it should be visible in a report
 *      rather than buried in free text.
 *
 * The list is short on purpose. Long lists get less honest answers, and one can be added once real
 * answers come in.
 */

export const CANCELLATION_REASONS = [
  { code: 'plans_changed', label: 'Plans changed', wantsDetail: false },
  { code: 'wrong_date_time', label: 'Booked the wrong date or time', wantsDetail: false },
  { code: 'party_size_changed', label: 'Party size changed', wantsDetail: false },
  { code: 'unwell', label: 'Someone is unwell', wantsDetail: false },
  { code: 'going_elsewhere', label: 'Going somewhere else', wantsDetail: false },
  { code: 'booking_problem', label: "Something about the booking wasn't right", wantsDetail: true },
  { code: 'other', label: 'Other', wantsDetail: true },
] as const

export type CancellationReasonCode = (typeof CANCELLATION_REASONS)[number]['code']

const CODES = new Set<string>(CANCELLATION_REASONS.map((r) => r.code))

export function isCancellationReasonCode(value: unknown): value is CancellationReasonCode {
  return typeof value === 'string' && CODES.has(value)
}

export const CANCELLATION_DETAIL_MAX_LENGTH = 300

/**
 * Builds what gets written to `table_bookings.cancellation_reason`.
 *
 * Format is `code` on its own, or `code: free text`. One column has to carry both, and this keeps it
 * greppable and groupable: a report can split on the first colon to count by reason, without losing
 * what the guest actually typed.
 *
 * Returns null when there is nothing worth storing, so an unanswered cancellation stays null rather
 * than becoming a meaningless empty string.
 */
export function formatCancellationReason(
  code: unknown,
  detail: unknown
): string | null {
  if (!isCancellationReasonCode(code)) return null

  const trimmed =
    typeof detail === 'string'
      ? detail.trim().replace(/\s+/g, ' ').slice(0, CANCELLATION_DETAIL_MAX_LENGTH)
      : ''

  return trimmed.length > 0 ? `${code}: ${trimmed}` : code
}

/** Splits a stored value back apart, for reporting and staff screens. */
export function parseCancellationReason(
  stored: string | null | undefined
): { code: string | null; detail: string | null } {
  if (!stored) return { code: null, detail: null }

  const separator = stored.indexOf(':')
  if (separator === -1) return { code: stored, detail: null }

  return {
    code: stored.slice(0, separator).trim(),
    detail: stored.slice(separator + 1).trim() || null,
  }
}

/** The human label for a stored value, for staff screens and reports. */
export function cancellationReasonLabel(stored: string | null | undefined): string | null {
  const { code } = parseCancellationReason(stored)
  if (!code) return null
  return CANCELLATION_REASONS.find((r) => r.code === code)?.label ?? code
}
