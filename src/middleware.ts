import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  // Skip middleware for static assets
  const path = request.nextUrl.pathname
  if (
    path.startsWith('/_next') ||
    path.startsWith('/static') ||
    path.includes('.') ||
    path.startsWith('/api/webhooks') // Allow webhooks without auth
  ) {
    return NextResponse.next()
  }

  // Create response that we can modify
  const res = NextResponse.next()

  // Only check auth for protected routes
  const isProtectedRoute = !path.startsWith('/auth') && 
    !path.startsWith('/error') &&
    !path.startsWith('/privacy') &&
    !path.startsWith('/api')

  if (!isProtectedRoute) {
    return res
  }

  // Create Supabase client with proper cookie handling
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Get the session
  const { data: { session } } = await supabase.auth.getSession()

  // If no session and trying to access protected route, redirect to login
  if (!session) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/auth/login'
    redirectUrl.searchParams.set('redirectedFrom', request.nextUrl.pathname)
    return NextResponse.redirect(redirectUrl)
  }

  return res
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - auth (authentication pages)
     * - api/webhooks (webhook endpoints)
     */
    '/((?!_next/static|_next/image|favicon.ico|auth|api/webhooks).*)',
  ],
}