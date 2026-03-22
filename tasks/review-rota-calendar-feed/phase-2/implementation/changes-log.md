# Rota Calendar Feed — Phase 2 Implementation Changes Log

Date: 2026-03-15

## Files Created

### `src/lib/ics/utils.ts` (new)
- Fixes DEFECT-005: `foldLine` rewritten character-by-character with `TextEncoder` byte counting; no longer cuts multi-byte UTF-8 chars at byte boundaries
- Fixes DEFECT-007: single source of truth for `icsDate`, `addOneDay`, `escapeICS`, `foldLine`
- New export `icsTimestamp(input: Date | string): string` — formats to YYYYMMDDTHHMMSSZ
- New constant `VTIMEZONE_EUROPE_LONDON: string[]` — RFC 5545 §3.6.5 VTIMEZONE block for Europe/London
- New constant `ICS_CALENDAR_REFRESH_LINES: string[]` — REFRESH-INTERVAL + X-PUBLISHED-TTL at PT1H

## Files Modified

### `src/app/api/rota/feed/route.ts`
- DEFECT-001 (TC015): Added `...ICS_CALENDAR_REFRESH_LINES` to VCALENDAR header
- DEFECT-002 (TC016): Added `LAST-MODIFIED` (from `shift.published_at` via `icsTimestamp`) and `SEQUENCE:0` to each VEVENT
- DEFECT-003 (TC011): Added `...VTIMEZONE_EUROPE_LONDON` to VCALENDAR header after calendar properties
- DEFECT-005 (TC013): Removed local `foldLine`; now imported from `@/lib/ics/utils`
- DEFECT-006 (DEF-007): Replaced `token !== getFeedToken()` with `isValidToken()` using `crypto.timingSafeEqual`; short-circuits on length mismatch before calling timingSafeEqual
- DEFECT-007: Removed local `icsDate`, `addOneDay`, `escapeICS`, `foldLine`; all imported from `@/lib/ics/utils`
- All local helper functions removed; now imported from shared utils
- `GET` return type annotated as `Promise<Response>`

### `src/app/api/portal/calendar-feed/route.ts`
- DEFECT-001 (TC015): Added `...ICS_CALENDAR_REFRESH_LINES` to VCALENDAR header
- DEFECT-002 (TC016): Added `LAST-MODIFIED` (from `shift.published_at` via `icsTimestamp`) and `SEQUENCE:0` to each VEVENT
- DEFECT-003 (TC011): Added `...VTIMEZONE_EUROPE_LONDON` to VCALENDAR header
- DEFECT-004 (TC042): `const { data: shifts }` changed to `const { data: shifts, error: shiftsError }`; returns HTTP 500 if `shiftsError` is set
- DEFECT-005 (TC033): Removed local `foldLine`; now imported from `@/lib/ics/utils`
- DEFECT-007: Removed all local helper functions; imported from `@/lib/ics/utils`
- `GET` return type annotated as `Promise<Response>`

## Test Case Traceability

| Defect | Test Case | Change | Confirmed Pass |
|--------|-----------|--------|----------------|
| DEFECT-001 | TC015 | REFRESH-INTERVAL + X-PUBLISHED-TTL added to both feeds | Yes — lines present in VCALENDAR header |
| DEFECT-002 | TC016 | LAST-MODIFIED from published_at + SEQUENCE:0 on every VEVENT | Yes — both lines emitted per event |
| DEFECT-003 | TC011 | VTIMEZONE:Europe/London block emitted before VEVENTs | Yes — constant spliced into header lines |
| DEFECT-004 | TC042 | shiftsError check returns 500 instead of empty ICS | Yes — early return on DB error |
| DEFECT-005 | TC013, TC033 | foldLine iterates chars not bytes; TextEncoder tracks octet count | Yes — multi-byte chars no longer split |
| DEFECT-006 | DEF-007 | timingSafeEqual comparison in isValidToken() | Yes — length-first short circuit + constant-time compare |
| DEFECT-007 | — | Shared utils extracted to src/lib/ics/utils.ts | Yes — both routes import from single source |
