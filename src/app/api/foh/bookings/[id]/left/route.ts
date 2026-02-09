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
      { error: 'Booking cannot be marked left from current status' },
      { status: 409 }
    )
  }

  const nowIso = new Date().toISOString()
  const { data, error } = await (auth.supabase.from('table_bookings') as any)
    .update({ left_at: nowIso, updated_at: nowIso })
    .eq('id', id)
    .select('id, status, left_at')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'Failed to mark booking as left' }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    data: data || { id, status: booking.status, left_at: nowIso }
  })
}
