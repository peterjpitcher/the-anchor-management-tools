import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { withApiAuth } from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  captureEventPayPalOrderByBookingId,
  sendEventPaymentConfirmationSms,
  sendEventPaymentManualReviewSms,
} from '@/lib/events/event-payments'
import { sendEventPaymentConfirmationEmail } from '@/lib/email/event-ticket-emails'
import { logAuditEvent } from '@/app/actions/audit'

export const dynamic = 'force-dynamic'

const CaptureSchema = z.object({
  orderId: z.string().min(1),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id: bookingId } = await params

  return withApiAuth(async () => {
    const parsed = CaptureSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'orderId is required' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const result = await captureEventPayPalOrderByBookingId(supabase, {
      bookingId,
      orderId: parsed.data.orderId,
    })

    if (result.state === 'confirmed' || result.state === 'already_confirmed') {
      const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
      if (result.state === 'confirmed') {
        await sendEventPaymentConfirmationSms(supabase, {
          bookingId,
          eventName: 'your event',
          seats: 1,
          appBaseUrl,
        })
      }
      await sendEventPaymentConfirmationEmail(supabase, {
        bookingId,
        amount: result.amount,
        currency: result.currency,
        appBaseUrl,
      })

      void logAuditEvent({
        operation_type: 'event_payment.paypal_capture_confirmed',
        resource_type: 'event_booking',
        resource_id: bookingId,
        operation_status: 'success',
        additional_info: {
          order_id: parsed.data.orderId,
          amount: result.amount,
          currency: result.currency,
          payment_id: result.paymentId,
          source: 'external',
        },
      })

      return NextResponse.json({
        success: true,
        state: 'confirmed',
        booking_id: bookingId,
        amount: result.amount,
        currency: result.currency,
      })
    }

    if (result.state === 'manual_review') {
      await sendEventPaymentManualReviewSms(supabase, { bookingId })

      void logAuditEvent({
        operation_type: 'event_payment.paypal_capture_manual_review',
        resource_type: 'event_booking',
        resource_id: bookingId,
        operation_status: 'failure',
        additional_info: {
          order_id: parsed.data.orderId,
          reason: result.reason,
          payment_id: result.paymentId,
          source: 'external',
        },
      })

      return NextResponse.json(
        {
          success: false,
          state: 'manual_review',
          booking_id: bookingId,
          error: 'Payment received but staff need to confirm the booking.',
        },
        { status: 202 }
      )
    }

    return NextResponse.json(
      { success: false, error: result.reason },
      { status: result.reason === 'hold_expired' ? 410 : 409 }
    )
  })
}
