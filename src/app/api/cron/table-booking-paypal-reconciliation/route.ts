import { NextRequest, NextResponse } from 'next/server'

import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { reportCronFailure } from '@/lib/cron/alerting'
import {
  reconcileTableDepositOrder,
  TABLE_DEPOSIT_ORDER_BOOKING_COLUMNS,
  type TableDepositOrderBooking,
} from '@/lib/table-bookings/paypal-deposit-reconcile'

/**
 * Settles table-booking deposits that PayPal took but this app never recorded.
 *
 * WHY THIS EXISTS
 *
 * The browser capture route can lose the race between "PayPal has the money" and "our row
 * says so": a network blip, a timeout, or a booking that moved state mid-capture all leave
 * `payment.capture_local_update_failed` in the audit log and a 502 for the customer. A
 * retry cannot fix it, because PayPal answers `ORDER_ALREADY_CAPTURED` and the route throws.
 *
 * Every other money path in this app already had a safety net for that. Table bookings had
 * neither this cron nor a subscribed webhook, so a paid deposit could sit unrecorded until
 * the deposit-timeout cron cancelled the booking and texted the guest to say so, while the
 * venue still held their money.
 *
 * This runs regardless of whether the PayPal webhook endpoint is subscribed, which is what
 * makes it the guarantee rather than a second-best.
 *
 * SAFETY
 *
 * It never captures. It only reads PayPal and records a capture PayPal has already made, so
 * the worst case is that it does nothing. The write is guarded on
 * `paypal_deposit_capture_id IS NULL`, so racing the browser or the webhook records nothing
 * twice, and the amount is read from PayPal rather than recomputed locally.
 */

/*
 * Scheduled at :50. The deposit hold timeout runs every five minutes since BK-113 and asks PayPal
 * about every lapsed hold with an order before it cancels (reconcileTableDepositOrder, the same
 * check this sweep runs), so a paid deposit is recorded rather than cancelled whichever runs first.
 * This sweep stays as the backstop: it looks back 30 days, so a payment that lands after a booking
 * was cancelled is still found, recorded, and put in front of a person.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Look back far enough to catch a booking cancelled by the hold timeout. */
const LOOKBACK_DAYS = 30
const MAX_CANDIDATES = 200

type Candidate = TableDepositOrderBooking

export async function GET(request: NextRequest) {
  const authResult = authorizeCronRequest(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.reason ?? 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  let checked = 0
  let recovered = 0
  const needsAttention: string[] = []

  try {
    // Any booking that started a PayPal payment and has no capture recorded. Cancelled ones
    // are included deliberately: those are exactly the cases where the guest paid and the
    // timeout cron cancelled them anyway, and they are the ones a human must see.
    const { data: candidates, error } = await supabase
      .from('table_bookings')
      .select(TABLE_DEPOSIT_ORDER_BOOKING_COLUMNS)
      .not('paypal_deposit_order_id', 'is', null)
      .is('paypal_deposit_capture_id', null)
      .gte('created_at', since)
      .limit(MAX_CANDIDATES)

    if (error) {
      await reportCronFailure('table-booking-paypal-reconciliation', error, {
        stage: 'fetch_candidates',
      })
      return NextResponse.json({ error: 'DB error' }, { status: 500 })
    }

    for (const booking of (candidates ?? []) as Candidate[]) {
      if (!booking.paypal_deposit_order_id) continue
      checked++

      const result = await reconcileTableDepositOrder(supabase, booking, { source: 'reconciliation_cron' })
      if (result.outcome === 'needs_attention') {
        needsAttention.push(booking.booking_reference ?? booking.id)
      } else if (result.outcome === 'recorded') {
        recovered++
        if (result.wasCancelled) needsAttention.push(booking.booking_reference ?? booking.id)
      }
    }

    if (needsAttention.length > 0) {
      logger.error('Table booking deposits were reconciled and need a human to check them', {
        metadata: { bookings: needsAttention },
      })
    }

    logger.info('[table-booking-paypal-reconciliation] completed', {
      metadata: { checked, recovered, needsAttention: needsAttention.length },
    })

    return NextResponse.json({ checked, recovered, needsAttention })
  } catch (error) {
    await reportCronFailure('table-booking-paypal-reconciliation', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
