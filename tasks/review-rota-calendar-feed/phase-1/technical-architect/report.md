# Technical Architect Report — Rota Calendar Feed Review

**Date:** 2026-03-15
**Reviewer:** Technical Architect Agent
**Scope:** `src/app/api/rota/feed/route.ts`, `src/app/api/portal/calendar-feed/route.ts`, `src/lib/portal/calendar-token.ts`

---

## 1. Failure-at-Step-N Analysis

These feeds are read-only — there is no multi-step write transaction to analyse. The risk profile is different: silent data failures producing a valid-looking but stale or empty calendar.

### Manager feed (`/api/rota/feed`)

| Step | What happens on failure |
|---|---|
| 1. Token validation | Returns 401 — safe, correct |
| 2. `supabase.from('rota_published_shifts').select(...)` | `error` is destructured; returns HTTP 500 with "Error loading rota" — **correctly handled** |
| 3. ICS generation loop | No per-shift error handling. If one shift has a null `start_time` or `end_time`, `icsDate()` will produce `T:00` or crash with `Cannot read properties of null` — the entire response fails with an unhandled exception, Vercel returns 500, and the subscribing calendar app receives an error and stops updating |

### Staff portal feed (`/api/portal/calendar-feed`)

| Step | What happens on failure |
|---|---|
| 1. Token verification | Returns 401 — correct |
| 2. Employee lookup | `maybeSingle()` — returns `null` not an error on miss; correctly returns 404 |
| 3. Shifts query | **CRITICAL: no `error` destructuring** — `const { data: shifts }` silently swallows any DB error. The feed returns `BEGIN:VCALENDAR … END:VCALENDAR` with zero events. The subscribing client sees a valid empty calendar and deletes all previously shown events from the user's calendar view. The user sees all their shifts disappear with no indication of a problem |
| 4. ICS loop | Same null-field crash risk as manager feed |

---

## 2. Architecture Assessment

**Verdict: Acceptable for a small internal tool but contains correctness and RFC compliance gaps that explain the reported "not updating" problem.**

The architecture is simple and appropriate — a stateless HTTP GET that queries the DB and streams ICS. There is no caching layer to invalidate, no background job, no webhook. The root cause of "feed not updating" is almost certainly not the server code but the **calendar client's polling interval** (see Section 6).

Code duplication is significant: `icsDate`, `addOneDay`, `escapeICS`, `foldLine` are copy-pasted verbatim into both route files. A shared `src/lib/ics/` module is needed.

---

## 3. RFC 5545 Compliance Audit

### 3.1 VTIMEZONE — VIOLATION (HIGH)

Both feeds use `DTSTART;TZID=Europe/London:` without including a `VTIMEZONE` component in the `VCALENDAR`. RFC 5545 §3.6.5 states:

> "The 'VTIMEZONE' calendar component MUST be present if the iCalendar object contains a 'DTSTART' or 'DTEND' property that is specified as a DATE-TIME value with a FORM #3 … local time with time zone reference."

Apple Calendar is strict about this: it may display events in UTC instead of London time, or reject the timezone reference entirely. Google Calendar tolerates the omission (it has a built-in TZID database) but the RFC violation is real.

**Fix required:** Insert a `VTIMEZONE` block for `Europe/London` (including BST/GMT transitions) between the calendar header and the first `VEVENT`.

### 3.2 foldLine — BUG (MEDIUM)

The current implementation folds at **byte** boundaries using `Buffer.slice`. If the 75th byte falls in the middle of a multi-byte UTF-8 character (e.g. an em-dash `—` is 3 bytes: `E2 80 94`), the slice produces:

- Line 1 ends with incomplete bytes (invalid UTF-8)
- Continuation line starts with the remaining bytes (also invalid UTF-8)

RFC 5545 requires folding at 75 **octets** (bytes), but the continuation must still form valid UTF-8. The fix is to find the last valid UTF-8 character boundary at or before byte 75, not slice blindly.

**Practical risk:** Employee names and shift names in this system are likely ASCII-only, so the bug may be dormant. The em-dash `—` in the staff portal calendar name (`X-WR-CALNAME:${empName} — Shifts`) **will trigger this bug** if `empName` is long enough to push the em-dash past byte 75.

### 3.3 SEQUENCE / LAST-MODIFIED — MISSING (HIGH — root cause of "not updating")

When a shift's time changes, the UID remains `shift-{id}@anchor-management`. The DTSTAMP is always `now()` (the time of the HTTP request). Calendar clients use SEQUENCE and LAST-MODIFIED to detect updates:

- **SEQUENCE**: integer incremented each time an event is modified. Without it, defaults to 0 — clients cannot tell the event changed.
- **LAST-MODIFIED**: UTC datetime of last DB modification. Without it, clients compare only DTSTAMP, which changes on every request and is not a reliable change indicator.

**Impact:** Google Calendar and Apple Calendar may cache the previous version of an event and not apply the updated DTSTART/DTEND even after re-fetching the feed, because they see the same UID and SEQUENCE:0 and consider the event unchanged. This is the most likely cause of the reported bug.

**Fix required:** Add `SEQUENCE` (derived from a version counter or the updated_at epoch) and `LAST-MODIFIED` (from the shift's `updated_at` column) to each VEVENT. This requires `updated_at` to be selected in the DB query.

### 3.4 REFRESH-INTERVAL / X-PUBLISHED-TTL — MISSING (HIGH — root cause of "not updating")

Without these hints, calendar apps use their own default polling interval:
- Google Calendar: **approximately 24 hours** (and this is not configurable by the user)
- Apple Calendar: **approximately 1 hour** (configurable in Preferences)

A manager who adds a shift and expects to see it in their calendar within minutes will be disappointed regardless of server correctness. This is a **user expectation problem** as much as a technical one.

**Fix required:** Add to the VCALENDAR header:
```
REFRESH-INTERVAL;VALUE=DURATION:PT15M
X-PUBLISHED-TTL:PT15M
```

This hints to clients to poll every 15 minutes. Google Calendar respects `X-PUBLISHED-TTL`; Apple Calendar respects `REFRESH-INTERVAL`. Neither guarantee real-time updates.

### 3.5 Cache-Control headers — LOW RISK

Both routes send `Cache-Control: no-cache, no-store, must-revalidate`. Calendar subscription clients (Google, Apple) do **not** honour HTTP cache headers for subscription feeds — they use their own internal polling timers. The header is harmless but ineffective at the actual problem.

`Pragma: no-cache` is missing but irrelevant for this use case (calendar clients are not HTTP/1.0 proxies).

---

## 4. Data Model Assessment

### Shift data fields used
- `shift_date` (date string), `start_time`, `end_time`, `is_overnight`, `status`, `department`, `name`, `notes`, `id`, `is_open_shift`, `employee_id`
- `employee.first_name`, `employee.last_name` (joined in manager feed)

**Missing from query:** `updated_at` — needed for `LAST-MODIFIED` and `SEQUENCE`. Both queries must add `updated_at` to the select.

**Null field risk:** `start_time` and `end_time` are not guarded against null in `icsDate()`. If a shift record has a null time, `timeStr.split(':')` throws. This should be validated before the loop.

---

## 5. Integration Robustness

### Token Security

**Manager feed token:**
`SHA-256(SUPABASE_SERVICE_ROLE_KEY).substring(0, 32)` — This is a deterministic, non-rotatable token. If the service role key is ever rotated, the feed URL breaks. If `ROTA_FEED_SECRET` is not set, the token is derived from a production secret in a non-obvious way. **The bigger problem:** comparison is done with `===` which is **not constant-time** — a timing oracle attack is theoretically possible but extremely low risk in this context (calendar URL token, not a financial API).

**Staff portal token:**
`HMAC-SHA256(SUPABASE_SERVICE_ROLE_KEY, employeeId).slice(0, 32)` — Better design (HMAC is keyed). Same `===` timing issue and same non-rotatable key concern. Comparison with `===` instead of `crypto.timingSafeEqual` is a minor security gap.

**Practical risk:** Low. These are calendar subscription URLs, not authenticated sessions. The token just prevents public scraping of the rota.

---

## 6. Error Handling Audit

| Location | Issue | Severity |
|---|---|---|
| `portal/calendar-feed` shifts query | No `error` destructuring — silent DB failure returns empty calendar | **Critical** |
| Both feeds | No null guard on `shift.start_time` / `shift.end_time` | **High** |
| Both feeds | No guard if `shift.shift_date` is null | **Medium** |
| Manager feed | Correctly returns 500 on DB error | OK |
| Token comparison | Uses `===` not `timingSafeEqual` | Low |

---

## 7. Technical Debt

1. **Complete code duplication** — `icsDate`, `addOneDay`, `escapeICS`, `foldLine` duplicated verbatim across both routes. Extract to `src/lib/ics/utils.ts`.
2. **No `VTIMEZONE` component** — RFC violation, will cause timezone display issues on Apple Calendar.
3. **No `SEQUENCE` / `LAST-MODIFIED`** — events appear unchanged to calendar clients after edits.
4. **No `REFRESH-INTERVAL` / `X-PUBLISHED-TTL`** — clients poll at default intervals (up to 24h for Google).
5. **Silent failure in portal feed** — empty calendar returned on DB error.
6. **`foldLine` splits multi-byte UTF-8** — will corrupt names containing non-ASCII characters (currently triggered by the em-dash in the calendar name if it falls near the 75-byte boundary).
7. **Token derived from service role key** — non-rotatable; no independent `ROTA_FEED_SECRET` enforced.
8. **`updated_at` not selected** — blocks implementing `LAST-MODIFIED` and `SEQUENCE`.

---

## 8. Root Cause Summary — "Feed not updating"

The reported problem has **two compounding causes**, in priority order:

1. **Missing `REFRESH-INTERVAL` / `X-PUBLISHED-TTL`**: Google Calendar defaults to ~24h polling. The data is correct on the server but clients don't ask for it often enough.

2. **Missing `SEQUENCE` / `LAST-MODIFIED`**: Even when clients do re-fetch, they may not apply changes to existing events because SEQUENCE is always absent (treated as 0) and they deduplicate by UID+SEQUENCE.

These two issues together explain exactly why "subscribing works" (initial events appear) but "updates don't show" (changed events don't propagate). The `VTIMEZONE` omission is a separate correctness issue that would cause timezone display problems but not the refresh failure.

---

## 9. Recommended Fix Priority

| Priority | Fix |
|---|---|
| P1 | Add `REFRESH-INTERVAL:PT15M` and `X-PUBLISHED-TTL:PT15M` to both VCALENDAR headers |
| P1 | Add `SEQUENCE` and `LAST-MODIFIED` to every VEVENT (requires `updated_at` in DB select) |
| P1 | Fix silent DB error in portal feed — destructure `error` and return 500 |
| P2 | Add `VTIMEZONE` block for `Europe/London` to both feeds |
| P2 | Fix `foldLine` to not split multi-byte UTF-8 characters |
| P3 | Extract shared ICS utilities to `src/lib/ics/utils.ts` |
| P3 | Replace `===` token comparison with `crypto.timingSafeEqual` |
| P3 | Guard against null `start_time` / `end_time` in `icsDate()` |
