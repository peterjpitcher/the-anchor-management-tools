import { NextRequest, NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { getTableBookingForFoh } from '@/lib/foh/bookings'
import { markTableBookingNoShow } from '@/lib/table-bookings/no-show'
import { logAuditEvent } from '@/app/actions/audit'
import { eventLinkedTableBookingResponse, isEventLinkedTableBooking } from '@/lib/table-bookings/event-link'

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

  // An event guest who did not come is marked from the event, ticket and table together (BK-074).
  if (isEventLinkedTableBooking(booking)) {
    return eventLinkedTableBookingResponse()
  }

  const nowIso = new Date().toISOString()
  const readCurrent = async () => {
    const { data } = await auth.supabase.from('table_bookings')
      .select('id, status, seated_at, left_at, no_show_at, cancelled_at, updated_at')
      .eq('id', id)
      .maybeSingle()
    return data ?? null
  }

  // The one way a no-show is written, shared with the end-of-day sweep (no-show.ts). It guards the
  // write on the status read above, so a booking changed in between is not overwritten.
  const marked = await markTableBookingNoShow<{
    id: string
    status: string
    seated_at: string | null
    left_at: string | null
    no_show_at: string | null
    cancelled_at: string | null
    updated_at: string | null
  }>(auth.supabase, { booking, nowIso, markedBy: auth.userId })

  if (!marked.ok) {
    if (marked.kind === 'refused') {
      return NextResponse.json({ error: marked.error, booking: await readCurrent() }, { status: marked.status })
    }
    if (marked.kind === 'write_failed') {
      return NextResponse.json({ error: 'Failed to mark no-show' }, { status: 500 })
    }
    const currentBooking = await readCurrent()
    return NextResponse.json(
      { error: 'Booking changed before this update could be applied', booking: currentBooking },
      { status: currentBooking ? 409 : 404 }
    )
  }
  const noShowRow = marked.row

  await logAuditEvent({
    user_id: auth.userId,
    operation_type: 'table_booking.no_show',
    resource_type: 'table_booking',
    resource_id: id,
    operation_status: 'success',
    additional_info: { source: 'foh' },
  }).catch(() => {})

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
    },
    undo: {
      action: 'no_show' as const,
      stamp: nowIso,
      ...(booking.status === 'pending_payment' ? { previous_status: 'pending_payment' as const } : {}),
    },
  })
}
