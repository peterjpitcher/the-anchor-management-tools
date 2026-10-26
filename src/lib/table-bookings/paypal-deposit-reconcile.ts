import type { SupabaseClient } from '@supabase/supabase-js'
import { getPayPalOrder, isPayPalOrderNotFoundError } from '@/lib/paypal'
import { logger } from '@/lib/logger'
import { logAuditEvent } from '@/app/actions/audit'
import {
  buildPayPalDepositCompletedUpdate,
  parsePayPalAmountGbp,
  payPalAmountsMatch,
  sendTableBookingDepositCapturedNotifications,
} from '@/lib/table-bookings/paypal-deposit'
import { getCanonicalDeposit } from '@/lib/table-bookings/deposit'
import { alertMoneyNeedsAPerson, formatPounds } from '@/lib/money-alerts'

/**
 * Records a table deposit PayPal has already taken but this app never recorded.
 *
 * Shared by the hourly reconciliation sweep (api/cron/table-booking-paypal-reconciliation) and the
 * deposit hold timeout (api/cron/table-booking-deposit-timeout), which asks it about every lapsed
 * hold with a PayPal order before cancelling (BK-113): a guest who paid must never be cancelled
 * and told their table has gone.
 *
 * SAFETY: it never captures. It reads PayPal and records a capture PayPal has already made, so the
 * worst case is that it does nothing. The write is guarded on `paypal_deposit_capture_id IS NULL`,
 * so racing the browser or the webhook records nothing twice, and the amount is read from PayPal
 * rather than recomputed. The order must name this booking, be in pounds, and match what the
 * booking owes; anything else is left for a person, who is told once (BK-114).
 */

export type TableDepositOrderBooking = {
  id: string
  booking_reference: string | null
  customer_id: string | null
  status: string | null
  payment_status: string | null
  paypal_deposit_order_id: string | null
  paypal_deposit_capture_id: string | null
  // Read only to work out what this booking actually owes, so a capture can be checked against it
  // before the figure is locked in.
  party_size: number | null
  deposit_amount: number | null
  deposit_amount_locked: number | null
  deposit_waived: boolean | null
  booking_type: string | null
}

/** The columns reconcileTableDepositOrder reads, for callers that select a booking for it. */
export const TABLE_DEPOSIT_ORDER_BOOKING_COLUMNS =
  'id, booking_reference, customer_id, status, payment_status, paypal_deposit_order_id, paypal_deposit_capture_id, party_size, deposit_amount, deposit_amount_locked, deposit_waived, booking_type'

export type TableDepositOrderOutcome =
  /** No completed capture on the order, or an order PayPal has never heard of: nothing was paid. */
  | { outcome: 'not_paid' }
  /** PayPal could not be read. Nothing is known either way. */
  | { outcome: 'lookup_failed' }
  /** PayPal took money that cannot be recorded automatically. A person has been told. */
  | { outcome: 'needs_attention' }
  /** Another path recorded the capture first. */
  | { outcome: 'already_recorded' }
  /** The capture is now recorded and the booking confirmed. */
  | { outcome: 'recorded'; amountGbp: number; wasCancelled: boolean }

export async function reconcileTableDepositOrder(
  supabase: SupabaseClient<any, 'public', any>,
  booking: TableDepositOrderBooking,
  options: {
    /** Written on audit rows and passed to the guest notifications, e.g. 'reconciliation_cron'. */
    source: string
  },
): Promise<TableDepositOrderOutcome> {
  const orderId = booking.paypal_deposit_order_id
  if (!orderId) return { outcome: 'not_paid' }

  /*
   * A booking that needs a person: tell the manager once (BK-114), and write its audit row only
   * the first time. Every case below except a recorded capture leaves the booking a candidate for
   * the next run, which used to add a fresh audit row for the same booking every hour and tell
   * nobody.
   */
  async function flag(
    alert: { kind: string; title: string; summary: string; context: Record<string, unknown> },
    audit: Parameters<typeof logAuditEvent>[0],
  ): Promise<TableDepositOrderOutcome> {
    const outcome = await alertMoneyNeedsAPerson(supabase, {
      domain: 'table_bookings',
      bookingId: booking.id,
      kind: alert.kind,
      title: alert.title,
      summary: alert.summary,
      context: { Booking: booking.booking_reference ?? booking.id, ...alert.context },
    })
    if (!outcome.duplicate) {
      await logAuditEvent(audit).catch(() => undefined)
    }
    return { outcome: 'needs_attention' }
  }

  let order: any
  try {
    order = await getPayPalOrder(orderId)
  } catch (err) {
    // An order PayPal has never heard of is an abandoned checkout, which is the normal case and
    // not worth an alert.
    if (isPayPalOrderNotFoundError(err)) return { outcome: 'not_paid' }
    logger.warn('Table booking PayPal reconciliation could not read an order', {
      error: err instanceof Error ? err : new Error(String(err)),
      metadata: { bookingId: booking.id, orderId, source: options.source },
    })
    return { outcome: 'lookup_failed' }
  }

  const capture = order?.purchase_units?.[0]?.payments?.captures?.find(
    (c: { status?: string }) => c?.status === 'COMPLETED',
  )
  if (!capture?.id) return { outcome: 'not_paid' }

  /*
   * The order must belong to THIS booking before anything from it is written. custom_id here is
   * the bare booking id, with no prefix. Without this check a mis-stored order id would quietly
   * record another booking's payment against this one.
   */
  const orderCustomId = order?.purchase_units?.[0]?.custom_id
  if (typeof orderCustomId !== 'string' || orderCustomId !== booking.id) {
    return flag({
      kind: 'capture_booking_mismatch',
      title: 'A PayPal deposit names a different booking',
      summary: 'PayPal shows a completed deposit on the order stored for this table booking, but the order names a different booking, so nothing was recorded. Check the order in PayPal.',
      context: { 'PayPal order': orderId, 'PayPal capture': capture.id },
    }, {
      operation_type: 'payment.capture_booking_mismatch',
      resource_type: 'table_booking',
      resource_id: booking.id,
      operation_status: 'failure',
      additional_info: {
        source: options.source,
        order_id: orderId,
        capture_id: capture.id,
        actual_custom_id: orderCustomId ?? null,
        action_needed: 'PayPal order custom_id does not match this booking. Manual investigation required.',
      },
    })
  }

  // Everything downstream assumes pounds: deposit_amount_locked has no currency column, so a
  // non-GBP capture would be stored as though it were sterling.
  const captureCurrency = typeof capture?.amount?.currency_code === 'string'
    ? capture.amount.currency_code.toUpperCase()
    : null
  if (captureCurrency !== 'GBP') {
    return flag({
      kind: 'capture_currency_mismatch',
      title: 'A PayPal deposit was taken in the wrong currency',
      summary: `PayPal took this table deposit in ${captureCurrency ?? 'an unknown currency'}, not pounds, so it was not recorded on the booking. Refund it, or record it by hand.`,
      context: { 'PayPal order': orderId, 'PayPal capture': capture.id },
    }, {
      operation_type: 'payment.capture_currency_mismatch',
      resource_type: 'table_booking',
      resource_id: booking.id,
      operation_status: 'failure',
      additional_info: {
        source: options.source,
        order_id: orderId,
        capture_id: capture.id,
        currency: captureCurrency,
        action_needed: 'PayPal captured in a currency other than GBP, so it was not recorded.',
      },
    })
  }

  // PayPal took the money and we never recorded it.
  const lockedAmountGbp = parsePayPalAmountGbp(capture?.amount?.value ?? null)
  if (lockedAmountGbp === null) {
    return flag({
      kind: 'capture_amount_unreadable',
      title: 'A PayPal deposit could not be read',
      summary: 'PayPal shows a completed deposit for this table booking but its amount could not be read, so it was not recorded. Check it in PayPal and record it by hand.',
      context: { 'PayPal order': orderId, 'PayPal capture': capture.id },
    }, {
      operation_type: 'payment.capture_amount_unparseable',
      resource_type: 'table_booking',
      resource_id: booking.id,
      operation_status: 'failure',
      additional_info: {
        source: options.source,
        order_id: orderId,
        capture_id: capture.id,
        raw_amount: capture?.amount?.value ?? null,
        action_needed: 'PayPal shows a completed capture but the amount was unreadable, so it was not recorded',
      },
    })
  }

  /*
   * The captured figure is about to be written into deposit_amount_locked, which is what the venue
   * then treats as owed and what any refund is measured against. It must agree with what this
   * booking actually owes: a stale order created before the party size changed would otherwise
   * lock the old, wrong amount. The browser capture path refuses this case, so the sweeps backing
   * it up refuse it too rather than being the more permissive.
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
    return flag({
      kind: 'capture_amount_mismatch',
      title: `A PayPal deposit of ${formatPounds(lockedAmountGbp)} does not match its booking`,
      summary: `PayPal took ${formatPounds(lockedAmountGbp)} for this table booking, which owes ${formatPounds(expectedAmount)}, so it was not recorded. Refund the difference, or correct the booking and record it by hand.`,
      context: { 'PayPal order': orderId, 'PayPal capture': capture.id, Captured: formatPounds(lockedAmountGbp), Owed: formatPounds(expectedAmount) },
    }, {
      operation_type: 'payment.capture_amount_mismatch',
      resource_type: 'table_booking',
      resource_id: booking.id,
      operation_status: 'failure',
      additional_info: {
        source: options.source,
        order_id: orderId,
        capture_id: capture.id,
        captured_amount: lockedAmountGbp,
        expected_amount: expectedAmount,
        action_needed: 'PayPal captured an amount that does not match this booking. Manual reconciliation required.',
      },
    })
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
      metadata: { bookingId: booking.id, orderId, captureId: capture.id, source: options.source },
    })
    return flag({
      kind: 'capture_not_recorded',
      title: `A PayPal deposit of ${formatPounds(lockedAmountGbp)} could not be recorded`,
      summary: `PayPal took ${formatPounds(lockedAmountGbp)} for this table booking but the booking could not be updated. It is retried every hour; record it by hand if this repeats.`,
      context: { 'PayPal order': orderId, 'PayPal capture': capture.id },
    }, {
      operation_type: 'payment.capture_local_update_failed',
      resource_type: 'table_booking',
      resource_id: booking.id,
      operation_status: 'failure',
      additional_info: {
        source: options.source,
        order_id: orderId,
        capture_id: capture.id,
        db_error: updateError.message,
        action_needed: 'PayPal took this deposit but it could not be recorded on the booking.',
      },
    })
  }

  if (!updated) return { outcome: 'already_recorded' }

  /*
   * A booking already cancelled by the deposit timeout is now marked paid and confirmed by the
   * update above, which is the right end state: the guest did pay. Tell a person, so they check
   * the table is still actually free for them (BK-114).
   */
  const wasCancelled = booking.status === 'cancelled'
  if (wasCancelled) {
    await alertMoneyNeedsAPerson(supabase, {
      domain: 'table_bookings',
      bookingId: booking.id,
      kind: 'paid_after_cancel',
      title: `A guest paid ${formatPounds(lockedAmountGbp)} for a cancelled table booking`,
      summary: `PayPal took ${formatPounds(lockedAmountGbp)} for this table booking after it had been cancelled for non-payment. It is now recorded as paid and confirmed. Check the table is still free for them, or refund the deposit.`,
      context: { Booking: booking.booking_reference ?? booking.id, 'PayPal order': orderId, 'PayPal capture': capture.id },
    })
  }

  await logAuditEvent({
    operation_type: 'payment.captured',
    resource_type: 'table_booking',
    resource_id: booking.id,
    operation_status: 'success',
    additional_info: {
      source: options.source,
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
    createdVia: options.source,
  }).catch((err) => {
    // Error, not warn: production drops warn, and this guest has paid without being told.
    logger.error('Reconciled a table booking deposit but the confirmation failed to send', {
      error: err instanceof Error ? err : new Error(String(err)),
      metadata: { bookingId: booking.id, source: options.source },
    })
  })

  return { outcome: 'recorded', amountGbp: lockedAmountGbp, wasCancelled }
}
