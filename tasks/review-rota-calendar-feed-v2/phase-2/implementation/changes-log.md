# Rota Calendar Feed v2 — Phase 2 Implementation Changes Log

Date: 2026-03-15

## Files Modified

### `src/lib/ics/utils.ts`
- **DEFECT-V2-002**: Added `deriveSequence(publishedAt, isCancelled)` function. Uses `published_at` relative to epoch 2025-01-01T00:00:00Z to produce a monotonically-increasing SEQUENCE without a DB column. Cancelled events get `seq + 1` to exceed the last CONFIRMED sequence.
- **DEFECT-V2-005**: Updated JSDoc on `ICS_CALENDAR_REFRESH_LINES` to accurately state that Google Calendar ignores these properties; they are kept for Apple Calendar and Outlook compatibility only.

### `src/app/api/rota/feed/route.ts`
- **DEFECT-V2-001**: Removed `.neq('status', 'cancelled')` filter so cancelled shifts are included and emitted as `STATUS:CANCELLED` VEVENTs.
- **DEFECT-V2-002**: Replaced `SEQUENCE:0` with `SEQUENCE:${deriveSequence(...)}`. Added `deriveSequence` import.
- **DEFECT-V2-003**: Removed shared `dtstamp` variable. Each VEVENT now uses `eventDtstamp = icsTimestamp(shift.published_at)` so DTSTAMP is stable across requests and only changes when a shift is re-published. Falls back to `icsTimestamp(new Date())` when `published_at` is null.
- **DEFECT-V2-004**: Added ETag (SHA-256 of ICS body, 32 chars), Last-Modified (most recent `published_at`), conditional GET handling (304 on ETag match or If-Modified-Since match), and `Pragma`/`Expires` headers.
- **DEFECT-V2-005**: Updated inline comment about refresh hints.
- Cancelled shift description now includes "Status: Cancelled" in DESCRIPTION field.

### `src/app/api/portal/calendar-feed/route.ts`
- **DEFECT-V2-001**: Removed `.neq('status', 'cancelled')` filter. Updated comment explaining why cancelled shifts are included.
- **DEFECT-V2-002**: Replaced `SEQUENCE:0` with `SEQUENCE:${deriveSequence(...)}`. Added `deriveSequence` import.
- **DEFECT-V2-003**: Removed shared `dtstamp` variable. Per-event `eventDtstamp` from `published_at`.
- **DEFECT-V2-004**: Added `createHash` import, ETag, Last-Modified, conditional GET (304), and `Pragma`/`Expires` headers.
- **DEFECT-V2-005**: Updated inline comment about refresh hints.
- Cancelled shift description now includes "Status: Cancelled" in DESCRIPTION field.

### `src/app/(authenticated)/rota/RotaFeedButton.tsx`
- **DEFECT-V2-006**: Replaced "The feed updates automatically." with "Rota changes appear within 24 hours of publishing (Google Calendar), or sooner in Apple Calendar and Outlook." — sets accurate expectations per-client.

### `src/lib/portal/calendar-token.ts`
- **DEFECT-V2-008**: Replaced `===` string comparison with `timingSafeEqual` (constant-time). Added `timingSafeEqual` import from `crypto`. Short-circuits on length mismatch (safe: no timing leak since we're not revealing which byte differs, only that lengths differ).

## No DB Migrations

No schema changes made. `rota_published_shifts` has no `updated_at` or `sequence` column; `deriveSequence` uses only the existing `published_at` column.

## Type Safety Notes

All new code uses explicit `string | null` casts consistent with the existing pattern in both route files. `deriveSequence` accepts `string | null` and handles null gracefully.
