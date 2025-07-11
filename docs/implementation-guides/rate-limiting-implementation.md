# Production Rate Limiting Implementation Guide

This guide provides step-by-step instructions for implementing distributed rate limiting to protect against DDoS and abuse.

## 🚨 Current State

- **In-memory rate limiting** exists but won't scale
- **Not applied consistently** across all endpoints
- **No rate limiting on server actions**
- **Vulnerable to abuse** without distributed limiting

## Architecture Overview

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Client    │────▶│   Vercel     │────▶│    Redis    │
│  (Browser)  │     │  Edge/Node   │     │  (Upstash)  │
└─────────────┘     └──────────────┘     └─────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   Supabase   │
                    │   Database   │
                    └──────────────┘
```

## Step 1: Set Up Redis (Upstash)

### 1.1 Create Upstash Account

1. Go to [upstash.com](https://upstash.com)
2. Sign up for free account
3. Create new Redis database:
   - Name: `anchor-tools-rate-limit`
   - Region: Same as Vercel deployment
   - Enable "Eviction" with LRU policy

### 1.2 Get Connection Details

From Upstash console, copy:
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Add to `.env.local`:
```env
UPSTASH_REDIS_REST_URL=https://xxxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxxxx
```

## Step 2: Install Dependencies

```bash
npm install @upstash/redis @upstash/ratelimit
```

## Step 3: Create Rate Limiter

### 3.1 Create Redis Client

Create `src/lib/redis.ts`:
```typescript
import { Redis } from '@upstash/redis';

if (!process.env.UPSTASH_REDIS_REST_URL) {
  throw new Error('UPSTASH_REDIS_REST_URL is not defined');
}

if (!process.env.UPSTASH_REDIS_REST_TOKEN) {
  throw new Error('UPSTASH_REDIS_REST_TOKEN is not defined');
}

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Test connection
export async function testRedisConnection() {
  try {
    await redis.ping();
    console.log('✅ Redis connection successful');
    return true;
  } catch (error) {
    console.error('❌ Redis connection failed:', error);
    return false;
  }
}
```

### 3.2 Create Rate Limiter Factory

Update `src/lib/rate-limit.ts`:
```typescript
import { Ratelimit } from '@upstash/ratelimit';
import { redis } from './redis';
import { headers } from 'next/headers';

// Define rate limit tiers
export const rateLimiters = {
  // SMS operations - strict limit
  sms: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, '1 m'), // 10 requests per minute
    analytics: true,
    prefix: 'rl:sms',
  }),
  
  // Bulk operations - very strict
  bulk: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '1 h'), // 5 requests per hour
    analytics: true,
    prefix: 'rl:bulk',
  }),
  
  // Authentication - prevent brute force
  auth: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '15 m'), // 5 attempts per 15 minutes
    analytics: true,
    prefix: 'rl:auth',
  }),
  
  // General API - normal operations
  api: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(100, '1 m'), // 100 requests per minute
    analytics: true,
    prefix: 'rl:api',
  }),
  
  // Webhooks - higher limit for external services
  webhook: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(1000, '1 m'), // 1000 requests per minute
    analytics: true,
    prefix: 'rl:webhook',
  }),
  
  // Data export - expensive operations
  export: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, '1 h'), // 10 exports per hour
    analytics: true,
    prefix: 'rl:export',
  }),
};

// Get identifier from request
export function getIdentifier(): string {
  const headersList = headers();
  
  // Try to get real IP
  const forwardedFor = headersList.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  
  const realIp = headersList.get('x-real-ip');
  if (realIp) {
    return realIp;
  }
  
  // Fallback to a default (not ideal but prevents errors)
  return 'anonymous';
}

// Check rate limit
export async function checkRateLimit(
  tier: keyof typeof rateLimiters,
  identifier?: string
) {
  const id = identifier || getIdentifier();
  const rateLimiter = rateLimiters[tier];
  
  const { success, limit, reset, remaining } = await rateLimiter.limit(id);
  
  return {
    success,
    limit,
    reset,
    remaining,
    headers: {
      'X-RateLimit-Limit': limit.toString(),
      'X-RateLimit-Remaining': remaining.toString(),
      'X-RateLimit-Reset': new Date(reset).toISOString(),
    },
  };
}

// Rate limit response helper
export function rateLimitResponse(reset: number) {
  const retryAfter = Math.round((reset - Date.now()) / 1000);
  
  return new Response('Too Many Requests', {
    status: 429,
    headers: {
      'Retry-After': retryAfter.toString(),
      'X-RateLimit-Reset': new Date(reset).toISOString(),
    },
  });
}
```

## Step 4: Apply Rate Limiting

### 4.1 Update Middleware

Update `src/middleware.ts`:
```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';

// Paths that require authentication
const protectedPaths = [
  '/dashboard',
  '/customers',
  '/events',
  '/employees',
  '/messages',
  '/settings',
  '/profile',
];

// Rate limit configurations per path
const rateLimitConfig: Record<string, keyof typeof rateLimiters> = {
  '/api/webhooks/twilio': 'webhook',
  '/api/auth': 'auth',
  '/api/sms': 'sms',
  '/api/export': 'export',
  '/api/bulk': 'bulk',
  '/api': 'api', // Default for all other API routes
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Skip rate limiting for static assets
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }
  
  // Apply rate limiting to API routes
  if (pathname.startsWith('/api')) {
    // Skip rate limiting for cron jobs with valid secret
    if (pathname.startsWith('/api/cron')) {
      const authHeader = request.headers.get('authorization');
      if (authHeader === `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.next();
      }
    }
    
    // Find matching rate limit tier
    let tier: keyof typeof rateLimiters = 'api';
    for (const [path, configTier] of Object.entries(rateLimitConfig)) {
      if (pathname.startsWith(path)) {
        tier = configTier;
        break;
      }
    }
    
    // Check rate limit
    try {
      const result = await checkRateLimit(tier);
      
      if (!result.success) {
        return rateLimitResponse(result.reset);
      }
      
      // Add rate limit headers to successful responses
      const response = NextResponse.next();
      Object.entries(result.headers).forEach(([key, value]) => {
        response.headers.set(key, value);
      });
      
      return response;
    } catch (error) {
      console.error('Rate limit check failed:', error);
      // If Redis is down, allow the request but log it
      return NextResponse.next();
    }
  }
  
  // Handle authentication for protected paths
  if (protectedPaths.some(path => pathname.startsWith(path))) {
    // Check for auth cookie
    const authCookie = request.cookies.get('supabase-auth-token');
    
    if (!authCookie) {
      const redirectUrl = new URL('/login', request.url);
      redirectUrl.searchParams.set('redirectTo', pathname);
      return NextResponse.redirect(redirectUrl);
    }
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
```

### 4.2 Rate Limit Server Actions

Create wrapper for server actions:
```typescript
// src/lib/rate-limit-action.ts
import { checkRateLimit } from './rate-limit';
import { headers } from 'next/headers';

type RateLimitTier = 'api' | 'sms' | 'bulk' | 'export' | 'auth';

export function withRateLimit<T extends (...args: any[]) => Promise<any>>(
  action: T,
  tier: RateLimitTier = 'api'
): T {
  return (async (...args: Parameters<T>) => {
    // Get identifier from headers
    const headersList = headers();
    const forwardedFor = headersList.get('x-forwarded-for');
    const identifier = forwardedFor?.split(',')[0].trim() || 'anonymous';
    
    // Check rate limit
    const result = await checkRateLimit(tier, identifier);
    
    if (!result.success) {
      const retryAfter = Math.round((result.reset - Date.now()) / 1000);
      return {
        error: `Too many requests. Please try again in ${retryAfter} seconds.`,
        rateLimited: true,
        retryAfter,
      };
    }
    
    // Execute the action
    return action(...args);
  }) as T;
}
```

### 4.3 Apply to SMS Actions

Update `src/app/actions/sms.ts`:
```typescript
import { withRateLimit } from '@/lib/rate-limit-action';

export const sendSms = withRateLimit(
  async function sendSmsAction({ to, body, bookingId }: SendSmsParams) {
    // Existing SMS sending logic
    const supabase = createClient();
    
    // ... rest of implementation
  },
  'sms' // Use SMS rate limit tier
);

export const sendBulkSms = withRateLimit(
  async function sendBulkSmsAction(
    customerIds: string[],
    message: string,
    scheduledFor?: Date
  ) {
    // Existing bulk SMS logic
    const supabase = createClient();
    
    // Additional check for bulk operations
    if (customerIds.length > 100) {
      return { error: 'Maximum 100 recipients per bulk operation' };
    }
    
    // ... rest of implementation
  },
  'bulk' // Use bulk rate limit tier
);
```

### 4.4 Apply to Export Actions

Update `src/app/actions/employeeExport.ts`:
```typescript
import { withRateLimit } from '@/lib/rate-limit-action';

export const exportAllEmployees = withRateLimit(
  async function exportAllEmployeesAction() {
    // Existing export logic
    const supabase = createClient();
    
    // ... rest of implementation
  },
  'export' // Use export rate limit tier
);
```

## Step 5: API Route Rate Limiting

### 5.1 Create Rate Limit Helper

Create `src/lib/api-rate-limit.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from './rate-limit';

export async function withApiRateLimit(
  request: NextRequest,
  handler: () => Promise<NextResponse>,
  tier: keyof typeof rateLimiters = 'api'
) {
  const identifier = request.headers.get('x-forwarded-for')?.split(',')[0].trim() 
    || request.headers.get('x-real-ip') 
    || 'anonymous';
    
  const result = await checkRateLimit(tier, identifier);
  
  if (!result.success) {
    return rateLimitResponse(result.reset);
  }
  
  const response = await handler();
  
  // Add rate limit headers
  Object.entries(result.headers).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  
  return response;
}
```

### 5.2 Apply to API Routes

Update webhook route `src/app/api/webhooks/twilio/route.ts`:
```typescript
import { withApiRateLimit } from '@/lib/api-rate-limit';

export async function POST(request: NextRequest) {
  return withApiRateLimit(request, async () => {
    // Existing webhook logic
    const twilioSignature = request.headers.get('X-Twilio-Signature');
    
    // ... rest of implementation
    
    return NextResponse.json({ success: true });
  }, 'webhook');
}
```

## Step 6: Client-Side Handling

### 6.1 Create Rate Limit Error Handler

Create `src/lib/handle-rate-limit.ts`:
```typescript
export interface RateLimitError {
  error: string;
  rateLimited: true;
  retryAfter: number;
}

export function isRateLimitError(error: any): error is RateLimitError {
  return error?.rateLimited === true;
}

export function handleRateLimitError(error: RateLimitError) {
  const minutes = Math.ceil(error.retryAfter / 60);
  const message = minutes > 1 
    ? `Please try again in ${minutes} minutes`
    : `Please try again in ${error.retryAfter} seconds`;
    
  return {
    title: 'Too Many Requests',
    message,
    retryAfter: error.retryAfter,
  };
}
```

### 6.2 Update UI Components

Update components to handle rate limiting:
```typescript
import { isRateLimitError, handleRateLimitError } from '@/lib/handle-rate-limit';
import { toast } from 'react-hot-toast';

// In your component
const handleSendSms = async () => {
  try {
    const result = await sendSms({
      to: phoneNumber,
      body: message,
    });
    
    if (result.error) {
      if (isRateLimitError(result)) {
        const { title, message } = handleRateLimitError(result);
        toast.error(`${title}: ${message}`);
        
        // Optionally disable button for retry period
        setDisabled(true);
        setTimeout(() => setDisabled(false), result.retryAfter * 1000);
      } else {
        toast.error(result.error);
      }
      return;
    }
    
    toast.success('SMS sent successfully');
  } catch (error) {
    toast.error('Failed to send SMS');
  }
};
```

## Step 7: Monitoring and Analytics

### 7.1 Create Rate Limit Dashboard

Create `src/app/(authenticated)/admin/rate-limits/page.tsx`:
```typescript
'use client';

import { useEffect, useState } from 'react';
import { redis } from '@/lib/redis';

interface RateLimitStats {
  tier: string;
  requests: number;
  blocked: number;
  users: number;
}

export default function RateLimitDashboard() {
  const [stats, setStats] = useState<RateLimitStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 10000); // Update every 10s
    return () => clearInterval(interval);
  }, []);

  const fetchStats = async () => {
    try {
      // Fetch analytics from Upstash
      const tiers = ['sms', 'bulk', 'auth', 'api', 'webhook', 'export'];
      const tierStats = await Promise.all(
        tiers.map(async (tier) => {
          // Get analytics data
          const data = await redis.get(`rl:${tier}:analytics`);
          return {
            tier,
            requests: data?.requests || 0,
            blocked: data?.blocked || 0,
            users: data?.uniqueUsers || 0,
          };
        })
      );
      
      setStats(tierStats);
    } catch (error) {
      console.error('Failed to fetch rate limit stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div>Loading rate limit statistics...</div>;
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Rate Limit Dashboard</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {stats.map((stat) => (
          <div key={stat.tier} className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold capitalize mb-4">
              {stat.tier} Tier
            </h2>
            <dl className="space-y-2">
              <div className="flex justify-between">
                <dt className="text-gray-600">Total Requests</dt>
                <dd className="font-medium">{stat.requests.toLocaleString()}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Blocked</dt>
                <dd className="font-medium text-red-600">
                  {stat.blocked.toLocaleString()}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Unique Users</dt>
                <dd className="font-medium">{stat.users.toLocaleString()}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Block Rate</dt>
                <dd className="font-medium">
                  {stat.requests > 0 
                    ? ((stat.blocked / stat.requests) * 100).toFixed(2) 
                    : 0}%
                </dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
      
      <div className="mt-8 bg-blue-50 rounded-lg p-6">
        <h3 className="font-semibold mb-2">Rate Limit Configuration</h3>
        <ul className="text-sm space-y-1">
          <li>• SMS: 10 requests/minute</li>
          <li>• Bulk: 5 requests/hour</li>
          <li>• Auth: 5 attempts/15 minutes</li>
          <li>• API: 100 requests/minute</li>
          <li>• Webhook: 1000 requests/minute</li>
          <li>• Export: 10 requests/hour</li>
        </ul>
      </div>
    </div>
  );
}
```

### 7.2 Add Logging

Update rate limiter to log attempts:
```typescript
import { logger } from './logger';

// In checkRateLimit function
if (!result.success) {
  logger.warn({
    event: 'rate_limit_exceeded',
    tier,
    identifier: id,
    limit: result.limit,
  }, 'Rate limit exceeded');
}
```

## Step 8: Testing

### 8.1 Create Rate Limit Tests

Create `src/lib/__tests__/rate-limit.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit } from '../rate-limit';

describe('Rate Limiting', () => {
  const testIdentifier = `test-${Date.now()}`;

  beforeEach(async () => {
    // Clear any existing rate limit data
    // await redis.del(`rl:api:${testIdentifier}`);
  });

  it('allows requests under the limit', async () => {
    const results = await Promise.all(
      Array(5).fill(null).map(() => 
        checkRateLimit('api', testIdentifier)
      )
    );
    
    results.forEach(result => {
      expect(result.success).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
    });
  });

  it('blocks requests over the limit', async () => {
    // Make requests up to the limit
    const limit = 100; // API tier limit
    
    // Exhaust the limit
    await Promise.all(
      Array(limit).fill(null).map(() => 
        checkRateLimit('api', testIdentifier)
      )
    );
    
    // Next request should be blocked
    const result = await checkRateLimit('api', testIdentifier);
    expect(result.success).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('resets after the time window', async () => {
    // This would require waiting for the actual time window
    // In practice, use time mocking or skip in unit tests
  });
});
```

### 8.2 Load Testing

Create load test script `scripts/load-test-rate-limit.ts`:
```typescript
import { checkRateLimit } from '@/lib/rate-limit';

async function loadTest() {
  const identifier = 'load-test';
  const concurrency = 20;
  const totalRequests = 200;
  
  let successCount = 0;
  let blockedCount = 0;
  
  const start = Date.now();
  
  // Run concurrent requests
  for (let i = 0; i < totalRequests; i += concurrency) {
    const batch = Array(concurrency).fill(null).map(async () => {
      const result = await checkRateLimit('api', identifier);
      if (result.success) {
        successCount++;
      } else {
        blockedCount++;
      }
      return result;
    });
    
    await Promise.all(batch);
  }
  
  const duration = Date.now() - start;
  
  console.log('Load Test Results:');
  console.log(`Total Requests: ${totalRequests}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Blocked: ${blockedCount}`);
  console.log(`Duration: ${duration}ms`);
  console.log(`Block Rate: ${((blockedCount / totalRequests) * 100).toFixed(2)}%`);
}

loadTest().catch(console.error);
```

## Step 9: Production Deployment

### 9.1 Environment Variables

Add to Vercel:
```bash
vercel env add UPSTASH_REDIS_REST_URL
vercel env add UPSTASH_REDIS_REST_TOKEN
```

### 9.2 Monitoring Alerts

Set up alerts in Upstash:
1. Go to Upstash Console → Your Database → Alerts
2. Create alert for high usage
3. Create alert for errors

### 9.3 Gradual Rollout

1. **Stage 1**: Deploy with generous limits
   ```typescript
   api: Ratelimit.slidingWindow(1000, '1 m'), // Start high
   ```

2. **Stage 2**: Monitor for a week, adjust based on usage

3. **Stage 3**: Tighten limits to final values

## Troubleshooting

### Common Issues

1. **Redis Connection Errors**
   ```typescript
   // Add fallback behavior
   if (!redis.isReady) {
     console.error('Redis not available, allowing request');
     return { success: true, limit: 0, remaining: 0, reset: 0 };
   }
   ```

2. **IP Detection Issues**
   - Ensure Vercel forwards real IP
   - Check proxy configuration
   - Add IP detection logging

3. **False Positives**
   - Monitor block rates
   - Adjust limits based on legitimate usage
   - Consider user-based limits for authenticated users

## Success Criteria

- [ ] Redis connection established
- [ ] Rate limiting applied to all API routes
- [ ] Server actions protected
- [ ] Client handles rate limit errors gracefully
- [ ] Monitoring dashboard shows statistics
- [ ] Load tests pass without service degradation
- [ ] No legitimate users blocked
- [ ] DDoS protection verified