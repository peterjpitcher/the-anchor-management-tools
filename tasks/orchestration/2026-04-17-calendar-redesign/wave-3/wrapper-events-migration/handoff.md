# Wave 3 · Wrapper + Events Migration — Handoff

## Files created
- `src/components/schedule-calendar/ScheduleCalendar.tsx` — top-level wrapper. Owns `anchor` state (current month/week). View mode is controlled via props. Prev/Today/Next only shown when not in list view. Mobile (`max-width: 639px`) forces list view and hides the view switcher.
- `src/components/schedule-calendar/index.ts` — barrel export. Exposes `ScheduleCalendar`, `ScheduleCalendarProps`, the type vocabulary (`CalendarEntry`, `CalendarEntryKind`, `CalendarEntryStatus`, `TooltipData`, `ScheduleCalendarView`), and the four adapters (`eventToEntry`, `privateBookingToEntry`, `calendarNoteToEntry`, `parkingToEntry`).
- `tests/components/schedule-calendar/ScheduleCalendar.test.tsx` — 2 mobile-fallback tests. Mocks `@/hooks/use-media-query` so max-width queries always match; asserts the List "Today" heading renders and the Month/Week/List switcher buttons are absent.

## Files modified
- `src/components/events/command-center/EventCalendarView.tsx` — substantial rewrite. Removed the ~100 lines of local colour/date helpers that now live inside the adapters. Builds `CalendarEntry[]` with the three adapters, delegates to `ScheduleCalendar`. Kept the "Add calendar note" modal, form state, `createCalendarNote` server action call, and `router.refresh()` on success. `view` and `onViewChange` are now props (hoisted up to the shell). Per-kind tooltip JSX reproduced inside a `renderTooltip` keyed on `entry.tooltipData.kind` (calendar_note, private_booking, event). Empty-day click still opens the Add-note modal when `canCreateCalendarNote` is true. `onEntryClick` routes via `entry.onClickHref` (event -> `/events/:id`, private booking -> `/private-bookings/:id`; calendar notes have `onClickHref: null` so they no-op, matching prior behaviour). `legendKinds` populated based on what's in the data.
- `src/components/events/command-center/CommandCenterShell.tsx` — dropped `EventGrid`/`EventList` imports. `viewMode` default changed from `'calendar'` to `'month'`. Removed the grid/list branching; always renders `<EventCalendarView view={viewMode} onViewChange={setViewMode} ... />`.
- `src/components/events/command-center/ControlBar.tsx` — `ViewMode` changed from `'calendar' | 'grid' | 'list'` to `'month' | 'week' | 'list'`. Three buttons now: Month (`CalendarDaysIcon`), Week (`ViewColumnsIcon`), List (`ListBulletIcon`). Added `aria-label` on each for accessibility.

## Files deleted
- `src/components/events/command-center/EventList.tsx`
- `src/components/events/command-center/EventGrid.tsx`

## Test results
- Full vitest: 3812 passed / 3848 total. 36 failures are **all** pre-existing and unrelated to this wave (they exist in both `tests/` and the stale `.claude/worktrees/indexed-hatching-moonbeam/` mirror: `employeeActions`, `eventWaitlistOffersRouteErrors`, `idempotencyPersistFailClosedAdditionalRoutes`, `eventsSchema`, `menu.service`, `mutation-race-guards`, `testScriptsFailClosedCatchHandlers`, `expenses`). No failures in anything I touched.
- Schedule-calendar suite (including new file): 29/29 passed.
- ScheduleCalendar mobile fallback: 2/2 passed.

## Lint + Typecheck
- `npx tsc --noEmit`: clean.
- `npx eslint` on the 6 affected files: clean.

## Verification self-check
- `grep -rn "from '@/components/ui-v2/display/Calendar'" src/components/events --include="*.tsx"` → zero matches. Events side migration complete.
- `grep -rn "command-center/EventList\|command-center/EventGrid" src --include="*.tsx" --include="*.ts"` → zero matches.
- `ls src/components/events/command-center/EventList.tsx src/components/events/command-center/EventGrid.tsx` → "No such file".

## Assumptions made
- **Button ‹›/›› characters** — the plan code block used literal `‹`/`›` chars. I used the equivalent unicode escapes (`\u2039`, `\u203A`) with `aria-label` for screen readers so the arrows still render but are accessible.
- **Event tooltip body** — the original code did not render a tooltip for events (only for private bookings and calendar notes). I added a minimal event tooltip using the `TooltipData` (name, time, booked seats, category) because `renderTooltip` from `ScheduleCalendar` is called for every entry, and falling back to `<div>{entry.title}</div>` felt like a regression relative to the other two kinds. If this turns out not to be desired, return `null` for `tooltipData.kind === 'event'` in a follow-up.
- **Status/color mapping** — the new `eventToEntry` adapter uses `event.category?.color ?? '#22c55e'` rather than the old file's complex `getEventColor` (which mapped specific statuses like `cancelled`/`postponed`/`draft` to red/amber/grey). This is consistent with the rest of the wave-2 adapter work — status tone is now conveyed via `entry.status` / `statusLabel` and per-view styling (strikethrough on cancelled, muted on postponed/rescheduled) rather than baking it into the colour. If visual parity is critical, the adapter is the place to extend.
- **`showOnStartDayOnly` for private bookings** — the old code set this flag so multi-day overnight bookings only rendered on day 1. The new adapter sets `spansMultipleDays: false` and `endsNextDay: true` (per decision D11 in the spec), which collapses to "single-day with +1 day indicator" naturally in the new views. Behaviour is equivalent.

## Notes for downstream (Wave 4 — dashboard migration)
- `ScheduleCalendar` is now the entry point for all schedule-calendar UI.
- Dashboard migration should import from `@/components/schedule-calendar` (the barrel).
- The existing `EventCalendar` re-export in `src/components/ui-v2/display/Calendar.tsx` is no longer used by `/events`; Wave 4 will delete it.
- If the dashboard needs parking entries, the `parkingToEntry` adapter is already exported from the barrel.
- `ScheduleCalendar` accepts `canCreateCalendarNote` + `onEmptyDayClick` — dashboard can omit both if it doesn't want inline note creation.

## No git commits made.
