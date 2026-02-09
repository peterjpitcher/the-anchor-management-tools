import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createEventCheckoutSessionByRawToken } from '@/lib/events/event-payments'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { logger } from '@/lib/logger'

type RouteContext = {
  params: Promise<{ token: string }>
}

function blockedReasonToQuery(reason: string): string {
  switch (reason) {
    case 'token_used':
    case 'token_expired':
    case 'booking_not_pending_payment':
    case 'hold_expired':
      return reason
    default:
      return 'unavailable'
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { token } = await context.params
  const throttle = await checkGuestTokenThrottle({
    request,
    rawToken: token,
    scope: 'guest_event_payment_checkout',
    maxAttempts: 8
  })

  if (!throttle.allowed) {
    return NextResponse.redirect(
      new URL(`/g/${token}/event-payment?state=blocked&reason=rate_limited`, request.url),
      { status: 303 }
    )
  }

  const supabase = createAdminClient()
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin

  try {
    const checkoutResult = await createEventCheckoutSessionByRawToken(supabase, {
      rawToken: token,
      appBaseUrl
    })

    if (checkoutResult.state !== 'created') {
      const blockedReason = blockedReasonToQuery(checkoutResult.reason || 'unavailable')
      return NextResponse.redirect(
        new URL(`/g/${token}/event-payment?state=blocked&reason=${blockedReason}`, request.url),
        { status: 303 }
      )
    }

    return NextResponse.redirect(checkoutResult.checkoutUrl, { status: 303 })
  } catch (error) {
    logger.error('Failed to create Stripe checkout for event payment token', {
      error: error instanceof Error ? error : new Error(String(error))
    })

    return NextResponse.redirect(
      new URL(`/g/${token}/event-payment?state=blocked&reason=internal_error`, request.url),
      { status: 303 }
    )
  }
}
