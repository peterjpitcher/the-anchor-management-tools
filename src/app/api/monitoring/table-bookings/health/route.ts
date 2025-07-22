import { NextRequest, NextResponse } from 'next/server';
import { performHealthCheck, sendAlertNotification } from '@/lib/monitoring/table-bookings-monitor';
import { verifyApiKey } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  try {
    // Optional API key for external monitoring services
    const apiKey = request.headers.get('x-api-key');
    if (apiKey) {
      const { valid } = await verifyApiKey(apiKey, 'read:monitoring');
      if (!valid && process.env.NODE_ENV === 'production') {
        return NextResponse.json(
          { error: 'Invalid API key' },
          { status: 401 }
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