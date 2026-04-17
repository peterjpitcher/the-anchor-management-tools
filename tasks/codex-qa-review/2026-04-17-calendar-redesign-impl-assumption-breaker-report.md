# Implementation Assumption Breaker — Calendar Redesign

## Inspection Inventory

Read the spec at [docs/superpowers/specs/2026-04-17-calendar-redesign-design.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:1). The requested reality-mapper report path does not exist.

Inspected the implementation across `ScheduleCalendar`, month/week/list views, adapters, sort/hour-range helpers, `/events` migration, dashboard migration, dashboard loaders, old deleted list behavior from `c4f304ea`, and tests.

Verification run:
`npm test -- tests/components/schedule-calendar` passes: 7 files, 29 tests.
`npm test` fails: 17 files failed, 36 failed tests, plus 1 failed suite. None are in `tests/components/schedule-calendar`; failures are outside this calendar surface.

## High-Severity Challenges

1. Dashboard past scroll is materially broken for private bookings and parking.

Evidence: the loader does fetch past private bookings into `privateBookings.past` at [dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:850) and [dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:874), and past parking into `parking.past` at [dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:929) and [dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:956). But the dashboard page passes only `snapshot.privateBookings.upcoming` and `snapshot.parking.upcoming` into the schedule at [page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/page.tsx:120). The spec requires dashboard past scroll and visible loaded-window documentation at [spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:244).

Counterargument: past events are included via `snapshot.events.past` at [page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/page.tsx:116), so the dashboard list is not entirely future-only.

What would confirm: pass `past + upcoming` private bookings and parking into `UpcomingScheduleCalendar`, then add a dashboard test proving a past private booking and past parking row render above Today, with the “last 90 days / cap” note visible.

2. Week view can hide conflicts because overlap layout is not implemented.

Evidence: the spec requires overlaps side-by-side and `+N` overflow at [spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:201). The implementation renders timed entries with a plain `.map()` at [ScheduleCalendarWeek.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarWeek.tsx:136), and every block is `absolute left-1 right-1` at [ScheduleCalendarWeek.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarWeek.tsx:147). There is no collision grouping, width assignment, lane calculation, or `+N` pill.

Counterargument: entries still exist in the DOM, and tooltips could theoretically expose hidden detail if they worked.

What would confirm: add overlapping private-booking fixtures for the same day/time, assert distinct horizontal positions/widths, and assert fourth-overlap collapse behavior.

3. The new List view regresses the admin action surface promised by the spec.

Evidence: the spec requires Date / Title / Subtitle / Status / Checklist / Actions, including Edit / Delete, at [spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:232). Current `ScheduleCalendarList` renders time, linked title, subtitle, and optional status only at [ScheduleCalendarList.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarList.tsx:72). It has no checklist column, no actions column, no `hasPermission('events', 'manage')`, and no `deleteEvent`. The deleted old list had `canManageEvents = hasPermission('events', 'manage')` and a gated delete button in `c4f304ea:src/components/events/command-center/EventList.tsx:20` and `:120`.

Counterargument: edit and delete are still reachable after navigating to the event detail page: edit at [EventDetailClient.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/[id]/EventDetailClient.tsx:653), delete at [EventDetailClient.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/[id]/EventDetailClient.tsx:1236).

What would confirm: either restore list-row actions/checklist per spec, or revise the spec to explicitly accept “open detail first” as the admin workflow.

## Medium-Severity Challenges

- Tooltip rendering is a dead prop. `/events` passes `renderTooltip` at [EventCalendarView.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/EventCalendarView.tsx:253), but month only uses it to suppress native `title` at [ScheduleCalendarMonth.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarMonth.tsx:247), week does not destructure it at [ScheduleCalendarWeek.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarWeek.tsx:20), and list does not accept it at [ScheduleCalendarList.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarList.tsx:9). This also means tests would not fail if adapters produced the wrong tooltip kind.

- Status treatment is not implemented across all views. Month only visibly handles muted/struck states and does not render the draft/sold-out/status pills promised around [spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:166). Week only mutes `cancelled` at [ScheduleCalendarWeek.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarWeek.tsx:147). List mutes past rows, not cancelled/postponed/rescheduled future rows, at [ScheduleCalendarList.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarList.tsx:74).

- Dashboard event status is erased. `UpcomingScheduleCalendar` passes `eventStatus: null` into `eventToEntry` at [UpcomingScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx:107), and `eventToEntry` defaults that to scheduled at [adapters.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/adapters.ts:51). Dashboard event queries do not select `event_status` at [dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:619), so cancelled/postponed/draft/sold-out events render as normal scheduled events there.

- Week hour range correctly ignores `allDay`, but it is not scoped to the visible week. `computeWeekHourRange` skips all-day entries at [hour-range.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/hour-range.ts:19), but week passes the entire dataset at [ScheduleCalendarWeek.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarWeek.tsx:35). A 06:00 entry in another month can expand the current week.

- The list does not own a bounded scroll container. It is just `overflow-y-auto` with no height/flex constraint at [ScheduleCalendarList.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarList.tsx:50). On `/events`, an outer shell owns scrolling at [CommandCenterShell.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/CommandCenterShell.tsx:102). On dashboard, the card has no calendar-panel height at [page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/page.tsx:277). Anchoring may scroll an ancestor/page, but that is not the spec’s owned container.

- Sort order is not consistent. Month and list use `compareEntries` at [ScheduleCalendarMonth.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarMonth.tsx:44) and [ScheduleCalendarList.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarList.tsx:20). Week renders input order at [ScheduleCalendarWeek.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarWeek.tsx:44), so D17 is not applied there.

## Low-Severity / Notable

- “Full titles, never ellipsis” is only partially proven. Month title elements avoid `truncate`, but the test only checks classes at [ScheduleCalendarMonth.test.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tests/components/schedule-calendar/ScheduleCalendarMonth.test.tsx:68). The runtime layout still uses a flex row at [ScheduleCalendarMonth.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarMonth.tsx:203) and an outer `overflow-hidden` wrapper at [ScheduleCalendarMonth.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarMonth.tsx:83), so visual clipping is still plausible for pathological titles or narrow columns.

- Events mobile still shows the outer `ControlBar` view switcher at [ControlBar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/ControlBar.tsx:84), even though `ScheduleCalendar` hides its own switcher/nav on mobile at [ScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendar.tsx:59). Dashboard is cleaner than `/events` here.

- The Today floating button from the spec is absent. The list anchors once via `scrollIntoView` at [ScheduleCalendarList.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarList.tsx:36), but there is no intersection tracking or floating button.

- Dashboard private-booking detail was reduced. `hold_expiry` and `balance_due_date` still feed aggregate action cards at [page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/page.tsx:134) and [page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/page.tsx:143). `deposit_status` and `days_until_event` still exist in types/mapper at [dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:76), but are not rendered or passed into the calendar adapter.

- Tests are mostly synthetic. The “25/26 April” month test uses hand-built `CalendarEntry` objects at [ScheduleCalendarMonth.test.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tests/components/schedule-calendar/ScheduleCalendarMonth.test.tsx:32), not realistic `EventOverview` plus adapter data with category/checklist/status.

## Things The Implementation Got Right

- Multi-day month bars are not repeated per day. They are separated into band entries at [ScheduleCalendarMonth.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarMonth.tsx:47), clipped per week at [ScheduleCalendarMonth.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarMonth.tsx:60), and rendered once per week row at [ScheduleCalendarMonth.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarMonth.tsx:95).

- Event duration is fixed to 2h in the adapter and week layout: [adapters.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/adapters.ts:50) and [ScheduleCalendarWeek.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarWeek.tsx:59). Private bookings with no `end_time` also default to +2h at [adapters.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/adapters.ts:88).

- `ScheduleCalendar` owns anchor state internally at [ScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendar.tsx:38), and it is controlled by `view` externally. It will remember the month/week anchor across desktop view switches.

- Events-page private booking search covers `customer_name` and `event_type` at [CommandCenterShell.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/CommandCenterShell.tsx:74).

- The dedicated schedule-calendar test subset passes.

## Summary Verdict

Not shippable against the spec as written.

The implementation has a useful foundation: adapters, month/list sorting, event duration, mobile fallback inside `ScheduleCalendar`, and multi-day month bars are real. But several contract-level promises are not met: dashboard past private bookings/parking never reach the calendar, week conflicts can visually overwrite each other, list admin actions/checklist are gone, tooltip rendering is non-functional, and status semantics are inconsistent across views and dashboard data. The current tests give confidence in isolated pieces, not in the actual dashboard/events behavior the spec promised.