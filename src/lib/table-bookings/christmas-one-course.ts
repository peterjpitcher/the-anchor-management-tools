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

export type ChristmasCourseAvailability = 'available' | 'closed' | 'unknown'

/**
 * Whether 2 and 3 courses can still be booked for this date, from the same database function the
 * booking functions and the `table_bookings` trigger ask. `closed` covers both "the pre-order
 * deadline has passed" and "the date is not in a live Christmas period"; `unknown` is a failed read.
 */
export async function getChristmasCourseAvailability(
  supabase: SupabaseClient<any, 'public', any>,
  bookingDate: string
): Promise<ChristmasCourseAvailability> {
  const { data, error } = await supabase.rpc('christmas_course_policy_v01', { p_booking_date: bookingDate })
  if (error) {
    logger.error('Could not read the Christmas course policy before a staff booking', {
      error: new Error(error.message),
      metadata: { bookingDate },
    })
    return 'unknown'
  }
  const policy = data as CoursePolicy
  return policy?.multiple_courses_available === true ? 'available' : 'closed'
}

/**
 * Record the course tiers staff chose for each guest on a Christmas booking they have just taken
 * (BK-057). Staff bookings go through `create_table_booking_staff_v06`, which takes no tiers, so
 * they are written straight after it. The `table_bookings` trigger checks them (one per guest, each
 * 1 to 3, still before the deadline when any guest is on 2 or 3) and sets
 * `booking_period_requires_preorder` from them. Only a Christmas booking with no tiers yet is
 * touched, so a retry can never overwrite tiers recorded since.
 *
 * A failure is logged as an error rather than thrown: the booking already exists and staff can set
 * the tiers from the booking page, which the caller tells them to do.
 */
export async function recordChristmasCourseCounts(
  supabase: SupabaseClient<any, 'public', any>,
  booking: { id: string; bookingDate: string },
  courseCounts: number[]
): Promise<'recorded' | 'failed'> {
  const { data: updated, error } = await supabase
    .from('table_bookings')
    .update({ christmas_course_counts: courseCounts })
    .eq('id', booking.id)
    .eq('booking_type', 'christmas')
    .is('christmas_course_counts', null)
    .select('id')

  if (error || (updated?.length ?? 0) === 0) {
    logger.error('Could not record the Christmas courses staff chose for a new booking', {
      error: new Error(error?.message ?? 'No Christmas booking without courses matched'),
      metadata: { tableBookingId: booking.id, bookingDate: booking.bookingDate },
    })
    return 'failed'
  }
  return 'recorded'
}
