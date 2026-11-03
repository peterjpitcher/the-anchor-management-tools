// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * The sign-in redirects in src/middleware.ts must carry both the cookies the Supabase client
 * wrote during getUser() and the post_login_redirect cookie. A dead stored session makes
 * @supabase/ssr clear the auth cookies through setAll; copying those by replacing the
 * redirect's Set-Cookie header dropped post_login_redirect, so a staff member who tapped an
 * emailed /portal/training link landed on /portal/shifts after signing in.
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
