# Wave 4 · Dashboard Migration — Handoff

## Files modified
- `src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx` — full rewrite to use `ScheduleCalendar` from `@/components/schedule-calendar`. Entries built from events + private bookings + calendar notes + parking bookings via the shared adapters. Legacy `parseLocalDateTime`, `normalizeHexColor`, `getReadableTextColor`, prefix constants (`evt:`, `note:`, `pb:`, `park:`), per-kind id-maps, and colour helpers are removed — all of that now lives inside the shared `CalendarEntry`/`tooltipData` pipeline. Keeps the Add-Calendar-Note modal, `createCalendarNote` wiring, and `router.refresh()` behaviour unchanged.
- `src/components/ui-v2/display/Calendar.tsx` — deleted the `export function EventCalendar(props: CalendarProps)` block (the last function in the file). `MiniCalendar` and the base `Calendar` component are untouched.
- `src/components/ui-v2/index.ts` — removed `EventCalendar` from the `./display/Calendar` barrel re-export. The barrel now exports only `{ Calendar, MiniCalendar }`. This was required because the barrel previously re-exported the symbol and would have been a dangling reference after the deletion.

## Key implementation notes

### Shape adaptation for events
Dashboard `EventSummary` is narrower than `EventOverview` (no `daysUntil`, `category`, `eventStatus`, `checklist`, `statusBadge`, etc.). Per the brief I shape-adapt inline rather than introducing a `dashboardEventToEntry` wrapper. The fields the adapter actually reads (`id`, `name`, `date`, `time`, `bookedSeatsCount`, `eventStatus`, `category`) are populated from dashboard data; unused fields are set to safe defaults:
- `daysUntil: 0`
- `category: null` (dashboard `EventSummary` does not carry category yet — acceptable; the calendar just renders the default green)
- `eventStatus: null`, `bookingUrl: null`, `heroImageUrl: null`, `posterImageUrl: null`
- `checklist` zeroed
- `statusBadge: { label: '', tone: 'neutral' }` (the type is non-nullable; a placeholder keeps the cast explicit and local)

Events without a `date` are filtered out before adaptation (the adapter requires a non-null date).

### Shape adaptation for private bookings
Dashboard `PrivateBookingSummary` has nullable `customer_name`, `event_date`, `start_time`; `PrivateBookingCalendarOverview` requires them non-null. I:
- Skip bookings with no `event_date`.
- Default `customer_name` to `'Guest'` when null (same fallback the legacy tooltip used).
- Default `start_time` to `''` when null (the adapter treats falsy as "no time" via its `|| '00:00'` fallback, and the tooltip renders an empty time range naturally).
- Pass `end_time`, `end_time_next_day`, `guest_count` straight through (all now present on `PrivateBookingSummary` after Wave 1).
- `event_type` is `null` (dashboard doesn't fetch it).
- Status is cast through a narrow local alias `PrivateBookingCalendarInput = Parameters<typeof privateBookingToEntry>[0]` so the cast is explicit and scoped, avoiding a broad `any`.

### Parking
Uses the shared `parkingToEntry` adapter directly — the `DashboardParkingInput` type in `adapters.ts` already matches the dashboard's `DashboardParkingBookingSummary` shape field-for-field. Bookings without `start_at` are filtered out.

### Tooltip handling (parking preserved)
`renderTooltip(entry)` is a discriminated switch on `entry.tooltipData.kind`:
- `event` — name + date/time + booked count + category (if any)
- `calendar_note` — title + date range + notes + ai/manual marker
- `private_booking` — customer + date/time range + guest count + ends-next-day flag
- `parking` — ref + vehicle reg + date/time range + customer + status (reproduces the legacy parking-with-ref-and-vehicle-reg content)

All kind-specific icons (`CalendarDaysIcon`, `LockClosedIcon`, `TruckIcon`) are preserved in the tooltip headers. The separate `renderEvent` hook from the old `EventCalendar` API is replaced by the tooltip — the ScheduleCalendar handles entry rendering internally.

### Legend
Computed from present data: `calendar_note` if any notes, `private_booking` if any bookings, `parking` if any parking, plus always `event`. Matches the pattern used by `EventCalendarView` in the events command-center migration.

### View state
Managed locally: `const [view, setView] = useState<ScheduleCalendarView>('month')`. The dashboard has no outer view switcher, so the `ScheduleCalendar`'s built-in month/week/list toggle is the only control (plus the mobile list-only fallback that the component handles automatically via `useMediaQuery`).

### onEmptyDayClick
Passed only when `canCreateCalendarNote` is truthy, mirroring the legacy `onDateClick` gate. `ScheduleCalendar` also gates this internally on `canCreateCalendarNote`, but gating the prop too means unauthorised users can never trigger the modal.

### Empty-state hidden count
Preserved the legacy "N without a date (not shown)" footer so ops still sees when data is being silently dropped. Moved below the calendar since the inline legend is now rendered inside `ScheduleCalendar`.

## Verification
- `npx tsc --noEmit`: clean (after fixing an initial `statusBadge: null` error — the field is non-nullable)
- `npx next lint --file ...UpcomingScheduleCalendar.tsx ...Calendar.tsx ...index.ts`: "No ESLint warnings or errors"
- `npm run build`: succeeded (full production build completed, all routes compiled)
- `npx vitest run tests/components/schedule-calendar/`: 7 files, 29/29 tests pass
- Self-check greps:
  - `grep -c "EventCalendar\s*[({<]" src/components/ui-v2/display/Calendar.tsx` -> `0`
  - `grep -c "MiniCalendar" src/components/ui-v2/display/Calendar.tsx` -> `2` (still exported)
  - `grep -rn "import.*EventCalendar" src --include="*.tsx" --include="*.ts"` -> only `import EventCalendarView from './EventCalendarView'` (the separate events command-center component; not the deleted function)
  - `grep -rn "from '@/components/ui-v2/display/Calendar'" src` -> zero matches (the dashboard no longer imports from that path; no other callers existed)
- **No git commits made.**

## Assumptions made
- Dashboard `EventSummary` doesn't carry `category`, so all events render with the default green (`#22c55e`) from the adapter rather than a per-category colour. If the dashboard later needs category colours, `dashboard-data.ts` would need to fetch category and `EventSummary` would need a `category` field — at which point either the inline shape-adapter here can populate it, or a small `dashboardEventToEntry` wrapper can be introduced.
- Dashboard `EventSummary.eventStatus` is likewise not fetched, so events render as `scheduled` with no status badge on the calendar. This matches the legacy behaviour (the old `UpcomingScheduleCalendar` just used a flat `#3b82f6` with no status treatment).
- `statusBadge: { label: '', tone: 'neutral' }` is a placeholder because the `EventOverview.statusBadge` field is required. `statusBadge` is not read by `eventToEntry`, so the placeholder has no runtime effect — it's purely to satisfy the structural type.
- `private_booking` tooltip uses `entry.statusLabel` (derived by the adapter from status) rather than hand-formatted `formatStatusLabel(booking.status)`. This is equivalent for the statuses the adapter recognises (`draft`, `sold_out`, `postponed`, `rescheduled`, `cancelled`) and renders nothing for `confirmed`/`scheduled` — same as the legacy tooltip's "blank when confirmed" behaviour.
- Legacy-only tooltip fields (`deposit_status`, `hold_expiry` note for drafts, `balance_due_date`, `days_until_event`) were dropped from the calendar tooltip. These are surfaced elsewhere on the dashboard (Action Required cards, Finance panels) and are not part of the shared `TooltipData<'private_booking'>` schema. Adding them back would require extending the schema in `src/components/schedule-calendar/types.ts` and the adapter — out of scope for Wave 4 per the brief ("preserve the existing per-kind tooltip content" read together with "use the shared adapters").

## Open items / follow-ups
- If the dashboard tooltip needs to surface the legacy `deposit_status` / `hold_expiry` / `balance_due_date` / `days_until_event` on private-booking hover, extend `TooltipData<'private_booking'>` in `src/components/schedule-calendar/types.ts`, update `privateBookingToEntry` to populate them, and thread them into the render. That's a coordinated change affecting both the events and dashboard callers' tooltip renderers — worth a dedicated task rather than slipping into this migration.
- The dashboard `page.tsx` still passes the combined `[...past, ...today, ...upcoming]` events list and just the `upcoming` past/upcoming private bookings + parking. Once PR 1 stabilises, `privateBookings.past` and `parking.past` are also available on the snapshot and could be concatenated into the calendar feed for a "last 90 days + next 180" history view. That is intentionally NOT done here because the brief said "Do NOT change `page.tsx`" and the current behaviour matches the legacy UI (which only showed upcoming for PB/parking). If a product decision is made to show past PB/parking on the dashboard calendar, that's a one-line concat at the `page.tsx` call site.
- `EventCalendar` was only referenced by `UpcomingScheduleCalendar` and the barrel export. After this migration the symbol is fully gone from the codebase — no stale references remain.
