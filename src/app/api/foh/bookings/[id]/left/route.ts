import { NextRequest, NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { getTableBookingForFoh } from '@/lib/foh/bookings'
import { logAuditEvent } from '@/app/actions/audit'
import { logger } from '@/lib/logger'
import { leftEndDatetime, shortenAssignmentsOnLeave } from '@/lib/table-bookings/staff-status-actions'

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
  // Only ever shortens the table times, so a late 'left' cannot overlap the next party or a
  // private hire and be refused; and a failure there never leaves the party 'seated' (BK-093).
  const { error: assignmentError } = await shortenAssignmentsOnLeave(auth.supabase, id, nowIso)
  if (assignmentError) {
    logger.error('Could not shorten table assignments when marking a booking as left', {
      error: new Error(String((assignmentError as { message?: unknown })?.message ?? assignmentError)),
      metadata: { bookingId: id },
    })
  }

  const { data, error } = await auth.supabase.from('table_bookings')
    .update({ left_at: nowIso, end_datetime: leftEndDatetime(booking.end_datetime, nowIso), updated_at: nowIso })
    .eq('id', id)
    .eq('status', booking.status)
    .select('id, status, seated_at, left_at, no_show_at, cancelled_at, updated_at')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'Failed to mark booking as left' }, { status: 500 })
  }
  if (!data) {
    const { data: currentBooking } = await auth.supabase.from('table_bookings')
      .select('id, status, seated_at, left_at, no_show_at, cancelled_at, updated_at')
      .eq('id', id)
      .maybeSingle()
    return NextResponse.json(
      { error: 'Booking changed before this update could be applied', booking: currentBooking ?? null },
      { status: currentBooking ? 409 : 404 }
    )
  }

  // Staff status changes are auditable mutations. These FOH routes cancel bookings,
  // free tables and trigger refunds, and none of them recorded who did it.
  await logAuditEvent({
    user_id: auth.userId,
    operation_type: 'table_booking.left',
    resource_type: 'table_booking',
    resource_id: id,
    operation_status: 'success',
    additional_info: { source: 'foh' },
  }).catch(() => {})

  return NextResponse.json({ success: true, booking: data, data })
}
