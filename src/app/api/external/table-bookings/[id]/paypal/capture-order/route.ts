import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { withApiAuth } from '@/lib/api/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { captureTableDeposit, type CaptureTableDepositResult } from '@/lib/table-bookings/capture-deposit';
import {
  payPalDepositCaptureBlockCode,
  payPalDepositCaptureBlockMessage,
} from '@/lib/table-bookings/paypal-deposit';

export const dynamic = 'force-dynamic';

const CaptureOrderSchema = z.object({
  orderId: z.string().min(1),
});

/**
 * The website's answer for each way a capture can stop. The steps themselves live in
 * captureTableDeposit, shared with the guest payment page (BK-129).
 */
function refusal(result: Exclude<CaptureTableDepositResult, { ok: true }>): NextResponse {
  switch (result.code) {
    case 'BOOKING_NOT_FOUND':
      return NextResponse.json({ success: false, error: 'Booking not found', code: 'BOOKING_NOT_FOUND' }, { status: 404 });
    case 'ORDER_MISMATCH':
      return NextResponse.json({ success: false, error: 'Order ID mismatch', code: 'ORDER_MISMATCH' }, { status: 400 });
    case 'NOT_PAYABLE':
      return NextResponse.json(
        { success: false, error: payPalDepositCaptureBlockMessage(result.blockReason), code: payPalDepositCaptureBlockCode(result.blockReason) },
        { status: result.blockReason === 'hold_expired' ? 410 : 409 },
      );
    case 'PAYPAL_ORDER_LOOKUP_FAILED':
      return NextResponse.json(
        { success: false, error: 'Failed to verify PayPal order amount. Please try again.', code: 'PAYPAL_ORDER_LOOKUP_FAILED' },
        { status: 502 },
      );
    case 'AMOUNT_MISMATCH':
      return NextResponse.json(
        { success: false, error: 'Payment amount no longer matches this booking. Please refresh and try again.', code: 'AMOUNT_MISMATCH' },
        { status: 409 },
      );
    case 'CAPTURE_FAILED':
      return NextResponse.json(
        { success: false, error: 'Failed to capture PayPal payment. Please try again.', code: 'CAPTURE_FAILED' },
        { status: 502 },
      );
    case 'CAPTURE_PENDING':
      return NextResponse.json(
        { success: false, error: 'PayPal is still processing this payment. Please contact support; do not retry.', code: 'CAPTURE_PENDING' },
        { status: 502 },
      );
    case 'CAPTURE_DECLINED':
      return NextResponse.json(
        { success: false, error: 'PayPal did not take this payment. Please contact support.', code: 'CAPTURE_DECLINED' },
        { status: 502 },
      );
    case 'CAPTURE_BOOKING_MISMATCH':
      return NextResponse.json(
        { success: false, error: 'Payment could not be matched to this booking. Please contact support; do not retry.', code: 'CAPTURE_BOOKING_MISMATCH' },
        { status: 502 },
      );
    case 'CAPTURED_AMOUNT_UNVERIFIED':
      return NextResponse.json(
        { success: false, error: 'Payment captured but amount could not be verified. Please contact support; do not retry.', code: 'CAPTURED_AMOUNT_UNVERIFIED' },
        { status: 502 },
      );
    case 'CAPTURED_AMOUNT_MISMATCH':
      return NextResponse.json(
        { success: false, error: 'Payment captured but amount did not match the booking. Please contact support; do not retry.', code: 'CAPTURED_AMOUNT_MISMATCH' },
        { status: 502 },
      );
    case 'CAPTURED_BOOKING_UPDATE_FAILED':
    default:
      return NextResponse.json(
        { success: false, error: 'Payment captured but booking update failed. Our team has been notified.', code: 'CAPTURED_BOOKING_UPDATE_FAILED' },
        { status: 502 },
      );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: bookingId } = await params;

  return withApiAuth(
    async () => {
      let orderId: string;
      try {
        const body = await request.json();
        const parsed = CaptureOrderSchema.parse(body);
        orderId = parsed.orderId;
      } catch {
        return NextResponse.json({ success: false, error: 'Invalid request body. orderId is required.', code: 'VALIDATION_ERROR' }, { status: 400 });
      }

      const result = await captureTableDeposit(createAdminClient(), {
        bookingId,
        orderId,
        source: 'website capture',
        createdVia: 'api',
      });

      return result.ok ? NextResponse.json({ success: true }) : refusal(result);
    },
    ['payments:capture'],
    request,
  );
}
