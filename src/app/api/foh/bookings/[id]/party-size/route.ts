import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { logger } from '@/lib/logger'
import {
  mapSeatUpdateBlockedReason,
  updateTableBookingPartySizeWithLinkedEventSeats
} from '@/lib/events/staff-seat-updates'
import { applyPartySizeDepositTransition } from '@/lib/table-bookings/staff-deposit-transitions'

const UpdatePartySizeSchema = z.object({
  party_size: z.preprocess(
    (value) => (typeof value === 'string' ? Number.parseInt(value, 10) : value),
    z.number().int().min(1).max(20)
  ),
  send_sms: z.boolean().optional().default(true)
})

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireFohPermission('edit')
  if (!auth.ok) {
    return auth.response
  }

  const { id } = await context.params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'Invalid booking ID' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = UpdatePartySizeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message || 'Invalid party size',
        issues: parsed.error.issues
      },
      { status: 400 }
    )
  }

  const { data: currentBooking, error: fetchError } = await auth.supabase.from('table_bookings')
    .select('id, party_size, status, payment_status, customer_id, booking_reference, booking_type, start_datetime, deposit_amount, deposit_amount_locked, deposit_waived')
    .eq('id', id)
    .maybeSingle()

  if (fetchError || !currentBooking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  const previousPartySize = Math.max(1, Number(currentBooking.party_size || 1))
  const newPartySize = parsed.data.party_size

  try {
    const result = await updateTableBookingPartySizeWithLinkedEventSeats(auth.supabase, {
      tableBookingId: id,
      partySize: newPartySize,
      actor: 'foh',
      sendSms: parsed.data.send_sms,
      appBaseUrl: process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
    })

    if (result.state === 'blocked') {
      return NextResponse.json(
        {
          error: mapSeatUpdateBlockedReason(result.reason),
          reason: result.reason || null
        },
        { status: 409 }
      )
    }

    const depositTransition = await applyPartySizeDepositTransition(auth.supabase, {
      booking: currentBooking,
      previousPartySize,
      newPartySize,
      sendSms: parsed.data.send_sms,
      appBaseUrl: process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin,
    })

    return NextResponse.json({
      success: true,
      data: result,
      depositTransition,
    })
  } catch (error) {
    logger.error('FOH table-booking party-size update failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { tableBookingId: id },
    })
    return NextResponse.json(
      {
        error: 'Failed to update booking party size'
      },
      { status: 500 }
    )
  }
}
