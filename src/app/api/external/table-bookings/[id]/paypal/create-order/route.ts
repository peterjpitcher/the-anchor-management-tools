import { NextRequest, NextResponse } from 'next/server';

import { withApiAuth } from '@/lib/api/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createInlinePayPalOrder } from '@/lib/paypal';
import { logAuditEvent } from '@/app/actions/audit';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: bookingId } = await params;

  return withApiAuth(
    async () => {
      const supabase = createAdminClient();

      // Fetch the booking
      const { data: booking, error: fetchError } = await supabase
        .from('table_bookings')
        .select('id, party_size, status, payment_status, paypal_deposit_order_id, deposit_amount')
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

      // Idempotent: return existing order ID without calling PayPal again
      if (booking.paypal_deposit_order_id) {
        return NextResponse.json({ orderId: booking.paypal_deposit_order_id });
      }

      // Calculate amount server-side — never trust client
      const depositAmount = booking.party_size * 10;

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

      // Persist the order ID and deposit amount on the booking
      const { error: persistError } = await supabase
        .from('table_bookings')
        .update({
          paypal_deposit_order_id: paypalOrder.orderId,
          deposit_amount: depositAmount,
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
