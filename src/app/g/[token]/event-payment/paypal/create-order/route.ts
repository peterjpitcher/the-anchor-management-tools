import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createEventPayPalOrderByRawToken } from '@/lib/events/event-payments'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'

type RouteContext = {
  params: Promise<{ token: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { token } = await context.params
  const throttle = await checkGuestTokenThrottle({
    request,
    rawToken: token,
    scope: 'guest_event_payment_create_order',
    maxAttempts: 12
  })

  if (!throttle.allowed) {
    return NextResponse.json({ success: false, error: 'rate_limited' }, { status: 429 })
  }

  const result = await createEventPayPalOrderByRawToken(createAdminClient(), { rawToken: token })
  if (result.state !== 'created') {
    return NextResponse.json(
      { success: false, error: result.reason },
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
