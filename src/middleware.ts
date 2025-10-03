import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname
  const hostname = request.headers.get('host') || ''
  
  // Bypass auth for short-link host so Vercel rewrite to /api/redirect works
  // Without this, requests like https://vip-club.uk/ABC hit middleware on 
  // the original path ("/ABC") and get redirected to login before the rewrite
  if (hostname.includes('vip-club.uk')) {
    return NextResponse.next()
  }
  
  // Skip middleware for:
  // - Static assets
  // - API routes (especially webhooks)
  // - Auth pages
  // - Public pages
  // - Loyalty demo pages
  // - Booking confirmation pages (public access for customers)
  // - Table booking payment pages (public access for customers)
  if (
    path.startsWith('/_next') ||
    path.startsWith('/static') ||
    path.includes('.') ||
    path.startsWith('/api') || // Allow ALL API routes without auth check
    path.startsWith('/auth') ||
    path.startsWith('/error') ||
    path.startsWith('/privacy') ||
    // path.startsWith('/loyalty') || // Loyalty removed
    path.startsWith('/booking-confirmation') || // Allow public booking confirmation
    path.startsWith('/booking-success') || // Allow public booking success page
    path.startsWith('/table-booking') || // Allow public table booking pages
    path.startsWith('/parking/guest') // Allow public parking guest confirmation pages
  ) {
    return NextResponse.next()
  }

  const hasSupabaseSession = request.cookies.getAll().some((cookie) =>
    cookie.name.startsWith('sb-') && cookie.name.endsWith('-auth-token') && cookie.value
  )

  if (!hasSupabaseSession) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/auth/login'
    redirectUrl.searchParams.set('redirectedFrom', request.nextUrl.pathname)
    return NextResponse.redirect(redirectUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - api (ALL API routes should bypass auth middleware)
     * - auth (authentication pages)
     * - privacy (public pages)
     * - loyalty (removed)
     * - booking-confirmation (public booking confirmation pages)
     * - booking-success (public booking success pages)
     * - table-booking (public table booking pages)
     */
    '/((?!_next/static|_next/image|favicon.ico|api|auth|privacy|booking-confirmation|booking-success|table-booking|parking/guest).*)',
  ],
}
