import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPayPalOrder, getPayPalRefund, isPayPalOrderNotFoundError } from '@/lib/paypal'
import { payPalCaptureOutcome } from '@/lib/paypal-capture-outcome'
import { logger } from '@/lib/logger'
import {
  sendEventPaymentConfirmationSms,
  sendEventPaymentManualReviewSms,
} from '@/lib/events/event-payments'
import { EVENT_CAPTURE_PENDING_STATUS } from '@/lib/events/payment-awaiting-decision'
import {
  sendEventPaymentConfirmationEmail,
  sendEventPaymentManualReviewEmail,
} from '@/lib/email/event-ticket-emails'
import { reconcileEventRefund } from '@/lib/events/refund-reconciliation'
import { alertEventPaymentNeedsAPerson } from '@/lib/events/payment-alerts'

/*
 * PayPal purges an order the customer never completed, so a 404 on one is the
 * ordinary end state of an abandoned checkout, not a failure worth an error
 * log. The seat hold is 15 minutes, so once a pending row is a day old nothing
 * can ever complete it: write it off rather than re-reading a dead order every
 * 15 minutes forever.
 */
const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000

type PendingEventPayment = {
  id: string
  event_booking_id: string | null
  paypal_order_id: string | null
  created_at: string | null
  metadata: Record<string, unknown> | null
}

/**
 * Marks a pending event payment whose PayPal order no longer exists as failed,
 * so the reconciliation sweep stops picking it up. Returns true when the row
 * was written off. Guarded on `status = 'pending'` so a confirmation landing at
 * the same moment is never overwritten.
 */
async function writeOffAbandonedPayment(
  supabase: ReturnType<typeof createAdminClient>,
  row: PendingEventPayment
): Promise<boolean> {
  const createdAt = row.created_at ? Date.parse(row.created_at) : Number.NaN
  if (!Number.isFinite(createdAt) || Date.now() - createdAt < ABANDONED_AFTER_MS) {
    return false
  }

  const nowIso = new Date().toISOString()
  const { error } = await supabase
    .from('payments')
    .update({
      status: 'failed',
      updated_at: nowIso,
      metadata: {
        ...(row.metadata ?? {}),
        abandoned_at: nowIso,
        abandoned_reason: 'paypal_order_not_found',
      },
    })
    .eq('id', row.id)
    .eq('status', 'pending')

  if (error) {
    // Left unwritten this row comes back every run, so this must stay visible.
    logger.error('Failed to write off an abandoned event PayPal payment', {
      error: new Error(error.message),
      metadata: { paymentId: row.id, bookingId: row.event_booking_id, orderId: row.paypal_order_id },
    })
    return false
  }

  return true
}

function extractCapture(order: any): { id: string; amount: number; currency: string; status: string | null; statusReason: string | null } | null {
  const capture = order?.purchase_units?.[0]?.payments?.captures?.[0]
  const id = typeof capture?.id === 'string' ? capture.id : ''
  const amount = Number(capture?.amount?.value)
  const currency = typeof capture?.amount?.currency_code === 'string'
    ? capture.amount.currency_code.toUpperCase()
    : 'GBP'
  if (!id || !Number.isFinite(amount)) return null
  return {
    id,
    amount: Number(amount.toFixed(2)),
    currency,
    // The capture's own status, not the order's: an order can be COMPLETED while PayPal still
    // holds its capture as PENDING, and a DECLINED capture is no payment at all (BK-019).
    status: typeof capture?.status === 'string' ? capture.status.toUpperCase() : null,
    statusReason: typeof capture?.status_details?.reason === 'string' ? capture.status_details.reason : null,
  }
}

/**
 * Records on the payment row that PayPal has not completed its capture (BK-019). A PENDING one
 * keeps the row pending with the capture id and a marker, which also tells the hold job to
 * leave the booking alone; anything else marks the row failed so the sweep stops re-reading it.
 * Guarded on `status = 'pending'` so a confirmation landing at the same moment is never undone.
 */
async function recordUnfinishedCapture(
  supabase: ReturnType<typeof createAdminClient>,
  row: PendingEventPayment,
  capture: { id: string; status: string | null; statusReason: string | null },
  outcome: 'pending' | 'declined'
): Promise<void> {
  const metadata = row.metadata ?? {}
  if (outcome === 'pending' && metadata.capture_status === EVENT_CAPTURE_PENDING_STATUS) return
  const nowIso = new Date().toISOString()
  const { error } = await supabase
    .from('payments')
    .update({
      ...(outcome === 'declined' ? { status: 'failed' } : {}),
      paypal_capture_id: capture.id,
      metadata: {
        ...metadata,
        capture_status: outcome === 'pending' ? EVENT_CAPTURE_PENDING_STATUS : (capture.status || 'DECLINED'),
        capture_status_reason: capture.statusReason,
        capture_status_at: nowIso,
      },
      updated_at: nowIso,
    })
    .eq('id', row.id)
    .eq('status', 'pending')

  if (error) {
    logger.error('Failed to record an unfinished PayPal capture on an event payment', {
      error: new Error(error.message),
      metadata: { paymentId: row.id, bookingId: row.event_booking_id, orderId: row.paypal_order_id, captureId: capture.id, outcome },
    })
  }
}

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const result = {
    checked: 0,
    confirmed: 0,
    manualReview: 0,
    paidButBlocked: 0,
    capturePending: 0,
    captureDeclined: 0,
    skipped: 0,
    abandoned: 0,
    abandonedWrittenOff: 0,
    failed: 0,
    refundsChecked: 0,
    refundsResolved: 0,
    refundsFailed: 0,
  }

  const { data: rows, error } = await supabase
    .from('payments')
    .select('id, event_booking_id, paypal_order_id, created_at, metadata')
    .eq('payment_provider', 'paypal')
    .eq('charge_type', 'prepaid_event')
    .eq('status', 'pending')
    .not('event_booking_id', 'is', null)
    .not('paypal_order_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(100)

  if (error) {
    logger.error('Failed to load event PayPal payments for reconciliation', {
      error: new Error(error.message),
    })
    return NextResponse.json({ error: 'Failed to load payments' }, { status: 500 })
  }

  for (const row of (rows || []) as PendingEventPayment[]) {
    result.checked++
    try {
      const order = await getPayPalOrder(row.paypal_order_id as string)
      const capture = extractCapture(order)
      if (!capture) {
        result.skipped++
        continue
      }

      // Only a COMPLETED capture confirms the booking.
      const outcome = payPalCaptureOutcome(capture.status)
      if (outcome !== 'completed') {
        await recordUnfinishedCapture(supabase, row, capture, outcome)
        if (outcome === 'pending') {
          result.capturePending++
          await alertEventPaymentNeedsAPerson(supabase, {
            bookingId: row.event_booking_id as string,
            kind: 'capture_pending',
            reason: capture.statusReason,
            amount: capture.amount,
            orderId: row.paypal_order_id,
            captureId: capture.id,
            source: 'reconciliation cron',
          })
        } else {
          result.captureDeclined++
        }
        continue
      }

      const { data: confirmRaw, error: confirmError } = await supabase.rpc(
        'confirm_event_paypal_payment_v01',
        {
          p_event_booking_id: row.event_booking_id,
          p_paypal_order_id: row.paypal_order_id,
          p_paypal_capture_id: capture.id,
          p_amount: capture.amount,
          p_currency: capture.currency,
          p_source: 'paypal_reconciliation',
        }
      )

      if (confirmError) throw confirmError
      const state = typeof (confirmRaw as any)?.state === 'string' ? (confirmRaw as any).state : 'blocked'

      if (state === 'confirmed' || state === 'already_confirmed') {
        result.confirmed++
        if (state === 'confirmed') {
          await sendEventPaymentConfirmationSms(supabase, {
            bookingId: row.event_booking_id as string,
            eventName: 'your event',
            seats: 1,
            appBaseUrl: process.env.NEXT_PUBLIC_APP_URL,
          })
        }
        await sendEventPaymentConfirmationEmail(supabase, {
          bookingId: row.event_booking_id as string,
          amount: capture.amount,
          currency: capture.currency,
          appBaseUrl: process.env.NEXT_PUBLIC_APP_URL,
        })
      } else if (state === 'manual_review') {
        result.manualReview++
        await alertEventPaymentNeedsAPerson(supabase, {
          bookingId: row.event_booking_id as string,
          kind: 'manual_review',
          reason: typeof (confirmRaw as any)?.reason === 'string' ? (confirmRaw as any).reason : null,
          amount: capture.amount,
          orderId: row.paypal_order_id,
          captureId: capture.id,
          source: 'reconciliation cron',
        })
        await sendEventPaymentManualReviewSms(supabase, { bookingId: row.event_booking_id as string })
        await sendEventPaymentManualReviewEmail(supabase, {
          bookingId: row.event_booking_id as string,
          amount: capture.amount,
          currency: capture.currency,
        })
      } else {
        // PayPal took the money but the booking could not take it (for example it was cancelled
        // while the guest paid). This used to be counted as skipped and nothing else (BK-114):
        // raise a payment exception for the staff list and tell a manager.
        result.paidButBlocked++
        const reason = typeof (confirmRaw as any)?.reason === 'string' ? (confirmRaw as any).reason : state
        const paymentId = typeof (confirmRaw as any)?.payment_id === 'string' ? (confirmRaw as any).payment_id : row.id
        const { error: exceptionError } = await supabase.from('event_payment_exceptions').insert({
          event_booking_id: row.event_booking_id,
          payment_id: paymentId,
          reason: 'manual_refund_required',
          metadata: {
            source: 'event_paypal_reconciliation',
            detail: 'captured_but_booking_not_payable',
            confirm_state: state,
            confirm_reason: reason,
            paypal_order_id: row.paypal_order_id,
            paypal_capture_id: capture.id,
            amount: capture.amount,
          },
        })
        // 23505 = the open exception already exists for this booking.
        if (exceptionError && exceptionError.code !== '23505') {
          logger.error('Failed to raise exception for a paid event booking that could not be confirmed', {
            error: new Error(exceptionError.message),
            metadata: { paymentId: row.id, bookingId: row.event_booking_id },
          })
        }
        await alertEventPaymentNeedsAPerson(supabase, {
          bookingId: row.event_booking_id as string,
          kind: 'paid_booking_not_payable',
          reason,
          amount: capture.amount,
          orderId: row.paypal_order_id,
          captureId: capture.id,
          source: 'reconciliation cron',
        })
      }
    } catch (err) {
      if (isPayPalOrderNotFoundError(err)) {
        // Abandoned checkout: no money moved and none ever will.
        result.abandoned++
        if (await writeOffAbandonedPayment(supabase, row)) {
          result.abandonedWrittenOff++
        }
        continue
      }

      result.failed++
      logger.error('Failed to reconcile event PayPal payment', {
        error: err instanceof Error ? err : new Error(String(err)),
        metadata: {
          paymentId: row.id,
          bookingId: row.event_booking_id,
          orderId: row.paypal_order_id,
        },
      })
      // Once per booking, however many runs it fails (BK-114).
      await alertEventPaymentNeedsAPerson(supabase, {
        bookingId: row.event_booking_id as string,
        kind: 'reconcile_failed',
        reason: err instanceof Error ? err.message.slice(0, 200) : null,
        orderId: row.paypal_order_id,
        source: 'reconciliation cron',
      })
    }
  }

  // Sweep pending refunds that PayPal accepted but hasn't reported terminal yet
  // (backstop for a missed PAYMENT.REFUND.* webhook).
  const { data: refundRows, error: refundError } = await supabase
    .from('payments')
    .select('id, event_booking_id, metadata')
    .eq('payment_provider', 'paypal')
    .eq('charge_type', 'refund')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(100)

  if (refundError) {
    logger.error('Failed to load pending event refunds for reconciliation', {
      error: new Error(refundError.message),
    })
  } else {
    for (const row of refundRows || []) {
      const metadata = (row.metadata ?? {}) as Record<string, unknown>
      const refundId = metadata['paypal_refund_id']
      if (typeof refundId !== 'string' || !refundId) {
        // A pending refund with no PayPal refund id can never reconcile itself.
        // Count the skips on the row and raise a staff exception after 3, so it
        // stops being invisible.
        result.skipped++
        const skipCount = Math.max(0, Number(metadata['reconciliation_skip_count'] ?? 0)) + 1
        const { error: skipUpdateError } = await supabase
          .from('payments')
          .update({
            metadata: { ...metadata, reconciliation_skip_count: skipCount },
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id)

        if (skipUpdateError) {
          logger.warn('Failed to record reconciliation skip on pending refund', {
            metadata: { paymentId: row.id, error: skipUpdateError.message },
          })
        }

        if (skipCount >= 3 && row.event_booking_id) {
          const { error: exceptionError } = await supabase.from('event_payment_exceptions').insert({
            event_booking_id: row.event_booking_id,
            payment_id: row.id,
            reason: 'manual_refund_required',
            metadata: {
              source: 'event_paypal_reconciliation',
              detail: 'pending_refund_missing_paypal_refund_id',
              reconciliation_skip_count: skipCount,
            },
          })
          // 23505 = the open exception already exists for this booking: fine.
          if (exceptionError && exceptionError.code !== '23505') {
            logger.error('Failed to raise exception for unreconcilable pending refund', {
              metadata: { paymentId: row.id, bookingId: row.event_booking_id, error: exceptionError.message },
            })
          }
          await alertEventPaymentNeedsAPerson(supabase, {
            bookingId: row.event_booking_id,
            kind: 'refund_failed',
            reason: 'a pending refund has no PayPal refund id, so it cannot be checked',
            source: 'reconciliation cron',
          })
        }
        continue
      }
      result.refundsChecked++
      try {
        const refund = await getPayPalRefund(refundId)
        const reconciled = await reconcileEventRefund(supabase, {
          paypalRefundId: refundId,
          paypalStatus: refund.status,
        })
        if (reconciled.changed) {
          if (reconciled.outcome === 'failed') result.refundsFailed++
          else result.refundsResolved++
        }
      } catch (err) {
        result.refundsFailed++
        logger.error('Failed to reconcile event PayPal refund', {
          error: err instanceof Error ? err : new Error(String(err)),
          metadata: { paymentId: row.id, bookingId: row.event_booking_id, refundId },
        })
      }
    }
  }

  return NextResponse.json(result)
}
