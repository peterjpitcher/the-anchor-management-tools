import { NextRequest, NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'
import {
  createChargeRequestForBooking,
  getFeePerHead,
  getTableBookingForFoh
} from '@/lib/foh/bookings'
import { buildStaffStatusTransitionPlan } from '@/lib/table-bookings/staff-status-actions'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireFohPermission('edit')
  if (!auth.ok) {
    return auth.response
  }

  const { id } = await context.params
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid booking ID' }, { status: 400 })
  }
  const booking = await getTableBookingForFoh(auth.supabase, id)

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  const nowIso = new Date().toISOString()
  const transition = buildStaffStatusTransitionPlan({
    action: 'no_show',
    booking,
    nowIso,
    noShowMarkedBy: auth.userId
  })

  if (!transition.ok) {
    return NextResponse.json({ error: transition.error }, { status: transition.status })
  }

  const committedPartySize = Math.max(
    1,
    Number(booking.committed_party_size || booking.party_size || 1)
  )
  const feePerHead = await getFeePerHead(auth.supabase)
  const suggestedAmount = committedPartySize * feePerHead

  const { data: noShowRow, error: updateError } = await (auth.supabase.from('table_bookings') as any)
    .update(transition.plan.update)
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (updateError) {
    return NextResponse.json({ error: 'Failed to mark no-show' }, { status: 500 })
  }
  if (!noShowRow) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
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
