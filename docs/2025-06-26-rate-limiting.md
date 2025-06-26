# Rate Limiting Documentation

## Overview
The application implements distributed rate limiting using Upstash Redis to prevent abuse and ensure fair usage of resources.

## Implementation

### Rate Limiters
Different rate limiters are configured for various use cases:

1. **API Rate Limiting**: 10 requests per 10 seconds
2. **SMS Sending**: 5 messages per minute per phone number
3. **Bulk SMS**: 100 messages per hour
4. **Login Attempts**: 5 attempts per 15 minutes per IP
5. **Password Reset**: 3 requests per hour per email
6. **File Upload**: 20 uploads per hour per user
7. **Webhook Processing**: 100 requests per minute

### Setup Instructions

1. **Create Upstash Account**
   - Sign up at https://upstash.com
   - Create a new Redis database
   - Choose a region close to your application

2. **Configure Environment Variables**
   ```bash
   UPSTASH_REDIS_REST_URL=https://your-database.upstash.io
   UPSTASH_REDIS_REST_TOKEN=your-token
   ```

3. **Verify Configuration**
   - Rate limiting is automatically disabled if Upstash is not configured
   - In development, you'll see a warning if Redis is not configured
   - In production, rate limiting is highly recommended

## Usage

### SMS Rate Limiting
```typescript
// Automatically applied in sendSMS function
const result = await sendSMS(phoneNumber, message);
if (!result.success && result.error?.includes('Rate limit')) {
  // Handle rate limit error
}
```

### Server Action Rate Limiting
```typescript
import { withServerActionRateLimit } from '@/lib/upstash-rate-limit-server';

export const myAction = withServerActionRateLimit(
  async (formData: FormData) => {
    // Your action logic
  },
  { key: 'my-action', limiter: 'api' }
);
```

### Webhook Rate Limiting
Automatically applied to webhook endpoints:
- Returns 429 status code when rate limit exceeded
- Includes rate limit headers in response

## Rate Limit Headers

When rate limits are applied, the following headers are returned:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Requests remaining in window
- `X-RateLimit-Reset`: Time when limit resets (ISO 8601)
- `Retry-After`: Seconds until retry (on 429 responses)

## Monitoring

### Dashboard
Monitor rate limiting in Upstash dashboard:
- View current usage
- See rate limit hits
- Configure alerts

### Application Logs
Rate limit events are logged:
```
Rate limit exceeded for +447700900123. Remaining: 0
Webhook rate limit exceeded for 192.168.1.1
```

## Fallback Behavior

### Development
- If Upstash is not configured, rate limiting is disabled
- Warning logged: "Upstash Redis not configured"
- Allows development without Redis setup

### Production
- Rate limiting highly recommended
- Falls back gracefully if Redis is unavailable
- Errors logged but don't block requests

## Best Practices

1. **Choose Appropriate Limits**
   - Consider typical usage patterns
   - Allow for legitimate burst usage
   - Monitor and adjust based on data

2. **User Experience**
   - Show clear error messages
   - Display retry time
   - Consider implementing retry logic

3. **Security**
   - Use stricter limits for sensitive operations
   - Implement per-user limits where appropriate
   - Monitor for abuse patterns

## Testing Rate Limits

### Manual Testing
1. Send multiple requests quickly
2. Verify 429 response after limit
3. Check rate limit headers
4. Wait for reset and retry

### Load Testing
```bash
# Example using Apache Bench
ab -n 20 -c 5 https://your-app.com/api/endpoint
```

## Troubleshooting

### Rate Limits Not Working
1. Check environment variables are set
2. Verify Upstash database is active
3. Check for connection errors in logs

### Too Many False Positives
1. Review current limits
2. Check identifier logic (IP vs user ID)
3. Consider increasing limits

### Performance Issues
1. Ensure Redis region is close to app
2. Check Redis connection latency
3. Consider caching rate limit results