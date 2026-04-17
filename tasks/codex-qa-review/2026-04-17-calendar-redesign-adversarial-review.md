# Adversarial Review: Calendar Redesign

**Date:** 2026-04-17
**Mode:** Spec Compliance Review (Mode C) — spec is for new code, not yet implemented
**Engines:** Codex (5 reviewers)
**Scope:** `docs/superpowers/specs/2026-04-17-calendar-redesign-design.md`
**Target callers:** `/events` command centre + `/dashboard` upcoming schedule

## Inspection Inventory

### Inspected
- Spec doc `docs/superpowers/specs/2026-04-17-calendar-redesign-design.md`
- `src/components/ui-v2/display/Calendar.tsx` (current shared calendar)
- `src/components/events/command-center/EventCalendarView.tsx` + `CommandCenterShell.tsx` + `ControlBar.tsx` + `EventList.tsx` + `EventGrid.tsx`
- `src/app/(authenticated)/events/get-events-command-center.ts`
- `src/app/(authenticated)/events/page.tsx`
- `src/app/(authenticated)/dashboard/UpcomingScheduleCalendar.tsx` + `dashboard-data.ts` + `page.tsx`
- `src/app/actions/calendar-notes.ts` + `src/app/actions/events.ts`
- `tests/components/Calendar.test.tsx`, `vitest.config.ts`, `vitest.setup.ts`
- Workspace `CLAUDE.md` + project `CLAUDE.md` + `.claude/rules/*`
- `src/hooks/use-media-query.ts`, `src/components/ui-v2/display/VirtualList.tsx`, `src/components/private-bookings/CalendarView.tsx`
- `src/components/ui-v2/layout/PageLayout.tsx`, `AuthenticatedLayout.tsx`

### Not Inspected
- Live Supabase schema (used generated types instead)
- Production data volumes / real busiest-month screenshots
- Browser-rendered prototype of variable-height rows with multi-day bars

### Limited Visibility Warnings
- CSS-grid interaction with absolutely-positioned multi-day bars is implementation analysis, not prototype-verified
- No E2E / Playwright harness found; claims about "existing smoke test" cannot be validated

---

## Executive Summary

The spec captures the correct product direction but is **not ready to implement as written**. Five reviewers converged on the same core defects: the events page has an unresolved dual view-switcher model, dashboard data contracts don't support the spec's List-view or subtitle requirements, the parking detail URL doesn't exist, `bookingsCount` semantics are ambiguous, multi-day bar positioning conflicts with variable-height row mathematics, and several accessibility/timezone edge cases are under-specified. With named fixes it becomes buildable; the current scope estimate (L / single PR) under-sells the actual work.

## What Appears Solid

- **Replacement targets confirmed.** Only `EventCalendarView` and `UpcomingScheduleCalendar` import `EventCalendar`. Leaving the generic `ui-v2/display/Calendar.tsx` alone is the right boundary.
- **Adapter-based component.** One shared component with per-source adapters is a sound shape and matches existing patterns.
- **Drop Day view.** Supported by the operator's stated workflow.
- **Month view variable-height rows + full titles.** Core product fix for the user's ellipsis pain.
- **Condensed week hours (12:00–23:00).** Correct default for the venue's operating window.
- **Today-anchored List.** Product intent is correct.
- **Unit tests for adapters + hour-range logic.** Worth writing.
- **FK assumption for bookings → events.** `bookings.event_id` exists and is indexed.

## Critical Risks (Blocking)

### CRIT-01 — Events-page dual view-switcher collision
The spec adds Month/Week/List **inside** `AnchorCalendar` while the existing `ControlBar` already has an **outer** `calendar | grid | list` switcher where `list` renders the separate `EventList` table. The spec doesn't resolve the conflict: which switcher wins? Does `AnchorCalendar`'s List absorb `EventList`? Does `EventGrid` remain?
Evidence: `CommandCenterShell.tsx:24`, `ControlBar.tsx:14`, `EventCalendarView.tsx` internal `month|week|day` state.
Flagged by: Spec Trace, Assumption Breaker, Integration & Architecture.

### CRIT-02 — Dashboard data contracts don't support the spec
- `EventSummary` (dashboard) lacks `bookingsCount`
- `PrivateBookingSummary` (dashboard) lacks `end_time`, `end_time_next_day`, `guest_count`
- Dashboard loads only upcoming private bookings + parking; past are not loaded
- Therefore the spec's dashboard List view with "scroll up to past" and subtitle "40 guests" cannot be produced from current data
Evidence: `dashboard-data.ts:10, 65, 85`; spec requires fields not present.
Flagged by: Spec Trace, Assumption Breaker, Integration & Architecture.

### CRIT-03 — `/parking/:id` does not exist
Spec prescribes `onClickHref: '/parking/:id'`, but the repo has no authenticated `/parking/[id]` route. Current dashboard routes parking clicks to `/parking`.
Evidence: `UpcomingScheduleCalendar.tsx:550-551`; spec L76.
Flagged by: Spec Trace, Integration & Architecture.

### CRIT-04 — `bookingsCount` semantics ambiguous
Existing repo conventions conflict: some sites count `confirmed + pending_payment` booking rows; event detail counts confirmed seats separately from non-cancelled seats. "22 booked" could mean rows, seats, confirmed only, or confirmed + pending. Spec doesn't commit.
Evidence: `EventDetailClient.tsx:323, 328, 336` show three different definitions active today.
Flagged by: Assumption Breaker, Integration & Architecture, Spec Trace.

### CRIT-05 — Multi-day bars vs variable-height row math
Spec L82 says row height = max of 7 cells' content. Spec L88 says multi-day bars are absolutely-positioned per week row. Absolutely-positioned elements don't contribute to CSS-grid row height. Without a reserved all-day band, bars can overlap timed entries or be clipped by `overflow-hidden`.
Flagged by: Spec Trace, Assumption Breaker.

### CRIT-06 — `tooltipBody: ReactNode` violates "pure adapters"
Spec says adapters are pure functions (L36) yet returns `tooltipBody: ReactNode` (L67), coupling the data layer to JSX and duplicating tooltip ownership between adapters and wrappers.
Evidence: Current `EventCalendarView` already owns all tooltip construction — moving it into adapters is a regression.
Flagged by: Integration & Architecture.

### CRIT-07 — List anchor corner cases
`scrollIntoView` assumes a "Today" group exists and is already rendered. Behaviour undefined when:
- No entries today, no past, no future
- Target ref not yet mounted on first paint
- User returns via browser back (scroll restoration is overridden)
- Mobile Safari first paint
- Reduced-motion preference
Flagged by: Workflow, Assumption Breaker, Spec Trace.

## Spec Defects

- **SPEC-DEF-01 Event duration missing.** Week view needs height ∝ duration, but `EventOverview` has no `end_time`, `endTime`, or `durationMinutes`. Spec only adds `bookingsCount`.
- **SPEC-DEF-02 DST / timezone.** Spec uses raw `Date` with `1h = 40px`; workspace rule mandates `dateUtils` + Europe/London. On DST day, elapsed ms ≠ wall-clock minutes.
- **SPEC-DEF-03 Past rows at 60% opacity.** Reduces text contrast for every descendant — likely fails WCAG AA.
- **SPEC-DEF-04 Status vocabulary incomplete.** Events include `scheduled | cancelled | postponed | rescheduled | sold_out | draft`; spec only names Draft/Cancelled/Postponed.
- **SPEC-DEF-05 Sort ties non-deterministic.** Only sorts by start time; ties fall back to input order.
- **SPEC-DEF-06 Mobile fallback contradictory.** Auto-falls back to List, but switcher also allows Month/Week.
- **SPEC-DEF-07 Week hour-range auto-extend UX.** A single 06:00 outlier once a month makes the whole week 06:00–23:00.
- **SPEC-DEF-08 Overnight private bookings.** Current code forces start-day-only; spec marks `spansMultipleDays: true` but doesn't commit per-view rendering.
- **SPEC-DEF-09 Same-start month stacking.** Spec doesn't define precedence.
- **SPEC-DEF-10 Corrupt note range.** Current adapters clamp `end_date < note_date`; spec doesn't preserve the guard.
- **SPEC-DEF-11 Legend permissions.** Always shows all kinds; should be derived from permitted entry kinds.
- **SPEC-DEF-12 False E2E smoke test claim.** Spec references an "existing events-page smoke test" — no Playwright harness found.
- **SPEC-DEF-13 Private-bookings search claim.** Spec says "search filters by title and customer name as today" — current code does NOT filter private bookings by search.
- **SPEC-DEF-14 Empty state guidance unclear.** Empty month/week should still render navigable grid for clicking (add-note workflow). List with no entries needs synthetic Today anchor.
- **SPEC-DEF-15 Hour-range auto-extend should exclude `allDay`.** Spec implies it considers "any entry"; all-day notes shouldn't stretch timed grid.
- **SPEC-DEF-16 Event detail URL gating.** Spec suggests destination page handles permissions; current pattern filters entries server-side before render. Don't render entries the user can't view.

## Implementation Defects

*(These emerge when coding starts; listed so the spec reflects them.)*
- **IMPL-DEF-01 Aggregation strategy for `bookingsCount`.** Do not run N per-event queries; use a single grouped query or RPC over the returned event IDs.
- **IMPL-DEF-02 Mutation invalidation.** Event-booking mutations revalidate `/events` and detail paths but not `dashboard`; if dashboard shows `bookingsCount`, add `revalidateTag('dashboard')`. Private-booking mutations don't revalidate `/events` even though `/events` shows them.
- **IMPL-DEF-03 Dashboard cache (60s).** Stale bookings count / private booking details possible for up to 60s. Spec needs a stance (manual refresh affordance? accept staleness?).
- **IMPL-DEF-04 Adapters imports.** Shared adapters must use structural / type-only imports to avoid pulling server-context types into client bundles.
- **IMPL-DEF-05 Memoisation.** Variable-height rows + overlap layout should be memoised per view/filter.

## Architecture & Integration Defects

- **ARCH-01 Naming.** `AnchorCalendar` reads like branding. Prefer `ScheduleCalendar` (or `OperationsCalendar`).
- **ARCH-02 Folder.** `src/components/calendar/` creates a second generic "calendar" namespace beside `ui-v2/display/Calendar`. Use `src/components/schedule-calendar/`.
- **ARCH-03 View state ownership.** Component should be controlled: `<ScheduleCalendar view={...} onViewChange={...} />`. Events page owns its view state; dashboard keeps local state.
- **ARCH-04 Scroll root ownership.** List view anchor can't use document scroll because the events page shell has `overflow-y-auto`. Component should own a bounded scroll container or accept `scrollRootRef`.
- **ARCH-05 Kind registry for extensibility.** If a 4th kind (e.g. rota shifts) is likely, expose a kind registry (label, colour, subtitle policy) rather than hard-coding.

## Workflow & Failure-Path Defects

- **WF-01 Empty list has no anchor target.** Always render a synthetic Today header.
- **WF-02 DST transition day.** Geometry must use wall-clock minutes, not elapsed ms.
- **WF-03 Overnight booking rendering.** Commit per view.
- **WF-04 Stale data across tabs.** Dashboard cached 60s; no focus refresh; no stale indicator.
- **WF-05 Dashboard nav beyond capped data.** User can navigate to months whose data isn't loaded and infer false availability. Cap navigation or show "data is incomplete".
- **WF-06 Empty month/week.** Keep navigable grid (for add-note), not just an empty message.
- **WF-07 Clamp corrupt note `end_date`.** Preserve existing guard.
- **WF-08 Deterministic sort.** `start, end, kind-priority, status-priority, title, id`.
- **WF-09 300-bookings stress.** Memoise; consider caps; test with stress fixture.
- **WF-10 Browser back / scroll restore.** Only anchor on first mount; don't override scroll restoration.
- **WF-11 Legend permissions.** Build legend from permitted/available kinds.
- **WF-12 Keyboard / screen-reader access.** Entries must be `<a>`/`<button>`; empty cells that open modals must be keyboard-activatable; screen-reader Today landmark.

## Unproven Assumptions

- The spec claims the aggregation fits in "the same date window already being fetched" — not accurate; the current loader pages through all events in memory.
- The spec claims "existing events-page Playwright smoke test" — not found.
- The spec claims "existing code filters private bookings by search" — it doesn't.
- The spec's dashboard "30-day past + future window" — actual windows are mixed: events 90-day past + 25 upcoming, notes 90/180, private bookings + parking upcoming only, capped.

Each must be reverified or restated correctly in the spec before implementation.

## Recommended Fix Order

1. **Resolve view-switcher collision (CRIT-01)** and **component naming (ARCH-01/02)** — these decisions ripple through everything.
2. **Commit `bookingsCount` semantics (CRIT-04)** and **event duration model (SPEC-DEF-01)**.
3. **Correct dashboard data contract (CRIT-02)** — decide whether to extend `EventSummary` / `PrivateBookingSummary` or scope dashboard List view to "today forward only".
4. **Fix parking URL (CRIT-03)**, **multi-day bar layout (CRIT-05)**, **adapter boundary (CRIT-06)**, **list anchor corner cases (CRIT-07)**.
5. **Update accessibility + DST + sort + permissions + status + mobile sections (SPEC-DEF-02 through -16)**.
6. **Decompose into PRs:** (a) data contracts + adapters + tests; (b) ScheduleCalendar UI + events migration; (c) dashboard migration with data extension. The current "single PR / L" scope is unrealistic.

## Follow-Up Review Required

- Re-review the spec after revisions (CRIT-01 through CRIT-07 must be resolved).
- During implementation: a real-browser prototype of the month row with multi-day bars and a busy day is required — JSDOM cannot verify.
- After ScheduleCalendar lands: visual regression screenshots on the old ellipsis-producing days (25, 26 April production).
