/**
 * Reading and answering a booking_confirm token.
 *
 * Split from the page and the route because both need it and neither should own it: the
 * page reads to render, the route reads to write, and a difference between the two reads
 * is how a guest ends up confirming a booking the page told them was already cancelled.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { hashGuestToken } from '@/lib/guest/tokens'

export type ConfirmTokenBooking = {
  id: string
  bookingReference: string
  bookingDate: string
  bookingTime: string | null
  partySize: number | null
  status: string
  guestConfirmedAt: string | null
  customerFirstName: string | null
}

export type ConfirmTokenLookup =
  | { ok: true; booking: ConfirmTokenBooking }
  | { ok: false; reason: 'not_found' | 'expired' | 'booking_missing' }

/**
 * Resolve a raw token to its booking, or say precisely why not.
 *
 * A bad token and an expired token are told apart for the guest's benefit, not the
 * attacker's: both render a page that offers the pub's phone number, and neither reveals
 * whether the token ever existed.
 */
export async function lookupConfirmToken(
  supabase: SupabaseClient<any, 'public', any>,
  rawToken: string
): Promise<ConfirmTokenLookup> {
  const hashedToken = hashGuestToken(rawToken)

  const { data: guestToken, error } = await supabase
    .from('guest_tokens')
    .select('id, customer_id, table_booking_id, expires_at')
    .eq('hashed_token', hashedToken)
    .eq('action_type', 'booking_confirm')
    .maybeSingle()

  if (error || !guestToken || !guestToken.table_booking_id) {
    return { ok: false, reason: 'not_found' }
  }

  if (guestToken.expires_at && Date.parse(guestToken.expires_at) <= Date.now()) {
    return { ok: false, reason: 'expired' }
  }

  const { data: booking } = await supabase
    .from('table_bookings')
    .select('id, booking_reference, booking_date, booking_time, party_size, status, guest_confirmed_at, customers(first_name)')
    .eq('id', guestToken.table_booking_id)
    .maybeSingle()

  if (!booking) {
    return { ok: false, reason: 'booking_missing' }
  }

  // PostgREST types an embedded one-to-one as an array. Both shapes are handled because
  // the generated types and the runtime shape disagree depending on the relationship
  // metadata, and guessing wrong here drops the guest's name from the page and the text.
  const embedded = booking.customers as unknown
  const customer = (Array.isArray(embedded) ? embedded[0] : embedded) as
    | { first_name: string | null }
    | null
    | undefined

  return {
    ok: true,
    booking: {
      id: booking.id as string,
      bookingReference: booking.booking_reference as string,
      bookingDate: booking.booking_date as string,
      bookingTime: (booking.booking_time as string | null) ?? null,
      partySize: (booking.party_size as number | null) ?? null,
      status: booking.status as string,
      guestConfirmedAt: (booking.guest_confirmed_at as string | null) ?? null,
      customerFirstName: customer?.first_name ?? null,
    },
  }
}

/**
 * Whether a booking in this state can still be answered.
 *
 * Confirming a cancelled booking must not resurrect it, and confirming one that has
 * already happened is meaningless. Both render a page that explains rather than a button
 * that lies.
 */
export function isAnswerable(status: string): boolean {
  return status === 'confirmed'
}
