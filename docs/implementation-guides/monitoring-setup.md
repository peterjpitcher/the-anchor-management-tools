# Monitoring Setup Guide

This guide provides step-by-step instructions for implementing production monitoring based on the critical audit findings.

## 🎯 Overview

**Time Required**: 2-4 hours  
**Priority**: CRITICAL  
**Prerequisite**: Admin access to production environment

## 📊 Monitoring Stack

We'll implement a comprehensive monitoring solution using:
- **Sentry** - Error tracking and performance monitoring
- **Vercel Analytics** - Web vitals and performance metrics
- **Custom Logging** - Structured logs with pino
- **Health Checks** - Uptime monitoring

## Step 1: Sentry Setup (1 hour)

### 1.1 Create Sentry Account

1. Go to [sentry.io](https://sentry.io)
2. Sign up for free account (50k events/month free)
3. Create organization: "the-anchor"
4. Create project: "management-tools" (Next.js)

### 1.2 Install Sentry

```bash
npm install --save @sentry/nextjs
```

### 1.3 Run Setup Wizard

```bash
npx @sentry/wizard@latest -i nextjs
```

This will:
- Create `sentry.client.config.ts`
- Create `sentry.server.config.ts`
- Create `sentry.edge.config.ts`
- Update `next.config.js`
- Add environment variables to `.env.local`

### 1.4 Configure Sentry

Update `sentry.client.config.ts`:
```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  
  // Performance Monitoring
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  
  // Session Replay
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  
  // Release tracking
  environment: process.env.NODE_ENV,
  
  // Integrations
  integrations: [
    new Sentry.BrowserTracing({
      // Navigation transactions
      routingInstrumentation: Sentry.nextRouterInstrumentation,
    }),
    new Sentry.Replay({
      // Mask sensitive data
      maskAllText: false,
      maskAllInputs: true,
      blockAllMedia: false,
    }),
  ],
  
  // Filtering
  beforeSend(event, hint) {
    // Filter out non-critical errors
    if (event.exception?.values?.[0]?.value?.includes('ResizeObserver')) {
      return null;
    }
    return event;
  },
});
```

### 1.5 Add Error Boundary

Create `app/global-error.tsx`:
```typescript
'use client';

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-2xl font-bold mb-4">Something went wrong!</h2>
            <p className="text-gray-600 mb-4">
              We've been notified and are looking into it.
            </p>
            <button
              onClick={reset}
              className="bg-blue-500 text-white px-4 py-2 rounded"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
```

### 1.6 Add User Context

In your authentication handler:
```typescript
import * as Sentry from "@sentry/nextjs";

// After successful login
Sentry.setUser({
  id: user.id,
  email: user.email,
  username: user.name,
});

// On logout
Sentry.setUser(null);
```

### 1.7 Track Custom Events

For business-critical operations:
```typescript
// Track SMS sending
Sentry.addBreadcrumb({
  message: 'SMS sent',
  category: 'sms',
  level: 'info',
  data: {
    recipient: phoneNumber,
    template: templateName,
  },
});

// Track failed operations
Sentry.captureMessage('SMS delivery failed', {
  level: 'error',
  tags: {
    feature: 'sms',
    customer_id: customerId,
  },
  extra: {
    error: twilioError,
    attempts: retryCount,
  },
});
```

## Step 2: Vercel Analytics (30 minutes)

### 2.1 Enable Analytics

1. Go to Vercel Dashboard
2. Select your project
3. Go to Analytics tab
4. Click "Enable Analytics"

### 2.2 Install Package

```bash
npm install @vercel/analytics
```

### 2.3 Add to Layout

Update `app/layout.tsx`:
```typescript
import { Analytics } from '@vercel/analytics/react';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
```

### 2.4 Track Custom Events

```typescript
import { track } from '@vercel/analytics';

// Track conversions
track('booking_completed', {
  customer_id: customerId,
  event_id: eventId,
  revenue: bookingTotal,
});

// Track feature usage
track('bulk_sms_sent', {
  recipient_count: recipients.length,
  template: templateName,
});
```

## Step 3: Structured Logging (1 hour)

### 3.1 Install Pino

```bash
npm install pino pino-pretty
```

### 3.2 Create Logger Utility

Create `src/lib/logger.ts`:
```typescript
import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: !isProduction
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          ignore: 'pid,hostname',
          translateTime: 'SYS:standard',
        },
      }
    : undefined,
  base: {
    env: process.env.NODE_ENV,
    revision: process.env.VERCEL_GIT_COMMIT_SHA,
  },
  redact: {
    paths: ['req.headers.authorization', '*.password', '*.mobile_number'],
    remove: true,
  },
});

// Create child loggers for different modules
export const dbLogger = logger.child({ module: 'database' });
export const smsLogger = logger.child({ module: 'sms' });
export const authLogger = logger.child({ module: 'auth' });
export const apiLogger = logger.child({ module: 'api' });
```

### 3.3 Replace console.log

Before:
```typescript
console.log('SMS sent successfully', { to: phoneNumber });
console.error('Failed to send SMS', error);
```

After:
```typescript
import { smsLogger } from '@/lib/logger';

smsLogger.info({ to: phoneNumber }, 'SMS sent successfully');
smsLogger.error({ error, to: phoneNumber }, 'Failed to send SMS');
```

### 3.4 Add Request Logging

Create middleware for API routes:
```typescript
// src/lib/api-logger.ts
import { logger } from './logger';
import { NextRequest, NextResponse } from 'next/server';

export function withLogging(
  handler: (req: NextRequest) => Promise<NextResponse>
) {
  return async (req: NextRequest) => {
    const start = Date.now();
    const requestId = crypto.randomUUID();
    
    logger.info({
      requestId,
      method: req.method,
      url: req.url,
      userAgent: req.headers.get('user-agent'),
    }, 'API request started');
    
    try {
      const response = await handler(req);
      
      logger.info({
        requestId,
        statusCode: response.status,
        duration: Date.now() - start,
      }, 'API request completed');
      
      return response;
    } catch (error) {
      logger.error({
        requestId,
        error,
        duration: Date.now() - start,
      }, 'API request failed');
      
      throw error;
    }
  };
}
```

## Step 4: Health Checks (30 minutes)

### 4.1 Create Health Check Endpoint

Create `app/api/health/route.ts`:
```typescript
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

export async function GET() {
  const checks = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.VERCEL_GIT_COMMIT_SHA || 'unknown',
    checks: {
      database: 'pending',
      auth: 'pending',
      storage: 'pending',
      twilio: 'pending',
    },
  };

  try {
    // Database check
    const supabase = createClient();
    const { error: dbError } = await supabase
      .from('customers')
      .select('count')
      .limit(1)
      .single();
    
    checks.checks.database = dbError ? 'unhealthy' : 'healthy';
    
    // Auth check
    const { data: { user }, error: authError } = 
      await supabase.auth.getUser();
    checks.checks.auth = authError ? 'unhealthy' : 'healthy';
    
    // Storage check
    const { error: storageError } = await supabase
      .storage
      .from('employee-documents')
      .list('', { limit: 1 });
    checks.checks.storage = storageError ? 'unhealthy' : 'healthy';
    
    // Twilio check (if configured)
    if (process.env.TWILIO_ACCOUNT_SID) {
      // Simple check - just verify env vars exist
      checks.checks.twilio = 'healthy';
    } else {
      checks.checks.twilio = 'not_configured';
    }
    
    // Overall status
    const hasUnhealthy = Object.values(checks.checks)
      .some(status => status === 'unhealthy');
    
    if (hasUnhealthy) {
      checks.status = 'unhealthy';
      logger.error({ checks }, 'Health check failed');
      return NextResponse.json(checks, { status: 503 });
    }
    
    return NextResponse.json(checks);
  } catch (error) {
    logger.error({ error }, 'Health check error');
    checks.status = 'error';
    return NextResponse.json(checks, { status: 503 });
  }
}
```

### 4.2 Create Monitoring Dashboard

Create `app/(authenticated)/admin/monitoring/page.tsx`:
```typescript
'use client';

import { useEffect, useState } from 'react';
import { Card, Title, BarChart, DonutChart } from '@tremor/react';

export default function MonitoringDashboard() {
  const [health, setHealth] = useState(null);
  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    // Fetch health status
    fetch('/api/health')
      .then(res => res.json())
      .then(setHealth);
    
    // Fetch metrics (from your API)
    fetch('/api/metrics')
      .then(res => res.json())
      .then(setMetrics);
  }, []);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">System Monitoring</h1>
      
      {/* Health Status */}
      <Card>
        <Title>System Health</Title>
        <div className="grid grid-cols-4 gap-4 mt-4">
          {health?.checks && Object.entries(health.checks).map(([service, status]) => (
            <div key={service} className="text-center">
              <div className={`inline-flex h-4 w-4 rounded-full ${
                status === 'healthy' ? 'bg-green-500' : 'bg-red-500'
              }`} />
              <p className="mt-2 text-sm font-medium capitalize">{service}</p>
            </div>
          ))}
        </div>
      </Card>
      
      {/* Metrics */}
      {metrics && (
        <>
          <Card>
            <Title>SMS Delivery Rate (Last 7 Days)</Title>
            <BarChart
              data={metrics.smsDelivery}
              index="date"
              categories={["Sent", "Delivered", "Failed"]}
              colors={["blue", "green", "red"]}
              yAxisWidth={48}
            />
          </Card>
          
          <Card>
            <Title>API Response Times</Title>
            <DonutChart
              data={metrics.apiPerformance}
              category="count"
              index="range"
              colors={["green", "yellow", "red"]}
            />
          </Card>
        </>
      )}
    </div>
  );
}
```

## Step 5: Alerting Setup

### 5.1 Sentry Alerts

1. Go to Sentry → Alerts
2. Create alert rules:
   - **Error Rate**: > 10 errors/hour
   - **Crash Free Rate**: < 99%
   - **Transaction Duration**: p95 > 3s
   - **Failed SMS**: Custom error tag

### 5.2 Uptime Monitoring

1. Use [UptimeRobot](https://uptimerobot.com) (free)
2. Monitor `/api/health` endpoint
3. Check every 5 minutes
4. Alert on 2 consecutive failures

### 5.3 Create Alert Channels

Set up notifications to:
- Email: dev-team@theanchor.co.uk
- Slack: #production-alerts
- SMS: On-call phone (for critical only)

## Step 6: Testing

### 6.1 Test Error Tracking

Add temporary test button:
```typescript
<button
  onClick={() => {
    throw new Error('Test Sentry Integration');
  }}
  className="bg-red-500 text-white px-4 py-2 rounded"
>
  Test Error Tracking
</button>
```

### 6.2 Verify in Dashboards

1. Trigger test error
2. Check Sentry dashboard (should appear within 30s)
3. Check Vercel Analytics
4. Verify health endpoint: `curl https://your-app.vercel.app/api/health`

### 6.3 Load Testing

```bash
# Install artillery
npm install -g artillery

# Create test script
cat > load-test.yml << EOF
config:
  target: 'https://your-app.vercel.app'
  phases:
    - duration: 60
      arrivalRate: 10
scenarios:
  - name: "Health Check"
    flow:
      - get:
          url: "/api/health"
EOF

# Run load test
artillery run load-test.yml
```

## Monitoring Checklist

- [ ] Sentry account created
- [ ] Sentry SDK installed and configured
- [ ] Error boundary implemented
- [ ] User context tracking added
- [ ] Vercel Analytics enabled
- [ ] Custom events tracked
- [ ] Structured logging implemented
- [ ] Console.log replaced with logger
- [ ] Health check endpoint created
- [ ] Monitoring dashboard built
- [ ] Alerts configured
- [ ] Uptime monitoring active
- [ ] Team notifications setup
- [ ] Load tested successfully

## Next Steps

With monitoring in place, you can now:
1. See all production errors in real-time
2. Track performance metrics
3. Get alerted to issues before users complain
4. Debug problems with session replay
5. Make data-driven optimization decisions

Remember to:
- Review Sentry issues daily
- Set up weekly performance reviews
- Keep error rate below 1%
- Maintain 99.9% uptime target