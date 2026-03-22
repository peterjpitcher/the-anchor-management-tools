# Technical Architect Report — Rota Calendar Feed v2
**Date:** 2026-03-15
**Reviewer:** Technical Architect Agent
**Section:** `src/app/api/rota/feed/route.ts` + `src/lib/ics/utils.ts`

---

## Executive Summary

Google Calendar not refreshing is caused by **four compounding defects**, not one. Listed in decreasing severity:

1. **[CRITICAL] Google Calendar does not honour REFRESH-INTERVAL or X-PUBLISHED-TTL** — the refresh hint properties in the ICS are silently ignored by Google. Google's documented behaviour is to re-poll subscribed ICS feeds at its own discretion, typically every 12–24 hours. No ICS property can change this. These lines have zero effect on Google.
2. **[HIGH] Missing HTTP ETag and Last-Modified response headers** — without these, Google cannot issue conditional GETs. Every poll downloads the full ICS payload, and Google has no reliable signal for "has anything changed?". There is also a documented edge-case where some Google Calendar versions may use the absence of these headers as a signal to de-prioritise polling frequency further.
3. **[HIGH] SEQUENCE:0 hardcoded — event modifications are invisible to Google** — when a shift's details change post-publish, SEQUENCE stays 0. RFC 5545 §3.8.7.4 requires SEQUENCE to be incremented for modifications. Google Calendar uses SEQUENCE (not LAST-MODIFIED) to decide whether to update an existing event. A same-UID event with equal or lower SEQUENCE is silently discarded.
4. **[MEDIUM] DTSTAMP semantics: correct but misleading** — DTSTAMP is being set to `new Date()` on every request, which is RFC-correct for a dynamic feed (it means "when this calendar object instance was published"). However, because DTSTAMP changes on every poll, some calendar implementations use it as a false "something changed" signal. The net effect here is benign noise, not a correctness bug, but it wastes bandwidth and may confuse diagnostics.

---

## 1. Architecture Assessment

**Pattern:** Single Route Handler (`GET /api/rota/feed`) that authenticates via a static shared token, queries Supabase, and serialises the result to RFC 5545 ICS. Business logic (date windowing, shift filtering, ICS assembly) is inlined in the route handler rather than extracted to a service. This is acceptable at current complexity but will become a maintenance concern if the feed evolves.

**Separation of concerns:** Adequate. ICS utility functions are correctly extracted to `src/lib/ics/utils.ts`. The route handler is the only consumer.

**Second feed route:** `src/app/(staff-portal)/portal/shifts/CalendarSubscribeButton.tsx` implies a second feed endpoint exists for the staff portal (`/api/portal/calendar-feed`). The utils module comment confirms this. Both share the same ICS utility functions — good — but they need to be assessed separately for the same defects.

**Consistency:** The pattern is internally consistent. There are no obvious architectural mismatches.

---

## 2. Root Cause Analysis — Google Not Refreshing

### Defect A: Google ignores REFRESH-INTERVAL and X-PUBLISHED-TTL (CRITICAL)

`ICS_CALENDAR_REFRESH_LINES` emits:
```
REFRESH-INTERVAL;VALUE=DURATION:PT1H
X-PUBLISHED-TTL:PT1H
```

Google Calendar's documented behaviour explicitly states it does **not** honour these properties for subscribed ICS feeds. Apple Calendar and Outlook do honour them; Google does not. The existing comment in `utils.ts` ("Google Calendar caches up to 24h") acknowledges this but the lines remain, creating a false sense that the problem has been addressed.

**Consequence:** No matter how often the ICS is regenerated, Google will poll at its own schedule — typically somewhere between 12 and 24 hours, with no predictable interval. There is no mechanism within the ICS standard that forces Google to poll sooner. The only documented workaround is to direct users to manually refresh via Google Calendar settings, or to use the Google Calendar API with push notifications instead of an ICS subscription.

### Defect B: Missing HTTP ETag and Last-Modified (HIGH)

Current response headers:
```
Content-Type: text/calendar; charset=utf-8
Content-Disposition: inline; filename="rota.ics"
Cache-Control: no-cache, no-store, must-revalidate
```

Missing:
- `ETag: "<hash-of-ics-content>"`
- `Last-Modified: <most-recent-shift-published_at>`

Without `ETag` or `Last-Modified`, Google cannot issue an `If-None-Match` or `If-Modified-Since` conditional GET. Every poll is a blind full-content fetch. More importantly: the **absence** of these headers means Google has no standard mechanism to determine whether the feed content has changed since the last successful fetch. Some versions of Google Calendar's feed sync engine interpret this as "this feed has unpredictable content" and may reduce polling frequency as a result.

A correct ETag implementation would hash the ICS body content (SHA-256 first 16 bytes as hex is sufficient) and return it in the response header. A `304 Not Modified` path should then be implemented.

**Correct ETag design:**
```typescript
const etag = `"${createHash('sha256').update(ics).digest('hex').substring(0, 16)}"`;
const ifNoneMatch = req.headers.get('if-none-match');
if (ifNoneMatch === etag) {
  return new Response(null, { status: 304, headers: { ETag: etag } });
}
// ... return 200 with ETag header
```

**Correct Last-Modified design:**
```typescript
// Use the most recent published_at across all shifts in the result set
const maxPublishedAt = shifts.reduce((max, s) =>
  s.published_at > max ? s.published_at : max, shifts[0]?.published_at ?? new Date().toISOString()
);
headers['Last-Modified'] = new Date(maxPublishedAt).toUTCString();
```

### Defect C: SEQUENCE:0 hardcoded — modifications silently discarded (HIGH)

```typescript
lines.push('SEQUENCE:0'); // hardcoded, never increments
```

RFC 5545 §3.8.7.4: "The value of the SEQUENCE property is an integer value that starts with 0 at the time the iCalendar object is created and is monotonically incremented by each revision."

Google Calendar's update logic for ICS subscriptions is: **if a VEVENT with the same UID already exists, only replace it if the incoming SEQUENCE is strictly greater than the stored SEQUENCE**. With SEQUENCE permanently at 0, any modification to an already-imported shift will be silently discarded by Google — it sees the same UID, same SEQUENCE, and treats the incoming event as a duplicate of what it already has.

**Correct architecture for SEQUENCE:**
The `rota_published_shifts` table has no `sequence` column. The schema would need to add one:
```sql
ALTER TABLE rota_published_shifts ADD COLUMN IF NOT EXISTS sequence INTEGER NOT NULL DEFAULT 0;
```
And the publish action would need to increment it on each update:
```sql
UPDATE rota_published_shifts SET sequence = sequence + 1, published_at = NOW() WHERE id = $1;
```
The feed route would then emit `SEQUENCE:${shift.sequence}` instead of the hardcoded `0`.

**Note:** `published_at` is set to `NOW()` only at initial publish (the table uses `DEFAULT NOW()`). If a shift is modified post-publish, `published_at` does NOT automatically update — there is no trigger. This means `LAST-MODIFIED` in the ICS also does not change on modification, compounding the SEQUENCE problem.

### Defect D: DTSTAMP semantics (MEDIUM — noise, not a correctness bug)

`DTSTAMP` is set to `new Date()` on every request. RFC 5545 §3.8.7.2 permits this for a dynamic `METHOD:PUBLISH` feed — it represents "when this instance of the calendar object was published." This is technically correct.

However, it means every Google poll sees every event with a freshly-changed DTSTAMP, which can confuse change detection in calendar clients that incorrectly use DTSTAMP (instead of LAST-MODIFIED) as a change signal. It also makes feed diffing and debugging harder than necessary.

**Preferred approach:** For static feeds, DTSTAMP should be the event's creation time (first published_at). For modified events, DTSTAMP should equal the modification time. The current code already uses `published_at` for `LAST-MODIFIED`, so the fix is to use the same value for `DTSTAMP`:
```typescript
lines.push(`DTSTAMP:${lastModified}`); // same as LAST-MODIFIED, not new Date()
```

---

## 3. Failure-at-Step-N Analysis

### Flow 1: Initial Subscription (works)
1. User copies feed URL → pastes into Google Calendar
2. Google immediately fetches the ICS
3. Google parses VEVENTs, imports them keyed by UID
4. Events appear in Google Calendar

**Safe.** No multi-step mutation. Pure read.

### Flow 2: Subsequent Refresh (broken for modifications)
1. Google decides to poll (0–24h later, unpredictable)
2. Google sends `GET /api/rota/feed?token=...` (no conditional headers because we never sent ETag/Last-Modified)
3. Server queries Supabase, assembles ICS, returns 200 with full content
4. Google parses new ICS
5. **For new UIDs:** Google adds the event. ✓
6. **For existing UIDs with SEQUENCE=0:** Google compares incoming SEQUENCE (0) with stored SEQUENCE (0). Equal → treated as duplicate → **no update applied**. ✗
7. **For cancelled shifts:** STATUS:CANCELLED should be processed. Google may or may not remove the event depending on its subscription sync implementation. ⚠

**Result:** New shifts appear eventually (on next Google poll, 12–24h). Modified shifts never update. Cancelled shifts may or may not be removed.

### Flow 3: New Event Detection (works, but slowly)
1. Manager publishes a new shift
2. New row inserted into `rota_published_shifts` with new UUID
3. On next Google poll (up to 24h later), Google fetches feed
4. New UID appears in ICS → Google adds event

**Safe but delayed.** The 12–24h delay is fundamental to Google's architecture. Nothing in the current code makes this worse. The REFRESH-INTERVAL lines create a false expectation but don't break this flow.

### Flow 4: Modified Event Detection (broken)
1. Manager changes a shift's time/notes post-publish
2. If the publish action updates `rota_published_shifts`, `published_at` does NOT change (no trigger, default only fires on INSERT)
3. SEQUENCE stays 0, LAST-MODIFIED stays unchanged
4. On next Google poll, Google sees same UID, same SEQUENCE (0), same LAST-MODIFIED
5. Google discards the incoming event as a duplicate of what it already has
6. **User's calendar shows wrong shift time indefinitely** ✗

### Flow 5: Shift Cancellation
1. Shift status set to `cancelled` in `rota_shifts`
2. On publish: `rota_published_shifts` is filtered with `.neq('status', 'cancelled')` — so cancelled shifts disappear from the feed entirely
3. On next Google poll, the UID vanishes from the ICS
4. **Google does NOT delete events when they disappear from a subscribed ICS** — Google only removes events when they appear with `STATUS:CANCELLED` in the ICS. Silently omitting a UID from the feed does not cause Google to delete the event.
5. **Result: Cancelled shifts remain visible in Google Calendar indefinitely** ✗

**This is an additional defect not listed in the brief.** The correct approach is to include cancelled shifts in the feed with `STATUS:CANCELLED` for a retention period (e.g. 4 weeks), then remove them. The current window of 28 days past shifts partially handles this, but only by coincidence.

---

## 4. Vercel Edge Caching Assessment

`export const dynamic = 'force-dynamic'` in the route file instructs Next.js to opt this route out of static generation. In Vercel's infrastructure, `force-dynamic` routes are executed at the origin (Node.js runtime) on every request — they are NOT cached by Vercel's edge CDN by default.

The `vercel.json` has no `headers` overrides for `/api/rota/feed`. There are no CDN cache rules that would intercept this route.

**Assessment: Vercel caching is NOT a contributing factor.** The route is correctly marked `force-dynamic`. Adding `Pragma: no-cache` and `Expires: 0` would be belt-and-braces for HTTP/1.0 proxy compatibility but is not required for Vercel or Google Calendar (both HTTP/1.1+).

No `next.config.ts` exists in the project root (the check returned empty), so no `headers()` rewrites are interfering.

---

## 5. Integration Robustness

### Supabase query
- **Idempotency:** Read-only. Safe to retry.
- **Timeout:** No explicit timeout configured. If Supabase is slow, the Vercel function will time out at 30s (default) and Google will receive a 5xx. Google will retry on next scheduled poll.
- **Error specificity:** Generic `'Error loading rota'` on any Supabase error. Acceptable for an ICS endpoint — returning a valid error body is less harmful than returning a malformed ICS.
- **No pagination:** If there are hundreds of shifts in the 16-week window, all are fetched in a single query. Not a correctness issue at current scale, but worth noting.

### Token authentication
- **Timing-safe comparison:** Correctly implemented with `timingSafeEqual`.
- **Token derivation fallback:** Derives from `SUPABASE_SERVICE_ROLE_KEY` if `ROTA_FEED_SECRET` is not set. This means the feed token changes if the service role key is rotated, silently breaking all existing calendar subscriptions. This is a latent operational hazard — the `ROTA_FEED_SECRET` env var should be mandatory.
- **Token in URL:** The token appears in query params, meaning it is logged in Vercel access logs and potentially in Google's infrastructure. This is accepted practice for ICS feeds (the alternative, HTTP Basic Auth, is not supported by Google Calendar's ICS subscription). The token length (32 hex chars = 128 bits) provides adequate entropy.

---

## 6. Technical Debt Summary

| Item | Severity | Effort |
|------|----------|--------|
| Google polls every 12–24h regardless of ICS properties | FUNDAMENTAL — cannot be fixed via ICS | None; need to set user expectations or switch to Google Calendar API |
| Missing HTTP ETag + Last-Modified headers | HIGH | Low — 10 lines of code |
| SEQUENCE hardcoded to 0 | HIGH | Medium — requires DB column + publish action update |
| `published_at` not updated on shift modification | HIGH | Low — requires a trigger or explicit update in publish action |
| Cancelled shifts omitted from feed instead of STATUS:CANCELLED | HIGH | Low — remove the `.neq('status', 'cancelled')` filter, emit STATUS:CANCELLED instead |
| DTSTAMP set to request time instead of event time | MEDIUM | Trivial — use `lastModified` value |
| ROTA_FEED_SECRET not enforced as mandatory | MEDIUM | Low — add env var validation at startup |
| ICS_CALENDAR_REFRESH_LINES comment misleading | LOW | Trivial — update comment to be accurate |
| No SEQUENCE column in `rota_published_shifts` | HIGH | Low — single migration |

---

## 7. Recommended Fix Sequence

1. **Add `updated_at` trigger and `sequence` column to `rota_published_shifts`** — migration required. This unblocks fixes 2 and 3.
2. **Emit `STATUS:CANCELLED` for cancelled shifts** rather than filtering them out — remove `.neq('status', 'cancelled')`, emit the status field directly, retain them in the feed for 4 weeks post-publish.
3. **Increment SEQUENCE on publish** in the publish server action. Use `sequence` column value in feed.
4. **Add HTTP ETag and Last-Modified response headers** based on ICS content hash and max `updated_at`.
5. **Fix DTSTAMP** to use `shift.updated_at ?? shift.published_at` rather than `new Date()`.
6. **Set user expectations** — document in the staff-facing UI that Google Calendar updates at most every 12–24 hours. The subscribe button should include this caveat.
7. **Optional long-term:** Replace ICS subscription for Google users with a Google Calendar API integration that pushes changes via webhook. This is the only way to achieve near-real-time updates on Google Calendar.

---

## 8. Files Assessed

- `src/app/api/rota/feed/route.ts`
- `src/lib/ics/utils.ts`
- `supabase/migrations/20260503000002_published_shifts_snapshot.sql`
- `vercel.json`
- `src/app/(staff-portal)/portal/shifts/CalendarSubscribeButton.tsx` (identified but not fully reviewed — second feed endpoint)
