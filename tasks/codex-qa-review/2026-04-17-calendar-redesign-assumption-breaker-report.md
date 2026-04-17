# Assumption Breaker Report — Calendar Redesign

## Inspection Inventory

### Inspected
- Target spec: [2026-04-17-calendar-redesign-design.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:1)
- Repo reality report: missing at `tasks/codex-qa-review/2026-04-17-calendar-redesign-repo-reality-mapper-report.md`
- `EventCalendar` import surface and generic `Calendar`/date-picker separation
- Events command-centre data loader, event booking schema, private booking shape, calendar notes, dashboard schedule shape
- `/events` and `/dashboard` layout constraints
- Workspace styling rules and Tailwind/token reality

### Not Inspected
- Live Supabase schema via `information_schema` or query plans
- Production data volumes and real busiest-month screenshots
- Browser prototype of variable-height month rows, week overlaps, or mobile fallback
- Live `/events` and `/dashboard` manual smoke

### Limited Visibility
- Schema findings are from generated types, migrations, and source code, not live DB introspection.
- CSS-grid risks are implementation analysis, not proven by a prototype.
- E2E coverage was checked from repo structure; no Playwright/Cypress harness was found.

## High-Severity Challenges

1. **`bookingsCount` is underspecified and the spec overstates query simplicity.**  
Evidence: `bookings.event_id` is real and indexed, so the FK assumption is basically right. But bookings have `seats`, `status`, `hold_expires_at`, `expired_at`, cancellation metadata, and active-booking logic elsewhere filters to confirmed plus pending-payment in specific cases. `get-events-command-center` currently fetches events only and then splits past/upcoming in memory, not from a bounded date-window booking query: [get-events-command-center.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/get-events-command-center.ts:103), [get-events-command-center.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/get-events-command-center.ts:292). The spec says grouped counts are in “the same date window already being fetched” and produces `"22 booked"` from `bookingsCount`: [spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:41), [spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:198).  
Counterargument: the implementation is still feasible because event IDs are already materialized and `bookings.event_id` exists.  
What would confirm: define whether subtitle means booking rows, seats sold, confirmed attendees, or reserved capacity; define whether `pending_payment`, expired holds, cancelled bookings, and `is_reminder_only` are included; add fixtures for each.

2. **Dashboard private bookings cannot currently satisfy the new `start`/`end`/overnight model.**  
Evidence: the events calendar currently uses `end_time_next_day` to move private booking end dates forward, but dashboard `PrivateBookingSummary` does not carry `end_time` or `end_time_next_day`; dashboard currently approximates private booking duration as start plus 3 hours. The new `CalendarEntry` requires `end` and `spansMultipleDays`: [spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:60).  
Counterargument: no new endpoint is needed; `loadDashboardSnapshot` can be extended.  
What would confirm: update the spec to add `end_time` and `end_time_next_day` to dashboard private booking data, or explicitly accept the current lossy approximation.

3. **The view architecture is not just “one new component”; it collides with the existing events page state model.**  
Evidence: `/events` already has a page-level `calendar | grid | list` control, while `EventCalendarView` only has internal `month | week | day`. The spec adds Month/Week/List inside `AnchorCalendar` while also saying the existing `ControlBar` and view switcher stay above it: [spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:101), [spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:163). That creates duplicate “list” concepts.  
Counterargument: consolidating page-level list into the new calendar list could be correct.  
What would confirm: a revised state contract showing whether page-level `list` remains, is removed, or delegates to `AnchorCalendar`, plus dashboard behavior for its newly introduced list mode.

4. **Variable-height month rows with absolute multi-day bars are not straightforward.**  
Evidence: the spec says row height is max of 7 cells, then says multi-day bars are absolutely positioned per week row: [spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:82), [spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:88). Absolutely positioned bars do not contribute to CSS grid row height. If the bar band is not reserved explicitly, bars can overlap timed entries or be clipped inside the current `overflow-hidden`/scroll shell.  
Counterargument: this is solvable with explicit week wrappers, a reserved all-day band, and non-absolute content participating in layout.  
What would confirm: a browser prototype or Playwright screenshot for a six-row month with multi-day notes, busy days, sidebar open, and mobile fallback. JSDOM component tests cannot prove actual row heights.

5. **The list “Today” anchor is undefined when there is no Today group.**  
Evidence: the spec says render groups from entries, then `scrollIntoView` the “Today” header on mount: [spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:131), [spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:136). If there are no entries today, no entries in the visible window, or no past entries, the anchor behavior is ambiguous.  
Counterargument: this is easy to fix by rendering a synthetic Today divider even with zero entries.  
What would confirm: explicit behavior and tests for no events today, no events in window, only future entries, and only past entries.

## Medium-Severity Challenges

- **Status handling is incomplete.** Events include `scheduled`, `cancelled`, `postponed`, `rescheduled`, `sold_out`, and `draft`; `get-events-command-center` fetches all statuses with no status filter. Current calendar only color-codes some statuses and does not label them. The spec names Draft/Cancelled/Postponed but misses `rescheduled` and `sold_out`, and does not decide whether cancelled/draft events should count as “date taken”.

- **Hardcoded color language conflicts with workspace rules unless treated as data.** The spec says `CalendarEntry.color` is “hex”: [spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:64). Workspace guidance says no hardcoded hex colours in components and use design tokens only: [parent CLAUDE.md](/Users/peterpitcher/Cursor/CLAUDE.md:127). Category/note colors are already domain data, so stored hex values are defensible. New kind defaults should be token/class maps, not component-local hex constants.

- **Auto-extending week hours can degrade the default experience.** A single 06:00 outlier in one week turns the whole week into 06:00-23:00. The spec’s “operator never has invisible events” claim is right, but the UX cost is not addressed: [spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:110). Consider a collapsed outlier band, “early entry” marker, or user-visible hour-range control.

- **Date/time and DST rules are under-specified.** Workspace rules require project date utilities and Europe/London handling: [parent CLAUDE.md](/Users/peterpitcher/Cursor/CLAUDE.md:133). The spec’s raw `Date` model does not say how local dates are constructed for midnight-adjacent events, DST changes, all-day notes, or private bookings ending next day.

- **Testing claims are too confident.** The spec says no new E2E and references an existing events-page smoke test: [spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-17-calendar-redesign-design.md:190). I found no E2E harness. “No new E2E” is defensible because the repo appears Vitest-first, but the “existing smoke test” claim is not supported. Also, row-height assertions in component tests are weak unless run in a real browser.

## Low-Severity / Notable But Not Blocking

- `src/components/calendar/` is acceptable if this is a domain schedule component, not a generic ui-v2 primitive. Generic display components currently live under `src/components/ui-v2/display`.
- The legend should define whether zero-entry kinds are shown. Always showing Parking on dashboard is fine; showing unavailable kinds can add noise.
- Recurring events are not a current blocker. Historical recurring columns were removed, and the recurring API is effectively stale.
- Deleted/soft-deleted concerns are mostly non-issues: events, private bookings, and calendar notes appear hard-deleted rather than soft-deleted.
- Calendar notes have permission and visibility semantics, but no status/soft-delete semantics. The new component should not invent note states.

## False Confidence Flagged

- “Open questions: None” is wrong. There are open questions on count semantics, list anchoring, dashboard private booking end times, status treatment, hour-range UX, and layout/state ownership.
- “`bookings` grouped by `event_id` within the same date window already being fetched” is not accurate for the current command-centre loader.
- “Variable-height rows visual shift is acceptable” skips the harder problem: making multi-day bars participate correctly in layout.
- “No new E2E tests” is not the problem; claiming an existing smoke test exists is the unsupported part.
- “Dashboard = all three views” hides new behavior and layout work. Dashboard has width, but no current calendar list mode and no bounded calendar panel.
- “Single PR, L (4)” underestimates the work. This is data semantics, new shared UI, events migration, dashboard migration, and tests.

## Things The Spec Got Right

- The “only two `EventCalendar` production callers” assumption is confirmed: events command centre and dashboard schedule.
- Keeping `src/components/ui-v2/display/Calendar.tsx` unchanged is the right instinct. Date pickers are separate and should not be touched.
- The event-booking FK is real: `bookings.event_id` references `events.id`.
- A shared adapter-based component is a good direction because dashboard already prefixes mixed calendar item IDs.
- Removing Day view from this workflow is reasonable based on the stated operator goals.
- Unit tests for adapters and hour-range logic are worthwhile.
- The core product goal is valid: month view needs more information density, and week view should not default to a 24-hour wall of empty space.

## Summary Verdict

Ready to proceed with named fixes, not ready as “design complete.”

Load-bearing fixes before implementation:

1. Define `CalendarEntry` semantics precisely: local date construction, status labels, all-day/multi-day rendering, color token strategy, and count subtitle meaning.
2. Fix data requirements: booking count/sum rules and dashboard private booking `end_time_next_day` support.
3. Reconcile view state: page-level `calendar/grid/list` versus calendar-level `month/week/list`.
4. Specify empty/today-anchor behavior.
5. Prototype the month row/all-day bar layout in a real browser before committing to the CSS approach.

I would split this into at least two PRs: first data contracts/adapters/tests, then the `AnchorCalendar` UI plus call-site migrations. If dashboard list view is still required, that may deserve its own PR.