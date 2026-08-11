import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Both public private-booking endpoints used to skip Turnstile whenever an
 * x-api-key or authorization header was merely present. Neither header is
 * authenticated by anything on its own, so any anonymous caller could defeat the
 * bot check by sending "x-api-key: anything". The bypass must depend on a key
 * that actually validates.
 */
const PUBLIC_ROUTES = [
  'src/app/api/private-booking-enquiry/route.ts',
  'src/app/api/public/private-booking/route.ts'
]

describe('public endpoint Turnstile gate', () => {
  it.each(PUBLIC_ROUTES)('%s validates the API key before skipping Turnstile', (route) => {
    const source = readFileSync(join(process.cwd(), route), 'utf8')

    expect(source).toContain('isApiKeyAuthenticated')

    // The header-presence test that made the bypass free.
    expect(source).not.toMatch(/Boolean\(\s*request\.headers\.get\('x-api-key'\)/)
  })

  it.each(PUBLIC_ROUTES)('%s still runs verifyTurnstileToken', (route) => {
    const source = readFileSync(join(process.cwd(), route), 'utf8')
    expect(source).toContain('verifyTurnstileToken')
  })
})
