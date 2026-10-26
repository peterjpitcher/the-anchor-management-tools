import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendTableBookingCancelledSmsIfAllowed } from '@/lib/table-bookings/bookings'
import { logAuditEvent } from '@/app/actions/audit'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { reportCronFailure } from '@/lib/cron/alerting'
import { logger } from '@/lib/logger'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import {
  reconcileTableDepositOrder,
  TABLE_DEPOSIT_ORDER_BOOKING_COLUMNS,
  type TableDepositOrderBooking,
} from '@/lib/table-bookings/paypal-deposit-reconcile'

/**
 * Cancels table bookings whose deposit hold ran out unpaid: the one place this happens (BK-113,
 * customer bookings review of 24 October 2026).
 *
 * The event hold cron used to get there first. It ran every five minutes against this route's
 * hourly schedule, cancelled the booking with no message to the guest, no audit row and nobody
 * named as cancelling it, and this route then found nothing left to do. All four table holds that
 * lapsed in 2026 went that way. Now this route runs every five minutes, the event cron leaves plain
 * table bookings alone, and every lapsed hold gets one cancellation, one audit row and one notice
 * that says the deposit was not paid in time.
 *
 * A booking with a PayPal order is checked with PayPal first (reconcileTableDepositOrder): a guest
 * who paid is recorded as paid and confirmed, never cancelled.
 */

export const maxDuration = 60

/**
 * How long after the hold ends before the booking is cancelled. The payment page refuses a capture
 * once the hold has passed, but a guest already inside PayPal may still be finishing; the event
 * hold path has always allowed the same margin.
 */
const HOLD_GRACE_MS = 10 * 60 * 1000

/**
 * When PayPal cannot be read, the booking is left for the next run rather than cancelled on a
 * guess, for up to this long after the hold ended. After that it is cancelled anyway: the
 * reconciliation sweep keeps checking for 30 days and reinstates a booking the guest did pay for,
 * telling a person.
 */
const PAYPAL_UNREADABLE_PATIENCE_MS = 2 * 60 * 60 * 1000

type PendingDepositBooking = TableDepositOrderBooking & {
  booking_date: string
  booking_time: string | null
  hold_expires_at: string | null
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
    const graceCutoffIso = new Date(now.getTime() - HOLD_GRACE_MS).toISOString()

    const { data: candidates, error } = await supabase
      .from('table_bookings')
      .select(`${TABLE_DEPOSIT_ORDER_BOOKING_COLUMNS}, booking_date, booking_time, hold_expires_at`)
      .eq('status', 'pending_payment')
      .eq('deposit_waived', false)
      .not('hold_expires_at', 'is', null)
      .lte('hold_expires_at', graceCutoffIso)
      .limit(1000)

    if (error) {
      logger.error('[deposit-timeout] could not load lapsed holds', { error: new Error(error.message) })
      await reportCronFailure('table-booking-deposit-timeout', error, { stage: 'fetch_candidates' })
      return NextResponse.json({ error: 'DB error' }, { status: 500 })
    }

    let cancelled = 0
    let guestsNotReached = 0
    let paidAfterAll = 0
    let deferred = 0
    for (const booking of (candidates ?? []) as unknown as PendingDepositBooking[]) {
      const holdExpiry = booking.hold_expires_at ? Date.parse(booking.hold_expires_at) : Number.NaN
      if (!Number.isFinite(holdExpiry) || holdExpiry > now.getTime() - HOLD_GRACE_MS) continue

      if (hasCapturedDeposit(booking)) {
        logger.error('[deposit-timeout] a lapsed hold has a captured deposit and was left alone', {
          metadata: {
            bookingId: booking.id,
            paymentStatus: booking.payment_status,
            hasCaptureId: Boolean(booking.paypal_deposit_capture_id),
          },
        })
        continue
      }

      // The guest may have paid in PayPal without the capture reaching us. Ask PayPal before
      // cancelling, and record the payment instead when it is there.
      if (booking.paypal_deposit_order_id) {
        const check = await reconcileTableDepositOrder(supabase, booking, { source: 'deposit_timeout' })
        if (check.outcome === 'recorded' || check.outcome === 'already_recorded') {
          paidAfterAll++
          continue
        }
        if (check.outcome === 'needs_attention') {
          // PayPal holds money for this booking that could not be recorded. A person has been told;
          // cancelling would tell a guest who paid that their table has gone.
          continue
        }
        if (check.outcome === 'lookup_failed' && now.getTime() - holdExpiry < PAYPAL_UNREADABLE_PATIENCE_MS) {
          deferred++
          continue
        }
      }

      const { data: updatedRows, error: updateErr } = await supabase
        .from('table_bookings')
        .update({
          status: 'cancelled',
          cancelled_at: nowIso,
          cancelled_by: 'system',
          cancellation_reason: 'payment_hold_expired',
          // paypal_deposit_order_id is deliberately KEPT. Clearing it destroyed
          // the only pointer to the PayPal order, which left no way to check
          // afterwards whether the guest had in fact paid, and bounded any
          // future reconciliation sweep to the hour before this cron ran. The
          // update is already guarded on paypal_deposit_capture_id IS NULL, so
          // a recorded payment is never cancelled here; keeping the id only
          // preserves the trail for the ones that were not.
          hold_expires_at: null,
          updated_at: nowIso,
        })
        .eq('id', booking.id)
        .eq('status', 'pending_payment') // Guard against race conditions
        .not('hold_expires_at', 'is', null)
        .lte('hold_expires_at', graceCutoffIso)
        .is('paypal_deposit_capture_id', null)
        .or('payment_status.is.null,payment_status.eq.pending,payment_status.eq.failed')
        // The returned rows must carry payment_status: PostgREST applies an .or() filter to them as well.
        .select('id, payment_status')

      if (updateErr) {
        logger.error('[deposit-timeout] could not cancel a lapsed hold', {
          error: new Error(updateErr.message),
          metadata: { bookingId: booking.id },
        })
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
        logger.error('[deposit-timeout] could not expire the payment hold row', {
          error: new Error(holdErr.message),
          metadata: { bookingId: booking.id },
        })
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
        logger.error('[deposit-timeout] could not mark the pending deposit payment failed', {
          error: new Error(paymentErr.message),
          metadata: { bookingId: booking.id },
        })
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
        logger.error('[deposit-timeout] could not write the audit row', {
          error: auditErr instanceof Error ? auditErr : new Error(String(auditErr)),
          metadata: { bookingId: booking.id },
        })
      }

      if (booking.customer_id) {
        // Carried over from the event hold cron, which used to cancel these.
        await recordAnalyticsEvent(supabase, {
          customerId: booking.customer_id,
          tableBookingId: booking.id,
          eventType: 'payment_failed',
          metadata: {
            payment_kind: 'table_deposit',
            booking_type: booking.booking_type || 'table',
            reason: 'hold_expired',
          },
        }).catch(() => undefined)

        try {
          const notice = await sendTableBookingCancelledSmsIfAllowed(supabase, {
            customerId: booking.customer_id,
            bookingReference: booking.booking_reference ?? booking.id,
            bookingDate: booking.booking_date,
            // Says the deposit was not paid in time, rather than nothing at all (BK-113).
            refundResult: { refunded: false, reason: 'hold_expired' },
            // Keys the email's duplicate protection and the text's log row to this booking.
            tableBookingId: booking.id,
          })
          // The audit row the notice writes names the booking.
          if (notice.status === 'failed' || notice.status === 'no_channel') {
            guestsNotReached++
          }
        } catch (err) {
          guestsNotReached++
          logger.error('[deposit-timeout] the cancellation notice threw', {
            error: err instanceof Error ? err : new Error(String(err)),
            metadata: { bookingId: booking.id },
          })
        }
      }

      cancelled++
    }

    logger.info('[deposit-timeout] completed', {
      metadata: { cancelled, guestsNotReached, paidAfterAll, deferred }
    })
    return NextResponse.json({
      cancelled,
      ...(guestsNotReached > 0 ? { guestsNotReached } : {}),
      ...(paidAfterAll > 0 ? { paidAfterAll } : {}),
      ...(deferred > 0 ? { deferred } : {}),
    })
  } catch (error) {
    logger.error('[deposit-timeout] fatal error', { error: error instanceof Error ? error : new Error(String(error)) })
    await reportCronFailure('table-booking-deposit-timeout', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
