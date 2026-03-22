# Validation Report — Rota Calendar Feed v2 Phase 2 Fixes

**Date:** 2026-03-15
**Validator:** Validation Specialist Agent
**Verdict: GO**

---

## DEFECT-V2-001 (CRITICAL) — Cancelled shifts emitted as STATUS:CANCELLED

**Status: FIXED**

Evidence:
- `src/app/api/rota/feed/route.ts`: No `.neq('status', 'cancelled')` filter present. Query fetches all statuses.
- `src/app/api/portal/calendar-feed/route.ts`: Same — no `.neq` filter. Comment explicitly states: *"Include cancelled shifts so Google Calendar receives explicit STATUS:CANCELLED VEVENTs and removes them, rather than silently leaving stale events when UIDs disappear."*
- Both routes compute `isCancelled = shift.status === 'cancelled' || shift.status === 'sick'` and emit `STATUS:CANCELLED` when true, `STATUS:CONFIRMED` otherwise.
- `DESCRIPTION` field includes `'Status: Cancelled'` for cancelled shifts and `'Status: Sick'` for sick shifts.

---

## DEFECT-V2-002 (CRITICAL) — SEQUENCE derived from published_at, not hardcoded 0

**Status: FIXED**

Evidence:
- `src/lib/ics/utils.ts`: `deriveSequence(publishedAt: string | null, isCancelled = false): number` exported. Uses epoch `2025-01-01T00:00:00Z = 1735689600000ms`. Returns `Math.max(0, Math.floor(ms/1000))`. Cancelled events return `seq + 1` (strictly greater than last CONFIRMED SEQUENCE). Null `publishedAt` returns 0 (or 1 for cancelled).
- `src/app/api/rota/feed/route.ts`: Imports `deriveSequence` from `@/lib/ics/utils`. Emits `SEQUENCE:${deriveSequence(shift.published_at as string | null, isCancelled)}`.
- `src/app/api/portal/calendar-feed/route.ts`: Same import and usage.
- No `SEQUENCE:0` hardcoding remains in either route.

---

## DEFECT-V2-003 (HIGH) — Per-VEVENT DTSTAMP from published_at

**Status: FIXED**

Evidence:
- Both routes: shared `dtstamp` variable removed. Per-VEVENT `eventDtstamp` is computed as `shift.published_at ? icsTimestamp(shift.published_at) : icsTimestamp(new Date())`.
- Comment in both files: *"Use published_at so it only changes when the shift is actually re-published."*
- Two consecutive polls with no data changes will produce identical DTSTAMP values (published_at doesn't change between requests).
- Fallback to `new Date()` only fires when `published_at` is null — a database-level edge case, not the normal path.

---

## DEFECT-V2-004 (HIGH) — ETag, Last-Modified, and 304 support

**Status: FIXED**

Evidence (both routes identical in structure):
- `createHash` imported from `'crypto'` in both route files.
- ETag: `"${createHash('sha256').update(ics).digest('hex').substring(0, 32)}"` — content-based hash in double quotes (RFC 7232 compliant).
- Last-Modified: most recent `published_at` across all returned shifts (falls back to `new Date()` if no shifts have `published_at`).
- Conditional GET: checks `if-none-match` header === etag, OR `if-modified-since` >= `mostRecentPublish`. Returns `304` with `ETag` + `Last-Modified` headers when matched.
- All 200 responses include `ETag`, `Last-Modified`, `Cache-Control: no-cache, no-store, must-revalidate`, `Pragma: no-cache`, `Expires: 0`.

---

## DEFECT-V2-005 (MEDIUM) — Accurate ICS_CALENDAR_REFRESH_LINES JSDoc

**Status: FIXED**

Evidence:
- `src/lib/ics/utils.ts` JSDoc: *"NOTE: Google Calendar ignores REFRESH-INTERVAL and X-PUBLISHED-TTL entirely — it polls ICS subscriptions on its own 12–24 hour schedule regardless. These properties are kept for Apple/Outlook compatibility."*
- Route files comment: `// Refresh hints for Apple Calendar and Outlook; Google Calendar ignores these`
- No route file contains any claim of hourly Google refresh.

---

## DEFECT-V2-006 (MEDIUM) — RotaFeedButton accurate update timing text

**Status: FIXED**

Evidence:
- `src/app/(authenticated)/rota/RotaFeedButton.tsx` line 37: *"Subscribe to see all rota shifts in your calendar app. Rota changes appear within 24 hours of publishing (Google Calendar), or sooner in Apple Calendar and Outlook."*
- The phrase "The feed updates automatically." does not appear anywhere in the file.

---

## DEFECT-V2-008 (LOW) — timingSafeEqual for token comparison

**Status: FIXED**

Evidence:
- `src/lib/portal/calendar-token.ts`: Imports `{ createHmac, timingSafeEqual }` from `'crypto'`. `verifyCalendarToken` performs length check first (safe — reveals only length mismatch, not byte position), then `timingSafeEqual(Buffer.from(expected), Buffer.from(token))`.
- `src/app/api/rota/feed/route.ts`: Also uses `timingSafeEqual` in its local `isValidToken()` helper (imported from `crypto`).

---

## Regression Checks

| Check | Result |
|---|---|
| Non-cancelled shifts (scheduled, sick) still in feed | PASS — loop iterates all statuses; `isCancelled` false for `scheduled` → `STATUS:CONFIRMED` |
| Sick shifts treated as cancelled in ICS | PASS — `isCancelled = status === 'cancelled' \|\| status === 'sick'` |
| VTIMEZONE block present | PASS — `...VTIMEZONE_EUROPE_LONDON` spread into `lines[]` in both routes |
| ICS_CALENDAR_REFRESH_LINES still included | PASS — spread into `lines[]` in both routes with accurate comment |
| `foldLine` unchanged and exported | PASS — present in utils.ts, exported, no changes to folding logic |
| `escapeICS` unchanged and exported | PASS |
| `icsDate` unchanged and exported | PASS |
| `addOneDay` unchanged and exported | PASS |
| `deriveSequence` exported from utils.ts | PASS — explicitly exported |
| `deriveSequence` imported in both routes | PASS — in both import blocks |
| `createHash` imported in portal/calendar-feed/route.ts | PASS — line 1: `import { createHash } from 'crypto'` |
| TypeScript: no missing imports or wrong signatures | PASS — all symbols imported match exports; `deriveSequence(string \| null, boolean?)` matches call sites |

---

## Summary

All 7 defects (V2-001 through V2-006, V2-008) are correctly fixed. No regressions detected. All utility exports are intact. Both routes are symmetric in their implementations. Type signatures match across import/export boundaries.

**Recommendation: GO — safe to ship.**
