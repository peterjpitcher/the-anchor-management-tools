import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'

/**
 * Inside the Christmas pre-order deadline only the 1 course tier can be booked (owner decision,
 * 10 September 2026; website docs/SSOT.md §7). Two and three courses need menu choices by noon seven
 * days before, so a booking made after that can only be one course, which needs no pre-order.
 *
 * The website's booking form already obeys this: it sends a course for every guest, and
 * `create_table_booking_christmas_v01` refuses two or three courses once the deadline has passed.
 * Two ways in still arrive with no courses at all: a booking staff take at the bar or on the phone,
 * and an older public client. Those were stored with no courses, which the pre-order screens read as
 * "every guest owes a main", so a party booked three days out was chased for choices that the
 * locked form could no longer take.
 *
 * This records such a booking as one course for every guest, and only once the deadline has passed.
 * Before it, the booking keeps its existing policy, because the booker can still pre-order. The
 * deadline comes from `christmas_course_policy_v01`, the same database function the booking
 * functions ask, so there is one rule rather than two. The update only ever touches a Christmas
 * booking that has no courses recorded; the database trigger on `table_bookings` then clears
 * `booking_period_requires_preorder`, which is what keeps the reminder cron away.
 */
export type OneCourseOutcome = 'recorded' | 'not_needed' | 'failed'

/** Every guest on one course, as recorded. */
export function oneCourseForEveryone(partySize: number): number[] {
  return Array.from({ length: Math.max(0, Math.trunc(partySize)) }, () => 1)
}

type CoursePolicy = { multiple_courses_available?: boolean } | null

export async function recordOneCourseInsideCutoff(
  // Untyped schema, as in staff-seat-updates.ts: the generated types predate both the
  // christmas_course_counts column and the policy function.
  supabase: SupabaseClient<any, 'public', any>,
  booking: { id: string; bookingDate: string; partySize: number }
): Promise<OneCourseOutcome> {
  const { data, error: policyError } = await supabase.rpc('christmas_course_policy_v01', {
    p_booking_date: booking.bookingDate,
  })
  if (policyError) {
    logger.warn('Could not read the Christmas course policy after creating a booking', {
      metadata: { tableBookingId: booking.id, bookingDate: booking.bookingDate, error: policyError.message },
    })
    return 'failed'
  }

  // No policy means the date is not in a live Christmas period, or courses are not switched on.
  const policy = data as CoursePolicy
  if (!policy || policy.multiple_courses_available !== false) return 'not_needed'

  const partySize = Math.trunc(booking.partySize)
  if (!Number.isFinite(partySize) || partySize < 1) return 'not_needed'

  const { data: updated, error: updateError } = await supabase
    .from('table_bookings')
    .update({ christmas_course_counts: oneCourseForEveryone(partySize) })
    .eq('id', booking.id)
    .eq('booking_type', 'christmas')
    .is('christmas_course_counts', null)
    .select('id')

  if (updateError) {
    logger.warn('Could not record a late Christmas booking as one course', {
      metadata: { tableBookingId: booking.id, bookingDate: booking.bookingDate, error: updateError.message },
    })
    return 'failed'
  }

  return (updated?.length ?? 0) > 0 ? 'recorded' : 'not_needed'
}
