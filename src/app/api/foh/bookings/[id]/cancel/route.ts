import { NextRequest, NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { getTableBookingForFoh } from '@/lib/foh/bookings'
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

  const nowIso = new Date().toISOString()
  const transition = buildStaffStatusTransitionPlan({
    action: 'cancelled',
    booking,
    nowIso,
    cancelledBy: 'staff'
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
    return NextResponse.json({ error: 'Failed to cancel booking' }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true, data })
}
