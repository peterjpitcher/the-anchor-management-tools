# Calendar Redesign — Design Spec

**Date:** 2026-04-17
**Status:** Ready for planning
**Scope:** `/events` command centre + `/dashboard` upcoming schedule

## Problem

The current calendar on the events page (also reused on the dashboard) fails its primary job. The operator's two most common questions — *"what's coming up?"* and *"is this date free for an incoming booking request?"* — cannot be answered quickly because:

- **Month view:** cells are cramped. Event titles get cut to just `...` on busy days (visible on 25 and 26 April in current production). Guest count and bookings count are not shown at all.
- **Week view:** renders a full 24-hour timeline. For a pub that mostly operates from 12:00 onwards, the majority of the grid is empty whitespace. Hard to use and requires scrolling.
- **Day view:** exists but is not needed.
- **List view:** shows past and future events interleaved with no visual separation and no anchor on "today". The page opens on historic events the operator no longer cares about.
- **Overall:** the page feels long and low-density.

## Goals

1. Make "is this date taken?" answerable in one glance in month view — including on busy wedding days — without clicking through.
2. Make the week view usable: collapse to operating hours, auto-extend when entries fall outside.
3. Make the list view open on today, with past accessible by scrolling up.
4. Do this in one new component reused on both the events page and the dashboard, with no regressions on the 10+ other pages that consume the generic `ui-v2/display/Calendar` (date pickers, etc.).

## Non-goals

- No drag-to-reschedule, drag-to-create, keyboard shortcuts for navigation.
- No changes to the KPI header or right-hand task sidebar on the events page — scope is limited to the three calendar views.
- No new data API endpoints — we reuse the existing `getEventsCommandCenterData` and `loadDashboardSnapshot` data loads.
- No changes to the generic `ui-v2/display/Calendar` used by date-picker-style consumers.

## Architecture

**New files**
- `src/components/calendar/AnchorCalendar.tsx` — the new component. Renders Month, Week, and List views. Handles view switcher, navigation controls, legend, mobile fallback.
- `src/components/calendar/types.ts` — `CalendarEntry` type plus `CalendarEntryKind` union.
- `src/components/calendar/adapters.ts` — pure functions that map each source shape into `CalendarEntry`.

**Changed files**
- `src/components/events/command-center/EventCalendarView.tsx` — becomes a thin adapter. Converts events, private bookings, and calendar notes into `CalendarEntry[]` using the adapters, then renders `AnchorCalendar`. Retains the existing "add calendar note" modal and tooltip content builders.
- `src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx` — same pattern, but also converts parking bookings.
- `src/app/(authenticated)/events/get-events-command-center.ts` — add `bookingsCount: number` to `EventOverview`, populated from the bookings table for each event in the returned window. Required so `eventToEntry` can produce the "22 booked" subtitle.

**Left alone**
- `src/components/ui-v2/display/Calendar.tsx` — unchanged. Used for date pickers and other non-schedule contexts where variable-height rows and guest counts are not meaningful. The unused `EventCalendar` re-export can be deleted when the two callers are migrated.

## Data model

```ts
// src/components/calendar/types.ts
export type CalendarEntryKind =
  | 'event'
  | 'private_booking'
  | 'calendar_note'
  | 'parking'

export interface CalendarEntry {
  id: string                    // prefixed: 'evt:', 'pb:', 'note:', 'park:'
  kind: CalendarEntryKind
  title: string                 // full text — never pre-truncated
  start: Date
  end: Date
  allDay: boolean               // true for calendar notes
  spansMultipleDays: boolean    // true for multi-day notes and overnight bookings
  color: string                 // hex — from category (events) or kind default
  subtitle: string | null       // e.g. '22 booked', '40 guests', '5 parking'
  statusLabel: string | null    // 'Draft', 'Cancelled', 'Postponed' — small pill
  tooltipBody: ReactNode        // rich hover content built by the caller
  onClickHref: string | null    // navigation target; null = no click action
}
```

**Adapters** (one per source, pure functions)
- `eventToEntry(event: EventOverview): CalendarEntry` — subtitle `${bookingsCount} booked`; `onClickHref: '/events/:id'`; colour from `category.color` falling back to status tone.
- `privateBookingToEntry(booking: PrivateBookingCalendarOverview): CalendarEntry` — subtitle `${guest_count} guests`; `onClickHref: '/private-bookings/:id'`; colour from status.
- `calendarNoteToEntry(note: CalendarNoteCalendarOverview): CalendarEntry` — `allDay: true`; `spansMultipleDays` if start ≠ end; no `onClickHref`.
- `parkingToEntry(booking: DashboardParkingBookingSummary): CalendarEntry` — subtitle `${count} parking`; `onClickHref: '/parking/:id'` (dashboard only).

## Month view

**Layout**
- 7 columns (Mon–Sun) + day-name header row.
- Rows have **variable height**. Each row's height is the maximum of the content heights of its 7 cells, so the row grows to fit the busiest day. Quiet weeks stay compact.
- Minimum cell height 80px so empty cells are still clickable.

**Each day cell**
- Day number top-left; today shown as a filled green pill.
- Vertical stack of timed entries sorted by `start`.
- Multi-day notes (`allDay: true, spansMultipleDays: true`) render **above** the timed entries as a continuous bar spanning the days they cover, **not repeated in every cell**. Implemented as absolutely-positioned bars on a per-week row.

**Each entry block**
- Line 1: **time** in bold (`HH:mm`), space, **full title** — wraps to a second line if it overflows. Never collapses to `...`.
- Line 2: **subtitle** (`22 booked` / `40 guests` / etc.) in smaller muted text.
- 3px coloured left border keyed by kind (green / purple / sky / teal).
- Draft/cancelled shown as a tiny pill overlayed top-right of the entry.

**Interactions**
- Click entry → navigate to its `onClickHref`.
- Click empty area of a day → open "Add calendar note" modal (only when `canCreateCalendarNote` is true).
- Hover entry → tooltip with `tooltipBody` (existing rich content preserved).

**Navigation controls (above grid)**
- Prev / Today / Next buttons.
- Current month label (e.g. `April 2026`) — clickable, opens a month/year quick-jump popover.
- View switcher: Month / Week / List.

## Week view

**Layout**
- 8-column grid: time gutter (50px) + 7 day columns (Mon–Sun).
- Default hour range: **12:00–23:00** (configurable constant, placed in the component so it can be adjusted without a prop).
- If any entry in the visible week starts before 12:00 or ends after 23:00, the hour range **auto-extends** in whichever direction is needed (capped at 00:00–24:00). The operator never has invisible events off-screen.
- Today's column has a subtle green background tint.

**All-day band (top of grid)**
- A short fixed-height row above the hourly grid. Multi-day notes and any `allDay: true` entries render as bars here, spanning the days they cover. Keeps the hourly grid focused on timed entries.

**Each timed entry block**
- Positioned by `start`, height proportional to duration (`1 hour = 40px`).
- Lines: **time** bold (start–end), **title**, **subtitle**. Colour-by-kind left border.
- If the block is shorter than ~45 minutes and cannot fit all three lines, it collapses to one line (time + title) and reveals the rest on tooltip hover.
- Overlapping entries (same day, overlapping times) render side-by-side at half width (or thirds for 3). Beyond 3 overlaps, subsequent entries collapse into a `+N` pill.

**Navigation**
- Prev week / Today / Next week.
- Header label: `Week of Mon 20 – Sun 26 Apr 2026`.
- View switcher: Month / Week / List.

## List view

**Layout**
- Vertical scrollable timeline, grouped by date.
- Group header per day: "Today" (highlighted), "Tomorrow", then `Fri 24 Apr` / `Sat 25 Apr` etc. Past groups use the same format.
- Groups run chronologically: past above "Today", future below.

**Anchored scroll**
- On mount the scroll position is set so the "Today" group header is at the top of the viewport.
- Implemented by rendering all groups in chronological order, then on first render using `scrollIntoView({ block: 'start' })` on the "Today" header.
- A floating **"Today" button** appears fixed bottom-right when the "Today" header is scrolled out of view. Clicking scrolls it back into position.

**Each row** (same table-style layout as current `EventList`)
- Date column: `Fri 24 Apr` with time below (`20:00`).
- Title column: full title, linked to detail page, with category badge.
- Subtitle column: `22 booked` / `40 guests` / `5 parking`.
- Status column: status pill.
- Checklist column (events only): progress bar / counts.
- Actions column: Edit / Delete for users with permission.

**Past vs future styling**
- Past rows render at 60% opacity to make "you're looking at history" visually obvious. Still clickable.
- Today's group has a coloured background tint on its header.

**Data scope**
- Events page: uses existing `past` and `upcoming` from `getEventsCommandCenterData`.
- Dashboard: uses existing dashboard snapshot data; list view shows the 30-day past + future window currently loaded there (no change to the data layer).
- A future "Load more past" affordance at the top of the scroll is out of scope — current server window is enough for today.

## Cross-view concerns

**Legend strip** (below view switcher, always visible)
- Small coloured squares with labels: Events, Private bookings, Calendar notes, and Parking on the dashboard.
- Draft/cancelled explained once as a pill sample.

**Filters and search**
- Existing `ControlBar` (search box + "All / Attention needed" toggle + view switcher) stays above the calendar and applies in all three views.
- Search filters by entry title; for private bookings it also matches customer name (as today).

**Permissions**
- `canCreateCalendarNote` gates the "click empty day to add note" interaction in month/week.
- Entry click navigation respects permission at the destination page — no changes needed here.

**Loading / error / empty states**
- **Loading:** skeleton grid for month/week and skeleton rows for list while the server component renders. The existing layout error prop continues to handle server errors.
- **Error:** inline banner with retry, from `PageLayout`'s existing `error` prop.
- **Empty:** "No entries in this window. Try changing filters or create a new event." with a primary action button where applicable.

**Mobile (< 640px)**
- Month and Week views automatically fall back to List view. The switcher still lets the operator manually force month/week if needed, but List is the default on small screens because a 7-column grid is unusable at that width.

## Testing

**Vitest — unit**
- One file per adapter in `adapters.ts`. Assert output shape for each input variant (status values, multi-day ranges, missing optional fields).
- One file for the hour-range auto-extend logic in week view (pure function).

**Vitest — component**
- `AnchorCalendar.month.test.tsx` — fixture of events + bookings + notes + multi-day note. Assert: full titles visible, multi-day note renders as a single bar spanning the right number of cells, today pill is present, row heights match the busiest cell.
- `AnchorCalendar.week.test.tsx` — fixture with entries at 10:00 and 21:00. Assert: grid auto-extends to cover 10:00; entries positioned correctly; overlapping entries at Sat 14:00 render side-by-side.
- `AnchorCalendar.list.test.tsx` — fixture with past and future entries. Assert: rendered in chronological order; on mount, "Today" group is the top-most visible group (scrollIntoView called with `block: 'start'`); past rows have reduced opacity class.

**Playwright (existing smoke test)**
- No new E2E tests for this iteration. The existing events-page smoke test must still pass after migration.

## Risks and mitigations

- **Shared component regression:** the `Calendar` re-export `EventCalendar` is currently used by two callers. After migrating both to `AnchorCalendar`, we delete the `EventCalendar` re-export. Grep confirms no other callers before deletion.
- **Variable-height rows visual shift:** the month view page can grow on busy months. Acceptable — the operator explicitly chose this in discovery to guarantee "is this date taken?" is answerable without clicking.
- **Hour-range auto-extend in week view:** naive implementation could include outliers that push the grid to 00:00–24:00. We cap the extension to actual entries in the visible week; no speculative extension.
- **`bookingsCount` on `EventOverview`:** requires a new aggregation. Query is `bookings` grouped by `event_id` within the same date window already being fetched. Add a single extra query or lateral join. No new RLS considerations — same service-role path.
- **Dashboard parking integration:** dashboard calendar currently shows parking bookings with their own renderer; new adapter pattern must preserve the existing colour and tooltip content.

## Rollout

Single PR. Complexity score: **L (4)** — new component, two call-site migrations, one data-model addition, unit + component tests.

Verification:
1. `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` all pass.
2. Manual smoke on `/events` and `/dashboard` covering all three views at desktop width and mobile width.
3. Confirm no other importers of `ui-v2/display/Calendar` were affected.
4. Visual regression on the three changed views (month with busy day, week with early-morning entry, list with today + past + future).

## Open questions for planning

None — design is complete. Implementation plan should decompose into:
1. Types + adapters + tests.
2. `AnchorCalendar` month view.
3. `AnchorCalendar` week view.
4. `AnchorCalendar` list view with anchored scroll.
5. Migrate `EventCalendarView`.
6. Add `bookingsCount` to `EventOverview` and plumb through adapter.
7. Migrate `UpcomingScheduleCalendar` (with parking adapter).
8. Delete unused `EventCalendar` re-export; verification pass.
