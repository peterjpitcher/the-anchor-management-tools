# Rate Limiting Specification for Table Booking API

## Overview

This document specifies the rate limiting implementation for the table booking API endpoints, leveraging the existing rate limiting infrastructure while adding booking-specific protections.

## Rate Limiting Strategy

### 1. Endpoint-Specific Limits

```typescript
// Rate limit configurations per endpoint
export const TABLE_BOOKING_RATE_LIMITS = {
  // Public API endpoints
  'GET /api/table-bookings/availability': {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 30, // 30 requests per minute
    identifier: 'ip', // Rate limit by IP
    message: 'Too many availability checks, please try again later',
  },
  
  'GET /api/table-bookings/menu/sunday-lunch': {
    windowMs: 5 * 60 * 1000, // 5 minutes
    maxRequests: 20, // 20 requests per 5 minutes
    identifier: 'ip',
    message: 'Too many menu requests',
  },
  
  'POST /api/table-bookings': {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 5, // 5 bookings per minute
    identifier: 'api_key', // Rate limit by API key
    costMultiplier: 2, // Each request counts as 2
    message: 'Booking limit exceeded, please wait before trying again',
  },
  
  'POST /api/table-bookings/confirm-payment': {
    windowMs: 60 * 1000,
    maxRequests: 10,
    identifier: 'api_key',
    message: 'Too many payment confirmations',
  },
  
  'GET /api/table-bookings/:reference': {
    windowMs: 5 * 60 * 1000,
    maxRequests: 20,
    identifier: 'ip',
    message: 'Too many booking lookups',
  },
  
  'POST /api/table-bookings/:reference/cancel': {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 5,
    identifier: 'combined', // IP + API key
    message: 'Too many cancellation attempts',
  },
  
  'PUT /api/table-bookings/:reference': {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 10,
    identifier: 'combined',
    message: 'Too many modification attempts',
  },
};
```

### 2. Global Limits

```typescript
// Overall API limits per API key
export const GLOBAL_API_LIMITS = {
  hourly: {
    windowMs: 60 * 60 * 1000,
    maxRequests: 1000,
    message: 'Hourly API limit exceeded',
  },
  daily: {
    windowMs: 24 * 60 * 60 * 1000,
    maxRequests: 10000,
    message: 'Daily API limit exceeded',
  },
};

// Special limits for booking creation
export const BOOKING_CREATION_LIMITS = {
  perPhone: {
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    maxBookings: 5, // Max 5 bookings per phone per day
    message: 'Maximum bookings per day reached for this phone number',
  },
  perEmail: {
    windowMs: 24 * 60 * 60 * 1000,
    maxBookings: 10, // Max 10 bookings per email per day
    message: 'Maximum bookings per day reached for this email',
  },
  sundayLunch: {
    windowMs: 7 * 24 * 60 * 60 * 1000, // 1 week
    maxBookings: 3, // Max 3 Sunday lunch bookings per week per customer
    message: 'Maximum Sunday lunch bookings per week reached',
  },
};
```

## Implementation

### 1. Rate Limiter Middleware

```typescript
// /lib/middleware/table-booking-rate-limit.ts
import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL!,
  token: process.env.UPSTASH_REDIS_TOKEN!,
});

export async function tableBookingRateLimit(
  request: NextRequest,
  endpoint: string
): Promise<NextResponse | null> {
  const config = TABLE_BOOKING_RATE_LIMITS[endpoint];
  if (!config) return null;
  
  // Get identifier
  const identifier = await getIdentifier(request, config.identifier);
  if (!identifier) return null;
  
  // Generate key
  const key = `rate_limit:table_booking:${endpoint}:${identifier}`;
  const now = Date.now();
  const window = now - config.windowMs;
  
  // Remove old entries and count current
  await redis.zremrangebyscore(key, 0, window);
  const count = await redis.zcard(key);
  
  // Check limit
  const cost = config.costMultiplier || 1;
  if (count >= config.maxRequests) {
    return NextResponse.json(
      {
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: config.message,
          retryAfter: Math.ceil(config.windowMs / 1000),
        },
      },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': config.maxRequests.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': new Date(now + config.windowMs).toISOString(),
          'Retry-After': Math.ceil(config.windowMs / 1000).toString(),
        },
      }
    );
  }
  
  // Add current request
  for (let i = 0; i < cost; i++) {
    await redis.zadd(key, now, `${now}-${i}`);
  }
  await redis.expire(key, Math.ceil(config.windowMs / 1000));
  
  // Add headers to response
  const remaining = Math.max(0, config.maxRequests - count - cost);
  request.headers.set('X-RateLimit-Limit', config.maxRequests.toString());
  request.headers.set('X-RateLimit-Remaining', remaining.toString());
  request.headers.set('X-RateLimit-Reset', new Date(now + config.windowMs).toISOString());
  
  return null;
}

async function getIdentifier(
  request: NextRequest,
  type: string
): Promise<string | null> {
  switch (type) {
    case 'ip':
      return request.headers.get('x-forwarded-for')?.split(',')[0] || 
             request.headers.get('x-real-ip') || 
             'unknown';
             
    case 'api_key':
      const apiKey = request.headers.get('x-api-key');
      if (!apiKey) return null;
      
      // Validate API key
      const supabase = await createClient();
      const { data } = await supabase
        .from('api_keys')
        .select('id')
        .eq('key_hash', hashApiKey(apiKey))
        .single();
        
      return data?.id || null;
      
    case 'combined':
      const ip = await getIdentifier(request, 'ip');
      const key = await getIdentifier(request, 'api_key');
      return `${ip}:${key}`;
      
    default:
      return null;
  }
}
```

### 2. Booking-Specific Rate Limiting

```typescript
// /lib/middleware/booking-creation-limits.ts
export async function checkBookingCreationLimits(
  customerData: {
    phone: string;
    email?: string;
  },
  bookingType: 'regular' | 'sunday_lunch'
): Promise<{ allowed: boolean; reason?: string }> {
  const supabase = await createClient();
  
  // Check phone number limits
  const phoneKey = `booking_limit:phone:${customerData.phone}`;
  const phoneCount = await redis.incr(phoneKey);
  
  if (phoneCount === 1) {
    await redis.expire(phoneKey, 86400); // 24 hours
  }
  
  if (phoneCount > BOOKING_CREATION_LIMITS.perPhone.maxBookings) {
    await redis.decr(phoneKey); // Rollback
    return {
      allowed: false,
      reason: BOOKING_CREATION_LIMITS.perPhone.message,
    };
  }
  
  // Check email limits if provided
  if (customerData.email) {
    const emailKey = `booking_limit:email:${customerData.email}`;
    const emailCount = await redis.incr(emailKey);
    
    if (emailCount === 1) {
      await redis.expire(emailKey, 86400);
    }
    
    if (emailCount > BOOKING_CREATION_LIMITS.perEmail.maxBookings) {
      await redis.decr(emailKey);
      await redis.decr(phoneKey); // Rollback phone too
      return {
        allowed: false,
        reason: BOOKING_CREATION_LIMITS.perEmail.message,
      };
    }
  }
  
  // Check Sunday lunch specific limits
  if (bookingType === 'sunday_lunch') {
    // Find customer by phone
    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .or(generatePhoneVariants(customerData.phone).map(v => `mobile_number.eq.${v}`).join(','))
      .single();
      
    if (customer) {
      // Count Sunday lunch bookings this week
      const weekStart = startOfWeek(new Date());
      const { count } = await supabase
        .from('table_bookings')
        .select('*', { count: 'exact', head: true })
        .eq('customer_id', customer.id)
        .eq('booking_type', 'sunday_lunch')
        .eq('status', 'confirmed')
        .gte('booking_date', weekStart.toISOString());
        
      if (count >= BOOKING_CREATION_LIMITS.sundayLunch.maxBookings) {
        // Rollback counters
        await redis.decr(phoneKey);
        if (customerData.email) await redis.decr(emailKey);
        
        return {
          allowed: false,
          reason: BOOKING_CREATION_LIMITS.sundayLunch.message,
        };
      }
    }
  }
  
  return { allowed: true };
}
```

### 3. Anti-Fraud Measures

```typescript
// /lib/security/booking-fraud-detection.ts
export async function detectBookingFraud(
  request: NextRequest,
  bookingData: any
): Promise<{ suspicious: boolean; reasons: string[] }> {
  const reasons: string[] = [];
  
  // 1. Velocity check - rapid booking attempts
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0];
  const velocityKey = `velocity:${ip}`;
  const attempts = await redis.incr(velocityKey);
  
  if (attempts === 1) {
    await redis.expire(velocityKey, 300); // 5 minutes
  }
  
  if (attempts > 10) {
    reasons.push('Too many booking attempts in short period');
  }
  
  // 2. Pattern detection
  const patterns = await detectSuspiciousPatterns(bookingData);
  reasons.push(...patterns);
  
  // 3. Known bad actors
  const isBadActor = await checkBadActorList(ip, bookingData.customer.email);
  if (isBadActor) {
    reasons.push('Known bad actor');
  }
  
  // 4. Impossible bookings
  if (bookingData.party_size > 20) {
    reasons.push('Unusually large party size');
  }
  
  // 5. Time-based anomalies
  const bookingTime = new Date(`${bookingData.date} ${bookingData.time}`);
  const hoursUntilBooking = (bookingTime.getTime() - Date.now()) / 3600000;
  
  if (hoursUntilBooking < 0.5 && bookingData.booking_type === 'sunday_lunch') {
    reasons.push('Sunday lunch booking too close to time');
  }
  
  return {
    suspicious: reasons.length > 0,
    reasons,
  };
}

async function detectSuspiciousPatterns(bookingData: any): Promise<string[]> {
  const patterns: string[] = [];
  
  // Sequential booking times
  const recentBookings = await getRecentBookingsForPhone(bookingData.customer.mobile_number);
  if (hasSequentialTimes(recentBookings)) {
    patterns.push('Sequential booking times detected');
  }
  
  // Same name variations
  if (hasNameVariations(recentBookings)) {
    patterns.push('Multiple name variations for same phone');
  }
  
  // Bulk Sunday lunch orders
  if (bookingData.booking_type === 'sunday_lunch' && bookingData.items?.length > 10) {
    patterns.push('Unusually large Sunday lunch order');
  }
  
  return patterns;
}
```

### 4. Middleware Integration

```typescript
// /app/api/table-bookings/route.ts
import { tableBookingRateLimit } from '@/lib/middleware/table-booking-rate-limit';
import { checkBookingCreationLimits } from '@/lib/middleware/booking-creation-limits';
import { detectBookingFraud } from '@/lib/security/booking-fraud-detection';

export async function POST(request: NextRequest) {
  // 1. Apply rate limiting
  const rateLimitResponse = await tableBookingRateLimit(
    request,
    'POST /api/table-bookings'
  );
  if (rateLimitResponse) return rateLimitResponse;
  
  const body = await request.json();
  
  // 2. Check booking creation limits
  const limitsCheck = await checkBookingCreationLimits(
    {
      phone: body.customer.mobile_number,
      email: body.customer.email,
    },
    body.booking_type
  );
  
  if (!limitsCheck.allowed) {
    return createErrorResponse(
      limitsCheck.reason!,
      'BOOKING_LIMIT_EXCEEDED',
      429
    );
  }
  
  // 3. Fraud detection
  const fraudCheck = await detectBookingFraud(request, body);
  if (fraudCheck.suspicious) {
    // Log for manual review
    await logSuspiciousActivity(request, body, fraudCheck.reasons);
    
    // Soft block - require additional verification
    if (fraudCheck.reasons.includes('Known bad actor')) {
      return createErrorResponse(
        'Booking requires manual verification',
        'VERIFICATION_REQUIRED',
        403
      );
    }
  }
  
  // Continue with booking creation...
}
```

## Monitoring and Alerts

### 1. Rate Limit Metrics

```typescript
// Track rate limit hits
export async function trackRateLimitHit(
  endpoint: string,
  identifier: string
): Promise<void> {
  await redis.hincrby('rate_limit:hits', `${endpoint}:${identifier}`, 1);
  
  // Alert on excessive hits
  const hits = await redis.hget('rate_limit:hits', `${endpoint}:${identifier}`);
  if (parseInt(hits) > 100) {
    await sendAlert({
      type: 'RATE_LIMIT_ABUSE',
      endpoint,
      identifier,
      hits: parseInt(hits),
    });
  }
}
```

### 2. Dashboard Metrics

```typescript
// Real-time rate limit dashboard
export async function getRateLimitMetrics(): Promise<RateLimitMetrics> {
  const keys = await redis.keys('rate_limit:table_booking:*');
  const metrics: RateLimitMetrics = {
    activeWindows: keys.length,
    topEndpoints: {},
    blockedRequests: 0,
  };
  
  // Aggregate by endpoint
  for (const key of keys) {
    const [, , endpoint] = key.split(':');
    metrics.topEndpoints[endpoint] = (metrics.topEndpoints[endpoint] || 0) + 1;
  }
  
  // Get blocked count
  const blocked = await redis.get('rate_limit:blocked:count');
  metrics.blockedRequests = parseInt(blocked || '0');
  
  return metrics;
}
```

## Best Practices

### 1. Graceful Degradation
- Provide clear error messages with retry times
- Include rate limit headers in all responses
- Offer alternative booking methods when limited

### 2. Fair Usage
- Higher limits for authenticated API keys
- Lower limits for unauthenticated requests
- Premium tiers with increased limits

### 3. Security Considerations
- Never expose internal rate limit keys
- Use secure hashing for identifiers
- Implement circuit breakers for downstream services

## Testing Rate Limits

```typescript
// Test helpers
export async function simulateRateLimitScenario(
  endpoint: string,
  requests: number
): Promise<RateLimitTestResult> {
  const results: RateLimitTestResult = {
    allowed: 0,
    blocked: 0,
    averageResponseTime: 0,
  };
  
  const times: number[] = [];
  
  for (let i = 0; i < requests; i++) {
    const start = Date.now();
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'X-API-Key': 'test-key' },
      body: JSON.stringify(mockBookingData()),
    });
    
    times.push(Date.now() - start);
    
    if (response.status === 429) {
      results.blocked++;
    } else {
      results.allowed++;
    }
    
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  results.averageResponseTime = times.reduce((a, b) => a + b, 0) / times.length;
  
  return results;
}
```