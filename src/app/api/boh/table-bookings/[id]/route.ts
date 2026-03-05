import { NextRequest, NextResponse } from 'next/server'
import { requireFohPermission } from '@/lib/foh/api-auth'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireFohPermission('manage')
  if (!auth.ok) {
    return auth.response
  }

  const { id } = await context.params
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json({ error: 'Invalid booking ID' }, { status: 400 })
  }

  const { data: existing, error: loadError } = await (auth.supabase.from('table_bookings') as any)
    .select('id, booking_reference, status')
    .eq('id', id)
    .maybeSingle()

  if (loadError) {
    return NextResponse.json({ error: 'Failed to load booking' }, { status: 500 })
  }

  if (!existing) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  const closedStatuses = ['completed', 'no_show', 'cancelled']
  if (closedStatuses.includes(existing.status)) {
    return NextResponse.json(
      { error: `Booking cannot be cancelled because it is already ${existing.status.replace('_', ' ')}` },
      { status: 409 }
    )
  }

  const nowIso = new Date().toISOString()
  const cancellationReason = 'boh_soft_delete'
  const { data: cancelledBooking, error: cancelError } = await (auth.supabase.from('table_bookings') as any)
    .update({
      status: 'cancelled',
      cancelled_at: nowIso,
      cancelled_by: 'staff',
      cancellation_reason: cancellationReason,
      updated_at: nowIso
    })
    .eq('id', id)
    .select('id, booking_reference, status, cancelled_at, cancellation_reason')
    .maybeSingle()

  if (cancelError) {
    return NextResponse.json({ error: 'Failed to delete booking' }, { status: 500 })
  }

  if (!cancelledBooking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  return NextResponse.json({
    success: true,
    data: {
      id,
      booking_reference: cancelledBooking.booking_reference || existing.booking_reference || null,
      status: cancelledBooking.status || existing.status || null,
      deleted_at: nowIso,
      cancelled_at: cancelledBooking.cancelled_at || nowIso,
      cancellation_reason: cancelledBooking.cancellation_reason || cancellationReason,
      soft_deleted: true
    }
  })
}
