import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Two rules hold every public endpoint that skips Turnstile for API-key callers.
 *
 * 1. The skip must depend on a key that actually validates. These routes used to
 *    skip whenever an x-api-key or authorization header was merely present, and
 *    neither header is authenticated by anything on its own, so any anonymous
 *    caller could defeat the bot check with "x-api-key: anything".
 *
 * 2. The gate must fire on `anonymous` specifically, never on "not
 *    authenticated". Those differ when a key is presented that we could not
 *    check, which is our outage rather than a bot. Such a caller has no widget
 *    to solve, and the website's token is minted from a different Turnstile
 *    widget whose secret this app does not hold, so gating them rejects a real
 *    guest 100% of the time and calls our downtime a failed bot check.
 */
const PUBLIC_ROUTES = [
  'src/app/api/private-booking-enquiry/route.ts',
  'src/app/api/public/private-booking/route.ts',
  'src/app/api/table-bookings/route.ts',
  'src/app/api/event-bookings/route.ts'
]

describe('public endpoint Turnstile gate', () => {
  it.each(PUBLIC_ROUTES)('%s validates the API key before skipping Turnstile', (route) => {
    const source = readFileSync(join(process.cwd(), route), 'utf8')

    expect(source).toContain('getApiKeyAuthState')

    // The header-presence test that made the bypass free.
    expect(source).not.toMatch(/Boolean\(\s*request\.headers\.get\('x-api-key'\)/)
  })

  it.each(PUBLIC_ROUTES)('%s gates on anonymous, not on "not authenticated"', (route) => {
    const source = readFileSync(join(process.cwd(), route), 'utf8')

    expect(source).toMatch(/authState === 'anonymous'/)

    // The negated forms are what swept an unverifiable key into the bot gate.
    expect(source).not.toMatch(/if \(!authenticated\)\s*\{[\s\S]{0,400}?verifyTurnstileToken/)
    expect(source).not.toMatch(/if \(!apiKeyAuthenticated\)\s*\{[\s\S]{0,400}?verifyTurnstileToken/)
  })

  it.each(PUBLIC_ROUTES)('%s still runs verifyTurnstileToken', (route) => {
    const source = readFileSync(join(process.cwd(), route), 'utf8')
    expect(source).toContain('verifyTurnstileToken')
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
