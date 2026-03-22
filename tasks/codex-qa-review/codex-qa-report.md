# QA Review Report — Calendar Sync System

**Scope:** Calendar sync function on /rota page (7 files)
**Date:** 2026-03-22
**Mode:** Code Review
**Engines:** Claude + Codex (dual-perspective)

**Files reviewed:**
- `src/lib/google-calendar-rota.ts` — Core Google Calendar sync engine
- `src/app/api/rota/resync-calendar/route.ts` — POST endpoint triggering sync
- `src/app/api/rota/feed/route.ts` — ICS feed endpoint (staff rota)
- `src/app/api/portal/calendar-feed/route.ts` — ICS feed endpoint (employee portal)
- `src/app/(authenticated)/rota/RotaFeedButton.tsx` — Client sync/subscribe UI
- `src/lib/ics/utils.ts` — Shared ICS utilities (RFC 5545)
- `src/lib/portal/calendar-token.ts` — HMAC token generation/verification

---

## Executive Summary

22 unique findings across the calendar sync system: **1 critical, 5 high, 10 medium, 6 low**. The code is well-engineered with excellent error isolation per shift, proper RFC 5545 compliance, and timing-safe token comparison. However, the system has meaningful security concerns around non-revocable feed tokens derived from the service role key, a critical performance bottleneck in the resync endpoint (sequential N+1 pattern that can exceed the 300s timeout), and several standards gaps including missing audit logging and untyped auth parameters.

The highest-confidence findings are those independently flagged by both engines (token security, missing audit logging, `any` types) — these should be addressed first.

---

## Critical Findings

### QA-001: Resync-calendar endpoint has N+1 waterfall that can exceed 300s timeout
- **File:** `src/app/api/rota/resync-calendar/route.ts:41-56`, `src/lib/google-calendar-rota.ts:80-385`
- **Engine(s):** Claude (Performance)
- **Category:** Performance / Database / Network
- **Description:** The resync endpoint loops through ALL published weeks sequentially. Each iteration fetches shifts (DB query), then calls `syncRotaWeekToCalendar` which internally re-fetches employees (DB query), re-creates the OAuth client, fetches existing event mappings (DB query), lists GCal events (API call), then processes shifts in batches of 10 with 150ms inter-batch pauses. For a venue with 20 published weeks x ~40 shifts each, this creates a waterfall of ~800 GCal API calls that easily exceeds `maxDuration: 300`.
- **Impact:** Sync silently times out on Vercel, leaving some weeks unsynced with no error reported to the user. The button shows "success" because the function is killed mid-execution.
- **Suggested fix:**
  1. Fetch all shifts across all weeks in a single query: `.in('week_id', weekIds)` and group client-side
  2. Fetch employee names once, create OAuth client once, pass both into sync function
  3. Process multiple weeks with bounded concurrency (e.g., 3 concurrent weeks via `Promise.all` with limiter)

---

## High Findings

### QA-002: Shared static feed token — one leaked URL gives indefinite org-wide access
- **File:** `src/app/api/rota/feed/route.ts:21-29`, `src/lib/portal/calendar-token.ts:3-8`
- **Engine(s):** Codex (Security) + Claude (Standards) — **both engines flagged**
- **Category:** Security (Auth) — OWASP A01 Broken Access Control
- **Description:** The rota feed uses a single global token derived from `ROTA_FEED_SECRET` or SHA-256 of `SUPABASE_SERVICE_ROLE_KEY`. This URL is rendered in the management UI for copy/paste. Anyone with the URL (from browser history, clipboard, screenshots, proxy logs, or the subscribed calendar provider) gets indefinite access to all published shifts, employee names, sick/cancelled status, and notes. The token cannot be scoped or revoked per-subscriber. The portal feed has the same design — HMAC tokens are deterministic and permanent with no expiry or revocation mechanism.
- **Impact:** One leaked URL = indefinite organisation-wide PII exposure. Revoking a single subscriber requires rotating the global secret, breaking all other subscribers.
- **Suggested fix:** Replace shared tokens with per-subscriber opaque random feed IDs stored server-side, with scope and revocation state. Support token rotation on credential reset or employee separation.

### QA-003: Silent fallback on missing security-critical env vars
- **File:** `src/lib/portal/calendar-token.ts:4`, `src/app/api/rota/feed/route.ts:25-28`
- **Engine(s):** Codex (Security) + Claude (Standards) — **both engines flagged**
- **Category:** Security (Crypto) — OWASP A07 Identification/Authentication Failures
- **Description:** Both files use `process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'fallback-no-key'` as their HMAC/hash secret. If the env var is missing, tokens become predictable and identical across all deployments using the same fallback string. The system appears to work but offers zero security.
- **Impact:** An attacker who knows the fallback string (visible in source code) can forge valid feed tokens for any employee.
- **Suggested fix:** Use a dedicated `CALENDAR_TOKEN_SECRET` env var. Throw an error when it's missing rather than falling back silently.

### QA-004: Missing audit logging on resync-calendar mutation
- **File:** `src/app/api/rota/resync-calendar/route.ts` (entire file)
- **Engine(s):** Claude (Standards)
- **Category:** Standards — CLAUDE.md ("All mutations must call `logAuditEvent()`")
- **Description:** The POST handler performs write operations (syncing shifts to Google Calendar, upserting/deleting `rota_google_calendar_events` rows) but never calls `logAuditEvent()`. Other mutation endpoints in the project consistently log audit events.
- **Impact:** No audit trail for calendar sync operations. Impossible to trace who triggered a sync or diagnose sync-related issues from the audit log.
- **Suggested fix:** Add `logAuditEvent({ user_id: user.id, operation_type: 'update', resource_type: 'rota_calendar_sync', operation_status: 'success' })` after sync completes.

### QA-005: ICS feeds compute full response before checking conditional GET (ETag/304)
- **File:** `src/app/api/rota/feed/route.ts:62-170`, `src/app/api/portal/calendar-feed/route.ts:49-162`
- **Engine(s):** Claude (Performance)
- **Category:** Performance (Network/Database)
- **Description:** Every calendar poll (potentially hourly per subscriber from Apple Calendar/Outlook) triggers a full database query, ICS string construction, SHA-256 hash, and string folding — even when data hasn't changed and a 304 would suffice. With 20 staff subscribed, that's 20 unnecessary full DB queries per hour.
- **Impact:** Wasted compute and database load on ~90% of feed polls where data hasn't changed.
- **Suggested fix:** Compute a lightweight ETag from DB metadata first: `SELECT MAX(published_at), COUNT(*) FROM rota_published_shifts WHERE shift_date BETWEEN ...`. Compare against `If-None-Match` before building the full response.

### QA-006: `auth: any` type and 5 `as any` casts in Google Calendar sync
- **File:** `src/lib/google-calendar-rota.ts:388` (parameter), lines 145, 318, 328, 341, 394 (casts)
- **Engine(s):** Claude (Standards)
- **Category:** Standards — TypeScript ("No `any` types without justifying comment")
- **Description:** The `safeDeleteEvent` function and all `calendar.events.*` calls use `auth: any` / `auth as any`. This disables all type checking on the authentication object.
- **Impact:** Type errors in auth configuration won't be caught at compile time. A misconfigured OAuth client would only surface at runtime.
- **Suggested fix:** Type as `OAuth2Client` from `google-auth-library`. The `as any` casts can then be removed.

---

## Medium Findings

### QA-007: No server-side concurrency guard on resync
- **File:** `src/app/api/rota/resync-calendar/route.ts`, `src/app/(authenticated)/rota/RotaFeedButton.tsx:18-33`
- **Engine(s):** Claude (Performance)
- **Description:** Client disables the button during sync, but no server-side lock. Multiple users (or tabs) can trigger concurrent resyncs, each making hundreds of GCal API calls, exhausting rate limits.
- **Suggested fix:** Add a DB-backed mutex (`rota_sync_status` row) with staleness check.

### QA-008: `SELECT *` in both ICS feed endpoints
- **File:** `src/app/api/rota/feed/route.ts:62-68`, `src/app/api/portal/calendar-feed/route.ts:49-56`
- **Engine(s):** Claude (Performance + Standards)
- **Description:** Both feeds fetch all columns when only ~10 are used. Runs on every calendar poll from every subscriber.
- **Suggested fix:** Use explicit column list matching the fields actually used in ICS generation.

### QA-009: 24 `as string` type assertions across both feed routes
- **File:** `src/app/api/rota/feed/route.ts` (12x), `src/app/api/portal/calendar-feed/route.ts` (12x)
- **Engine(s):** Claude (Standards)
- **Description:** `shift.department as string`, `shift.name as string`, etc. repeated throughout. Masks untyped Supabase query results.
- **Suggested fix:** Define a `PublishedShiftRow` interface and use Supabase's `.select<PublishedShiftRow[]>(...)` generic.

### QA-010: `catch (err: any)` used 7 times without justification
- **File:** `src/lib/google-calendar-rota.ts` (6x), `src/app/api/rota/resync-calendar/route.ts` (1x)
- **Engine(s):** Claude (Standards)
- **Suggested fix:** Use `catch (err: unknown)` with a type guard or shared `getErrorMessage(err)` utility.

### QA-011: `console.log` statements in production library code
- **File:** `src/lib/google-calendar-rota.ts:86,194,200,379-382`
- **Engine(s):** Claude (Standards)
- **Description:** 4 informational `console.log` calls left in production code. The `console.error`/`console.warn` calls are acceptable.
- **Suggested fix:** Remove or replace with structured logger.

### QA-012: Popover does not trap focus or close on Escape
- **File:** `src/app/(authenticated)/rota/RotaFeedButton.tsx:58-108`
- **Engine(s):** Claude (Standards)
- **Description:** Calendar feed popover closes on backdrop click but has no Escape key handler and no focus trap.
- **Suggested fix:** Add `onKeyDown` handler for Escape. Consider using Radix/Headless UI popover.

### QA-013: Missing `aria-label` on icon-only close button
- **File:** `src/app/(authenticated)/rota/RotaFeedButton.tsx:70-76`
- **Engine(s):** Claude (Standards)
- **Suggested fix:** Add `aria-label="Close calendar feed popover"`.

### QA-014: `foldLine` creates TextEncoder per call and encodes char-by-char
- **File:** `src/lib/ics/utils.ts:57-88`
- **Engine(s):** Claude (Performance)
- **Description:** For a 500-shift feed with ~5000 lines, creates 5000 `TextEncoder` instances and encodes characters individually. Most lines are short ASCII strings that don't need folding.
- **Suggested fix:** Module-scoped `TextEncoder`, ASCII fast path (`if (line.length <= 75) return line`).

### QA-015: Raw `new Date()` for feed date ranges instead of `dateUtils`
- **File:** `src/app/api/rota/feed/route.ts:54-57`, `src/app/api/portal/calendar-feed/route.ts:42-45`
- **Engine(s):** Claude (Standards)
- **Description:** `new Date().toISOString().split('T')[0]` returns UTC date, which at midnight during BST differs from London date. Feed window could shift by a day.
- **Suggested fix:** Use `getTodayIsoDate()` from `src/lib/dateUtils.ts`.

### QA-016: Duplicate ICS generation logic across two feed routes
- **File:** `src/app/api/rota/feed/route.ts`, `src/app/api/portal/calendar-feed/route.ts`
- **Engine(s):** Claude (Standards)
- **Description:** ~80% shared logic: VEVENT generation, department formatting, DTSTAMP/SEQUENCE/STATUS, ETag/conditional-GET. Any future ICS fix must be applied to both files.
- **Suggested fix:** Extract shared VEVENT builder into `src/lib/ics/utils.ts`.

---

## Low Findings

### QA-017: Inline props type on RotaFeedButton
- **File:** `src/app/(authenticated)/rota/RotaFeedButton.tsx:7`
- **Engine(s):** Claude (Standards)
- **Suggested fix:** Extract to `interface RotaFeedButtonProps`.

### QA-018: Array sort to find max `published_at` (O(n log n) vs O(n))
- **File:** `src/app/api/rota/feed/route.ts:149-152`, `src/app/api/portal/calendar-feed/route.ts:129-132`
- **Engine(s):** Claude (Performance)
- **Suggested fix:** Use `reduce` to find max in O(n).

### QA-019: `RotaShiftRow` uses snake_case field names in TypeScript
- **File:** `src/lib/google-calendar-rota.ts:53-66`
- **Engine(s):** Claude (Standards)
- **Description:** Per CLAUDE.md, TS types should be camelCase with `fromDb` conversion. However, the entire codebase uses snake_case — this is an architectural gap, not a per-file issue.
- **Suggested fix:** Documented as known pattern; pragmatic approach is to update the standard.

### QA-020: Employee names re-fetched per week during resync
- **File:** `src/lib/google-calendar-rota.ts:94-108`
- **Engine(s):** Claude (Performance)
- **Description:** When syncing N weeks, the same employee list is fetched N times. Also re-creates OAuth client per week.
- **Suggested fix:** Accept optional pre-fetched `employeeNames` and `auth` parameters; caller fetches once.

### QA-021: `mostRecentPublish` computation duplicated in both feeds
- **File:** Both feed routes
- **Engine(s):** Claude (Performance + Standards)
- **Description:** Identical `mostRecentPublish` computation copy-pasted. Related to QA-016 (duplicate ICS logic).

### QA-022: London dateUtils helpers may use host timezone (BUG-014 from Codex)
- **File:** `src/lib/dateUtils.ts:27,34`
- **Engine(s):** Codex (Bug Hunter)
- **Description:** `getTodayIsoDate()` and `toLocalIsoDate()` use `getTimezoneOffset()` from the server host, not Europe/London. On non-UK hosts or around DST boundaries, date-based operations can run a day early or late.
- **Suggested fix:** Use London-zoned conversions (e.g., `date-fns-tz`) instead of host-local offsets. Affects the entire codebase, not just calendar sync.

---

## Cross-Engine Analysis

### Agreed (both Codex AND Claude flagged)

| Finding | Codex Specialist | Claude Specialist | Confidence |
|---------|-----------------|-------------------|------------|
| QA-002: Non-revocable shared feed tokens | Security Auditor (SEC-001, SEC-002) | Standards Enforcer (STD-011, STD-012) | **Very High** |
| QA-003: Silent fallback on missing secrets | Security Auditor (SEC-001, SEC-002) | Standards Enforcer (STD-011, STD-012) | **Very High** |

### Codex-Only Findings

| Finding | Notes |
|---------|-------|
| QA-022: dateUtils host timezone issue (BUG-014) | Valid concern — affects the entire codebase, not calendar sync specifically |
| BUG-001 through BUG-013 (non-calendar-sync) | Codex reviewed the entire codebase. 3 Critical + 10 High findings in invoices, PayPal, parking, timeclock, crons. Outside requested scope but contain real bugs worth tracking separately. |

### Claude-Only Findings

| Finding | Notes |
|---------|-------|
| QA-001: Resync N+1 waterfall (Critical) | Codex didn't flag — likely missed the sequential processing pattern across files |
| QA-004: Missing audit logging | Context-dependent — requires knowing the CLAUDE.md conventions |
| QA-005 through QA-021 | Performance and standards findings requiring project convention knowledge |

---

## Recommendations — Priority Fix Order

### Immediate (fix before next deploy)
1. **QA-003**: Replace `'fallback-no-key'` with `throw new Error()` when `CALENDAR_TOKEN_SECRET` / `ROTA_FEED_SECRET` is missing
2. **QA-004**: Add `logAuditEvent()` to resync-calendar POST handler

### Short-term (next sprint)
3. **QA-001**: Refactor resync to batch-fetch shifts and reuse employee names/OAuth client
4. **QA-005**: Add lightweight ETag pre-check before building full ICS response
5. **QA-006**: Type auth parameter as `OAuth2Client`, remove `as any` casts
6. **QA-007**: Add server-side concurrency guard for resync
7. **QA-009**: Define `PublishedShiftRow` interface, eliminate `as string` assertions

### Medium-term (when touching these files)
8. **QA-002**: Migrate to per-subscriber revocable feed tokens
9. **QA-016**: Extract shared ICS logic into `src/lib/ics/utils.ts`
10. **QA-012/QA-013**: Improve popover accessibility (focus trap, Escape, aria-label)
11. **QA-015**: Use `dateUtils` instead of raw `new Date()` in feed routes

### Low priority
12. QA-008, QA-010, QA-011, QA-014, QA-017, QA-018, QA-019, QA-020, QA-021, QA-022

---

## Positive Findings

Both engines noted several things done well:
- **Excellent error isolation** — one bad shift never aborts the batch (per-shift try/catch)
- **RFC 5545 compliance** — proper VTIMEZONE, SEQUENCE derivation, UTF-8-safe line folding
- **Timing-safe token comparison** in both auth paths
- **Proper auth + RBAC** — resync endpoint checks both session auth and `rota:publish` permission
- **Good client UX** — loading/disabled states, proper button types, clear user messaging
- `src/lib/ics/utils.ts` is exemplary: fully typed, well-documented with RFC references, no `any` types

---

## Bonus: Out-of-Scope Codex Findings

The Bug Hunter (Codex) reviewed beyond the requested scope and found **3 Critical + 10 High** bugs elsewhere in the codebase. These are documented in `tasks/codex-qa-review/bug-hunter-report.md` and include:
- **BUG-001 (Critical):** Invoice status can fabricate paid invoices without payment records
- **BUG-002 (Critical):** PayPal deposit capture records payment but never confirms the booking
- **BUG-003 (Critical):** `booking-balance-reminders` cron uses POST — Vercel cron only calls GET
- Plus 10 High-severity findings across parking, timeclock, crons, and webhooks

These warrant a separate review session.

---

*Generated by Codex QA Review (dual-engine: Claude + OpenAI Codex)*
*Individual specialist reports available in `tasks/codex-qa-review/`*
