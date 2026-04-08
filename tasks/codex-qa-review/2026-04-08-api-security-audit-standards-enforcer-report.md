# API Security Audit - Standards Enforcer Report

**Date:** 2026-04-08
**Scope:** Booking-related API routes and supporting libraries
**Reviewer:** Standards Enforcement Specialist (Claude)

---

## Summary

Reviewed 9 files across the booking API surface area. The codebase shows generally strong patterns -- Zod validation, idempotency, rate limiting, and structured logging are well-established. However, there are meaningful deviations from the project's own documented standards, particularly around `any` type usage, missing audit logging, inconsistent response patterns between similar routes, and `console.*` usage in place of the structured logger.

**Findings:** 5 High, 8 Medium, 5 Low

---

## High Severity

### STD-001: `any` type on parsed body without justification

- **File:** `src/app/api/public/private-booking/route.ts:65`
- **Severity:** High
- **Standard:** CLAUDE.md TypeScript rules: "No `any` types unless absolutely justified with a comment"
- **Current code:**
  ```typescript
  let body: any;
  ```
  The entire route then accesses `body.customer_first_name`, `body.contact_phone`, etc. without Zod validation. This is the only booking creation route that does NOT use a Zod schema.
- **Expected:** Define a Zod schema (like `CreateTableBookingSchema` in `table-bookings/route.ts` or `EnquirySchema` in `private-booking-enquiry/route.ts`) and parse the body through it. This is a public-facing endpoint, making the absence of structured validation a security concern.

### STD-002: Missing Zod validation on public booking endpoint

- **File:** `src/app/api/public/private-booking/route.ts:148-177`
- **Severity:** High
- **Standard:** Definition of Done: "Input validation complete -- all user inputs sanitised (Zod or equivalent)"; UI Patterns: "Use React Hook Form + Zod for validation where configured"
- **Current code:** Manual `typeof` checks and inline whitelist construction instead of Zod schema validation. The only validation is `if (!body.customer_first_name || !(normalizedPhone || body.contact_phone))`.
- **Expected:** A Zod schema mirroring the whitelist fields with proper type constraints (max lengths, date regex patterns, numeric bounds on `guest_count`, etc.), consistent with the patterns in the other two booking creation routes.

### STD-003: `as any` casts on booking object passed to email function

- **File:** `src/app/api/public/private-booking/route.ts:185`
- **File:** `src/app/api/private-booking-enquiry/route.ts:215`
- **Severity:** High
- **Standard:** CLAUDE.md TypeScript rules: "No `any` types unless absolutely justified with a comment"
- **Current code:**
  ```typescript
  booking: booking as any,
  ```
  Both routes cast the booking to `any` when passing to `sendManagerPrivateBookingCreatedEmail`. There is no comment explaining why.
- **Expected:** Either fix the type signature of `sendManagerPrivateBookingCreatedEmail` to accept the actual return type from `PrivateBookingService.createBooking()`, or add a justification comment explaining the type mismatch.

### STD-004: `any` types in shared auth library without justification

- **File:** `src/lib/api/auth.ts:129`
- **File:** `src/lib/api/auth.ts:176`
- **Severity:** High
- **Standard:** CLAUDE.md TypeScript rules: "No `any` types unless absolutely justified with a comment"
- **Current code:**
  ```typescript
  export function createApiResponse(data: any, ...) {
  export function createErrorResponse(message: string, code: string, status: number = 400, details?: any) {
  ```
  These are widely-used utility functions where `any` propagates untyped data across the entire API surface.
- **Expected:** Use `unknown` for `data` in `createApiResponse` (callers already pass typed objects). Use `Record<string, unknown>` or a specific error detail type for `details` in `createErrorResponse`.

### STD-005: Missing audit logging on all three booking creation mutations

- **File:** `src/app/api/table-bookings/route.ts` (entire POST handler)
- **File:** `src/app/api/public/private-booking/route.ts` (entire POST handler)
- **File:** `src/app/api/private-booking-enquiry/route.ts` (entire POST handler)
- **Severity:** High
- **Standard:** Supabase conventions (`.claude/rules/supabase.md`): "All mutations (create, update, delete) in server actions must call `logAuditEvent()`"
- **Current code:** None of the three booking creation routes call `logAuditEvent()`. They do call `recordAnalyticsEvent()`, but analytics events and audit events serve different purposes (analytics is for product metrics; audit is for compliance and traceability).
- **Expected:** Each successful mutation should call `logAuditEvent()` with `operation_type: 'create'`, `resource_type: 'table_booking'` / `'private_booking'`, and `operation_status: 'success'`.

---

## Medium Severity

### STD-006: `console.*` usage instead of structured logger

- **File:** `src/lib/api/auth.ts:42,51,58,71,73,93,252`
- **Severity:** Medium
- **Standard:** Definition of Done: "No console.log or debug statements left in production code"
- **Current code:** Seven instances of `console.error` and `console.warn` throughout the auth library.
- **Expected:** Import and use the project's structured `logger` from `@/lib/logger` (as done in all the route files reviewed). This ensures log correlation, metadata, and proper severity levels in production.

### STD-007: `as any` cast in token-throttle without justification

- **File:** `src/lib/guest/token-throttle.ts:126`
- **File:** `src/lib/guest/token-throttle.ts:196`
- **Severity:** Medium
- **Standard:** CLAUDE.md TypeScript rules: "No `any` types unless absolutely justified with a comment"
- **Current code:**
  ```typescript
  const timestamp = Number((item as any)?.timestamp)
  if ((insertError as any)?.code === '23505') {
  ```
- **Expected:** For line 126, type `item` properly within the loop (e.g., `item as { timestamp?: unknown }`). For line 196, use the Supabase `PostgrestError` type which includes `code`.

### STD-008: Inconsistent response envelope between booking routes

- **File:** `src/app/api/table-bookings/route.ts` -- uses `createApiResponse()` / `createErrorResponse()` with structured error codes
- **File:** `src/app/api/public/private-booking/route.ts` -- uses `NextResponse.json()` with `{ success: false, error: string }`
- **File:** `src/app/api/private-booking-enquiry/route.ts` -- uses `NextResponse.json()` with `{ success: false, error: string }`
- **Severity:** Medium
- **Standard:** Consistency between similar routes (implicit in workspace conventions about following existing patterns)
- **Current code:** The table-bookings route wraps responses through `createApiResponse`/`createErrorResponse` which adds CORS headers, cache control, and structured error codes. The two private booking routes bypass this entirely, using raw `NextResponse.json()`.
- **Expected:** All public-facing booking routes should use the same response helpers for consistent CORS headers, error envelope structure, and cache control. The private-booking routes currently lack CORS headers entirely, which may cause failures when called from the brand site widget.

### STD-009: Missing explicit return types on exported functions

- **File:** `src/lib/api/auth.ts:16` -- `hashApiKey` returns `Promise<string>` (OK)
- **File:** `src/lib/api/auth.ts:20` -- `generateApiKey` returns `Promise<string>` (OK)
- **File:** `src/lib/api/auth.ts:128` -- `createApiResponse` has no explicit return type
- **File:** `src/lib/api/auth.ts:172` -- `createErrorResponse` has no explicit return type
- **File:** `src/lib/api/auth.ts:256` -- `withApiAuth` returns `Promise<Response>` (OK)
- **File:** `src/lib/api/auth.ts:103` -- `logApiUsage` has no explicit return type
- **Severity:** Medium
- **Standard:** CLAUDE.md TypeScript rules: "Explicit return types on all exported functions"
- **Expected:** Add `NextResponse` or `Response` return types to `createApiResponse` and `createErrorResponse`. Add `Promise<void>` to `logApiUsage`.

### STD-010: Date handling uses raw `new Date()` instead of dateUtils

- **File:** `src/lib/api/auth.ts:57`
- **File:** `src/lib/api/auth.ts:65`
- **File:** `src/lib/api/auth.ts:84`
- **Severity:** Medium
- **Standard:** CLAUDE.md Date Handling: "Never use raw `new Date()` or `.toISOString()` for user-facing dates. Default timezone: Europe/London."
- **Current code:**
  ```typescript
  if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
  .update({ last_used_at: new Date().toISOString() })
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  ```
  These are server-side comparisons and DB timestamps, not user-facing dates, so severity is medium rather than high. However, the standard is stated broadly.
- **Expected:** For DB timestamp writes, `new Date().toISOString()` is acceptable for UTC storage. For the expiry comparison on line 57, this is fine functionally but should use a consistent utility if the project standardizes on dateUtils for all date operations.

### STD-011: Missing OPTIONS handler on public booking routes

- **File:** `src/app/api/public/private-booking/route.ts` -- no OPTIONS export
- **File:** `src/app/api/private-booking-enquiry/route.ts` -- no OPTIONS export
- **Severity:** Medium
- **Standard:** Consistency with `src/app/api/table-bookings/route.ts` which exports `OPTIONS`
- **Current code:** The table-bookings route exports `OPTIONS` to handle CORS preflight. The other two public booking routes do not, which will cause CORS preflight failures from browser-based callers.
- **Expected:** Export an OPTIONS handler (or use the shared `createApiResponse` which sets CORS headers) on all public-facing booking routes.

### STD-012: Guest action routes log raw tokens in error metadata

- **File:** `src/app/g/[token]/table-manage/action/route.ts:78`
- **File:** `src/app/g/[token]/sunday-preorder/action/route.ts:67`
- **File:** `src/app/g/[token]/manage-booking/action/route.ts:265`
- **Severity:** Medium
- **Standard:** Definition of Done: "No new PII logging, sending, or storing without approval"; Ethics & Safety: AI must stop before "Logging, sending, or storing PII in new locations"
- **Current code:**
  ```typescript
  metadata: { token, ... }
  ```
  The raw guest token is logged. While it's a bearer-style token (not PII in the traditional sense), it is a secret that grants access to a customer's booking. Logging it in plaintext enables token theft from log access.
- **Expected:** Log only the hashed token (`hashGuestToken(token)`) or a truncated version (e.g., last 8 characters) in metadata, consistent with the hashing pattern already used in `token-throttle.ts`.

### STD-013: Sunday preorder route lacks input validation schema

- **File:** `src/app/g/[token]/sunday-preorder/action/route.ts:29-45`
- **Severity:** Medium
- **Standard:** Definition of Done: "Input validation complete -- all user inputs sanitised"
- **Current code:** Manual loop over `formData.entries()` with inline type coercion. No Zod schema. No validation on `menuDishId` format (could be any string). No upper bound on quantity. No limit on total items.
- **Expected:** A Zod schema validating `menu_dish_id` as UUID and `quantity` with bounds. Even with form-data parsing, the extracted object should be validated through a schema.

---

## Low Severity

### STD-014: No test coverage for any reviewed files

- **File:** All 9 reviewed files
- **Severity:** Low
- **Standard:** Testing conventions: "Minimum per feature: happy path + at least 1 error/edge case"; Definition of Done: "New tests written for business logic"
- **Current code:** Zero test files found for any of the 9 reviewed files. (Note: the PayPal webhook and capture-order routes nearby DO have tests.)
- **Expected:** At minimum, tests for the three booking creation routes covering: happy path, validation failure, idempotency replay, and rate limit rejection. This is noted as tech debt.

### STD-015: Unused import in `src/lib/api/auth.ts`

- **File:** `src/lib/api/auth.ts:3`
- **Severity:** Low
- **Standard:** Verification pipeline: "npm run lint with zero warnings"
- **Current code:**
  ```typescript
  import { createClient } from '@/lib/supabase/server';
  ```
  This import is never used in the file -- all database operations use `createAdminClient()`.
- **Expected:** Remove the unused import.

### STD-016: Deprecated rate-limiter wrapper still in use

- **File:** `src/lib/rate-limiter.ts:21`
- **Severity:** Low
- **Standard:** Code quality -- deprecated code should be migrated
- **Current code:** The file marks `checkRateLimit` as `@deprecated` with "Use '@/lib/rate-limit' directly." It creates a mock `NextRequest` to delegate to the new limiter, which is wasteful.
- **Expected:** Migrate remaining callers to `@/lib/rate-limit` directly and remove this file. (The two private booking routes already import from `@/lib/rate-limit` directly, so this file may have no remaining callers.)

### STD-017: `resolveDateAndTime` uses UTC methods on potentially local dates

- **File:** `src/app/api/private-booking-enquiry/route.ts:64-73`
- **Severity:** Low
- **Standard:** CLAUDE.md Date Handling: "Default timezone: Europe/London"
- **Current code:**
  ```typescript
  const parsed = new Date(input.date_time)
  const eventDate = parsed.toISOString().slice(0, 10)
  const hh = String(parsed.getUTCHours()).padStart(2, '0')
  ```
  If a caller sends `"2026-04-08T19:00:00"` (no timezone), `new Date()` will interpret it as local time in the server's timezone, then `getUTCHours()` will extract the UTC hour, creating a mismatch with the caller's intent.
- **Expected:** Either require ISO-8601 with timezone offset, or use the project's `dateUtils` to parse in Europe/London explicitly.

### STD-018: `data` parameter in `createApiResponse` re-wraps already-wrapped payloads

- **File:** `src/lib/api/auth.ts:134-138`
- **Severity:** Low
- **Standard:** Code quality / consistency
- **Current code:**
  ```typescript
  const payload =
    data && typeof data === 'object' && 'success' in data
      ? data
      : { success: true, data };
  ```
  This duck-typing approach means any object with a `success` property is passed through unwrapped, which could lead to accidental double-wrapping or incorrect passthrough depending on caller conventions.
- **Expected:** Use a more explicit mechanism (e.g., a branded type or symbol) to distinguish pre-wrapped payloads, or standardize all callers to use one pattern.

---

## Cross-Cutting Observations

### Inconsistency Matrix: Three Booking Creation Routes

| Feature | `table-bookings` | `public/private-booking` | `private-booking-enquiry` |
|---|---|---|---|
| Zod validation | Yes | **No** | Yes |
| Response helpers | `createApiResponse` | `NextResponse.json` | `NextResponse.json` |
| CORS headers | Via `createApiResponse` | **Missing** | **Missing** |
| OPTIONS handler | Yes | **No** | **No** |
| Auth mechanism | `withApiAuth` (API key) | Rate limiter only | Rate limiter only |
| Audit logging | **Missing** | **Missing** | **Missing** |
| Phone normalization | `formatPhoneForStorage` | `formatPhoneForStorage` | `formatPhoneForStorage` |
| Idempotency | Yes | Yes | Yes |
| Analytics | Yes | Yes | Yes |
| `as any` casts | 0 | **1** | **1** |

### Recommendations (Priority Order)

1. **Add Zod schema** to `public/private-booking` route -- this is the most exposed gap
2. **Add `logAuditEvent()`** calls to all three booking creation routes
3. **Replace `console.*`** with `logger` in `src/lib/api/auth.ts`
4. **Add CORS/OPTIONS** support to the two private booking routes
5. **Fix `as any` casts** -- either type the email function properly or add justification comments
6. **Hash tokens** before logging in guest action routes
7. **Add test coverage** -- prioritize the public booking creation routes as they are the most exposed
