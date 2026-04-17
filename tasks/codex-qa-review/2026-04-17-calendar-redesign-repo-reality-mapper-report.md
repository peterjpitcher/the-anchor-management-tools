# Repo Reality Map — Calendar Redesign

## Inspection Inventory

### Inspected
- Design spec: `docs/superpowers/specs/2026-04-17-calendar-redesign-design.md`.
- Current generic calendar: [Calendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/Calendar.tsx:48).
- Schedule callers: [EventCalendarView.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/EventCalendarView.tsx:195), [UpcomingScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx:158).
- Events shell/control state: [CommandCenterShell.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/CommandCenterShell.tsx:23), [ControlBar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/ControlBar.tsx:14).
- Data loaders: [get-events-command-center.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/get-events-command-center.ts:96), [dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:284), [dashboard/page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/page.tsx:116).
- Private booking calendar loader: [queries.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/private-bookings/queries.ts:254).
- Calendar note action/permission path: [calendar-notes.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/calendar-notes.ts:266).
- Tests/config: [Calendar.test.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tests/components/Calendar.test.tsx:1), [vitest.config.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/vitest.config.ts:7), [vitest.setup.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/vitest.setup.ts:1).
- Repo/project conventions: [CLAUDE.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/CLAUDE.md:1), plus parent workspace rules found by subagent.

### Not Inspected
- Live Supabase database state; schema/RLS conclusions are from local migrations and generated types.
- Browser rendering of `/events` or `/dashboard`; this is a static repo map.
- Full migration history outside booking/event/RLS/counting lines.

### Limited Visibility Conclusions
- No repo-local `.claude/rules/` directory was found; parent workspace `.claude/rules` exist.
- Generated DB types may lag live DB if migrations were not regenerated, but local generated types confirm the current relation shape.

## Current Calendar Surface

`src/components/ui-v2/display/Calendar.tsx` exports:
- `CalendarEvent`: `id`, `title`, `start`, `end`, optional `allDay`, `showOnStartDayOnly`, `color`, `textColor`, `description`, `location`, `attendees`, `recurring`, `editable`, `deletable` at [Calendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/Calendar.tsx:48).
- `CalendarProps`: date value/change, `events`, `view: 'month' | 'week' | 'day'`, `onViewChange`, week start, min/max/disabled dates, selectable/event click/date click/custom renderer/navigation/today/view selector/height/locale at [Calendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/Calendar.tsx:65).
- `Calendar`: stateful component with internal `currentDate`, default `view="month"`, default `firstDayOfWeek=0`, default `locale="en-US"` at [Calendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/Calendar.tsx:187).
- `MiniCalendar`: wraps `Calendar` in month view, no Today button, no view selector, `max-w-sm` at [Calendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/Calendar.tsx:660).
- `EventCalendar`: wraps `Calendar` with `selectable={false}` and `showEventTime={true}` at [Calendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/Calendar.tsx:685).
- `ui-v2/index.ts` re-exports `Calendar`, `MiniCalendar`, `EventCalendar` at [index.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/index.ts:40).

Calendar behavior:
- Month day inclusion: all-day entries render on every inclusive day from start to end; `showOnStartDayOnly` renders only on start day; timed entries use half-open `[start, end)` day overlap logic at [Calendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/Calendar.tsx:248).
- Month view is fixed 7-column grid, `min-h-[100px]`, displays only first 3 events per day, truncates event text, then shows `+N more` at [Calendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/Calendar.tsx:342).
- Week view is fixed 24-hour grid, `min-w-[700px]`, hour rows `min-h-[60px]`; entries are shown only in the hour matching `event.start.getHours()` and are absolutely positioned by minutes/duration at [Calendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/Calendar.tsx:437).
- Day view is also a 24-hour list and can show `location` / `attendees` if present at [Calendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/Calendar.tsx:517).
- Navigation exposes prev/next/today, a label, and a select with Month/Week/Day options at [Calendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/Calendar.tsx:598).

Callers found:
- `EventCalendar`: events command centre only at [EventCalendarView.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/EventCalendarView.tsx:419), dashboard only at [UpcomingScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx:425).
- `Calendar`: direct test caller only at [Calendar.test.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tests/components/Calendar.test.tsx:3). Other `<Calendar />` matches in app code are icon components, not this calendar.
- `MiniCalendar`: no external callers found; only its internal definition/wrapper.

Current events wrapper:
- `EventCalendarView` accepts `events`, optional `privateBookings`, optional `calendarNotes`, optional `canCreateCalendarNote` at [EventCalendarView.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/EventCalendarView.tsx:195).
- It locally parses ISO date/time strings into local `Date` objects, with events defaulting to 2-hour duration at [EventCalendarView.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/EventCalendarView.tsx:80).
- Private bookings use `pb:` ids, `event_date/start_time`, `end_time`, `end_time_next_day`, `showOnStartDayOnly`, and status-based violet/red/indigo colors at [EventCalendarView.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/EventCalendarView.tsx:99).
- Calendar notes use `note:` ids, `allDay: true`, `note_date/end_date`, and normalized note color at [EventCalendarView.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/EventCalendarView.tsx:268).
- It renders a small legend only when private bookings or notes exist at [EventCalendarView.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/EventCalendarView.tsx:330).
- Add-note modal is opened via `onDateClick` only when `canCreateCalendarNote` is true; submit calls `createCalendarNote`, toasts, closes, and `router.refresh()` at [EventCalendarView.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/EventCalendarView.tsx:291).
- `renderEvent` gives notes a tooltip with title/date/notes/source, private bookings a tooltip with customer/type/guest count/when, and plain events only a truncated title at [EventCalendarView.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/EventCalendarView.tsx:425).
- Click routing: notes do nothing; private bookings go to `/private-bookings/:id`; events go to `/events/:id` at [EventCalendarView.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/EventCalendarView.tsx:502).

Current dashboard wrapper:
- `UpcomingScheduleCalendar` defines local dashboard-only summary types for events, notes, private bookings, and parking at [UpcomingScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx:17).
- Dashboard events get `evt:` ids, blue color, all-day when `time` is missing, and 2-hour duration otherwise at [UpcomingScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx:212).
- Dashboard private bookings get `pb:` ids, all-day when no `start_time`, 3-hour duration otherwise, and status appended into the title unless confirmed at [UpcomingScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx:231).
- Notes get `note:` ids and `allDay: true` at [UpcomingScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx:253).
- Parking gets `park:` ids, title from vehicle registration/reference, grey/amber color, and `start_at/end_at` Dates at [UpcomingScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx:272).
- It always renders a legend for Events, Calendar notes, Private bookings, Parking, plus hidden-date count at [UpcomingScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx:405).
- Tooltips cover all four kinds; private booking tooltip has deposit/hold/balance/days fields; parking tooltip has customer/payment at [UpcomingScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx:445).
- Click routing: notes do nothing; events/private bookings route to detail; parking routes to `/parking`, not `/parking/:id` at [UpcomingScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx:535).

## Data Contracts

`EventOverview` currently has no `bookingsCount`. Fields are `id`, `name`, `date`, `time`, `daysUntil`, `category`, image URLs, `eventStatus`, `bookingUrl`, `checklist`, `statusBadge` at [get-events-command-center.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/get-events-command-center.ts:6).

`PrivateBookingCalendarOverview` fields are `id`, `customer_name`, `event_date`, `start_time`, `end_time`, `end_time_next_day`, `status`, `event_type`, `guest_count` at [get-events-command-center.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/get-events-command-center.ts:46).

`CalendarNoteCalendarOverview` fields are `id`, `note_date`, `end_date`, `title`, `notes`, `source`, `start_time`, `end_time`, `color` at [get-events-command-center.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/get-events-command-center.ts:58).

Dashboard calendar input contracts:
- Event summary: `id`, `name`, `date`, `time` in the client wrapper at [UpcomingScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx:17); loader type also includes `capacity`, `price` at [dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:10).
- Dashboard private booking summary: wrapper uses `id`, `customer_name`, `event_date`, `start_time`, `status`, `hold_expiry`, `deposit_status`, `balance_due_date`, `days_until_event` at [UpcomingScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx:36).
- Dashboard parking booking summary: `id`, `reference`, customer names, `vehicle_registration`, `start_at`, `end_at`, `status`, `payment_status` at [UpcomingScheduleCalendar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx:48) and [dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:85).

Population:
- `getEventsCommandCenterData()` uses `createAdminClient`, fetches all events with category, all calendar notes, checklist statuses, maps `EventOverview`, splits `upcoming`/`past`, and returns `privateBookingsForCalendar: []` at [get-events-command-center.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/get-events-command-center.ts:96).
- `/events/page.tsx` separately loads private bookings after permission checks using `PrivateBookingService.fetchPrivateBookingsForCalendar()`, filters cancelled and date-TBD internal notes, then maps to `PrivateBookingCalendarOverview` at [page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/page.tsx:36).
- `fetchPrivateBookingsForCalendar()` uses the user Supabase client, not admin, queries `private_bookings_with_details`, filters `event_date >= today`, and returns all upcoming rows ordered by date/time at [queries.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/private-bookings/queries.ts:254).
- Dashboard loader uses admin client after resolving the authenticated user and permission map at [dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:284).
- Dashboard events: upcoming from today, range `0..24`; past from last 90 days, range `0..24`, reversed to chronological at [dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:606).
- Dashboard notes: lookback 90 days, horizon 180 days, range `0..999` at [dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:680).
- Dashboard private bookings: `PrivateBookingService.getBookings({ fromDate: todayIso, limit: 20, useAdmin: true })`, then only `draft` or `confirmed` at [dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:762).
- Dashboard parking: `parking_bookings` where `start_at >= todayIso`, status `pending_payment`/`confirmed`, range `0..19` at [dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:799).
- Dashboard page passes `past + today + upcoming` events, all calendar notes, permitted private bookings, and permitted parking bookings into `UpcomingScheduleCalendar` at [dashboard/page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/page.tsx:116).

Auth/RLS/permissions:
- Authenticated route group enforces auth in layout at [layout.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/layout.tsx:9).
- `/events` requires `events:view`; private bookings load only with `private_bookings:view` or `private_bookings:manage`; note creation prop is `settings:manage`; event create/manage actions use `events:manage` at [events/page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/page.tsx:18).
- Dashboard builds a permission map from `get_user_permissions`; each snapshot has a `permitted` flag; calendar notes are visible if events or settings access exists at [dashboard-data.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/dashboard/dashboard-data.ts:306).
- `createCalendarNote` independently requires `settings:manage`, validates with Zod, uses admin insert, revalidates `/events` and dashboard tag at [calendar-notes.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/calendar-notes.ts:319).

## Bookings Count Plumbing

- Event bookings live in `public.bookings`; core columns include `id`, `customer_id`, `event_id`, `seats`, `created_at`, `notes` in `supabase/migrations/20251123120000_squashed.sql:1860`.
- Parent table is `public.events` in `supabase/migrations/20251123120000_squashed.sql:2523`.
- FK is `bookings.event_id -> events.id ON DELETE CASCADE` in `supabase/migrations/20251123120000_squashed.sql:4455`.
- Indexes exist on `bookings.event_id`, including a count-oriented `INCLUDE (id)` index in `supabase/migrations/20251123120000_squashed.sql:3914`, `:3922`, `:3926`.
- Booking statuses were added later; current active counting commonly uses `status IN ('confirmed', 'pending_payment')`, with status values extended in `supabase/migrations/20260420000009_event_review_lifecycle.sql:12`.
- Existing one-event count: `EventService.deleteEvent` counts active bookings with `count: 'exact', head: true`, `.eq('event_id', id)`, `.in('status', ['confirmed', 'pending_payment'])` at [events.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/events.ts:584).
- Edit event page does the same active count and passes `activeBookingCount` to the edit client at [edit/page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/[id]/edit/page.tsx:28).
- Event detail page fetches all `bookings` by `event_id`; client derives `activeBookings` by excluding `cancelled` and `expired`, and separately sums confirmed seats at [events/[id]/page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/[id]/page.tsx:87) and [EventDetailClient.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/[id]/EventDetailClient.tsx:323).
- Current events command centre `attention_needed` filter is checklist-only: overdue or due-today checklist counts, not booking counts at [CommandCenterShell.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/CommandCenterShell.tsx:50).
- No reusable grouped `bookings_count` query or embedded `bookings(count)` relation was found on event list queries.
- RLS: local migrations enable RLS on `bookings` and `events`; policies require authenticated module permissions for create/delete/edit/view. `getEventsCommandCenterData()` uses service-role admin, so a bookings count added there would bypass RLS after the page-level `events:view` gate.

## Anchored Scroll / List Patterns

- Page-level anchor pattern exists via skip link to `#main-content` in [PageLayout.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/layout/PageLayout.tsx:203).
- Header nav tracks `window.location.hash` and hashchange for active anchor nav in [HeaderNav.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/navigation/HeaderNav.tsx:36).
- `TabNav` keeps refs and calls `scrollIntoView` for active horizontal tabs at [TabNav.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/navigation/TabNav.tsx:127).
- Sticky table header pattern exists in `DataTable` with `sticky top-0 z-10` at [DataTable.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/DataTable.tsx:544).
- App shell has a scrolling main context in `AuthenticatedLayout` at `src/app/(authenticated)/AuthenticatedLayout.tsx:251`; sticky/calendar behavior needs to account for that scroll container.
- `VirtualList` exists and supports `onEndReached`, visible range calculation, and imperative scroll, but assumes fixed `itemHeight` and fixed container `height` at `src/components/ui-v2/display/VirtualList.tsx:13`.
- No app consumers of `VirtualList`/`VirtualGrid` were found; exported at [index.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/index.ts:41).
- Existing list convention is pagination rather than infinite scroll; `usePagination` applies Supabase `.range()`.

## ControlBar & Filter State

- `ControlBar` types: `ViewMode = 'calendar' | 'grid' | 'list'`; `FilterType = 'all' | 'attention_needed'`; props are controlled search/view/filter plus optional export action at [ControlBar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/ControlBar.tsx:14).
- Desktop filter buttons are All / Attention Needed; mobile repeats them as horizontal pills at [ControlBar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/ControlBar.tsx:54) and [ControlBar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/ControlBar.tsx:119).
- View toggle is icon buttons for calendar/grid/list at [ControlBar.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/ControlBar.tsx:84).
- `CommandCenterShell` owns `viewMode`, `filter`, `searchQuery`, sidebar/export modal state at [CommandCenterShell.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/CommandCenterShell.tsx:23).
- Event search filters event name and category only; `attention_needed` filters events with checklist overdue/due-today only at [CommandCenterShell.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/CommandCenterShell.tsx:36).
- Calendar notes are filtered only by search text/date, not by `attention_needed` at [CommandCenterShell.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/CommandCenterShell.tsx:61).
- Calendar view receives `filteredAllEvents`, unfiltered `initialData.privateBookingsForCalendar`, filtered notes, and note permission; grid/list receive only filtered events at [CommandCenterShell.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/CommandCenterShell.tsx:92).

## Test Patterns

- Vitest uses `jsdom`, globals, setup file, and `@` alias at [vitest.config.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/vitest.config.ts:7).
- Setup imports `@testing-library/jest-dom` and globally mocks `next/navigation` `useRouter` with `push/replace/refresh/prefetch` fns at [vitest.setup.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/vitest.setup.ts:1).
- Existing calendar tests are RTL render/assert tests against `Calendar`, covering midnight boundary and `showOnStartDayOnly` at [Calendar.test.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tests/components/Calendar.test.tsx:5).
- Component tests in repo commonly mock actions/toasts and use `fireEvent`/`waitFor`; geometry tests stub `getBoundingClientRect`.
- No existing component tests were found for `EventCalendarView`, `UpcomingScheduleCalendar`, `DataTable` mobile breakpoints, or `VirtualList`.

## Mobile Breakpoints

- Tailwind config does not override screens, so default `sm = 640px` applies.
- Shared media hook convention maps mobile to `<640px`, tablet to `640-1023px`, desktop to `>=1024px` in `src/hooks/use-media-query.ts:42`.
- Existing private-bookings calendar uses `<640px` for `isMobile`, shows a mobile calendar/agenda toggle, caps day entries, and uses an agenda fallback in `src/components/private-bookings/CalendarView.tsx:45`.
- `DataTable` is an exception: JS mobile breakpoint defaults to `768` and renders mobile cards below it in `src/components/ui-v2/display/DataTable.tsx:188`.
- Current generic `Calendar` has no mobile fallback; month remains 7 columns and week uses `min-w-[700px]`.

## Conventions To Preserve

- Project stack and workflow: Next.js 15 App Router, React 19, Supabase/RLS, Tailwind v4, Vitest in [CLAUDE.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/CLAUDE.md:1).
- Auth is enforced in `(authenticated)/layout.tsx`; middleware is disabled per [CLAUDE.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/CLAUDE.md:70).
- Supabase clients: server client for user-context reads/actions, admin client for service-role/system operations at [CLAUDE.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/CLAUDE.md:78).
- RBAC helper convention is `checkUserPermission(module, action, userId?)` at [rbac.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/rbac.ts:64).
- Date utilities should use London-aware helpers in [dateUtils.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/dateUtils.ts:1): `getTodayIsoDate`, `toLocalIsoDate`, `formatDateInLondon`, `formatTime12Hour`, etc.
- Server actions should validate and gate permissions; `createCalendarNote` is the relevant pattern with Zod + `settings:manage` + admin insert + revalidation at [calendar-notes.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/calendar-notes.ts:319).
- UI convention is `ui-v2` / `PageLayout` for new pages/components at [CLAUDE.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/CLAUDE.md:95).
- Workspace rules found by subagent: DB columns snake_case, TS types camelCase, explicit row mappers preferred; no generic conversion helper was found in this repo.

## Key Risks Visible To Me (Factual, Not Critique)

- The spec says search filters private bookings “as today”, but current `/events` search does not filter private bookings; calendar view passes `initialData.privateBookingsForCalendar` unfiltered at [CommandCenterShell.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/events/command-center/CommandCenterShell.tsx:94).
- The spec describes dashboard as a “30-day past + future window currently loaded there”; actual dashboard windows differ: events load 90-day past plus 25 upcoming rows, notes load 90 days back/180 ahead, private bookings and parking load only upcoming rows from today and are limited to 20.
- `getEventsCommandCenterData()` currently uses admin and returns `privateBookingsForCalendar: []`; `/events/page.tsx` fills private bookings separately with a user-context service call.
- `EventOverview` lacks `bookingsCount`; dashboard event summary also lacks it.
- Current `EventCalendar` has no list view and no mobile fallback; the command centre list view is a separate `EventList` table, not part of the calendar component.
- Existing event counts use “active bookings” as `confirmed` + `pending_payment` in several places, while event detail derives active by excluding `cancelled`/`expired`; the intended semantics for a calendar “booked” count need to pick one existing convention.