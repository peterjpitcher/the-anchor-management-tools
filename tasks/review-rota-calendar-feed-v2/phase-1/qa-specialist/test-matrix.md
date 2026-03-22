# Test Matrix — Rota Calendar Feed v2
**QA Specialist** | Date: 2026-03-15 | Status: COMPLETE

---

## T001 — Google Calendar respects REFRESH-INTERVAL:PT1H

| Field | Value |
|---|---|
| Category | Google Calendar behaviour |
| Scenario | Google Calendar polls feed more frequently because REFRESH-INTERVAL is set |
| Preconditions | Feed subscribed in Google Calendar; ICS contains `REFRESH-INTERVAL;VALUE=DURATION:PT1H` |
| Steps | 1. Subscribe feed. 2. Add new shift. 3. Wait 1 hour. 4. Check Google Calendar. |
| Expected | No — Google Calendar explicitly ignores REFRESH-INTERVAL. Documented Google behaviour. |
| Actual | FAIL — Google ignores this property. Code adds it (ICS_CALENDAR_REFRESH_LINES) but it has zero effect on Google. |
| Status | **FAIL** |
| Priority | High |
| Notes | Code comment says "Fixes DEFECT-001: without these, Google Calendar caches up to 24h" — this comment is factually wrong. REFRESH-INTERVAL does not fix this for Google. |

---

## T002 — Google Calendar respects X-PUBLISHED-TTL:PT1H

| Field | Value |
|---|---|
| Category | Google Calendar behaviour |
| Scenario | X-PUBLISHED-TTL causes Google to poll every hour |
| Preconditions | Feed subscribed in Google Calendar; ICS contains `X-PUBLISHED-TTL:PT1H` |
| Steps | 1. Subscribe feed. 2. Add new shift. 3. Wait 1 hour. 4. Check Google Calendar. |
| Expected | No — Google Calendar explicitly ignores X-PUBLISHED-TTL. |
| Actual | FAIL — Google ignores this property. Code adds it but it has zero effect on Google. |
| Status | **FAIL** |
| Priority | High |
| Notes | Apple Calendar and Fastmail do honour X-PUBLISHED-TTL, so the property is not entirely useless — but it does not solve the Google problem. |

---

## T003 — Google Calendar actual refresh interval

| Field | Value |
|---|---|
| Category | Google Calendar behaviour |
| Scenario | Confirm how long Google actually takes to poll the feed |
| Preconditions | Feed subscribed in Google Calendar |
| Steps | Monitor request logs for Google Calendar user-agent polling the feed URL |
| Expected | 12–24 hours per Google's documented behaviour; sometimes up to 7 days if Google deems the content unchanged |
| Actual | BLOCKED — cannot observe from code alone; requires live log inspection. Documented Google behaviour is 12–24 h minimum. |
| Status | **BLOCKED** |
| Priority | High |
| Notes | This is the root cause of the symptom. There is no ICS mechanism to force a shorter interval in Google. |

---

## T004 — Google adds new event (new UID) on next poll

| Field | Value |
|---|---|
| Category | Google Calendar behaviour |
| Scenario | New shift published → new UID in feed → Google adds event when it next polls |
| Preconditions | Feed subscribed; new shift published (new UUID, so new UID `shift-{uuid}@anchor-management`) |
| Steps | 1. Publish new shift. 2. Wait for Google to poll (12–24 h). 3. Check Google Calendar. |
| Expected | PASS — Google reliably adds events with new UIDs when it polls. |
| Actual | PASS — code generates stable UIDs (`shift-{id}@anchor-management`). New UUID = new UID = Google will add it. |
| Status | **PASS** |
| Priority | High |
| Notes | The delay is Google's poll interval, not a code defect. If users report "never appears," check T030 (date range) and T060 (published_at write correctness). |

---

## T005 — Google updates existing event when SEQUENCE:0 and LAST-MODIFIED unchanged

| Field | Value |
|---|---|
| Category | Google Calendar behaviour |
| Scenario | Shift time changed after publish; same UID; SEQUENCE stays 0; LAST-MODIFIED stays at original publish_at |
| Preconditions | Shift published, then shift time edited and week re-published |
| Steps | 1. Publish week. 2. Edit shift time. 3. Re-publish week. 4. Check feed — SEQUENCE:0, LAST-MODIFIED = re-publish time (new `published_at`). 5. Wait for Google poll. |
| Expected | Uncertain — Google may or may not update. Per RFC 5545 §3.8.7.4, SEQUENCE increment signals modification. Without increment, behaviour is client-defined. Google typically does update on re-poll if DTSTART differs, but this is not guaranteed. |
| Actual | FAIL — SEQUENCE is always 0 even for re-published (modified) events. This is a protocol violation for modified events. |
| Status | **FAIL** |
| Priority | Critical |
| Notes | See DEF-002. |

---

## T010 — Response includes ETag header

| Field | Value |
|---|---|
| Category | HTTP response correctness |
| Scenario | ETag header present for efficient conditional GET |
| Preconditions | Request manager feed or portal feed |
| Steps | `curl -I https://.../api/rota/feed?token=...` |
| Expected | `ETag: "<hash>"` header in response |
| Actual | FAIL — no ETag header in either feed. Manager feed response only has `Content-Type`, `Content-Disposition`, `Cache-Control`. Portal feed is identical. |
| Status | **FAIL** |
| Priority | Medium |
| Notes | See DEF-003. Without ETag, clients cannot send conditional GET (If-None-Match). Not the primary cause of the Google update problem, but a protocol gap. |

---

## T011 — Response includes Last-Modified header

| Field | Value |
|---|---|
| Category | HTTP response correctness |
| Scenario | Last-Modified HTTP header present for conditional GET |
| Preconditions | Request either feed |
| Steps | `curl -I https://.../api/rota/feed?token=...` |
| Expected | `Last-Modified: <RFC 7231 date>` header |
| Actual | FAIL — no Last-Modified HTTP header. (LAST-MODIFIED exists as an ICS VEVENT property, but not as an HTTP response header — these are different things.) |
| Status | **FAIL** |
| Priority | Medium |
| Notes | See DEF-003. |

---

## T012 — Cache-Control prevents Vercel edge caching

| Field | Value |
|---|---|
| Category | HTTP response correctness |
| Scenario | `Cache-Control: no-cache, no-store, must-revalidate` prevents Vercel from serving stale feed to Google |
| Preconditions | Route deployed on Vercel; `export const dynamic = 'force-dynamic'` present in both routes |
| Steps | Inspect code for `dynamic` export and response headers |
| Expected | PASS — both `force-dynamic` and `no-cache, no-store, must-revalidate` are present |
| Actual | PASS — manager feed: `export const dynamic = 'force-dynamic'` + `Cache-Control: no-cache, no-store, must-revalidate`. Portal feed: same. Vercel will not cache these routes at the edge. |
| Status | **PASS** |
| Priority | High |
| Notes | Vercel edge cache is NOT the cause of Google not seeing updates. |

---

## T013 — Response includes Pragma: no-cache

| Field | Value |
|---|---|
| Category | HTTP response correctness |
| Scenario | Pragma: no-cache for HTTP/1.0 proxy compatibility |
| Preconditions | Either feed |
| Steps | Inspect response headers |
| Expected | `Pragma: no-cache` and `Expires: 0` ideally present for belt-and-braces caching prevention |
| Actual | FAIL — neither header present. `Cache-Control` is sufficient for HTTP/1.1; `Pragma` only matters for HTTP/1.0 proxies. Low severity given modern infrastructure. |
| Status | **FAIL** |
| Priority | Low |
| Notes | See DEF-004. Unlikely to be the cause of Google's behaviour. |

---

## T020 — DTSTAMP semantics correct

| Field | Value |
|---|---|
| Category | ICS property correctness |
| Scenario | DTSTAMP represents the time the iCalendar object was created/published, not the time the feed was served |
| Preconditions | RFC 5545 §3.8.7.2: DTSTAMP is the date-time the iCalendar object was created in the calendar store |
| Steps | Fetch the feed twice 10 minutes apart. Compare DTSTAMP values for the same UID. |
| Expected | RFC says DTSTAMP should be stable (the time the event was first created/published). |
| Actual | FAIL — `DTSTAMP` is set to `icsTimestamp(new Date())` — the current time at feed generation. It changes on every request. This means Google sees a different DTSTAMP on every poll, which may signal to Google that every event has been "recreated," potentially causing duplicates or spurious updates. |
| Status | **FAIL** |
| Priority | High |
| Notes | See DEF-001. Should be `published_at` (stable) not `new Date()` (volatile). |

---

## T021 — SEQUENCE:0 correct for new events

| Field | Value |
|---|---|
| Category | ICS property correctness |
| Scenario | SEQUENCE:0 is RFC-compliant for a brand new event |
| Preconditions | Shift published for first time |
| Steps | Inspect ICS output for newly published shift |
| Expected | PASS — RFC 5545 §3.8.7.4: SEQUENCE starts at 0 for new events |
| Actual | PASS — `SEQUENCE:0` is correct for a first-time published shift. |
| Status | **PASS** |
| Priority | Low |

---

## T022 — SEQUENCE increments for modified events

| Field | Value |
|---|---|
| Category | ICS property correctness |
| Scenario | When a shift is modified (time/date/department changed) and re-published, SEQUENCE should be > 0 |
| Preconditions | Shift published (SEQUENCE:0), then time changed, then week re-published |
| Steps | 1. Publish week. 2. Fetch feed — note SEQUENCE:0. 3. Edit shift time. 4. Re-publish week. 5. Fetch feed — check SEQUENCE. |
| Expected | SEQUENCE > 0 (e.g. SEQUENCE:1) per RFC 5545 §3.8.7.4: "The revision sequence number MUST be incremented each time the calendar information associated with the calendar component is revised." |
| Actual | FAIL — SEQUENCE is hardcoded to `0` for all events in both feeds. On re-publish, `rota_published_shifts` is deleted and re-inserted with the same UUID. Since there is no revision counter stored anywhere in the schema, SEQUENCE cannot be computed. Always 0. |
| Status | **FAIL** |
| Priority | Critical |
| Notes | See DEF-002. This is likely a contributing factor to Google not updating existing events. |

---

## T023 — LAST-MODIFIED reflects actual last modification time

| Field | Value |
|---|---|
| Category | ICS property correctness |
| Scenario | LAST-MODIFIED accurately reflects when the shift record was last modified |
| Preconditions | Shift published, then time changed, then re-published |
| Steps | 1. Publish week (published_at = T0). 2. Edit shift time. 3. Re-publish (published_at = T1, new row inserted). 4. Fetch feed — check LAST-MODIFIED. |
| Expected | LAST-MODIFIED = T1 (the re-publish time) |
| Actual | PASS (conditionally) — on re-publish, `publishRotaWeek` deletes the old row and inserts a new one with `published_at: now`. So LAST-MODIFIED in the ICS = T1 after re-publish. However: LAST-MODIFIED is only updated at re-publish. If a shift's notes or status changes without a re-publish, LAST-MODIFIED will be stale — but this scenario is unlikely given the publish workflow. |
| Status | **PASS (conditional)** |
| Priority | Medium |
| Notes | The snapshot model (delete + re-insert) means `published_at` correctly reflects the last publish timestamp. The defect in T020 (volatile DTSTAMP) is the more serious issue. |

---

## T024 — UIDs are globally unique

| Field | Value |
|---|---|
| Category | ICS property correctness |
| Scenario | UID format `shift-{uuid}@anchor-management` (manager) and `staff-shift-{uuid}@anchor-management` (portal) are globally unique |
| Preconditions | UUIDs used as primary keys in `rota_published_shifts` |
| Steps | Inspect UID format in ICS output |
| Expected | PASS — UUIDs are globally unique per RFC 4122 |
| Actual | PASS — manager feed: `shift-{id}@anchor-management`; portal feed: `staff-shift-{id}@anchor-management`. Both use the same UUID that is the primary key of `rota_published_shifts`. Globally unique. |
| Status | **PASS** |
| Priority | Low |
| Notes | Note the two feeds use DIFFERENT UID namespaces (`shift-` vs `staff-shift-`). A shift subscribed via both feeds will appear as two different events in a calendar that subscribes to both. This is correct behaviour since they serve different audiences. |

---

## T030 — Feed covers correct date range

| Field | Value |
|---|---|
| Category | Feed content correctness |
| Scenario | Feed includes shifts from today−28 days to today+84 days |
| Preconditions | Both routes |
| Steps | Inspect query logic in both routes |
| Expected | `from = today − 28 days`, `to = today + 84 days` |
| Actual | PASS — both manager and portal feeds compute: `from.setDate(from.getDate() - 28)` and `to.setDate(to.getDate() + 84)`. Matches spec. |
| Status | **PASS** |
| Priority | High |

---

## T031 — Cancelled shifts excluded from feed

| Field | Value |
|---|---|
| Category | Feed content correctness |
| Scenario | Shifts with status='cancelled' do not appear in feed |
| Preconditions | Both routes |
| Steps | Inspect query `.neq('status', 'cancelled')` |
| Expected | PASS — cancelled shifts filtered out at DB level |
| Actual | PASS — both routes apply `.neq('status', 'cancelled')` before querying. |
| Status | **PASS** |
| Priority | Medium |
| Notes | Note: sick shifts ARE included (status='sick' is not filtered). They appear with `STATUS:CANCELLED` in the ICS and "Status: Sick" in DESCRIPTION. This is correct behaviour. |

---

## T032 — Feed reflects shift modifications after re-publish

| Field | Value |
|---|---|
| Category | Feed content correctness |
| Scenario | When a shift is edited and the week is re-published, the feed returns the updated shift data |
| Preconditions | Shift published; time changed; week re-published |
| Steps | 1. Publish week. 2. Fetch feed — note shift time. 3. Edit shift time. 4. Re-publish week. 5. Fetch feed immediately. |
| Expected | Feed immediately returns updated shift time after re-publish |
| Actual | PASS — `publishRotaWeek` does a delete+insert of all shifts for the week. The next feed request queries `rota_published_shifts` which now has the updated data. |
| Status | **PASS** |
| Priority | High |
| Notes | The feed is correct immediately after re-publish. The problem is purely that Google won't poll for 12–24 h. |

---

## T033 — Shifts beyond 84 days excluded from feed

| Field | Value |
|---|---|
| Category | Feed content correctness |
| Scenario | Shifts published more than 84 days in the future do not appear in feed |
| Preconditions | Shift with date > today + 84 days exists in rota_published_shifts |
| Steps | Publish a shift for 85+ days in future. Fetch feed. Check. |
| Expected | Shift does NOT appear. |
| Actual | PASS — `.lte('shift_date', toStr)` filters out shifts beyond the window. |
| Status | **PASS** |
| Priority | High |
| Notes | CRITICAL edge case for "why isn't my shift showing?" — if a manager publishes shifts for next quarter (>12 weeks out), they will be invisible in the feed. The UI does not warn about this limit. See DEF-005. |

---

## T040 — Feed URL uses https:// scheme

| Field | Value |
|---|---|
| Category | URL and subscription mechanics |
| Scenario | Feed URL passed to RotaFeedButton and CalendarSubscribeButton uses https:// |
| Preconditions | App deployed on Vercel with HTTPS |
| Steps | Inspect URL shown in UI |
| Expected | https:// scheme |
| Actual | PASS — URL comes from `NEXT_PUBLIC_APP_URL` which is an https:// URL on Vercel. |
| Status | **PASS** |
| Priority | Medium |

---

## T041 — webcal:// scheme used appropriately for Apple/Outlook

| Field | Value |
|---|---|
| Category | URL and subscription mechanics |
| Scenario | CalendarSubscribeButton converts https:// to webcal:// for Apple/Outlook deep link |
| Preconditions | Staff portal CalendarSubscribeButton component |
| Steps | Inspect CalendarSubscribeButton.tsx |
| Expected | webcal:// deep-link triggers OS calendar app directly |
| Actual | PASS — `const webcalUrl = feedUrl.replace(/^https?:\/\//, 'webcal://')`. Apple Calendar and Outlook respond to webcal:// to open subscription dialog directly. |
| Status | **PASS** |
| Priority | Medium |

---

## T042 — Google Calendar "Add to Google" URL correctly encoded

| Field | Value |
|---|---|
| Category | URL and subscription mechanics |
| Scenario | The "Add to Google Calendar" link in CalendarSubscribeButton correctly encodes the webcal URL |
| Preconditions | Staff portal CalendarSubscribeButton |
| Steps | Inspect URL: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}` |
| Expected | PASS — Google Calendar's `?cid=` parameter accepts an encoded webcal:// URL |
| Actual | PASS — URL is correctly constructed. Google Calendar will subscribe to the feed when clicked. |
| Status | **PASS** |
| Priority | High |
| Notes | This is a better UX than asking users to paste a URL manually. However, this deep link only works for the employee portal (CalendarSubscribeButton). The manager-facing RotaFeedButton (used by managers/admins) requires manual URL paste with no Google deep-link. See DEF-006. |

---

## T043 — RotaFeedButton missing Google Calendar deep link

| Field | Value |
|---|---|
| Category | URL and subscription mechanics |
| Scenario | Manager-facing RotaFeedButton provides a Google Calendar deep-link equivalent to CalendarSubscribeButton |
| Preconditions | Manager subscribes to rota feed from authenticated rota page |
| Steps | Inspect RotaFeedButton.tsx |
| Expected | Same "Add to Google Calendar" quick-link as CalendarSubscribeButton for good UX |
| Actual | FAIL — RotaFeedButton only offers copy-to-clipboard + manual instructions ("Google Calendar — Other calendars → From URL"). No deep link. CalendarSubscribeButton (portal) is significantly better UX. |
| Status | **FAIL** |
| Priority | Medium |
| Notes | See DEF-006. Not a protocol defect but a UX disparity between the two subscription flows. |

---

## T050 — Manager feed rejects invalid token

| Field | Value |
|---|---|
| Category | Authentication |
| Scenario | Manager feed returns 401 for missing or wrong token |
| Preconditions | Feed requested without token or with wrong token |
| Steps | Inspect `isValidToken` check in manager route |
| Expected | 401 Unauthorized |
| Actual | PASS — `if (!token || !isValidToken(token, getFeedToken())) return new Response('Unauthorized', { status: 401 })` |
| Status | **PASS** |
| Priority | High |

---

## T051 — Portal feed rejects invalid employee_id/token

| Field | Value |
|---|---|
| Category | Authentication |
| Scenario | Portal feed returns 401 for missing/wrong token or employee_id |
| Preconditions | Feed requested without valid calendar token |
| Steps | Inspect `verifyCalendarToken` check in portal route |
| Expected | 401 Unauthorized |
| Actual | PASS — `if (!employeeId || !token || !verifyCalendarToken(employeeId, token)) return new Response('Unauthorized', { status: 401 })` |
| Status | **PASS** |
| Priority | High |

---

## T060 — rota_published_shifts is a regular table (not a materialized view)

| Field | Value |
|---|---|
| Category | Database correctness |
| Scenario | rota_published_shifts does not have refresh delays associated with materialized views |
| Preconditions | Review migration SQL |
| Steps | Inspect `20260503000002_published_shifts_snapshot.sql` |
| Expected | PASS if regular table; FAIL if materialized view |
| Actual | PASS — `CREATE TABLE IF NOT EXISTS rota_published_shifts`. It is a regular table, not a materialized view. No refresh lag. Data is immediately queryable after `publishRotaWeek` inserts it. |
| Status | **PASS** |
| Priority | High |

---

## T061 — published_at correctly set on publish

| Field | Value |
|---|---|
| Category | Database correctness |
| Scenario | published_at is set to the actual publish timestamp, not a stale value |
| Preconditions | publishRotaWeek action |
| Steps | Inspect publishRotaWeek: `currentShifts.map(s => ({ ...s, published_at: now }))` |
| Expected | published_at = exact timestamp of publish action |
| Actual | PASS — `const now = new Date().toISOString()` captured once and applied to all inserted rows in the same publish operation. All shifts in a week get the same published_at timestamp. |
| Status | **PASS** |
| Priority | Medium |

---

## T062 — UI text "updates automatically" is misleading

| Field | Value |
|---|---|
| Category | User expectations |
| Scenario | UI text accurately describes Google Calendar's refresh behaviour |
| Preconditions | RotaFeedButton.tsx and CalendarSubscribeButton.tsx |
| Steps | Read UI copy |
| Expected | Accurate statement about update timing |
| Actual | FAIL — RotaFeedButton says "The feed updates automatically." CalendarSubscribeButton says "Subscribe to keep your calendar automatically up to date when the rota changes." Both imply near-real-time updates. Google Calendar takes 12–24 h to refresh. This sets false user expectations. |
| Status | **FAIL** |
| Priority | High |
| Notes | See DEF-007. |

---

## Summary

| Status | Count |
|---|---|
| PASS | 13 |
| FAIL | 9 |
| BLOCKED | 1 |

**Critical FAILs**: T005 (SEQUENCE never increments), T020 (volatile DTSTAMP), T001/T002 (REFRESH-INTERVAL/X-PUBLISHED-TTL comment misleads that these fix Google)
**High FAILs**: T062 (misleading UI text), T010/T011 (missing ETag/Last-Modified HTTP headers)
**Medium FAILs**: T013 (no Pragma/Expires), T043 (manager feed missing Google deep-link)
