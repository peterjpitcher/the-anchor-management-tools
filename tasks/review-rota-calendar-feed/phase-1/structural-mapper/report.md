# Structural Map — Rota Calendar Feed
**Date**: 2026-03-15
**Mapper**: Structural Mapper Agent
**Scope**: Both calendar feed endpoints, all supporting UI, token utilities, data model

---

## 1. File Inventory

| File | Concern | Key Exports / Entry Points |
|---|---|---|
| `src/app/api/rota/feed/route.ts` | Manager-facing ICS feed endpoint | `GET` handler; `getFeedToken()` (local); `icsDate()`, `addOneDay()`, `escapeICS()`, `foldLine()` (all local, not exported) |
| `src/app/api/portal/calendar-feed/route.ts` | Per-employee ICS feed endpoint | `GET` handler; same 4 utility functions duplicated locally |
| `src/app/(authenticated)/rota/page.tsx` | Manager rota page (server component) | Default export `RotaPage`; derives `feedToken` + `feedUrl` inline |
| `src/app/(authenticated)/rota/RotaFeedButton.tsx` | Manager subscribe UI | Default export `RotaFeedButton({ feedUrl })` |
| `src/app/(staff-portal)/portal/shifts/page.tsx` | Staff portal shifts page (server component) | Default export `MyShiftsPage`; derives `calToken` + `feedUrl` inline |
| `src/app/(staff-portal)/portal/shifts/CalendarSubscribeButton.tsx` | Staff portal subscribe UI | Default export `CalendarSubscribeButton({ feedUrl })` |
| `src/lib/portal/calendar-token.ts` | Token generation/verification for portal feed | `generateCalendarToken(employeeId)`, `verifyCalendarToken(employeeId, token)` |
| `src/app/actions/rota.ts` | General rota server actions | `getEmployeeShifts()`, `getOpenShiftsForPortal()`, publish/edit/delete shift actions — source of truth for `RotaShift` type |
| `src/app/actions/rota-settings.ts` | Rota settings mutations | `updateRotaSettings()`, `setDefaultDays()`, `setManagerEmail()` etc. — does NOT reference feed URL |
| `src/app/(authenticated)/settings/rota/RotaSettingsManager.tsx` | Settings UI | No feed URL reference; manages holidays, defaults, email settings only |
| `supabase/migrations/20260503000002_published_shifts_snapshot.sql` | DB schema for feed data source | `rota_published_shifts` table + indexes |

**Flags:**
- `icsDate()`, `addOneDay()`, `escapeICS()`, `foldLine()` are **duplicated verbatim** in both route files — not shared via a utility module.
- `getFeedToken()` exists only in `route.ts`; `rota/page.tsx` duplicates the same derivation logic inline (not imported).
- `RotaSettingsManager.tsx` / `rota-settings.ts` have no awareness of the feed — feed URL is not persisted anywhere; it is computed on every page render.

---

## 2. Flow Map

### Flow A — Manager subscribes to rota feed

1. Manager opens `/rota` (any week)
2. **`rota/page.tsx` (server)** derives `feedToken`:
   - If `ROTA_FEED_SECRET` env var set → use it as-is
   - Else → `SHA-256(SUPABASE_SERVICE_ROLE_KEY)[0..31]`
3. Builds `feedUrl = ${NEXT_PUBLIC_APP_URL}/api/rota/feed?token=${feedToken}`
4. Passes `feedUrl` prop to `<RotaFeedButton />`
5. Manager clicks "Subscribe" → popover opens showing URL + copy button + instructions
6. Manager copies URL, adds to Google Calendar / Apple Calendar / Outlook
7. Calendar app GETs `feedUrl` immediately on subscription

### Flow B — Calendar app fetches/refreshes manager feed

1. Calendar app sends `GET /api/rota/feed?token=<token>`
2. **`route.ts`** calls `getFeedToken()` (same derivation as page.tsx)
3. Compares `req.searchParams.get('token')` === `getFeedToken()` — string equality
4. **Auth fail path**: returns `401 'Unauthorized'` — no body details
5. **Auth success path**:
   1. `createAdminClient()` — service-role Supabase client
   2. Computes date range: `today - 28 days` to `today + 84 days` (rolling, computed at request time using `new Date()`)
   3. Queries `rota_published_shifts` WHERE `shift_date BETWEEN fromStr AND toStr` AND `status != 'cancelled'`, ordered `shift_date ASC, start_time ASC`; joins `employees(first_name, last_name)`
   4. Generates `DTSTAMP` = current UTC timestamp
   5. Iterates shifts → builds VEVENT blocks:
      - `UID: shift-{id}@anchor-management`
      - `DTSTART;TZID=Europe/London: {shift_date}{start_time}`
      - `DTEND;TZID=Europe/London: {end_date}{end_time}` (end_date = next day if `is_overnight`)
      - `SUMMARY: {empName} [— {name}] [(dept)]`
      - `DESCRIPTION: Department: {dept}[\nStatus: Sick][\nNotes: {notes}]`
      - `STATUS: CANCELLED` if sick, else `CONFIRMED`
   6. Folds long lines to 75-byte RFC 5545 limit
   7. Returns `text/calendar` with `Cache-Control: no-cache, no-store, must-revalidate`
6. **Decision points**:
   - `is_open_shift` → summary shows "Open Shift" instead of employee name
   - `is_overnight` → `DTEND` date advanced by 1 day
   - `status === 'sick'` → `STATUS:CANCELLED`; `status === 'cancelled'` → row excluded from query entirely

### Flow C — Staff employee subscribes to their personal feed

1. Employee opens `/portal/shifts` (server component)
2. Auth: `supabase.auth.getUser()` → employee looked up via `auth_user_id`
3. **`portal/shifts/page.tsx`** calls `generateCalendarToken(employee.employee_id)`
   - HMAC-SHA256(key=`SUPABASE_SERVICE_ROLE_KEY`, data=`employee_id`)[0..31]
4. Builds `feedUrl = ${NEXT_PUBLIC_APP_URL}/api/portal/calendar-feed?employee_id={id}&token={token}`
5. Passes to `<CalendarSubscribeButton feedUrl={feedUrl} />`
6. Employee copies URL → subscribes in calendar app

### Flow D — Calendar app fetches/refreshes staff personal feed

1. Calendar app GETs `/api/portal/calendar-feed?employee_id={id}&token={token}`
2. **`portal/calendar-feed/route.ts`** extracts `employeeId`, `token`
3. `verifyCalendarToken(employeeId, token)` — re-derives HMAC and compares
4. **Auth fail**: `401`; **Employee not found**: `404`
5. **Success**:
   1. `createAdminClient()` — service-role client
   2. Fetch `employees` row for `first_name, last_name`
   3. Date range: same rolling window (`today - 28` to `today + 84`)
   4. Query `rota_published_shifts` WHERE `employee_id = {id}` AND date range AND `status != 'cancelled'`; no employee join needed (single employee)
   5. Builds VEVENT blocks — same logic as Flow B but:
      - `UID: staff-shift-{id}@anchor-management` (different UID namespace from manager feed)
      - `SUMMARY: Shift at The Anchor [(dept)] [— {name}]` (does NOT include employee name)
   6. Returns `text/calendar` with same `Cache-Control: no-cache, no-store, must-revalidate`

---

## 3. Data Model Map

### `rota_published_shifts` table
Source: `supabase/migrations/20260503000002_published_shifts_snapshot.sql`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | Same UUID as `rota_shifts.id` — snapshot, not independent record |
| `week_id` | UUID FK → `rota_weeks(id)` ON DELETE CASCADE | Week this shift belongs to |
| `employee_id` | UUID FK → `employees(employee_id)` ON DELETE SET NULL | Nullable (open shifts) |
| `shift_date` | DATE NOT NULL | Local date (no timezone stored) |
| `start_time` | TIME NOT NULL (inferred from actions type) | HH:MM format |
| `end_time` | TIME NOT NULL (inferred) | HH:MM format |
| `is_overnight` | BOOLEAN | Whether shift crosses midnight |
| `is_open_shift` | BOOLEAN | True if not assigned to an employee |
| `department` | TEXT | Raw department string (lowercased in DB, capitalised in display) |
| `name` | TEXT | Optional shift name/label |
| `notes` | TEXT | Optional free-text notes |
| `status` | TEXT | `scheduled` \| `sick` \| `cancelled` |
| `unpaid_break_minutes` | INTEGER | Not used in feed output |

**Indexes**: `week_id`, `(employee_id, shift_date)`, `(shift_date) WHERE is_open_shift = TRUE`

**Lifecycle**: Table is replaced (snapshot) on each week publish. This is a denormalised read model of `rota_shifts`.

**Valid state transitions for feed relevance**:
- `scheduled` → shown in feed as `STATUS:CONFIRMED`
- `sick` → shown in feed as `STATUS:CANCELLED` (event still included)
- `cancelled` → excluded from query entirely (`.neq('status', 'cancelled')`)

### `employees` table (referenced columns only)
| Column | Type | Notes |
|---|---|---|
| `employee_id` | UUID PK | |
| `first_name` | TEXT nullable | |
| `last_name` | TEXT nullable | |
| `auth_user_id` | UUID | Used by portal page to find employee from Supabase auth user |

### `rota_weeks` table (referenced columns only)
| Column | Used by | Notes |
|---|---|---|
| `id` | `rota_published_shifts.week_id` | On delete cascade removes published shifts |

---

## 4. External Dependency Map

| Dependency | What it is | How called | Which flows |
|---|---|---|---|
| Supabase Admin Client (`createAdminClient()`) | Service-role Postgres client (bypasses RLS) | `createAdminClient()` from `src/lib/supabase/admin.ts` | Flows B (step 5.i), D (step 5.i) |
| Supabase Auth Client | Cookie-based auth client | `createClient()` from `src/lib/supabase/server.ts` | Flow C (step 2 only — user identification) |
| Node.js `crypto` | Token derivation + HMAC | `createHash('sha256')` in route + page; `createHmac('sha256')` in `calendar-token.ts` | Flows A (step 2), B (step 2), C (step 3), D (step 3) |
| `NEXT_PUBLIC_APP_URL` env var | Base URL for feed links | String interpolation in page.tsx + portal/shifts/page.tsx | Flows A (step 3), C (step 4) |
| `ROTA_FEED_SECRET` env var | Optional stable token override | Read in `getFeedToken()` and duplicated in `page.tsx` | Flows A, B |
| `SUPABASE_SERVICE_ROLE_KEY` env var | Fallback token source + HMAC key | Both token schemes depend on this | All flows |

**No external HTTP calls** — both feed endpoints are pure Supabase + crypto.

---

## 5. Missing Pieces Inventory

### Critical gaps

1. **No VTIMEZONE component in ICS output** — Both feeds use `DTSTART;TZID=Europe/London:...` with a named timezone but emit no `VTIMEZONE` block. RFC 5545 requires `VTIMEZONE` to be present in the calendar when `TZID` is used. Without it, some calendar clients (notably Outlook desktop and certain iOS versions) cannot resolve the timezone and may display times incorrectly or reject the event.

2. **No `LAST-MODIFIED` or `SEQUENCE` fields on VEVENTs** — Calendar clients use `LAST-MODIFIED` (and optionally `SEQUENCE`) to determine whether a previously-imported event has been updated. Without these, a calendar app that has already cached an event has no signal that the event changed (time shifted, sick status added, notes changed, shift cancelled). This is the most likely root cause of "feed not updating" — the client sees the same `UID` and `DTSTAMP` but with no `LAST-MODIFIED`, it may not replace the cached copy.

3. **`DTSTAMP` is re-generated on every request, not per event** — `DTSTAMP` represents when the iCalendar object was created/exported, not when the event was last modified. Using a fresh `DTSTAMP` per request is correct for the feed as a whole but does not communicate per-event change timestamps. `LAST-MODIFIED` (set to actual DB update time) is the correct field for that purpose — which requires an `updated_at` column on `rota_published_shifts` (not confirmed present).

4. **`updated_at` column not confirmed on `rota_published_shifts`** — The migration file shows the table schema but the full column list is partially truncated in the available data. If `updated_at` is absent from `rota_published_shifts`, there is no source of truth for `LAST-MODIFIED` without joining back to `rota_shifts`.

5. **Token for manager feed is NOT per-user** — `getFeedToken()` produces a single shared secret for all managers. If the token needs to be rotated (e.g. a manager leaves), all manager calendar subscriptions break simultaneously. No revocation mechanism exists.

6. **Token comparison is not constant-time** — `token !== getFeedToken()` in the manager feed uses JavaScript `!==` (not constant-time). Similarly `verifyCalendarToken()` returns `generateCalendarToken(employeeId) === token` — also not constant-time. Timing attacks are low-risk in this context but this violates the auth standard.

7. **`icsDate()` / `addOneDay()` / `escapeICS()` / `foldLine()` duplicated** — Four utility functions copy-pasted into both route files with no shared module. A bug fix in one would require a fix in both.

8. **`getFeedToken()` duplicated** — The token derivation logic is copy-pasted between `api/rota/feed/route.ts` and `rota/page.tsx` rather than imported from a shared utility.

9. **No `X-PUBLISHED-TTL` hint** — This non-standard but widely supported header/property tells calendar clients how often to re-poll the feed. Without it, Google Calendar defaults to approximately 24 hours; Apple Calendar defaults to 1 week. This explains the "feed not updating" symptom — managers subscribe, initial events appear, but when shifts are published/changed the calendar client waits up to 24 hours (Google) or 1 week (Apple) before re-fetching. The `Cache-Control: no-cache` header applies to HTTP intermediaries, not to calendar app polling intervals.

10. **No `REFRESH-INTERVAL` property** — RFC 7986 defines `REFRESH-INTERVAL` as a calendar-level property to advise clients on polling frequency. Neither feed emits this.

11. **`Content-Disposition: inline` on manager feed** — Uses `inline` filename which is correct for subscription feeds but the filename `rota.ics` is generic. Minor: not a functional issue.

12. **Portal feed `employee_id` param is predictable** — UUID exposed in URL. The HMAC token mitigates this, but the token comparison is not constant-time (see point 6).

13. **No tests** — No test files found for either feed route, `calendar-token.ts`, or either subscribe button component.

14. **No error boundary / fallback in UI** — If `NEXT_PUBLIC_APP_URL` is undefined, `feedUrl` is `undefined/api/rota/feed?token=...` — a broken URL shown to users with no error.

15. **`rota-settings.ts` / `RotaSettingsManager.tsx` have no feed awareness** — No way for admins to view or rotate the feed token via settings UI. Token is entirely implicit.

---

## Summary

The section comprises 7 source files + 1 migration + 1 shared utility. Two parallel feed architectures exist (manager shared-token vs staff HMAC-per-employee). Core functional issues centre on ICS standards compliance: missing `VTIMEZONE`, missing `LAST-MODIFIED`/`SEQUENCE`, and no polling-frequency hint — the latter being the most probable root cause of the reported "feed not updating" symptom. Four utility functions and the manager token derivation are duplicated rather than shared.
