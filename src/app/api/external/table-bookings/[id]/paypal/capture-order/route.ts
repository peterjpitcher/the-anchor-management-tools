import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { withApiAuth } from '@/lib/api/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { capturePayPalPayment, getPayPalOrder } from '@/lib/paypal';
import { logAuditEvent } from '@/app/actions/audit';
import { logger } from '@/lib/logger';
import { getCanonicalDeposit } from '@/lib/table-bookings/deposit';
import {
  buildPayPalDepositCompletedUpdate,
  extractPayPalOrderAmountGbp,
  getPayPalDepositCaptureBlockReason,
  parsePayPalAmountGbp,
  payPalAmountsMatch,
  payPalDepositCaptureBlockMessage,
  sendTableBookingDepositCapturedNotifications,
} from '@/lib/table-bookings/paypal-deposit';

export const dynamic = 'force-dynamic';

const CaptureOrderSchema = z.object({
  orderId: z.string().min(1),
});

/**
 * Parse the captured GBP amount from a PayPal v2 capture response.
 * Returns the GBP value as a finite number, or null when missing/unparseable.
 *
 * Caller MUST fail closed on null — silently falling back to
 * `booking.deposit_amount` would let stale amounts get locked. Spec §6, §7.4, §8.3.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: bookingId } = await params;

  return withApiAuth(
    async () => {
      // Parse and validate request body
      let orderId: string;
      try {
        const body = await request.json();
        const parsed = CaptureOrderSchema.parse(body);
        orderId = parsed.orderId;
      } catch {
        return NextResponse.json({ error: 'Invalid request body. orderId is required.' }, { status: 400 });
      }

      const supabase = createAdminClient();

      // Fetch the booking
      const { data: booking, error: fetchError } = await supabase
        .from('table_bookings')
        .select('id, status, payment_status, hold_expires_at, paypal_deposit_order_id, paypal_deposit_capture_id, customer_id, party_size, start_datetime, booking_reference, booking_type, source, deposit_amount, deposit_amount_locked, deposit_waived')
        .eq('id', bookingId)
        .single();

      if (fetchError || !booking) {
        if (fetchError) {
          logger.error('capture-order: booking fetch failed', {
            error: new Error(fetchError.message),
            metadata: { bookingId, code: fetchError.code, details: fetchError.details },
          });
        }
        return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
      }

      // Idempotent: if already captured, return success without reprocessing
      if (booking.payment_status === 'completed' && booking.paypal_deposit_capture_id !== null) {
        return NextResponse.json({ success: true });
      }

      // Validate orderId matches what we stored
      if (booking.paypal_deposit_order_id !== orderId) {
        return NextResponse.json({ error: 'Order ID mismatch' }, { status: 400 });
      }

      const blockReason = getPayPalDepositCaptureBlockReason(booking);
      if (blockReason) {
        return NextResponse.json(
          { error: payPalDepositCaptureBlockMessage(blockReason) },
          { status: blockReason === 'hold_expired' ? 410 : 409 },
        );
      }

      const expectedAmount = Number(
        getCanonicalDeposit({
          party_size: Math.max(1, Number(booking.party_size || 1)),
          deposit_amount: booking.deposit_amount ?? null,
          deposit_amount_locked: booking.deposit_amount_locked ?? null,
          status: booking.status ?? null,
          payment_status: booking.payment_status ?? null,
          deposit_waived: booking.deposit_waived ?? null,
        }).toFixed(2),
      );

      let orderAmount: number | null = null;
      try {
        orderAmount = extractPayPalOrderAmountGbp(await getPayPalOrder(orderId));
      } catch (err) {
        logger.error('capture-order: failed to verify PayPal order amount before capture', {
          error: err instanceof Error ? err : new Error(String(err)),
          metadata: { bookingId, orderId },
        });
        return NextResponse.json(
          { error: 'Failed to verify PayPal order amount. Please try again.' },
          { status: 502 },
        );
      }

      if (orderAmount === null || !payPalAmountsMatch(orderAmount, expectedAmount)) {
        void logAuditEvent({
          operation_type: 'payment.capture_amount_mismatch',
          resource_type: 'table_booking',
          resource_id: bookingId,
          operation_status: 'failure',
          additional_info: {
            orderId,
            orderAmount,
            expectedAmount,
            action_needed: 'PayPal order amount did not match current booking deposit before capture',
          },
        });
        return NextResponse.json(
          { error: 'Payment amount no longer matches this booking. Please refresh and try again.' },
          { status: 409 },
        );
      }

      // Capture the PayPal payment
      let captureResult: { transactionId: string; status: string; payerId?: string; amount?: string };
      try {
        captureResult = await capturePayPalPayment(orderId);
      } catch (err) {
        void logAuditEvent({
          operation_type: 'payment.capture_failed',
          resource_type: 'table_booking',
          resource_id: bookingId,
          operation_status: 'failure',
          additional_info: {
            orderId,
            error: err instanceof Error ? err.message : 'Unknown error',
          },
        });
        return NextResponse.json(
          { error: 'Failed to capture PayPal payment. Please try again.' },
          { status: 502 },
        );
      }

      const transactionId = captureResult.transactionId;

      // Lock the actually-captured GBP amount on the booking — authoritative
      // source for what the customer was charged. Fail closed if the capture
      // response is missing/malformed: do NOT update payment_status, log a
      // high-severity error, and return 502 so the customer sees an explicit
      // "we couldn't confirm your payment" state. We deliberately do NOT
      // fall back to booking.deposit_amount — that's how stale amounts get
      // locked. Spec §6, §7.4, §8.3.
      const lockedAmountGbp = parsePayPalAmountGbp(captureResult?.amount);
      if (lockedAmountGbp === null) {
        logger.error('paypal-capture: capture succeeded but no parseable GBP amount in response', {
          metadata: {
            bookingId,
            orderId,
            transactionId,
            // Capture the raw amount value so on-call can investigate.
            rawAmount: captureResult?.amount ?? null,
            captureStatus: captureResult?.status ?? null,
          },
        });
        void logAuditEvent({
          operation_type: 'payment.capture_amount_unparseable',
          resource_type: 'table_booking',
          resource_id: bookingId,
          operation_status: 'failure',
          additional_info: {
            orderId,
            transactionId,
            rawAmount: String(captureResult?.amount ?? 'null'),
            action_needed:
              'PayPal capture succeeded but the captured amount was missing or unparseable — manual reconciliation required before unlocking the booking',
          },
        });
        return NextResponse.json(
          {
            error: 'Payment captured but amount could not be verified. Please contact support; do not retry.',
          },
          { status: 502 },
        );
      }

      if (!payPalAmountsMatch(lockedAmountGbp, expectedAmount)) {
        void logAuditEvent({
          operation_type: 'payment.capture_amount_mismatch',
          resource_type: 'table_booking',
          resource_id: bookingId,
          operation_status: 'failure',
          additional_info: {
            orderId,
            transactionId,
            capturedAmount: lockedAmountGbp,
            expectedAmount,
            action_needed:
              'PayPal capture succeeded for an amount that no longer matches the booking — manual reconciliation required',
          },
        });
        return NextResponse.json(
          { error: 'Payment captured but amount did not match the booking. Please contact support; do not retry.' },
          { status: 502 },
        );
      }

      // Update the booking atomically — including deposit_amount_locked so
      // any future recompute (party-size change, blind compute, etc.) honours
      // the actually-captured amount.
      const { data: updatedBooking, error: updateError } = await supabase
        .from('table_bookings')
        .update(buildPayPalDepositCompletedUpdate({
          captureId: transactionId,
          lockedAmountGbp,
        }))
        .eq('id', bookingId)
        .eq('paypal_deposit_order_id', orderId)
        .is('paypal_deposit_capture_id', null)
        .neq('status', 'cancelled')
        .neq('status', 'no_show')
        .neq('status', 'completed')
        .select('id')
        .maybeSingle();

      if (updateError || !updatedBooking) {
        // PayPal captured but DB update failed — log for manual reconciliation
        void logAuditEvent({
          operation_type: 'payment.capture_local_update_failed',
          resource_type: 'table_booking',
          resource_id: bookingId,
          operation_status: 'failure',
          additional_info: {
            orderId,
            transactionId,
            dbError: updateError?.message || 'Booking was no longer payable at update time',
            action_needed: 'Manual reconciliation required — PayPal capture succeeded but DB update failed',
          },
        });
        return NextResponse.json(
          { error: 'Payment captured but booking update failed. Our team has been notified.' },
          { status: 502 },
        );
      }

      // Audit log success
      void logAuditEvent({
        operation_type: 'payment.captured',
        resource_type: 'table_booking',
        resource_id: bookingId,
        operation_status: 'success',
        additional_info: {
          orderId,
          transactionId,
          bookingId,
          lockedAmountGbp,
        },
      });

      await sendTableBookingDepositCapturedNotifications(supabase, {
        tableBookingId: bookingId,
        customerId: booking.customer_id,
        createdVia: 'api',
      });

      return NextResponse.json({ success: true });
    },
    ['read:events'],
    request,
  );
}
