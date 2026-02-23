import { NextRequest, NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { getTableBookingForFoh, hasUnpaidSundayLunchDeposit } from '@/lib/foh/bookings'
import { buildStaffStatusTransitionPlan } from '@/lib/table-bookings/staff-status-actions'

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

  if (hasUnpaidSundayLunchDeposit(booking)) {
    return NextResponse.json(
      { error: 'Sunday lunch booking cannot be seated until the GBP 10 per person deposit is paid.' },
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
    return NextResponse.json({ error: transition.error }, { status: transition.status })
  }

  const { data, error } = await (auth.supabase.from('table_bookings') as any)
    .update(transition.plan.update)
    .eq('id', id)
    .select(transition.plan.select)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'Failed to mark booking as seated' }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true, data })
}
