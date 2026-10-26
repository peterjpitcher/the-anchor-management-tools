import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createEventPayPalOrderByRawToken } from '@/lib/events/event-payments'
import { eventPaymentRefusal } from '@/lib/events/event-payment-reasons'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { logger } from '@/lib/logger'

type RouteContext = {
  params: Promise<{ token: string }>
}

/*
 * The guest payment-link page (BK-029, customer bookings review of 24 October 2026). A refusal
 * used to answer with the bare reason ("hold_expired"), which the page showed as it stood. Every
 * answer now carries `message`, a sentence for the guest, beside the reason in `error` and `code`.
 * Nothing has been charged at this step.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { token } = await context.params
  const throttle = await checkGuestTokenThrottle({
    request,
    rawToken: token,
    scope: 'guest_event_payment_create_order',
    maxAttempts: 12
  })

  if (!throttle.allowed) {
    return NextResponse.json(eventPaymentRefusal('rate_limited', 'start'), { status: 429 })
  }

  let result: Awaited<ReturnType<typeof createEventPayPalOrderByRawToken>>
  try {
    result = await createEventPayPalOrderByRawToken(createAdminClient(), { rawToken: token })
  } catch (error) {
    logger.error('Guest event payment link could not start a PayPal order', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return NextResponse.json(eventPaymentRefusal(null, 'start'), { status: 502 })
  }

  if (result.state !== 'created') {
    return NextResponse.json(
      eventPaymentRefusal(result.reason, 'start'),
      { status: result.reason === 'hold_expired' ? 410 : 409 }
    )
  }

  return NextResponse.json({
    success: true,
    orderId: result.orderId,
    amount: result.amount,
    currency: result.currency,
    holdExpiresAt: result.holdExpiresAt,
  })
}
