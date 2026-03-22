# Calendar Sync Cross-Week Orphan Recovery Fix

**Date:** 2026-03-22
**Status:** Draft
**Complexity:** M (3 files, no schema changes, significant logic rewrite in orphan recovery)
**QA Review:** `tasks/codex-qa-review/codex-qa-report.md` — 5-specialist dual-engine review (Claude + Codex)

## Problem Statement

The Google Calendar sync for rota shifts exhibits a bug where events appear and disappear unpredictably, with Mondays disproportionately affected. The root cause is a cross-week contamination issue in the orphan recovery logic.

### Root Cause

The orphan recovery step in `syncRotaWeekToCalendar()` lists all Google Calendar events in the week's date range and deletes any event whose `shiftId` is not in the current week's shift list. However, the date range calculation extends a full day beyond the week's last shift date:

```ts
const timeMaxDate = new Date(weekEnd + 'T23:59:59Z')
timeMaxDate.setUTCDate(timeMaxDate.getUTCDate() + 1)
```

If a week ends on Sunday, `timeMax` extends to Monday ~23:59 UTC — covering the entire next Monday. Events from the adjacent week that fall on Monday are found in the listing, their `shiftId` values are not in the current week's shift set, so they are deleted as "orphans."

When the adjacent week syncs, it recreates those events. If both weeks sync concurrently (the resync route processes 3 weeks in parallel), a create/delete cycle ensues. This explains:

- **"Some jump out and some add in"** — concurrent syncs create and delete in cycles
- **"Mondays are worse"** — Monday is the exact overlap day between adjacent weeks
- **"Not always the same pattern"** — race conditions between concurrent week syncs

### Secondary Issue

The publish flow passes `currentShifts` (from `rota_shifts`, the draft table) to the `after()` sync callback, while the manual resync reads from `rota_published_shifts` (the snapshot table). These should use the same source of truth.

## Success Criteria

1. Publishing a rota week syncs all shifts for that week to Google Calendar without affecting adjacent weeks' events
2. Manual resync ("Sync calendar" button) produces a complete, accurate calendar state across all published weeks
3. No events from adjacent weeks are deleted during any sync operation
4. Overnight shifts spanning week boundaries are handled correctly
5. Existing events (without `weekId` extended property) are handled gracefully during the transition period

## Design

### Change 1: Add `weekId` to Google Calendar Extended Properties

**File:** `src/lib/google-calendar-rota.ts`

Add `weekId` alongside the existing `shiftId` in the event's extended properties:

```ts
extendedProperties: {
  private: { shiftId: shift.id, weekId: weekId },
}
```

This makes each event self-describing — orphan recovery can determine which week an event belongs to without relying solely on the DB mapping table. The `weekId` property is included in `eventBody` which is used for both `calendar.events.insert` and `calendar.events.update`, so existing events will get `weekId` backfilled automatically on their next update cycle — no separate migration required.

### Change 2: Filter Orphan Recovery by `weekId`

**File:** `src/lib/google-calendar-rota.ts`

Replace the current orphan recovery logic (lines 168-248) with week-scoped filtering:

**Current behaviour (broken):**
- List events in date range
- Delete any event whose `shiftId` is not in current week's shift list

**New behaviour:**
- List events in date range
- For each event with extended properties:
  - **Has `weekId` matching current week:**
    - `shiftId` in current shifts but not in DB → recover (add to existingMap + upsert DB)
    - `shiftId` NOT in current shifts → delete (genuine orphan from this week)
  - **Has `weekId` NOT matching current week:** skip entirely (belongs to another week)
  - **Has `shiftId` but no `weekId` (legacy):**
    - If `currentShiftIds.has(shiftId)` → recover immediately (shift IDs are globally unique UUIDs, so membership in the current week's shift set is definitive proof of ownership). Add to existingMap + upsert DB with `weekId`. This prevents the create path from inserting a duplicate.
    - If `shiftId` is NOT in `currentShiftIds` → look up in `rota_google_calendar_events` DB table:
      - If found and `week_id` matches current week → delete (genuine orphan from this week)
      - If found and `week_id` does NOT match → skip (belongs to another week)
      - If not found in DB → skip (can't determine ownership, safer to keep)
  - **Has neither `shiftId` nor `weekId`:** keep the existing legacy-orphan logic (delete if has `/rota` URL in description and not in known event IDs), but only for events whose start time falls within the current week's canonical date range. This prevents cross-week contamination for legacy events while still cleaning up genuinely orphaned events from the current week

### Change 3: Make Event Creation Idempotent

**File:** `src/lib/google-calendar-rota.ts`

The `weekId` filter prevents cross-week contamination, but two syncs of the **same week** (e.g., publish `after()` overlapping with manual resync) can both see no mapping row and both insert separate events for the same shift. Fix by making the insert path idempotent:

Before inserting a new event, check the orphan recovery results (the `existingMap` built from both DB mappings and recovered events). If the `shiftId` is already in `existingMap` after the recovery phase, update instead of insert. This is already the current behaviour — the key is that the recovery phase (Change 2) must populate `existingMap` correctly for legacy events (see the `currentShiftIds.has(shiftId)` recovery path above).

Additionally, add pagination to the orphan recovery `events.list` call — follow `nextPageToken` until all events are retrieved. The current `maxResults: 500` cap means busy calendars can have incomplete recovery, leading to duplicate inserts. If pagination is not feasible (API rate concerns), log a warning when results are truncated so the issue is visible.

### Change 3a: Keep Existing `timeMax` Range

**File:** `src/lib/google-calendar-rota.ts`

The existing `timeMax` calculation (weekEnd + 1 full day) is deliberately kept unchanged. The `weekId` filter (Change 2) prevents cross-week contamination regardless of date range width. Note: Google Calendar `events.list` applies `timeMax` to event **start** time (not end time), so the wide range is a tolerance choice rather than a requirement for overnight shift coverage. It is kept for simplicity since the `weekId` guard makes it safe.

### Change 3b: Use Canonical Week Boundaries for Orphan Recovery Scan

**File:** `src/lib/google-calendar-rota.ts`

Currently, `weekStart`/`weekEnd` are computed from min/max `shift_date` in the shifts array. If a week has no shifts on an early or late day, orphan events on those days are invisible to recovery. Fix by accepting `weekStart` from the caller (sourced from `rota_weeks.week_start`) and computing a canonical Mon-Sun range:

```ts
// New: accept weekStart as a parameter
export async function syncRotaWeekToCalendar(
  weekId: string,
  shifts: RotaShiftRow[],
  options?: SyncOptions & { weekStart?: string }
): Promise<SyncResult> {
  // Use canonical boundaries if provided, fall back to shift-span
  const scanStart = options?.weekStart ?? shifts.reduce(...)
  const scanEnd = options?.weekStart ? addDays(options.weekStart, 6) : shifts.reduce(...)
  // ... use scanStart/scanEnd for events.list timeMin/timeMax
}
```

Callers (`publishRotaWeek`, `resyncRotaCalendar`, resync API route) already have access to `rota_weeks.week_start` and should pass it through.

### Change 4: Read from `rota_published_shifts` on Publish

**File:** `src/app/actions/rota.ts`

Change the `after()` callback in `publishRotaWeek()` to read from `rota_published_shifts` instead of closing over the draft `currentShifts`:

```ts
after(async () => {
  try {
    const admin = createAdminClient();
    const { data: publishedShifts, error: readError } = await admin
      .from('rota_published_shifts')
      .select('id, week_id, employee_id, shift_date, start_time, end_time, department, status, notes, is_overnight, is_open_shift, name')
      .eq('week_id', weekId);

    // CRITICAL: Never sync an empty array on read failure — this would delete
    // all mapped events for the week. Abort on error or null data.
    if (readError || !publishedShifts) {
      console.error('[RotaCalendar] Failed to read published shifts for sync — aborting', weekId, readError?.message);
      return;
    }

    // Guard against snapshot-in-progress: if the week is published but has
    // zero shifts, a delete/insert snapshot replacement may be in progress.
    // Skip sync rather than wiping the calendar.
    if (publishedShifts.length === 0) {
      console.info('[RotaCalendar] No published shifts found for week — skipping sync (snapshot may be in progress)', weekId);
      return;
    }

    const { syncRotaWeekToCalendar } = await import('@/lib/google-calendar-rota');
    const syncResult = await syncRotaWeekToCalendar(weekId, publishedShifts);
    if (syncResult.failed > 0) {
      console.warn('[RotaCalendar] Sync completed with failures after publish for week', weekId, syncResult);
    }
  } catch (err) {
    console.error('[RotaCalendar] Sync failed after publish for week', weekId, err);
  }
});
```

This ensures both the publish sync and manual resync use the same source of truth (`rota_published_shifts`).

**Safety guards (from QA review):**
- **CRIT-001:** Abort on read error — never pass `[]` to sync when the read failed, as this would delete all mapped events for the week.
- **HIGH-002:** Skip sync when zero shifts found — protects against the delete/insert gap during republish where a concurrent resync could see an empty snapshot mid-replacement.

### Change 5: Empty-Week Guard in syncRotaWeekToCalendar

**File:** `src/lib/google-calendar-rota.ts`

Add a guard at the top of `syncRotaWeekToCalendar()`: if `shifts` is empty AND there are existing mapped events for this week, log a warning and return early without deleting anything. This protects against the delete/insert gap during republish (where `rota_published_shifts` is momentarily empty between delete and insert) causing a concurrent resync to wipe the calendar:

```ts
if (shifts.length === 0 && existingMap.size > 0) {
  console.warn('[RotaCalendar] Skipping sync — week has mapped events but no shifts provided (snapshot may be in progress)', weekId);
  return result;
}
```

This is a belt-and-braces defence alongside the `after()` callback guard in Change 4.

### Note: Lock Check on Publish Sync — Not Required

The `weekId` filter (Change 2) makes cross-week concurrent syncs safe. Same-week concurrency is addressed by idempotent event creation (Change 3) and the empty-week guard (Change 5). A publish-side lock check is not needed.

## Files Modified

| File | Changes |
|------|---------|
| `src/lib/google-calendar-rota.ts` | Add `weekId` to extended properties; rewrite orphan recovery with week-scoped filtering; accept `weekStart` param for canonical boundaries; add empty-week guard; add pagination to event listing |
| `src/app/actions/rota.ts` | Read from `rota_published_shifts` in `after()` callback with error/empty guards; pass `weekStart` to sync |
| `src/app/api/rota/resync-calendar/route.ts` | Pass `weekStart` to sync via options |

## What Is NOT Included

- No database schema changes (existing table already has `week_id`)
- No migration to backfill `weekId` on existing Google Calendar events (happens naturally on next sync)
- No changes to the ICS feed system (separate system, not affected)
- Resync API route change is minimal (pass `weekStart` through options). Core sync logic and concurrency model unchanged. The resync route processes 3 weeks concurrently — this is safe because the `weekId` filter ensures each week's sync only touches its own events

## Testing Plan

1. **Publish a single week** — verify all shifts appear in Google Calendar with `weekId` extended property
2. **Publish two adjacent weeks sequentially** — publish week A, then week B. Verify no Monday shifts disappear from week A after week B syncs. Verify week A's events still exist via calendar inspection
3. **Manual resync** — verify all published weeks sync correctly with no cross-contamination. Check logs for zero delete calls against events with non-matching weekIds
4. **Overnight shifts spanning week boundary** — create a Sunday 22:00→Monday 02:00 shift in week A. Publish week A and week B. Verify the overnight event persists after both syncs
5. **Legacy events (transition)** — before running resync, verify events without `weekId` are handled gracefully: looked up in DB for ownership, not deleted if ownership can't be determined
6. **Post-resync backfill** — after one full resync, verify all events now have `weekId` in their extended properties (confirming natural backfill via update path)
7. **Exact reproduction scenario** — publish week A (Mon-Sun), immediately publish week B (next Mon-Sun). Verify week A's Monday events are still present. Repeat with manual resync button to verify concurrent processing is safe
8. **DB read failure safety** — simulate a Supabase read error in the `after()` callback. Verify sync is aborted and no events are deleted (CRIT-001 guard)
9. **Same-week concurrent sync** — trigger publish and manual resync for the same week simultaneously. Verify no duplicate events are created (HIGH-001 idempotency)
10. **Republish during resync** — start a manual resync, then republish a week mid-resync. Verify the empty-week guard prevents calendar wipe during the snapshot replacement gap (HIGH-002)
11. **Sparse week orphan recovery** — create a week with shifts only on Wed-Fri. Delete a shift. Verify the orphaned event on (e.g.) Wednesday is found and cleaned up using canonical week boundaries, not just the shift-span

## Rollback Plan

If the fix introduces issues, revert the two changed files. Existing Google Calendar events with the new `weekId` property are harmless — the property is simply ignored by the old code.
