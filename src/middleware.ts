import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload } from 'jose'
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
const issuer = new URL('/auth/v1', supabaseUrl).toString()
const jwks = createRemoteJWKSet(new URL('/auth/v1/certs', supabaseUrl))

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

async function verifyAccessToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer })
    return { valid: true as const, payload }
  } catch (error) {
    if (error instanceof errors.JWTExpired) {
      return { valid: false as const, reason: 'expired' as const }
    }
    return { valid: false as const, reason: 'invalid' as const }
  }
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

function ensureUserObject(user: unknown, payload: JWTPayload | null) {
  if (user && typeof user === 'object') {
    return user
  }

  if (payload?.sub) {
    return { id: payload.sub }
  }

  return null
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

  let verifiedPayload: JWTPayload | null = null
  let workingSession = { ...session }
  let workingUser = storedUser
  let sessionUpdated = false

  const verification = await verifyAccessToken(accessToken)

  if (verification.valid) {
    verifiedPayload = verification.payload
  } else if (verification.reason === 'expired' && refreshToken) {
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

      const refreshedVerification = await verifyAccessToken(refreshed.access_token)
      if (refreshedVerification.valid) {
        verifiedPayload = refreshedVerification.payload
        sessionUpdated = true
      }
    }
  }

  if (!verifiedPayload) {
    return redirectToLogin(request, cookieNames, secure)
  }

  const normalizedUser = ensureUserObject(workingUser, verifiedPayload)
  if (!normalizedUser) {
    return redirectToLogin(request, cookieNames, secure)
  }

  const response = NextResponse.next()

  if (sessionUpdated) {
    const encodedSession = encodeStoredValue(JSON.stringify(workingSession))
    setStoredValue(response, SESSION_COOKIE_NAME, encodedSession, cookieNames, secure)

    const encodedUser = encodeStoredValue(JSON.stringify({ user: normalizedUser }))
    setStoredValue(response, USER_COOKIE_NAME, encodedUser, cookieNames, secure)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
