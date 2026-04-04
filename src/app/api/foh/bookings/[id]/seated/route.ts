import { NextRequest, NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { getTableBookingForFoh, hasUnpaidSundayLunchDeposit } from '@/lib/foh/bookings'
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

  if (hasUnpaidSundayLunchDeposit(booking)) {
    const { data: currentBooking } = await auth.supabase.from('table_bookings')
      .select('id, status, seated_at, left_at, no_show_at, cancelled_at, updated_at')
      .eq('id', id)
      .maybeSingle()
    return NextResponse.json(
      {
        error: 'Sunday lunch booking cannot be seated until the GBP 10 per person deposit is paid.',
        booking: currentBooking ?? null
      },
      { status: 409 }
    )
  }

  const nowIso = new Date().toISOString()
  const transition = buildStaffStatusTransitionPlan({
    action: 'seated',
    booking,
    nowIso
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

  const { data, error } = await auth.supabase.from('table_bookings')
    .update(transition.plan.update)
    .eq('id', id)
    .select('id, status, seated_at, left_at, no_show_at, cancelled_at, updated_at')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'Failed to mark booking as seated' }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true, booking: data, data })
}
