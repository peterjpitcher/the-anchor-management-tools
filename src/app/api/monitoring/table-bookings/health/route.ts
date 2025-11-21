import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { performHealthCheck, sendAlertNotification } from '@/lib/monitoring/table-bookings-monitor';
import { verifyApiKey } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  try {
    // Optional API key for external monitoring services
    const apiKey = request.headers.get('x-api-key');
    let isAuthenticated = false;

    if (apiKey) {
      const { valid } = await verifyApiKey(apiKey, 'read:monitoring');
      if (valid) {
        isAuthenticated = true;
      } else if (process.env.NODE_ENV === 'production') {
        // Only strictly enforce API key validity in production if provided
        // In dev, we might fall through to session auth
      }
    }

    // If not authenticated via API key, check user session
    if (!isAuthenticated) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        return NextResponse.json(
          { error: 'Authentication required' },
          { status: 401 }
        );
      }

      const { checkUserPermission } = await import('@/app/actions/rbac');
      const hasPermission = await checkUserPermission('table_bookings', 'manage', user.id);

      if (!hasPermission) {
        return NextResponse.json(
          { error: 'Insufficient permissions' },
          { status: 403 }
        );
      }
    }

    // Perform health check
    const healthCheck = await performHealthCheck();

    // Send alerts for critical issues
    const criticalAlerts = healthCheck.alerts.filter(a => a.type === 'error');
    for (const alert of criticalAlerts) {
      await sendAlertNotification(alert);
    }

    // Return health check results
    return NextResponse.json(
      {
        status: healthCheck.healthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        checks: healthCheck.checks,
        metrics: healthCheck.metrics,
        alerts: healthCheck.alerts,
      },
      { 
        status: healthCheck.healthy ? 200 : 503,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        }
      }
    );
  } catch (error) {
    console.error('Health check error:', error);
    return NextResponse.json(
      {
        status: 'error',
        message: 'Health check failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}