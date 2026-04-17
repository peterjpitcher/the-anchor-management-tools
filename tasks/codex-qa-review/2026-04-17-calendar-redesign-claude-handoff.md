# Claude Hand-Off Brief: Calendar Redesign

**Generated:** 2026-04-17
**Review mode:** Spec Compliance (Mode C)
**Overall risk assessment:** **High** — spec needs a revision pass before writing the implementation plan.

## DO NOT REWRITE

The following decisions are sound and should be preserved:

- **Target scope:** only `/events` and `/dashboard` — only `EventCalendarView.tsx` and `UpcomingScheduleCalendar.tsx` import `EventCalendar`. Confirmed.
- **Leave `src/components/ui-v2/display/Calendar.tsx` untouched.** It is used for date-picker / generic contexts where the redesign semantics don't apply.
- **Overall product direction:** Month + Week + List only; drop Day; variable-height rows; condensed 12:00–23:00 week; today-anchored list.
- **Adapter pattern.** Per-source adapters feeding a shared component is the right shape.
- **Unit tests for adapters and hour-range logic.**
- **Multi-day notes render as single continuous bars**, not repeated titles. Correct fix.

Do not alter these unless a specific finding below requires it.

## SPEC REVISION REQUIRED

Apply these to `docs/superpowers/specs/2026-04-17-calendar-redesign-design.md` before the planning step:

- [ ] **SPEC-01 — Resolve dual view-switcher on `/events`.** The spec adds Month/Week/List inside the new component, but the existing `ControlBar` has outer `calendar | grid | list` where `list` renders `EventList`. Decide explicitly: new component provides the single switcher, outer `calendar/grid/list` is removed, and `EventList` + `EventGrid` are either deleted or absorbed.
- [ ] **SPEC-02 — Pin `bookingsCount` semantics.** Three different definitions are live in the repo. Pick one and document it. Recommended: "seats booked on non-cancelled, non-expired bookings" and rename field to `bookedSeatsCount`.
- [ ] **SPEC-03 — Commit an event-duration model.** `EventOverview` has no end time. Either add `durationMinutes` (server-side default if not set; e.g. 120 for quiz/bingo), OR declare "week view renders events as fixed 2h blocks". Week height math depends on this.
- [ ] **SPEC-04 — Correct the dashboard data contract.** Currently `EventSummary` lacks `bookingsCount`; `PrivateBookingSummary` lacks `end_time`, `end_time_next_day`, `guest_count`; parking and private-bookings loaders only fetch upcoming records. Spec must either (a) extend `dashboard-data.ts` to add these fields and load past records, or (b) scope the dashboard List view to "today forward only — no past scroll".
- [ ] **SPEC-05 — Fix parking URL.** Spec says `/parking/:id`; no such route exists. Use `/parking` or confirm a detail route.
- [ ] **SPEC-06 — Reserve the all-day band height.** Spec combines variable-height rows (content-driven) with absolutely-positioned multi-day bars. Absolute elements don't contribute to CSS grid row height. Either (a) bars participate in layout (grid-track-row-span on an all-day band), or (b) each week row reserves a fixed band height that bars occupy.
- [ ] **SPEC-07 — Stop returning `tooltipBody: ReactNode` from adapters.** Keep adapters pure / data-only. Options: `tooltipData: TooltipData` discriminated union rendered by the component, OR a caller-provided `renderTooltip(entry)` prop. Move existing `EventCalendarView` / `UpcomingScheduleCalendar` tooltip builders into whichever path is chosen, unchanged.
- [ ] **SPEC-08 — Specify Europe/London wall-clock geometry.** Week view `1 hour = 40px` must use wall-clock minutes, not elapsed milliseconds. Use project `dateUtils`. Document DST-day behaviour (spring-forward clock-skip day, autumn-back extra-hour day).
- [ ] **SPEC-09 — Replace past-row `60% opacity` with muted-token-based styling.** Opacity reduces text contrast for all descendants and likely fails WCAG AA. Use existing muted foreground / background design tokens and verify contrast.
- [ ] **SPEC-10 — Define the full event/booking status vocabulary.** Include `scheduled`, `cancelled`, `postponed`, `rescheduled`, `sold_out`, `draft`. Specify which count as "date taken" for availability checking, and how each renders.
- [ ] **SPEC-11 — Commit a deterministic sort order.** `start, end, kind priority, status priority, title, id`. Apply to all three views.
- [ ] **SPEC-12 — Commit a single mobile-fallback behaviour.** Either (a) `<640px` auto-renders List regardless of selected view and the selector is hidden, OR (b) the selector is visible and Month/Week simply render in a scrollable overflow on narrow screens. The current spec says both.
- [ ] **SPEC-13 — Define list view empty-window behaviour.** Always render a synthetic "Today" header anchor even with zero entries. Define display for "no past / no today / no future" combinations.
- [ ] **SPEC-14 — Anchor only on first mount.** Use `useLayoutEffect` + rAF; do not re-anchor on `router.refresh()` or browser back/forward (preserve scroll restoration). Respect `prefers-reduced-motion` (instant, not smooth).
- [ ] **SPEC-15 — Cap the week hour-range auto-extend.** A single 06:00 outlier once a month should not redefine every subsequent week. Options: outlier row above the main grid; user-visible hour-range control; cap extension to the current week only (already implicit — document it).
- [ ] **SPEC-16 — Keyboard accessibility.** Calendar entries are `<a>` or `<button>`, not `<div onClick>`. Empty day cells that open the note modal are `<button>` with accessible labels. Tooltip content must be reachable by focus, not hover-only. Today is a real heading / landmark for screen readers.
- [ ] **SPEC-17 — Rename component and folder.** `AnchorCalendar` → `ScheduleCalendar`. `src/components/calendar/` → `src/components/schedule-calendar/`. Avoids a second "calendar" namespace beside `ui-v2/display/Calendar`.
- [ ] **SPEC-18 — Document mutation invalidation requirements.** If subtitles show `bookedSeatsCount`, booking mutations must `revalidateTag('dashboard')` and `revalidatePath('/events')`. Private-booking mutations must also `revalidatePath('/events')` (they currently don't).
- [ ] **SPEC-19 — Legend items derived from permitted kinds.** Don't hard-code. If a user lacks `private_bookings.view`, no Private-bookings item in the legend.
- [ ] **SPEC-20 — Drop the "search filters private bookings as today" claim.** It doesn't. Either implement that (new scope — decide and add) or adjust the spec to match reality.
- [ ] **SPEC-21 — Remove the reference to the existing Playwright smoke test.** No E2E harness found. Either skip (and remove the claim) or add one to scope.
- [ ] **SPEC-22 — Split into multiple PRs.** L is too small for this. Recommended decomposition: (1) data contracts + adapters + tests; (2) `ScheduleCalendar` UI + `/events` migration; (3) `/dashboard` migration with data-layer extension. Each independently deployable.
- [ ] **SPEC-23 — Commit overnight-booking rendering.** Current code forces start-day-only; spec introduces `spansMultipleDays: true` without defining how month/week/list render it. Pick per view.
- [ ] **SPEC-24 — Define same-start stacking in month view.** Two entries starting 19:00 on the same day — order by the tie-break from SPEC-11.
- [ ] **SPEC-25 — Specify the `bookingsCount` aggregation.** Single grouped query or RPC keyed by the returned event IDs, not per-row. Document the SQL shape so IMPL can follow.
- [ ] **SPEC-26 — Preserve corrupt note `end_date < note_date` clamp.** Current adapters guard; new adapter must too. Include in adapter test fixtures.
- [ ] **SPEC-27 — Add a stance on 60s dashboard cache.** Either accept staleness (document it) or add a visible refresh affordance for the calendar panel.

## IMPLEMENTATION CHANGES REQUIRED

These are for when code is actually written (after the revised spec is planned):

- [ ] **IMPL-01 — `getEventsCommandCenterData`:** add `bookedSeatsCount` via a single grouped query over event IDs; join onto the existing event list after paging.
- [ ] **IMPL-02 — `dashboard-data.ts`:** extend `EventSummary` (add `bookedSeatsCount`), `PrivateBookingSummary` (add `end_time`, `end_time_next_day`, `guest_count`). If SPEC-04 requires past data for List view on dashboard, broaden the loaders too.
- [ ] **IMPL-03 — `src/app/actions/events.ts`:** add `revalidateTag('dashboard')` (and/or `revalidatePath('/dashboard')`) to booking create/update/cancel paths. Add `revalidatePath('/events')` to private-booking mutations in `src/app/actions/private-bookings/*`.
- [ ] **IMPL-04 — Delete `EventList.tsx` and `EventGrid.tsx`** if the revised spec absorbs them into `ScheduleCalendar`'s List/Month views. Update `CommandCenterShell.tsx` + `ControlBar.tsx` accordingly.
- [ ] **IMPL-05 — Test fixtures:** DST transition days (last Sunday in March/October), overnight bookings (`end_time_next_day`), corrupt calendar notes (`end_date < note_date`), same-start events, busy day with full titles + guest counts, zero-entry list, zero-past/zero-future combinations, 300-booking stress.
- [ ] **IMPL-06 — Busy-day visual regression guard:** a test that fails if titles ever get a `truncate` / `text-ellipsis` class in month view.

## ASSUMPTIONS TO RESOLVE

These need the user's decision before the revised spec can be finalised:

- [ ] **ASSUMP-01 — Dashboard List view past scroll:** does dashboard need "scroll up for past" (requires loader changes), or is "today forward only" enough on the dashboard? → Ask the user.
- [ ] **ASSUMP-02 — Delete `EventList` / `EventGrid`:** does `ScheduleCalendar`'s List view fully replace the current `EventList` table (Date / Name / Category / Checklist / Actions)? Does anyone still need the `EventGrid` card view? → Ask the user.
- [ ] **ASSUMP-03 — `bookedSeatsCount` definition:** include pending_payment? Expired holds? Just confirmed? → Ask the user (align with their "date taken?" question — probably "not cancelled, not expired").
- [ ] **ASSUMP-04 — Event duration:** add a real `durationMinutes` field and UI to set it, or use a fixed default (2h) for week-view height? → Ask the user.
- [ ] **ASSUMP-05 — Search-filter private bookings:** the spec claims this works today; it doesn't. Implement it (new small feature) or drop the claim? → Ask the user.
- [ ] **ASSUMP-06 — Overnight booking rendering:** start-day-only bar (matches today) or split into two visual blocks? → Ask the user (most natural answer is probably start-day-only with a "+1 day" indicator).
- [ ] **ASSUMP-07 — Status treatment for availability:** should `draft` and `cancelled` events count as "date taken" when scanning the calendar for incoming booking requests? → Ask the user.

## REPO CONVENTIONS TO PRESERVE

- **Design tokens only.** No hardcoded hex in components. Category colours are domain data and remain hex on the entry; kind-default colours become token/class maps.
- **Dates.** Use `src/lib/dateUtils.ts` — `getTodayIsoDate`, `toLocalIsoDate`, `formatDateInLondon`. No raw `new Date()` for display.
- **Supabase clients.** Respect the cookie-based auth client vs service-role admin client split. Adapters must not do DB queries — they're pure transforms.
- **Mobile breakpoint.** `<640px` for the mobile fallback (matches `use-media-query.ts` convention and `private-bookings/CalendarView.tsx` precedent).
- **Existing mobile reference.** `src/components/private-bookings/CalendarView.tsx` already implements a month/agenda mobile toggle — follow its pattern.
- **Test conventions.** Vitest + jsdom + `@testing-library/jest-dom`; `vi.mock('next/navigation')` already globally set up; geometry tests stub `getBoundingClientRect`.
- **Permissions.** Server-filter entries before render (don't rely on destination-page redirects).

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] **CRIT-01 through CRIT-07** → re-review spec after revisions.
- [ ] **CRIT-05 (multi-day bar layout)** → needs a real-browser prototype screenshot; JSDOM cannot verify.
- [ ] Post-implementation visual regression screenshots of the original ellipsis-producing days.

## REVISION PROMPT

You are revising the calendar redesign spec (`docs/superpowers/specs/2026-04-17-calendar-redesign-design.md`) based on an adversarial review in `tasks/codex-qa-review/2026-04-17-calendar-redesign-*`.

Apply in order:

1. **Ask the user** each ASSUMP-01 through ASSUMP-07 question. Wait for answers before editing.
2. **Revise the spec** to address SPEC-01 through SPEC-27. Group by section (Problem / Architecture / Data model / Month / Week / List / Cross-view / Testing / Rollout). Add a "Status vocabulary" subsection. Rewrite "Data model" to define the tooltip boundary decided under SPEC-07.
3. **Rename** every mention of `AnchorCalendar` → `ScheduleCalendar` and every `src/components/calendar/` → `src/components/schedule-calendar/`.
4. **Acknowledge multi-PR scope** (SPEC-22). Replace the single-PR "Rollout" section with a three-PR plan.
5. **Preserve** all items in DO NOT REWRITE verbatim.
6. **Re-run the spec self-review loop** after revision.
7. **Do not** invoke writing-plans until the revised spec is user-approved.

After applying changes, confirm:
- [ ] All 27 spec revisions applied
- [ ] All 7 assumptions resolved by the user
- [ ] Component renamed to `ScheduleCalendar` everywhere
- [ ] No sound decisions from "DO NOT REWRITE" were overwritten
- [ ] Rollout decomposed into three PRs
