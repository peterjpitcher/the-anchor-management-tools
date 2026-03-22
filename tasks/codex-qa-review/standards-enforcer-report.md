# Standards Enforcement Report

**Scope:** Calendar sync code review (7 files)
**Date:** 2026-03-22
**Reviewer:** Standards Enforcer (automated)

## Summary

Reviewed 7 calendar sync files against project conventions. Found **12 deviations** -- 4 High, 5 Medium, 3 Low. The most significant issues are: heavy use of `any` types without justification (particularly `auth: any` repeated 6 times), missing audit logging on the resync mutation endpoint, excessive `as string` type assertions masking untyped Supabase query results, and `console.log` statements left in production code. The ICS utility file (`src/lib/ics/utils.ts`) is the cleanest file in the set -- well-typed, well-documented, and fully standards-compliant.

---

## Deviations

### STD-001: `safeDeleteEvent` parameter typed as `auth: any`
- **File:** `src/lib/google-calendar-rota.ts:388`
- **Severity:** High
- **Standard:** CLAUDE.md > TypeScript ("No `any` types unless absolutely justified with a comment")
- **Current code:** `async function safeDeleteEvent(auth: any, calendarId: string, eventId: string, shiftId: string)`
- **Expected:** Type `auth` as the return type of `getOAuth2Client()` (likely `OAuth2Client` from `google-auth-library`). The `as any` cast on every `calendar.events.*` call (lines 145, 318, 328, 341, 394) is a symptom of this untyped parameter.
- **Auto-fixable:** Yes -- import and use the correct type from googleapis/google-auth-library

### STD-002: `catch (err: any)` used 7 times without justification
- **File:** `src/lib/google-calendar-rota.ts:209,303,335,347,371,395` and `src/app/api/rota/resync-calendar/route.ts:53`
- **Severity:** Medium
- **Standard:** CLAUDE.md > TypeScript ("No `any` types unless absolutely justified with a comment")
- **Current code:** `catch (err: any) { ... err?.message ... }`
- **Expected:** Use `catch (err: unknown)` with a type guard or a shared `getErrorMessage(err)` utility. This matches the project-wide Pattern A from the previous report.
- **Auto-fixable:** Yes

### STD-003: Missing audit logging on resync-calendar mutation
- **File:** `src/app/api/rota/resync-calendar/route.ts` (entire file)
- **Severity:** High
- **Standard:** CLAUDE.md > Server Actions Pattern ("Audit logging via `logAuditEvent()` for all mutations"), supabase.md ("All mutations must call `logAuditEvent()`")
- **Current code:** The POST handler performs a write operation (syncing shifts to Google Calendar, upserting/deleting `rota_google_calendar_events` rows) but never calls `logAuditEvent()`. Other API routes in the project (e.g., `auto-send-invoices`, `apply-customer-labels`) do log audit events.
- **Expected:** Call `logAuditEvent({ user_id: user.id, operation_type: 'update', resource_type: 'rota_calendar_sync', operation_status: 'success' })` after the sync completes.
- **Auto-fixable:** No

### STD-004: `console.log` statements in production library code
- **File:** `src/lib/google-calendar-rota.ts:86,194,200,379-382`
- **Severity:** Medium
- **Standard:** Definition of Done ("No console.log or debug statements left in production code")
- **Current code:** `console.log('[RotaCalendar] GOOGLE_CALENDAR_ROTA_ID not configured...')`, `console.log('[RotaCalendar] Sync complete for week...')`
- **Expected:** The `console.error` and `console.warn` calls (lines 211, 243, 306, 348, 351, 373, 397) are acceptable for error/warning paths. The `console.log` calls on lines 86, 194, 200, 379 are informational and should either be removed or replaced with a structured logger.
- **Auto-fixable:** Yes

### STD-005: Inline props type instead of named interface on RotaFeedButton
- **File:** `src/app/(authenticated)/rota/RotaFeedButton.tsx:7`
- **Severity:** Low
- **Standard:** CLAUDE.md > TypeScript ("Named props interfaces, not inline anonymous objects for complex props")
- **Current code:** `export default function RotaFeedButton({ feedUrl, showCalendarSync }: { feedUrl: string; showCalendarSync?: boolean })`
- **Expected:** Define `interface RotaFeedButtonProps { feedUrl: string; showCalendarSync?: boolean }` and use it. Other rota components in the same directory (e.g., `CreateShiftModalProps`, `ShiftDetailModalProps`) follow the named interface pattern.
- **Auto-fixable:** Yes

### STD-006: Missing `aria-label` on icon-only close button
- **File:** `src/app/(authenticated)/rota/RotaFeedButton.tsx:70-76`
- **Severity:** Medium
- **Standard:** ui-patterns.md ("aria-label on icon-only buttons")
- **Current code:** `<button type="button" onClick={() => setOpen(false)} className="..."><XMarkIcon className="h-4 w-4" /></button>` -- no aria-label
- **Expected:** Add `aria-label="Close calendar feed popover"` to the button element.
- **Auto-fixable:** Yes

### STD-007: Popover does not trap focus or close on Escape
- **File:** `src/app/(authenticated)/rota/RotaFeedButton.tsx:58-108`
- **Severity:** Medium
- **Standard:** ui-patterns.md ("Modal dialogs trap focus and close on Escape")
- **Current code:** The popover uses a backdrop click to close but has no `onKeyDown` handler for Escape, and focus is not trapped within the popover when open.
- **Expected:** Add an Escape key handler and basic focus management. Alternatively, use a Headless UI or Radix popover component that handles this automatically.
- **Auto-fixable:** No

### STD-008: Excessive `as string` type assertions in feed routes
- **File:** `src/app/api/rota/feed/route.ts` (12 occurrences), `src/app/api/portal/calendar-feed/route.ts` (12 occurrences)
- **Severity:** Medium
- **Standard:** CLAUDE.md > TypeScript (no `any` types / proper typing), supabase.md ("Always wrap DB results with a conversion helper")
- **Current code:** `shift.department as string`, `shift.name as string`, `shift.shift_date as string`, `shift.published_at as string`, etc. repeated throughout both files.
- **Expected:** Define a typed interface for the query result (e.g., `interface PublishedShiftRow`) and use it with the Supabase `.select<PublishedShiftRow[]>(...)` generic. This would eliminate all the `as string` casts and catch schema drift at compile time.
- **Auto-fixable:** Yes (define interface, apply generic to query)

### STD-009: Raw `new Date()` for date range calculation in feed routes
- **File:** `src/app/api/rota/feed/route.ts:54-57`, `src/app/api/portal/calendar-feed/route.ts:42-45`
- **Severity:** Low
- **Standard:** CLAUDE.md > Date Handling ("Never use raw `new Date()` for user-facing dates. Default timezone: Europe/London")
- **Current code:** `const from = new Date(); from.setDate(from.getDate() - 28)` and then `.toISOString().split('T')[0]`
- **Expected:** These are server-side date range calculations for DB queries, not user-facing display, so the timezone risk is lower. However, at midnight UTC during BST, `new Date().toISOString().split('T')[0]` returns yesterday's date in London time. Use `getTodayIsoDate()` from `src/lib/dateUtils.ts` as the baseline and compute offsets from there.
- **Auto-fixable:** Yes

### STD-010: `RotaShiftRow` interface uses snake_case field names in TypeScript
- **File:** `src/lib/google-calendar-rota.ts:53-66`
- **Severity:** Low
- **Standard:** supabase.md ("DB columns are `snake_case`; TypeScript types are `camelCase`")
- **Current code:** `week_id`, `employee_id`, `shift_date`, `start_time`, `end_time`, `is_overnight`, `is_open_shift` -- all snake_case
- **Expected:** Per the documented standard, TS types should use camelCase (`weekId`, `employeeId`, `shiftDate`, etc.) with a `fromDb` conversion layer. However, as noted in the previous report (Pattern B), the entire codebase uses snake_case in TS types, making this an architectural gap rather than a per-file issue. Flagging for completeness but the pragmatic fix is to update the standard to match practice.
- **Auto-fixable:** No (project-wide architectural decision)

### STD-011: `calendar-token.ts` uses `SUPABASE_SERVICE_ROLE_KEY` as HMAC secret
- **File:** `src/lib/portal/calendar-token.ts:4`
- **Severity:** High
- **Standard:** CLAUDE.md > Code Hygiene ("No hardcoded secrets or API keys"), separation of concerns
- **Current code:** `createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'fallback-no-key')` -- the Supabase service role key is repurposed as an HMAC signing secret, and the fallback `'fallback-no-key'` means tokens are deterministic and predictable if the env var is missing.
- **Expected:** Use a dedicated secret (e.g., `CALENDAR_TOKEN_SECRET`), similar to how the rota feed route already supports `ROTA_FEED_SECRET` as a dedicated secret. The `'fallback-no-key'` string should throw an error instead of silently generating weak tokens.
- **Auto-fixable:** Yes

### STD-012: `rota/feed/route.ts` also uses `SUPABASE_SERVICE_ROLE_KEY` as token derivation source
- **File:** `src/app/api/rota/feed/route.ts:25-28`
- **Severity:** High
- **Standard:** Same as STD-011
- **Current code:** `createHash('sha256').update(process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'fallback-no-key').digest('hex').substring(0, 32)` -- falls back to a predictable hash if the env var is missing.
- **Expected:** The file already supports `ROTA_FEED_SECRET` as the preferred path. The fallback should `throw new Error('ROTA_FEED_SECRET is required')` rather than silently deriving from the service role key or from a static string. At minimum, log a warning when falling back.
- **Auto-fixable:** Yes

---

## Patterns

### Pattern A: `any` type usage concentrated in Google API auth
The `auth: any` parameter and `auth as any` casts appear because the googleapis library's type system does not cleanly expose the auth client type for calendar method options. This is a common pain point. The pragmatic fix is to type the parameter as `OAuth2Client` from `google-auth-library` and let TypeScript's structural typing handle the rest -- the `as any` casts can then be removed.

### Pattern B: Duplicate ICS generation logic between two feed routes
`src/app/api/rota/feed/route.ts` and `src/app/api/portal/calendar-feed/route.ts` share ~80% of their VEVENT generation logic (department label formatting, description building, DTSTAMP/SEQUENCE/STATUS handling, ETag/conditional-GET logic). This is not a standards violation per se, but it is a maintenance risk -- any future ICS fix must be applied to both files. Consider extracting shared VEVENT building into `src/lib/ics/utils.ts`.

### Pattern C: Silent fallback on missing secrets
Both `calendar-token.ts` and `rota/feed/route.ts` use `'fallback-no-key'` when environment variables are missing. This creates a false sense of security -- the system appears to work but tokens are predictable. The project convention should be to fail loudly when security-critical env vars are absent.

---

## Positive Findings

- `src/lib/ics/utils.ts` is exemplary: all exported functions have explicit return types, thorough JSDoc with RFC references, no `any` types, and proper UTF-8 handling
- `src/app/api/rota/resync-calendar/route.ts` correctly implements auth check + permission check at the top of the handler
- `RotaFeedButton.tsx` correctly uses `'use client'` only where needed, has loading/disabled states on buttons, and uses `type="button"` to prevent accidental form submission
- The Google Calendar sync function has excellent error isolation -- one bad shift never aborts the batch
- Timing-safe token comparison is used in both auth paths (feed route and calendar-token)
- `VTIMEZONE_EUROPE_LONDON` is properly defined per RFC 5545, correctly handling BST/GMT transitions

---

## Priority Recommendations

1. **Immediate (High):** Add a dedicated `CALENDAR_TOKEN_SECRET` env var and fail loudly when it is missing (STD-011, STD-012)
2. **Immediate (High):** Add `logAuditEvent()` to the resync-calendar POST handler (STD-003)
3. **Short-term:** Type the Google auth parameter as `OAuth2Client` and remove all `as any` casts (STD-001)
4. **Short-term:** Define a `PublishedShiftRow` interface and eliminate `as string` assertions in both feed routes (STD-008)
5. **Short-term:** Add `aria-label` and Escape-key handling to RotaFeedButton popover (STD-006, STD-007)
6. **Medium-term:** Extract shared VEVENT generation logic from both feed routes into `src/lib/ics/utils.ts` (Pattern B)
7. **Medium-term:** Replace `console.log` with structured logger in google-calendar-rota.ts (STD-004)
