import { createClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/emailService';
import { sendDailyTableBookingSummary, getLondonDateString, TableBookingNotificationRecord } from '@/lib/table-bookings/managerNotifications';

interface MonitoringAlert {
  type: 'error' | 'warning' | 'info';
  title: string;
  message: string;
  details?: any;
  timestamp: Date;
}

interface HealthCheckResult {
  healthy: boolean;
  checks: {
    database: boolean;
    bookingCreation: boolean;
    paymentProcessing: boolean;
    smsDelivery: boolean;
    emailDelivery: boolean;
  };
  metrics: {
    todayBookings: number;
    pendingPayments: number;
    failedSms: number;
    avgResponseTime: number;
  };
  alerts: MonitoringAlert[];
}

/**
 * Comprehensive health check for table booking system
 */
export async function performHealthCheck(): Promise<HealthCheckResult> {
  const alerts: MonitoringAlert[] = [];
  const checks = {
    database: false,
    bookingCreation: false,
    paymentProcessing: false,
    smsDelivery: false,
    emailDelivery: false,
  };
  const metrics = {
    todayBookings: 0,
    pendingPayments: 0,
    failedSms: 0,
    avgResponseTime: 0,
  };

  try {
    const supabase = await createClient();
    const startTime = Date.now();

    // 1. Database connectivity check
    try {
      const { count } = await supabase
        .from('table_bookings')
        .select('*', { count: 'exact', head: true });
      
      checks.database = true;
    } catch (error) {
      alerts.push({
        type: 'error',
        title: 'Database Connection Failed',
        message: 'Unable to connect to table_bookings table',
        details: error,
        timestamp: new Date(),
      });
    }

    // 2. Check today's bookings
    const today = new Date().toISOString().split('T')[0];
    const { data: todayBookings, error: bookingsError } = await supabase
      .from('table_bookings')
      .select('*')
      .eq('booking_date', today)
      .in('status', ['confirmed', 'pending_payment']);

    if (!bookingsError) {
      metrics.todayBookings = todayBookings?.length || 0;
      checks.bookingCreation = true;
    }

    // 3. Check pending payments older than 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: pendingPayments } = await supabase
      .from('table_bookings')
      .select('*')
      .eq('status', 'pending_payment')
      .lt('created_at', oneHourAgo);

    metrics.pendingPayments = pendingPayments?.length || 0;
    
    if (metrics.pendingPayments > 5) {
      alerts.push({
        type: 'warning',
        title: 'High Pending Payments',
        message: `${metrics.pendingPayments} bookings waiting for payment over 1 hour`,
        timestamp: new Date(),
      });
    }

    // 4. Check SMS delivery health
    const { data: failedSms } = await supabase
      .from('jobs')
      .select('*')
      .eq('type', 'send_sms')
      .eq('status', 'failed')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    metrics.failedSms = failedSms?.length || 0;
    checks.smsDelivery = metrics.failedSms < 10;

    if (metrics.failedSms >= 10) {
      alerts.push({
        type: 'error',
        title: 'SMS Delivery Issues',
        message: `${metrics.failedSms} SMS failures in last 24 hours`,
        timestamp: new Date(),
      });
    }

    // 5. Check payment processing
    const { data: recentPayments } = await supabase
      .from('table_booking_payments')
      .select('*')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .limit(1);

    checks.paymentProcessing = (recentPayments?.length || 0) > 0 || metrics.todayBookings === 0;

    // 6. Check email delivery (basic check)
    checks.emailDelivery = true; // Assume healthy unless we implement detailed tracking

    // 7. Calculate average response time
    metrics.avgResponseTime = Date.now() - startTime;

    if (metrics.avgResponseTime > 5000) {
      alerts.push({
        type: 'warning',
        title: 'Slow Response Time',
        message: `Health check took ${metrics.avgResponseTime}ms`,
        timestamp: new Date(),
      });
    }

    // 8. Check for no bookings (potential issue)
    if (metrics.todayBookings === 0 && new Date().getHours() > 14) {
      alerts.push({
        type: 'warning',
        title: 'No Bookings Today',
        message: 'No bookings recorded for today - this may indicate an issue',
        timestamp: new Date(),
      });
    }

    // Determine overall health
    const healthy = Object.values(checks).every(check => check) && alerts.filter(a => a.type === 'error').length === 0;

    return {
      healthy,
      checks,
      metrics,
      alerts,
    };
  } catch (error) {
    return {
      healthy: false,
      checks,
      metrics,
      alerts: [{
        type: 'error',
        title: 'Health Check Failed',
        message: 'Unable to complete health check',
        details: error,
        timestamp: new Date(),
      }],
    };
  }
}

/**
 * Send alert notifications
 */
export async function sendAlertNotification(alert: MonitoringAlert) {
  const notificationEmail = process.env.ALERT_NOTIFICATION_EMAIL;
  
  if (!notificationEmail) {
    console.error('ALERT_NOTIFICATION_EMAIL not configured');
    return;
  }

  const html = `
    <h2>Table Booking System Alert</h2>
    <p><strong>Type:</strong> ${alert.type.toUpperCase()}</p>
    <p><strong>Title:</strong> ${alert.title}</p>
    <p><strong>Message:</strong> ${alert.message}</p>
    <p><strong>Time:</strong> ${alert.timestamp.toISOString()}</p>
    ${alert.details ? `<pre>${JSON.stringify(alert.details, null, 2)}</pre>` : ''}
  `;

  await sendEmail({
    to: notificationEmail,
    subject: `[${alert.type.toUpperCase()}] Table Booking: ${alert.title}`,
    html,
  });
}

/**
 * Monitor booking patterns for anomalies
 */
export async function monitorBookingPatterns() {
  const supabase = await createClient();
  const alerts: MonitoringAlert[] = [];

  // Check for duplicate bookings
  const { data: duplicates } = await supabase.rpc('find_duplicate_bookings', {
    time_window: 60, // 60 minutes
  });

  if (duplicates && duplicates.length > 0) {
    alerts.push({
      type: 'warning',
      title: 'Potential Duplicate Bookings',
      message: `Found ${duplicates.length} potential duplicate bookings`,
      details: duplicates,
      timestamp: new Date(),
    });
  }

  // Check for unusual booking patterns (e.g., too many from same IP)
  const { data: recentBookings } = await supabase
    .from('audit_logs')
    .select('metadata')
    .eq('entity_type', 'table_booking')
    .eq('action', 'create')
    .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());

  if (recentBookings) {
    // Group by IP address
    const ipCounts = recentBookings.reduce((acc: any, log) => {
      const ip = log.metadata?.ip_address;
      if (ip) {
        acc[ip] = (acc[ip] || 0) + 1;
      }
      return acc;
    }, {});

    // Find IPs with more than 5 bookings
    const suspiciousIps = Object.entries(ipCounts)
      .filter(([_, count]) => (count as number) > 5)
      .map(([ip, count]) => ({ ip, count }));

    if (suspiciousIps.length > 0) {
      alerts.push({
        type: 'warning',
        title: 'Suspicious Booking Activity',
        message: 'Multiple bookings from same IP address',
        details: suspiciousIps,
        timestamp: new Date(),
      });
    }
  }

  return alerts;
}

/**
 * Generate daily summary report
 */
export async function generateDailySummary() {
  const supabase = await createClient();
  const today = getLondonDateString();

  const { data: bookings } = await supabase
    .from('table_bookings')
    .select(`
      id,
      booking_reference,
      booking_date,
      booking_time,
      party_size,
      status,
      booking_type,
      source,
      special_requirements,
      dietary_requirements,
      allergies,
      created_at,
      table_booking_payments(amount, status),
      customer:customers(first_name, last_name, mobile_number, email)
    `)
    .eq('booking_date', today);

  const stats = {
    totalBookings: bookings?.length || 0,
    confirmedBookings: bookings?.filter(b => b.status === 'confirmed').length || 0,
    cancelledBookings: bookings?.filter(b => b.status === 'cancelled').length || 0,
    noShows: bookings?.filter(b => b.status === 'no_show').length || 0,
    totalCovers: bookings?.reduce((sum, b) => sum + b.party_size, 0) || 0,
    revenue: bookings?.reduce((sum, b) => {
      const payment = b.table_booking_payments?.find((p: any) => p.status === 'completed');
      return sum + (payment?.amount || 0);
    }, 0) || 0,
  };

  if (bookings && bookings.length > 0) {
    const summaryBookings: TableBookingNotificationRecord[] = bookings.map(({ table_booking_payments: _payments, ...rest }) => rest as unknown as TableBookingNotificationRecord)
    await sendDailyTableBookingSummary(today, summaryBookings);
  }

  return stats;
}
