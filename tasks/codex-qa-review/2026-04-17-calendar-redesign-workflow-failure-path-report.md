# Workflow & Failure-Path Review — Calendar Redesign

## Inspection Inventory

Repo Reality Map was not present at `tasks/codex-qa-review/2026-04-17-calendar-redesign-repo-reality-mapper-report.md`.

Reviewed:

- [2026-04-17-calendar-redesign-design.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:1)
- [EventCalendarView.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/EventCalendarView.tsx:1)
- [get-events-command-center.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/get-events-command-center.ts:1)
- [events/page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/page.tsx:1)
- [Calendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/Calendar.tsx:1)
- [CommandCenterShell.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/CommandCenterShell.tsx:1)
- [EventList.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/EventList.tsx:1)
- [UpcomingScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx:1)
- [dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:1)
- [calendar-notes.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/calendar-notes.ts:1)

## Empty States

Material gaps.

Month view: the spec says a generic empty message exists, but it does not say whether an empty month still renders the grid. If the grid is replaced by “No entries in this window”, the user loses the obvious “click a day to add note” workflow. Recommendation: render an empty navigable month grid with clickable day cells when `canCreateCalendarNote` is true, plus a separate empty hint.

Week view: a week containing only multi-day/all-day notes should still render the default `12:00–23:00` grid. The spec implies this, but the hour-range rule says “any entry” can extend the range, which could be misread to include all-day notes. Recommendation: explicitly exclude `allDay` entries from timed hour-range calculation.

List view: if there are no past, today, or future entries, there may be no “Today” group for `scrollIntoView` to target. Recommendation: always render a synthetic Today anchor/header, even when the list is empty, or define the fallback target.

## Weird Date Inputs

Material gaps.

DST is under-specified. The spec models geometry with `Date` plus `1 hour = 40px` ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:56), [spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:118)), while current code creates browser-local `Date` objects from venue dates ([EventCalendarView.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/EventCalendarView.tsx:80), [UpcomingScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx:95)). On UK DST transition days, elapsed milliseconds and wall-clock minutes diverge. Recommendation: specify Europe/London venue-time parsing and compute visual positions from wall-clock minutes, not elapsed milliseconds.

`end_time_next_day` is not committed. The spec marks overnight bookings as `spansMultipleDays` ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:63)) but does not say whether they render only on the start day, span into the next day, or split into two visual blocks. Current events calendar computes next-day end but forces private bookings to start-day-only ([EventCalendarView.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/EventCalendarView.tsx:121), [EventCalendarView.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/EventCalendarView.tsx:262)). Recommendation: commit per view.

Corrupt note ranges need preserving. Current adapters clamp `end_date < note_date` back to start ([EventCalendarView.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/EventCalendarView.tsx:268), [UpcomingScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx:256)), while writes also validate the range ([calendar-notes.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/calendar-notes.ts:26)). The new adapter spec does not mention the clamp. Recommendation: adapter tests should include corrupted `end_date`.

## Overlapping / Duplicated Data

Material gaps.

Week overlaps are specified, but month tie handling is not. The spec says month timed entries are sorted by `start` ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:87)) and week overlaps go side-by-side ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:121)). It does not define same-start sort precedence across events, private bookings, notes, and parking. Current sorting only compares start time, so ties fall back to source/input order ([EventCalendarView.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/EventCalendarView.tsx:285), [UpcomingScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx:291)). Recommendation: define a deterministic sort key: `start`, `end`, kind priority, status priority, title, id.

Month stacking should be explicit. The redesign appears to remove the current 3-entry cap, because rows grow to fit the busiest day ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:82)); current generic calendar truncates after three ([Calendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/Calendar.tsx:397)). Recommendation: say “month renders all entries in stack order; no `+N` collapse” or define a collapse rule.

## Click Race Conditions

Material gaps.

The spec does not define behavior when an empty-cell click happens during refresh. Existing note creation stores only the clicked ISO date and then calls `router.refresh()` after save ([EventCalendarView.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/EventCalendarView.tsx:291), [EventCalendarView.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/EventCalendarView.tsx:318)). Recommendation: capture the clicked date as immutable modal state, disable duplicate submits while saving, and preserve modal state across background refreshes.

Switching view mid-click is not addressed. Current code relies on `stopPropagation` on event blocks ([Calendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/Calendar.tsx:400)), but the new spec should require entry clicks and empty-cell clicks to be mutually exclusive and resilient to unmount. Recommendation: use real links/buttons for entries, stop propagation on interactive children, and guard empty-cell handlers by current view/date at handler time.

## List View Anchor Corner Cases

Material gaps.

`scrollIntoView` can silently miss if the Today ref is not mounted. The spec says render all groups then scroll ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:135)), but does not define retry/fallback behavior. Recommendation: use `useLayoutEffect`, verify the ref exists, retry on the next animation frame after data/render changes, and expose the Today button even if initial anchoring fails.

Browser back/scroll restoration is a real risk. “On mount, always scroll Today to top” can override a user returning to a prior scroll position. Recommendation: only auto-anchor on first entry to list view, not on browser back/forward restoration or after `router.refresh()`.

Mobile Safari needs a defined behavior. `scrollIntoView({ block: 'start' })` can place content under sticky headers and can behave inconsistently during first paint. Recommendation: scroll the known container with an explicit offset or `scroll-margin-top`, and use instant scrolling by default.

## Data Freshness

Material gaps.

The dashboard is cached for 60 seconds per user ([dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:1266)), and the spec does not define focus refresh, manual refresh, or stale indicators. Edits in another tab can leave the calendar looking current but wrong. Recommendation: add an `onRefresh`/revalidate hook or at least a “last updated” + refresh control for schedule data.

Invalidation is incomplete for the new surface. Private booking mutations revalidate private-booking pages and dashboard but not `/events`, even though `/events` renders private booking overlays. Calendar notes do revalidate `/events` and dashboard ([calendar-notes.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/calendar-notes.ts:259)). Recommendation: private booking create/update/delete/status paths should revalidate `/events` too.

The `bookingsCount` addition needs freshness rules. The spec adds `bookingsCount` to `EventOverview` ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:41)), but event-booking mutations must invalidate any dashboard/event calendar counts. Recommendation: include count invalidation in the implementation plan.

After Add note, `router.refresh()` may preserve client state, but the proposed list anchor can still reset scroll if it runs on remount. Recommendation: persist view mode and do not auto-anchor after local mutations unless the user explicitly clicks Today.

## Permissions Edge Cases

Material gaps.

Server-side filtering is mostly correct on `/events`: the page checks `private_bookings:view` or `manage` before fetching private bookings ([events/page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/page.tsx:19), [events/page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/page.tsx:39)). The spec should say entries are omitted before adapter conversion, not silently dropped inside the adapter.

Legend permissions are under-specified. The spec says the legend is always visible with Private bookings and Parking on dashboard ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:159)). Current dashboard gates arrays by permission but always renders all legend items ([dashboard/page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/page.tsx:116), [UpcomingScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx:405)). Recommendation: legend items should be derived from permitted entry kinds, not hard-coded.

Clicking through is not enough as a permission strategy. “Destination page handles permission” ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:167)) can still show a visible entry that leads to unauthorized. Recommendation: only render entries the current user can view.

## Performance / Scale

Material gaps.

The spec’s data-window assumptions do not match reality. `getEventsCommandCenterData` loads all events, all notes, and all checklist statuses, then only uses a 30-day window for KPI counts ([get-events-command-center.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/get-events-command-center.ts:96), [get-events-command-center.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/get-events-command-center.ts:146), [get-events-command-center.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/get-events-command-center.ts:175)). The dashboard uses mixed caps: future events 25, past events 25, private bookings 20, parking 20, notes 90-day past/180-day future ([dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:294), [dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:608), [dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:762)). Recommendation: define exact windows and visible “data is capped” behavior before implementing list and navigation.

A venue with 300 private bookings in a month can create a very tall variable-height row. That may be acceptable, but the spec does not set rendering limits, memoization expectations, or filter performance targets. Recommendation: memoize derived entries/layout per view and include a stress fixture with hundreds of entries.

List view “all past + all future” can lag. On `/events`, the current loader can produce all historical events; on dashboard, the data is capped and can show false availability outside the cap. Recommendation: either define pagination/virtualization with a scroll-anchor strategy, or constrain the loaded window and make that visible.

## Accessibility Failure Paths

Material gaps.

Keyboard access is not specified. Current calendar entries and cells are clickable `div`s with no role/tab stop/key handlers ([Calendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/Calendar.tsx:398), [Calendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/Calendar.tsx:483)). Recommendation: entries should be links/buttons; empty day cells that open notes need keyboard activation and labels.

Screen reader anchoring is not solved by visual scroll. `scrollIntoView` moves pixels, not the screen reader’s virtual cursor. Recommendation: render Today as a real heading/landmark, provide a “Today” button/link, and decide whether initial list view should programmatically focus Today or avoid stealing focus.

Reduced motion is not specified. The spec uses `scrollIntoView({ block: 'start' })` ([spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:137)) but does not define smooth vs instant. Recommendation: default to instant/auto and respect `prefers-reduced-motion` for any animated scroll.

Hover-only tooltip content is insufficient for keyboard and touch users. Recommendation: ensure tooltip details are reachable on focus and not the only source of critical information.

## Findings Summary

| ID | Severity | Scenario | What happens | Recommendation |
|---|---|---|---|---|
| WF-01 | High | List view with no Today group | `scrollIntoView` has no target; empty list can make the Today anchor meaningless | Always render a synthetic Today anchor/header or define nearest-entry fallback |
| WF-02 | High | DST transition day / non-London browser timezone | Event positions and durations can shift because `Date` math uses client-local elapsed time | Specify Europe/London parsing and wall-clock minute geometry |
| WF-03 | High | Overnight private booking with `end_time_next_day` | Spec says `spansMultipleDays` but does not commit render behavior; dashboard lacks end fields today | Define per-view rendering and add dashboard end-time fields |
| WF-04 | High | Data edited in another tab or API path | Calendar can look complete while stale; some mutation paths do not invalidate `/events` or dashboard counts | Add revalidation hooks and update mutation invalidation plan |
| WF-05 | High | Dashboard navigation beyond capped data | User can navigate months/weeks that are only partially loaded and infer false availability | Define dashboard windows/caps and show when data is incomplete |
| WF-06 | Medium | Empty month/week/list | Generic empty state can replace useful grids or leave no action target | Specify per-view empty rendering and creation CTA behavior |
| WF-07 | Medium | Corrupt note `end_date < note_date` | Current display clamps; new adapter spec omits this guard | Preserve clamp/reject behavior and test it |
| WF-08 | Medium | Same-start event/private booking | Sort order is unstable and can change visible priority | Define deterministic tie-break sort |
| WF-09 | Medium | 300 bookings in a month | Variable-height rows may become huge; filters may re-render all layout | Add stress tests, memoization expectations, and optional caps |
| WF-10 | Medium | Browser back to list view | Auto-anchor can override restored scroll position | Anchor only on first list entry, not restoration or refresh |
| WF-11 | Medium | User lacks private booking/parking permission | Legend can advertise entry types that were filtered out | Build legend from permitted/available kinds |
| WF-12 | Medium | Keyboard-only or screen reader user | Clickable calendar cells/entries and visual scroll do not guarantee access | Use semantic links/buttons, focusable Today heading, and reduced-motion-safe scroll |