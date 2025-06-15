# Monitoring Guide

This guide covers monitoring strategies, tools, and best practices for maintaining The Anchor Management Tools in production.

## Monitoring Overview

Effective monitoring ensures:
- High availability and performance
- Early problem detection
- Data-driven optimization
- Compliance and auditing
- User experience insights

## Available Monitoring Tools

### Vercel Analytics
Built-in analytics for Next.js applications:
- Real User Monitoring (RUM)
- Web Vitals tracking
- Performance metrics
- Error tracking
- Function execution logs

**Setup:**
1. Enable in Vercel Dashboard
2. Add to project settings
3. Review metrics regularly

### Supabase Dashboard
Comprehensive database and service monitoring:
- Query performance
- Storage usage
- Authentication metrics
- API request logs
- Database connections

**Key Metrics:**
- Active connections
- Query execution time
- Storage growth rate
- Auth success/failure rates

### Twilio Console
SMS delivery and communication metrics:
- Message delivery status
- Error rates
- Cost tracking
- Phone number health
- Geographic distribution

### GitHub Actions
Workflow execution monitoring:
- Cron job success/failure
- Execution duration
- Error logs
- Trigger history

## Key Metrics to Monitor

### Application Performance

**Response Times**
- Page load time (target: <3s)
- API response time (target: <500ms)
- Database query time (target: <100ms)
- Function execution time

**Error Rates**
- 4xx errors (client errors)
- 5xx errors (server errors)
- JavaScript errors
- Failed API calls

**Traffic Patterns**
- Daily active users
- Peak usage times
- Page views
- User flow

### Database Metrics

**Performance**
- Query execution time
- Slow query log
- Index usage
- Connection pool utilization

**Storage**
- Database size growth
- File storage usage
- Backup size
- Table row counts

**Health**
- Connection count
- Failed queries
- Deadlocks
- Replication lag

### SMS Metrics

**Delivery**
- Success rate (target: >95%)
- Delivery time
- Failed messages
- Retry attempts

**Cost**
- Messages per day
- Cost per message
- Monthly spend
- Geographic distribution

### Security Metrics

**Authentication**
- Login attempts
- Failed logins
- Session duration
- Password resets

**Access Patterns**
- API usage by endpoint
- File access logs
- Unusual activity
- Geographic anomalies

## Setting Up Monitoring

### Basic Monitoring Setup

1. **Enable Vercel Analytics**
   ```javascript
   // In app/layout.tsx
   import { Analytics } from '@vercel/analytics/react';
   
   export default function RootLayout({ children }) {
     return (
       <html>
         <body>
           {children}
           <Analytics />
         </body>
       </html>
     );
   }
   ```

2. **Custom Event Tracking**
   ```typescript
   // Track custom events
   import { track } from '@vercel/analytics';
   
   // Track booking creation
   track('booking_created', {
     event_id: eventId,
     seats: seatCount
   });
   ```

3. **Error Boundary Setup**
   ```typescript
   // app/error.tsx
   'use client';
   
   export default function Error({
     error,
     reset,
   }: {
     error: Error;
     reset: () => void;
   }) {
     // Log error to monitoring service
     console.error('Application error:', error);
     
     return (
       <div>
         <h2>Something went wrong!</h2>
         <button onClick={reset}>Try again</button>
       </div>
     );
   }
   ```

### Advanced Monitoring

1. **Custom Logging**
   ```typescript
   // lib/logger.ts
   export function logEvent(event: {
     type: string;
     level: 'info' | 'warn' | 'error';
     details: any;
   }) {
     const timestamp = new Date().toISOString();
     
     // Console log for development
     console.log(`[${timestamp}] ${event.level}: ${event.type}`, event.details);
     
     // Send to monitoring service in production
     if (process.env.NODE_ENV === 'production') {
       // Send to logging service
     }
   }
   ```

2. **Performance Monitoring**
   ```typescript
   // Monitor database queries
   async function timedQuery(queryFn: () => Promise<any>, queryName: string) {
     const start = performance.now();
     
     try {
       const result = await queryFn();
       const duration = performance.now() - start;
       
       if (duration > 100) {
         logEvent({
           type: 'slow_query',
           level: 'warn',
           details: { queryName, duration }
         });
       }
       
       return result;
     } catch (error) {
       logEvent({
         type: 'query_error',
         level: 'error',
         details: { queryName, error }
       });
       throw error;
     }
   }
   ```

## Alerting Strategy

### Critical Alerts (Immediate Response)
- Application down
- Database connection lost
- Authentication service failure
- SMS service failure
- Security breach detected

### Warning Alerts (Within Hours)
- High error rate (>5%)
- Slow response times
- Low SMS delivery rate
- Storage near capacity
- Unusual traffic patterns

### Information Alerts (Daily Review)
- Daily SMS count
- New user registrations
- Backup completion
- Performance trends
- Cost thresholds

## Monitoring Dashboards

### Operations Dashboard
Key widgets:
- Application health status
- Current error rate
- Active users
- Recent deployments
- System resources

### Performance Dashboard
- Page load times
- API response times
- Database query performance
- Cache hit rates
- CDN performance

### Business Dashboard
- Daily bookings
- SMS sent/delivered
- User activity
- Feature usage
- Cost tracking

## Incident Response

### Detection
1. Automated alerts trigger
2. User reports issue
3. Routine monitoring check
4. Performance degradation

### Investigation
1. Check monitoring dashboards
2. Review recent changes
3. Analyze error logs
4. Reproduce issue
5. Identify root cause

### Resolution
1. Implement fix
2. Test thoroughly
3. Deploy carefully
4. Monitor closely
5. Document incident

### Post-Mortem
1. Timeline of events
2. Root cause analysis
3. Impact assessment
4. Preventive measures
5. Process improvements

## Log Management

### What to Log
- Authentication events
- API requests
- Database operations
- File operations
- Errors and exceptions
- Security events

### Log Format
```json
{
  "timestamp": "2024-01-20T10:30:00Z",
  "level": "error",
  "service": "api",
  "event": "database_error",
  "details": {
    "query": "SELECT * FROM events",
    "error": "timeout",
    "duration": 5000
  },
  "context": {
    "user_id": "uuid",
    "request_id": "uuid"
  }
}
```

### Log Retention
- Error logs: 90 days
- Access logs: 30 days
- Debug logs: 7 days
- Security logs: 1 year
- Audit logs: 7 years

## Performance Optimization

### Identifying Issues
1. Monitor Web Vitals
2. Track slow queries
3. Analyze bundle size
4. Review network requests
5. Profile React components

### Common Optimizations
- Add database indexes
- Implement caching
- Optimize images
- Reduce bundle size
- Lazy load components

## Maintenance Windows

### Planning Maintenance
1. Schedule during low usage
2. Notify users in advance
3. Prepare rollback plan
4. Monitor during window
5. Verify post-maintenance

### Health Checks
```typescript
// api/health/route.ts
export async function GET() {
  try {
    // Check database
    await supabase.from('events').select('id').limit(1);
    
    // Check storage
    const { data } = await supabase.storage.getBucket('employee-attachments');
    
    return Response.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'operational',
        storage: 'operational',
        auth: 'operational'
      }
    });
  } catch (error) {
    return Response.json({
      status: 'unhealthy',
      error: error.message
    }, { status: 503 });
  }
}
```

## Best Practices

### Do's
- ✅ Set up alerts for critical metrics
- ✅ Review dashboards daily
- ✅ Document incidents
- ✅ Test monitoring systems
- ✅ Keep historical data

### Don'ts
- ❌ Ignore warning signs
- ❌ Alert on everything
- ❌ Skip log rotation
- ❌ Neglect security logs
- ❌ Delay incident response

## Future Monitoring Enhancements

### Planned Additions
1. Real-time monitoring dashboard
2. AI-powered anomaly detection
3. Predictive alerting
4. Custom metric tracking
5. Mobile monitoring app

### Tool Considerations
- Sentry for error tracking
- DataDog for APM
- Grafana for visualization
- ELK stack for logs
- Prometheus for metrics