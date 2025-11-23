import { type NextRequest, NextResponse } from 'next/server'

const PUBLIC_PATH_PREFIXES = [
  '/_next',     // Next.js internal
  '/static',    // Static files directory
  '/api',       // API routes (often public or handle their own auth)
  
  // Auth Routes
  '/auth',
  '/error',
  '/privacy',
  
  // Public Features
  '/booking-confirmation',
  '/booking-success',
  '/table-booking',
  '/parking/guest',
];

const PUBLIC_FILE_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.svg', '.gif', '.webp', '.ico', '.json', '.xml', '.txt', '.css', '.js'
];

function isPublicPath(pathname: string) {
  if (pathname === '/') return true;
  
  // Check for specific public prefixes
  if (PUBLIC_PATH_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
    return true;
  }

  // Check for file extensions (e.g., /logo.png)
  // This is safer than `pathname.includes('.')` which would expose `/user/john.doe`
  if (PUBLIC_FILE_EXTENSIONS.some(ext => pathname.toLowerCase().endsWith(ext))) {
    return true;
  }

  return false;
}

function isVipHost(hostname: string) {
  return hostname === 'vip-club.uk' || hostname.endsWith('.vip-club.uk')
}

type SessionCookie = {
  name: string
  value: string
  // CookieOptions is compatible with NextResponse cookies, but we keep it loose
  options?: Record<string, unknown>
}

type SessionPayload = {
  user: unknown
  cookies: SessionCookie[]
}

async function fetchSession(request: NextRequest): Promise<SessionPayload> {
  const sessionUrl = new URL('/api/auth/session', request.nextUrl.origin)

  try {
    const sessionResponse = await fetch(sessionUrl.toString(), {
      headers: { cookie: request.headers.get('cookie') ?? '' },
      cache: 'no-store',
    })

    if (!sessionResponse.ok) {
      return { user: null, cookies: [] }
    }

    const data = (await sessionResponse.json()) as Partial<SessionPayload>

    return {
      user: data?.user ?? null,
      cookies: Array.isArray(data?.cookies) ? data.cookies : [],
    }
  } catch {
    return { user: null, cookies: [] }
  }
}

function applySessionCookies(response: NextResponse, cookies: SessionCookie[]) {
  cookies.forEach(({ name, value, options }) => {
    response.cookies.set({ name, value, ...(options ?? {}) })
  })
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

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || ''
  if (isVipHost(hostname)) {
    return NextResponse.next()
  }

  if (isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.next()
  }

  const { user, cookies } = await fetchSession(request)
  const response = NextResponse.next()
  applySessionCookies(response, cookies)

  if (!user) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/auth/login'
    redirectUrl.searchParams.set('redirectedFrom', sanitizeRedirectTarget(request.nextUrl))

    const redirectResponse = NextResponse.redirect(redirectUrl)
    
    applySessionCookies(redirectResponse, cookies)

    return redirectResponse
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
