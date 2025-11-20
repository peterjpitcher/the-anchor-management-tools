import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import {
  SESSION_COOKIE_NAME,
  USER_COOKIE_NAME,
  decodeStoredValue,
  encodeStoredValue,
  parseJsonValue,
  readStoredValue,
  setStoredValue,
  clearStoredValue,
  type CookieRecord,
} from '@/lib/auth/sessionCookies'

const PUBLIC_PATH_PREFIXES = [
  '/_next',
  '/static',
  '/auth',
  '/error',
  '/privacy',
  '/booking-confirmation',
  '/booking-success',
  '/table-booking',
  '/parking/guest',
  '/api',
]

function isPublicPath(pathname: string) {
  if (pathname === '/') return true
  if (pathname.includes('.')) return true
  return PUBLIC_PATH_PREFIXES.some(prefix => pathname.startsWith(prefix))
}

function isVipHost(hostname: string) {
  return hostname === 'vip-club.uk' || hostname.endsWith('.vip-club.uk')
}

function sanitizeRedirectTarget(url: URL) {
  try {
    const decodedPath = decodeURIComponent(url.pathname).trim()
    const collapsedPath = decodedPath.replace(/\s+/g, '')
    const finalPath = collapsedPath.startsWith('/') ? collapsedPath : '/dashboard'
    const search = url.search ? url.search.replace(/\s+/g, '') : ''
    return finalPath + search
  } catch {
    return '/dashboard'
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!SUPABASE_URL) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL is required for middleware auth enforcement.')
}

if (!SUPABASE_ANON_KEY) {
  throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is required for middleware auth enforcement.')
}

const supabaseUrl = new URL(SUPABASE_URL)
const supabaseAnonKey = SUPABASE_ANON_KEY as string

type StoredSession = {
  access_token?: string
  refresh_token?: string
  expires_at?: number
  expires_in?: number
  token_type?: string
  user?: unknown
  [key: string]: unknown
}

type RefreshResponse = {
  access_token: string
  refresh_token?: string
  token_type?: string
  expires_in?: number
  expires_at?: number
  user?: unknown
}

async function refreshSession(refreshToken: string): Promise<RefreshResponse | null> {
  try {
    const refreshUrl = new URL('/auth/v1/token?grant_type=refresh_token', supabaseUrl)
    const response = await fetch(refreshUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: 'no-store',
    })

    if (!response.ok) {
      return null
    }

    const data = (await response.json()) as RefreshResponse
    if (!data.access_token) {
      return null
    }

    return data
  } catch (error) {
    console.error('Failed to refresh Supabase session in middleware:', error)
    return null
  }
}

function extractSession(request: NextRequest) {
  const allCookies: CookieRecord[] = request.cookies.getAll()
  const sessionEncoded = readStoredValue(allCookies, SESSION_COOKIE_NAME)
  const sessionDecoded = decodeStoredValue(sessionEncoded)
  const session = parseJsonValue<StoredSession>(sessionDecoded)

  const userEncoded = readStoredValue(allCookies, USER_COOKIE_NAME)
  const userDecoded = decodeStoredValue(userEncoded)
  const userWrapper = parseJsonValue<{ user: unknown }>(userDecoded)

  return {
    session,
    storedUser: userWrapper?.user ?? (session && 'user' in session ? session.user : null),
    cookies: allCookies,
  }
}

function redirectToLogin(request: NextRequest, cookieNames: string[], secure: boolean) {
  const redirectUrl = request.nextUrl.clone()
  redirectUrl.pathname = '/auth/login'
  redirectUrl.searchParams.set('redirectedFrom', sanitizeRedirectTarget(request.nextUrl))

  const response = NextResponse.redirect(redirectUrl)
  clearStoredValue(response, SESSION_COOKIE_NAME, cookieNames, secure)
  clearStoredValue(response, USER_COOKIE_NAME, cookieNames, secure)
  return response
}

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || ''
  if (isVipHost(hostname)) {
    return NextResponse.next()
  }

  if (isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.next()
  }

  const secure = request.nextUrl.protocol === 'https:'
  const { session, storedUser, cookies } = extractSession(request)
  const cookieNames = cookies.map(cookie => cookie.name)

  if (!session || typeof session.access_token !== 'string') {
    return redirectToLogin(request, cookieNames, secure)
  }

  const accessToken = session.access_token
  const refreshToken = typeof session.refresh_token === 'string' ? session.refresh_token : null

  let workingSession = { ...session }
  let workingUser = storedUser
  let sessionUpdated = false

  const now = Math.floor(Date.now() / 1000)
  const expiresAt = typeof workingSession.expires_at === 'number' ? workingSession.expires_at : null
  const shouldRefresh =
    !!refreshToken &&
    expiresAt !== null &&
    // refresh a little before expiry to avoid race conditions
    expiresAt <= now + 60

  if (shouldRefresh) {
    try {
      const refreshed = await refreshSession(refreshToken)
      if (refreshed) {
        workingSession = {
          ...workingSession,
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token ?? refreshToken,
          token_type: refreshed.token_type ?? workingSession.token_type,
          expires_in: refreshed.expires_in ?? workingSession.expires_in,
          expires_at:
            refreshed.expires_at ??
            Math.floor(Date.now() / 1000) + (refreshed.expires_in ?? workingSession.expires_in ?? 0),
        }

        if (refreshed.user !== undefined) {
          workingSession.user = refreshed.user
          workingUser = refreshed.user
        }

        sessionUpdated = true
      }
    } catch (error) {
      // If refresh fails, we continue with the existing session if it's still valid
      // The client will handle re-authentication if needed
      console.error('Session refresh failed:', error)
    }
  }

  if (typeof workingSession.access_token !== 'string') {
    return redirectToLogin(request, cookieNames, secure)
  }

  const response = NextResponse.next()

  if (sessionUpdated) {
    const encodedSession = encodeStoredValue(JSON.stringify(workingSession))
    setStoredValue(response, SESSION_COOKIE_NAME, encodedSession, cookieNames, secure)

    const normalizedUser = workingSession.user ?? workingUser ?? null
    if (normalizedUser) {
      const encodedUser = encodeStoredValue(JSON.stringify({ user: normalizedUser }))
      setStoredValue(response, USER_COOKIE_NAME, encodedUser, cookieNames, secure)
    } else {
      clearStoredValue(response, USER_COOKIE_NAME, cookieNames, secure)
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
