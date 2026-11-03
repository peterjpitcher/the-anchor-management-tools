// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * The middleware stores where a signed-out visitor was heading in the `post_login_redirect`
 * cookie, and the login screen sends them there once they have typed their password. Both the
 * `redirectedFrom` parameter and the requested path come from whoever wrote the link, so the
 * stored value must be a path on this site and nothing a browser could read as another site:
 * `/\evil.example`, `/%5Cevil.example` (once decoded) and `/.//evil.example` (once dot segments
 * are removed) all become `//evil.example`.
 */

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}))

import { middleware } from '@/middleware'

const ORIGIN = 'https://management.example'
const BACKSLASH = String.fromCharCode(92)
const CONTROL_CHARACTER = String.fromCharCode(1)

async function storedRedirect(url: string): Promise<string | undefined> {
  const response = await middleware(new NextRequest(url))
  return response.cookies.get('post_login_redirect')?.value
}

/** The cookie stored for `/auth/login?redirectedFrom=<value>`, with `value` arriving exactly as given. */
function storedFromParam(value: string): Promise<string | undefined> {
  return storedRedirect(`${ORIGIN}/auth/login?redirectedFrom=${encodeURIComponent(value)}`)
}

describe('middleware login redirect cookie from redirectedFrom', () => {
  it.each([
    ['a backslash after the slash', `/${BACKSLASH}evil.example`],
    ['an encoded backslash', '/%5Cevil.example'],
    ['a lower-case encoded backslash', '/%5cevil.example'],
    ['a protocol-relative link', '//evil.example'],
    ['dot segments and a backslash', `/./${BACKSLASH}/evil.example`],
    ['dot segments that collapse to a protocol-relative link', '/.//evil.example'],
    ['an absolute link', 'https://evil.example'],
    ['a control character', `/${CONTROL_CHARACTER}/evil.example`],
    ['an auth route', '/auth/callback'],
  ])('refuses %s', async (_label, value) => {
    expect(await storedFromParam(value)).toBe('/dashboard')
  })

  it('keeps an ordinary path with its query', async () => {
    expect(await storedFromParam('/employees?x=1')).toBe('/employees?x=1')
  })
})

describe('middleware login redirect cookie from the requested path', () => {
  it.each([
    ['an encoded backslash', `${ORIGIN}/%5Cevil.example`],
    ['encoded slashes', `${ORIGIN}/%2F%2Fevil.example`],
  ])('refuses %s', async (_label, url) => {
    expect(await storedRedirect(url)).toBe('/dashboard')
  })

  it('keeps an ordinary path with its query', async () => {
    expect(await storedRedirect(`${ORIGIN}/employees/123?tab=notes`)).toBe('/employees/123?tab=notes')
  })
})
