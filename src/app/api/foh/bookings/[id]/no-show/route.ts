import { NextRequest, NextResponse } from 'next/server'
import { fromZonedTime } from 'date-fns-tz'
import { requireFohPermission } from '@/lib/foh/api-auth'
import {
  createChargeRequestForBooking,
  getFeePerHead,
  getTableBookingForFoh
} from '@/lib/foh/bookings'

function getBookingStartIso(booking: {
  start_datetime: string | null
  booking_date: string
  booking_time: string
}): string {
  if (booking.start_datetime) {
    return booking.start_datetime
  }

  const local = `${booking.booking_date}T${booking.booking_time}`
  return fromZonedTime(local, 'Europe/London').toISOString()
}

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireFohPermission('edit')
  if (!auth.ok) {
    return auth.response
  }

  const { id } = await context.params
  const booking = await getTableBookingForFoh(auth.supabase, id)

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  if (['cancelled', 'no_show'].includes(booking.status)) {
    return NextResponse.json(
      { error: 'Booking cannot be marked no-show from current status' },
      { status: 409 }
    )
  }

  const bookingStartIso = getBookingStartIso(booking)
  if (Date.parse(bookingStartIso) > Date.now()) {
    return NextResponse.json(
      { error: 'Booking cannot be marked no-show before start time' },
      { status: 409 }
    )
  }

  const nowIso = new Date().toISOString()
  const committedPartySize = Math.max(
    1,
    Number(booking.committed_party_size || booking.party_size || 1)
  )
  const feePerHead = await getFeePerHead(auth.supabase)
  const suggestedAmount = committedPartySize * feePerHead

  const { error: updateError } = await (auth.supabase.from('table_bookings') as any)
    .update({
      status: 'no_show',
      no_show_at: nowIso,
      no_show_marked_at: nowIso,
      no_show_marked_by: auth.userId,
      updated_at: nowIso
    })
    .eq('id', id)

  if (updateError) {
    return NextResponse.json({ error: 'Failed to mark no-show' }, { status: 500 })
  }

  const { chargeRequestId, amount: chargeAmount, capApplied } = await createChargeRequestForBooking(auth.supabase, {
    bookingId: booking.id,
    customerId: booking.customer_id,
    type: 'no_show',
    amount: suggestedAmount,
    requestedByUserId: auth.userId,
    metadata: {
      committed_party_size: committedPartySize,
      fee_per_head: feePerHead,
      source: 'foh_no_show'
    }
  })

  return NextResponse.json({
    success: true,
    data: {
      booking_id: booking.id,
      no_show_marked_at: nowIso,
      charge_request_id: chargeRequestId,
      suggested_amount: Number(suggestedAmount.toFixed(2)),
      charge_amount: Number(chargeAmount.toFixed(2)),
      cap_applied: capApplied
    }
  })
}
