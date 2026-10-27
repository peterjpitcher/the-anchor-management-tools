import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { isChristmasBookingType } from '@/lib/table-bookings/christmas'

type Db = SupabaseClient<any, any, any>

export type GuestChristmasParty = {
  /** Each guest's tier, in seat order. Null on a Christmas booking taken with none recorded. */
  courseCounts: number[] | null
  /** The name the booker gave each seat, if any, in seat order. */
  seatNames: Array<string | null>
  /** True until noon seven days before the date (D21). After that a manager changes the numbers. */
  canChangeOnline: boolean
  /** When online changes close, or null when the date has no Christmas course policy. */
  closesAt: Date | null
}

/**
 * What the Christmas numbers form on the guest manage page needs, or null when the booking is not a
 * Christmas one. A failed read of the deadline says "ring us" rather than guessing the form is open.
 */
export async function loadGuestChristmasParty(supabase: Db, tableBookingId: string): Promise<GuestChristmasParty | null> {
  const { data: booking, error } = await supabase
    .from('table_bookings')
    .select('booking_type, booking_date, christmas_course_counts')
    .eq('id', tableBookingId)
    .maybeSingle()
  if (error) throw error
  if (!booking || !isChristmasBookingType(booking.booking_type ?? null)) return null

  const courseCounts: number[] | null = Array.isArray(booking.christmas_course_counts) ? booking.christmas_course_counts : null

  let seatNames: Array<string | null> = []
  if (courseCounts) {
    const { data: covers, error: coversError } = await supabase
      .from('booking_preorder_covers')
      .select('ordinal, guest_name')
      .eq('table_booking_id', tableBookingId)
    if (coversError) throw coversError
    const names = new Map(
      ((covers ?? []) as Array<{ ordinal: number; guest_name: string | null }>).map((cover) => [cover.ordinal, cover.guest_name?.trim() || null]),
    )
    seatNames = courseCounts.map((_, index) => names.get(index + 1) ?? null)
  }

  const { data: policy, error: policyError } = await supabase.rpc('christmas_course_policy_v01', {
    p_booking_date: booking.booking_date,
  })
  if (policyError) {
    logger.error('Guest manage page could not read the Christmas pre-order deadline', {
      error: new Error(policyError.message),
      metadata: { tableBookingId },
    })
  }
  const closesAtRaw = !policyError && policy && typeof policy.preorder_closes_at === 'string' ? policy.preorder_closes_at : null
  const closesAt = closesAtRaw && Number.isFinite(Date.parse(closesAtRaw)) ? new Date(closesAtRaw) : null

  return {
    courseCounts,
    seatNames,
    canChangeOnline: !policyError && policy?.multiple_courses_available === true,
    closesAt,
  }
}
