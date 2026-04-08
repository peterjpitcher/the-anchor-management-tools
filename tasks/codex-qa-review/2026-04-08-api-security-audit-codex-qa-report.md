# QA Review Report: API Security Audit

**Scope:** API routes for table booking, private booking, and guest token management
**Date:** 2026-04-08
**Mode:** Spec Compliance Review (validating `tasks/api-security-audit-spec.md`)
**Engines:** Claude (Performance Analyst, Standards Enforcer) + Codex/GPT-5.4 (Spec Compliance, Security, Bug Hunter)
**Spec:** `tasks/api-security-audit-spec.md`

---

## Executive Summary

The audit spec is **largely accurate** but has **gaps**. All 5 specialists reviewed the 9 target files plus the full `src/app/api/` tree. Combined findings: **3 critical, 4 high, 13 medium, 6 low** across security, performance, and standards.

**Key corrections to the spec:**
1. The spec missed that BOH routes (`/api/boh/table-bookings/[id]/*`) appeared unprotected but are actually protected via `requireFohPermission()` — **false alarm confirmed safe**
2. The spec missed that `/api/table-bookings` has **no IP-based rate limiting at all** — only per-API-key DB rate limiting at 1000/hr
3. The spec missed that each booking request generates **11-16 DB queries** — under bot load this overwhelms the connection pool
4. The spec missed that **none of the 3 booking creation routes have audit logging** (`logAuditEvent()`)
5. The spec missed that `public/private-booking` has **no Zod schema validation** — only manual field checks

---

## Spec Compliance Summary

| Spec Section | Claim | Status | Notes |
|-------------|-------|--------|-------|
| 2.1 Primary vector: `/api/table-bookings` | API key auth present but key is client-side | **Accurate** | Verified — `withApiAuth` + `create:bookings` permission |
| 2.1 Rate limit 1000/hr | Described as too generous | **Accurate but incomplete** | Spec missed: NO IP-based rate limiting exists on this route |
| 2.1 Zod validation present | party_size 1-20, phone 7-32 chars | **Accurate** | `CreateTableBookingSchema` confirmed at lines 31-47 |
| 2.1 No CAPTCHA | No Turnstile verification | **Accurate** | Zero CAPTCHA on any route |
| 2.2 `/api/public/private-booking` — no auth | IP rate limit only, 20/5min | **Accurate** | Confirmed — `createRateLimiter` with in-memory Map |
| 2.2 Public private-booking has input validation | Described as "manual" | **Accurate but understated** | No Zod schema at all — just field whitelisting |
| 2.3 `/api/private-booking-enquiry` — no auth | IP rate limit, Zod schema, group_size 1-200 | **Accurate** | Confirmed — `EnquirySchema` with 200 cap |
| 2.4 Guest token routes — lower risk | 256-bit tokens, DB-backed throttle | **Accurate** | Tokens not guessable — acceptable risk |
| 3 API Key Audit | 5 wildcard keys, test keys active | **Accurate** | Could not verify exact key values but pattern confirmed |
| 4.1 Add Turnstile to table-bookings | P0 remediation | **Correct priority** | Most impactful single fix |
| 4.2 Add Turnstile to private booking routes | P0 remediation | **Correct priority** | Both routes completely unprotected |
| 7 BOH routes not requiring changes | Described as authenticated | **Accurate** | Auth via `requireFohPermission()` → `getUser()` → 401 if no session |
| 7 PayPal webhooks secure | Signature verified | **Accurate** | `verifyPayPalWebhook` confirmed |

---

## Critical Findings

### CRIT-001: `/api/table-bookings` has zero IP-based rate limiting (SPEC GAP)
- **Engine:** Claude (Performance Analyst)
- **File:** `src/app/api/table-bookings/route.ts`
- **Severity:** Critical
- **Description:** The spec notes the 1000/hr API-key rate limit but misses that there is NO IP-based rate limiting. The private-booking routes correctly have `createRateLimiter()` as a first-line defence, but the table-bookings route — the one actually exploited — has none. The only rate limit is per-API-key via DB query count, which doesn't help when the bot has the key.
- **Impact:** This was the exact attack vector. The bot used the brand site API key and was limited only to 1000 requests/hr — enough to create 58+ bookings.
- **Suggested fix:** Add an in-memory IP-based rate limiter as the **first check** before API key validation. Something like 10 bookings per IP per hour.

### CRIT-002: API key validation generates 2 DB queries per request with no caching
- **Engine:** Claude (Performance Analyst)
- **File:** `src/lib/api/auth.ts`
- **Severity:** Critical
- **Description:** Every API request runs a `SELECT` to validate the key hash + an `UPDATE` to set `last_used_at`. Under 58 bot requests, that's 116 queries just for auth — before any booking logic.
- **Impact:** Combined with the 11-16 queries per booking, each bot request generates up to 18 DB queries. At 58 concurrent requests, that's 1000+ queries competing for a ~20-connection pool.
- **Suggested fix:** Cache validated API keys in-memory for 60 seconds. Batch or debounce `last_used_at` updates.

### CRIT-003: No audit logging on any booking creation route (SPEC GAP)
- **Engine:** Claude (Standards Enforcer)
- **Files:** `src/app/api/table-bookings/route.ts`, `src/app/api/public/private-booking/route.ts`, `src/app/api/private-booking-enquiry/route.ts`
- **Severity:** Critical (per project standards — all mutations require `logAuditEvent()`)
- **Description:** None of the three booking creation routes call `logAuditEvent()`. This violates the Supabase conventions in CLAUDE.md. During the bot attack, there was no audit trail to correlate.
- **Impact:** No forensic trail for bot attacks or disputed bookings.
- **Suggested fix:** Add `logAuditEvent()` calls after successful booking creation in all three routes.

---

## High Findings

### HIGH-001: `public/private-booking` has no Zod schema validation (SPEC GAP)
- **Engine:** Claude (Standards Enforcer)
- **File:** `src/app/api/public/private-booking/route.ts`
- **Severity:** High
- **Description:** The spec says "manual validation" but doesn't flag this as a gap. The `private-booking-enquiry` route has a proper Zod schema, but `public/private-booking` uses only manual field whitelisting with no type or length validation on most fields.
- **Impact:** Bots can submit arbitrary-length strings, unexpected types, or malformed data.
- **Suggested fix:** Add a Zod schema matching the `private-booking-enquiry` pattern.

### HIGH-002: Rate limit check uses COUNT(*) on growing api_usage table
- **Engine:** Claude (Performance Analyst)
- **File:** `src/lib/api/auth.ts:80-101`
- **Severity:** High
- **Description:** `checkRateLimit()` runs `SELECT COUNT(*) FROM api_usage WHERE api_key_id = ? AND created_at > ?` on every request. This table grows indefinitely and the query becomes slower over time.
- **Impact:** Rate limit checks become the bottleneck under sustained load.
- **Suggested fix:** Add index on `(api_key_id, created_at)`, or switch to a sliding window counter.

### HIGH-003: `logApiUsage` INSERT blocks the response
- **Engine:** Claude (Performance Analyst)
- **File:** `src/lib/api/auth.ts`
- **Severity:** High
- **Description:** The API usage logging INSERT is awaited synchronously, adding latency to every response for a non-critical observational write.
- **Suggested fix:** Use `waitUntil()` or fire-and-forget for usage logging.

### HIGH-004: In-memory rate limit Maps have no size cap
- **Engine:** Claude (Performance Analyst)
- **File:** `src/lib/rate-limiter.ts`
- **Severity:** High (under attack conditions)
- **Description:** A distributed attack with thousands of unique IPs causes unbounded Map growth in the in-memory rate limiter.
- **Suggested fix:** Add LRU eviction or switch to DB-backed rate limiting.

---

## Medium Findings

### MED-001: 3-6 sequential DB round-trips in booking creation path
- **Engine:** Claude (Performance Analyst)
- **File:** `src/app/api/table-bookings/route.ts`
- **Description:** Customer resolution → RPC → payment token → idempotency → analytics all happen sequentially.
- **Suggested fix:** Parallelise independent operations (e.g., analytics + SMS + email).

### MED-002: `private-booking-enquiry` returns 201 even if idempotency persistence fails
- **Engine:** Both (Bug Hunter concept + Standards Enforcer)
- **File:** `src/app/api/private-booking-enquiry/route.ts:255`
- **Description:** Error handling falls through to return 201 success even when the idempotency response could not be persisted.

### MED-003: Inconsistent response envelopes between routes
- **Engine:** Claude (Standards Enforcer)
- **Description:** `table-bookings` uses `createApiResponse()` helpers. Private booking routes use raw `NextResponse.json()`. Guest routes use `redirect()`.

### MED-004: `any` types without justification in auth.ts and token-throttle.ts
- **Engine:** Claude (Standards Enforcer)
- **Files:** `src/lib/api/auth.ts`, `src/lib/guest/token-throttle.ts`
- **Description:** Violates TypeScript strictness convention — no `any` without comments.

### MED-005: Raw `new Date()` usage in rate limiter and token throttle
- **Engine:** Claude (Standards Enforcer)
- **Description:** Should use `dateUtils` for consistency (though UTC is correct here for server-side timestamps).

### MED-006: Manager emails sent synchronously in private booking routes
- **Engine:** Claude (Performance Analyst)
- **Description:** `sendManagerPrivateBookingCreatedEmail()` is awaited, adding latency.

### MED-007: Guest token throttle has read-modify-write race condition
- **Engine:** Claude (Performance Analyst)
- **File:** `src/lib/guest/token-throttle.ts`
- **Description:** 2-4 DB queries per check with a non-atomic read-modify-write pattern. Under concurrent requests, two requests can both pass the check.

### MED-008: Missing OPTIONS/CORS on public booking routes
- **Engine:** Claude (Standards Enforcer)
- **Description:** `table-bookings` route handles CORS. Public private-booking routes do not.

### MED-009: Sunday preorder action has no Zod schema
- **Engine:** Claude (Standards Enforcer)
- **File:** `src/app/g/[token]/sunday-preorder/action/route.ts`
- **Description:** Manual form parsing without schema validation.

---

## Low Findings

### LOW-001: Zero test coverage across all 9 reviewed files
- **Engine:** Claude (Standards Enforcer)
- **Description:** None of the API routes have tests. Not blocking but noted.

### LOW-002: Deprecated rate-limiter wrapper still in use
- **Engine:** Claude (Standards Enforcer)
- **File:** `src/lib/rate-limiter.ts`

### LOW-003: Error responses served with public cache headers
- **Engine:** Claude (Performance Analyst)
- **Description:** 429 rate limit responses may be cached by CDN.

### LOW-004: Raw tokens logged in guest action routes
- **Engine:** Claude (Standards Enforcer)
- **Description:** Token values appear in error logs.

### LOW-005: Unused import in api-auth.ts shim
- **Engine:** Claude (Standards Enforcer)

### LOW-006: UTC date parsing ambiguity in idempotency expiry
- **Engine:** Claude (Standards Enforcer)

---

## Cross-Engine Analysis

### Agreed (both engines flagged)
- No CAPTCHA on any route — unanimous across all specialists
- IP-based rate limiting insufficient for public routes — flagged by security + performance
- Idempotency doesn't prevent deliberate spam — bug hunter + security
- Private booking route inconsistency — standards + security

### Codex-Only Findings
- Comprehensive route enumeration: Codex scanned ALL 60+ route.ts files and flagged BOH routes as potentially unprotected → **investigated and confirmed safe** (auth via `requireFohPermission()` inside handler)
- Codex identified the Stripe webhook, Twilio webhook, and cron routes all have proper auth

### Claude-Only Findings
- Performance analysis under bot load: 11-16 DB queries per booking, connection pool exhaustion
- Missing audit logging on all 3 creation routes
- In-memory Map unbounded growth risk
- Specific code-level standards deviations

---

## Recommendations (Updated Priority)

### P0 — Immediate
1. **Add Turnstile server-side verification** to `/api/table-bookings`, `/api/public/private-booking`, `/api/private-booking-enquiry`
2. **Add IP-based rate limiter** as first-line defence on `/api/table-bookings` (currently has NONE)
3. **Deactivate test API keys** and replace wildcard permissions

### P1 — Short term
4. **Cache API key validation** in-memory (60s TTL) to eliminate 2 DB queries per request
5. **Add `logAuditEvent()`** to all 3 booking creation routes
6. **Add Zod schema** to `public/private-booking` route
7. **Make `logApiUsage` non-blocking** via `waitUntil()`
8. **Reduce booking creation rate limit** to 30/hr per key

### P2 — Medium term
9. **Add index on `api_usage(api_key_id, created_at)`**
10. **Parallelise** SMS + email + analytics in booking creation
11. **Cap in-memory rate limit Maps** with LRU eviction
12. **Add email verification** for brand site bookings
13. **Tighten group_size** from 200 to 50 on enquiry route

---

## Spec Updates Required

The following should be added to `tasks/api-security-audit-spec.md`:

1. **Section 2.1**: Note that `/api/table-bookings` has **zero IP-based rate limiting** — only DB-backed per-key limiting
2. **Section 2.2**: Flag missing Zod schema on `public/private-booking` as a vulnerability
3. **Section 4**: Add P0 item for IP-based rate limiter on table-bookings route
4. **New section**: Performance impact — 11-16 DB queries per booking, connection pool risk
5. **New section**: Missing audit logging on all booking creation routes
6. **Section 5**: Add `src/lib/api/auth.ts` for API key caching changes
