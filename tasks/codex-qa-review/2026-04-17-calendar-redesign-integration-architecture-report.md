# Integration & Architecture Review — Calendar Redesign

## Inspection Inventory
- Target spec inspected: [2026-04-17-calendar-redesign-design.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:34).
- Repo Reality Map was not present at `tasks/codex-qa-review/2026-04-17-calendar-redesign-repo-reality-mapper-report.md`.
- Existing generic calendar is [Calendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/Calendar.tsx:48), with `EventCalendar` exported at [Calendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/Calendar.tsx:685).
- Only current `EventCalendar` importers are [EventCalendarView.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/EventCalendarView.tsx:12) and [UpcomingScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx:7).
- Current generic calendar matches the spec’s pain points: month view caps visible entries at three at [Calendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/Calendar.tsx:397), week view renders 24 hours at [Calendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/Calendar.tsx:437), and day view is still exposed at [Calendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/Calendar.tsx:517).

## Component Placement
`src/components/calendar/` has no hard conflict because the directory does not exist today. It is a soft naming conflict: the repo already has `src/components/ui-v2/display/Calendar.tsx`, while top-level component folders are either domain folders like `events` / `private-bookings` or shared systems like `ui` / `ui-v2`.

Do not put this in `ui-v2/display`. The proposed component is not generic display UI; it has schedule semantics, entry kinds, business subtitles, notes, dashboard parking, and list-row actions. Keeping `ui-v2/display/Calendar.tsx` unchanged is the right boundary.

I would rename or relocate the new module to avoid a second generic “calendar” namespace. Recommended shape:

- `src/components/schedule-calendar/ScheduleCalendar.tsx`
- `src/components/schedule-calendar/types.ts`
- `src/components/schedule-calendar/adapters/...`

`AnchorCalendar` is acceptable but weaker. Because the product is already “Anchor Management Tools,” `AnchorCalendar` reads like branding rather than intent. `ScheduleCalendar` or `OperationsCalendar` better distinguishes it from date-picker/calendar UI.

## Boundary & Ownership
The page → adapter wrapper → reusable calendar layering is directionally right, but the spec currently blurs the boundary.

The existing wrappers already own modal, toast, tooltip, navigation, and source-specific lookup logic. `EventCalendarView` imports tooltip/modal/form/toast dependencies and the note action at [EventCalendarView.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/EventCalendarView.tsx:12), owns note creation and refresh at [EventCalendarView.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/EventCalendarView.tsx:301), and passes tooltip/click behavior into `EventCalendar` at [EventCalendarView.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/EventCalendarView.tsx:425). Dashboard does the same kind of adaptation and interaction work at [UpcomingScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx:209) and [UpcomingScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx:425).

`tooltipBody: ReactNode` should not be part of the adapter output. It makes “pure adapters” JSX-aware and couples source conversion to React rendering. Prefer one of these:

- `tooltipData` as a discriminated structure, rendered by `ScheduleCalendar`.
- `renderTooltip(entry)` prop owned by each wrapper.
- `source` metadata on `CalendarEntry`, with wrapper-owned renderers keyed by `entry.kind`.

Avoid putting source-specific runtime imports into shared adapters. `EventOverview` lives in [get-events-command-center.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/get-events-command-center.ts:6), while dashboard schedule types are local to [UpcomingScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx:17). Shared adapters should either use structural input types, type-only imports, or stay beside each caller to avoid app/client/server coupling.

## State Ownership
The spec needs correction here. Current event command-center state is not “month/week/list”; `CommandCenterShell` owns page mode as `calendar | grid | list` at [CommandCenterShell.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/CommandCenterShell.tsx:24), and `ControlBar` defines those modes at [ControlBar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/ControlBar.tsx:14). The current `list` mode renders legacy `EventList`, not a calendar list view.

Recommendation: make the new calendar view mode controlled:

```ts
type ScheduleCalendarView = 'month' | 'week' | 'list'

<ScheduleCalendar
  view={calendarView}
  onViewChange={setCalendarView}
/>
```

For `/events`, the shell or wrapper should own that state if the existing top control bar remains. For `/dashboard`, local state inside `UpcomingScheduleCalendar` is fine because there is no equivalent dashboard shell. URL-persisted calendar view state does not exist today; `/events/page.tsx` accepts no `searchParams` at [page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/page.tsx:18).

For anchored list scrolling, the component should own a bounded scroll container or accept an explicit `scrollRootRef`. Plain `scrollIntoView()` is brittle if the page shell owns `overflow-y-auto`; the “Today” button visibility should observe the same scroll root it scrolls.

## Data Flow
`bookingsCount` is under-specified. Existing event detail distinguishes booking row count from booked seats: active booking rows at [EventDetailClient.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/[id]/EventDetailClient.tsx:323), confirmed seats at [EventDetailClient.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/[id]/EventDetailClient.tsx:328), and non-cancelled seats at [EventDetailClient.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/[id]/EventDetailClient.tsx:336). If the UI says “22 booked,” it probably wants seats, not booking rows. Rename to `bookedSeatsCount` or define `bookingsCount` explicitly.

The spec says aggregate “within the same date window,” but `getEventsCommandCenterData` currently pages through all events at [get-events-command-center.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/get-events-command-center.ts:101), maps all events at [get-events-command-center.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/get-events-command-center.ts:222), and splits past/upcoming in memory at [get-events-command-center.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/get-events-command-center.ts:292). Use one bulk grouped query/RPC over returned event IDs, not per-row queries.

Dashboard also needs data changes. The spec adds `bookingsCount` only to `EventOverview`, but dashboard uses `EventSummary` at [dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:10). Dashboard private bookings also lack the full fields needed by the shared private-booking adapter at [dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:65), while the events calendar shape has richer fields at [get-events-command-center.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/get-events-command-center.ts:46).

Refresh flow is mostly present for events and notes, but booking-count subtitles create a new invalidation requirement. Event create/update/delete revalidate dashboard at [events.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/events.ts:258), but event booking mutations revalidate `/events` and detail/table paths without `revalidateTag('dashboard')` at [events.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/events.ts:796), [events.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/events.ts:1109), and [events.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/events.ts:1441). Add dashboard invalidation if dashboard event cards show booking counts.

## Migration Path
Both callers can be migrated atomically in one PR because only two files import `EventCalendar`. A staged path is still safer for review:

1. Add `ScheduleCalendar` and tests.
2. Migrate `/events`.
3. Migrate `/dashboard`.
4. Remove or deprecate `EventCalendar` after a final grep and build.

There is no strong need to keep a compatibility layer for weeks unless this repo has long-lived feature branches importing `EventCalendar`. Deleting it immediately is safe only after confirming no imports from the direct file or the `ui-v2` barrel export at [index.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/index.ts:40). Leaving the wrapper in place as deprecated is low-risk cleanup deferral.

## Future Evolution
The architecture can support a fourth kind like rota shifts if `CalendarEntry.kind` is paired with a kind registry for labels, colors, subtitle policy, and list accessories. As written, the union plus hard-coded legend/list columns means every new kind requires edits to the shared component.

Keep the reusable component focused on schedule layout mechanics: month grid, week positioning, anchored list, overlap layout, mobile fallback. Keep page-specific actions, tooltip richness, creation modals, permissions, and special list columns in wrappers/render props. That preserves the reuse benefit without turning the component into a dashboard/events mega-component.

## Findings Summary
| ID | Severity | Area | Finding | Recommendation |
|---|---|---|---|---|
| ARCH-01 | Medium | Component Placement | `src/components/calendar/` creates a second generic calendar namespace beside `ui-v2/display/Calendar`. | Use `src/components/schedule-calendar/` and `ScheduleCalendar` / `OperationsCalendar`. |
| ARCH-02 | High | State Ownership | Spec’s Month/Week/List model conflicts with existing `calendar/grid/list` shell state. | Make schedule view controlled; map or replace the current `ControlBar` list behavior deliberately. |
| ARCH-03 | High | Boundary | `tooltipBody: ReactNode` couples adapter data to JSX and duplicates wrapper/component ownership. | Use `tooltipData` or wrapper-owned `renderTooltip(entry)`. |
| ARCH-04 | Medium | Boundary | Shared adapters risk importing app/server or local dashboard types into shared client code. | Use structural adapter inputs, type-only imports, or caller-local adapters. |
| ARCH-05 | High | Data Flow | Dashboard data shapes cannot produce the proposed subtitles consistently. | Extend `EventSummary` and dashboard private-booking fields before sharing adapters. |
| ARCH-06 | Medium | Data Flow | `bookingsCount` semantics and aggregation window are unclear. | Define row count vs seats; use one grouped query/RPC over returned event IDs. |
| ARCH-07 | Medium | Data Flow | Dashboard cache will stale if booking-count subtitles depend on event booking mutations. | Add `revalidateTag('dashboard')` where event bookings create/update/cancel. |
| ARCH-08 | Medium | State Ownership | Anchored list scroll root is unspecified. | Let the component own the scroll container or accept an explicit `scrollRootRef`. |
| ARCH-09 | Low | Migration | Immediate `EventCalendar` deletion is safe only after final grep, but optional. | Prefer deprecating or deleting in the cleanup step after both callers migrate and build passes. |