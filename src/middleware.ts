import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

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
  '/messages': { module: 'messages', action: 'view' },
  '/messages/templates': { module: 'messages', action: 'view_templates' },
  '/sms-health': { module: 'sms_health', action: 'view' },
  '/settings': { module: 'settings', action: 'view' },
  '/reports': { module: 'reports', action: 'view' },
  '/users': { module: 'users', action: 'view' },
  '/roles': { module: 'roles', action: 'view' },
};

export async function middleware(request: NextRequest) {
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req: request, res })

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
    // Protected routes that require authentication
    '/dashboard/:path*',
    '/events/:path*',
    '/bookings/:path*',
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