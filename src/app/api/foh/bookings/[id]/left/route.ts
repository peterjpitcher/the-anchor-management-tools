import { NextRequest, NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { getTableBookingForFoh } from '@/lib/foh/bookings'

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

  if (['cancelled', 'no_show', 'completed'].includes(booking.status)) {
    const { data: currentBooking } = await auth.supabase.from('table_bookings')
      .select('id, status, seated_at, left_at, no_show_at, cancelled_at, updated_at')
      .eq('id', id)
      .maybeSingle()
    return NextResponse.json(
      { error: 'Booking cannot be marked left from current status', booking: currentBooking ?? null },
      { status: 409 }
    )
  }

  const nowIso = new Date().toISOString()
  const { error: assignmentError } = await auth.supabase.from('booking_table_assignments')
    .update({ end_datetime: nowIso })
    .eq('table_booking_id', id)
    .lt('start_datetime', nowIso)

  if (assignmentError) {
    return NextResponse.json({ error: 'Failed to update booking table assignment end time' }, { status: 500 })
  }

  const { data, error } = await auth.supabase.from('table_bookings')
    .update({ left_at: nowIso, end_datetime: nowIso, updated_at: nowIso })
    .eq('id', id)
    .select('id, status, seated_at, left_at, no_show_at, cancelled_at, updated_at')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'Failed to mark booking as left' }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true, booking: data, data })
}
