import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createTableCheckoutSessionByRawToken } from '@/lib/table-bookings/bookings'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { logger } from '@/lib/logger'

type RouteContext = {
  params: Promise<{ token: string }>
}

function deriveBlockedReasonFromError(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()

  if (
    message.includes('stripe_secret_key is not configured') ||
    message.includes('stripe api error') ||
    message.includes('stripe checkout session') ||
    (message.includes('expires_at') && message.includes('less than 24 hours')) ||
    (message.includes('timestamp') && message.includes('less than 24 hours'))
  ) {
    return 'stripe_unavailable'
  }

  return 'internal_error'
}

function blockedReasonToQuery(reason: string): string {
  switch (reason) {
    case 'token_used':
    case 'token_expired':
    case 'booking_not_pending_payment':
    case 'hold_expired':
    case 'stripe_unavailable':
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
    scope: 'guest_table_payment_checkout',
    maxAttempts: 8,
  })

  if (!throttle.allowed) {
    return NextResponse.redirect(
      new URL(`/g/${token}/table-payment?state=blocked&reason=rate_limited`, request.url),
      { status: 303 }
    )
  }

  const supabase = createAdminClient()
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin

  try {
    const checkoutResult = await createTableCheckoutSessionByRawToken(supabase, {
      rawToken: token,
      appBaseUrl,
    })

    if (checkoutResult.state !== 'created') {
      const blockedReason = blockedReasonToQuery(checkoutResult.reason || 'unavailable')
      return NextResponse.redirect(
        new URL(`/g/${token}/table-payment?state=blocked&reason=${blockedReason}`, request.url),
        { status: 303 }
      )
    }

    return NextResponse.redirect(checkoutResult.checkoutUrl, { status: 303 })
  } catch (error) {
    const blockedReason = deriveBlockedReasonFromError(error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorName = error instanceof Error ? error.name : 'UnknownError'
    const errorStackPreview = error instanceof Error && typeof error.stack === 'string'
      ? error.stack.split('\n').slice(0, 4).join('\n')
      : null
    logger.error('Failed to create Stripe checkout for table payment token', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: {
        blockedReason,
        error_message: errorMessage,
        error_name: errorName,
        error_stack_preview: errorStackPreview,
      },
    })

    return NextResponse.redirect(
      new URL(`/g/${token}/table-payment?state=blocked&reason=${blockedReason}`, request.url),
      { status: 303 }
    )
  }
}
