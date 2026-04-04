import { NextRequest, NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'
import {
  createChargeRequestForBooking,
  getFeePerHead,
  getTableBookingForFoh
} from '@/lib/foh/bookings'
import { buildStaffStatusTransitionPlan } from '@/lib/table-bookings/staff-status-actions'
import { logger } from '@/lib/logger'

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
    const { data: currentBooking } = await auth.supabase.from('table_bookings')
      .select('id, status, seated_at, left_at, no_show_at, cancelled_at, updated_at')
      .eq('id', id)
      .maybeSingle()
    return NextResponse.json(
      { error: transition.error, booking: currentBooking ?? null },
      { status: transition.status }
    )
  }

  const committedPartySize = Math.max(
    1,
    Number(booking.committed_party_size || booking.party_size || 1)
  )
  const feePerHead = await getFeePerHead(auth.supabase)
  const suggestedAmount = committedPartySize * feePerHead

  const { data: noShowRow, error: updateError } = await auth.supabase.from('table_bookings')
    .update(transition.plan.update)
    .eq('id', id)
    .select('id, status, seated_at, left_at, no_show_at, cancelled_at, updated_at')
    .maybeSingle()

  if (updateError) {
    return NextResponse.json({ error: 'Failed to mark no-show' }, { status: 500 })
  }
  if (!noShowRow) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  // Idempotency: skip charge creation if a non-failed/non-waived charge request already
  // exists for this booking, so double-clicking "No show" does not create two charges.
  const { data: existingChargeRequest } = await auth.supabase.from('charge_requests')
    .select('id')
    .eq('table_booking_id', booking.id)
    .eq('type', 'no_show')
    .not('charge_status', 'in', '("failed","waived")')
    .maybeSingle()

  let chargeRequestId: string | null = null
  let chargeAmount: number = 0
  let capApplied: boolean = false

  if (existingChargeRequest) {
    logger.warn('Charge request already exists for no-show booking, skipping creation', {
      metadata: { bookingId: booking.id, existingChargeRequestId: existingChargeRequest.id }
    })
    chargeRequestId = existingChargeRequest.id
    chargeAmount = suggestedAmount
  } else {
    const chargeResult = await createChargeRequestForBooking(auth.supabase, {
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
    chargeRequestId = chargeResult.chargeRequestId
    chargeAmount = chargeResult.amount
    capApplied = chargeResult.capApplied
  }

  return NextResponse.json({
    success: true,
    booking: {
      id: noShowRow.id,
      status: noShowRow.status,
      seated_at: noShowRow.seated_at,
      left_at: noShowRow.left_at,
      no_show_at: noShowRow.no_show_at,
      cancelled_at: noShowRow.cancelled_at,
      updated_at: noShowRow.updated_at
    },
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
