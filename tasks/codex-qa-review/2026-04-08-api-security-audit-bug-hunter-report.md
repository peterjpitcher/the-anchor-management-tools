### BUG-001: API-key rate limiting is non-atomic and fails open on usage-log errors
- File: [src/lib/api/auth.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/api/auth.ts#L80), [src/lib/api/auth.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/api/auth.ts#L242), [src/lib/api/auth.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/api/auth.ts#L279)
- Severity: Critical
- Category: Logic
- Description: `withApiAuth` checks `api_usage` before the handler runs and only records usage afterward. Concurrent requests on the same key all see the same pre-request count, and `safeLogApiUsage()` swallows insert failures, so accepted requests may never get counted.
- Impact: a leaked frontend API key can drive bursts far above quota, or effectively unlimited traffic if `api_usage` writes degrade.
- Suggested fix: consume quota atomically before running the mutation, and fail closed when rate-limit accounting is unavailable.

### BUG-002: Public private-booking rate limiting is per-process memory keyed by spoofable forwarding headers
- File: [src/lib/rate-limit.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/rate-limit.ts#L3), [src/lib/rate-limit.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/rate-limit.ts#L34), [src/app/api/public/private-booking/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/public/private-booking/route.ts#L31), [src/app/api/private-booking-enquiry/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/private-booking-enquiry/route.ts#L35)
- Severity: Critical
- Category: Logic
- Description: the limiter uses a local `Map` and the raw `x-forwarded-for`/`x-real-ip` header as the bucket key. Counters disappear on restart/scale-out, and callers can often mint fresh buckets by rotating proxies or spoofing forwarding headers.
- Impact: `/api/public/private-booking` and `/api/private-booking-enquiry` are easy to spam despite having nominal IP limits.
- Suggested fix: move these limits to a shared store with atomic increments and derive client IP only from trusted proxy/platform headers.

### BUG-003: POST `/api/table-bookings` responses are emitted as cacheable public responses
- File: [src/lib/api/auth.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/api/auth.ts#L128), [src/lib/api/auth.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/api/auth.ts#L140), [src/app/api/table-bookings/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/table-bookings/route.ts#L169)
- Severity: High
- Category: Logic
- Description: `createApiResponse()` treats a missing `method` as GET, so this POST route returns `Cache-Control: public, max-age=60` plus `ETag` on success, replay, and error responses because the route never passes `req.method`.
- Impact: intermediaries that honor explicit POST freshness can cache booking creation/auth responses and replay them across callers.
- Suggested fix: default unknown methods to `no-store`, or require write routes to pass the actual request method into the response helper.

### BUG-004: `/api/public/private-booking` accepts untyped payloads that can crash inside `createBooking`
- File: [src/app/api/public/private-booking/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/public/private-booking/route.ts#L65), [src/app/api/public/private-booking/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/public/private-booking/route.ts#L158), [src/services/private-bookings/mutations.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/private-bookings/mutations.ts#L116), [src/services/private-bookings/types.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/private-bookings/types.ts#L118)
- Severity: High
- Category: Edge Case
- Description: the route reads `body` as `any` and does only ad hoc checks. Non-object JSON, numeric `contact_phone`, malformed `event_date`, or malformed `items` can reach `createBooking`, where `.trim()`, `new Date(...)`, or RPC casts can throw.
- Impact: bots can turn validation misses into 500s and noisy logs, and some failures can occur after earlier side effects such as customer resolution.
- Suggested fix: validate the public payload with a strict Zod schema before idempotency claim/service entry, using only the normalized, whitelisted fields that will actually be persisted.

### BUG-005: `/api/private-booking-enquiry` silently fabricates a real schedule for bad or missing `date_time`
- File: [src/app/api/private-booking-enquiry/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/private-booking-enquiry/route.ts#L18), [src/app/api/private-booking-enquiry/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/private-booking-enquiry/route.ts#L62), [src/services/private-bookings/mutations.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/private-bookings/mutations.ts#L116)
- Severity: High
- Category: Data Integrity
- Description: `date_time` is any string, and invalid values are silently ignored by `resolveDateAndTime()`. `createBooking()` then defaults missing schedule data to today's date and `12:00`.
- Impact: malformed or genuinely-TBD enquiries are stored as real events at noon today, corrupting holds, notifications, and calendar behavior.
- Suggested fix: reject invalid `date_time`, and use an explicit TBD flag when no schedule is supplied instead of defaulting to a real timestamp.

### BUG-006: Post-commit idempotency failures leave booking requests stuck in `processing`
- File: [src/lib/api/idempotency.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/api/idempotency.ts#L118), [src/app/api/table-bookings/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/table-bookings/route.ts#L239), [src/app/api/table-bookings/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/table-bookings/route.ts#L415), [src/app/api/public/private-booking/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/public/private-booking/route.ts#L231), [src/app/api/private-booking-enquiry/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/private-booking-enquiry/route.ts#L243)
- Severity: Critical
- Category: Partial Failure
- Description: all three creation routes claim the idempotency row as `{ state: 'processing' }`. If the booking commits and then payment-link generation or `persistIdempotencyResponse()` fails, the route returns `500` or `201` without writing a terminal record and without releasing the claim.
- Impact: same-key retries return `409`/`IDEMPOTENCY_KEY_IN_PROGRESS` for up to 24 hours even though a booking already exists, so clients cannot recover the booking reference or payment link via idempotent retry.
- Suggested fix: make booking creation and idempotency persistence atomic, or persist an explicit terminal success/error record on every post-commit exit before returning.

### BUG-007: Guest-token throttling undercounts concurrent requests
- File: [src/lib/guest/token-throttle.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/guest/token-throttle.ts#L154), [src/lib/guest/token-throttle.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/guest/token-throttle.ts#L167), [src/lib/guest/token-throttle.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/guest/token-throttle.ts#L197), [src/app/g/[token]/table-manage/action/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/g/[token]/table-manage/action/route.ts#L25), [src/app/g/[token]/sunday-preorder/action/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/g/[token]/sunday-preorder/action/route.ts#L16), [src/app/g/[token]/manage-booking/action/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/g/[token]/manage-booking/action/route.ts#L57)
- Severity: High
- Category: Async
- Description: `checkGuestTokenThrottle()` does a read/append/write over `rate_limits.requests` with no row lock or atomic upsert. Parallel requests with the same token/IP can overwrite each other's increments.
- Impact: bursts against guest booking-management actions can exceed `maxAttempts` while still being allowed.
- Suggested fix: move counting into a transactional SQL function or shared-store atomic primitive that locks the row and returns the new attempt count.