import { NextRequest, NextResponse } from 'next/server'
import { logAuditEvent } from '@/app/actions/audit'
import { z } from 'zod'
import { requireFohPermission } from '@/lib/foh/api-auth'
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
import {
  syncPreorderCovers,
  type PreorderRemovedCover
} from '@/lib/table-bookings/preorder'

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
    // booking_period_id and booking_period_name are load-bearing here: their presence is what stops
    // the deposit transition re-pricing a seasonal booking with the ten-guest rule, which zeroed it.
    .select('id, party_size, status, payment_status, customer_id, booking_reference, booking_type, start_datetime, deposit_amount, deposit_amount_locked, deposit_waived, booking_period_id, booking_period_name')
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
      appBaseUrl: process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin,
      autoMoveTable: true
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
      committed_party_size: null,
      updated_at: null
    }

    if (result.state === 'updated' && !result.event_booking_id && !result.updated_booking) {
      logger.error('FOH table-booking party-size update returned no updated row', {
        metadata: {
          tableBookingId: id,
          requestedPartySize: newPartySize,
        },
      })
      return NextResponse.json({ error: 'Booking party size was not saved. Please refresh and try again.' }, { status: 409 })
    }

    if (result.updated_booking && Number(result.updated_booking.party_size) !== result.new_party_size) {
      logger.error('FOH table-booking party-size update verification failed', {
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
        appBaseUrl: process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin,
      })
    } catch (depositError) {
      logger.error('FOH party-size deposit transition failed after party size saved', {
        error: depositError instanceof Error ? depositError : new Error(String(depositError)),
        metadata: { tableBookingId: id, previousPartySize, newPartySize },
      })
      depositWarning = 'Party size saved, but the deposit link could not be updated. Please retry from the booking page.'
    }

    // A seasonal booking is never re-priced automatically, so say so plainly rather than letting
    // staff assume the deposit followed the new party size.
    if (depositTransition?.state === 'manual_review') {
      depositWarning = depositTransition.message
    }

    // Bring the pre-order seats back in line with the new party size, exactly as the BOH route does.
    // Both screens write party size through their own route, so a fix applied to one of them leaves
    // the other silently stale: a manager shrinking a Christmas table on the iPad would strand a
    // seat, and the kitchen would cook for someone who is no longer coming.
    //
    // Only seasonal bookings can have seats at all, so an ordinary amendment skips this rather than
    // paying for a round trip with nothing to do. A booking whose seasonal answer has since been
    // switched off still qualifies, because it may have seats left to tidy away.
    //
    // Like the deposit above, a failure here must not be reported as a failed amendment. The size is
    // already saved, a stale cover list is recoverable, and the nightly drift check reports it.
    let preorderRemoved: PreorderRemovedCover[] = []
    if (result.state === 'updated' && currentBooking.booking_period_id) {
      try {
        const sync = await syncPreorderCovers(auth.supabase, id)
        preorderRemoved = sync.removed
      } catch (preorderError) {
        logger.error('FOH party-size pre-order cover sync failed after party size saved', {
          error: preorderError instanceof Error ? preorderError : new Error(String(preorderError)),
          metadata: { tableBookingId: id, previousPartySize, newPartySize },
        })
      }
    }

    await logAuditEvent({
      user_id: auth.userId,
      operation_type: 'table_booking.party_size_changed',
      resource_type: 'table_booking',
      resource_id: id,
      operation_status: 'success',
      additional_info: { source: 'foh', previousPartySize, newPartySize },
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      data: result,
      booking: updatedBooking,
      depositTransition,
      warning: depositWarning,
      preorderRemoved,
    })
  } catch (error) {
    logger.error('FOH table-booking party-size update failed', {
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
