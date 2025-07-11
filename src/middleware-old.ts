import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { rateLimiters } from '@/lib/rate-limit'

// Map routes to required permissions
const routePermissions: Record<string, { module: string; action: string }> = {
  '/dashboard': { module: 'dashboard', action: 'view' },
  '/events': { module: 'events', action: 'view' },
  '/events/new': { module: 'events', action: 'create' },
  '/customers': { module: 'customers', action: 'view' },
  '/customers/new': { module: 'customers', action: 'create' },
  '/employees': { module: 'employees', action: 'view' },
  '/employees/new': { module: 'employees', action: 'create' },
  '/bookings': { module: 'bookings', action: 'view' },
  '/bookings/new': { module: 'bookings', action: 'create' },
  '/private-bookings': { module: 'private_bookings', action: 'view' },
  '/private-bookings/new': { module: 'private_bookings', action: 'create' },
  '/messages': { module: 'messages', action: 'view' },
  '/messages/templates': { module: 'messages', action: 'view_templates' },
  '/sms-health': { module: 'sms_health', action: 'view' },
  '/settings': { module: 'settings', action: 'view' },
  '/reports': { module: 'reports', action: 'view' },
  '/users': { module: 'users', action: 'view' },
  '/roles': { module: 'roles', action: 'view' },
};

export async function middleware(request: NextRequest) {
  // Apply rate limiting to API and auth routes
  if (request.nextUrl.pathname.startsWith('/api/') || 
      request.nextUrl.pathname.startsWith('/auth/')) {
    
    // Cron endpoints should only be called by Vercel
    if (request.nextUrl.pathname.startsWith('/api/cron/')) {
      const cronSecret = request.headers.get('x-cron-secret')
      if (cronSecret !== process.env.CRON_SECRET) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        )
      }
      // Skip rate limiting for valid cron requests
      return NextResponse.next()
    }

    // Select appropriate rate limiter
    let limiter = rateLimiters.api

    // Auth endpoints get strict limits
    if (request.nextUrl.pathname.startsWith('/auth/')) {
      limiter = rateLimiters.auth
    }
    // SMS endpoints get stricter limits
    else if (request.nextUrl.pathname.includes('/sms') || 
        request.nextUrl.pathname.includes('/message')) {
      limiter = rateLimiters.sms
    }
    // Bulk operations get special limits
    else if (request.nextUrl.pathname.includes('/bulk')) {
      limiter = rateLimiters.bulk
    }
    // Webhook endpoints get higher limits
    else if (request.nextUrl.pathname.startsWith('/api/webhooks/')) {
      limiter = rateLimiters.webhook
    }

    // Apply rate limiting (skip if disabled via environment variable)
    if (process.env.DISABLE_RATE_LIMITING !== 'true') {
      const rateLimitResponse = await limiter(request)
      if (rateLimitResponse) {
        return rateLimitResponse
      }
    }
  }

  const res = NextResponse.next()
  
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

  // Refresh session if expired - required for Server Components
  const { data: { session } } = await supabase.auth.getSession()

  // If no session and trying to access protected route, redirect to login
  if (!session && !request.nextUrl.pathname.startsWith('/auth')) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/auth/login'
    redirectUrl.searchParams.set('redirectedFrom', request.nextUrl.pathname)
    return NextResponse.redirect(redirectUrl)
  }

  // If has session and trying to access auth pages, redirect to dashboard
  if (session && request.nextUrl.pathname.startsWith('/auth')) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/dashboard'
    return NextResponse.redirect(redirectUrl)
  }

  // Check permissions for authenticated users
  if (session && !request.nextUrl.pathname.startsWith('/auth')) {
    const pathname = request.nextUrl.pathname;
    
    // Find the matching route pattern
    let requiredPermission = null;
    for (const [route, permission] of Object.entries(routePermissions)) {
      if (pathname.startsWith(route)) {
        requiredPermission = permission;
        break;
      }
    }
    
    // If permission is required for this route, check it
    if (requiredPermission) {
      const { data: hasPermission } = await supabase
        .rpc('user_has_permission', {
          p_user_id: session.user.id,
          p_module_name: requiredPermission.module,
          p_action: requiredPermission.action
        });
      
      if (!hasPermission) {
        // Redirect to unauthorized page
        const redirectUrl = request.nextUrl.clone()
        redirectUrl.pathname = '/unauthorized'
        return NextResponse.redirect(redirectUrl)
      }
    }
  }

  return res
}

export const config = {
  matcher: [
    // API routes (for rate limiting)
    '/api/:path*',
    // Protected routes that require authentication
    '/dashboard/:path*',
    '/events/:path*',
    '/bookings/:path*',
    '/private-bookings/:path*',
    '/customers/:path*',
    '/employees/:path*',
    '/messages/:path*',
    '/sms-health/:path*',
    '/settings/:path*',
    '/reports/:path*',
    '/users/:path*',
    '/roles/:path*',
    // Auth routes
    '/auth/:path*',
    // Unauthorized page
    '/unauthorized',
  ],
} 