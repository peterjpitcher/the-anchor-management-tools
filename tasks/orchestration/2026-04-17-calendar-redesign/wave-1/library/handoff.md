# Wave 1 · Library — Handoff

## Outputs
- `src/components/schedule-calendar/types.ts` — `CalendarEntry`, `CalendarEntryKind`, `CalendarEntryStatus`, `TooltipData` discriminated union, `ScheduleCalendarView`, `ScheduleCalendarProps`.
- `src/components/schedule-calendar/sort.ts` — `compareEntries(a, b)` implementing the deterministic tie-break (start → end → kind priority → status priority → title → id), per D17.
- `src/components/schedule-calendar/hour-range.ts` — `computeWeekHourRange(entries, baseline)` returning `{ startHour, endHour }`. Ignores `allDay` entries; caps 0–24.
- `src/components/schedule-calendar/adapters.ts` — pure data transforms: `eventToEntry`, `privateBookingToEntry`, `calendarNoteToEntry`, `parkingToEntry`. All return `CalendarEntry` with `tooltipData` (no JSX). Also exports `DashboardParkingInput` and `EventAdapterInput`.
- `tests/components/schedule-calendar/sort.test.ts` — 5 tests, covers every tie-break tier.
- `tests/components/schedule-calendar/hour-range.test.ts` — 5 tests, covers baseline, early/late extend, allDay exclusion, 0/24 cap.
- `tests/components/schedule-calendar/adapters.test.ts` — 7 tests across all four adapters, including corrupt-range clamp and endsNextDay handling.

## Test results
```
RUN  v4.1.2 /Users/peterpitcher/Cursor/OJ-AnchorManagementTools

 Test Files  3 passed (3)
      Tests  17 passed (17)
   Start at  12:35:25
   Duration  1.12s
```
Command used: `npx vitest run tests/components/schedule-calendar/sort.test.ts tests/components/schedule-calendar/hour-range.test.ts tests/components/schedule-calendar/adapters.test.ts`.

## Typecheck
`npx tsc --noEmit` — exit 0, zero output. No new errors under `src/components/schedule-calendar/` or `tests/components/schedule-calendar/`.

## Assumptions made
- **`EventAdapterInput` local type.** The adapter accepts `EventOverview & { bookedSeatsCount?: number }` (exported as `EventAdapterInput`). The brief said "do not modify any existing file", so rather than editing `get-events-command-center.ts` to add the field, I declared the shape locally. At handoff time the upstream wave had *already* added `bookedSeatsCount: number` to `EventOverview` in the uncommitted working tree — the intersection is compatible with both the pre-upstream shape and the post-upstream shape, so this adapter works either way. Downstream waves can keep importing `EventOverview` directly into the wrapper that builds `CalendarEntry[]`, or import `EventAdapterInput` if they want the explicit extension.
- **`parseLocalDate` uses `new Date(y, m, d, hh, mm)`.** Per D16 and the brief, this gives Europe/London wall-clock on the team's systems. No `dateUtils` helper exists that returns a `Date` from date+time parts, so the constructor is the right primitive.
- **Calendar note `color` fallback.** The existing `CalendarNoteCalendarOverview.color` is typed as `string` (non-null). The adapter still applies `note.color || '#0EA5E9'` as defensive fallback in case of empty strings.
- **Parking `start_at`/`end_at` are ISO UTC strings** (parsed via `new Date(string)`) — that matches the existing parking table shape and the plan's test fixture `'2026-04-25T10:00:00Z'`.

## Notes for downstream waves
- Adapters expect input types from `src/app/(authenticated)/events/get-events-command-center.ts` (for events / private bookings / notes) and a local `DashboardParkingInput` interface defined in `adapters.ts` (for parking).
- The event adapter's `subtitle` string is `` `${N} booked` `` including the `0 booked` / `1 booked` cases — matches D8. Pluralisation polish, if desired later, belongs in the view layer.
- `compareEntries` depends on `Date.getTime()`; it is stable for overlapping starts because the 6-tier tie-break always eventually disambiguates (the final tier is `id.localeCompare`, and all adapters prefix IDs uniquely per kind).
- `computeWeekHourRange` rounds end hours *up* when the entry has a non-zero minute (e.g. 22:30 → `endHour = 23`). Downstream view code should treat the returned range as the set of **full hour cells** to render.
- Adapters are pure — no React imports, no JSX. `renderTooltip(entry)` is the designated extension point for JSX.
- **No git commits were made**, per the brief. All seven files are in the working tree, untracked under `src/components/schedule-calendar/` and `tests/components/schedule-calendar/`.
