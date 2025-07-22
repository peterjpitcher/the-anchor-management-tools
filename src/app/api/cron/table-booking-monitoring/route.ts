import { NextResponse } from 'next/server';
import { 
  performHealthCheck, 
  sendAlertNotification, 
  monitorBookingPatterns,
  generateDailySummary 
} from '@/lib/monitoring/table-bookings-monitor';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    // Verify the request is from a trusted source (e.g., Vercel Cron)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    // In production, require authentication
    if (process.env.NODE_ENV === 'production' && (!cronSecret || authHeader !== `Bearer ${cronSecret}`)) {
      console.log('Unauthorized request - invalid CRON_SECRET');
      return new NextResponse('Unauthorized', { status: 401 });
    }

    console.log('Starting table booking monitoring...');

    // 1. Perform health check
    const healthCheck = await performHealthCheck();
    console.log('Health check completed:', healthCheck.healthy ? 'HEALTHY' : 'UNHEALTHY');

    // 2. Send alerts for any critical issues
    const criticalAlerts = healthCheck.alerts.filter(a => a.type === 'error');
    for (const alert of criticalAlerts) {
      console.log('Sending critical alert:', alert.title);
      await sendAlertNotification(alert);
    }

    // 3. Monitor for unusual patterns
    const patternAlerts = await monitorBookingPatterns();
    for (const alert of patternAlerts) {
      console.log('Pattern alert:', alert.title);
      await sendAlertNotification(alert);
    }

    // 4. Generate daily summary (only at specific times)
    const currentHour = new Date().getHours();
    let dailySummary = null;
    
    if (currentHour === 22) { // 10 PM
      console.log('Generating daily summary...');
      dailySummary = await generateDailySummary();
    }

    console.log('Table booking monitoring completed');

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      health: {
        status: healthCheck.healthy ? 'healthy' : 'unhealthy',
        metrics: healthCheck.metrics,
        alertCount: healthCheck.alerts.length,
      },
      patternAlerts: patternAlerts.length,
      dailySummary: dailySummary,
    }, { status: 200 });
  } catch (error) {
    console.error('Error in table booking monitoring:', error);
    return new NextResponse(
      `Internal Server Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { status: 500 }
    );
  }
}