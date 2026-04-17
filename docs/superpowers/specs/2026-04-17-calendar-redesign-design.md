# Calendar Redesign — Design Spec

**Date:** 2026-04-17 (revised after codex adversarial review)
**Status:** Ready for planning
**Scope:** `/events` command centre + `/dashboard` upcoming schedule

## Problem

The current calendar on the events page (also reused on the dashboard) fails its primary job. The operator's two most common questions — *"what's coming up?"* and *"is this date free for an incoming booking request?"* — cannot be answered quickly because:

- **Month view:** cells are cramped. Event titles get cut to just `...` on busy days (visible on 25 and 26 April in current production). Guest count and booked-seats count are not shown at all.
- **Week view:** renders a full 24-hour timeline. For a pub that mostly operates from 12:00 onwards, the majority of the grid is empty whitespace. Hard to use.
- **Day view:** exists but is not needed.
- **List view:** shows past and future events interleaved with no visual separation and no anchor on "today". The page opens on historic events.
- **Overall:** the page feels long and low-density.

## Goals

1. Make "is this date taken?" answerable in one glance in month view — including on busy wedding days — without clicking through.
2. Make the week view usable: collapse to operating hours, auto-extend when entries fall outside.
3. Make the list view open on today, with past accessible by scrolling up.
4. Do this in one new component reused on both the events page and the dashboard, with no regressions on the 10+ other pages that consume the generic `ui-v2/display/Calendar` (date pickers, etc.).

## Non-goals

- No drag-to-reschedule, drag-to-create, keyboard shortcuts for navigation.
- No changes to the KPI header or right-hand task sidebar on the events page — scope is limited to the three calendar views.
- No changes to the generic `ui-v2/display/Calendar` used by date-picker-style consumers.

## Resolved decisions (from discovery + adversarial review)

| # | Decision | Source |
|---|----------|--------|
| D1 | View switcher: Month / Week / List only. Day view removed. | User (discovery Q3). |
| D2 | Month view = variable-height rows; all entries visible; full name + subtitle never truncated to `...`. | User (discovery Q5). |
| D3 | Week view = condensed hourly grid 12:00–23:00, auto-extending (see W1 below). | User (discovery Q4). |
| D4 | List view = today-anchored; scroll up = past, down = future. | User (discovery Q7). |
| D5 | Component is new, replaces `EventCalendar` on `/events` and `/dashboard`. Generic `Calendar` stays untouched. | User. |
| D6 | Dashboard gets all three views (Month / Week / List). | User. |
| D7 | Delete `EventList.tsx` and `EventGrid.tsx` — their content is absorbed by the new `ScheduleCalendar`'s List/Month views. (Confirmed only `CommandCenterShell.tsx` imports them.) | User. |
| D8 | "Booked" subtitle = sum of `seats` across bookings where `status = 'confirmed'`. Matches the existing convention in `EventDetailClient.tsx:331`. Excludes `cancelled`, `expired`, `pending_payment`. | User. |
| D9 | Event week-view duration = fixed 2h block. No new event schema field. | User. |
| D10 | Search box filters private bookings too (new small feature — currently events-only). | User. |
| D11 | Overnight private bookings render on the **start day only** with a `+1 day` indicator. Matches existing behaviour. | User. |
| D12 | Availability statuses: `scheduled`, `draft`, `confirmed`, `sold_out` → rendered normally. `cancelled` → muted + strikethrough. `postponed`, `rescheduled` → rendered with status pill but visually de-emphasised (date is effectively free). Operator sees all but the visual language communicates availability. | User (Q7) + defensible default for postponed/rescheduled/sold_out. |
| D13 | Dashboard List view needs past scroll → dashboard loaders extended to also load past private bookings and parking. | User. |
| D14 | Component name = `ScheduleCalendar`. Folder = `src/components/schedule-calendar/`. | Adversarial review ARCH-01/02. |
| D15 | Ship in three PRs (data contracts, UI + `/events`, dashboard migration). | Adversarial review. |

## Architecture

**New files** (in `src/components/schedule-calendar/`)
- `ScheduleCalendar.tsx` — the component. Renders Month/Week/List. Owns view-mode state (controlled via props), navigation controls, mobile fallback.
- `ScheduleCalendarMonth.tsx` — month-view implementation.
- `ScheduleCalendarWeek.tsx` — week-view implementation.
- `ScheduleCalendarList.tsx` — list-view implementation.
- `types.ts` — `CalendarEntry` + `CalendarEntryKind` + `TooltipData` discriminated union.
- `adapters.ts` — pure data transforms: `eventToEntry`, `privateBookingToEntry`, `calendarNoteToEntry`, `parkingToEntry`. Each returns `CalendarEntry` with `tooltipData` (never JSX).
- `sort.ts` — exported `compareEntries` function implementing the deterministic tie-break.
- `hour-range.ts` — exported `computeWeekHourRange(entries, baseline={start:12, end:23})` that auto-extends while excluding `allDay` entries.

**Changed files**
- `src/components/events/command-center/EventCalendarView.tsx` — becomes a thin adapter. Builds `CalendarEntry[]` from events, private bookings, and calendar notes, plus the tooltip-rendering callback. Retains the "add calendar note" modal.
- `src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx` — same pattern, plus parking.
- `src/components/events/command-center/CommandCenterShell.tsx` — removes the outer `calendar/grid/list` switcher; view state is now just `month/week/list` and lives here, passed into `ScheduleCalendar`.
- `src/components/events/command-center/ControlBar.tsx` — `ViewMode` type becomes `'month' | 'week' | 'list'`. Old icons updated.
- `src/app/(authenticated)/events/get-events-command-center.ts` — adds `bookedSeatsCount: number` to `EventOverview`. Populated via a **single grouped query** over the fetched event IDs: `SELECT event_id, SUM(seats) FROM bookings WHERE event_id = ANY($ids) AND status = 'confirmed' GROUP BY event_id`. Also extends the search to filter `privateBookings` by `customer_name` / `event_type`.
- `src/app/(authenticated)/dashboard/dashboard-data.ts` — extends `EventSummary` to include `bookedSeatsCount`; extends dashboard `PrivateBookingSummary` to include `end_time`, `end_time_next_day`, `guest_count`; extends dashboard loaders to also load past private bookings and past parking within the same window as past events (90 days).
- `src/app/actions/events.ts` — booking create/update/cancel paths add `revalidateTag('dashboard')` and `revalidatePath('/events')` so the count subtitles don't go stale.
- `src/app/actions/privateBookingActions.ts` — create/update/delete/status mutations add `revalidatePath('/events')`.

**Deleted files**
- `src/components/events/command-center/EventList.tsx` — replaced by `ScheduleCalendarList`.
- `src/components/events/command-center/EventGrid.tsx` — removed. Month view covers its job.

**Left alone**
- `src/components/ui-v2/display/Calendar.tsx` — unchanged. The unused `EventCalendar` re-export is deleted once both callers are migrated.

## Data model

```ts
// src/components/schedule-calendar/types.ts
export type CalendarEntryKind =
  | 'event'
  | 'private_booking'
  | 'calendar_note'
  | 'parking'

export type CalendarEntryStatus =
  | 'scheduled'
  | 'draft'
  | 'confirmed'
  | 'sold_out'
  | 'postponed'
  | 'rescheduled'
  | 'cancelled'
  | null          // for notes and parking where status is not meaningful

export interface CalendarEntry {
  id: string                    // prefixed: 'evt:', 'pb:', 'note:', 'park:'
  kind: CalendarEntryKind
  title: string                 // full text — never pre-truncated
  start: Date                   // local wall-clock (Europe/London) — see D16 below
  end: Date                     // local wall-clock
  allDay: boolean               // true for calendar notes
  spansMultipleDays: boolean    // true for multi-day notes; false for overnight bookings (D11)
  endsNextDay: boolean          // true for overnight bookings — drives the "+1 day" indicator
  color: string                 // hex — from category (events) or kind default (from token map)
  subtitle: string | null       // e.g. '22 booked', '40 guests', '5 parking', null for notes
  status: CalendarEntryStatus
  statusLabel: string | null    // display label (e.g. 'Draft'); null if status is not shown
  tooltipData: TooltipData      // discriminated union — caller renders
  onClickHref: string | null    // navigation target; null = no click action
}

export type TooltipData =
  | { kind: 'event'; name: string; time: string; bookedSeats: number; category: string | null; status: CalendarEntryStatus }
  | { kind: 'private_booking'; customerName: string; eventType: string | null; guestCount: number | null; timeRange: string; endsNextDay: boolean }
  | { kind: 'calendar_note'; title: string; dateRange: string; notes: string | null; source: 'ai' | 'manual' }
  | { kind: 'parking'; reference: string | null; customerName: string; vehicleReg: string | null; timeRange: string; status: string | null }
```

**Tooltip rendering** (the "pure adapters" fix)
- Adapters return `tooltipData` only. They **never** produce `ReactNode`.
- `ScheduleCalendar` accepts an optional `renderTooltip(entry: CalendarEntry): ReactNode` prop. The events and dashboard wrappers provide this, moving the existing tooltip JSX out of the adapters and into the wrappers unchanged.
- Default: a minimal built-in tooltip if no `renderTooltip` is provided.

**D16 — Timezone / DST policy**
- All `start`/`end` values are constructed in Europe/London local time using the project's `src/lib/dateUtils.ts` helpers (`getTodayIsoDate`, `formatDateInLondon`, etc.) rather than raw `new Date()` constructors.
- Week-view geometry uses **wall-clock minutes**, not elapsed milliseconds. A 19:00–21:00 booking on a DST day is still 2 hours tall, regardless of the 23- or 25-hour wall-clock day.
- DST transition days: the grid still renders 12:00–23:00 (wall-clock), and the missing/extra hour is a no-op visually.

**D17 — Deterministic sort**
`compareEntries(a, b)` orders by:
1. `start` (ascending)
2. `end` (ascending)
3. `kindPriority`: `calendar_note` = 0 (top, all-day band), `private_booking` = 1, `event` = 2, `parking` = 3
4. `statusPriority`: `confirmed`/`scheduled` = 0, `draft` = 1, `sold_out` = 2, `postponed`/`rescheduled` = 3, `cancelled` = 4
5. `title` (lexical)
6. `id` (final tie-break)

**D18 — Booked count semantics**
- `bookedSeatsCount` = `SUM(seats) WHERE status = 'confirmed'`. Single grouped query, once, over the returned event IDs.
- Excludes `cancelled`, `expired`, `pending_payment`, and reminder-only rows.
- Invalidation: all booking mutations must call `revalidatePath('/events')` and `revalidateTag('dashboard')` so dashboard counts stay fresh.

## Month view

**Layout**
- 7 columns (Mon–Sun) + day-name header row.
- Rows have **variable height** driven by content, with one important layout rule to avoid the absolute-positioning bug:
  - Each week row is a CSS grid with **two tracks**: an **all-day band** (auto-height, contains multi-day note bars) and a **day-cells band** (7 cells, auto-height).
  - The all-day band renders bars as regular grid items that span columns (not absolute-positioned). The band auto-grows to fit its bars.
  - The day-cells band auto-grows to fit the busiest day's timed entries.
  - Minimum day-cell height 80px so empty cells are still clickable.

**Each day cell**
- Day number top-left; today shown as a filled green pill.
- Vertical stack of timed entries sorted by `compareEntries`.

**Each entry block**
- Line 1: **time** in bold (`HH:mm`), space, **full title** — wraps to multiple lines. Never receives any `truncate` / `ellipsis` utility class. **Tests enforce this.**
- Line 2: **subtitle** (`22 booked` / `40 guests` / `5 parking` / `null` for notes) in smaller muted text.
- Line 3 (only when relevant): a tiny `+1 day` indicator for overnight bookings.
- 3px coloured left border keyed by kind (green / purple / sky / teal — all from tokens).
- Status treatment (D12):
  - `confirmed` / `scheduled` / `draft` / `sold_out`: rendered normally. Draft/sold_out get a small status pill top-right.
  - `cancelled`: strikethrough title + 60% token-based muted foreground. Kept visible but visually "this date is free again".
  - `postponed` / `rescheduled`: status pill + same muted treatment as cancelled.

**Interactions**
- Click entry → navigate to its `onClickHref`.
- Click empty area of a day → open "Add calendar note" modal (only when `canCreateCalendarNote`). Clicked date stored as immutable modal state; `router.refresh()` after save does not clear it until user dismisses.
- Hover entry → tooltip built by the caller's `renderTooltip(entry)`.
- All entries are `<a>` or `<button>` — never `<div onClick>`. Empty day cells are `<button>` with accessible labels ("Add note for 25 April").

**Navigation controls (above grid)**
- Prev / Today / Next buttons.
- Current month label (e.g. `April 2026`) — clickable, opens a month/year quick-jump popover.
- View switcher: Month / Week / List.

**Empty state**
- Zero entries in the month: grid still renders all 7 columns × 6 rows. No replacement panel. An inline empty-hint appears as a small note below the grid (not instead of it) if appropriate.

## Week view

**Layout**
- 8-column grid: time gutter (50px) + 7 day columns (Mon–Sun).
- Baseline hour range: **12:00–23:00**.
- **W1 — Auto-extend rule**: for the visible week only, if any **timed** (non-`allDay`) entry starts before 12:00 or ends after 23:00, the grid extends to include it. `allDay` entries do NOT influence the range. Extension is scoped to the current week, so a single 06:00 outlier doesn't affect subsequent weeks.
- Today's column has a subtle green-token background tint.

**All-day band (top of grid)**
- Fixed-height band above the hourly grid. Multi-day notes and `allDay` entries render as bars spanning the columns they cover.

**Each timed entry block**
- Positioned by wall-clock minutes from the grid top (`1 hour = 40px`).
- **Event duration = 2h fixed** (D9). Private-booking duration derived from `start`–`end` wall-clock minutes.
- Lines: **time** bold, **title**, **subtitle**. Colour-by-kind left border (from tokens).
- If the block is shorter than ~45 minutes and cannot fit all three lines, it collapses to one line (time + title); the rest is reachable via tooltip and via focus (see accessibility).
- Overlapping entries (same day, overlapping times) render side-by-side at half width (thirds for 3). Beyond 3 overlaps, subsequent entries collapse into a `+N` pill.

**Overnight bookings (D11)**
- Rendered **only on the start day**. An `+1 day` indicator on the block signals continuation. Never rendered on the next day.

**Navigation**
- Prev week / Today / Next week.
- Header label: `Week of Mon 20 – Sun 26 Apr 2026`.
- View switcher: Month / Week / List.

**Empty state**
- A week with zero timed entries still renders the default 12:00–23:00 grid. Any all-day bars still render in the all-day band.

## List view

**Layout**
- Vertical scrollable timeline inside a bounded scroll container owned by `ScheduleCalendarList` (not the page shell). Height: fills the available calendar panel on both events and dashboard layouts.
- Grouped by date with sticky date headers (follows the existing `DataTable` `sticky top-0 z-10` pattern).
- Group header per day: "Today" (highlighted), "Tomorrow", then `Fri 24 Apr` etc. Past groups same format.
- Groups run chronologically: past above "Today", future below.

**Anchored scroll behaviour**
- On **first mount only**, the "Today" group header is scrolled into view at the top of the container.
- Implementation: `useLayoutEffect` + `requestAnimationFrame`; verifies ref exists before calling. Scroll container uses `scroll-margin-top` so sticky headers don't obscure the anchor.
- Scroll behaviour is `instant` by default; respects `prefers-reduced-motion` (never `smooth` for users who prefer reduced motion).
- **Does not** re-anchor on `router.refresh()` or browser back/forward — scroll restoration wins.
- A synthetic "Today" header renders even when there are zero entries today, so the anchor always has a target.

**"Today" floating button**
- Appears fixed bottom-right when the "Today" header leaves the scroll container viewport. Click = scroll Today back into place.

**Each row** (replaces the old `EventList` table)
- Date column: `Fri 24 Apr` with time below (`20:00`).
- Title column: full title, linked to detail page, with category badge.
- Subtitle column: `22 booked` / `40 guests` / `5 parking`.
- Status column: status pill (D12 treatment).
- Checklist column (events only): progress counts.
- Actions column: Edit / Delete for users with permission.

**Past vs future styling (D9 on accessibility)**
- Past rows use muted foreground + slightly recessed background from the design-token palette. **Not opacity.** Contrast is verified against WCAG AA text ratios in the test suite.
- Cancelled / postponed / rescheduled receive the same muted treatment regardless of past/future.

**Data scope**
- Events page: uses existing `past` and `upcoming` from `getEventsCommandCenterData` (no loader change; loader already returns all events).
- Dashboard: after D13, loaders also load past private bookings and parking in the same 90-day window as past events. Document the cap visibly ("showing last 90 days") in the list when the user scrolls to the end of loaded past data.

**Empty state**
- No entries in the visible window at all: the synthetic "Today" header renders, with an inline "No entries yet. Add a note or create an event." block below it.

## Cross-view concerns

**Legend strip** (below view switcher, always visible)
- Legend items derived from **permitted kinds that actually exist** in the current dataset, not hard-coded. If the user lacks `private_bookings.view`, no Private bookings item. If the dashboard has zero parking in the window, Parking is not shown.
- Kind colours come from a token map, not inline hex. Category-driven colours (events) stay as data.

**Filters and search**
- `ControlBar` (search box + "All / Attention needed" toggle + view switcher) stays above the calendar and applies in all three views.
- Search filters by: event title, **private booking `customer_name` and `event_type`** (D10), calendar note title, parking `reference` / customer name / vehicle reg.

**Permissions**
- `canCreateCalendarNote` gates the "click empty day to add note" interaction.
- Entries the user cannot view are **filtered server-side before rendering** (the existing pattern). `ScheduleCalendar` assumes the entries passed in are already permitted.

**Mobile** (< 640px, matching `use-media-query.ts`)
- Precise rule: on narrow screens, **Month and Week views render the List view instead**, and the view switcher is hidden. The user cannot force Month/Week on a 320px phone because a 7-column grid is unusable.
- The restriction is lifted when the viewport crosses 640px. A user who resized will see the switcher re-appear.
- Existing `src/components/private-bookings/CalendarView.tsx` already implements a similar pattern — that is the reference.

**Loading / error / empty states**
- Loading: skeleton grid for month/week and skeleton rows for list while the server component renders.
- Error: inline banner with retry from `PageLayout`'s existing `error` prop.
- Empty: per-view rules above.

**Data freshness**
- Dashboard snapshot is cached 60s per user. That staleness is accepted for this iteration. A visible "Refresh" button in the calendar panel header is added — clicking calls `router.refresh()`. No auto-refresh on window focus.

## Testing

**Vitest — unit**
- `adapters.test.ts`: every adapter. Fixtures cover all statuses, multi-day ranges, overnight flags, corrupt note `end_date < note_date` (clamp preserved), missing optional fields.
- `sort.test.ts`: every tie-break tier (start, end, kind priority, status priority, title, id).
- `hour-range.test.ts`: auto-extend with early/late entries, `allDay` entries correctly excluded from the range calculation, one outlier doesn't persist past the visible week.
- `booked-seats-count.test.ts`: aggregation returns zero for cancelled/expired/pending_payment bookings; only `confirmed` contributes.

**Vitest — component**
- `ScheduleCalendarMonth.test.tsx`:
  - Busy-day fixture (25/26 April style): titles render unwrapped and **no title element carries `truncate` / `text-ellipsis` classes** — this is the regression guard for the original bug.
  - Multi-day note fixture: a single continuous bar renders in the all-day band; the note title does **not** appear in per-day cells.
  - `confirmed` / `scheduled` / `draft` / `sold_out` render normally; `cancelled` / `postponed` / `rescheduled` render with strikethrough/muted treatment.
  - Today pill present; row heights match busiest day.
- `ScheduleCalendarWeek.test.tsx`:
  - Fixture with an entry at 10:00 triggers auto-extend; all-day notes do not trigger extension.
  - Event entries are fixed 2h (80px) tall regardless of absent end time.
  - Overlapping private bookings at Sat 14:00 render side-by-side.
  - Overnight booking renders on start day only with `+1 day` indicator — not on the next day.
- `ScheduleCalendarList.test.tsx`:
  - Fixture with past + today + future entries: chronological order; "Today" header rendered; `scrollIntoView({ block: 'start' })` called with `behavior: 'auto'` (not `smooth`) by default.
  - Empty fixture: synthetic "Today" header still present.
  - Mount → `router.refresh()` simulated → re-anchor does NOT fire.
  - Past rows use muted token classes, **not** `opacity-60` / equivalent.
  - Toggling `prefers-reduced-motion`: scroll call uses `behavior: 'auto'`.
- `ScheduleCalendarMobile.test.tsx`: viewport mocked to 320px — view switcher is hidden; passing `view="month"` still renders list.

**Accessibility tests**
- Month: each entry has an accessible name; tabbing through visits every entry in sort order; empty day cells are focusable `<button>` with `aria-label`.
- List: "Today" is a heading (semantic `<h2>`); floating Today button has `aria-label`.
- Focus-triggered tooltip test: tooltip content appears on keyboard focus, not only on mouse hover.

**No new E2E tests.** This repo has no Playwright harness today. Adding one is out of scope for this work.

## Rollout — three PRs

**PR 1 — data contracts + adapters (foundation)**
- Add `bookedSeatsCount` to `EventOverview` (server aggregation).
- Add `bookedSeatsCount` to dashboard `EventSummary`.
- Extend dashboard `PrivateBookingSummary` with `end_time`, `end_time_next_day`, `guest_count`.
- Extend dashboard loaders: past private bookings + past parking (90-day window).
- Add search filter for private bookings on `/events`.
- Add `revalidateTag('dashboard')` / `revalidatePath('/events')` to booking + private-booking mutation paths.
- Add `src/components/schedule-calendar/types.ts`, `adapters.ts`, `sort.ts`, `hour-range.ts` with full unit tests.
- Does NOT ship any UI yet — existing calendar still renders. Safe deploy.
- Complexity: M.

**PR 2 — ScheduleCalendar UI + `/events` migration**
- Build `ScheduleCalendar.tsx` + three per-view components + component tests.
- Migrate `EventCalendarView.tsx` to use `ScheduleCalendar`.
- Migrate `CommandCenterShell.tsx` to `month/week/list` only; delete outer `calendar/grid/list` state.
- Delete `EventList.tsx` and `EventGrid.tsx`.
- Verify no other imports of `EventCalendar`.
- Complexity: L.

**PR 3 — dashboard migration + cleanup**
- Migrate `UpcomingScheduleCalendar.tsx` to use `ScheduleCalendar` with the parking adapter.
- Delete the unused `EventCalendar` re-export from `ui-v2/display/Calendar.tsx`.
- Verification screenshots on production-realistic fixtures for both pages.
- Complexity: M.

## Verification per PR

Each PR: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` all pass. Manual smoke on the affected page(s) at desktop and mobile width. Visual regression screenshots on the original ellipsis-producing days (25, 26 April) after PR 2.

## Risks and mitigations

- **Variable-height row + all-day band layout:** mitigated by modelling each week as a two-track CSS grid instead of absolute positioning. Still requires a browser prototype during PR 2 — JSDOM cannot verify.
- **Aggregation performance:** mitigated by single grouped query over fetched IDs.
- **Dashboard cache staleness:** accepted; manual Refresh button added.
- **Mobile Safari first-paint scroll:** mitigated by `useLayoutEffect` + rAF + `scroll-margin-top` + `behavior: 'auto'` default.
- **DST days:** mitigated by wall-clock minute geometry using `dateUtils` helpers.
- **Accessibility regression from the old clickable-div pattern:** fixed by this redesign using semantic `<a>`/`<button>` elements throughout.

## Open questions for planning

None. All decisions listed in the "Resolved decisions" table above are committed.
