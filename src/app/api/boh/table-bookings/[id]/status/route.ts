import { NextRequest, NextResponse } from 'next/server'
import { fromZonedTime } from 'date-fns-tz'
import { z } from 'zod'
import { requireFohPermission } from '@/lib/foh/api-auth'
import {
  createChargeRequestForBooking,
  getFeePerHead,
  getTableBookingForFoh
} from '@/lib/foh/bookings'

const UpdateStatusSchema = z.object({
  action: z.enum(['seated', 'left', 'no_show', 'cancelled', 'confirmed', 'completed'])
})

function getBookingStartIso(booking: {
  start_datetime: string | null
  booking_date: string
  booking_time: string
}): string {
  if (booking.start_datetime) {
    return booking.start_datetime
  }

  return fromZonedTime(`${booking.booking_date}T${booking.booking_time}`, 'Europe/London').toISOString()
}

export async function POST(
  request: NextRequest,
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

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = UpdateStatusSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message || 'Invalid status action',
        issues: parsed.error.issues
      },
      { status: 400 }
    )
  }

  const nowIso = new Date().toISOString()

  if (parsed.data.action === 'seated') {
    if (['cancelled', 'no_show'].includes(booking.status)) {
      return NextResponse.json(
        { error: 'Cannot mark booking as seated from current status' },
        { status: 409 }
      )
    }

    const { data, error } = await (auth.supabase.from('table_bookings') as any)
      .update({
        seated_at: nowIso,
        left_at: null,
        no_show_at: null,
        updated_at: nowIso,
        status: booking.status === 'pending_card_capture' ? 'confirmed' : booking.status
      })
      .eq('id', id)
      .select('id, status, seated_at, left_at, no_show_at')
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: 'Failed to mark booking as seated' }, { status: 500 })
    }

    return NextResponse.json({ success: true, data: data || { id, status: booking.status, seated_at: nowIso } })
  }

  if (parsed.data.action === 'left') {
    if (['cancelled', 'no_show'].includes(booking.status)) {
      return NextResponse.json(
        { error: 'Cannot mark booking as left from current status' },
        { status: 409 }
      )
    }

    const { data, error } = await (auth.supabase.from('table_bookings') as any)
      .update({
        left_at: nowIso,
        updated_at: nowIso
      })
      .eq('id', id)
      .select('id, status, left_at')
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: 'Failed to mark booking as left' }, { status: 500 })
    }

    return NextResponse.json({ success: true, data: data || { id, status: booking.status, left_at: nowIso } })
  }

  if (parsed.data.action === 'completed') {
    const { data, error } = await (auth.supabase.from('table_bookings') as any)
      .update({
        status: 'completed',
        left_at: nowIso,
        updated_at: nowIso
      })
      .eq('id', id)
      .select('id, status, left_at')
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: 'Failed to mark booking as completed' }, { status: 500 })
    }

    return NextResponse.json({ success: true, data: data || { id, status: 'completed', left_at: nowIso } })
  }

  if (parsed.data.action === 'confirmed') {
    const { data, error } = await (auth.supabase.from('table_bookings') as any)
      .update({
        status: 'confirmed',
        seated_at: null,
        left_at: null,
        no_show_at: null,
        no_show_marked_at: null,
        no_show_marked_by: null,
        cancelled_at: null,
        cancelled_by: null,
        updated_at: nowIso
      })
      .eq('id', id)
      .select('id, status, seated_at, left_at, no_show_at')
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: 'Failed to mark booking as confirmed' }, { status: 500 })
    }

    return NextResponse.json({ success: true, data: data || { id, status: 'confirmed' } })
  }

  if (parsed.data.action === 'cancelled') {
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

    return NextResponse.json({
      success: true,
      data: data || { id, status: 'cancelled', cancelled_at: nowIso, cancelled_by: 'staff' }
    })
  }

  if (booking.status === 'cancelled') {
    return NextResponse.json(
      { error: 'Cancelled bookings cannot be marked as no-show' },
      { status: 409 }
    )
  }

  const bookingStartIso = getBookingStartIso(booking)
  if (Date.parse(bookingStartIso) > Date.now()) {
    return NextResponse.json(
      { error: 'Booking cannot be marked no-show before start time' },
      { status: 409 }
    )
  }

  const committedPartySize = Math.max(
    1,
    Number(booking.committed_party_size || booking.party_size || 1)
  )
  const feePerHead = await getFeePerHead(auth.supabase)
  const suggestedAmount = committedPartySize * feePerHead

  const { error: updateError } = await (auth.supabase.from('table_bookings') as any)
    .update({
      status: 'no_show',
      no_show_at: nowIso,
      no_show_marked_at: nowIso,
      no_show_marked_by: auth.userId,
      updated_at: nowIso
    })
    .eq('id', id)

  if (updateError) {
    return NextResponse.json({ error: 'Failed to mark booking as no-show' }, { status: 500 })
  }

  const { chargeRequestId, amount: chargeAmount, capApplied } = await createChargeRequestForBooking(auth.supabase, {
    bookingId: booking.id,
    customerId: booking.customer_id,
    type: 'no_show',
    amount: suggestedAmount,
    requestedByUserId: auth.userId,
    metadata: {
      committed_party_size: committedPartySize,
      fee_per_head: feePerHead,
      source: 'boh_manual_no_show'
    }
  })

  return NextResponse.json({
    success: true,
    data: {
      booking_id: booking.id,
      status: 'no_show',
      no_show_marked_at: nowIso,
      charge_request_id: chargeRequestId,
      suggested_amount: Number(suggestedAmount.toFixed(2)),
      charge_amount: Number(chargeAmount.toFixed(2)),
      cap_applied: capApplied
    }
  })
}
