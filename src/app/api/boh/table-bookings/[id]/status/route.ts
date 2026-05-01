import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { refundTableBookingDeposit } from '@/lib/table-bookings/refunds'
import { sendTableBookingCancelledSmsIfAllowed } from '@/lib/table-bookings/bookings'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
import {
  getTableBookingForFoh,
  hasUnpaidRequiredDeposit
} from '@/lib/foh/bookings'
import {
  buildStaffStatusTransitionPlan,
  type StaffStatusAction
} from '@/lib/table-bookings/staff-status-actions'
import { logAuditEvent } from '@/app/actions/audit'

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
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid booking ID' }, { status: 400 })
  }
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
  const blockUnpaidRequiredDeposit = hasUnpaidRequiredDeposit(booking)

  if ((action === 'seated' || action === 'confirmed') && blockUnpaidRequiredDeposit) {
    return NextResponse.json(
      {
        error:
          action === 'seated'
            ? 'Booking cannot be seated until the required deposit is paid.'
            : 'Booking cannot be confirmed until the required deposit is paid.'
      },
      { status: 409 }
    )
  }

  if (action === 'left') {
    const { error: assignmentError } = await auth.supabase.from('booking_table_assignments')
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

  const { data: updatedRow, error: updateError } = await auth.supabase.from('table_bookings')
    .update(action === 'cancelled'
      ? {
          ...transition.plan.update,
          paypal_deposit_order_id: null,
          hold_expires_at: null,
        }
      : transition.plan.update)
    .eq('id', id)
    .select(transition.plan.select)
    .maybeSingle()

  if (updateError) {
    return NextResponse.json({ error: ACTION_ERROR_MESSAGE[action] }, { status: 500 })
  }
  if (!updatedRow) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  // Tiered deposit refund + cancellation SMS when staff cancel a booking (never fail the status change)
  if (action === 'cancelled' && booking.booking_date && booking.customer_id) {
    try {
      const bookingDate = new Date(`${booking.booking_date}T12:00:00`)
      const refundResult = await refundTableBookingDeposit(booking.id, bookingDate)
      await sendTableBookingCancelledSmsIfAllowed(auth.supabase, {
        customerId: booking.customer_id,
        bookingReference: booking.booking_reference || booking.id,
        bookingDate: booking.booking_date,
        refundResult,
      })
    } catch (err) {
      console.error('[table-booking-status] refund/SMS error:', err)
    }
  }

  // Audit log the status transition (fire-and-forget)
  logAuditEvent({
    user_id: auth.userId,
    operation_type: 'update',
    resource_type: 'table_booking',
    resource_id: id,
    operation_status: 'success',
    additional_info: {
      status_from: booking.status,
      status_to: action === 'seated' ? booking.status : action,
      action
    }
  }).catch(() => {})

  if (action !== 'no_show') {
    return NextResponse.json({ success: true, data: updatedRow })
  }

  return NextResponse.json({
    success: true,
    data: {
      booking_id: booking.id,
      status: 'no_show',
      no_show_marked_at: nowIso,
      charge_request_id: null,
      suggested_amount: 0,
      charge_amount: 0,
      cap_applied: false
    }
  })
}
