import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

/**
 * The two booking routes the website proxies take API-key callers only (BK-129, customer bookings
 * review of 24 October 2026).
 *
 * They used to run a Turnstile check for anonymous callers before withApiAuth, which refuses
 * every anonymous caller anyway, so the check could never let one through and only cost a call to
 * Cloudflare. The website verifies its own Turnstile token, with its own widget and secret, before
 * it proxies. An earlier version of these routes also let `x-api-key: anything` skip the check.
 */
const PROXIED_BOOKING_ROUTES = [
  'src/app/api/table-bookings/route.ts',
  'src/app/api/event-bookings/route.ts'
]

describe('the booking routes the website proxies', () => {
  it.each(PROXIED_BOOKING_ROUTES)('%s runs no Turnstile check of its own', (route) => {
    const source = readFileSync(join(process.cwd(), route), 'utf8')
    expect(source).not.toContain('verifyTurnstileToken')
    expect(source).not.toContain('TURNSTILE_FAILED')
  })

  it.each(PROXIED_BOOKING_ROUTES)('%s answers every caller through withApiAuth', (route) => {
    const source = readFileSync(join(process.cwd(), route), 'utf8')
    expect(source).toMatch(/return withApiAuth\(/)
    // The header-presence test that once made a bypass free.
    expect(source).not.toMatch(/Boolean\(\s*request\.headers\.get\('x-api-key'\)/)
  })
})

describe('verifyTurnstileToken without a secret', () => {
  const env = process.env as Record<string, string | undefined>
  const saved = { secret: env.TURNSTILE_SECRET_KEY, nodeEnv: env.NODE_ENV }
  afterEach(() => {
    env.TURNSTILE_SECRET_KEY = saved.secret
    env.NODE_ENV = saved.nodeEnv
  })

  it('refuses in production, where a missing secret used to wave every bot through', async () => {
    delete env.TURNSTILE_SECRET_KEY
    env.NODE_ENV = 'production'
    const { verifyTurnstileToken } = await import('@/lib/turnstile')
    expect(await verifyTurnstileToken('any-token')).toEqual({ success: false, error: 'Turnstile verification is not configured' })
  })

  it('still skips outside production, so development and tests run without one', async () => {
    delete env.TURNSTILE_SECRET_KEY
    env.NODE_ENV = 'test'
    const { verifyTurnstileToken } = await import('@/lib/turnstile')
    expect(await verifyTurnstileToken('any-token')).toEqual({ success: true })
  })
})

/**
 * An unverifiable key must be reported as an outage, not as a bad credential.
 * Answering 401 sent integrators hunting for a credential problem that did not
 * exist, and matched what checkRateLimit already does when its own backing
 * store is unreachable.
 */
describe('auth resolution', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/api/auth.ts'), 'utf8')

  it('keeps unavailable distinct from anonymous', () => {
    expect(source).toContain("'unavailable'")
    expect(source).toContain('AUTH_UNAVAILABLE')
  })

  it('answers 503 rather than 401 when the key cannot be checked', () => {
    expect(source).toMatch(/state === 'unavailable'[\s\S]{0,300}?503/)
  })
})
