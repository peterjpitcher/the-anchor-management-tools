import { NextRequest, NextResponse } from 'next/server'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'

type RouteContext = {
  params: Promise<{ token: string }>
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

  return NextResponse.redirect(
    new URL(`/g/${token}/event-payment`, request.url),
    { status: 303 }
  )
}
