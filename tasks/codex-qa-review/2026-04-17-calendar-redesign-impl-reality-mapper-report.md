# Implementation Reality Map — Calendar Redesign

## Inspection Inventory

### Inspected
Target files under `src/components/schedule-calendar/`, the requested command-center/dashboard/action integration files, `src/components/ui-v2/display/Calendar.tsx`, `src/components/ui-v2/index.ts`, and `tests/components/schedule-calendar/*`. Line references below are from current `HEAD` `49f8d035`.

### Not Inspected
The added orchestration handoff docs from the commit range were not inspected because they were not in the requested target list. I did not inspect the original design spec, per “committed implementation, not the spec.”

### Limited Visibility
No runtime browser pass, database query plan, or test execution was performed. Private-booking dashboard field selection is partly indirect through `PrivateBookingService.getBookings(...)`, which is outside the requested file list; dashboard code assumes service rows may include `end_time_next_day` and `guest_count`.

## What Actually Landed

A new `schedule-calendar` package landed with shared types, adapters, sorting, hour-range logic, month/week/list views, a wrapper, and a barrel export. `CalendarEntryKind`, `CalendarEntryStatus`, `CalendarEntry`, `TooltipData`, `ScheduleCalendarView`, and a `ScheduleCalendarProps` type are defined in [types.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/types.ts:4) lines 4-83. `compareEntries` sorts by start, end, kind, status, title, then id in [sort.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/sort.ts:26) lines 26-33. `computeWeekHourRange` is exported from [hour-range.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/hour-range.ts:11).

The wrapper `ScheduleCalendar` accepts entries, controlled view, `onViewChange`, optional note handlers, optional `renderTooltip`, optional `firstDayOfWeek`, optional `legendKinds`, optional `onEntryClick`, and `className` in [ScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendar.tsx:13) lines 13-25. Month/week/list component props are declared in [ScheduleCalendarMonth.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarMonth.tsx:10), [ScheduleCalendarWeek.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarWeek.tsx:10), and [ScheduleCalendarList.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarList.tsx:9).

The barrel exports `ScheduleCalendar`, its component props, core entry/view/tooltip types, and the four adapters in [index.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/index.ts:1) lines 1-15. It does not export `compareEntries`, `HourRange`, `computeWeekHourRange`, or `DashboardParkingInput`.

One surface detail: there are two `ScheduleCalendarProps` interfaces. The shared one is in [types.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/types.ts:72), while the barrel exports the component-local one from [ScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendar.tsx:13), which includes `onEntryClick`.

## Adapters & Data Flow

`eventToEntry`, `privateBookingToEntry`, `calendarNoteToEntry`, `DashboardParkingInput`, and `parkingToEntry` are exported from [adapters.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/adapters.ts:48) lines 48, 80, 123, 157, and 169. They return the `CalendarEntry` shape promised by [types.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/types.ts:20).

Adapter shortcuts that landed:

- Events always get fixed two-hour end times, `allDay: false`, `spansMultipleDays: false`, `endsNextDay: false`, and `/events/${id}` href in [adapters.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/adapters.ts:48) lines 48-77.
- Private bookings use explicit `end_time`, add one day when `end_time_next_day` is true, otherwise default to +2h; they still set `spansMultipleDays: false` while carrying `endsNextDay` in [adapters.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/adapters.ts:80) lines 80-116.
- Calendar notes ignore upstream `start_time` / `end_time` and become all-day entries; invalid end dates are clamped back to the start date in [adapters.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/adapters.ts:123) lines 123-154.
- Parking entries default missing `start_at` to `new Date()` and missing `end_at` to +2h in [adapters.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/adapters.ts:169) lines 169-197. `payment_status` is typed on input at line 166 but not read in the returned entry.

Dashboard does inline shape adaptation for `EventSummary` into the fuller `EventOverview` expected by `eventToEntry`, filling unused fields with stubs such as `category: null`, image URLs `null`, `eventStatus: null`, empty checklist, and neutral badge values in [UpcomingScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx:102) lines 102-128.

## Month / Week / List view implementation facts

Month builds visible weeks from month start through the final visible week using `firstDayOfWeek` in [ScheduleCalendarMonth.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarMonth.tsx:27). It sorts entries, splits multi-day all-day entries into band entries, and treats everything else as timed/day entries in lines 44-56. Multi-day notes render in a separate full-week band track spanning all seven columns in [ScheduleCalendarMonth.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarMonth.tsx:100). Band placement is calculated once per visible week via week intersection, `marginLeft`, and percentage width in lines 60-66 and 116. Month title elements use wrapping classes, not truncation: band titles use `whitespace-normal break-words` at [ScheduleCalendarMonth.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarMonth.tsx:112), and timed titles use the same at line 207.

Week uses `computeWeekHourRange(entries)` in [ScheduleCalendarWeek.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarWeek.tsx:35), with inclusive hour labels from `startHour` through `endHour` in lines 36-39. `ROW_PX` is fixed at 40 in line 18. Timed entries render only when `isSameDay(e.start, day)`, with an inline comment that overnight entries render on their start day only at line 47. Event blocks use a fixed `120` minute duration regardless of event end time in lines 56-60. Non-event overnight duration adds 24 hours when `endsNextDay` is true in lines 57-62, and overnight blocks show `+1 day` in line 171.

List sorts and groups entries by date in [ScheduleCalendarList.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarList.tsx:20) lines 20-22. It inserts a synthetic empty Today group when no real group lands today in lines 24-29. The Today heading is stored in `todayRef`; `useLayoutEffect` uses `requestAnimationFrame` and a `hasAnchoredRef` guard to scroll it once in lines 33-42. Past rows use `text-muted-foreground bg-muted/20`, not `opacity-60`, in lines 74-81.

## Wrapper + integration facts

The wrapper stores its own `anchor` date with `useState(() => new Date())` in [ScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendar.tsx:38). Mobile detection uses `useMediaQuery('(max-width: 639px)')`, and `effectiveView` is forced to `list` on mobile in lines 39-41. Prev/next navigation only branches for month/week in lines 43-47. The nav controls are hidden on mobile and list view at line 59. The month/week/list switcher is hidden on mobile and calls `onViewChange(v)` in lines 78-84. Legend rendering is driven by optional `legendKinds`, with swatches from `kindColor(k)` and labels from `kindLabel(k)` in lines 100-108.

Command center now imports and renders `EventCalendarView` instead of branching to grid/list components in [CommandCenterShell.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/CommandCenterShell.tsx:11) and [CommandCenterShell.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/CommandCenterShell.tsx:103). `ControlBar` view mode is now `'month' | 'week' | 'list'` in [ControlBar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/ControlBar.tsx:14), with buttons setting those values around line 86. `EventCalendarView` builds entries from events, private bookings, and notes in [EventCalendarView.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/EventCalendarView.tsx:57), then renders `ScheduleCalendar` at line 253.

Tooltip reality: `EventCalendarView` defines custom tooltip content and passes `renderTooltip` at [EventCalendarView.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/EventCalendarView.tsx:107) and line 262. Current schedule views do not render that custom markup: list has no `renderTooltip` prop in [ScheduleCalendarList.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarList.tsx:9), week declares it but does not destructure/call it in [ScheduleCalendarWeek.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarWeek.tsx:20), and month uses it only to suppress native `title` fallback at [ScheduleCalendarMonth.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarMonth.tsx:123).

## Backend / data contract facts

`bookedSeatsCount` is confirmed seats only. Command center collects event IDs, queries `bookings` for `event_id, seats`, filters `.eq('status', 'confirmed')`, then sums `row.seats ?? 0` per event in [get-events-command-center.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/get-events-command-center.ts:217) lines 217-227. The mapped event uses the map with `0` fallback at line 295. This is one bookings query, but not a grouped SQL aggregate; grouping/summing happens in TypeScript.

Dashboard uses the same confirmed-seat summing semantics for `EventSummary.bookedSeatsCount` in [dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:656) lines 656-698. Dashboard event summaries include `bookedSeatsCount` in [dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:10) lines 10-18.

Dashboard past loaders are populated: past events query from lookback to before today at [dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:634), past private bookings load via `PrivateBookingService.getBookings` with `fromDate: past90Iso`, `toDate: todayIso`, `limit: 50` in [dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:850) lines 850-854, and `privateBookings.past` is assigned at line 874. Past parking loads `end_at < nowIso` and `start_at >= past90Iso` in [dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:929).

`end_time_next_day` and `guest_count` are typed on dashboard private-booking summaries in [dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:66) lines 66-73, accepted by `toPbSummary` in lines 808-809, normalized in lines 822-829, and passed into `privateBookingToEntry` from [UpcomingScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx:135) lines 135-147.

Command-center result still includes `privateBookingsForCalendar`, but the loader returns `privateBookingsForCalendar: []` while returning loaded `calendarNotes` in [get-events-command-center.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/get-events-command-center.ts:42) and [get-events-command-center.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/get-events-command-center.ts:347).

## Revalidation facts

Event create/update/delete now invalidate `/events` plus dashboard tag: `createEvent` at [events.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/events.ts:258), `updateEvent` at line 511, and `deleteEvent` at line 560. Event manual booking success revalidates `/events/${eventId}`, `/events`, `/table-bookings/foh`, and dashboard tag at line 761. Booking seat updates revalidate event detail, `/events`, FOH/BOH table bookings, and dashboard tag at line 1110. Manual booking cancellation revalidates detail, `/events`, FOH table bookings, and dashboard tag at line 1443.

A visible exception in the inspected event action file: the blocked-state branch only revalidates `/events/${eventId}` at [events.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/events.ts:796), not `/events` or dashboard.

Private booking create/update/status/delete/cancel/extend/capture-deposit paths revalidate `/events` and dashboard tag alongside private-booking paths at [privateBookingActions.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/privateBookingActions.ts:266), lines 367, 397, 464, 754, 799, and 1567.

## Deleted-surface facts

`EventList.tsx` and `EventGrid.tsx` are deleted. Before deletion, `EventList` exported `EventList`, accepted `events: EventOverview[]`, rendered a table with Date/Event/Status/Checklist/Actions, and exposed manage/delete actions at `99758c2b^:src/components/events/command-center/EventList.tsx:18`, lines 58-130. Before deletion, `EventGrid` exported `EventGrid`, accepted `events: EventOverview[]`, and mapped events into `EventCard` grid items at `99758c2b^:src/components/events/command-center/EventGrid.tsx:9`, lines 18-24.

`EventCalendar` was removed from the `ui-v2` export surface. Current [index.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/index.ts:40) exports only `Calendar, MiniCalendar` at line 40. Current [Calendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/Calendar.tsx:187) contains `Calendar`, `MiniCalendar` starts at line 660, and the file ends after `MiniCalendar` around line 680. Exact-token `rg` checks under `src` and `tests` found no remaining `EventCalendar`, `EventList`, or `EventGrid` imports.

## Test-coverage facts

Seven new files under `tests/components/schedule-calendar` add 29 `it(...)` cases.

- [adapters.test.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tests/components/schedule-calendar/adapters.test.ts:10): 7 tests covering event conversion, booked-seat subtitles, private-booking overnight/default-end behavior, multi-day note conversion/clamping, and parking conversion.
- [hour-range.test.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tests/components/schedule-calendar/hour-range.test.ts:31): 5 tests covering noon-23 baseline, earlier starts, later/overnight extension, all-day exclusion, and 0-24 caps.
- [sort.test.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tests/components/schedule-calendar/sort.test.ts:33): 5 tests covering start/end ordering, kind priority, status priority, title, and id tie-breaks.
- [ScheduleCalendar.test.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tests/components/schedule-calendar/ScheduleCalendar.test.tsx:11): 2 tests covering mobile list fallback and hidden switcher buttons.
- [ScheduleCalendarList.test.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tests/components/schedule-calendar/ScheduleCalendarList.test.tsx:21): 4 tests covering Today grouping, synthetic Today, muted past-row tokens without `opacity-60`, and `scrollIntoView`.
- [ScheduleCalendarMonth.test.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tests/components/schedule-calendar/ScheduleCalendarMonth.test.tsx:31): 3 tests covering no `truncate`/`text-ellipsis`, multi-day note title appearing once, and cancelled title `line-through`.
- [ScheduleCalendarWeek.test.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tests/components/schedule-calendar/ScheduleCalendarWeek.test.tsx:16): 3 tests covering baseline visible hours, 10:00 extension, and overnight booking appearing once with `+1 day`.

## Convention adherence

The implementation uses `cn` class composition in the new components and token-style classes such as `text-muted-foreground`, `bg-muted/20`, borders, and foreground/background tokens; the list past-state specifically avoids `opacity-60` in [ScheduleCalendarList.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/ScheduleCalendarList.tsx:81). The new wrapper follows the `ui-v2` integration direction by replacing the old `EventCalendar` export rather than extending it.

Date handling is mixed: backend/dashboard uses `todayIso`/lookback values from the dashboard data flow, while adapters use local `new Date(y, m - 1, d, hh, mm)` parsing with a comment naming Europe/London wall-clock handling in [adapters.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/schedule-calendar/adapters.ts:12). Calendar UI logic uses `date-fns` functions such as `startOfWeek`, `isSameDay`, `startOfToday`, and `format`, not the project `dateUtils` helpers.

## Risks Visible From Code (Factual, Not Critique)

- `bookedSeatsCount` matches confirmed-seat semantics, but the aggregation is not a grouped database aggregate; confirmed booking rows are fetched and summed in TypeScript.
- `privateBookingsForCalendar` exists in the command-center result type but is returned as an empty array, so command-center private-booking calendar entries depend on future loader population.
- Custom `renderTooltip` content is defined by integrations, but current schedule views do not render that custom markup; month only uses it to decide whether to suppress native `title`.
- Dashboard event entries are produced through a stubbed `EventSummary` to `EventOverview` shape adaptation.
- `ScheduleCalendarProps` exists in both `types.ts` and `ScheduleCalendar.tsx`; the barrel exports the component-local version.
- The event manual-booking blocked branch visibly revalidates event detail only, not `/events` or dashboard.
- `parkingToEntry` types `payment_status` but does not use it in the returned entry.