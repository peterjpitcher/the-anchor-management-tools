# Production Rate Limiting Implementation Guide

This project uses built-in application limiters and a Supabase-backed sliding-window limiter.

## Current Implementation

- `src/lib/rate-limit.ts`: API helper with process-local in-memory limits.
- `src/lib/rate-limit-server.ts`: server-action helper with process-local in-memory limits.
- `src/lib/rate-limiter.ts`: persistent limiter backed by the `rate_limits` table in Supabase.

## Recommended Usage

Use `src/lib/rate-limiter.ts` for any endpoint that must enforce limits across instances.

```typescript
import { checkRateLimit, rateLimitConfigs } from '@/lib/rate-limiter'

const result = await checkRateLimit(identifier, rateLimitConfigs.publicApi)
if (!result.allowed) {
  return new Response('Too many requests', { status: 429 })
}
```

## Environment Requirements

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## Operational Notes

- In-memory limiters reset on process restart.
- Shared enforcement should use the Supabase-backed limiter.
- Run periodic cleanup of stale `rate_limits` rows via the existing cleanup cron endpoint.
