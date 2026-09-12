/**
 * When a table booking review request may go out.
 *
 * Two rules, both from the 11 September review of what guests actually received:
 *
 *  - Only a booking somebody sat at. 40 of the 110 review requests in the last 90 days went to
 *    bookings that were never marked as seated, so the pub was asking "how was your visit?" of
 *    people who may never have arrived. `seated_at` is the only record that a party was in the
 *    building; the sweep now requires it.
 *  - Only between 09:00 and 21:00 London. The request fires four hours after the sitting starts,
 *    which for an evening table is the middle of the night, and the cron runs every quarter of an
 *    hour, so deferring costs at most fifteen minutes past nine in the morning.
 *
 * The hours are read on the London clock through `formatTimeInLondon`, never from the host's
 * timezone: the serverless runtime is UTC, and for seven months of the year that is an hour out.
 */

import { formatTimeInLondon } from '@/lib/dateUtils'

/** First hour a review request may go out, London. */
export const REVIEW_SEND_WINDOW_START_HOUR = 9
/** First hour it may not, London. 21 means the last send is at 20:59. */
export const REVIEW_SEND_WINDOW_END_HOUR = 21

/** True when the London clock is inside the window review requests may be sent in. */
export function isWithinReviewSendWindow(now: Date = new Date()): boolean {
  const hour = Number(formatTimeInLondon(now).slice(0, 2))
  if (!Number.isFinite(hour)) return false
  return hour >= REVIEW_SEND_WINDOW_START_HOUR && hour < REVIEW_SEND_WINDOW_END_HOUR
}

/** True when this booking has a record of the party actually being seated. */
export function hasBeenSeated(booking: { seated_at?: string | null }): boolean {
  const seatedAt = booking.seated_at
  if (!seatedAt) return false
  return Number.isFinite(Date.parse(seatedAt))
}
