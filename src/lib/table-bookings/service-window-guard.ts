/**
 * The database's refusal of a food booking outside a kitchen service.
 *
 * `table_bookings_service_window_guard` (migration 20260815190000) raises SQLSTATE 22023 with
 * "The kitchen is not serving at HH:MM on DD Mon YYYY. Please choose a time inside a food
 * service." whenever a food booking would arrive less than 30 minutes before a service ends, or
 * between services. It fires on every write to `table_bookings`: the create functions, the
 * time-change function and a direct update alike.
 *
 * The routes used to treat it as an unknown failure, so on 9 September 2026 staff adding walk-ins
 * read "Failed to create table booking" seven times with no hint that the time was the problem.
 */

const SERVICE_WINDOW_GUARD_SQLSTATE = '22023'
const SERVICE_WINDOW_GUARD_PREFIX = 'The kitchen is not serving at '

/**
 * Returns the guard's own sentence when `error` is its refusal, otherwise null.
 *
 * The wording is written for staff and is safe to show them unchanged. The public route should
 * not show it: it answers with the usual `outside_service_window` block, so the website words it.
 *
 * Takes `unknown` because the walk-in fallback rethrows the PostgREST error object as it is,
 * which is not an `Error`. When a code is present it must be the guard's; an error rewrapped
 * without one is matched on the sentence alone.
 */
export function extractServiceWindowRuleErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null

  const { code, message } = error as { code?: unknown; message?: unknown }
  if (typeof message !== 'string') return null

  const sentence = message.trim()
  if (!sentence.startsWith(SERVICE_WINDOW_GUARD_PREFIX)) return null
  if (typeof code === 'string' && code !== '' && code !== SERVICE_WINDOW_GUARD_SQLSTATE) return null

  return sentence
}
