import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireBohTableBookingPermission } from '@/lib/foh/api-auth'
import { logAuditEvent } from '@/app/actions/audit'
import { logger } from '@/lib/logger'

/**
 * Pin or unpin a booking's tables.
 *
 * A pinned booking is never moved by anything automatic: not the drinks bump, not a retry, not any
 * future re-optimisation. It is how a member of staff makes "I have told them they are on Big Bay"
 * true, rather than a hope.
 *
 * An authorised manual move is still allowed and keeps the pin. The guarantee is against the
 * system moving someone silently, not against staff changing their mind.
 */

const PinSchema = z.object({
  pinned: z.boolean(),
})

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params

  const auth = await requireBohTableBookingPermission('edit')
  if (!auth.ok) return auth.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = PinSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'pinned must be true or false' }, { status: 400 })
  }

  try {
    const { data: booking, error: readError } = await auth.supabase
      .from('table_bookings')
      .select('id, status, is_outside_seating, table_pinned')
      .eq('id', id)
      .single()

    if (readError || !booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    // There is nothing to pin an outside booking to: it holds no indoor table.
    if (parsed.data.pinned && booking.is_outside_seating) {
      return NextResponse.json(
        { error: 'Outside bookings hold no table, so there is nothing to pin.' },
        { status: 400 }
      )
    }

    if (parsed.data.pinned) {
      const { count } = await auth.supabase
        .from('booking_table_assignments')
        .select('id', { count: 'exact', head: true })
        .eq('table_booking_id', id)

      if (!count) {
        return NextResponse.json(
          { error: 'This booking has no table yet, so there is nothing to pin.' },
          { status: 400 }
        )
      }
    }

    const { error: updateError } = await auth.supabase
      .from('table_bookings')
      .update({ table_pinned: parsed.data.pinned })
      .eq('id', id)

    if (updateError) throw updateError

    await logAuditEvent({
      user_id: auth.userId,
      operation_type: 'update',
      resource_type: 'table_booking',
      resource_id: id,
      operation_status: 'success',
      old_values: { table_pinned: booking.table_pinned },
      new_values: { table_pinned: parsed.data.pinned },
    })

    return NextResponse.json({ success: true, pinned: parsed.data.pinned })
  } catch (error) {
    logger.error('Failed to change table pin', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: id },
    })
    return NextResponse.json({ error: 'Could not change the pin' }, { status: 500 })
  }
}
