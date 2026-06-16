import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPayPalOrder } from '@/lib/paypal'
import { logger } from '@/lib/logger'
import {
  sendEventPaymentConfirmationSms,
  sendEventPaymentManualReviewSms,
} from '@/lib/events/event-payments'

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
      } else if (state === 'manual_review') {
        result.manualReview++
        await sendEventPaymentManualReviewSms(supabase, { bookingId: row.event_booking_id as string })
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

  return NextResponse.json(result)
}
