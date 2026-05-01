import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFohPermission } from '@/lib/foh/api-auth'
import { logger } from '@/lib/logger'
import {
  mapSeatUpdateBlockedReason,
  updateTableBookingPartySizeWithLinkedEventSeats
} from '@/lib/events/staff-seat-updates'
import { applyPartySizeDepositTransition } from '@/lib/table-bookings/staff-deposit-transitions'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  if (!UUID_REGEX.test(id)) {
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

  const newPartySize = parsed.data.party_size
  const appBaseUrl = (process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin).replace(/\/+$/, '')

  // Read current booking state before the update so we can detect threshold crossings
  const { data: currentBooking, error: fetchError } = await auth.supabase.from('table_bookings')
    .select('id, party_size, status, payment_status, customer_id, booking_date, booking_reference, booking_type, start_datetime, deposit_amount, deposit_amount_locked, deposit_waived')
    .eq('id', id)
    .maybeSingle()

  if (fetchError || !currentBooking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  const previousPartySize = Math.max(1, Number(currentBooking.party_size || 1))
  try {
    const result = await updateTableBookingPartySizeWithLinkedEventSeats(auth.supabase, {
      tableBookingId: id,
      partySize: newPartySize,
      actor: 'boh',
      sendSms: parsed.data.send_sms,
      appBaseUrl
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
      appBaseUrl,
    })

    return NextResponse.json({
      success: true,
      data: result,
      depositTransition,
      depositRequired: depositTransition.state === 'deposit_required',
      depositUrl: depositTransition.state === 'deposit_required' ? depositTransition.depositUrl : null,
      depositAmount: depositTransition.state === 'deposit_required' ? depositTransition.depositAmount : null,
      smsSent: depositTransition.state === 'deposit_required' ? depositTransition.smsSent : false,
    })
  } catch (error) {
    logger.error('BOH table-booking party-size update failed', {
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
