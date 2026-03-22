# Business Rules Auditor Report — Rota Calendar Feed
**Date:** 2026-03-15
**Section:** `src/app/api/rota/feed/`, `src/app/api/portal/calendar-feed/`, `src/app/(authenticated)/rota/RotaFeedButton.tsx`

---

## 1. Rules Inventory

| # | Rule | Source | Code Location | Verdict |
|---|------|--------|---------------|---------|
| 1 | Feed covers last 4 weeks to next 12 weeks | Brief | `route.ts:71-75` — `from - 28d`, `to + 84d` | **Correct** |
| 2 | Cancelled shifts must not appear | Brief | `route.ts:82` — `.neq('status', 'cancelled')` | **Correct** |
| 3 | Only PUBLISHED shifts appear (via `rota_published_shifts`) | Brief | `route.ts:80` — queries `rota_published_shifts` | **Correct** |
| 4 | Feed secured with token | Brief | `route.ts:60-63` — token compared with `getFeedToken()` | **Correct** |
| 5 | `ROTA_FEED_SECRET` takes precedence over derived token | Brief | `route.ts:getFeedToken()` + `page.tsx:feedToken` derivation | **Correct** |
| 6 | Manager feed (all staff) and per-employee portal feed both exist | Brief | `api/rota/feed/route.ts` + `api/portal/calendar-feed/route.ts` | **Correct** |
| 7 | Feed includes `VTIMEZONE` component when `TZID=Europe/London` is used | RFC 5545 §3.6.5 | **NOT FOUND** in either feed | **MISSING — CRITICAL** |
| 8 | Feed includes `REFRESH-INTERVAL` or `X-PUBLISHED-TTL` to hint refresh frequency | RFC 5545 / iCal clients | **NOT FOUND** in either feed | **MISSING — HIGH** |
| 9 | VEVENTs include `SEQUENCE` to signal updates | RFC 5545 | **NOT FOUND** in either feed | **MISSING — HIGH** |
| 10 | VEVENTs include `LAST-MODIFIED` to signal changes | RFC 5545 | **NOT FOUND** in either feed | **MISSING — MEDIUM** |
| 11 | "The feed updates automatically" — calendar clients should refresh it | UI copy (RotaFeedButton.tsx) | UI claims this; RFC compliance does not support it | **INCORRECT** |
| 12 | Sick shifts must not appear as "normal" — status communicated | Inferred | `route.ts:126,136` — shown in description + `STATUS:CANCELLED` | **Partially correct — see note** |

---

## 2. Value Audit

| Value | In Code | Should Be | Match? |
|-------|---------|-----------|--------|
| Past window | 28 days (4 weeks) | 4 weeks | Yes |
| Future window | 84 days (12 weeks) | 12 weeks | Yes |
| Token length (derived fallback) | 32 hex chars (128 bits) | Sufficient | Yes |
| Line folding limit | 75 octets (first line), 74 (continuation) | RFC 5545: 75 octets first, 74 continuation (with leading space) | Yes |
| DTSTAMP format | `YYYYMMDDTHHmmSSZ` | RFC 5545 UTC format | Yes |
| Date range calc base | `new Date()` (server UTC) | Should be midnight London time for accuracy | **Debatable — minor drift at midnight** |

---

## 3. Customer/Staff-Facing Language Audit

| Location | Text | Accurate? | Finding |
|----------|------|-----------|---------|
| `RotaFeedButton.tsx:36` | "The feed updates automatically." | **No** | The feed has no `REFRESH-INTERVAL` or `X-PUBLISHED-TTL` property. Without these, calendar clients use their own default polling schedules — Google Calendar is documented to refresh subscribed calendars as infrequently as every 24 hours, and some clients only update on app restart. This is the most likely cause of the reported "not updating" bug. |
| `RotaFeedButton.tsx:44` | "Google Calendar — Other calendars → From URL" | Accurate | Correct path |
| `RotaFeedButton.tsx:45` | "Apple Calendar — File → New Calendar Subscription" | Accurate | Correct path |
| `RotaFeedButton.tsx:46` | "Outlook — Add calendar → Subscribe from web" | Accurate | Correct path |
| `X-WR-CALDESC` header (manager feed) | "Staff rota shifts" | Neutral | Acceptable |
| `X-WR-CALDESC` header (portal feed) | "Your published shifts at The Anchor" | Accurate | Correct |

---

## 4. Policy Drift Findings

### FINDING 1 — ROOT CAUSE OF "NOT UPDATING" BUG (Critical)
**Missing `VTIMEZONE` component + missing `REFRESH-INTERVAL`**

Both feeds use `DTSTART;TZID=Europe/London:` and `DTEND;TZID=Europe/London:` on every VEVENT but emit **no `VTIMEZONE` component** in the VCALENDAR block. RFC 5545 §3.6.5 is explicit: when a `TZID` parameter refers to a timezone, the calendar object MUST include a `VTIMEZONE` component with a matching `TZID` property. Non-compliant feeds may be rejected or misinterpreted by strict clients (notably Google Calendar and newer Apple Calendar versions). Events may display at wrong times or not at all.

Additionally, there is no `REFRESH-INTERVAL:PT1H` (RFC 7986) or `X-PUBLISHED-TTL:PT1H` (Apple/Google extension) property. Without this:
- **Google Calendar** refreshes subscribed feeds on its own schedule — documented as up to 24 hours, often longer in practice.
- **Apple Calendar** defaults to auto-refresh intervals of its own choosing (commonly 1 week unless the user manually refreshes).
- **Outlook** behaves similarly.

The UI copy saying "The feed updates automatically" is technically true but misleading — the client controls *when* it refreshes, and without a hint, that can be days. This is the most probable explanation for the user-reported issue.

**Files:** `src/app/api/rota/feed/route.ts` lines 95-103 (VCALENDAR header block), `src/app/api/portal/calendar-feed/route.ts` lines 67-75 (same block).

---

### FINDING 2 — No `SEQUENCE` or `LAST-MODIFIED` on VEVENTs (High)

Both feeds omit `SEQUENCE` and `LAST-MODIFIED` on each VEVENT. These are how calendar clients detect that an event has been updated since they last fetched the feed. Without them:
- A calendar client that has already imported a shift will not know the shift has changed (e.g., time updated, status changed to sick).
- The client may keep the stale event even after re-fetching the feed.

`LAST-MODIFIED` should be the `updated_at` timestamp of the shift row. `SEQUENCE` should increment on each update (or can default to `0` if no update tracking is desired, which at least marks events as initialised).

**Files:** `src/app/api/rota/feed/route.ts` lines 128-137, `src/app/api/portal/calendar-feed/route.ts` lines 92-101.

---

### FINDING 3 — Sick Shift `STATUS:CANCELLED` Semantics are Ambiguous (Medium)

Sick shifts pass through the `.neq('status', 'cancelled')` filter (correct — they are not `status='cancelled'`), so they appear in the feed. Their VEVENT is then emitted with `STATUS:CANCELLED`.

RFC 5545 defines `STATUS:CANCELLED` to mean "the event is cancelled and attendees should remove it from their calendar." Most calendar clients will **strike through or remove** a VEVENT with `STATUS:CANCELLED`. This means:
- The sick shift appears in the feed, but renders as a struck-through/greyed-out entry in the calendar.
- On the next fetch, if the shift is no longer sick (recovered), the event should update back to `STATUS:CONFIRMED`. Without `SEQUENCE`, the client will not know to update.

The description also says `Status: Sick` in the text body, which is redundant with the struck-through rendering but harmless.

**Whether this is the right approach is a product decision** — showing sick shifts as cancelled-in-calendar is a reasonable signal that the employee called in sick. But without `SEQUENCE`, recovery from sick status will not propagate to subscribed calendars.

---

### FINDING 4 — Line Folding Bug at UTF-8 Boundary (Low)

The `foldLine()` function in both routes slices `Buffer` bytes at position 75/74 and re-joins as UTF-8. Slicing a UTF-8 multi-byte sequence at an arbitrary byte offset can corrupt the character at the boundary (a 3-byte character split across two lines will decode as garbage). This affects any shift summary or description containing non-ASCII characters (em-dashes `—` are used in the summary template and are 3 bytes in UTF-8).

The em-dash `—` is already used in the `summary` field: `'— ${shift.name}'`. Its 3 bytes can be split at the fold point.

**Files:** `foldLine()` in both route files.

---

### FINDING 5 — DTSTAMP is Per-Request, Not Per-Event (Low)

Both feeds compute one `dtstamp` constant at the top of the GET handler and reuse it for every VEVENT. `DTSTAMP` is supposed to represent when the event instance was created/last modified. Using a single per-request value is harmless for clients that only use `DTSTAMP` for ordering, but it means no VEVENT signals that it predates any other — all are equally "new." Combined with the missing `LAST-MODIFIED`, this reduces calendar clients' ability to do intelligent merging.

---

### FINDING 6 — Token Is Stable (Potentially Good, But Undocumented Risk)

The derived token is `SHA-256(SUPABASE_SERVICE_ROLE_KEY)[0:32]`. This means:
- If the service role key is rotated, all existing calendar subscriptions break silently (the URL becomes invalid and clients get `401`).
- The `ROTA_FEED_SECRET` env var was added to address this, but if it has not been set, the risk persists.
- There is no mechanism to notify subscribers that the URL has changed.

The code comments document the migration path, but this is an operational risk worth flagging.

**Files:** `route.ts:getFeedToken()`, `page.tsx:feedToken` derivation.

---

### FINDING 7 — Portal Feed Has Identical RFC Issues (Same as Manager Feed)

`src/app/api/portal/calendar-feed/route.ts` is a near-copy of the manager feed and has all the same missing components: no `VTIMEZONE`, no `REFRESH-INTERVAL`, no `SEQUENCE`, no `LAST-MODIFIED`, same `foldLine` UTF-8 boundary bug.

---

## 5. Summary — Priority Order

| Priority | Finding | Impact |
|----------|---------|--------|
| 1 (Critical) | Missing `VTIMEZONE` — RFC violation; events may show at wrong times | Correctness + compliance |
| 2 (Critical) | Missing `REFRESH-INTERVAL`/`X-PUBLISHED-TTL` — root cause of "not updating" report | User-reported bug |
| 3 (High) | Missing `SEQUENCE` + `LAST-MODIFIED` — updated/cancelled shifts don't propagate | Stale data in client |
| 4 (Medium) | UI copy "updates automatically" is misleading without refresh hint | User expectation mismatch |
| 5 (Medium) | Sick shift `STATUS:CANCELLED` won't recover without `SEQUENCE` | Incorrect calendar state |
| 6 (Low) | `foldLine` UTF-8 byte-boundary slicing corrupts multi-byte chars (em-dash in summary) | Garbled text on long summaries |
| 7 (Low) | Single `DTSTAMP` per request reduces client merge intelligence | Minor |
| 8 (Ops) | Derived token breaks on service-role key rotation | Operational risk |
