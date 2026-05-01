import { NextRequest, NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { getTableBookingForFoh } from '@/lib/foh/bookings'
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
    const { data: currentBooking } = await auth.supabase.from('table_bookings')
      .select('id, status, seated_at, left_at, no_show_at, cancelled_at, updated_at')
      .eq('id', id)
      .maybeSingle()
    return NextResponse.json(
      { error: transition.error, booking: currentBooking ?? null },
      { status: transition.status }
    )
  }

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
      charge_request_id: null,
      suggested_amount: 0,
      charge_amount: 0,
      cap_applied: false
    }
  })
}
