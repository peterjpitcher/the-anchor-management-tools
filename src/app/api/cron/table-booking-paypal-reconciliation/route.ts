import { NextRequest, NextResponse } from 'next/server'

import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPayPalOrder, isPayPalOrderNotFoundError } from '@/lib/paypal'
import { logger } from '@/lib/logger'
import { logAuditEvent } from '@/app/actions/audit'
import { reportCronFailure } from '@/lib/cron/alerting'
import {
  buildPayPalDepositCompletedUpdate,
  parsePayPalAmountGbp,
  payPalAmountsMatch,
  sendTableBookingDepositCapturedNotifications,
} from '@/lib/table-bookings/paypal-deposit'
import { getCanonicalDeposit } from '@/lib/table-bookings/deposit'

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
 * Scheduled at :50, ten minutes AHEAD of table-booking-deposit-timeout at :00. Running
 * after the timeout would still recover the money, but only by un-cancelling a booking the
 * guest had already been texted about. Running first means a paid deposit is recorded
 * before the timeout ever evaluates it.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Look back far enough to catch a booking cancelled by the hold timeout. */
const LOOKBACK_DAYS = 30
const MAX_CANDIDATES = 200

type Candidate = {
  id: string
  booking_reference: string | null
  customer_id: string | null
  status: string | null
  payment_status: string | null
  paypal_deposit_order_id: string | null
  paypal_deposit_capture_id: string | null
  // Read only to work out what this booking actually owes, so a capture can be
  // checked against it before the figure is locked in.
  party_size: number | null
  deposit_amount: number | null
  deposit_amount_locked: number | null
  deposit_waived: boolean | null
  booking_type: string | null
}

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
      .select(
        'id, booking_reference, customer_id, status, payment_status, paypal_deposit_order_id, paypal_deposit_capture_id, party_size, deposit_amount, deposit_amount_locked, deposit_waived, booking_type',
      )
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
      const orderId = booking.paypal_deposit_order_id
      if (!orderId) continue
      checked++

      let order: any
      try {
        order = await getPayPalOrder(orderId)
      } catch (err) {
        // An order PayPal has never heard of is an abandoned checkout, which is the normal
        // case and not worth an alert.
        if (isPayPalOrderNotFoundError(err)) continue
        logger.warn('Table booking PayPal reconciliation could not read an order', {
          error: err instanceof Error ? err : new Error(String(err)),
          metadata: { bookingId: booking.id, orderId },
        })
        continue
      }

      const capture = order?.purchase_units?.[0]?.payments?.captures?.find(
        (c: { status?: string }) => c?.status === 'COMPLETED',
      )
      if (!capture?.id) continue

      /*
       * The order must belong to THIS booking before anything from it is written.
       * custom_id here is the bare booking id, with no prefix. Without this check a
       * mis-stored order id would quietly record another booking's payment against
       * this one, and the browser capture path checks it for exactly that reason.
       */
      const orderCustomId = order?.purchase_units?.[0]?.custom_id
      if (typeof orderCustomId !== 'string' || orderCustomId !== booking.id) {
        needsAttention.push(booking.booking_reference ?? booking.id)
        await logAuditEvent({
          operation_type: 'payment.capture_booking_mismatch',
          resource_type: 'table_booking',
          resource_id: booking.id,
          operation_status: 'failure',
          additional_info: {
            source: 'reconciliation_cron',
            order_id: orderId,
            capture_id: capture.id,
            actual_custom_id: orderCustomId ?? null,
            action_needed:
              'PayPal order custom_id does not match this booking. Manual investigation required.',
          },
        }).catch(() => undefined)
        continue
      }

      // Everything downstream assumes pounds: deposit_amount_locked has no currency
      // column, so a non-GBP capture would be stored as though it were sterling.
      const captureCurrency = typeof capture?.amount?.currency_code === 'string'
        ? capture.amount.currency_code.toUpperCase()
        : null
      if (captureCurrency !== 'GBP') {
        needsAttention.push(booking.booking_reference ?? booking.id)
        await logAuditEvent({
          operation_type: 'payment.capture_currency_mismatch',
          resource_type: 'table_booking',
          resource_id: booking.id,
          operation_status: 'failure',
          additional_info: {
            source: 'reconciliation_cron',
            order_id: orderId,
            capture_id: capture.id,
            currency: captureCurrency,
            action_needed:
              'PayPal captured in a currency other than GBP, so it was not recorded.',
          },
        }).catch(() => undefined)
        continue
      }

      // PayPal took the money and we never recorded it.
      const lockedAmountGbp = parsePayPalAmountGbp(capture?.amount?.value ?? null)
      if (lockedAmountGbp === null) {
        needsAttention.push(booking.booking_reference ?? booking.id)
        await logAuditEvent({
          operation_type: 'payment.capture_amount_unparseable',
          resource_type: 'table_booking',
          resource_id: booking.id,
          operation_status: 'failure',
          additional_info: {
            source: 'reconciliation_cron',
            order_id: orderId,
            capture_id: capture.id,
            raw_amount: capture?.amount?.value ?? null,
            action_needed:
              'PayPal shows a completed capture but the amount was unreadable, so it was not recorded',
          },
        }).catch(() => undefined)
        continue
      }

      /*
       * The captured figure is about to be written into deposit_amount_locked, which is
       * what the venue then treats as owed and what any refund is measured against. It
       * must agree with what this booking actually owes: a stale order created before the
       * party size changed would otherwise lock the old, wrong amount. The browser capture
       * path refuses this case, so the sweep backing it up must refuse it too rather than
       * being the more permissive of the two.
       */
      const expectedAmount = Number(
        getCanonicalDeposit({
          party_size: Math.max(1, Number(booking.party_size || 1)),
          deposit_amount: booking.deposit_amount ?? null,
          deposit_amount_locked: booking.deposit_amount_locked ?? null,
          status: booking.status ?? null,
          payment_status: booking.payment_status ?? null,
          deposit_waived: booking.deposit_waived ?? null,
          // Christmas bookings owe a deposit at any party size.
          booking_type: booking.booking_type ?? null,
        }).toFixed(2),
      )

      if (!payPalAmountsMatch(lockedAmountGbp, expectedAmount)) {
        needsAttention.push(booking.booking_reference ?? booking.id)
        await logAuditEvent({
          operation_type: 'payment.capture_amount_mismatch',
          resource_type: 'table_booking',
          resource_id: booking.id,
          operation_status: 'failure',
          additional_info: {
            source: 'reconciliation_cron',
            order_id: orderId,
            capture_id: capture.id,
            captured_amount: lockedAmountGbp,
            expected_amount: expectedAmount,
            action_needed:
              'PayPal captured an amount that does not match this booking. Manual reconciliation required.',
          },
        }).catch(() => undefined)
        continue
      }

      const { data: updated, error: updateError } = await supabase
        .from('table_bookings')
        .update(
          buildPayPalDepositCompletedUpdate({
            captureId: capture.id,
            lockedAmountGbp,
            capturedAtIso: capture?.create_time ?? undefined,
          }),
        )
        .eq('id', booking.id)
        // Guard against the browser or the webhook winning the race in between.
        .is('paypal_deposit_capture_id', null)
        .select('id')
        .maybeSingle()

      if (updateError) {
        logger.error('Table booking PayPal reconciliation failed to record a capture', {
          error: new Error(updateError.message),
          metadata: { bookingId: booking.id, orderId, captureId: capture.id },
        })
        needsAttention.push(booking.booking_reference ?? booking.id)
        continue
      }

      if (!updated) continue // Someone else recorded it first. Nothing to do.

      recovered++

      /*
       * A booking already cancelled by the deposit timeout is now marked paid and confirmed
       * by the update above, which is the right end state: the guest did pay. Flag it so a
       * human checks the table is still actually available for them.
       */
      const wasCancelled = booking.status === 'cancelled'
      if (wasCancelled) needsAttention.push(booking.booking_reference ?? booking.id)

      await logAuditEvent({
        operation_type: 'payment.captured',
        resource_type: 'table_booking',
        resource_id: booking.id,
        operation_status: 'success',
        additional_info: {
          source: 'reconciliation_cron',
          order_id: orderId,
          capture_id: capture.id,
          locked_amount_gbp: lockedAmountGbp,
          previous_status: booking.status,
          action_needed: wasCancelled
            ? 'This booking had been cancelled for non-payment but the guest had in fact paid. Confirm the table is still available.'
            : undefined,
        },
      }).catch(() => undefined)

      await sendTableBookingDepositCapturedNotifications(supabase, {
        tableBookingId: booking.id,
        customerId: booking.customer_id,
        createdVia: 'reconciliation_cron',
      }).catch((err) => {
        logger.warn('Reconciled a table booking deposit but the confirmation failed to send', {
          error: err instanceof Error ? err : new Error(String(err)),
          metadata: { bookingId: booking.id },
        })
      })
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
