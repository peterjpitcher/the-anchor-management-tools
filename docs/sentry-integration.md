# Sentry Integration Guide

## Overview
Sentry is integrated into the application for error tracking and performance monitoring. This guide covers the implementation details and usage.

## Implementation Details

### Configuration Files
- **`sentry.client.config.ts`**: Client-side error tracking with session replay
- **`sentry.server.config.ts`**: Server-side error tracking with filtering
- **`sentry.edge.config.ts`**: Edge runtime support
- **`next.config.mjs`**: Webpack plugin integration

### Features Implemented
1. **Automatic Error Capture**: Unhandled errors are automatically sent to Sentry
2. **User Context**: Errors are associated with authenticated users
3. **Session Replay**: 10% of sessions are recorded for debugging
4. **Performance Monitoring**: 10% sample rate in production
5. **Error Filtering**: Excludes known non-critical errors (ResizeObserver, etc.)
6. **Source Maps**: Hidden from production for security

### Environment Variables Required
```bash
# Required
NEXT_PUBLIC_SENTRY_DSN=your_sentry_dsn

# Optional (for source map uploads)
SENTRY_ORG=your_sentry_org
SENTRY_PROJECT=your_sentry_project
SENTRY_AUTH_TOKEN=your_sentry_auth_token

# Development
SENTRY_ENABLE_DEV=false  # Set to true to enable in development
```

## Setup Instructions

1. **Create Sentry Account**
   - Sign up at https://sentry.io
   - Create a new project (Next.js)
   - Copy the DSN from project settings

2. **Configure Environment**
   - Add Sentry environment variables to `.env.local`
   - For production, also add `SENTRY_ORG`, `SENTRY_PROJECT`, and `SENTRY_AUTH_TOKEN`

3. **Test Integration**
   - In development mode, go to Settings page
   - Click "Test Sentry Integration" button
   - Check Sentry dashboard for test error

## Usage

### Manual Error Capture
```typescript
import * as Sentry from '@sentry/nextjs';

try {
  // risky operation
} catch (error) {
  Sentry.captureException(error, {
    tags: { section: 'checkout' },
    extra: { orderId: order.id }
  });
}
```

### Custom Context
```typescript
Sentry.setContext('order', {
  id: order.id,
  total: order.total,
  items: order.items.length
});
```

### Performance Monitoring
```typescript
const transaction = Sentry.startTransaction({
  name: 'process-payment',
  op: 'transaction'
});

// ... do work ...

transaction.finish();
```

## Best Practices

1. **Sensitive Data**: Never log passwords, tokens, or personal information
2. **Error Grouping**: Use consistent error messages for proper grouping
3. **Context**: Add relevant context to help debug issues
4. **Filtering**: Filter out non-actionable errors to reduce noise

## Monitoring

- **Dashboard**: View errors at https://sentry.io
- **Alerts**: Set up alerts for error spikes or new issues
- **Performance**: Monitor slow transactions and database queries
- **Release Tracking**: Tag releases to track error introduction

## Troubleshooting

### Errors Not Appearing
1. Check DSN is correctly set
2. Verify environment (errors filtered in dev by default)
3. Check browser console for Sentry initialization errors

### Too Many Errors
1. Adjust `tracesSampleRate` in config files
2. Add more filters in `beforeSend` callback
3. Use `ignoreErrors` option for known issues

## Security Considerations

- Source maps are hidden in production
- User PII is not sent by default
- Session replays mask sensitive inputs
- All data is transmitted over HTTPS