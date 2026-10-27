import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { isChristmasBookingType } from '@/lib/table-bookings/christmas'
import { requiresDeposit } from '@/lib/table-bookings/deposit'

/**
 * Before a no-show is put back (Mark Confirmed or Seat Guests on a no-show booking), its table must
 * still be free and its deposit must still be held (BK-048, customer bookings review of 24 October
 * 2026).
 *
 * A booking marked no-show keeps its table assignment, but the overlap check lives on the
 * assignments, not on a status change, so the table may since have gone to someone else. And a
 * deposit refunded after the no-show still read as paid, because the capture id stays on the
 * booking. Either way the booking came back live: a double-booked table, or a 15+ or Christmas
 * booking with no deposit that every list showed as paid.
 *
 * Returns null when the booking can come back, or the sentence for staff when it cannot. Fails
 * closed: a check that cannot run refuses.
 */

export type ReinstateBooking = {
  id: string
  status: string | null
  payment_status: string | null
  deposit_waived: boolean | null
  party_size: number | null
  committed_party_size?: number | null
  booking_type?: string | null
}

const INACTIVE_STATUSES = new Set(['cancelled', 'no_show', 'completed'])

export async function checkNoShowCanComeBack(
  supabase: SupabaseClient<any, 'public', any>,
  booking: ReinstateBooking
): Promise<string | null> {
  if (depositWasRefunded(booking)) {
    return 'The deposit on this booking has been refunded, so it cannot be put back without a new one. Make a new booking instead.'
  }

  const { data: mine, error: mineError } = await supabase
    .from('booking_table_assignments')
    .select('table_id, start_datetime, end_datetime')
    .eq('table_booking_id', booking.id)

  if (mineError) {
    logger.error('Could not read the tables of a no-show booking before putting it back', {
      error: new Error(mineError.message),
      metadata: { bookingId: booking.id },
    })
    return 'Could not check the table is still free, so the booking was not put back. Try again.'
  }

  const slots = (mine ?? []).filter(
    (row): row is { table_id: string; start_datetime: string; end_datetime: string } =>
      typeof row?.table_id === 'string' && typeof row?.start_datetime === 'string' && typeof row?.end_datetime === 'string'
  )
  if (slots.length === 0) return null

  const earliest = slots.reduce((min, slot) => (slot.start_datetime < min ? slot.start_datetime : min), slots[0].start_datetime)
  const latest = slots.reduce((max, slot) => (slot.end_datetime > max ? slot.end_datetime : max), slots[0].end_datetime)

  const { data: others, error: othersError } = await supabase
    .from('booking_table_assignments')
    .select('table_id, table_booking_id, start_datetime, end_datetime')
    .in('table_id', Array.from(new Set(slots.map((slot) => slot.table_id))))
    .neq('table_booking_id', booking.id)
    .lt('start_datetime', latest)
    .gt('end_datetime', earliest)

  if (othersError) {
    logger.error('Could not read other bookings on the tables of a no-show booking', {
      error: new Error(othersError.message),
      metadata: { bookingId: booking.id },
    })
    return 'Could not check the table is still free, so the booking was not put back. Try again.'
  }

  const overlapping = (others ?? []).filter((row) =>
    slots.some(
      (slot) =>
        slot.table_id === row?.table_id &&
        String(row?.start_datetime) < slot.end_datetime &&
        String(row?.end_datetime) > slot.start_datetime
    )
  )
  const otherIds = Array.from(
    new Set(overlapping.map((row) => row?.table_booking_id).filter((id): id is string => typeof id === 'string'))
  )
  if (otherIds.length === 0) return null

  const { data: otherBookings, error: otherBookingsError } = await supabase
    .from('table_bookings')
    .select('id, booking_reference, status, left_at')
    .in('id', otherIds)

  if (otherBookingsError) {
    logger.error('Could not read the bookings sharing the table of a no-show booking', {
      error: new Error(otherBookingsError.message),
      metadata: { bookingId: booking.id },
    })
    return 'Could not check the table is still free, so the booking was not put back. Try again.'
  }

  const clash = (otherBookings ?? []).find((row) => !INACTIVE_STATUSES.has(String(row?.status)) && !row?.left_at)
  if (!clash) return null

  const reference = typeof clash.booking_reference === 'string' && clash.booking_reference ? clash.booking_reference : 'another booking'
  return `Its table is now booked by ${reference} at that time, so this booking cannot be put back. Move one of them first.`
}

/** A deposit the rules require, taken and then refunded in full. */
function depositWasRefunded(booking: ReinstateBooking): boolean {
  if (booking.deposit_waived === true) return false
  if (booking.payment_status !== 'refunded') return false
  const partySize = Math.max(0, Number(booking.committed_party_size ?? booking.party_size ?? 0))
  return requiresDeposit(partySize, { isChristmas: isChristmasBookingType(booking.booking_type) })
}
