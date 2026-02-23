import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFohPermission } from '@/lib/foh/api-auth'
import {
  createChargeRequestForBooking,
  getFeePerHead,
  getTableBookingForFoh,
  hasUnpaidSundayLunchDeposit
} from '@/lib/foh/bookings'
import {
  buildStaffStatusTransitionPlan,
  type StaffStatusAction
} from '@/lib/table-bookings/staff-status-actions'

const UpdateStatusSchema = z.object({
  action: z.enum(['seated', 'left', 'no_show', 'cancelled', 'confirmed', 'completed'])
})

const ACTION_ERROR_MESSAGE: Record<StaffStatusAction, string> = {
  seated: 'Failed to mark booking as seated',
  left: 'Failed to mark booking as left',
  no_show: 'Failed to mark no-show',
  cancelled: 'Failed to cancel booking',
  confirmed: 'Failed to mark booking as confirmed',
  completed: 'Failed to mark booking as completed',
}

export async function POST(
  request: NextRequest,
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

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = UpdateStatusSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message || 'Invalid status action',
        issues: parsed.error.issues
      },
      { status: 400 }
    )
  }

  const action = parsed.data.action
  const nowIso = new Date().toISOString()
  const blockUnpaidSundayLunchDeposit = hasUnpaidSundayLunchDeposit(booking)

  if ((action === 'seated' || action === 'confirmed') && blockUnpaidSundayLunchDeposit) {
    return NextResponse.json(
      {
        error:
          action === 'seated'
            ? 'Sunday lunch booking cannot be seated until the GBP 10 per person deposit is paid.'
            : 'Sunday lunch booking cannot be confirmed until the GBP 10 per person deposit is paid.'
      },
      { status: 409 }
    )
  }

  if (action === 'left') {
    const { error: assignmentError } = await (auth.supabase.from('booking_table_assignments') as any)
      .update({ end_datetime: nowIso })
      .eq('table_booking_id', id)
      .lt('start_datetime', nowIso)

    if (assignmentError) {
      return NextResponse.json({ error: 'Failed to update booking table assignment end time' }, { status: 500 })
    }
  }

  const transition = buildStaffStatusTransitionPlan({
    action,
    booking,
    nowIso,
    cancelledBy: 'staff',
    noShowMarkedBy: auth.userId
  })

  if (!transition.ok) {
    return NextResponse.json({ error: transition.error }, { status: transition.status })
  }

  const { data: updatedRow, error: updateError } = await (auth.supabase.from('table_bookings') as any)
    .update(transition.plan.update)
    .eq('id', id)
    .select(transition.plan.select)
    .maybeSingle()

  if (updateError) {
    return NextResponse.json({ error: ACTION_ERROR_MESSAGE[action] }, { status: 500 })
  }
  if (!updatedRow) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  if (action !== 'no_show') {
    return NextResponse.json({ success: true, data: updatedRow })
  }

  const committedPartySize = Math.max(
    1,
    Number(booking.committed_party_size || booking.party_size || 1)
  )
  const feePerHead = await getFeePerHead(auth.supabase)
  const suggestedAmount = committedPartySize * feePerHead

  const { chargeRequestId, amount: chargeAmount, capApplied } = await createChargeRequestForBooking(auth.supabase, {
    bookingId: booking.id,
    customerId: booking.customer_id,
    type: 'no_show',
    amount: suggestedAmount,
    requestedByUserId: auth.userId,
    metadata: {
      committed_party_size: committedPartySize,
      fee_per_head: feePerHead,
      source: 'boh_manual_no_show'
    }
  })

  return NextResponse.json({
    success: true,
    data: {
      booking_id: booking.id,
      status: 'no_show',
      no_show_marked_at: nowIso,
      charge_request_id: chargeRequestId,
      suggested_amount: Number(suggestedAmount.toFixed(2)),
      charge_amount: Number(chargeAmount.toFixed(2)),
      cap_applied: capApplied
    }
  })
}
