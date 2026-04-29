import { NextRequest, NextResponse } from 'next/server';

import { withApiAuth } from '@/lib/api/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createInlinePayPalOrder, getPayPalOrder } from '@/lib/paypal';
import { logAuditEvent } from '@/app/actions/audit';
import { logger } from '@/lib/logger';
import { getCanonicalDeposit } from '@/lib/table-bookings/deposit';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: bookingId } = await params;

  return withApiAuth(
    async () => {
      const supabase = createAdminClient();

      // Fetch the booking. We pull `deposit_amount_locked`, `deposit_waived`,
      // and `booking_type` so the canonical-deposit reader can honour locked
      // amounts and waivers. Spec §7.3, §8.3.
      const { data: booking, error: fetchError } = await supabase
        .from('table_bookings')
        .select('id, party_size, status, payment_status, paypal_deposit_order_id, deposit_amount, deposit_amount_locked, deposit_waived, booking_type')
        .eq('id', bookingId)
        .single();

      if (fetchError || !booking) {
        if (fetchError) {
          logger.error('create-order: booking fetch failed', {
            error: new Error(fetchError.message),
            metadata: { bookingId, code: fetchError.code, details: fetchError.details },
          });
        }
        return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
      }

      // If already paid (payment completed), return 409
      if (booking.payment_status === 'completed') {
        return NextResponse.json(
          { error: 'Deposit has already been paid for this booking' },
          { status: 409 },
        );
      }

      // Only proceed if the booking is awaiting payment
      const awaitingDeposit =
        booking.status === 'pending_payment' || booking.payment_status === 'pending';

      if (!awaitingDeposit) {
        return NextResponse.json(
          { error: 'This booking does not require a deposit payment' },
          { status: 400 },
        );
      }

      // Read canonical deposit (locked > stored > computed). This stops
      // blind party_size * 10 recompute and honours
      // `deposit_amount_locked` for paid/refunded bookings. Spec §3 step 9,
      // §7.3, §7.4, §8.3.
      const depositAmount = getCanonicalDeposit(
        {
          party_size: booking.party_size,
          deposit_amount: booking.deposit_amount ?? null,
          deposit_amount_locked: booking.deposit_amount_locked ?? null,
          status: booking.status ?? null,
          payment_status: booking.payment_status ?? null,
          deposit_waived: booking.deposit_waived ?? null,
        },
        booking.party_size,
      );
      if (!Number.isFinite(depositAmount) || depositAmount <= 0) {
        return NextResponse.json(
          { error: 'No deposit required for this booking.' },
          { status: 400 },
        );
      }

      // Idempotent reuse — but only when the cached PayPal order's amount
      // matches the current canonical deposit. If the canonical amount has
      // changed since the order was created (e.g. party_size resize, locked
      // amount written, waiver flipped), the cached order is stale and we
      // must invalidate it to avoid charging the wrong amount.
      // Spec §7.3, §7.4, §8.3 — defects ARCH-002 / SEC-002 / WF-002 / AB-004.
      if (booking.paypal_deposit_order_id) {
        let cachedAmount: number | null = null;
        try {
          const remote = (await getPayPalOrder(booking.paypal_deposit_order_id)) as
            | { purchase_units?: Array<{ amount?: { value?: string; currency_code?: string } }> }
            | null;
          const rawValue = remote?.purchase_units?.[0]?.amount?.value;
          const parsed = typeof rawValue === 'string' ? Number.parseFloat(rawValue) : NaN;
          cachedAmount = Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
        } catch (err) {
          logger.error('create-order: failed to fetch cached PayPal order; invalidating', {
            error: err instanceof Error ? err : new Error(String(err)),
            metadata: { bookingId, cachedOrderId: booking.paypal_deposit_order_id },
          });
          cachedAmount = null;
        }

        if (cachedAmount !== null && Math.abs(cachedAmount - depositAmount) < 0.01) {
          // Cached order still matches canonical — safe to reuse.
          return NextResponse.json({ orderId: booking.paypal_deposit_order_id });
        }

        // Stale or unverifiable cached order. Clear it before creating a
        // fresh one so the invariant "paypal_deposit_order_id implies
        // amount-current order" is maintained.
        const { error: clearError } = await supabase
          .from('table_bookings')
          .update({ paypal_deposit_order_id: null })
          .eq('id', bookingId);
        if (clearError) {
          logger.error('create-order: failed to clear stale paypal_deposit_order_id', {
            error: new Error(clearError.message),
            metadata: { bookingId, staleOrderId: booking.paypal_deposit_order_id },
          });
          return NextResponse.json(
            { error: 'Failed to refresh PayPal order. Please try again.' },
            { status: 502 },
          );
        }
        void logAuditEvent({
          operation_type: 'payment.order_invalidated',
          resource_type: 'table_booking',
          resource_id: bookingId,
          operation_status: 'success',
          additional_info: {
            staleOrderId: booking.paypal_deposit_order_id,
            staleAmount: cachedAmount,
            canonicalAmount: depositAmount,
            reason: cachedAmount === null
              ? 'paypal_get_order_failed'
              : 'amount_drift',
          },
        });
      }

      let paypalOrder: { orderId: string };
      try {
        paypalOrder = await createInlinePayPalOrder({
          customId: bookingId,
          reference: `tb-deposit-${bookingId}`,
          description: `Table booking deposit – ${booking.party_size} guests`,
          amount: depositAmount,
          currency: 'GBP',
          requestId: `tb-deposit-${bookingId}`,
        });
      } catch (err) {
        return NextResponse.json(
          { error: 'Failed to create PayPal order. Please try again.' },
          { status: 502 },
        );
      }

      // Persist the order ID. Deliberately NOT writing deposit_amount here —
      // the canonical reader is the source of truth and `deposit_amount_locked`
      // is set by the capture path on successful payment. Spec §7.3, §7.4, §8.3.
      const { error: persistError } = await supabase
        .from('table_bookings')
        .update({
          paypal_deposit_order_id: paypalOrder.orderId,
        })
        .eq('id', bookingId);

      if (persistError) {
        void logAuditEvent({
          operation_type: 'payment.order_persist_failed',
          resource_type: 'table_booking',
          resource_id: bookingId,
          operation_status: 'failure',
          additional_info: {
            orderId: paypalOrder.orderId,
            amount: depositAmount,
            dbError: persistError.message,
            action_needed: 'PayPal order created but order ID not persisted — manual reconciliation may be needed',
          },
        });
        return NextResponse.json(
          { error: 'Order created but could not be saved. Please try again.' },
          { status: 502 },
        );
      }

      // Audit log
      void logAuditEvent({
        operation_type: 'payment.order_created',
        resource_type: 'table_booking',
        resource_id: bookingId,
        operation_status: 'success',
        additional_info: {
          orderId: paypalOrder.orderId,
          amount: depositAmount,
          currency: 'GBP',
          bookingId,
          partySize: booking.party_size,
        },
      });

      return NextResponse.json({ orderId: paypalOrder.orderId });
    },
    ['read:events'],
    request,
  );
}
