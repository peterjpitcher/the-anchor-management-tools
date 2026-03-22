# Validation Report — Rota Calendar Feed
Date: 2026-03-15
Validator: Validation Specialist Agent
Verdict: **GO** (with one advisory noted)

---

## Files Read (all three modified files read directly)

- `src/lib/ics/utils.ts` (124 lines)
- `src/app/api/rota/feed/route.ts` (149 lines)
- `src/app/api/portal/calendar-feed/route.ts` (128 lines)
- `src/lib/portal/calendar-token.ts` (supporting, not changed)

---

## Defect-by-Defect Verdict

### DEFECT-001 — REFRESH-INTERVAL / X-PUBLISHED-TTL — FIXED ✓

`utils.ts` exports `ICS_CALENDAR_REFRESH_LINES` (lines 120–123):
```
'REFRESH-INTERVAL;VALUE=DURATION:PT1H'
'X-PUBLISHED-TTL:PT1H'
```
Both route files spread this into `lines[]` at construction time (rota/feed line 86, portal/calendar-feed line 72). Both lines appear before any VEVENT (the for-loop starts after the initial array literal). **TC015 PASS.**

---

### DEFECT-002 — LAST-MODIFIED / SEQUENCE — FIXED ✓

Both routes (rota/feed lines 120–133, portal/calendar-feed lines 99–112):
- `LAST-MODIFIED` computed as `icsTimestamp(shift.published_at)` with fallback to `dtstamp`
- `SEQUENCE:0` pushed unconditionally after LAST-MODIFIED

**icsTimestamp trace** for `'2026-03-15T10:30:00+00:00'`:
- `new Date('2026-03-15T10:30:00+00:00').toISOString()` → `'2026-03-15T10:30:00.000Z'`
- `.replace(/[-:.]/g, '')` → `'20260315T103000000Z'`
- `.substring(0, 15)` → `'20260315T103000'`
- `+ 'Z'` → `'20260315T103000Z'` ✓ (15 chars then Z = correct ICS UTC timestamp)

**TC016 PASS.**

---

### DEFECT-003 — VTIMEZONE block — FIXED ✓

`utils.ts` exports `VTIMEZONE_EUROPE_LONDON` (lines 95–113): a 13-element string array spanning `BEGIN:VTIMEZONE` through `END:VTIMEZONE`, with both `BEGIN:STANDARD` (GMT, RRULE last Sunday October) and `BEGIN:DAYLIGHT` (BST, RRULE last Sunday March) sub-components.

Both routes spread it via `...VTIMEZONE_EUROPE_LONDON` inside the initial `lines` array literal. The VEVENTs are pushed via a subsequent `for` loop. Array construction order is therefore:
1. VCALENDAR header properties
2. ICS_CALENDAR_REFRESH_LINES
3. VTIMEZONE_EUROPE_LONDON ← here, before any for-loop iterations
4. (for-loop) VEVENTs

VTIMEZONE is guaranteed to appear before any VEVENT in the output. **TC011 PASS.**

---

### DEFECT-004 — Portal feed silent DB error — FIXED ✓

`portal/calendar-feed/route.ts` line 46:
```typescript
const { data: shifts, error: shiftsError } = await supabase...
```
Lines 56–58:
```typescript
if (shiftsError) {
  return new Response('Error loading shifts', { status: 500 })
}
```
If Supabase returns an error object, the route returns HTTP 500 before building any ICS. **TC042 PASS.**

---

### DEFECT-005 — foldLine UTF-8 boundary corruption — FIXED ✓

**Algorithm trace** for `SUMMARY:John Smith — Evening Shift (Front)` where `—` is U+2014 (3 bytes: E2 80 94):

- `TextEncoder` used throughout; `for...of` iterates Unicode code points (not UTF-16 code units), so multi-byte chars are never split mid-iteration.
- `isFirst` starts `true` (limit = 75), flips to `false` after first flush (limit = 74 for continuation lines with the leading space).
- Example: if the running `currentBytes + 3 > 75` when the `—` character is reached, the current buffer is flushed and `—` starts the new segment as a complete 3-byte character.
- `parts.join('\r\n ')` — continuation lines are prefixed with a single space (1 octet), so the effective data capacity of continuation lines is 74 octets. The code uses `limit = 74` for `isFirst === false`, which correctly accounts for this.

**TC013 PASS. TC033 PASS.**

---

### DEFECT-006 — Non-timing-safe token comparison — FIXED ✓

`rota/feed/route.ts` lines 35–42:
```typescript
function isValidToken(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}
```

- Length check first (returns `false` without calling `timingSafeEqual` which would throw on unequal-length buffers).
- `timingSafeEqual` does constant-time comparison on equal-length buffers.
- `try/catch` wraps the call for safety against unexpected edge cases.

TC003 trace: same length, different content → `timingSafeEqual` returns `false` → `isValidToken` returns `false` → 401.
TC004 (empty string): `''.length !== expected.length` (expected is 32 chars) → returns `false` immediately → 401.

**TC001–TC004 PASS. DEF-007 PASS.**

---

### DEFECT-007 — Duplicated ICS utilities — FIXED ✓

Both route files import all five utilities (`icsDate`, `icsTimestamp`, `addOneDay`, `escapeICS`, `foldLine`) plus the two constants (`VTIMEZONE_EUROPE_LONDON`, `ICS_CALENDAR_REFRESH_LINES`) exclusively from `@/lib/ics/utils`. No local copies remain in either route file. **PASS.**

---

## Additional Test Cases

### TC010 — VCALENDAR wrapping
`lines[0]` = `'BEGIN:VCALENDAR'`. `lines.push('END:VCALENDAR')` is the last push before `lines.map(foldLine).join('\r\n')`. **PASS.**

### TC012 — CRLF
`lines.map(foldLine).join('\r\n')` — join uses CRLF. `foldLine` also uses `\r\n` internally for fold continuations (`parts.join('\r\n ')`). **PASS.**

### TC014 — Required VEVENT properties
Each VEVENT block pushes: UID, DTSTAMP, DTSTART, DTEND, SUMMARY. All five present in both routes. **PASS.**

### TC020 — Cancelled shift exclusion
Both queries include `.neq('status', 'cancelled')`. **PASS.**

### TC021 — Table name
Both queries target `rota_published_shifts`. **PASS.**

### TC022 — Date range
`from = today - 28 days`, `to = today + 84 days`. Both routes compute identically. **PASS.**

### TC023 — Overnight shifts
`addOneDay` is used when `shift.is_overnight` is truthy; the end time is applied to the next date. **PASS.**

### TC024 — Sick shifts
`STATUS:${shift.status === 'sick' ? 'CANCELLED' : 'CONFIRMED'}` — correct RFC 5545 STATUS for sick. **PASS.**

### TC025 — Open shifts
`shift.is_open_shift ? 'Open Shift' : ...` — correctly handled in manager feed. Portal feed queries by `employee_id` so open shifts (no employee_id) would naturally not appear there. **PASS.**

### TC030 — Null department
`shift.department ? ... : ''` — `deptLabel` becomes empty string; no crash; filtered out of summary by `.filter(Boolean)`. **PASS.**

### TC031 — Null employee join
`emp ? [emp.first_name, emp.last_name].filter(Boolean).join(' ') || 'Unknown' : 'Unknown'` — both null-join and empty-name cases produce `'Unknown'`. **PASS.**

### TC034 — Empty shifts array
`shifts ?? []` means an empty array iterates zero times. Output is a valid VCALENDAR with header properties, VTIMEZONE, and END:VCALENDAR — no VEVENTs. **PASS.**

### TC040 — Portal employee filter
`.eq('employee_id', employeeId)` present at portal/calendar-feed line 49. **PASS.**

### TC043 — Portal UID prefix
`UID:staff-shift-${shift.id}@anchor-management` (portal/calendar-feed line 104) vs `UID:shift-${shift.id}@anchor-management` (manager feed line 125). Different prefixes — correct per spec. **PASS.**

---

## Regression Checks

### rota/page.tsx feedUrl compatibility
The manager feed token is `getFeedToken()` = `ROTA_FEED_SECRET` or `SHA256(service_role_key).substring(0,32)`. The `rota/page.tsx` generates the URL using whatever value it stores; the route accepts the same value via the same derivation. No change to the token logic — backward-compatible. **PASS.**

### portal/calendar-feed — verifyCalendarToken import
Line 3: `import { verifyCalendarToken } from '@/lib/portal/calendar-token'`. The supporting file is unchanged. `verifyCalendarToken` uses `===` for string comparison (not timing-safe), but this was not in scope for this defect batch (DEFECT-006 covers only the manager feed token). **PASS (in-scope). Advisory below.**

---

## Advisory (Non-Blocking)

**ADVISORY-001: `verifyCalendarToken` in `calendar-token.ts` uses `===` (not timing-safe)**
The portal route delegates to `verifyCalendarToken` which does a direct `===` string comparison (line 11 of `calendar-token.ts`). This is a timing-safe-equal gap equivalent to the original DEFECT-006 but in the portal path. It was not in the defect list and is therefore out of scope, but should be tracked as a follow-on fix.

---

## Summary

| Defect | Status |
|---|---|
| DEFECT-001 REFRESH-INTERVAL | FIXED ✓ |
| DEFECT-002 LAST-MODIFIED/SEQUENCE | FIXED ✓ |
| DEFECT-003 VTIMEZONE | FIXED ✓ |
| DEFECT-004 Portal DB error 500 | FIXED ✓ |
| DEFECT-005 foldLine UTF-8 | FIXED ✓ |
| DEFECT-006 timingSafeEqual | FIXED ✓ |
| DEFECT-007 Deduplicated utils | FIXED ✓ |

**All 7 defects confirmed fixed. No regressions found. One advisory raised (out-of-scope).**

## VERDICT: GO
