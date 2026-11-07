import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'

/**
 * Inside the Christmas pre-order deadline only the 1 course tier can be booked (owner decision,
 * 10 September 2026; website docs/SSOT.md §7). Two and three courses need menu choices by noon seven
 * days before, so a booking made after that is one course for every guest.
 *
 * Since the food link release (owner decisions D1 and D4, 6 November 2026) 1 course is a main
 * chosen in advance like every other tier, and a Christmas booking is stored with a 0 ("not chosen
 * yet") per guest, which the `table_bookings` trigger writes when a booking arrives with no list.
 * A booking made inside the deadline, which only staff can take now (D2), would sit on those zeros
 * for ever: the organiser's form has already locked, and the kitchen order would count every guest
 * as not chosen when the only tier on offer is 1 course.
 *
 * This records such a booking as one course for every guest, and only once the deadline has passed.
 * Before it, the booking keeps its zeros, because the organiser chooses on the food page. The
 * deadline comes from `christmas_course_policy_v01`, the same database function the booking
 * functions ask, so there is one rule rather than two. The update only ever touches a Christmas
 * booking with nothing chosen yet: no list (an older booking) or a list of zeros. Staff then record
 * each guest's main on the booking, as they can after the cutoff (D8).
 */
export type OneCourseOutcome = 'recorded' | 'not_needed' | 'failed'

/** Every guest on one course, as recorded. */
export function oneCourseForEveryone(partySize: number): number[] {
  return Array.from({ length: Math.max(0, Math.trunc(partySize)) }, () => 1)
}

/**
 * PostgREST filter for "no tier chosen for anyone yet": no list at all (an older booking), or a list
 * whose every seat is 0 (`cd` is Postgres's `<@`, contained by, so every element is in {0}). A new
 * Christmas booking starts on zeros, so `is null` alone stopped matching it once the food link
 * migration had run, and these writes silently matched nothing. A list with any real tier is never
 * matched, so a guest's own choices are never overwritten.
 */
export const NOTHING_CHOSEN_YET = 'christmas_course_counts.is.null,christmas_course_counts.cd.{0}'

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
    .or(NOTHING_CHOSEN_YET)
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
 * they are written straight after it, over the zeros the trigger gave the new booking. The
 * `table_bookings` trigger checks them (one per guest, each 0 to 3, still before the deadline when
 * any guest is on 2 or 3) and sets `booking_period_requires_preorder`. Only a Christmas booking with
 * nothing chosen yet is touched, so a retry can never overwrite tiers recorded since.
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
    .or(NOTHING_CHOSEN_YET)
    .select('id')

  if (error || (updated?.length ?? 0) === 0) {
    logger.error('Could not record the Christmas courses staff chose for a new booking', {
      error: new Error(error?.message ?? 'No Christmas booking with nothing chosen yet matched'),
      metadata: { tableBookingId: booking.id, bookingDate: booking.bookingDate },
    })
    return 'failed'
  }
  return 'recorded'
}
