# Structural Map — Rota Calendar Feed v2

## Files

| Path | Concern | Key Exports / Entry Points | Flags |
|------|---------|---------------------------|-------|
| `src/app/api/rota/feed/route.ts` | Routing + ICS generation | `GET`, `dynamic='force-dynamic'` | Manager-wide feed; token derived in two places (here AND rota page) |
| `src/app/api/portal/calendar-feed/route.ts` | Routing + ICS generation | `GET`, `dynamic='force-dynamic'` | Per-employee feed; near-identical ICS generation code to above — duplicated logic |
| `src/lib/ics/utils.ts` | Utility | `icsDate`, `icsTimestamp`, `addOneDay`, `escapeICS`, `foldLine`, `VTIMEZONE_EUROPE_LONDON`, `ICS_CALENDAR_REFRESH_LINES` | Shared by both routes; single source of truth for ICS formatting |
| `src/lib/portal/calendar-token.ts` | Auth utility | `generateCalendarToken`, `verifyCalendarToken` | HMAC-SHA256, NOT timing-safe (plain `===` compare) |
| `src/app/(authenticated)/rota/RotaFeedButton.tsx` | UI component | default export `RotaFeedButton({ feedUrl })` | Copy-to-clipboard only; no webcal:// conversion |
| `src/app/(authenticated)/rota/page.tsx` | Page (server component) | default export `RotaPage` | Derives feedToken independently — token logic duplicated from route |
| `src/app/(staff-portal)/portal/shifts/page.tsx` | Page (server component) | Generates `feedUrl` for portal feed | Uses `generateCalendarToken` + `NEXT_PUBLIC_APP_URL` as base |
| `src/app/actions/rota.ts` | Business logic / server actions | `publishRotaWeek`, `getWeekShifts`, `getEmployeeShifts`, etc. | Publish action is the ONLY writer to `rota_published_shifts`; sets `published_at = now()` on each publish |
| `supabase/migrations/20260503000002_published_shifts_snapshot.sql` | Data model | `rota_published_shifts` table DDL | No `updated_at` column; `published_at` set to `NOW()` at publish time for all rows in batch |

---

## Flows

### Flow 1 — Manager Subscribes to Feed
1. Manager opens `/rota` page (server component renders)
2. Server derives `feedToken` (prefers `ROTA_FEED_SECRET`; falls back to SHA-256 of service role key, first 32 chars)
3. Server constructs `feedUrl = ${NEXT_PUBLIC_APP_URL}/api/rota/feed?token=${feedToken}` — scheme is `https://`
4. `RotaFeedButton` renders the URL in a read-only input; manager clicks Copy
5. Manager pastes URL into Google Calendar "From URL" dialog (no webcal:// conversion happens)
6. Google Calendar makes `GET /api/rota/feed?token=...` — user-agent: Googlebot-calendar
7. Route validates token (timing-safe); unauthorised → 401
8. Route queries `rota_published_shifts` via admin client (bypasses RLS), date range: today−28d to today+84d, excludes `status='cancelled'`, ordered by date/time
9. Route generates ICS in-memory, folds lines, joins with CRLF
10. Route returns `200 text/calendar` with `Cache-Control: no-cache, no-store, must-revalidate`; no `ETag`; no HTTP `Last-Modified` header

### Flow 2 — Employee Subscribes to Personal Feed
1. Employee views `/portal/shifts`
2. Server calls `generateCalendarToken(employee_id)` → HMAC-SHA256(service_role_key, employee_id).slice(0,32)
3. Server constructs `feedUrl = ${baseUrl}/api/portal/calendar-feed?employee_id=...&token=...`
4. Employee copies URL and subscribes
5. Google Calendar GETs `/api/portal/calendar-feed?employee_id=...&token=...`
6. Route calls `verifyCalendarToken` (plain `===` — NOT timing-safe)
7. Route fetches employee record; 404 if not found
8. Route queries `rota_published_shifts` filtered by `employee_id`, same date range as manager feed
9. Route generates ICS in-memory, returns `200 text/calendar` with same `Cache-Control: no-cache, no-store, must-revalidate`; no `ETag`; no HTTP `Last-Modified`

### Flow 3 — Manager Publishes / Re-Publishes Rota
1. Manager clicks Publish in `RotaGrid` → calls `publishRotaWeek(weekId)` server action
2. Permission check: `rota.publish`
3. Fetch `rota_weeks` row to detect first-publish vs re-publish
4. If re-publish: capture previous `rota_published_shifts` snapshot for diff
5. Delete existing `rota_published_shifts` rows for the week (admin client)
6. Insert current `rota_shifts` rows into `rota_published_shifts` with `published_at = now()` — ALL rows get the same `published_at` timestamp (the publish moment), regardless of when individual shifts were originally created or last edited
7. Update `rota_weeks`: `status='published'`, `published_at=now()`, `has_unpublished_changes=false`
8. Log audit event
9. Fire-and-forget: send email notifications to affected staff

### Flow 4 — Google Calendar Polls for Updates (external, inferred)
- Google Calendar polls subscribed ICS feeds on its own schedule (not controlled by the server)
- Google's documented refresh interval: every 8–12 hours in practice, regardless of `REFRESH-INTERVAL` or `X-PUBLISHED-TTL` hints
- Google sends unconditional `GET` (does not send `If-None-Match` or `If-Modified-Since` conditional request headers)
- Server returns full ICS body on every request; no 304 pathway exists
- **Decision point**: Google Calendar determines whether events have changed by comparing incoming `UID` + `SEQUENCE` + `LAST-MODIFIED` against its local cache of each event

### Flow 5 — Shift Added Post-Publish (the failing scenario)
1. Manager edits rota and saves a new shift to `rota_shifts` (draft table) → `has_unpublished_changes=true` on the week
2. New shift does NOT appear in `rota_published_shifts` yet
3. Manager publishes again → Flow 3 executes
4. New shift now in `rota_published_shifts` with `published_at = now()`
5. ICS feed now includes the new `VEVENT` with correct `UID`, `LAST-MODIFIED` (= publish timestamp), `SEQUENCE:0`
6. On next Google poll, Google sees the new `UID` — should add the event
7. **Ambiguity**: If Google is not polling, or is caching aggressively, the new event is never fetched

---

## Data Models

### `rota_published_shifts` (snapshot table)
| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK | Same UUID as `rota_shifts.id` |
| `week_id` | UUID | NOT NULL, FK → `rota_weeks.id` ON DELETE CASCADE | |
| `employee_id` | UUID | FK → `employees.employee_id` ON DELETE SET NULL | NULL for open shifts |
| `shift_date` | DATE | NOT NULL | |
| `start_time` | TIME | NOT NULL | |
| `end_time` | TIME | NOT NULL | |
| `unpaid_break_minutes` | SMALLINT | NOT NULL DEFAULT 0 | |
| `department` | TEXT | NOT NULL | |
| `status` | TEXT | NOT NULL DEFAULT 'scheduled' | Values: `scheduled`, `sick`, `cancelled` |
| `notes` | TEXT | nullable | |
| `is_overnight` | BOOLEAN | NOT NULL DEFAULT FALSE | |
| `is_open_shift` | BOOLEAN | NOT NULL DEFAULT FALSE | |
| `name` | TEXT | nullable | shift label/name |
| `published_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Set to publish timestamp at snapshot time — same value for all rows in one publish batch |

**No `updated_at` column. No per-row change tracking beyond `published_at`.**

Indexes: `week_idx`, `employee_date_idx`, `open_date_idx (partial WHERE is_open_shift)`

RLS: enabled; authenticated users can SELECT; no INSERT/UPDATE/DELETE policy (admin client used for writes).

**Valid states / transitions**: table is replaced wholesale per-week on each publish. No row-level state machine; rows are deleted and re-inserted atomically per publish event.

**CRUD**:
- CREATE: `publishRotaWeek` server action (admin client)
- READ: feed routes (admin client), portal shift views (server client / anon)
- UPDATE: never — rows replaced, not updated
- DELETE: `publishRotaWeek` deletes entire week's rows before re-inserting

### `rota_weeks`
| Column | Notes |
|--------|-------|
| `id` | UUID PK |
| `week_start` | DATE |
| `status` | `'draft'` or `'published'` |
| `published_at` | TIMESTAMPTZ |
| `published_by` | UUID (user id) |
| `has_unpublished_changes` | BOOLEAN — set true when rota_shifts edited after publish |

---

## External Dependencies

### Supabase (PostgreSQL)
- **What**: Database for `rota_published_shifts`, `rota_shifts`, `rota_weeks`, `employees`
- **Client**: `createAdminClient()` (service role, bypasses RLS) in both feed routes and publish action
- **Calls in feed routes**: single SELECT with date range filter; no writes
- **Timeout/retry**: none configured in feed routes — DB error returns 500 with no retry

### Google Calendar (external consumer)
- **What**: Subscribes to ICS feed URL and polls on its own schedule
- **How it calls**: unconditional HTTP GET; does not send `If-None-Match` / `If-Modified-Since`
- **Refresh behaviour**: ignores `REFRESH-INTERVAL` and `X-PUBLISHED-TTL` in practice; polls every 8–24 hours at Google's discretion
- **Change detection**: compares `UID` + `SEQUENCE` + `LAST-MODIFIED` per VEVENT to detect added/changed events
- **Used by**: Flow 1 (manager feed), Flow 2 (employee feed)
- **Webhooks/callbacks**: none — pull-only

### Vercel Edge / CDN
- **What**: Hosts the Next.js app and serves API routes
- **Caching**: `force-dynamic` export on both routes and the rota page disables Next.js route-level caching
- **Edge cache**: `Cache-Control: no-cache, no-store, must-revalidate` instructs Vercel CDN and any intermediate proxy not to cache; Vercel should honour this
- **Vercel cron**: no cron targets the feed routes; no server-side push mechanism exists

---

## Missing Pieces

### HTTP Protocol Layer
- **No HTTP `ETag` header** on either feed response — Google cannot use conditional GET (`If-None-Match`) to confirm "nothing changed"
- **No HTTP `Last-Modified` header** on either feed response — Google cannot use `If-Modified-Since` conditional GET
- **No `304 Not Modified` response path** — server always returns full body regardless of whether content has changed
- **No `Pragma: no-cache`** or `Expires` header for legacy proxy compatibility

### ICS Protocol Layer
- **`SEQUENCE:0` hardcoded on all events** — RFC 5545 requires `SEQUENCE` to increment when a `VEVENT` is modified. Clients that see `SEQUENCE:0` on an event they already have with `SEQUENCE:0` may ignore the update even if `LAST-MODIFIED` changed. This is the most likely root cause of Google Calendar not picking up edits to existing events
- **No `LAST-MODIFIED` on the `VCALENDAR` itself** — some clients use calendar-level metadata; only per-event `LAST-MODIFIED` is present
- **`published_at` is set to the publish-batch timestamp** — all shifts in a re-publish get the same `published_at`. A shift that existed before and was not changed gets a new `published_at` equal to the latest publish time. Clients may or may not treat this as a modification signal
- **`DTSTAMP` is always the current request time** — `DTSTAMP` per RFC 5545 should reflect when the event was created/last sent, not the current wall clock. Using request time means every poll appears to clients as if every event was "just updated", which is noise rather than signal
- **No `ORGANIZER` property** on VEVENTs — not strictly required for `METHOD:PUBLISH` but missing for completeness
- **`STATUS:CANCELLED` used for sick shifts** — RFC 5545 defines `CANCELLED` as the event not occurring; a sick shift is a different concept. No compensation VEVENT (`METHOD:CANCEL`) is sent

### Auth / Security
- **`verifyCalendarToken` uses plain `===`** — not timing-safe; susceptible to timing oracle attack. Manager feed route correctly uses `timingSafeEqual`; portal feed does not
- **Token is static per employee** — HMAC(service_role_key, employee_id) never rotates unless service role key rotates. No revocation mechanism
- **Manager feed token is static** — same token forever; no expiry, no rotation UI

### Operational / Observability
- **No logging on feed requests** — successful feed fetches are not logged; cannot determine how often Google is polling or when it last fetched
- **No audit event for feed access** — no `logAuditEvent` call in either feed route
- **No health/diagnostic endpoint** — no way to verify the ICS output programmatically without a full subscription
- **No error response detail** — DB error returns plain text `'Error loading rota'` / `'Error loading shifts'` with no structured body

### Data Model
- **No `updated_at` on `rota_published_shifts`** — no per-row change timestamp independent of `published_at`
- **No per-shift change tracking** — if a manager edits one shift's time and re-publishes, all shifts in the week get the same new `published_at`; clients cannot distinguish which shift actually changed
- **`published_at` is not indexed** — feed routes do not filter or sort by `published_at`; full table scan on date range

### Missing Flows
- **No push/webhook on publish** — nothing notifies Google Calendar that new content is available; clients must wait for their next poll cycle
- **No cache-busting mechanism** — feed URL is identical before and after publish; no query param changes to force a fresh fetch
- **No `webcal://` scheme offered in UI** — `RotaFeedButton` shows `https://` URL only; some clients require `webcal://` for subscription (Apple Calendar especially). UI instructions mention subscription but do not offer a `webcal://` link
