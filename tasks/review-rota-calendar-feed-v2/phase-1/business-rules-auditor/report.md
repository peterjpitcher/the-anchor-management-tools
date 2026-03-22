# Business Rules Audit — Rota Calendar Feed v2
**Date**: 2026-03-15
**Auditor**: Business Rules Auditor Agent
**Files reviewed**: `src/app/api/rota/feed/route.ts`, `src/app/api/portal/calendar-feed/route.ts`, `src/lib/ics/utils.ts`, `src/app/(authenticated)/rota/RotaFeedButton.tsx`

---

## 1. Rules Inventory

| # | Rule | Source | Code Location | Verdict |
|---|------|--------|---------------|---------|
| R1 | Feed includes shifts from last 4 weeks and next 12 weeks | Brief | Both routes: `from.setDate(-28)`, `to.setDate(+84)` | **Correct** |
| R2 | Cancelled shifts do not appear in feed | Brief | Both routes: `.neq('status', 'cancelled')` (DB filter) | **Partially correct** — see Finding F1 |
| R3 | New shifts appear after being published | Brief | No push/notify mechanism exists | **Missing** — Google ignores PT1H |
| R4 | Google Calendar is a target client | Brief | RotaFeedButton.tsx: "Google Calendar — Other calendars → From URL" | **Correct** (instructions present) |
| R5 | "The feed updates automatically" is a truthful claim | Brief | RotaFeedButton.tsx: "The feed updates automatically" | **Incorrect** — see Finding F2 |
| R6 | REFRESH-INTERVAL:PT1H causes Google to refresh hourly | Brief / code comment | `ICS_CALENDAR_REFRESH_LINES` in utils.ts | **Incorrect** — see Finding F3 |
| R7 | SEQUENCE should increment when event details change | RFC 5545 | Both routes: `SEQUENCE:0` hardcoded | **Incorrect** — see Finding F4 |
| R8 | DTSTAMP should be time event was created/last modified | RFC 5545 §3.8.7.2 | Both routes: `DTSTAMP = icsTimestamp(new Date())` — set to current request time | **Incorrect** — see Finding F5 |
| R9 | webcal:// vs https:// protocol for subscriptions | Brief | RotaFeedButton passes `feedUrl` (https://); no `webcal://` conversion | **Incorrect** — see Finding F6 |
| R10 | HTTP response should not be cached by intermediaries | Code | `Cache-Control: no-cache, no-store, must-revalidate` | **Correct** |
| R11 | VTIMEZONE block required for TZID= references | RFC 5545 §3.6.5 | `VTIMEZONE_EUROPE_LONDON` included in both routes | **Correct** |
| R12 | LAST-MODIFIED set to shift's published_at | Brief / code | Both routes: `shift.published_at ?? dtstamp` | **Correct in principle, flawed in practice** — see Finding F7 |

---

## 2. Value Audit

| Property | Value in Code | Should Be | Match? |
|----------|---------------|-----------|--------|
| Past window | 28 days (`setDate(-28)`) | 4 weeks = 28 days | Yes |
| Future window | 84 days (`setDate(+84)`) | 12 weeks = 84 days | Yes |
| REFRESH-INTERVAL | `PT1H` | PT1H (declared intent) | Yes — but Google ignores this entirely |
| X-PUBLISHED-TTL | `PT1H` | PT1H (declared intent) | Yes — but Google ignores this entirely |
| SEQUENCE | `0` (hardcoded) | Should increment on reschedule | No |
| DTSTAMP | `new Date()` at request time | Time event was last modified in organiser's system | No |
| VTIMEZONE STANDARD offset | `TZOFFSETFROM:+0100 TZOFFSETTO:+0000` | Correct (BST→GMT) | Yes |
| VTIMEZONE DAYLIGHT offset | `TZOFFSETFROM:+0000 TZOFFSETTO:+0100` | Correct (GMT→BST) | Yes |
| Date range: `from` | UTC midnight - 28 days | Should be local London midnight | Minor risk (see Finding F8) |

---

## 3. Customer-Facing Language Audit

| Text | Location | Accurate? | Issue |
|------|----------|-----------|-------|
| "The feed updates automatically" | RotaFeedButton.tsx | **No** | Google Calendar refreshes every 12–24 hours (documented throttle), not automatically on publish. This is a false promise. |
| "Google Calendar — Other calendars → From URL" | RotaFeedButton.tsx | Yes | Correct path as of current Google Calendar UI |
| "Apple Calendar — File → New Calendar Subscription" | RotaFeedButton.tsx | Yes | Correct |
| "Outlook — Add calendar → Subscribe from web" | RotaFeedButton.tsx | Yes | Correct |
| "Subscribe" (button label) | RotaFeedButton.tsx | Yes | Clear |
| "Calendar feed" (panel header) | RotaFeedButton.tsx | Yes | Clear |
| "Subscribe to see all rota shifts in your calendar app." | RotaFeedButton.tsx | Yes | Accurate |

---

## 4. Policy Drift Findings

### F1 — Sick shifts appear in feed with STATUS:CANCELLED (inconsistent rule)
**Severity: Medium**

The DB query filters `.neq('status', 'cancelled')` — so database-cancelled shifts are excluded. However, shifts with `status === 'sick'` pass the DB filter and are included in the feed with `STATUS:CANCELLED` in the ICS. This means a "sick" shift is both included in the feed AND marked cancelled, which in RFC 5545 semantics tells calendar clients to show the event but cross it out. The business rule says "cancelled shifts should not appear in the feed" — sick shifts are not the same as cancelled shifts but the ICS STATUS:CANCELLED may cause them to disappear or appear stricken in calendar apps. Behaviour is inconsistent between the two routes (both have the same bug).

**Code**: Both routes: `STATUS:${shift.status === 'sick' ? 'CANCELLED' : 'CONFIRMED'}`

**Impact**: Staff may see sick-day events as struck-through or hidden in their calendar, depending on the client. Intended behaviour is not clearly documented.

---

### F2 — UI claims "updates automatically" — this is false for Google Calendar
**Severity: High**

The `RotaFeedButton.tsx` reads: _"The feed updates automatically."_ Google Calendar has a hard-coded refresh throttle of **12–24 hours** per its own support documentation, regardless of `REFRESH-INTERVAL` or `X-PUBLISHED-TTL` in the ICS. This is intentional Google policy, not a bug that can be fixed on the server side. Staff subscribing via Google Calendar will not see new shifts for up to 24 hours after publication. The claim is factually incorrect for the primary target client.

**Source conflict**: Code comment in `utils.ts` says _"Fixes DEFECT-001: without these, Google Calendar caches up to 24h"_ — the code's own comment acknowledges the 24h ceiling, yet the UI copy above it says "updates automatically."

---

### F3 — REFRESH-INTERVAL:PT1H is not honoured by Google Calendar
**Severity: High**

`ICS_CALENDAR_REFRESH_LINES` emits `REFRESH-INTERVAL;VALUE=DURATION:PT1H` and `X-PUBLISHED-TTL:PT1H`. These are respected by Apple Calendar and some Outlook versions, but Google Calendar ignores them. Google's documented behaviour is a minimum 12-hour refresh interval for subscribed ICS feeds. The code comment says this fixes DEFECT-001 — it does not fix the problem for Google, only for Apple/Outlook. No code fix exists that will force Google to refresh on demand; this requires a push-based solution (e.g. manual "force refresh" link, or notifying staff to manually refresh).

---

### F4 — SEQUENCE:0 hardcoded — RFC 5545 violation causes missed updates
**Severity: High — root cause of "new shifts don't appear after modification"**

RFC 5545 §3.8.7.4: _"The 'SEQUENCE' property is used by a 'VEVENT' ... to revise the definition of a calendar component."_ When `SEQUENCE` never increments, a calendar client receiving an updated event (same UID, changed time/date/details) has no RFC-compliant signal that it should replace its cached copy. The client is permitted to ignore the update because `SEQUENCE:0` is identical to what it saw before.

For new events this is acceptable (first-time sequence is 0). For **modified** events (shift time moved, date changed, name changed), `SEQUENCE` must be greater than the previously sent value. Hardcoding 0 means:
- A shift rescheduled from 18:00 to 10:00 will continue to show as 18:00 in Google Calendar
- Google has no RFC signal to expire its cached event
- This is the most likely root cause of the "does not update" problem

**Fix direction**: Derive SEQUENCE from a monotonic counter stored per-shift in the DB (e.g. an integer column incremented on each update to DTSTART, DTEND, or SUMMARY), or compute as a hash-derived version number.

---

### F5 — DTSTAMP set to current request time — RFC 5545 violation
**Severity: Medium**

RFC 5545 §3.8.7.2: _"DTSTAMP ... specifies the date and time that the calendar information was created by the calendar user agent in the calendar store."_ The current implementation sets `DTSTAMP = icsTimestamp(new Date())` — i.e., the moment the HTTP request is processed. This means:

1. Every time Google polls the feed, every event has a different DTSTAMP
2. Some clients use DTSTAMP to determine "is this a newer version of the event" — perpetually changing DTSTAMP may cause spurious re-processing
3. The field is semantically wrong: it should be `published_at` (when the organiser created/modified the entry), not the request timestamp

`LAST-MODIFIED` is correctly set to `published_at`, but `DTSTAMP` should be as well (or set to `created_at` for the first version of the event).

**Fix direction**: Set `DTSTAMP` to `shift.published_at` (or `shift.created_at`), same as `LAST-MODIFIED`. This makes the ICS output stable across requests when no data has changed.

---

### F6 — Feed URL served as https:// — webcal:// would be better for calendar subscriptions
**Severity: Low-Medium**

The `feedUrl` passed to `RotaFeedButton` is an `https://` URL. Calendar apps handle both, but `webcal://` is the IANA-registered scheme for ICS subscriptions and causes most calendar apps to open a "subscribe" dialog automatically rather than downloading the file. Google Calendar's "From URL" dialog accepts both, so this is not blocking — but `webcal://` would produce a one-click subscribe experience on Apple Calendar and Outlook.

The UI instructions currently ask users to manually copy the URL into their calendar app's "subscribe from URL" dialog. Converting `https://` to `webcal://` in the displayed URL (a simple `.replace('https://', 'webcal://')`) would allow single-click subscription on Apple Calendar and some Outlook versions, improving the onboarding experience.

---

### F7 — LAST-MODIFIED correctly uses published_at, but published_at does not update on shift reschedule
**Severity: High**

`LAST-MODIFIED` is set to `shift.published_at`. This is the right field to use — but only if `published_at` is updated when a shift is modified (not just when it is first published). If `published_at` is set once on first publication and never updated when the shift time/date changes, then `LAST-MODIFIED` will be stale after a reschedule. This means:

- Shift is published at 09:00 on Monday → `published_at = Monday 09:00`
- Admin reschedules shift time on Tuesday → `published_at` remains Monday 09:00 (if not updated)
- Google sees `LAST-MODIFIED` hasn't changed → assumes event hasn't changed → does not update

This is a **DB/server-action concern** (whether `published_at` is updated on reschedule), not a feed concern, but the feed relies on it being correct. The audit cannot confirm DB behaviour from feed code alone — **this must be verified in the rota publish/update server actions**.

---

### F8 — Date window boundary computed from UTC midnight, not London midnight
**Severity: Low**

Both routes compute `from` and `to` using `new Date()` (UTC-based) and `.toISOString().split('T')[0]`. In winter (GMT = UTC), this is correct. In summer (BST = UTC+1), `new Date()` at 23:30 BST is actually `new Date()` at 22:30 UTC — which gives yesterday's date as the start. Practically this means the window start/end can be off by one day during BST, though this is unlikely to cause meaningful user impact given the 4-week lookback window.

---

## 5. Summary of Critical Findings

| Finding | Severity | Root Cause of Reported Bug? |
|---------|----------|----------------------------|
| F1 — Sick shifts appear with CANCELLED status | Medium | No — separate issue |
| F2 — UI copy "updates automatically" is false | High | Misleading UX |
| F3 — REFRESH-INTERVAL ignored by Google | High | Yes — partial root cause |
| F4 — SEQUENCE:0 hardcoded | High | **Yes — primary root cause** |
| F5 — DTSTAMP set to request time | Medium | Yes — contributing factor |
| F6 — https:// vs webcal:// | Low-Medium | No — onboarding friction only |
| F7 — LAST-MODIFIED relies on published_at being updated | High | Yes — if published_at is stale |
| F8 — Date window UTC vs London time | Low | No |

---

## 6. What Cannot Be Fixed in Code Alone

Google Calendar's 12–24 hour refresh throttle is a **Google policy decision**, not an ICS compliance issue. No combination of headers, properties, or HTTP cache directives will force Google to refresh within an hour. The UI claim "The feed updates automatically" is the most immediately actionable fix: it must be updated to set accurate expectations (e.g. _"Google Calendar may take up to 24 hours to show new shifts. For immediate updates, remove and re-add the calendar subscription."_).

The true fix for near-real-time updates would be a push-based mechanism (e.g. send staff an SMS/email when new shifts are published, rather than relying on calendar sync cadence).
