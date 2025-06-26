# Security Recommendations

## Critical Security Issues (P0)

### 1. Service Role Key Protection

**Current Issue:**
The `createAdminClient()` function uses the service role key, bypassing RLS. This is being used in API routes without proper access control.

**Fix Required:**
```typescript
// src/lib/supabase/admin-wrapper.ts
import { createAdminClient as createBaseAdminClient } from './server';

export async function createAdminClient(requireAuth = true) {
  if (requireAuth) {
    // Verify the request is from an authenticated admin user
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      throw new Error('Unauthorized: No authenticated user');
    }
    
    const hasAdminPermission = await checkUserPermission(
      supabase, 
      'system', 
      'admin_access'
    );
    
    if (!hasAdminPermission) {
      throw new Error('Unauthorized: Insufficient permissions');
    }
  }
  
  return createBaseAdminClient();
}
```

### 2. API Rate Limiting

**Implementation Required:**
```typescript
// src/middleware.ts
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '10 s'),
});

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const ip = request.ip ?? '127.0.0.1';
    const { success } = await ratelimit.limit(ip);
    
    if (!success) {
      return new Response('Too Many Requests', { status: 429 });
    }
  }
}
```

### 3. Webhook Signature Validation

**Never Allow Bypass in Production:**
```typescript
// src/app/api/webhooks/twilio/sms/route.ts
const SKIP_VALIDATION = process.env.NODE_ENV === 'development' && 
                       process.env.SKIP_TWILIO_SIGNATURE_VALIDATION === 'true';

if (!SKIP_VALIDATION) {
  const signature = request.headers.get('X-Twilio-Signature');
  if (!signature || !validateTwilioSignature(signature, body, url)) {
    return new Response('Unauthorized', { status: 401 });
  }
}
```

## High Priority Security Issues (P1)

### 1. Input Validation Framework

```typescript
// src/lib/validation/api-input.ts
import { z } from 'zod';
import DOMPurify from 'isomorphic-dompurify';

export const sanitizeString = (input: string) => {
  return DOMPurify.sanitize(input, { 
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [] 
  });
};

export const phoneNumberSchema = z.string()
  .regex(/^(\+44|0)[0-9]{10}$/, 'Invalid UK phone number')
  .transform(val => val.startsWith('0') ? '+44' + val.slice(1) : val);

export const emailSchema = z.string()
  .email()
  .max(255);

export const fileUploadSchema = z.object({
  size: z.number().max(10 * 1024 * 1024), // 10MB max
  type: z.enum(['image/jpeg', 'image/png', 'image/gif', 'application/pdf']),
});
```

### 2. CORS Configuration

```typescript
// src/lib/api/cors.ts
const ALLOWED_ORIGINS = [
  process.env.NEXT_PUBLIC_APP_URL,
  'https://management.orangejelly.co.uk'
].filter(Boolean);

export function setCORSHeaders(response: NextResponse, origin?: string) {
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.headers.set('Access-Control-Max-Age', '86400');
  }
  return response;
}
```

### 3. Comprehensive Audit Logging

```typescript
// Extend audit logging to cover:
- API key usage
- Failed authentication attempts  
- Permission check failures
- File uploads/downloads
- Data exports
- Settings changes
- Bulk operations
```

## Security Checklist

### For Every API Endpoint
- [ ] Implement rate limiting
- [ ] Validate all inputs with Zod
- [ ] Check authentication
- [ ] Verify permissions
- [ ] Log sensitive operations
- [ ] Handle errors without leaking info
- [ ] Set appropriate CORS headers

### For File Uploads
- [ ] Validate file type
- [ ] Check file size
- [ ] Scan for malware (if possible)
- [ ] Generate unique filenames
- [ ] Store outside web root
- [ ] Use signed URLs for access

### For External Integrations
- [ ] Validate webhook signatures
- [ ] Use encrypted connections
- [ ] Store credentials securely
- [ ] Implement retry logic
- [ ] Log all interactions
- [ ] Monitor for anomalies

## Security Headers

Add to `next.config.js`:
```javascript
const securityHeaders = [
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on'
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload'
  },
  {
    key: 'X-Frame-Options',
    value: 'SAMEORIGIN'
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff'
  },
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block'
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin'
  },
  {
    key: 'Content-Security-Policy',
    value: "default-src 'self'; img-src 'self' data: https:; script-src 'self' 'unsafe-eval' 'unsafe-inline';"
  }
];
```

## Monitoring & Alerting

### Set Up Alerts For:
1. Multiple failed login attempts
2. Unusual API usage patterns
3. Large data exports
4. Permission escalation attempts
5. File upload anomalies
6. Database query timeouts
7. High error rates

### Recommended Tools:
- **Error Tracking:** Sentry
- **APM:** New Relic or DataDog
- **Security Scanning:** Snyk
- **Dependency Auditing:** npm audit
- **SIEM:** Splunk or ELK Stack