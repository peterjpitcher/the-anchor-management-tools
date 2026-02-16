import { NextRequest, NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { getTableBookingForFoh } from '@/lib/foh/bookings'

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
      { error: 'Booking cannot be cancelled from current status' },
      { status: 409 }
    )
  }

  const nowIso = new Date().toISOString()
  const { data, error } = await (auth.supabase.from('table_bookings') as any)
    .update({
      status: 'cancelled',
      cancelled_at: nowIso,
      cancelled_by: 'staff',
      updated_at: nowIso
    })
    .eq('id', id)
    .select('id, status, cancelled_at, cancelled_by')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'Failed to cancel booking' }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true, data })
}
