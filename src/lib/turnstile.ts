import { logger } from '@/lib/logger'

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

type TurnstileResult = {
  success: boolean
  error?: string
}

/**
 * Verify a Cloudflare Turnstile token server-side.
 * Returns { success: true } if valid, { success: false, error } otherwise.
 *
 * Requires TURNSTILE_SECRET_KEY env var.
 * If the env var is missing, verification is skipped (dev/test environments).
 */
export async function verifyTurnstileToken(
  token: string | null | undefined,
  remoteIp?: string | null
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) {
    logger.warn('TURNSTILE_SECRET_KEY not set — skipping Turnstile verification')
    return { success: true }
  }

  if (!token || token.trim().length === 0) {
    return { success: false, error: 'Missing Turnstile verification token' }
  }

  try {
    const formData = new URLSearchParams()
    formData.append('secret', secret)
    formData.append('response', token)
    if (remoteIp) {
      formData.append('remoteip', remoteIp)
    }

    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString()
    })

    if (!res.ok) {
      logger.error('Turnstile API returned non-OK status', {
        metadata: { status: res.status }
      })
      return { success: false, error: 'Turnstile verification service unavailable' }
    }

    const result = await res.json() as { success: boolean; 'error-codes'?: string[] }

    if (!result.success) {
      logger.warn('Turnstile token verification failed', {
        metadata: { errorCodes: result['error-codes'] }
      })
      return {
        success: false,
        error: 'Turnstile verification failed'
      }
    }

    return { success: true }
  } catch (err) {
    logger.error('Turnstile verification threw', {
      metadata: { error: err instanceof Error ? err.message : String(err) }
    })
    return { success: false, error: 'Turnstile verification error' }
  }
}

/**
 * Extract the client IP from a NextRequest for Turnstile and rate limiting.
 */
export function getClientIp(request: Request): string | null {
  const headers = request.headers
  return (
    headers.get('cf-connecting-ip')
    || headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || headers.get('x-real-ip')
    || null
  )
}
