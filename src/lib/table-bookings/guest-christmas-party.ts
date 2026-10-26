import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import {
  ChristmasCourseValidationError,
  readChristmasDeadline,
  updateTableBookingPartySizeWithLinkedEventSeats,
} from '@/lib/events/staff-seat-updates'
import { CHRISTMAS_MAX_PARTY_SIZE, CHRISTMAS_MIN_PARTY_SIZE, isChristmasBookingType } from './christmas'
import { getTableManagePreviewByRawToken } from './manage-booking'
import { recordGuestPartySizeChange } from './party-size-alerts'
import { applyPartySizeDepositTransition } from './staff-deposit-transitions'

/**
 * A booker changing the numbers on their Christmas booking from the manage link (BK-053, D21).
 *
 * Until noon seven days before the date the guest can say who is not coming and add guests on 1, 2
 * or 3 courses. After that, or on a Christmas booking with no courses recorded, the page asks them to
 * ring, and a manager makes the change. The change goes through exactly the path staff use
 * (`updateTableBookingPartySizeWithLinkedEventSeats`): the 4 to 20 rule, the table move and its
 * undo, and `change_christmas_party_v01`, which takes the leaving guests' own seats and dishes and
 * closes up the rest. The plain party-size box is never used for a Christmas booking, because the
 * database refuses a size that does not match the course list and the guest would only see an error.
 */

export type GuestChristmasPartyBlockReason =
  | 'invalid_token'
  | 'expired_token'
  | 'booking_not_found'
  | 'booking_not_confirmed'
  | 'not_christmas'
  | 'christmas_call_us'
  | 'christmas_closed'
  | 'christmas_size'
  | 'christmas_no_change'
  | 'christmas_invalid'
  | 'no_table'

export type GuestChristmasPartyResult =
  | {
      state: 'updated'
      tableBookingId: string
      customerId: string | null
      previousPartySize: number
      newPartySize: number
    }
  | { state: 'blocked'; reason: GuestChristmasPartyBlockReason; tableBookingId?: string }

export type GuestChristmasPartyInput = {
  rawToken: string
  /** Seat numbers, as the page showed them, of the guests who are not coming. */
  removedSeats: number[]
  /** How many guests join on each tier. */
  added: { oneCourse: number; twoCourses: number; threeCourses: number }
  appBaseUrl: string
}

function blocked(reason: GuestChristmasPartyBlockReason, tableBookingId?: string): GuestChristmasPartyResult {
  return { state: 'blocked', reason, ...(tableBookingId ? { tableBookingId } : {}) }
}

export async function changeChristmasPartyByRawToken(
  supabase: SupabaseClient<any, 'public', any>,
  input: GuestChristmasPartyInput,
): Promise<GuestChristmasPartyResult> {
  const preview = await getTableManagePreviewByRawToken(supabase, input.rawToken)
  if (preview.state !== 'ready' || !preview.table_booking_id) {
    const reason = preview.reason === 'expired_token' || preview.reason === 'booking_not_found' ? preview.reason : 'invalid_token'
    return blocked(reason)
  }
  const tableBookingId = preview.table_booking_id
  if (!preview.can_edit) return blocked('booking_not_confirmed', tableBookingId)
  if (!isChristmasBookingType(preview.booking_type)) return blocked('not_christmas', tableBookingId)

  const { data: booking, error } = await supabase
    .from('table_bookings')
    .select(
      'id, customer_id, booking_reference, booking_date, party_size, christmas_course_counts, status, payment_status, booking_type, start_datetime, deposit_amount, deposit_amount_locked, deposit_waived, booking_period_id, booking_period_name',
    )
    .eq('id', tableBookingId)
    .maybeSingle()
  if (error) throw error
  if (!booking) return blocked('booking_not_found', tableBookingId)

  const recorded: number[] | null = Array.isArray(booking.christmas_course_counts) ? booking.christmas_course_counts : null
  if (!recorded) return blocked('christmas_call_us', tableBookingId)

  if ((await readChristmasDeadline(supabase, booking.booking_date)) !== 'open') {
    return blocked('christmas_closed', tableBookingId)
  }

  const removedSeats = Array.from(new Set(input.removedSeats)).sort((a, b) => a - b)
  if (removedSeats.some((seat) => !Number.isInteger(seat) || seat < 1 || seat > recorded.length)) {
    return blocked('christmas_invalid', tableBookingId)
  }
  const tiersAdded = [
    ...Array<number>(input.added.oneCourse).fill(1),
    ...Array<number>(input.added.twoCourses).fill(2),
    ...Array<number>(input.added.threeCourses).fill(3),
  ]
  if (removedSeats.length === 0 && tiersAdded.length === 0) return blocked('christmas_no_change', tableBookingId)

  const removed = new Set(removedSeats)
  const nextCourses = [...recorded.filter((_, index) => !removed.has(index + 1)), ...tiersAdded]
  if (nextCourses.length < CHRISTMAS_MIN_PARTY_SIZE || nextCourses.length > CHRISTMAS_MAX_PARTY_SIZE) {
    return blocked('christmas_size', tableBookingId)
  }

  const previousPartySize = Math.max(1, Number(booking.party_size || recorded.length))
  let result: Awaited<ReturnType<typeof updateTableBookingPartySizeWithLinkedEventSeats>>
  try {
    result = await updateTableBookingPartySizeWithLinkedEventSeats(supabase, {
      tableBookingId,
      partySize: nextCourses.length,
      christmasCourseCounts: nextCourses,
      christmasRemovedSeats: removedSeats,
      actor: 'guest',
      sendSms: false,
      appBaseUrl: input.appBaseUrl,
      autoMoveTable: true,
      // A guest never makes a late change: after the deadline a manager does (D21).
    })
  } catch (changeError) {
    if (changeError instanceof ChristmasCourseValidationError) {
      if (/deadline/i.test(changeError.message)) return blocked('christmas_closed', tableBookingId)
      if (/are for \d+ to \d+ guests/.test(changeError.message)) return blocked('christmas_size', tableBookingId)
      return blocked('christmas_invalid', tableBookingId)
    }
    throw changeError
  }

  if (result.state === 'blocked') {
    if (result.reason === 'table_capacity_insufficient' || result.reason === 'table_move_unavailable') {
      return blocked('no_table', tableBookingId)
    }
    return blocked(result.reason === 'booking_not_found' ? 'booking_not_found' : 'booking_not_confirmed', tableBookingId)
  }

  // The deposit is never re-priced automatically on a seasonal booking: the transition says a person
  // has to check it, and that message now reaches the manager instead of being dropped.
  let depositReview: string | null = null
  try {
    const transition = await applyPartySizeDepositTransition(supabase, {
      booking: { ...(booking as Record<string, unknown>), party_size: previousPartySize } as Parameters<
        typeof applyPartySizeDepositTransition
      >[1]['booking'],
      previousPartySize,
      newPartySize: nextCourses.length,
      sendSms: true,
      appBaseUrl: input.appBaseUrl,
    })
    if (transition.state === 'manual_review') depositReview = transition.message
  } catch (depositError) {
    logger.error('Guest Christmas numbers saved but the deposit transition failed', {
      error: depositError instanceof Error ? depositError : new Error(String(depositError)),
      metadata: { tableBookingId, previousPartySize, newPartySize: nextCourses.length },
    })
    depositReview = 'The deposit could not be checked automatically. Check it and handle it manually.'
  }

  await recordGuestPartySizeChange({
    tableBookingId,
    bookingReference: booking.booking_reference ?? null,
    bookingDate: booking.booking_date ?? null,
    previousPartySize,
    newPartySize: nextCourses.length,
    depositReview,
    christmas: { seatsRemoved: removedSeats, tiersAdded },
  })

  return {
    state: 'updated',
    tableBookingId,
    customerId: booking.customer_id ?? null,
    previousPartySize,
    newPartySize: nextCourses.length,
  }
}
