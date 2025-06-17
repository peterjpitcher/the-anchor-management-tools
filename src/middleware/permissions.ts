import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/middleware';

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

export async function checkRoutePermission(request: NextRequest) {
  const { supabase } = createClient(request);
  const pathname = request.nextUrl.pathname;
  
  // Find the matching route pattern
  let requiredPermission = null;
  for (const [route, permission] of Object.entries(routePermissions)) {
    if (pathname.startsWith(route)) {
      requiredPermission = permission;
      break;
    }
  }
  
  // If no permission required for this route, allow access
  if (!requiredPermission) {
    return NextResponse.next();
  }
  
  // Get the current user
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }
  
  // Check if user has the required permission
  const { data: hasPermission } = await supabase
    .rpc('user_has_permission', {
      p_user_id: user.id,
      p_module_name: requiredPermission.module,
      p_action: requiredPermission.action
    });
  
  if (!hasPermission) {
    // Redirect to an unauthorized page or dashboard
    return NextResponse.redirect(new URL('/unauthorized', request.url));
  }
  
  return NextResponse.next();
}