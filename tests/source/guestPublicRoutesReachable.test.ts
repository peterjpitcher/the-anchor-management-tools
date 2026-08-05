import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guard against a whole class of silent bug: a guest-facing page that exists, renders
 * correctly and passes its own tests, but is missing from the middleware allowlist, so
 * every guest who follows the link is bounced to the staff login screen.
 *
 * `/parking/payment-error` shipped in exactly that state. The PayPal return and retry
 * handlers redirect there (src/lib/parking/public-links.ts), but it was never allowlisted,
 * so a guest whose parking payment failed landed on a login form.
 *
 * Every prefix below is reachable by a member of the public with no account. Adding a new
 * guest surface means adding it here and to PUBLIC_PATH_PREFIXES in src/middleware.ts.
 */
const GUEST_REACHABLE_PREFIXES = [
  '/feedback',
  '/privacy',
  '/booking-portal',
  '/parking/guest',
  '/parking/payment-error',
  '/g',
  '/m',
  '/r',
]

function readMiddleware(): string {
  return readFileSync(join(process.cwd(), 'src/middleware.ts'), 'utf8')
}

/** The literal entries inside the PUBLIC_PATH_PREFIXES array, comments stripped. */
function publicPathPrefixes(source: string): string[] {
  const block = source.match(/const PUBLIC_PATH_PREFIXES = \[([\s\S]*?)\]/)
  expect(block, 'PUBLIC_PATH_PREFIXES array not found in src/middleware.ts').toBeTruthy()
  return Array.from(block![1].matchAll(/'([^']+)'/g)).map((m) => m[1])
}

describe('guest-facing routes are reachable without a login', () => {
  it('allowlists every public guest prefix in the middleware', () => {
    const prefixes = publicPathPrefixes(readMiddleware())

    for (const prefix of GUEST_REACHABLE_PREFIXES) {
      expect(prefixes, `${prefix} must be in PUBLIC_PATH_PREFIXES or guests get redirected to /auth/login`).toContain(prefix)
    }
  })

  it('keeps the parking payment-error page public, since failed payments redirect to it', () => {
    const prefixes = publicPathPrefixes(readMiddleware())
    expect(prefixes).toContain('/parking/payment-error')

    // The redirect target that makes this mandatory.
    const links = readFileSync(join(process.cwd(), 'src/lib/parking/public-links.ts'), 'utf8')
    expect(links).toContain('/parking/payment-error')
  })

  it('does not allowlist the staff areas that sit next to guest routes', () => {
    const prefixes = publicPathPrefixes(readMiddleware())

    // `/parking` bare would expose the authenticated parking admin screens, and
    // `/recruitment` bare would expose the staff ATS. Only the scoped paths are public.
    expect(prefixes).not.toContain('/parking')
    expect(prefixes).not.toContain('/recruitment')
    expect(prefixes).not.toContain('/dashboard')
  })
})
