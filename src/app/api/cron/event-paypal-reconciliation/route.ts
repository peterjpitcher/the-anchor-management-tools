import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPayPalOrder, getPayPalRefund } from '@/lib/paypal'
import { logger } from '@/lib/logger'
import {
  sendEventPaymentConfirmationSms,
  sendEventPaymentManualReviewSms,
} from '@/lib/events/event-payments'
import {
  sendEventPaymentConfirmationEmail,
  sendEventPaymentManualReviewEmail,
} from '@/lib/email/event-ticket-emails'
import { reconcileEventRefund } from '@/lib/events/refund-reconciliation'

function extractCapture(order: any): { id: string; amount: number; currency: string } | null {
  const capture = order?.purchase_units?.[0]?.payments?.captures?.[0]
  const id = typeof capture?.id === 'string' ? capture.id : ''
  const amount = Number(capture?.amount?.value)
  const currency = typeof capture?.amount?.currency_code === 'string'
    ? capture.amount.currency_code.toUpperCase()
    : 'GBP'
  if (!id || !Number.isFinite(amount)) return null
  return { id, amount: Number(amount.toFixed(2)), currency }
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
    skipped: 0,
    failed: 0,
    refundsChecked: 0,
    refundsResolved: 0,
    refundsFailed: 0,
  }

  const { data: rows, error } = await supabase
    .from('payments')
    .select('id, event_booking_id, paypal_order_id')
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

  for (const row of rows || []) {
    result.checked++
    try {
      const order = await getPayPalOrder(row.paypal_order_id as string)
      const capture = extractCapture(order)
      if (!capture) {
        result.skipped++
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
        await sendEventPaymentManualReviewSms(supabase, { bookingId: row.event_booking_id as string })
        await sendEventPaymentManualReviewEmail(supabase, {
          bookingId: row.event_booking_id as string,
          amount: capture.amount,
          currency: capture.currency,
        })
      } else {
        result.skipped++
      }
    } catch (err) {
      result.failed++
      logger.error('Failed to reconcile event PayPal payment', {
        error: err instanceof Error ? err : new Error(String(err)),
        metadata: {
          paymentId: row.id,
          bookingId: row.event_booking_id,
          orderId: row.paypal_order_id,
        },
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
          // 23505 = the open exception already exists for this booking — fine.
          if (exceptionError && exceptionError.code !== '23505') {
            logger.error('Failed to raise exception for unreconcilable pending refund', {
              metadata: { paymentId: row.id, bookingId: row.event_booking_id, error: exceptionError.message },
            })
          }
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
