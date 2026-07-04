import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireBohTableBookingPermission } from '@/lib/foh/api-auth'
import { logger } from '@/lib/logger'
import {
  PartySizeUpdateFailedAfterMoveError,
  mapSeatUpdateBlockedReason,
  updateTableBookingPartySizeWithLinkedEventSeats
} from '@/lib/events/staff-seat-updates'
import {
  applyPartySizeDepositTransition,
  type PartySizeDepositTransitionResult
} from '@/lib/table-bookings/staff-deposit-transitions'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const UpdatePartySizeSchema = z.object({
  party_size: z.preprocess(
    (value) => (typeof value === 'string' ? Number.parseInt(value, 10) : value),
    z.number().int().min(1).max(20)
  ),
  send_sms: z.boolean().optional().default(true),
  // Optional staff-picked larger table setup for the single-step grow+move —
  // honoured when still available, otherwise the server auto-picks as before.
  move_table_ids: z.array(z.string().uuid()).min(1).max(4).optional()
})

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireBohTableBookingPermission('edit')
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
    .select('id, party_size, committed_party_size, status, payment_status, customer_id, booking_date, booking_reference, booking_type, start_datetime, updated_at, deposit_amount, deposit_amount_locked, deposit_waived')
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
      appBaseUrl,
      autoMoveTable: true,
      preferredTableIds: parsed.data.move_table_ids
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

    // Verify from the row returned by the update itself — a re-read here was
    // a TOCTOU false negative under concurrent edits. On 'unchanged' there is
    // no updated row, so fall back to the pre-read values.
    const updatedBooking = result.updated_booking ?? {
      id,
      party_size: result.new_party_size,
      committed_party_size: currentBooking.committed_party_size ?? null,
      updated_at: currentBooking.updated_at ?? null
    }

    if (result.state === 'updated' && !result.event_booking_id && !result.updated_booking) {
      logger.error('BOH table-booking party-size update returned no updated row', {
        metadata: {
          tableBookingId: id,
          requestedPartySize: newPartySize,
        },
      })
      return NextResponse.json({ error: 'Booking party size was not saved. Please refresh and try again.' }, { status: 409 })
    }

    if (result.updated_booking && Number(result.updated_booking.party_size) !== result.new_party_size) {
      logger.error('BOH table-booking party-size update verification failed', {
        metadata: {
          tableBookingId: id,
          requestedPartySize: newPartySize,
          savedPartySize: result.updated_booking.party_size,
        },
      })
      return NextResponse.json({ error: 'Booking party size was not saved. Please refresh and try again.' }, { status: 409 })
    }

    // The size is saved at this point. A deposit-transition failure must not
    // be reported as a failed update — return 200 with a separate warning.
    let depositTransition: PartySizeDepositTransitionResult | null = null
    let depositWarning: string | null = null
    try {
      depositTransition = await applyPartySizeDepositTransition(auth.supabase, {
        booking: currentBooking,
        previousPartySize,
        newPartySize,
        sendSms: parsed.data.send_sms,
        appBaseUrl,
      })
    } catch (depositError) {
      logger.error('BOH party-size deposit transition failed after party size saved', {
        error: depositError instanceof Error ? depositError : new Error(String(depositError)),
        metadata: { tableBookingId: id, previousPartySize, newPartySize },
      })
      depositWarning = 'Party size saved, but the deposit link could not be updated. Please retry from the booking page.'
    }

    return NextResponse.json({
      success: true,
      data: result,
      booking: updatedBooking,
      depositTransition,
      warning: depositWarning,
      depositRequired: depositTransition?.state === 'deposit_required',
      depositUrl: depositTransition?.state === 'deposit_required' ? depositTransition.depositUrl : null,
      depositAmount: depositTransition?.state === 'deposit_required' ? depositTransition.depositAmount : null,
      smsSent: depositTransition?.state === 'deposit_required' ? depositTransition.smsSent : false,
    })
  } catch (error) {
    logger.error('BOH table-booking party-size update failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { tableBookingId: id },
    })
    if (error instanceof PartySizeUpdateFailedAfterMoveError) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json(
      {
        error: 'Failed to update booking party size'
      },
      { status: 500 }
    )
  }
}
