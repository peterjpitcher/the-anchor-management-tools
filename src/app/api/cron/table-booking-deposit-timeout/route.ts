import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendTableBookingCancelledSmsIfAllowed } from '@/lib/table-bookings/bookings'
import { logAuditEvent } from '@/app/actions/audit'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { reportCronFailure } from '@/lib/cron/alerting'
import { logger } from '@/lib/logger'

export const maxDuration = 60

type PendingDepositBooking = {
  id: string
  customer_id: string | null
  booking_reference: string
  booking_date: string
  booking_time: string | null
  booking_type: string | null
  hold_expires_at: string | null
  payment_status: string | null
  paypal_deposit_capture_id: string | null
}

function hasCapturedDeposit(booking: PendingDepositBooking) {
  return Boolean(booking.paypal_deposit_capture_id)
    || booking.payment_status === 'completed'
    || booking.payment_status === 'partial_refund'
    || booking.payment_status === 'refunded'
}

export async function GET(request: NextRequest) {
  const authResult = authorizeCronRequest(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.reason ?? 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const now = new Date()
    const nowIso = now.toISOString()

    const { data: candidates, error } = await supabase
      .from('table_bookings')
      .select('id, customer_id, booking_reference, booking_date, booking_time, booking_type, hold_expires_at, payment_status, paypal_deposit_capture_id')
      .eq('status', 'pending_payment')
      .eq('deposit_waived', false)
      .not('hold_expires_at', 'is', null)
      .lte('hold_expires_at', nowIso)
      .limit(1000)

    if (error) {
      console.error('[deposit-timeout] fetch error:', error)
      await reportCronFailure('table-booking-deposit-timeout', error, { stage: 'fetch_candidates' })
      return NextResponse.json({ error: 'DB error' }, { status: 500 })
    }

    let cancelled = 0
    for (const booking of (candidates ?? []) as PendingDepositBooking[]) {
      const holdExpiry = booking.hold_expires_at ? Date.parse(booking.hold_expires_at) : Number.NaN
      if (!Number.isFinite(holdExpiry) || holdExpiry > now.getTime()) continue

      if (hasCapturedDeposit(booking)) {
        logger.warn('[deposit-timeout] skipping booking with captured deposit', {
          metadata: {
            bookingId: booking.id,
            paymentStatus: booking.payment_status,
            hasCaptureId: Boolean(booking.paypal_deposit_capture_id),
          },
        })
        continue
      }

      const { data: updatedRows, error: updateErr } = await supabase
        .from('table_bookings')
        .update({
          status: 'cancelled',
          cancelled_at: nowIso,
          cancelled_by: 'system',
          cancellation_reason: 'payment_hold_expired',
          paypal_deposit_order_id: null,
          hold_expires_at: null,
          updated_at: nowIso,
        })
        .eq('id', booking.id)
        .eq('status', 'pending_payment') // Guard against race conditions
        .not('hold_expires_at', 'is', null)
        .lte('hold_expires_at', nowIso)
        .is('paypal_deposit_capture_id', null)
        .or('payment_status.is.null,payment_status.eq.pending,payment_status.eq.failed')
        .select('id')

      if (updateErr) {
        console.error('[deposit-timeout] update error for booking', booking.id, updateErr)
        continue
      }

      if (!updatedRows || updatedRows.length === 0) {
        continue
      }

      const { error: holdErr } = await supabase
        .from('booking_holds')
        .update({
          status: 'expired',
          released_at: nowIso,
          updated_at: nowIso,
        })
        .eq('hold_type', 'payment_hold')
        .eq('status', 'active')
        .eq('table_booking_id', booking.id)

      if (holdErr) {
        console.error('[deposit-timeout] hold expiry error for booking', booking.id, holdErr)
      }

      const { error: paymentErr } = await supabase
        .from('payments')
        .update({
          status: 'failed',
          metadata: {
            payment_kind: 'table_deposit',
            reason: 'hold_expired',
            updated_at: nowIso,
          },
        })
        .eq('table_booking_id', booking.id)
        .eq('charge_type', 'table_deposit')
        .eq('status', 'pending')

      if (paymentErr) {
        console.error('[deposit-timeout] payment failure update error for booking', booking.id, paymentErr)
      }

      try {
        await logAuditEvent({
          operation_type: 'table_booking.auto_cancelled',
          resource_type: 'table_booking',
          resource_id: booking.id,
          operation_status: 'success',
          additional_info: {
            booking_reference: booking.booking_reference,
            booking_type: booking.booking_type,
            reason: 'payment_hold_expired',
            cancelled_by: 'system',
            hold_expires_at: booking.hold_expires_at,
          },
        })
      } catch (auditErr) {
        console.error('[deposit-timeout] audit log error for booking', booking.id, auditErr)
      }

      if (booking.customer_id) {
        try {
          await sendTableBookingCancelledSmsIfAllowed(supabase, {
            customerId: booking.customer_id,
            bookingReference: booking.booking_reference,
            bookingDate: booking.booking_date,
            refundResult: { refunded: false, reason: 'no_deposit' },
          })
        } catch (err) {
          console.error('[deposit-timeout] SMS error for booking', booking.id, err)
        }
      }

      cancelled++
    }

    logger.info('[deposit-timeout] completed', {
      metadata: { cancelled }
    })
    return NextResponse.json({ cancelled })
  } catch (error) {
    console.error('[deposit-timeout] Fatal error:', error)
    await reportCronFailure('table-booking-deposit-timeout', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
