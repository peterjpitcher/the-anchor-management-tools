# API Security Audit: Table Booking Bot Attack

**Date:** 2026-04-08
**Status:** QA-validated, implementation in progress
**QA Review:** `tasks/codex-qa-review/2026-04-08-api-security-audit-codex-qa-report.md`
**Trigger:** Bot attack created 58+ fake table bookings, fake parking bookings, and fake private bookings via the brand site integration

---

## 1. Incident Summary

On 8 April 2026, bots exploited the public-facing table booking API to create dozens of fake bookings. The attack came in three waves between 04:09 and 15:05 UTC. All fake bookings originated from `source: brand_site` via `POST /api/table-bookings`.

**Bot fingerprints:**
- Slovenian (+386), Indonesian (+62), Venezuelan (+58), Tanzanian (+255) phone numbers
- Gibberish names: "dscdscds cdscsdc", "Άλι Άλι", "Ryy Gejd", Chinese character spam
- Email variants: all variations of `saya689` at gmail, plus `1@gmail.com`, `2@gmail.com`
- All bookings: party size 2-4, no dietary requirements, no deposits paid

**Impact:**
- 58 fake table bookings created (some for dates months in future)
- 2 fake parking bookings
- 1 fake private booking (draft)
- 39 fake customer records polluting the database
- Confirmed bookings consumed real table capacity, potentially blocking genuine customers

**Remediation applied so far:**
- Turnstile installed on the brand site frontend (stops casual form submission bots)
- All junk bookings and fake customers manually deleted from database

---

## 2. Attack Vector Analysis

### 2.1 Primary vector: `POST /api/table-bookings`

**File:** `src/app/api/table-bookings/route.ts` (449 lines)

The brand website calls this endpoint with an API key embedded in its frontend JavaScript. The bots extracted the API key from the brand site source code and replayed requests directly against the API.

**Current protections:**
- API key authentication via `withApiAuth()` — validates key hash, checks expiry, verifies `create:bookings` permission
- Per-key rate limiting — hourly count against `api_usage` table (default: 1000/hr)
- Idempotency-Key header required — prevents accidental duplicates but not deliberate spam (each request uses a different key)
- Zod input validation — party_size 1-20, phone 7-32 chars, date/time format checks

**Why this failed:**
- The API key is embedded client-side in the brand site — trivially extractable
- Rate limit of 1000/hr is far too generous for booking creation
- **No IP-based rate limiting at all** — only per-API-key DB rate limiting (QA finding CRIT-001)
- No CAPTCHA/Turnstile server-side verification
- No email or phone verification step
- Idempotency prevents replays but not unique spam requests
- Each booking request generates **11-16 DB queries** — 58 concurrent requests overwhelm the connection pool (QA finding CRIT-002)
- **No audit logging** via `logAuditEvent()` — violates project standards (QA finding CRIT-003)

### 2.2 Secondary vector: `POST /api/public/private-booking`

**File:** `src/app/api/public/private-booking/route.ts` (277 lines)

**Current protections:**
- IP-based rate limiting only: 20 requests per 5 minutes (in-memory)
- Idempotency-Key header required
- Manual field whitelisting (status, source set server-side)

**Vulnerabilities:**
- No authentication whatsoever
- No CAPTCHA/Turnstile
- IP rate limiting trivially bypassed with proxy rotation
- **No Zod schema** — only manual field whitelisting, no type or length validation (QA finding HIGH-001)
- Creates draft private bookings AND sends manager notification emails
- No audit logging via `logAuditEvent()`

### 2.3 Secondary vector: `POST /api/private-booking-enquiry`

**File:** `src/app/api/private-booking-enquiry/route.ts` (281 lines)

**Current protections:**
- IP-based rate limiting only: 20 requests per 5 minutes (in-memory)
- Idempotency-Key header required
- Zod schema validation (group_size 1-200, phone min 5 chars)

**Vulnerabilities:**
- No authentication whatsoever
- No CAPTCHA/Turnstile
- IP rate limiting trivially bypassed with proxy rotation
- Allows group_size up to 200 (should be capped lower)
- Creates draft private bookings AND sends manager notification emails
- Error handling returns 201 even if idempotency persistence fails (line 255)

### 2.4 Guest token routes (lower risk)

**Files:**
- `src/app/g/[token]/table-manage/action/route.ts` (85 lines) — update/cancel table bookings
- `src/app/g/[token]/sunday-preorder/action/route.ts` (74 lines) — submit preorders
- `src/app/g/[token]/manage-booking/action/route.ts` (274 lines) — cancel events, request refunds

**Current protections:**
- Guest token required in URL (256-bit random, SHA256 hashed)
- Database-backed throttling: 10-12 attempts per 15 minutes per token+IP
- Fail-closed in production (blocks on DB error)

**Risk assessment:** Lower priority — tokens are not guessable (256-bit entropy). Risk only materialises if tokens leak (e.g., from SMS links shared publicly).

---

## 3. API Key Audit

Queried from `api_keys` table on 2026-04-08:

| Key Name | Permissions | Rate Limit | Active | Issue |
|----------|-------------|------------|--------|-------|
| `website` | `*` (wildcard) | 1000/hr | Yes | **Wildcard perms — over-privileged** |
| `Website integration` | `*` | 1000/hr | Yes | **Wildcard perms — over-privileged** |
| `Music Bing App` | `*` | 1000/hr | Yes | **Typo name, wildcard perms — likely unused** |
| `Music Bingo App` | `*` | 1000/hr | Yes | **Wildcard perms** |
| `Test` | `*` | 1000/hr | Yes | **Test key active in prod with wildcard** |
| `test` | `*` | 1000/hr | Yes | **Test key active in prod with wildcard** |
| `Development API Key` (x3) | Various scoped | 1000/hr | Yes | **Dev keys active in prod** |
| `cheersai` | `read:menu`, `read:events` | 1000/hr | Yes | Fine — read-only |

**5 of 10 keys have wildcard `*` permissions** — any of them can create bookings, delete data, access all endpoints.

---

## 4. Remediation Plan

### P0 — Immediate (stop the active attack)

#### 4.1 Add Turnstile server-side verification to `POST /api/table-bookings`

The brand site now sends a Turnstile token. The API must verify it server-side before processing.

- Add `cf-turnstile-response` field to the request body or header
- Call Cloudflare's `https://challenges.cloudflare.com/turnstile/v0/siteverify` endpoint
- Reject requests with missing or invalid tokens
- Store `TURNSTILE_SECRET_KEY` as an environment variable
- Create a shared utility `src/lib/turnstile.ts` for reuse across routes

#### 4.2 Add Turnstile to public private booking routes

Apply the same Turnstile verification to:
- `POST /api/public/private-booking`
- `POST /api/private-booking-enquiry`

#### 4.3 Deactivate unused API keys

Immediately deactivate:
- `Test` and `test` — test keys should not be active in production
- `Music Bing App` — appears to be a typo/duplicate of `Music Bingo App`

### P1 — Short term (harden the API)

#### 4.4 Replace wildcard API key permissions

Replace `*` with scoped permissions on:
- `website` → `read:events`, `read:menu`, `read:business`, `create:bookings`, `read:customers`, `write:customers`
- `Website integration` → same as above
- `Music Bingo App` → scope to what it actually needs

#### 4.5 Reduce rate limits for booking creation

The `create:bookings` action should have a much tighter limit:
- Brand site key: 30/hr max (a busy pub won't get 30 online bookings per hour)
- Default rate limit for new keys: 100/hr (down from 1000/hr)

#### 4.6 Add per-phone rate limiting

Before calling the booking RPC, check if this phone number has created a booking in the last N minutes. This prevents a single bot from creating multiple bookings even with valid credentials.

### P2 — Medium term (defence in depth)

#### 4.7 Add email verification for brand site bookings

Require email confirmation before a booking is marked `confirmed`. Booking sits in `pending_verification` status until the customer clicks a link.

#### 4.8 Tighten input validation

- `private-booking-enquiry`: reduce `group_size` max from 200 to a sensible cap (e.g., 50)
- Add phone number country code validation — reject numbers from countries with no realistic booking connection (e.g., Slovenian numbers for a UK pub)
- Validate email format more strictly on public endpoints

#### 4.9 Improve rate limiting infrastructure

- Move from in-memory rate limiting to database-backed (or Redis/Upstash) for the public endpoints
- Add sliding window instead of fixed window
- Add per-IP daily limits alongside per-window limits

---

## 5. Files Requiring Changes

| File | Change | Priority |
|------|--------|----------|
| `src/lib/turnstile.ts` | **New** — shared Turnstile verification utility | P0 |
| `src/app/api/table-bookings/route.ts` | Add Turnstile verification before booking creation | P0 |
| `src/app/api/public/private-booking/route.ts` | Add Turnstile verification | P0 |
| `src/app/api/private-booking-enquiry/route.ts` | Add Turnstile verification | P0 |
| Database: `api_keys` table | Deactivate test keys, scope wildcard permissions | P1 |
| `src/app/api/table-bookings/route.ts` | Add per-phone rate limiting | P1 |
| `src/app/api/private-booking-enquiry/route.ts` | Reduce group_size max to 50 | P2 |

---

## 6. Environment Variables Required

```
TURNSTILE_SECRET_KEY    # Cloudflare Turnstile secret key (server-side verification)
```

This must be added to Vercel environment variables and `.env.example`.

---

## 7. Endpoints NOT Requiring Changes

| Endpoint | Reason |
|----------|--------|
| `POST /api/table-bookings` (API key auth) | Auth works correctly — issue is client-side key exposure, solved by Turnstile |
| `GET /api/events/*` | Read-only, no abuse risk |
| `GET /api/menu/*` | Read-only, no abuse risk |
| `POST /api/webhooks/paypal/*` | PayPal signature verified — cannot forge |
| `POST /api/foh/*` | Authenticated user session required — not public |
| `/g/[token]/*` routes | 256-bit tokens not guessable — acceptable risk |
