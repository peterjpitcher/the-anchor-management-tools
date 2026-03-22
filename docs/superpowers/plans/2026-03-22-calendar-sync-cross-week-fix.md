# Calendar Sync Cross-Week Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Google Calendar sync bug where orphan recovery deletes events from adjacent weeks, causing shifts to appear and disappear unpredictably (especially on Mondays).

**Architecture:** Add `weekId` to Google Calendar extended properties so orphan recovery can scope deletions to the current week only. Add safety guards against empty-week sync, DB read failures, and same-week concurrency. Use canonical week boundaries from `rota_weeks.week_start` instead of shift-span.

**Tech Stack:** Next.js server actions, Google Calendar API (googleapis), Supabase (PostgreSQL), Vitest

**Spec:** `docs/superpowers/specs/2026-03-22-calendar-sync-cross-week-fix-design.md`
**QA Review:** `tasks/codex-qa-review/codex-qa-report.md`

---

## File Structure

| File | Role | Action |
|------|------|--------|
| `src/lib/google-calendar-rota.ts` | Core sync logic | Modify — extend `SyncOptions`, rewrite orphan recovery, add `weekId` to event body, add empty-week guard, add pagination |
| `src/app/actions/rota.ts` | Publish + resync server actions | Modify — rewrite `after()` callback, pass `weekStart` to sync |
| `src/app/api/rota/resync-calendar/route.ts` | Manual resync API route | Modify — select `week_start`, pass through options |

---

### Task 1: Extend SyncOptions and Function Signature

**Files:**
- Modify: `src/lib/google-calendar-rota.ts:34-39` (SyncOptions interface)
- Modify: `src/lib/google-calendar-rota.ts:110-113` (function signature)

- [ ] **Step 1: Add `weekStart` to `SyncOptions` interface**

In `src/lib/google-calendar-rota.ts`, change the `SyncOptions` interface at line 34:

```ts
/** Options to avoid redundant fetches when syncing multiple weeks in a batch. */
export interface SyncOptions {
  /** Pre-fetched employee name map — skips the per-week employee query. */
  employeeNames?: Map<string, string>
  /** Pre-created auth client — skips the per-week getOAuth2Client() call. */
  auth?: GoogleCalendarAuth
  /** Canonical week start date (Monday) from rota_weeks.week_start.
   *  Used for orphan recovery scan boundaries. Falls back to shift-span if not provided. */
  weekStart?: string
}
```

- [ ] **Step 2: Verify the file still compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors (existing errors unrelated to this change are OK)

- [ ] **Step 3: Commit**

```bash
git add src/lib/google-calendar-rota.ts
git commit -m "refactor: extend SyncOptions with weekStart parameter"
```

---

### Task 2: Add `weekId` to Extended Properties

**Files:**
- Modify: `src/lib/google-calendar-rota.ts:325-327` (eventBody)

- [ ] **Step 1: Add `weekId` to the event body's extended properties**

At line 325, change:

```ts
        extendedProperties: {
          private: { shiftId: shift.id },
        },
```

To:

```ts
        extendedProperties: {
          private: { shiftId: shift.id, weekId: weekId },
        },
```

- [ ] **Step 2: Verify the file still compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/google-calendar-rota.ts
git commit -m "feat: add weekId to Google Calendar event extended properties"
```

---

### Task 3: Add Empty-Week Guard

**Files:**
- Modify: `src/lib/google-calendar-rota.ts:158` (after `currentShiftIds` declaration)

- [ ] **Step 1: Add the empty-week guard after line 158**

After `const currentShiftIds = new Set(shifts.map(s => s.id))` (line 158), add:

```ts
  // -- Guard: never delete all events when shifts array is empty ----------
  // Protects against the delete/insert gap during republish where
  // rota_published_shifts is momentarily empty between delete and insert.
  if (shifts.length === 0 && existingMap.size > 0) {
    console.warn('[RotaCalendar] Skipping sync — week has mapped events but no shifts provided (snapshot may be in progress)', weekId)
    return result
  }
```

- [ ] **Step 2: Verify the file still compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add src/lib/google-calendar-rota.ts
git commit -m "fix: add empty-week guard to prevent calendar wipe during snapshot replacement"
```

---

### Task 4: Add `addDays` Helper

**Files:**
- Modify: `src/lib/google-calendar-rota.ts:66-70` (near `addOneDay`)

- [ ] **Step 1: Add an `addDays` helper next to the existing `addOneDay`**

After `addOneDay` (line 66-70), add:

```ts
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/google-calendar-rota.ts
git commit -m "refactor: add addDays helper for canonical week boundary calculation"
```

---

### Task 5: Rewrite Orphan Recovery with Week-Scoped Filtering

This is the core fix. Requires updating the existing mapping query and replacing lines 168-249.

**Files:**
- Modify: `src/lib/google-calendar-rota.ts:149` (existing mapping query)
- Modify: `src/lib/google-calendar-rota.ts:168-249` (orphan recovery block)

- [ ] **Step 0: Update the existing mapping query to include `week_id`**

At line 149, change:

```ts
    .select('shift_id, google_event_id')
```

To:

```ts
    .select('shift_id, google_event_id, week_id')
```

This is needed for the legacy event ownership check in the orphan recovery below.

- [ ] **Step 1: Replace the orphan recovery block**

Replace the entire block from line 168 (`// -- Rebuild mapping from Google Calendar extended properties`) through line 249 (the closing `}` of the outer `if (shifts.length > 0)`) with:

```ts
  // -- Rebuild mapping from Google Calendar extended properties ------------
  // Recovers from partial syncs and cleans up orphaned events.
  // IMPORTANT: Only delete events that belong to THIS week (identified by
  // weekId extended property or DB lookup). Never touch other weeks' events.
  if (shifts.length > 0) {
    // Use canonical week boundaries if provided, fall back to shift-span
    const scanStart = options?.weekStart
      ?? shifts.reduce((min, s) => s.shift_date < min ? s.shift_date : min, shifts[0].shift_date)
    const scanEnd = options?.weekStart
      ? addDays(options.weekStart, 6)
      : shifts.reduce((max, s) => s.shift_date > max ? s.shift_date : max, shifts[0].shift_date)

    // Add one day so timeMax covers overnight shifts. Note: Google Calendar
    // events.list applies timeMax to event START time, so this is a tolerance
    // window rather than strict overnight coverage. The weekId filter makes
    // this safe regardless of how wide the window is.
    const timeMaxDate = new Date(scanEnd + 'T23:59:59Z')
    timeMaxDate.setUTCDate(timeMaxDate.getUTCDate() + 1)

    try {
      // Paginate through all events in the date range.
      // google.calendar('v3').events.list returns { data: { items, nextPageToken } }
      type GCalEventItem = NonNullable<
        Awaited<ReturnType<typeof calendar.events.list>>['data']['items']
      >[number]
      const allEvents: GCalEventItem[] = []
      let pageToken: string | undefined

      do {
        const listRes = await calendar.events.list({
          auth: calendarAuth(auth),
          calendarId,
          timeMin: scanStart + 'T00:00:00Z',
          timeMax: timeMaxDate.toISOString(),
          singleEvents: true,
          maxResults: 250,
          pageToken,
        })
        allEvents.push(...(listRes.data.items ?? []))
        pageToken = listRes.data.nextPageToken ?? undefined
      } while (pageToken)

      const knownEventIds = new Set(existingMap.values())
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

      const toRecover: Array<{ evId: string; evShiftId: string }> = []
      const toDelete: Array<{ evId: string; label: string }> = []

      for (const ev of allEvents) {
        if (!ev.id) continue
        const evShiftId = ev.extendedProperties?.private?.shiftId
        const evWeekId = ev.extendedProperties?.private?.weekId

        if (evWeekId) {
          // --- Event has weekId (new-style) ---
          if (evWeekId !== weekId) {
            // Belongs to a different week — leave it alone
            continue
          }
          // Belongs to this week
          if (evShiftId && currentShiftIds.has(evShiftId) && !existingMap.has(evShiftId)) {
            toRecover.push({ evId: ev.id, evShiftId })
          } else if (evShiftId && !currentShiftIds.has(evShiftId)) {
            toDelete.push({ evId: ev.id, label: evShiftId })
          }
        } else if (evShiftId) {
          // --- Legacy event: has shiftId but no weekId ---
          if (currentShiftIds.has(evShiftId)) {
            // Shift belongs to this week — recover immediately (UUIDs are globally unique)
            if (!existingMap.has(evShiftId)) {
              toRecover.push({ evId: ev.id, evShiftId })
            }
          } else {
            // Shift not in current week — check DB for ownership
            const dbRow = (existing ?? []).find(r => r.shift_id === evShiftId)
            if (dbRow && dbRow.week_id === weekId) {
              // DB confirms it belongs to this week → genuine orphan, delete
              toDelete.push({ evId: ev.id, label: evShiftId })
            }
            // If not in DB, or belongs to another week: skip (can't determine ownership safely)
          }
        } else if (
          !knownEventIds.has(ev.id) &&
          appUrl &&
          ev.description?.includes(appUrl + '/rota')
        ) {
          // --- Legacy event: no shiftId, no weekId, but has our /rota URL ---
          // Only delete if the event's start time is within this week's canonical range
          const evStart = ev.start?.dateTime ?? ev.start?.date ?? ''
          const evStartDate = evStart.split('T')[0]
          if (evStartDate >= scanStart && evStartDate <= scanEnd) {
            toDelete.push({ evId: ev.id, label: '(legacy-orphan)' })
          }
        }
      }

      // Recover orphaned-but-valid events in parallel
      await Promise.all(toRecover.map(async ({ evId, evShiftId }) => {
        existingMap.set(evShiftId, evId)
        await admin.from('rota_google_calendar_events').upsert({
          shift_id: evShiftId,
          week_id: weekId,
          google_event_id: evId,
          updated_at: new Date().toISOString(),
        })
        console.info('[RotaCalendar] Recovered orphaned event', evId, 'for shift', evShiftId)
      }))

      // Delete genuine orphans in batches of 10
      if (toDelete.length > 0) {
        console.info('[RotaCalendar] Deleting', toDelete.length, 'orphan event(s) for week', weekId)
        for (let i = 0; i < toDelete.length; i += 10) {
          await Promise.all(
            toDelete.slice(i, i + 10).map(({ evId, label }) =>
              safeDeleteEvent(auth, calendarId, evId, label)
            )
          )
        }
      }
    } catch (err: unknown) {
      // Non-fatal: if listing fails we fall through to normal upsert logic
      console.warn('[RotaCalendar] Event listing for orphan recovery failed:', err instanceof Error ? err.message : String(err))
    }
  }
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/google-calendar-rota.ts
git commit -m "fix: rewrite orphan recovery with week-scoped filtering to prevent cross-week event deletion"
```

---

### Task 6: Rewrite Publish after() Callback

**Files:**
- Modify: `src/app/actions/rota.ts:1016-1030`

- [ ] **Step 1: Replace the after() callback**

Replace lines 1016-1030 (from `// Sync to management Google Calendar` through the `after()` closing):

```ts
  // Sync to management Google Calendar after the response is sent.
  // after() keeps the serverless function alive until the callback completes
  // (up to maxDuration = 300s). This never blocks publish or causes 504s.
  const weekStartDate = weekRow?.week_start as string | undefined
  after(async () => {
    try {
      const syncAdmin = createAdminClient()
      const { data: publishedShifts, error: readError } = await syncAdmin
        .from('rota_published_shifts')
        .select('id, week_id, employee_id, shift_date, start_time, end_time, department, status, notes, is_overnight, is_open_shift, name')
        .eq('week_id', weekId)

      // CRITICAL: Never sync an empty array on read failure — this would delete
      // all mapped events for the week. Abort on error or null data.
      if (readError || !publishedShifts) {
        console.error('[RotaCalendar] Failed to read published shifts for sync — aborting', weekId, readError?.message)
        return
      }

      // Guard against snapshot-in-progress: if the week is published but has
      // zero shifts, a delete/insert snapshot replacement may be in progress.
      if (publishedShifts.length === 0) {
        console.info('[RotaCalendar] No published shifts found for week — skipping sync (snapshot may be in progress)', weekId)
        return
      }

      const { syncRotaWeekToCalendar } = await import('@/lib/google-calendar-rota')
      const syncResult = await syncRotaWeekToCalendar(weekId, publishedShifts, {
        weekStart: weekStartDate,
      })
      if (syncResult.failed > 0) {
        console.warn('[RotaCalendar] Sync completed with failures after publish for week', weekId, syncResult)
      }
    } catch (err: unknown) {
      console.error('[RotaCalendar] Sync failed after publish for week', weekId, err)
    }
  })
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/rota.ts
git commit -m "fix: read from rota_published_shifts in publish sync with error and empty guards"
```

---

### Task 7: Pass weekStart in Resync Server Action

**Files:**
- Modify: `src/app/actions/rota.ts:1050,1064`

- [ ] **Step 1: Update the rota_weeks query to include week_start**

At line 1050, change:

```ts
    .select('id')
```

To:

```ts
    .select('id, week_start')
```

- [ ] **Step 2: Pass weekStart to syncRotaWeekToCalendar**

At line 1064, change:

```ts
      await syncRotaWeekToCalendar(week.id, shifts ?? []);
```

To:

```ts
      await syncRotaWeekToCalendar(week.id, shifts ?? [], {
        weekStart: week.week_start as string,
      });
```

- [ ] **Step 3: Verify the file compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/rota.ts
git commit -m "fix: pass weekStart to calendar sync in resync server action"
```

---

### Task 8: Pass weekStart in Resync API Route

**Files:**
- Modify: `src/app/api/rota/resync-calendar/route.ts:81,119,156`

- [ ] **Step 1: Update the rota_weeks query to include week_start**

At line 81, change:

```ts
      .select('id')
```

To:

```ts
      .select('id, week_start')
```

- [ ] **Step 2: Build a weekStart map alongside the existing shiftsByWeek map**

After line 119, add:

```ts
    const weekStartMap = new Map<string, string>()
    for (const w of weeks ?? []) {
      weekStartMap.set(w.id, w.week_start as string)
    }
```

- [ ] **Step 3: Pass weekStart in the sync call**

At line 156, change:

```ts
        const result = await syncRotaWeekToCalendar(weekId, shifts, {
          employeeNames,
          auth,
        })
```

To:

```ts
        const result = await syncRotaWeekToCalendar(weekId, shifts, {
          employeeNames,
          auth,
          weekStart: weekStartMap.get(weekId),
        })
```

- [ ] **Step 4: Verify the file compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`

- [ ] **Step 5: Commit**

```bash
git add src/app/api/rota/resync-calendar/route.ts
git commit -m "fix: pass weekStart to calendar sync in resync API route"
```

---

### Task 9: Verify Full Build

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: Zero errors

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Clean compilation

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All existing tests pass

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: Successful production build

- [ ] **Step 5: Commit any lint fixes if needed**

```bash
git add -A
git commit -m "chore: lint fixes for calendar sync changes"
```

---

### Task 10: Manual Testing Checklist

These tests must be run against the live Google Calendar after deploying:

- [ ] **Test 1:** Publish a single week → verify shifts appear with `weekId` in extended properties
- [ ] **Test 2:** Publish two adjacent weeks → verify Monday events from week A persist after week B syncs
- [ ] **Test 3:** Click "Sync calendar" button → verify all weeks sync without cross-contamination
- [ ] **Test 4:** Create a Sunday 22:00→Monday 02:00 overnight shift → publish both weeks → verify it persists
- [ ] **Test 5:** Verify existing events (without `weekId`) are handled gracefully on first resync
- [ ] **Test 6:** After full resync, verify all events now have `weekId` in extended properties
- [ ] **Test 7:** Publish week A, immediately publish week B → verify no Monday events lost
