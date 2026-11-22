/**
 * Why a guest did not make their table booking, as they tell us from the morning-after no-show
 * email (owner decisions of 22 November 2026). One definition, shared by the guest form, the
 * route that saves the answer and the staff booking page. No server imports, so the staff page
 * (a client component) can read it.
 *
 * Answering is OPTIONAL, like the cancellation reason: nothing here is ever required. The list is
 * the owner's, and it is not about blame: it is there to find what made booking hard.
 */

export const NO_SHOW_REASONS = [
  { code: 'plans_changed', label: 'My plans changed' },
  { code: 'forgot', label: 'I forgot' },
  // The two that say something went wrong at our end, kept apart so a report can count them.
  { code: 'could_not_cancel', label: "I tried to cancel or change it and couldn't" },
  { code: 'did_not_know_how_to_cancel', label: "I didn't know how to cancel" },
  { code: 'on_the_day', label: 'Something came up on the day (illness, travel, weather)' },
  { code: 'booked_by_mistake', label: 'I booked by mistake or booked twice' },
  { code: 'other', label: 'Other' },
] as const

export type NoShowReasonCode = (typeof NO_SHOW_REASONS)[number]['code']

const REASON_CODES = new Set<string>(NO_SHOW_REASONS.map((reason) => reason.code))

export const NO_SHOW_REASON_DETAIL_MAX_LENGTH = 300

/**
 * What is written to table_bookings.no_show_guest_reason: `code`, or `code: their words`, the
 * shape cancellation_reason already uses, so a report can split on the first colon. Words with no
 * choice ticked are kept under `other`. Null when the guest gave neither.
 */
export function formatNoShowReason(code: unknown, detail: unknown): string | null {
  const words =
    typeof detail === 'string' ? detail.trim().replace(/\s+/g, ' ').slice(0, NO_SHOW_REASON_DETAIL_MAX_LENGTH) : ''
  const known = typeof code === 'string' && REASON_CODES.has(code) ? code : null
  if (!known) return words ? `other: ${words}` : null
  return words ? `${known}: ${words}` : known
}

/** A stored reply in staff words, for the booking page. Null when the guest has not replied. */
export function describeNoShowGuestReply(input: {
  response: string | null | undefined
  reason: string | null | undefined
}): string | null {
  if (input.response === 'attended') return 'Said they did come in'
  if (input.response !== 'could_not_make_it') return null
  const stored = input.reason?.trim()
  if (!stored) return "Said they couldn't make it (no reason given)"
  const separator = stored.indexOf(':')
  const code = separator === -1 ? stored : stored.slice(0, separator).trim()
  const words = separator === -1 ? '' : stored.slice(separator + 1).trim()
  const label = NO_SHOW_REASONS.find((reason) => reason.code === code)?.label ?? code
  return `Couldn't make it: ${label}${words ? `. "${words}"` : ''}`
}
