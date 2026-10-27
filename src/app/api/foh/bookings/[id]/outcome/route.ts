import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveTradingDayNow } from '@/lib/business-hours/trading-day'
import { buildPastArrivalPlan, buildStaffStatusTransitionPlan } from '@/lib/table-bookings/staff-status-actions'
import { logAuditEvent } from '@/app/actions/audit'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const bodySchema = z.object({ outcome: z.enum(['arrived', 'no_show']) })

/**
 * Arrived or No-show for a table booking from an earlier day that nobody marked on the night
 * (BK-130, the 'Still open from earlier' strip). No-show is the floor's own no-show; Arrived stamps
 * the booking's own start and end rather than the time the button is pressed. Today's bookings are
 * marked from the floor as before.
 */
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

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Choose arrived or no-show.' }, { status: 400 })
  }
  const { outcome } = parsed.data

  const { data: booking, error: bookingError } = await auth.supabase
    .from('table_bookings')
    .select('id, status, booking_date, booking_time, start_datetime, end_datetime, seated_at, left_at, no_show_at, event_booking_id')
    .eq('id', id)
    .maybeSingle()
  if (bookingError) {
    return NextResponse.json({ error: 'Failed to load the booking' }, { status: 500 })
  }
  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }
  if (booking.event_booking_id) {
    return NextResponse.json({ error: 'Record who came to an event on the event page.' }, { status: 409 })
  }

  const tradingDay = (await resolveTradingDayNow(createAdminClient())).date
  if (!(booking.booking_date < tradingDay)) {
    return NextResponse.json({ error: 'Mark today\'s bookings from the floor.' }, { status: 409 })
  }
  if (booking.seated_at || booking.left_at || booking.no_show_at) {
    return NextResponse.json({ error: 'This booking already has an outcome.' }, { status: 409 })
  }

  const nowIso = new Date().toISOString()
  const transition = outcome === 'arrived'
    ? buildPastArrivalPlan({ booking, tradingDayIso: tradingDay, nowIso })
    : buildStaffStatusTransitionPlan({ action: 'no_show', booking, nowIso, noShowMarkedBy: auth.userId })
  if (!transition.ok) {
    return NextResponse.json({ error: transition.error }, { status: transition.status })
  }

  const { data: updated, error: updateError } = await auth.supabase
    .from('table_bookings')
    .update(transition.plan.update)
    .eq('id', id)
    .eq('status', booking.status)
    .is('seated_at', null)
    .is('no_show_at', null)
    .select('id, status, seated_at, left_at, no_show_at, updated_at')
    .maybeSingle()

  if (updateError) {
    return NextResponse.json({ error: 'Failed to record the outcome' }, { status: 500 })
  }
  if (!updated) {
    return NextResponse.json({ error: 'Booking changed before this update could be applied' }, { status: 409 })
  }

  await logAuditEvent({
    user_id: auth.userId,
    operation_type: outcome === 'arrived' ? 'table_booking.seated' : 'table_booking.no_show',
    resource_type: 'table_booking',
    resource_id: id,
    operation_status: 'success',
    additional_info: { source: 'open_from_earlier', booking_date: booking.booking_date },
  }).catch(() => {})

  return NextResponse.json({ success: true, data: updated })
}
