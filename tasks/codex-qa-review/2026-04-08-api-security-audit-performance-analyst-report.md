# Performance Analyst Report: Table Booking API Routes Under Bot Attack Load

**Date:** 2026-04-08
**Scope:** API routes for table booking creation and supporting infrastructure
**Context:** Bot attack created 58+ fake bookings via rapid requests to the table-bookings endpoint

---

## Executive Summary

The table-bookings endpoint (`/api/table-bookings/route.ts`) is the most expensive public-facing route in the application. Each successful request triggers up to **8 sequential/parallel DB operations**, an SMS send, an email send, and an analytics write -- all before returning a response. Under bot load, the primary bottleneck is the `withApiAuth` middleware which performs **3 sequential DB round-trips** (validate key, update last_used_at, count api_usage rows) before business logic even starts. The public private-booking endpoints have in-memory rate limiting but the table-bookings endpoint relies entirely on DB-backed rate limiting, making it the slowest to reject abusive traffic.

---

## Findings

### PERF-001: API key validation performs 2 sequential DB queries on every request

- **File:** `src/lib/api/auth.ts:26-76`
- **Severity:** Critical
- **Category:** Database
- **Impact:** Adds 40-100ms latency to every authenticated API request. Under 58 concurrent bot requests, this creates 116+ unnecessary DB queries (58 SELECT + 58 UPDATE) before any rate limiting is checked. During the bot attack, these queries consumed connection pool capacity needed by legitimate requests.
- **Description:** `validateApiKey()` first queries `api_keys` to look up the key hash (line 35-39), then unconditionally runs a second UPDATE query to set `last_used_at` (line 63-68). The UPDATE is fire-and-forget useful only for auditing, but it blocks the response. There is no caching -- even the same API key hitting the endpoint 58 times in 10 seconds will run 116 DB queries just for authentication.
- **Suggested fix:**
  1. Cache validated API keys in an in-memory LRU cache (e.g., `Map` with TTL of 60 seconds). The `api_keys` table changes rarely -- a 60s cache eliminates 99%+ of validation queries under bot load.
  2. Move the `last_used_at` UPDATE to a fire-and-forget `void` call (do not `await` it) or batch it, since it is non-critical.
  3. At minimum, move the UPDATE after the handler completes (alongside `logApiUsage`) so it does not block the request path.

### PERF-002: DB-backed rate limiting counts rows with SELECT COUNT on every request

- **File:** `src/lib/api/auth.ts:80-101`
- **Severity:** Critical
- **Category:** Database
- **Impact:** Each rate limit check scans the `api_usage` table counting rows for the last hour. With 58 bot requests, this is 58 full COUNT queries on a table that grows unboundedly with usage. As the table grows, this query slows down linearly. Under sustained attack, the rate limiter itself becomes the bottleneck.
- **Description:** `checkRateLimit()` runs `SELECT *, count: exact, head: true` on `api_usage` filtered by `api_key_id` and `created_at >= oneHourAgo`. This is an O(n) scan per request where n is the number of usage rows in the last hour. The rate limiter is checked AFTER `validateApiKey` and its UPDATE, meaning 3 DB round-trips execute sequentially before business logic.
- **Suggested fix:**
  1. Replace DB-backed rate limiting with in-memory sliding window (the same `createRateLimiter` from `src/lib/rate-limit.ts` that the public endpoints already use). In-memory rate limiting is O(1) and zero-latency.
  2. If DB-backed limiting is required for multi-instance consistency, use a dedicated `rate_limits` counter table with atomic `UPDATE ... SET count = count + 1` instead of counting rows. Or use Upstash Redis.
  3. Move rate limit check BEFORE API key validation -- reject known-bad IPs immediately without touching the DB at all.

### PERF-003: logApiUsage inserts a row on every request, blocking the response

- **File:** `src/lib/api/auth.ts:103-126` and `src/lib/api/auth.ts:306-312`
- **Severity:** High
- **Category:** Database
- **Impact:** The `await logApiUsage()` call at line 306 blocks the response until the INSERT completes. Under 58 bot requests, this creates 58 INSERT operations that the client must wait for. The `api_usage` table also feeds the rate limiter (PERF-002), so these inserts increase the cost of subsequent rate limit checks.
- **Description:** `safeLogApiUsage` is called with `await` at line 306 inside `withApiAuth`. The response is already computed by this point -- the usage log is purely observational. The function also calls `await headers()` internally (line 111), adding another async operation.
- **Suggested fix:** Fire-and-forget the usage log: call `safeLogApiUsage(...)` without `await` (or use `void safeLogApiUsage(...)`). The function already catches errors internally. This removes one DB round-trip from the critical response path.

### PERF-004: table-bookings endpoint has no IP-based rate limiting

- **File:** `src/app/api/table-bookings/route.ts:102-448`
- **Severity:** Critical
- **Category:** Network
- **Impact:** The table-bookings endpoint relies entirely on API-key-based rate limiting via `withApiAuth`. A compromised or leaked API key allows unlimited requests because the rate limiter counts by API key, not by IP. The private-booking endpoints (`/api/public/private-booking` and `/api/private-booking-enquiry`) both have IP-based rate limiters (`createRateLimiter` with 20 requests per 5 minutes), but the table-bookings endpoint has zero IP-based protection. This is the exact vector exploited by the bot attack.
- **Description:** The `withApiAuth` wrapper (line 447) only checks API key permissions and API-key-scoped rate limits. If the API key has a high `rate_limit` value (e.g., 1000/hour), a bot with the key can create hundreds of bookings. The public endpoints add `createRateLimiter()` as a first check before any DB work, which is the correct pattern.
- **Suggested fix:** Add an in-memory IP-based rate limiter as the FIRST check in the POST handler, before `withApiAuth`. Example: `createRateLimiter({ windowMs: 60_000, max: 10 })`. This would have blocked the bot attack after 10 requests with zero DB load.

### PERF-005: Sequential DB operations in the critical booking path

- **File:** `src/app/api/table-bookings/route.ts:139-227`
- **Severity:** Medium
- **Category:** Database
- **Impact:** Each booking request executes in sequence: (1) `claimIdempotencyKey` -- 1-3 DB queries, (2) `ensureCustomerForPhone` -- 1-2 DB queries, (3) `create_table_booking_v05` RPC -- 1 DB call. These 3-6 sequential DB round-trips add 60-180ms before any SMS/email work begins. Under 58 concurrent requests, this is 174-1044 DB queries competing for the connection pool.
- **Description:** Steps 1-3 are inherently sequential (each depends on the previous result). However, the idempotency claim (step 1) involves up to 3 DB round-trips internally: INSERT attempt, SELECT on conflict, and retry INSERT/UPDATE. The `ensureCustomerForPhone` likely performs an UPSERT (SELECT + INSERT). These sequential operations hold a Supabase connection for the entire duration.
- **Suggested fix:**
  1. The idempotency claim is the most expensive part -- for the 23505 conflict path, it performs INSERT -> fail -> SELECT -> evaluate -> possibly UPDATE. Consider using a single `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` to reduce to 1 query.
  2. Connection pool exhaustion is the real risk under load. Add a concurrency semaphore (e.g., limit to 10 concurrent booking creations) to prevent connection pool starvation.

### PERF-006: Analytics writes block the response for confirmed/pending_payment bookings

- **File:** `src/app/api/table-bookings/route.ts:347-384`
- **Severity:** Medium
- **Category:** Database
- **Impact:** `await Promise.all(analyticsPromises)` on line 384 blocks the response until 1-2 analytics INSERT operations complete. These are non-critical observational writes.
- **Description:** After the booking is created, SMS sent, and email sent (all correctly parallelised via `Promise.allSettled` on line 271), the handler then blocks on analytics writes before building the response. Under bot load, this adds 10-30ms per request and 1-2 additional DB queries per booking.
- **Suggested fix:** Fire-and-forget analytics writes. Replace `await Promise.all(analyticsPromises)` with `void Promise.all(analyticsPromises)`. The `recordTableBookingAnalyticsSafe` function already catches and logs errors.

### PERF-007: In-memory rate limit Map has no size cap

- **File:** `src/lib/rate-limit.ts:4` and `src/lib/guest/token-throttle.ts:31`
- **Severity:** Medium
- **Category:** Memory
- **Impact:** Both `rateLimitStore` (rate-limit.ts) and `throttleStore` (token-throttle.ts) are unbounded `Map` objects. Under a distributed bot attack using thousands of unique IPs, each IP creates a new Map entry. The rate-limit.ts cleanup runs every 60 seconds via `setInterval`, but between cleanups, a burst of 10,000 unique IPs would create 10,000 entries. The token-throttle.ts cleanup only runs every 50th call (line 49-50), so entries accumulate faster.
- **Description:** The `rateLimitStore` Map is cleaned every 60 seconds (line 18-20). In a 60-second burst, entries accumulate unchecked. The `throttleStore` Map cleanup runs every 50 requests, which under bot load (50+ requests per second) means cleanup runs frequently enough, but between cleanups, stale entries persist. Neither Map has a maximum size limit.
- **Suggested fix:**
  1. Add a maximum size check: if `rateLimitStore.size > 50_000`, trigger an immediate cleanup before adding new entries.
  2. For `throttleStore`, reduce the cleanup interval from every 50th call to every 20th call, or add a size-based trigger.
  3. Consider using an LRU cache library (e.g., `lru-cache`) with a fixed max size instead of a plain `Map`.

### PERF-008: ETag computation on every non-GET response is wasted work

- **File:** `src/lib/api/auth.ts:160-164`
- **Severity:** Low
- **Category:** Network
- **Impact:** `createApiResponse` computes an ETag by JSON-serializing the entire payload and base64-encoding it for GET/OPTIONS responses. For POST responses (the majority for booking endpoints), the `isGet` guard correctly skips this. However, the guard defaults `method` to GET when not provided (line 140), meaning any call to `createApiResponse` without a `method` argument computes the ETag unnecessarily. The `createErrorResponse` function (line 172-189) calls `createApiResponse` without `method`, so all error responses compute ETags.
- **Description:** `createErrorResponse` does not pass a `method` parameter, so error responses for POST requests get `Cache-Control: public, max-age=60` and an ETag header. Error responses should not be cached publicly. Under bot load, 429 rate limit responses are being served with `Cache-Control: public, max-age=60`.
- **Suggested fix:** Pass `method` through `createErrorResponse`, or change the default `isGet` logic to require an explicit opt-in for caching. Error responses should always use `Cache-Control: no-store`.

### PERF-009: Guest token throttle performs 2-4 DB round-trips per check

- **File:** `src/lib/guest/token-throttle.ts:150-233`
- **Severity:** Medium
- **Category:** Database
- **Impact:** Each `checkGuestTokenThrottle()` call performs: (1) SELECT from `rate_limits`, (2) UPDATE or INSERT, and on INSERT conflict (3) SELECT + (4) UPDATE. Under bot load with unique tokens, every call takes the INSERT path (2 queries), and conflicts take 4 queries.
- **Description:** The throttle stores the full request timestamp array as a JSON column and reads/writes it on every check. This is a read-modify-write pattern without database-level atomicity (no `FOR UPDATE` lock), which under concurrent requests can lead to lost updates where two concurrent requests both read the same count and both pass the limit.
- **Suggested fix:**
  1. Add `FOR UPDATE` or use a Postgres advisory lock to prevent concurrent read-modify-write races.
  2. Consider replacing the JSON array approach with an atomic `UPDATE rate_limits SET request_count = request_count + 1 WHERE key = $1 AND window_start > now() - interval ... RETURNING request_count` pattern.
  3. For the production fail-closed path (line 254), also log the error so operators can detect when the DB throttle is silently degraded.

### PERF-010: Private booking endpoint sends manager email synchronously before persisting idempotency

- **File:** `src/app/api/public/private-booking/route.ts:183-204` and `src/app/api/private-booking-enquiry/route.ts:213-234`
- **Severity:** Medium
- **Category:** Network
- **Impact:** Both private booking endpoints `await` the manager email send before persisting the idempotency response. Microsoft Graph email API calls typically take 200-800ms. Under bot load, each fake booking blocks for the full email round-trip. With 58 bot requests, that is 58 sequential email API calls (one per request), totaling 12-46 seconds of cumulative external API wait time.
- **Description:** In `public/private-booking/route.ts`, the manager email (line 184) is awaited before the idempotency persist (line 232). In `private-booking-enquiry/route.ts`, analytics is awaited (line 199), then the manager email is awaited (line 214), then idempotency is persisted (line 244). Unlike the table-bookings endpoint which correctly uses `Promise.allSettled` to parallelise SMS and email, these endpoints send email sequentially.
- **Suggested fix:** Wrap the manager email send and analytics write in `Promise.allSettled` and run them in parallel, similar to the table-bookings endpoint pattern. Neither is critical to the response -- both already have error handling that logs and continues.

---

## Bottleneck Analysis Under Bot Attack (58+ requests)

### Request Processing Cost Per Booking (table-bookings endpoint)

| Phase | DB Queries | External Calls | Est. Latency |
|-------|-----------|----------------|-------------|
| `withApiAuth` (validate key) | 1 SELECT | - | 15-30ms |
| `withApiAuth` (update last_used) | 1 UPDATE | - | 10-20ms |
| `withApiAuth` (rate limit check) | 1 COUNT | - | 15-40ms |
| `claimIdempotencyKey` | 1-3 queries | - | 15-60ms |
| `ensureCustomerForPhone` | 1-2 queries | - | 10-30ms |
| `create_table_booking_v05` RPC | 1 RPC | - | 20-50ms |
| `createTablePaymentToken` | 1+ queries | - | 10-30ms |
| SMS + Email (parallel) | 1-2 queries | 2 API calls | 200-800ms |
| Analytics writes | 1-2 INSERTs | - | 10-20ms |
| `persistIdempotencyResponse` | 1 UPSERT | - | 10-20ms |
| `logApiUsage` | 1 INSERT | - | 10-20ms |
| **TOTAL** | **11-16 queries** | **2 external** | **325-1120ms** |

### Under 58 concurrent bot requests:
- **DB queries:** 638-928 queries competing for connection pool
- **SMS sends:** 58 Twilio API calls (at ~$0.05 each = ~$2.90 in SMS costs)
- **Email sends:** 58 Microsoft Graph API calls
- **Connection pool:** Supabase default pool is ~20 connections; 58 concurrent requests each holding a connection for 300ms+ will cause queuing and timeouts
- **Memory:** 58 new rate limit Map entries (negligible)

### Primary Bottleneck: Database connection pool exhaustion

With 11-16 queries per request and 58 concurrent requests, the connection pool saturates instantly. Subsequent requests queue, increasing latency exponentially. The rate limiter check (PERF-002) runs a COUNT query on a growing table, which becomes slower as the attack continues.

---

## Priority Remediation Order

1. **PERF-004** (Critical) -- Add IP-based rate limiting to table-bookings. Cheapest fix, highest impact. Blocks bot at the door.
2. **PERF-002** (Critical) -- Replace DB-backed rate limiting with in-memory. Eliminates the most expensive per-request query.
3. **PERF-001** (Critical) -- Cache API key validation. Eliminates 2 DB queries per request for repeated keys.
4. **PERF-003** (High) -- Fire-and-forget usage logging. Removes 1 DB query from the response path.
5. **PERF-006** (Medium) -- Fire-and-forget analytics. Removes 1-2 DB queries from the response path.
6. **PERF-010** (Medium) -- Parallelise email in private booking endpoints.
7. **PERF-005** (Medium) -- Simplify idempotency claim to fewer DB round-trips.
8. **PERF-009** (Medium) -- Fix guest token throttle race condition and reduce DB queries.
9. **PERF-007** (Medium) -- Cap in-memory Map sizes.
10. **PERF-008** (Low) -- Fix error response caching headers.

---

*Report generated by Performance Analyst specialist agent.*
