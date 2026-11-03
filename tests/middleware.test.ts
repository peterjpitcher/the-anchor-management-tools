// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * The sign-in redirects in src/middleware.ts must carry both the cookies the Supabase client
 * wrote during getUser() and the post_login_redirect cookie. A dead stored session makes
 * @supabase/ssr clear the auth cookies through setAll; copying those by replacing the
 * redirect's Set-Cookie header dropped post_login_redirect, so a staff member who tapped an
 * emailed /portal/training link landed on /portal/shifts after signing in.
 *
 * The stored value must also be a path on this site and nothing a browser could read as another
 * site, because both the `redirectedFrom` parameter and the requested path come from whoever
 * wrote the link: `/\evil.example`, `/%5Cevil.example` (once decoded) and `/.//evil.example`
 * (once dot segments are removed) all become `//evil.example`.
 */

type CookieToSet = { name: string; value: string; options: Record<string, unknown> }

const mocks = vi.hoisted(() => ({
  user: null as { id: string } | null,
  cookiesWrittenByGetUser: [] as CookieToSet[],
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: { cookies: { setAll: (cookies: CookieToSet[]) => void } },
  ) => ({
    auth: {
      getUser: async () => {
        if (mocks.cookiesWrittenByGetUser.length > 0) {
          options.cookies.setAll(mocks.cookiesWrittenByGetUser)
        }
        return { data: { user: mocks.user }, error: mocks.user ? null : new Error('Auth session missing') }
      },
    },
  }),
}))

import { middleware } from '@/middleware'

const ORIGIN = 'https://management.orangejelly.co.uk'
const CLEAR = { path: '/', maxAge: 0, sameSite: 'lax' }

function request(path: string): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, {
    headers: { host: 'management.orangejelly.co.uk', cookie: 'sb-abc-auth-token=stale-session' },
  })
}

/**
 * The cookies as the browser receives them: parsed from the Set-Cookie lines on the wire, not
 * read back through response.cookies, which keeps its own copy and does not see a header that
 * was replaced directly.
 */
function sentCookies(response: Response): Map<string, { value: string; maxAge?: number }> {
  const sent = new Map<string, { value: string; maxAge?: number }>()
  for (const line of response.headers.getSetCookie()) {
    const [pair, ...attributes] = line.split(';').map((part) => part.trim())
    const separator = pair.indexOf('=')
    const maxAge = attributes.find((attribute) => attribute.toLowerCase().startsWith('max-age='))
    sent.set(pair.slice(0, separator), {
      value: decodeURIComponent(pair.slice(separator + 1)),
      ...(maxAge ? { maxAge: Number(maxAge.split('=')[1]) } : {}),
    })
  }
  return sent
}

beforeEach(() => {
  mocks.user = null
  mocks.cookiesWrittenByGetUser = []
})

describe('middleware sign-in redirect cookies', () => {
  it('keeps the saved destination when the session check clears the auth cookies', async () => {
    mocks.cookiesWrittenByGetUser = [{ name: 'sb-abc-auth-token', value: '', options: CLEAR }]

    const response = await middleware(request('/portal/training'))

    expect(response.status).toBe(307)
    expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/auth/login')
    const sent = sentCookies(response)
    expect(sent.get('post_login_redirect')?.value).toBe('/portal/training')
    expect(sent.get('sb-abc-auth-token')).toEqual({ value: '', maxAge: 0 })
    // The cookie keeps the attributes the Supabase client gave it.
    const clearingLine = response.headers.getSetCookie().find((line) => line.startsWith('sb-abc-auth-token='))
    expect(clearingLine).toMatch(/Path=\//)
    expect(clearingLine).toMatch(/SameSite=lax/i)
  })

  it('sends each cookie on its own Set-Cookie line, not folded into one', async () => {
    mocks.cookiesWrittenByGetUser = [
      { name: 'sb-abc-auth-token.0', value: '', options: CLEAR },
      { name: 'sb-abc-auth-token.1', value: '', options: CLEAR },
    ]

    const response = await middleware(request('/portal/training'))

    const lines = response.headers.getSetCookie()
    expect(lines).toHaveLength(3)
    expect(lines.map((line) => line.split('=')[0]).sort()).toEqual([
      'post_login_redirect',
      'sb-abc-auth-token.0',
      'sb-abc-auth-token.1',
    ])
  })

  it('still saves the destination when the session check writes no cookies', async () => {
    const response = await middleware(request('/portal/training'))

    expect(response.status).toBe(307)
    expect(response.headers.getSetCookie()).toHaveLength(1)
    expect(sentCookies(response).get('post_login_redirect')?.value).toBe('/portal/training')
  })

  it('keeps the destination from a legacy redirectedFrom link when the session is cleared', async () => {
    mocks.cookiesWrittenByGetUser = [{ name: 'sb-abc-auth-token', value: '', options: CLEAR }]

    const response = await middleware(request('/auth/login?redirectedFrom=%2Fportal%2Ftraining'))

    expect(response.status).toBe(308)
    expect(response.headers.get('location')).toBe(`${ORIGIN}/auth/login`)
    const sent = sentCookies(response)
    expect(sent.get('post_login_redirect')?.value).toBe('/portal/training')
    expect(sent.get('sb-abc-auth-token')).toEqual({ value: '', maxAge: 0 })
  })

  it('lets a signed-in request through with its refreshed session cookies', async () => {
    mocks.user = { id: 'user-1' }
    mocks.cookiesWrittenByGetUser = [{ name: 'sb-abc-auth-token', value: 'fresh-session', options: { path: '/' } }]

    const response = await middleware(request('/portal/training'))

    expect(response.headers.get('location')).toBeNull()
    const sent = sentCookies(response)
    expect(sent.get('sb-abc-auth-token')?.value).toBe('fresh-session')
    expect(sent.has('post_login_redirect')).toBe(false)
  })
})

/** A deployment on another host, with no session cookie: nobody is signed in. */
const OTHER_ORIGIN = 'https://management.example'
const BACKSLASH = String.fromCharCode(92)
const CONTROL_CHARACTER = String.fromCharCode(1)

async function storedRedirect(url: string): Promise<string | undefined> {
  const response = await middleware(new NextRequest(url))
  return response.cookies.get('post_login_redirect')?.value
}

/** The cookie stored for `/auth/login?redirectedFrom=<value>`, with `value` arriving exactly as given. */
function storedFromParam(value: string): Promise<string | undefined> {
  return storedRedirect(`${OTHER_ORIGIN}/auth/login?redirectedFrom=${encodeURIComponent(value)}`)
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
    ['an encoded backslash', `${OTHER_ORIGIN}/%5Cevil.example`],
    ['encoded slashes', `${OTHER_ORIGIN}/%2F%2Fevil.example`],
  ])('refuses %s', async (_label, url) => {
    expect(await storedRedirect(url)).toBe('/dashboard')
  })

  it('keeps an ordinary path with its query', async () => {
    expect(await storedRedirect(`${OTHER_ORIGIN}/employees/123?tab=notes`)).toBe('/employees/123?tab=notes')
  })
})
