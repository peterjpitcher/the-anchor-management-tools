import { createApiResponse } from '@/lib/api/auth'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { getClientIp, verifyTurnstileToken } from '@/lib/turnstile'

type PublicRecruitmentGuardOptions = {
  scope: string
  requireTurnstile?: boolean
  turnstileToken?: string | null
  maxAttempts?: number
  windowMs?: number
}

export function isRecruitmentTurnstileConfigured() {
  return Boolean(
    process.env.TURNSTILE_SECRET_KEY?.trim()
    && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim()
  )
}

export async function guardPublicRecruitmentRequest(
  request: Request,
  rawToken: string,
  options: PublicRecruitmentGuardOptions
) {
  const throttle = await checkGuestTokenThrottle({
    request,
    rawToken,
    scope: options.scope,
    maxAttempts: options.maxAttempts ?? (options.requireTurnstile ? 5 : 20),
    windowMs: options.windowMs ?? 15 * 60 * 1000,
  })

  if (!throttle.allowed) {
    return createApiResponse(
      {
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many attempts. Please try again later.',
        },
      },
      429,
      {
        'Retry-After': String(throttle.retryAfterSeconds),
        'X-RateLimit-Remaining': String(throttle.remaining),
      },
      request.method
    )
  }

  if (options.requireTurnstile && isRecruitmentTurnstileConfigured()) {
    const token = options.turnstileToken || request.headers.get('x-turnstile-token')
    const turnstile = await verifyTurnstileToken(token, getClientIp(request))
    if (!turnstile.success) {
      return createApiResponse(
        {
          success: false,
          error: {
            code: 'TURNSTILE_FAILED',
            message: turnstile.error || 'Bot verification failed',
          },
        },
        403,
        {},
        request.method
      )
    }
  }

  return null
}
