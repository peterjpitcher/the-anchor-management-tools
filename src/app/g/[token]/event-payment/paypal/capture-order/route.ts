import { NextRequest, NextResponse } from 'next/server'
import { getAppUrl } from '@/lib/env'
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
import { alertEventPaymentNeedsAPerson } from '@/lib/events/payment-alerts'
import { eventPaymentRefusal } from '@/lib/events/event-payment-reasons'
import { logger } from '@/lib/logger'

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
    // The guest has approved a payment by now, so they are asked to ring rather than pay again.
    return NextResponse.json(eventPaymentRefusal('rate_limited', 'capture'), { status: 429 })
  }

  const supabase = createAdminClient()
  let result: Awaited<ReturnType<typeof captureEventPayPalOrderByRawToken>>
  try {
    result = await captureEventPayPalOrderByRawToken(supabase, {
      rawToken: token,
      orderId: parsed.data.orderId,
    })
  } catch (error) {
    // PayPal may already have the money (BK-029): never a crash, never "try again".
    logger.error('Guest event payment link capture failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { orderId: parsed.data.orderId },
    })
    return NextResponse.json(eventPaymentRefusal(null, 'capture'), { status: 502 })
  }

  if (result.state === 'confirmed' || result.state === 'already_confirmed') {
    const appBaseUrl = getAppUrl()
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

  if (result.state === 'capture_pending') {
    // PayPal is holding the money for review (BK-019): nothing is confirmed yet, and the guest
    // is messaged when the webhook confirms the booking.
    await alertEventPaymentNeedsAPerson(supabase, {
      bookingId: result.bookingId,
      kind: 'capture_pending',
      amount: result.amount,
      orderId: parsed.data.orderId,
      source: 'guest payment link',
    })
    return NextResponse.json(
      {
        success: false,
        state: 'capture_pending',
        booking_id: result.bookingId,
        error: 'PayPal is still processing this payment. The booking will be confirmed when it clears.',
      },
      { status: 202 }
    )
  }

  if (result.state === 'manual_review') {
    // The guest is told staff will check the booking, so a manager must hear about it (BK-018).
    await alertEventPaymentNeedsAPerson(supabase, {
      bookingId: result.bookingId,
      kind: 'manual_review',
      reason: result.reason ?? null,
      amount: result.amount,
      orderId: parsed.data.orderId,
      source: 'guest payment link',
    })
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
    eventPaymentRefusal(result.reason, 'capture'),
    { status: result.reason === 'hold_expired' ? 410 : 409 }
  )
}
