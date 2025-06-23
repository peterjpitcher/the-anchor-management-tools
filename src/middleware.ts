import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Cache for session checks (5 minute TTL)
const sessionCache = new Map<string, { session: any, timestamp: number }>()
const SESSION_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  // Skip middleware for static assets and API routes
  const path = request.nextUrl.pathname
  if (
    path.startsWith('/_next') ||
    path.startsWith('/api') ||
    path.startsWith('/static') ||
    path.includes('.')
  ) {
    return response
  }

  // Only check auth for protected routes
  const isProtectedRoute = path.startsWith('/') && 
    !path.startsWith('/login') && 
    !path.startsWith('/error') &&
    !path.startsWith('/privacy')

  if (!isProtectedRoute) {
    return response
  }

  // Get session from cookies
  const cookieStore = request.cookies
  const sessionCookie = cookieStore.get('sb-auth-token')
  
  if (!sessionCookie) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Check cache first
  const cacheKey = sessionCookie.value
  const cached = sessionCache.get(cacheKey)
  
  if (cached && Date.now() - cached.timestamp < SESSION_CACHE_TTL) {
    // Use cached session - no database call!
    if (!cached.session) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
    return response
  }

  // Only create Supabase client if not in cache
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set({
            name,
            value,
            ...options,
          })
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set({
            name,
            value: '',
            ...options,
          })
        },
      },
    }
  )

  const { data: { session } } = await supabase.auth.getSession()
  
  // Cache the result
  sessionCache.set(cacheKey, { session, timestamp: Date.now() })
  
  // Clean old cache entries periodically
  if (sessionCache.size > 100) {
    const now = Date.now()
    for (const [key, value] of sessionCache.entries()) {
      if (now - value.timestamp > SESSION_CACHE_TTL) {
        sessionCache.delete(key)
      }
    }
  }

  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Skip permission checks in middleware - move to page level
  // This saves another database query

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
}