import { NextRequest, NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { getTableBookingForFoh, hasUnpaidSundayLunchDeposit } from '@/lib/foh/bookings'

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

  if (['cancelled', 'no_show'].includes(booking.status)) {
    return NextResponse.json(
      { error: 'Booking cannot be marked seated from current status' },
      { status: 409 }
    )
  }

  const nowIso = new Date().toISOString()
  const { data, error } = await (auth.supabase.from('table_bookings') as any)
    .update({ seated_at: nowIso, left_at: null, updated_at: nowIso })
    .eq('id', id)
    .select('id, status, seated_at, left_at')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'Failed to mark booking as seated' }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true, data })
}
