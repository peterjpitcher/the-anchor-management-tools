---
name: "🚨 CRITICAL: Implement Production Monitoring"
about: Add error tracking and monitoring to gain visibility into production issues
title: "🚨 CRITICAL: Implement Production Monitoring with Sentry"
labels: critical, security, audit-finding
assignees: ''

---

## 🚨 Critical Audit Finding

**Severity**: CRITICAL  
**Category**: Monitoring & Observability  
**Audit Reference**: Phase 7 - Operations & Infrastructure

## Problem

The application currently has **no error tracking or monitoring** in production. We are completely blind to:
- JavaScript errors in the browser
- Server-side errors in API routes and server actions  
- Performance issues
- Failed cron jobs
- User experience problems

## Impact

- **Users experience errors** we don't know about
- **No way to debug** production issues
- **No performance metrics** to identify bottlenecks
- **Security incidents** could go unnoticed
- **Business impact** from silent failures

## Required Implementation

### 1. Install Sentry (Recommended)

```bash
npm install @sentry/nextjs
```

### 2. Configure Sentry

Create `sentry.client.config.ts`:
```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  debug: false,
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
});
```

Create `sentry.server.config.ts`:
```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
  debug: false,
});
```

### 3. Update next.config.js

```javascript
const { withSentryConfig } = require("@sentry/nextjs");

const nextConfig = {
  // existing config
};

module.exports = withSentryConfig(
  nextConfig,
  {
    silent: true,
    org: "your-org",
    project: "anchor-tools",
  },
  {
    widenClientFileUpload: true,
    transpileClientSDK: true,
    hideSourceMaps: true,
  }
);
```

### 4. Add Error Boundary

Create `app/global-error.tsx`:
```typescript
'use client';

import * as Sentry from "@sentry/nextjs";
import Error from "next/error";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <Error statusCode={500} />
      </body>
    </html>
  );
}
```

### 5. Environment Variables

Add to `.env.local`:
```env
SENTRY_DSN=your_server_sentry_dsn
NEXT_PUBLIC_SENTRY_DSN=your_client_sentry_dsn
SENTRY_ORG=your-org-slug
SENTRY_PROJECT=anchor-tools
SENTRY_AUTH_TOKEN=your_auth_token
```

## Testing

1. **Test client-side error capture**:
   ```typescript
   // Add temporary button to test
   <button onClick={() => { throw new Error('Test Sentry Error') }}>
     Test Error
   </button>
   ```

2. **Test server-side error capture**:
   ```typescript
   // In any server action
   throw new Error('Test Server Error');
   ```

3. **Verify in Sentry dashboard**:
   - Errors appear within minutes
   - Stack traces are readable
   - User context is captured

## Success Criteria

- [ ] Sentry installed and configured
- [ ] Client-side errors are captured
- [ ] Server-side errors are captured  
- [ ] Performance monitoring enabled
- [ ] Error alerts configured
- [ ] Source maps uploaded for debugging
- [ ] Team has access to Sentry dashboard

## Alternative Solutions

If Sentry is not approved:
1. **LogRocket** - Includes session replay
2. **Rollbar** - Good error tracking
3. **Bugsnag** - Simple setup
4. **Custom solution** - Not recommended

## References

- [Sentry Next.js Documentation](https://docs.sentry.io/platforms/javascript/guides/nextjs/)
- [Audit Report - Monitoring Section](/docs/audit-reports/comprehensive-audit-report.md#monitoring-and-observability)

## Deadline

**Must be completed by**: [1 week from issue creation]

This is blocking our ability to maintain the application in production.