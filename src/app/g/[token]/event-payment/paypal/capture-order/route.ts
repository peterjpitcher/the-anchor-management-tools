import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  captureEventPayPalOrderByRawToken,
  sendEventPaymentConfirmationSms,
  sendEventPaymentManualReviewSms,
} from '@/lib/events/event-payments'
import {
  sendEventPaymentConfirmationEmail,
  sendEventPaymentManualReviewEmail,
} from '@/lib/email/event-ticket-emails'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'

type RouteContext = {
  params: Promise<{ token: string }>
}

const CaptureSchema = z.object({
  orderId: z.string().min(1),
})

export async function POST(request: NextRequest, context: RouteContext) {
  const { token } = await context.params
  const parsed = CaptureSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'orderId is required' }, { status: 400 })
  }

  const throttle = await checkGuestTokenThrottle({
    request,
    rawToken: token,
    scope: 'guest_event_payment_capture_order',
    maxAttempts: 8
  })

  if (!throttle.allowed) {
    return NextResponse.json({ success: false, error: 'rate_limited' }, { status: 429 })
  }

  const supabase = createAdminClient()
  const result = await captureEventPayPalOrderByRawToken(supabase, {
    rawToken: token,
    orderId: parsed.data.orderId,
  })

  if (result.state === 'confirmed' || result.state === 'already_confirmed') {
    const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
    if (result.state === 'confirmed') {
      await sendEventPaymentConfirmationSms(supabase, {
        bookingId: result.bookingId,
        eventName: 'your event',
        seats: 1,
        appBaseUrl,
      })
    }
    await sendEventPaymentConfirmationEmail(supabase, {
      bookingId: result.bookingId,
      amount: result.amount,
      currency: result.currency,
      appBaseUrl,
    })

    return NextResponse.json({
      success: true,
      state: 'confirmed',
      booking_id: result.bookingId,
      amount: result.amount,
      currency: result.currency,
    })
  }

  if (result.state === 'manual_review') {
    await sendEventPaymentManualReviewSms(supabase, { bookingId: result.bookingId })
    await sendEventPaymentManualReviewEmail(supabase, {
      bookingId: result.bookingId,
      amount: result.amount,
      currency: result.currency,
    })
    return NextResponse.json(
      {
        success: false,
        state: 'manual_review',
        booking_id: result.bookingId,
        error: 'Payment received but staff need to confirm the booking.',
      },
      { status: 202 }
    )
  }

  return NextResponse.json(
    { success: false, error: result.reason },
    { status: result.reason === 'hold_expired' ? 410 : 409 }
  )
}
