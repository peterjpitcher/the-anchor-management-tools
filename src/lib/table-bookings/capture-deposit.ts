import type { SupabaseClient } from '@supabase/supabase-js'
import { logAuditEvent } from '@/app/actions/audit'
import { logger } from '@/lib/logger'
import { PAYPAL_DEFAULT_CURRENCY, capturePayPalPayment, getPayPalOrder } from '@/lib/paypal'
import { payPalCaptureOutcome } from '@/lib/paypal-capture-outcome'
import { getCanonicalDeposit } from '@/lib/table-bookings/deposit'
import { alertTableDepositNeedsAPerson } from '@/lib/table-bookings/deposit-alerts'
import {
  buildPayPalDepositCompletedUpdate,
  extractPayPalOrderAmountGbp,
  getPayPalDepositCaptureBlockReason,
  parsePayPalAmountGbp,
  payPalAmountsMatch,
  sendTableBookingDepositCapturedNotifications,
  type PayPalDepositCaptureBlockReason,
} from '@/lib/table-bookings/paypal-deposit'

/**
 * Takes a table deposit through PayPal: the one capture path for table bookings (BK-129,
 * customer bookings review of 24 October 2026).
 *
 * The website's capture route (api/external/table-bookings/[id]/paypal/capture-order) and the
 * guest payment page (g/[token]/table-payment) each carried their own copy of these steps, and
 * they had already drifted: only the page checked that the PayPal order named this booking. Both
 * now call this, and each turns the result into its own words for its own caller.
 *
 * The steps, in order, each stopping the capture when it fails:
 *  1. read the booking; a deposit already recorded is a success, so a retry is harmless;
 *  2. the order must be the one stored on the booking, and the booking must still be payable;
 *  3. the PayPal order's amount must match what the booking owes, BEFORE anything is captured;
 *  4. capture; only a COMPLETED capture is money taken (BK-019);
 *  5. the capture must name this booking and its amount must be readable and match;
 *  6. record it on the booking, guarded so a booking cancelled meanwhile is never marked paid;
 *  7. tell the guest.
 *
 * Every failure after money may have moved tells the manager (alertTableDepositNeedsAPerson), and
 * the caller is told not to let the guest retry. Never throws.
 */

export type TableDepositCaptureFailureCode =
  | 'BOOKING_NOT_FOUND'
  | 'ORDER_MISMATCH'
  | 'NOT_PAYABLE'
  | 'PAYPAL_ORDER_LOOKUP_FAILED'
  | 'AMOUNT_MISMATCH'
  | 'CAPTURE_FAILED'
  | 'CAPTURE_PENDING'
  | 'CAPTURE_DECLINED'
  | 'CAPTURE_BOOKING_MISMATCH'
  | 'CAPTURED_AMOUNT_UNVERIFIED'
  | 'CAPTURED_AMOUNT_MISMATCH'
  | 'CAPTURED_BOOKING_UPDATE_FAILED'

export type CaptureTableDepositResult =
  | { ok: true; alreadyRecorded: boolean }
  | { ok: false; code: 'NOT_PAYABLE'; blockReason: PayPalDepositCaptureBlockReason }
  | { ok: false; code: Exclude<TableDepositCaptureFailureCode, 'NOT_PAYABLE'> }

export type CaptureTableDepositInput = {
  bookingId: string
  orderId: string
  /** Named on the manager alert, e.g. 'website capture' or 'guest payment link'. */
  source: string
  /** Recorded with the guest notifications, e.g. 'api' or 'guest_table_payment'. */
  createdVia: string
  currency?: string
}

const BOOKING_COLUMNS =
  'id, status, payment_status, hold_expires_at, paypal_deposit_order_id, paypal_deposit_capture_id, customer_id, party_size, deposit_amount, deposit_amount_locked, deposit_waived, booking_type'

function auditFailure(bookingId: string, operationType: string, info: Record<string, unknown>): void {
  void logAuditEvent({
    operation_type: operationType,
    resource_type: 'table_booking',
    resource_id: bookingId,
    operation_status: 'failure',
    additional_info: info,
  })
}

export async function captureTableDeposit(
  supabase: SupabaseClient<any, 'public', any>,
  input: CaptureTableDepositInput,
): Promise<CaptureTableDepositResult> {
  const { bookingId, orderId, source } = input
  // Set once PayPal reports the money taken: from then on a failure means money taken and not
  // recorded, which a person must hear about and the guest must not retry.
  let moneyTaken = false
  let captureId: string | null = null
  let capturedAmountGbp: number | null = null

  try {
    const { data: booking, error: fetchError } = await supabase
      .from('table_bookings')
      .select(BOOKING_COLUMNS)
      .eq('id', bookingId)
      .maybeSingle()

    if (fetchError || !booking) {
      if (fetchError) {
        logger.error('Table deposit capture could not read the booking', {
          error: new Error(fetchError.message),
          metadata: { bookingId, code: fetchError.code, details: fetchError.details },
        })
      }
      return { ok: false, code: 'BOOKING_NOT_FOUND' }
    }

    // Already recorded: a retry, or the webhook got there first.
    if (booking.payment_status === 'completed' && booking.paypal_deposit_capture_id) {
      return { ok: true, alreadyRecorded: true }
    }

    if (booking.paypal_deposit_order_id !== orderId) {
      return { ok: false, code: 'ORDER_MISMATCH' }
    }

    const blockReason = getPayPalDepositCaptureBlockReason(booking)
    if (blockReason) {
      return { ok: false, code: 'NOT_PAYABLE', blockReason }
    }

    const expectedAmount = Number(
      getCanonicalDeposit({
        party_size: Math.max(1, Number(booking.party_size || 1)),
        deposit_amount: booking.deposit_amount ?? null,
        deposit_amount_locked: booking.deposit_amount_locked ?? null,
        status: booking.status ?? null,
        payment_status: booking.payment_status ?? null,
        deposit_waived: booking.deposit_waived ?? null,
        // Christmas bookings owe a deposit at any party size; the amount must match the order.
        booking_type: booking.booking_type ?? null,
      }).toFixed(2),
    )

    let orderAmount: number | null
    try {
      orderAmount = extractPayPalOrderAmountGbp(await getPayPalOrder(orderId))
    } catch (error) {
      logger.error('Table deposit capture could not read the PayPal order before capturing', {
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: { bookingId, orderId },
      })
      return { ok: false, code: 'PAYPAL_ORDER_LOOKUP_FAILED' }
    }

    if (orderAmount === null || !payPalAmountsMatch(orderAmount, expectedAmount)) {
      auditFailure(bookingId, 'payment.capture_amount_mismatch', {
        orderId,
        orderAmount,
        expectedAmount,
        action_needed: 'PayPal order amount did not match current booking deposit before capture',
      })
      return { ok: false, code: 'AMOUNT_MISMATCH' }
    }

    let capture: Awaited<ReturnType<typeof capturePayPalPayment>>
    try {
      capture = await capturePayPalPayment(orderId, input.currency ?? PAYPAL_DEFAULT_CURRENCY)
    } catch (error) {
      auditFailure(bookingId, 'payment.capture_failed', {
        orderId,
        error: error instanceof Error ? error.message : String(error),
      })
      return { ok: false, code: 'CAPTURE_FAILED' }
    }
    captureId = capture.transactionId ?? null

    // Only a COMPLETED capture is a paid deposit (BK-019). A PENDING one is recorded by the
    // PAYMENT.CAPTURE.COMPLETED webhook if PayPal releases it; a refused one took no money. Either
    // way the booking is left as it is.
    const captureOutcome = payPalCaptureOutcome(capture.captureStatus)
    if (captureOutcome !== 'completed') {
      logger.error('PayPal did not complete a table deposit capture', {
        error: new Error(`table_deposit_capture_${captureOutcome}`),
        metadata: { bookingId, orderId, captureId, captureStatus: capture.captureStatus ?? null, reason: capture.captureStatusReason ?? null },
      })
      auditFailure(bookingId, captureOutcome === 'pending' ? 'payment.capture_pending' : 'payment.capture_declined', {
        orderId,
        transactionId: captureId,
        captureStatus: capture.captureStatus ?? null,
        captureStatusReason: capture.captureStatusReason ?? null,
        action_needed: captureOutcome === 'pending'
          ? 'PayPal is holding this deposit for review. The booking is not marked paid; the PayPal webhook records it if PayPal completes it. Check the payment in PayPal if it does not clear.'
          : 'PayPal refused this deposit capture. No money was taken and the booking is not marked paid.',
      })
      if (captureOutcome === 'pending') {
        await alertTableDepositNeedsAPerson(supabase, {
          bookingId,
          kind: 'capture_pending',
          amountGbp: parsePayPalAmountGbp(capture.amount),
          orderId,
          captureId,
          detail: capture.captureStatusReason ?? null,
          source,
        })
        return { ok: false, code: 'CAPTURE_PENDING' }
      }
      return { ok: false, code: 'CAPTURE_DECLINED' }
    }
    moneyTaken = true

    // The order must belong to THIS booking. Without this a mis-stored order id would record
    // another booking's payment against this one. Only the guest page checked it before BK-129.
    if (capture.customId && capture.customId !== bookingId) {
      auditFailure(bookingId, 'payment.capture_booking_mismatch', {
        orderId,
        expectedBookingId: bookingId,
        actualCustomId: capture.customId,
        transactionId: captureId,
        action_needed: 'Manual investigation: PayPal order custom_id does not match booking',
      })
      await alertTableDepositNeedsAPerson(supabase, {
        bookingId,
        kind: 'capture_booking_mismatch',
        amountGbp: parsePayPalAmountGbp(capture.amount),
        orderId,
        captureId,
        detail: 'the PayPal order names a different booking',
        source,
      })
      return { ok: false, code: 'CAPTURE_BOOKING_MISMATCH' }
    }

    // The captured figure is what gets locked on the booking. Fail closed when it cannot be read:
    // falling back to the booking's own figure is how a stale amount gets locked.
    capturedAmountGbp = parsePayPalAmountGbp(capture.amount)
    if (capturedAmountGbp === null) {
      logger.error('Table deposit capture succeeded but no GBP amount could be read', {
        metadata: { bookingId, orderId, transactionId: captureId, rawAmount: capture.amount ?? null },
      })
      auditFailure(bookingId, 'payment.capture_amount_unparseable', {
        orderId,
        transactionId: captureId,
        rawAmount: String(capture.amount ?? 'null'),
        action_needed: 'PayPal capture succeeded but the captured amount was missing or unparseable. Manual reconciliation required.',
      })
      await alertTableDepositNeedsAPerson(supabase, {
        bookingId,
        kind: 'captured_amount_problem',
        orderId,
        captureId,
        detail: 'the captured amount could not be read',
        source,
      })
      return { ok: false, code: 'CAPTURED_AMOUNT_UNVERIFIED' }
    }

    if (!payPalAmountsMatch(capturedAmountGbp, expectedAmount)) {
      auditFailure(bookingId, 'payment.capture_amount_mismatch', {
        orderId,
        transactionId: captureId,
        capturedAmount: capturedAmountGbp,
        expectedAmount,
        action_needed: 'PayPal capture succeeded for an amount that no longer matches the booking. Manual reconciliation required.',
      })
      await alertTableDepositNeedsAPerson(supabase, {
        bookingId,
        kind: 'captured_amount_problem',
        amountGbp: capturedAmountGbp,
        orderId,
        captureId,
        detail: `the booking owes £${expectedAmount.toFixed(2)}`,
        source,
      })
      return { ok: false, code: 'CAPTURED_AMOUNT_MISMATCH' }
    }

    const { data: updated, error: updateError } = await supabase
      .from('table_bookings')
      .update(buildPayPalDepositCompletedUpdate({ captureId: capture.transactionId, lockedAmountGbp: capturedAmountGbp }))
      .eq('id', bookingId)
      .eq('paypal_deposit_order_id', orderId)
      .is('paypal_deposit_capture_id', null)
      .neq('status', 'cancelled')
      .neq('status', 'no_show')
      .neq('status', 'completed')
      .select('id')
      .maybeSingle()

    if (updateError || !updated) {
      return await captureNotRecorded(supabase, input, {
        captureId,
        amountGbp: capturedAmountGbp,
        detail: updateError?.message || 'the booking was no longer payable at update time',
      })
    }

    void logAuditEvent({
      operation_type: 'payment.captured',
      resource_type: 'table_booking',
      resource_id: bookingId,
      operation_status: 'success',
      additional_info: { orderId, transactionId: captureId, bookingId, lockedAmountGbp: capturedAmountGbp, source },
    })

    await sendTableBookingDepositCapturedNotifications(supabase, {
      tableBookingId: bookingId,
      customerId: booking.customer_id,
      createdVia: input.createdVia,
    })

    return { ok: true, alreadyRecorded: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (moneyTaken) {
      // The money has moved: never tell the guest to try again.
      return await captureNotRecorded(supabase, input, { captureId, amountGbp: capturedAmountGbp, detail: message })
    }
    auditFailure(bookingId, 'payment.capture_failed', { orderId, error: message, bookingId })
    return { ok: false, code: 'CAPTURE_FAILED' }
  }
}

async function captureNotRecorded(
  supabase: SupabaseClient<any, 'public', any>,
  input: CaptureTableDepositInput,
  failure: { captureId: string | null; amountGbp: number | null; detail: string },
): Promise<CaptureTableDepositResult> {
  auditFailure(input.bookingId, 'payment.capture_local_update_failed', {
    orderId: input.orderId,
    transactionId: failure.captureId,
    dbError: failure.detail,
    action_needed: 'Manual reconciliation required: PayPal capture succeeded but the booking was not updated',
  })
  // The guest is told the team has been notified: make that true (BK-114).
  await alertTableDepositNeedsAPerson(supabase, {
    bookingId: input.bookingId,
    kind: 'capture_not_recorded',
    amountGbp: failure.amountGbp,
    orderId: input.orderId,
    captureId: failure.captureId,
    detail: failure.detail,
    source: input.source,
  })
  return { ok: false, code: 'CAPTURED_BOOKING_UPDATE_FAILED' }
}
