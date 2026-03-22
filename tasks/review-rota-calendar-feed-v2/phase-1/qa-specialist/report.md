# QA Report — Rota Calendar Feed v2
**QA Specialist** | Date: 2026-03-15 | Phase: 1

---

## Executive Summary

The root problem — Google Calendar not updating when new shifts are added — has two distinct causes. The primary cause is **Google's documented 12–24 hour poll interval, which cannot be overridden by ICS metadata**. The secondary cause is **a collection of ICS protocol violations** (volatile DTSTAMP, hardcoded SEQUENCE:0) that prevent calendar clients from correctly merging updates when they do eventually poll. The previous round of fixes (REFRESH-INTERVAL, X-PUBLISHED-TTL, VTIMEZONE, LAST-MODIFIED, SEQUENCE:0) addressed real RFC compliance gaps but included a misdiagnosis: the code comments assert these fixes will resolve the Google update problem, but Google ignores REFRESH-INTERVAL and X-PUBLISHED-TTL entirely.

**Total tests**: 23 | **PASS**: 13 | **FAIL**: 9 | **BLOCKED**: 1

---

## Defect Log

### DEF-001 — DTSTAMP is volatile (changes on every feed request)

| Field | Value |
|---|---|
| Severity | High |
| Test Cases | T020 |
| Summary | `DTSTAMP` set to `icsTimestamp(new Date())` — the current server time at feed generation, not the event creation/publication time |
| Expected | Per RFC 5545 §3.8.7.2: DTSTAMP is the date-time the calendar object was first created in the calendar store — it must be stable for a given UID |
| Actual | Every feed request generates a new DTSTAMP for all events. Two requests 10 minutes apart will show identical UIDs with different DTSTAMPs. |
| Business Impact | Calendar clients use DTSTAMP to detect whether an event has changed. A changing DTSTAMP signals that the event was "recreated" every poll. Depending on the client, this can cause duplicate events or trigger unnecessary re-processing. For Google, it means no event looks stable — every event appears new on every poll. |
| Root Cause | Both route handlers compute `const dtstamp = icsTimestamp(new Date())` and apply it to all events. DTSTAMP should be `published_at` (or shift creation time) — a stable, event-specific timestamp. |
| Affected Files | `src/app/api/rota/feed/route.ts` (line: `const dtstamp = icsTimestamp(new Date())`) |  `src/app/api/portal/calendar-feed/route.ts` (same pattern) |
| Fix | Use `icsTimestamp(shift.published_at)` for DTSTAMP. Fall back to `icsTimestamp(new Date())` only if `published_at` is null. This makes DTSTAMP stable per event across feed requests. |

---

### DEF-002 — SEQUENCE is always 0, even for modified and re-published events

| Field | Value |
|---|---|
| Severity | Critical |
| Test Cases | T005, T022 |
| Summary | Both feeds hardcode `SEQUENCE:0` for every event, regardless of whether the shift has been modified and re-published |
| Expected | Per RFC 5545 §3.8.7.4: SEQUENCE must increment each time a calendar component is revised. A modified event must have SEQUENCE > 0. |
| Actual | After publish: SEQUENCE:0. After editing shift time and re-publishing: still SEQUENCE:0. Google Calendar uses SEQUENCE to decide whether to update an existing event. With SEQUENCE unchanged, Google is not obligated to replace its cached version. |
| Business Impact | When a manager changes a shift time and re-publishes, Google Calendar may silently ignore the update because SEQUENCE:0 signals "this is the original version." Staff see the wrong shift time until Google's cache naturally expires. |
| Root Cause | `rota_published_shifts` has no `sequence` or `revision` column. The snapshot model (delete+insert) means revision history is not tracked. SEQUENCE cannot be computed without a stored counter. |
| Affected Files | `src/app/api/rota/feed/route.ts` (`SEQUENCE:0` hardcoded) | `src/app/api/portal/calendar-feed/route.ts` (same) | `supabase/migrations/20260503000002_published_shifts_snapshot.sql` (schema lacks sequence column) |
| Fix | Add a `sequence` integer column to `rota_published_shifts`. Increment it on each re-insert for a given UUID. On first publish: sequence=0. On re-publish of the same UUID: sequence=previous+1. Use `sequence` in the ICS output. Requires migration. |

---

### DEF-003 — Missing HTTP ETag and Last-Modified response headers

| Field | Value |
|---|---|
| Severity | Medium |
| Test Cases | T010, T011 |
| Summary | Neither feed route returns HTTP `ETag` or `Last-Modified` headers |
| Expected | HTTP conditional GET support via ETag (If-None-Match) and Last-Modified (If-Modified-Since) |
| Actual | Response only contains `Content-Type`, `Content-Disposition`, `Cache-Control`. No conditional GET support. |
| Business Impact | Without ETag/Last-Modified, every Google poll fetches the full ICS body regardless of whether anything changed. This wastes bandwidth and, more importantly, prevents Google from using conditional GET responses (304 Not Modified) as a signal about content freshness. Some calendar clients use conditional GET to decide whether to process the response. |
| Root Cause | Response construction does not compute or include these headers. ETag would need to be a hash of the ICS content. Last-Modified would be the most recent `published_at` across all returned shifts. |
| Affected Files | `src/app/api/rota/feed/route.ts` (Response headers) | `src/app/api/portal/calendar-feed/route.ts` (Response headers) |
| Fix | Compute `contentHash = sha256(ics)`, add `ETag: "${contentHash}"`. Compute `latestPublishedAt = max(shift.published_at)` across all shifts, add `Last-Modified: <RFC 7231 format>`. Handle `If-None-Match` and `If-Modified-Since` request headers with 304 responses. |

---

### DEF-004 — Missing Pragma: no-cache and Expires: 0 headers

| Field | Value |
|---|---|
| Severity | Low |
| Test Cases | T013 |
| Summary | Neither feed returns `Pragma: no-cache` or `Expires: 0` |
| Expected | Belt-and-braces cache prevention for HTTP/1.0 proxies |
| Actual | Cache-Control is present but Pragma/Expires are absent |
| Business Impact | Negligible in practice — modern proxies and CDNs (including Vercel's infrastructure) use HTTP/1.1+. Google's calendar crawler also uses HTTP/1.1+. This is a minor robustness gap. |
| Affected Files | `src/app/api/rota/feed/route.ts` | `src/app/api/portal/calendar-feed/route.ts` |
| Fix | Add `Pragma: no-cache` and `Expires: 0` to response headers. Low priority. |

---

### DEF-005 — No UI warning when shifts are beyond the 84-day feed window

| Field | Value |
|---|---|
| Severity | Medium |
| Test Cases | T033 |
| Summary | Shifts published more than 84 days (12 weeks) in the future are silently excluded from the feed with no user warning |
| Expected | Managers and staff should know the feed has a 12-week forward window |
| Actual | The feed correctly excludes shifts beyond 84 days, but the UI (RotaFeedButton, CalendarSubscribeButton) says nothing about this limit. A manager publishing a rota for the next quarter (13+ weeks out) will find those shifts missing from all subscribed calendars with no explanation. |
| Business Impact | "My shift isn't in my calendar" support tickets for far-future shifts. Symptoms look identical to the Google refresh problem, making diagnosis harder. |
| Affected Files | `src/app/(authenticated)/rota/RotaFeedButton.tsx` | `src/app/(staff-portal)/portal/shifts/CalendarSubscribeButton.tsx` |
| Fix | Add a note to the subscription UI: "Shows shifts from 4 weeks ago to 12 weeks ahead." No code change to the feed logic required. |

---

### DEF-006 — RotaFeedButton lacks "Add to Google Calendar" deep link

| Field | Value |
|---|---|
| Severity | Medium |
| Test Cases | T043 |
| Summary | The manager-facing RotaFeedButton requires manual URL copy-paste; CalendarSubscribeButton (portal) provides a one-click "Add to Google Calendar" deep link |
| Expected | Consistent UX: managers should also get a one-click Google Calendar subscription |
| Actual | RotaFeedButton only offers a copy-to-clipboard button and text instructions. CalendarSubscribeButton constructs `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}` and provides a direct link. |
| Business Impact | Managers are less likely to subscribe to the feed if the UX is clunky. Non-subscribed managers miss rota changes. |
| Affected Files | `src/app/(authenticated)/rota/RotaFeedButton.tsx` |
| Fix | Add webcal:// and Google Calendar deep-link buttons to RotaFeedButton, matching the pattern in CalendarSubscribeButton. |

---

### DEF-007 — UI text creates false expectation of near-real-time updates

| Field | Value |
|---|---|
| Severity | High |
| Test Cases | T062 |
| Summary | Both subscription UIs state the calendar "updates automatically" without qualifying the update delay |
| Expected | Accurate description of update timing for each calendar app |
| Actual | RotaFeedButton: "The feed updates automatically." CalendarSubscribeButton: "Subscribe to keep your calendar automatically up to date when the rota changes." Neither mentions that Google Calendar takes 12–24 hours to refresh. |
| Business Impact | Staff and managers expect new shifts to appear within minutes. When they don't appear for 12–24 hours, they assume the feature is broken and raise support queries or lose trust in the system. |
| Affected Files | `src/app/(authenticated)/rota/RotaFeedButton.tsx` (line 37) | `src/app/(staff-portal)/portal/shifts/CalendarSubscribeButton.tsx` (line 28) |
| Fix | Add a note: "Google Calendar refreshes every 12–24 hours. Apple Calendar and Outlook refresh more frequently." |

---

### DEF-008 — Code comments claim REFRESH-INTERVAL/X-PUBLISHED-TTL fix Google Calendar behaviour (factually incorrect)

| Field | Value |
|---|---|
| Severity | Medium |
| Test Cases | T001, T002 |
| Summary | `ICS_CALENDAR_REFRESH_LINES` comment in `ics/utils.ts` says "Fixes DEFECT-001: without these, Google Calendar caches up to 24h". This is factually wrong — Google ignores these properties. |
| Expected | Comments accurately describe what each property does and which clients it affects |
| Actual | `/** Fixes DEFECT-001: without these, Google Calendar caches up to 24h, Apple up to 1 week. PT1H = refresh every 1 hour. */` — Google does NOT respect REFRESH-INTERVAL or X-PUBLISHED-TTL. This comment will mislead future developers into thinking the problem is solved when it is not. |
| Business Impact | Future developers will not look for a real fix to the Google refresh problem because they believe it's already fixed. Technical debt + incorrect mental model. |
| Affected Files | `src/lib/ics/utils.ts` (ICS_CALENDAR_REFRESH_LINES comment) |
| Fix | Correct the comment: `// Apple Calendar and Outlook respect REFRESH-INTERVAL and X-PUBLISHED-TTL. // Google Calendar ignores both — its minimum poll interval is 12–24 hours regardless. // These properties are still included for non-Google clients.` |

---

## Root Cause Analysis: Why Google Calendar Doesn't Update

The investigation confirms a **three-layer problem**:

**Layer 1 — Google's architecture (cannot be fixed from our side)**
Google Calendar polls ICS subscriptions on its own schedule: approximately every 12–24 hours, sometimes longer. No ICS property can override this. REFRESH-INTERVAL and X-PUBLISHED-TTL are ignored by Google. This means the minimum delay between publishing a new shift and it appearing in Google Calendar is 12–24 hours. This is expected and correct behaviour. The business must be told this is a fundamental limitation of Google Calendar ICS subscriptions, not a bug.

**Layer 2 — ICS protocol violations make the delay worse (fixable)**
Even when Google does poll, it uses SEQUENCE and DTSTAMP to decide what to update. With SEQUENCE always 0 and DTSTAMP changing on every request, Google receives conflicting signals: events appear "new" (changing DTSTAMP) but "unmodified" (SEQUENCE:0). This makes Google's merge behaviour unpredictable. Fixing DEF-001 (stable DTSTAMP) and DEF-002 (incrementing SEQUENCE) will ensure Google correctly processes events when it does poll.

**Layer 3 — User expectations are set incorrectly (fixable immediately)**
The UI says "updates automatically" without any timing qualifier. Fixing DEF-007 removes the gap between expectation (immediate) and reality (12–24 hours).

**If new shifts are not appearing at all (not just delayed):** check T033 — shifts beyond 84 days are silently excluded. This is the most common "invisible shift" scenario unrelated to Google's poll interval.

---

## Coverage Assessment

| Domain | Coverage |
|---|---|
| Google Calendar behaviour | Full — 5 tests covering documented Google behaviour |
| HTTP response headers | Full — all expected headers checked |
| ICS property correctness | Full — DTSTAMP, LAST-MODIFIED, SEQUENCE, UID all checked |
| Feed content / date range | Full — date range, cancelled shifts, overnight shifts |
| URL/subscription mechanics | Full — webcal://, Google deep-link, https scheme |
| Authentication | Full — both feeds, both token types |
| Database correctness | Full — table type, published_at write, real-time availability |
| UI text | Full — both subscription components |
| Edge cases | Partial — T033 covers 84-day boundary; long shift names (fold-line) not retested here (addressed by prior DEFECT-005 fix) |

---

## Implementation Engineer Acceptance Criteria

Each fix below must reference the defect ID and pass the linked test cases.

| Fix | Defect | Tests | Priority |
|---|---|---|---|
| Stable DTSTAMP using published_at | DEF-001 | T020 | High |
| SEQUENCE column + increment on re-publish | DEF-002 | T005, T022 | Critical |
| ETag + Last-Modified HTTP headers | DEF-003 | T010, T011 | Medium |
| Correct ICS_CALENDAR_REFRESH_LINES comment | DEF-008 | T001, T002 | Medium |
| UI warning: Google 12–24 h delay | DEF-007 | T062 | High |
| UI warning: 84-day feed window | DEF-005 | T033 | Medium |
| RotaFeedButton Google deep-link | DEF-006 | T043 | Medium |
| Pragma/Expires headers | DEF-004 | T013 | Low |
