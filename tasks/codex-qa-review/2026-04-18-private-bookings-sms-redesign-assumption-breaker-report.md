# Assumption Breaker Report — Calendar Redesign

## Inspection Inventory

### Inspected
- Spec: `docs/superpowers/specs/2026-04-17-calendar-redesign-design.md`.
- Repo reality map: `tasks/codex-qa-review/2026-04-17-calendar-redesign-repo-reality-mapper-report.md`.
- Current calendar implementation, which appears ahead of the spec: `src/components/schedule-calendar/*`.
- Events/dashboard wrappers and loaders.
- Booking schema/migrations/indexes, generated DB types, and relevant action invalidation paths.
- Project and workspace rules: repo `CLAUDE.md` and `/Users/peterpitcher/Cursor/CLAUDE.md`.

### Not Inspected
- Live Supabase data/cardinality.
- Browser rendering screenshots.
- Full test execution. I read the tests, but did not run them.

### Limited Visibility
- The mapper report is stale relative to the current workspace. It says `EventCalendar` still has two callers; current code has no `EventCalendar` export/import and already contains `src/components/schedule-calendar/`.
- Generated DB types can lag live DB, but local migrations and generated types agree on the key booking/event shape.

## High-Severity Challenges

1. **Booked count semantics are not actually settled.**
   - Evidence: the spec says `bookedSeatsCount = SUM(seats) WHERE status = 'confirmed'`. Current loader comments and code include `confirmed`, `visited_waiting_for_review`, `review_clicked`, and `completed`, and explicitly exclude `pending_payment`: [get-events-command-center.ts](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/get-events-command-center.ts:212>). Event detail has two different notions: active bookings exclude only `cancelled`/`expired`, while `confirmedSeats` counts only `confirmed`: [EventDetailClient.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/[id]/EventDetailClient.tsx:323>). Event booking duplicate/delete flows still treat `confirmed + pending_payment` as active: [events.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/events.ts:584).
   - Counterargument: the spec may intentionally define “booked” as paid/confirmed seats only.
   - What would confirm: a product decision naming the metric precisely: “paid seats only”, “held seats”, or “non-terminal seats”. Then make event detail, calendar subtitles, delete guards, tests, and dashboard all use the same named helper/query.

2. **The “single grouped query” claim is overconfident.**
   - Evidence: the FK is real and simple: `bookings.event_id -> events.id ON DELETE CASCADE` in `20251123120000_squashed.sql`, and indexes exist on `event_id` plus `(event_id, status)`: [20260420000009_event_review_lifecycle.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260420000009_event_review_lifecycle.sql:30). But current code does not issue a DB grouped `SUM`; it fetches `event_id, seats` rows and sums in JS: [get-events-command-center.ts](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/get-events-command-center.ts:226>) and [dashboard-data.ts](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:672>).
   - Counterargument: for today’s event volume, row-fetching may be fine.
   - What would confirm: either add an RPC/view for `event_id -> bookedSeatsCount`, or explicitly accept client-side summing with observed row counts. Do not write spec language pretending raw SQL `GROUP BY` is already available through the current Supabase query style unless it is verified.

3. **Timezone/DST policy is underspecified and current code violates the stated rule.**
   - Evidence: workspace rules say use project date utilities and avoid raw `new Date()` for user-facing dates: [CLAUDE.md](/Users/peterpitcher/Cursor/CLAUDE.md:119). The spec says Europe/London wall-clock construction via `dateUtils`, but `dateUtils` mostly formats dates and does not provide a safe `parseLondonWallClock(date, time)` constructor: [dateUtils.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/dateUtils.ts:32). Current adapters build dates with local-browser `new Date(y, m, d, hh, mm)`: [adapters.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/adapters.ts:12), parking uses raw ISO `new Date`: [adapters.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/adapters.ts:169), and event duration uses `addHours`: [adapters.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/adapters.ts:48).
   - Counterargument: if every operator browser is in the UK, most wall-clock cases look right.
   - What would confirm: add a tested London wall-clock construction utility and run adapter/hour-range tests under a non-London TZ, plus DST boundary fixtures and near-midnight fixtures.

4. **List view parity is promised but the data model cannot support it yet.**
   - Evidence: the spec says list rows include category badge, checklist progress, and Edit/Delete actions. `CalendarEntry` has no checklist, permission, action, category badge, or delete/edit contract: [types.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/types.ts:20). Current list only renders time/title/subtitle/status: [ScheduleCalendarList.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarList.tsx:100).
   - Counterargument: maybe the new list intentionally drops old table actions.
   - What would confirm: either remove those list requirements from the spec, or add explicit `eventListData`/row action props so the “delete `EventList.tsx`” claim does not silently remove functionality.

5. **Token/Tailwind assumptions are false enough to block visual confidence.**
   - Evidence: workspace rule says no hardcoded hex colours in components and tokens should live in `@theme inline` or Tailwind config: [CLAUDE.md](/Users/peterpitcher/Cursor/CLAUDE.md:113). The repo is still Tailwind 3-configured: `tailwindcss` is `^3.4.0`, PostCSS uses `tailwindcss`, and config maps only `primary`, `secondary`, `green`, and `sidebar`: [package.json](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/package.json:68), [postcss.config.mjs](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/postcss.config.mjs:1), [tailwind.config.js](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tailwind.config.js:10). Current calendar uses `bg-muted`, `bg-background`, `border-border`, and inline hex maps: [ScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendar.tsx:79).
   - Counterargument: global CSS variables for `--muted`, `--background`, and `--border` exist.
   - What would confirm: Tailwind config or `@theme` must actually emit those classes, and kind colours should come from a real token map rather than component-local hex constants.

## Medium-Severity Challenges

- **Event duration is not just “no schema field”.** The repo already has `events.end_time` and `duration_minutes`: [database.generated.ts](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:2819>). Create defaults populate them from event categories: [events.ts](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/events.ts:68>). The user may still want fixed 2h blocks, but the spec should admit it is intentionally ignoring existing duration data.

- **Week overlap handling is load-bearing and not trivial.** The spec requires side-by-side overlaps. Current week rendering maps timed entries as full-width absolute blocks with no collision layout: [ScheduleCalendarWeek.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarWeek.tsx:154). This needs a real interval-packing algorithm and browser verification.

- **The events page has duplicated view controls risk.** `ControlBar` owns month/week/list switching: [ControlBar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/ControlBar.tsx:84). `ScheduleCalendar` also renders its own switcher: [ScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendar.tsx:78). The spec says both “ControlBar stays” and “ScheduleCalendar has view switcher”; that is a UX/control ownership conflict.

- **Dashboard “all three views” has width, not proven height.** The dashboard card spans desktop columns, but it has no fixed height; the events page is inside `min-h-[65vh]` and nested `overflow-hidden`: [events/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/page.tsx:97>). Browser screenshots are mandatory, not optional polish.

- **List today-anchor edge cases are mostly thought through, but bounded scrolling is not proven.** The synthetic Today header is a good requirement and current code has it: [ScheduleCalendarList.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarList.tsx:24). But the actual list container has `overflow-y-auto` without an explicit bounded height: [ScheduleCalendarList.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarList.tsx:50). If the parent does not constrain height, `scrollIntoView` affects the page shell, not the intended panel.

- **Private bookings past scope is inconsistent.** Dashboard loaders now include past private bookings and parking, but `/events` private bookings still come from `fetchPrivateBookingsForCalendar()`, which filters `event_date >= today`: [queries.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/private-bookings/queries.ts:254). If list view means “past schedule above today”, events-page private bookings disappear from the past.

## Low-Severity / Notable But Not Blocking

- `EventCalendar` caller risk is resolved in the current workspace: no `EventCalendar` export/import remains. This confirms the new component split is directionally right.
- `src/components/schedule-calendar/` is a better folder than `src/components/calendar/`; it avoids collision with the generic UI calendar.
- Legend requirement is right, but wrappers should not always include `event` when there are zero event entries. Current dashboard/events wrappers always push `event`: [UpcomingScheduleCalendar.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx:165>), [EventCalendarView.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/EventCalendarView.tsx:68>).
- Private booking `completed` exists in the domain type but is not in `CalendarEntryStatus`: [private-bookings.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/private-bookings.ts:1). Past dashboard private bookings may need a visible completed treatment.

## False Confidence Flagged

- “Open questions: None.” False. Booked-count semantics, event duration, token system, list action parity, and browser layout proof are still open.
- “Single grouped query.” Not proven in current Supabase access pattern.
- “No new E2E tests.” Defensible only because the repo lacks a harness, but not a substitute for browser screenshots. JSDOM has `css: false`: [vitest.config.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/vitest.config.ts:7).
- “Variable-height rows are straightforward.” The two-track idea is good, but row growth inside the real events/dashboard shells must be visually proven.
- “Dashboard = all three views.” Product decision is clear; layout fit is not yet proven.

## Things The Spec Got Right

- Keeping the generic `ui-v2/display/Calendar` untouched is correct.
- Moving to `ScheduleCalendar` instead of `src/components/calendar/` is correct.
- Month/week/list only is the right product simplification.
- Overnight private bookings need `end_time_next_day` and start-day-only rendering; the spec handles this explicitly.
- Synthetic Today anchor is the right list-view solution.
- Splitting data contracts/adapters, events UI, and dashboard migration into separate PRs is the right decomposition.
- Unit tests for adapters, sort, hour range, month, week, list, and mobile fallback are appropriate.

## Summary Verdict

**Ready to proceed with named fixes, not ready as-is.**

The design direction is solid, but the spec is too confident on the data metric, aggregation implementation, token system, timezone construction, and list-view parity. Load-bearing first fix: define the canonical `bookedSeatsCount` semantics and implement it as a reusable DB-backed aggregate/RPC or explicitly accepted JS aggregation. Second: add a real London wall-clock date constructor. Third: settle view-control ownership and token classes before browser layout work.