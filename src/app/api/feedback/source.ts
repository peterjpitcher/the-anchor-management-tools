// Provenance tag for feedback submissions. The /feedback landing page carries
// an optional ?src= query param through to the tell-us form, and the POST
// handler stores it in the `source` column so submissions can be traced back
// to the ask that prompted them (e.g. a specific SMS campaign).

const SOURCE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i

export const DEFAULT_FEEDBACK_SOURCE = 'review-funnel'

// Returns the trimmed source when it is a safe, short identifier; null otherwise.
export function sanitizeFeedbackSource(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return SOURCE_PATTERN.test(trimmed) ? trimmed : null
}
