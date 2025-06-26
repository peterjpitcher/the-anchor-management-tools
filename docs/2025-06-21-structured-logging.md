# Structured Logging Documentation

## Overview
The application uses a structured logging system that provides consistent, searchable logs with automatic Sentry integration for production error tracking.

## Logger Usage

### Basic Logging

```typescript
import { logger } from '@/lib/logger';

// Debug level - detailed information for debugging
logger.debug('Processing user request', { userId: '123' });

// Info level - general information
logger.info('User logged in', { userId: '123', action: 'login' });

// Warning level - warning conditions
logger.warn('Rate limit approaching', { userId: '123', remaining: 5 });

// Error level - error conditions
logger.error('Failed to send SMS', { 
  error: new Error('Twilio error'),
  metadata: { to: '+44****', messageId: 'abc123' }
});
```

### Specialized Logging Methods

#### API Calls
```typescript
logger.logApiCall('/api/users', 'GET', 200, 150); // endpoint, method, status, duration
```

#### Database Queries
```typescript
const timer = logger.startTimer('user-query');
// ... perform query ...
timer(); // Logs: Timer [user-query]: 45ms

// Or with error handling
logger.logDatabaseQuery('SELECT * FROM users', 45); // Success
logger.logDatabaseQuery('SELECT * FROM users', 45, error); // Failure
```

#### SMS Events
```typescript
logger.logSmsEvent('+447700900123', 'sent');
logger.logSmsEvent('+447700900123', 'failed', 'Invalid number');
logger.logSmsEvent('+447700900123', 'delivered');
```

#### Authentication Events
```typescript
logger.logAuthEvent(userId, 'login');
logger.logAuthEvent(userId, 'logout');
logger.logAuthEvent(userId, 'signup');
logger.logAuthEvent(userId, 'password_reset');
```

#### Security Events
```typescript
logger.logSecurityEvent('suspicious_login', {
  ip: '192.168.1.1',
  attempts: 5,
  userId: '123'
});
```

### Performance Timing
```typescript
const endTimer = logger.startTimer('complex-operation');
// ... perform operation ...
endTimer(); // Automatically logs duration
```

## Log Levels

### Development Environment
- **Debug**: Cyan - Detailed debugging information
- **Info**: Green - General informational messages
- **Warn**: Yellow - Warning messages
- **Error**: Red - Error messages

### Production Environment
- **Debug**: Not sent to Sentry (console only in dev)
- **Info**: Added as breadcrumbs in Sentry
- **Warn**: Sent to Sentry as warnings
- **Error**: Sent to Sentry as errors with full context

## Log Format

```
[2024-01-20T10:30:45.123Z] [INFO] User logged in {"userId":"123","action":"login"}
```

Components:
- ISO timestamp
- Log level
- Message
- JSON context (optional)

## Integration with Sentry

### Automatic Error Capture
```typescript
try {
  // risky operation
} catch (error) {
  logger.error('Operation failed', { 
    error,
    userId: currentUser.id,
    metadata: { operation: 'data-export' }
  });
  // Error automatically sent to Sentry with context
}
```

### Breadcrumbs
Info logs with actions are added as Sentry breadcrumbs:
```typescript
logger.info('Processing payment', { action: 'payment_process', orderId: '123' });
// Added as breadcrumb for error context
```

## Best Practices

### 1. Use Appropriate Log Levels
- **Debug**: Development debugging, verbose information
- **Info**: Normal operations, important events
- **Warn**: Unusual but handled situations
- **Error**: Errors that need attention

### 2. Include Context
```typescript
// Good
logger.error('Failed to process order', {
  error,
  userId: user.id,
  metadata: { orderId: order.id, amount: order.total }
});

// Bad
logger.error('Failed to process order');
```

### 3. Avoid Logging Sensitive Data
```typescript
// Good - mask sensitive data
logger.logSmsEvent(phone.substring(0, 8) + '****', 'sent');

// Bad - full phone number
logger.logSmsEvent(phone, 'sent');
```

### 4. Use Specialized Methods
```typescript
// Good - use specialized method
logger.logAuthEvent(userId, 'login');

// Less ideal - generic log
logger.info('User logged in', { userId });
```

### 5. Performance Considerations
- Avoid excessive debug logging in production
- Use timers for performance-critical operations
- Batch related logs when possible

## Migration from console.log

### Before
```typescript
console.log('Processing booking', bookingId);
console.error('Failed to send SMS:', error);
```

### After
```typescript
logger.info('Processing booking', { metadata: { bookingId } });
logger.error('Failed to send SMS', { error });
```

## API Route Logging

### Middleware Usage
```typescript
import { withApiLogging } from '@/lib/api-logger';

export const GET = withApiLogging(async (req: NextRequest) => {
  // Your handler code
  return NextResponse.json({ data });
});
```

Automatically logs:
- Request method and URL
- Response status code
- Request duration
- Errors with stack traces

## Monitoring and Analysis

### Development
- Color-coded console output
- Full debug information
- No external services required

### Production
- Errors sent to Sentry
- Performance metrics tracked
- Security events highlighted
- Searchable in Sentry dashboard

### Log Aggregation
Consider using services like:
- Datadog
- LogDNA
- Papertrail
- CloudWatch (AWS)

## Configuration

### Environment Variables
```bash
# Sentry (for production error tracking)
SENTRY_DSN=your-sentry-dsn
NODE_ENV=production
```

### Custom Log Levels
Extend the logger for custom needs:
```typescript
class CustomLogger extends Logger {
  metric(name: string, value: number) {
    this.info(`Metric: ${name}`, {
      action: 'metric',
      metadata: { name, value }
    });
  }
}
```