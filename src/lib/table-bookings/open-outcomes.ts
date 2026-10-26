import type { SupabaseClient } from '@supabase/supabase-js'
import { shiftIsoDate } from '@/lib/dateUtils'

/**
 * Table bookings from earlier days that nobody marked (BK-130, customer bookings review of 24
 * October 2026; owner decision D13). A booking nobody seated, saw leave or marked as a no-show
 * stays 'confirmed' for good: the owner ruled out an overnight sweep on 6 August 2026, because the
 * review request needs the booking confirmed. So FOH and BOH list them in a 'Still open from
 * earlier' strip with one-tap Arrived and No-show.
 *
 * The strip covers the review window: after seven days a booking leaves the list unmarked, and
 * reads as 'not recorded', never as a no-show.
 *
 * A table booking made for an event booking is left out: who came to an event is ticked on the
 * event page.
 */
export const OPEN_OUTCOME_LOOKBACK_DAYS = 7

export type OpenEarlierTableBooking = {
  id: string
  bookingReference: string | null
  bookingDate: string
  bookingTime: string
  partySize: number
  guestName: string
}

type Row = {
  id: string
  booking_reference: string | null
  booking_date: string
  booking_time: string
  party_size: number | null
  customer: { first_name: string | null; last_name: string | null } | Array<{ first_name: string | null; last_name: string | null }> | null
}

/** The days the strip covers: the seven before the trading day the floor is working. */
export function openOutcomeWindow(tradingDayIso: string): { fromIso: string; beforeIso: string } {
  const fromIso = shiftIsoDate(tradingDayIso, -OPEN_OUTCOME_LOOKBACK_DAYS)
  if (!fromIso) throw new Error(`Invalid trading day: ${tradingDayIso}`)
  return { fromIso, beforeIso: tradingDayIso }
}

export async function loadOpenEarlierTableBookings(
  // `any` as in src/lib/foh/bookings.ts: the session and admin clients are typed differently, and both work here.
  supabase: SupabaseClient<any, 'public', any>,
  tradingDayIso: string
): Promise<OpenEarlierTableBooking[]> {
  const { fromIso, beforeIso } = openOutcomeWindow(tradingDayIso)
  const { data, error } = await supabase
    .from('table_bookings')
    .select('id, booking_reference, booking_date, booking_time, party_size, customer:customers!table_bookings_customer_id_fkey(first_name,last_name)')
    .eq('status', 'confirmed')
    .is('seated_at', null)
    .is('left_at', null)
    .is('no_show_at', null)
    .is('event_booking_id', null)
    .gte('booking_date', fromIso)
    .lt('booking_date', beforeIso)
    .order('booking_date', { ascending: true })
    .order('booking_time', { ascending: true })
    .limit(200)

  if (error) throw new Error(error.message)

  return ((data ?? []) as Row[]).map((row) => {
    const customer = Array.isArray(row.customer) ? row.customer[0] ?? null : row.customer
    const guestName = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ').trim()
    return {
      id: row.id,
      bookingReference: row.booking_reference,
      bookingDate: row.booking_date,
      bookingTime: row.booking_time,
      partySize: Number(row.party_size ?? 0),
      guestName: guestName || 'Guest',
    }
  })
}
