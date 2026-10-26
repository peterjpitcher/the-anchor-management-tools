import type { SupabaseClient } from '@supabase/supabase-js'
import { logAuditEvent } from '@/app/actions/audit'
import { logger } from '@/lib/logger'
import { isMessagingFlagOn } from '@/lib/messaging/flags'
import { sendRefundNotification } from '@/lib/refund-notifications'
import { alertTableDepositNeedsAPerson } from '@/lib/table-bookings/deposit-alerts'
import { refundTableBookingDeposit } from '@/lib/table-bookings/refunds'

/**
 * A table deposit PayPal took after the booking had closed (BK-047, customer bookings review of
 * 24 October 2026; owner decision D19).
 *
 * WHAT WAS WRONG. A guest can pay at the moment the booking is cancelled, by staff or by the hold
 * timeout. The PayPal webhook logged the capture and stopped: nothing was recorded on the booking,
 * so even a refund could not find the money. The hourly reconciliation sweep then marked the
 * cancelled booking paid and "confirmed", left the cancelled stamps on it, never checked the table
 * was still free, and sent the guest a "deposit confirmed" message.
 *
 * WHAT HAPPENS NOW, on every path that can see the capture (the webhook, the reconciliation sweep
 * and the browser capture):
 *
 *  1. The capture and amount are recorded on the booking, which keeps its closed status. The write
 *     is guarded on no capture being recorded yet and on the status still being closed, so two
 *     paths racing record it once, and only the one that records it goes on.
 *  2. A cancelled booking is refunded in full automatically: the guest paid for a table that was no
 *     longer theirs. The manager is emailed once so they can offer to rebook.
 *  3. A booking already marked no-show or completed is recorded but not refunded: a person decides,
 *     and is told.
 *  4. The guest gets the standard refund notice only while the messaging flag
 *     table_late_deposit_refund_notice is on: no staff click sends it, so it ships off.
 *
 * Never throws. Nothing here confirms a booking.
 */

const CLOSED_STATUSES = ['cancelled', 'no_show', 'completed'] as const

export function isClosedTableBookingStatus(status: string | null | undefined): boolean {
  return (CLOSED_STATUSES as readonly string[]).includes(status ?? '')
}

export type ClosedBookingDepositInput = {
  bookingId: string
  captureId: string
  orderId: string | null
  /** What PayPal took, in pounds. */
  amountGbp: number
  /** When PayPal took it, when known. */
  capturedAtIso?: string | null
  /** Written on audit rows: 'webhook', 'reconciliation_cron', 'browser_capture'. */
  source: string
}

export type ClosedBookingDepositOutcome =
  /** Recorded on a cancelled booking and refunded in full. */
  | { outcome: 'refunded'; amountGbp: number }
  /** Recorded on a cancelled booking; the refund did not go through and a person has been told. */
  | { outcome: 'refund_failed' }
  /** Recorded on a no-show or completed booking for a person to decide. */
  | { outcome: 'recorded_for_review' }
  /** Another path recorded a capture first, or the booking is no longer closed. */
  | { outcome: 'not_recorded_here' }
  /** The booking could not be updated. Left for the next reconciliation run. */
  | { outcome: 'record_failed' }

export async function settleDepositOnClosedBooking(
  supabase: SupabaseClient<any, 'public', any>,
  input: ClosedBookingDepositInput,
): Promise<ClosedBookingDepositOutcome> {
  try {
    const capturedAt = input.capturedAtIso || new Date().toISOString()
    const { data: recorded, error: recordError } = await supabase
      .from('table_bookings')
      .update({
        // The money, on the booking, so the refund and the booking page can find it. The status is
        // NOT touched: this booking stays closed.
        paypal_deposit_capture_id: input.captureId,
        deposit_amount_locked: input.amountGbp,
        payment_method: 'paypal',
        payment_status: 'completed',
        card_capture_completed_at: capturedAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.bookingId)
      .is('paypal_deposit_capture_id', null)
      .in('status', [...CLOSED_STATUSES])
      .select('id, status, booking_reference, booking_date, customer_id')
      .maybeSingle()

    if (recordError) {
      logger.error('A deposit paid on a closed table booking could not be recorded', {
        error: new Error(recordError.message),
        metadata: { bookingId: input.bookingId, captureId: input.captureId, source: input.source },
      })
      await alertTableDepositNeedsAPerson(supabase, {
        bookingId: input.bookingId,
        kind: 'capture_not_recorded',
        amountGbp: input.amountGbp,
        captureId: input.captureId,
        orderId: input.orderId,
        detail: 'the booking had closed and the payment could not be recorded on it',
        source: input.source,
      })
      return { outcome: 'record_failed' }
    }

    if (!recorded) {
      logger.info('A deposit on a closed table booking was not recorded here: already recorded, or no longer closed', {
        metadata: { bookingId: input.bookingId, captureId: input.captureId, source: input.source },
      })
      return { outcome: 'not_recorded_here' }
    }

    const reference = (recorded.booking_reference as string | null) ?? null

    if (recorded.status !== 'cancelled') {
      await logAuditEvent({
        operation_type: 'payment.captured_after_close',
        resource_type: 'table_booking',
        resource_id: input.bookingId,
        operation_status: 'failure',
        additional_info: {
          source: input.source,
          capture_id: input.captureId,
          order_id: input.orderId,
          amount_gbp: input.amountGbp,
          booking_status: recorded.status,
          action_needed: 'PayPal took this deposit after the booking was marked no-show or completed. Keep it or refund it.',
        },
      }).catch(() => undefined)
      await alertTableDepositNeedsAPerson(supabase, {
        bookingId: input.bookingId,
        kind: 'paid_after_close',
        amountGbp: input.amountGbp,
        captureId: input.captureId,
        orderId: input.orderId,
        detail: `the booking was ${String(recorded.status).replace('_', ' ')}`,
        source: input.source,
      })
      return { outcome: 'recorded_for_review' }
    }

    // Cancelled: all of it goes back. The refund writes its own ledger row, reconciles the booking's
    // payment columns and tells the manager itself when it cannot go through.
    const refund = await refundTableBookingDeposit(input.bookingId, new Date(), { paidAfterCancellation: true })

    await logAuditEvent({
      operation_type: 'payment.captured_after_cancel',
      resource_type: 'table_booking',
      resource_id: input.bookingId,
      operation_status: refund.refunded ? 'success' : 'failure',
      additional_info: {
        source: input.source,
        capture_id: input.captureId,
        order_id: input.orderId,
        amount_gbp: input.amountGbp,
        refunded: refund.refunded,
        refund_id: refund.refunded ? refund.refundId : null,
        refund_reason: refund.refunded ? null : refund.reason,
        ...(refund.refunded
          ? {}
          : { action_needed: 'PayPal took this deposit after the booking was cancelled and it was not refunded. Refund it by hand.' }),
      },
    }).catch(() => undefined)

    if (!refund.refunded) {
      return { outcome: 'refund_failed' }
    }

    const amountGbp = refund.amountPence / 100
    await alertTableDepositNeedsAPerson(supabase, {
      bookingId: input.bookingId,
      kind: 'paid_after_cancel_refunded',
      amountGbp,
      captureId: input.captureId,
      orderId: input.orderId,
      refundId: refund.refundId,
      source: input.source,
    })

    await sendLateDepositRefundNotice(supabase, {
      bookingId: input.bookingId,
      customerId: (recorded.customer_id as string | null) ?? null,
      bookingDate: (recorded.booking_date as string | null) ?? null,
      reference,
      amountGbp,
    })

    return { outcome: 'refunded', amountGbp }
  } catch (error) {
    logger.error('Settling a deposit paid on a closed table booking threw', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: input.bookingId, captureId: input.captureId, source: input.source },
    })
    return { outcome: 'record_failed' }
  }
}

/**
 * The standard refund notice (the words staff refunds already send, with "Your booking is
 * cancelled"), only while table_late_deposit_refund_notice is on. Never throws.
 */
async function sendLateDepositRefundNotice(
  supabase: SupabaseClient<any, 'public', any>,
  input: { bookingId: string; customerId: string | null; bookingDate: string | null; reference: string | null; amountGbp: number },
): Promise<void> {
  try {
    if (!input.customerId) return
    if (!(await isMessagingFlagOn('table_late_deposit_refund_notice'))) return

    const { data: customer } = await supabase
      .from('customers')
      .select('first_name, last_name, email, mobile_e164')
      .eq('id', input.customerId)
      .maybeSingle()
    if (!customer) return

    const customerName = `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim()
    await sendRefundNotification({
      customerId: input.customerId,
      customerName: customerName || 'there',
      email: customer.email ?? null,
      phone: customer.mobile_e164 ?? null,
      amount: input.amountGbp,
      context: {
        subject: 'table_booking',
        bookingDate: input.bookingDate,
        reference: input.reference,
        bookingCancelled: true,
      },
      tableBookingId: input.bookingId,
    })
  } catch (error) {
    logger.error('The refund notice for a deposit paid after cancellation failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: input.bookingId },
    })
  }
}
