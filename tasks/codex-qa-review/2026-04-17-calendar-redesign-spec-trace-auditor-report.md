# Spec Trace Audit — Calendar Redesign

## Inspection Inventory

Reviewed spec: `docs/superpowers/specs/2026-04-17-calendar-redesign-design.md`.

Repo facts checked:
- Current `/events` has two view layers: outer `calendar | grid | list` in `ControlBar` / `CommandCenterShell`, and inner `month | week | day` inside `EventCalendarView`.
- Current generic calendar truncates/caps month events: `dayEvents.slice(0, 3)`, `+N more`, and `truncate` in `src/components/ui-v2/display/Calendar.tsx:397-424`.
- Current week/day render 24 hours; week uses `Array.from({ length: 24 })` in `Calendar.tsx:439`.
- Current dashboard calendar supports `month | week | day`, no list view, in `UpcomingScheduleCalendar.tsx:172`.
- Dashboard parking click currently routes to `/parking`, not `/parking/:id`, in `UpcomingScheduleCalendar.tsx:550-551`.
- Existing tests only cover generic calendar midnight/start-day behavior in `tests/components/Calendar.test.tsx:5-60`; there are no busy-day, list-anchor, dashboard schedule, parking, or `AnchorCalendar` tests.

## Requirements Coverage Matrix

| User pain | Spec section | Concrete? | Acceptance criterion? | Verdict |
|---|---:|---|---|---|
| Busy month days render titles as `...`; user needs full details even if calendar grows. | Problem L11; Month layout L82; entry block L91-L92; risk accepted L196. | Mostly. Variable-height rows plus wrapping and “Never collapses to `...`” is buildable. | Partial: month test says “full titles visible” L186, visual regression L209. But a DOM text test would still pass with CSS ellipsis/truncation. | Covered directionally; test needs visual/CSS guard. |
| Month needs full name plus guest/bookings count. | Goals L19; data model subtitle L65; adapters L72-L76; entry subtitle L92; data addition L41. | Partial. Event `bookingsCount` is specified, but dashboard private bookings currently do not load `guest_count`; spec does not add it to `loadDashboardSnapshot`. | Weak. Adapter shape tests L182 may catch subtitle shape, but month component test L186 does not explicitly assert `22 booked` / `40 guests` visible. | Partially buildable; dashboard data gap. |
| Week view is horrible, full-day, too long, hard to use. | Problem L12; goal L20; week range L110-L121. | Mostly. 12:00-23:00, auto-extension, 40px/hour, overlap rules are concrete. | Partial. Week test L187 checks 10:00 extension and overlap, but not default removal of 00:00-11:00 or total viewport height. | Covered, with test gaps. |
| Drop Day view; keep Month, Week, List. | Problem L13; new component L34; switchers L104/L126. | Yes for `AnchorCalendar`. | Missing explicit test that Day option is gone. | Covered, but conflicts with current outer events view model. |
| “Notes don’t show properly,” clarified as same ellipsis bug. | Month full title L91; multi-day bars L88; tests L186. | Partial. The ellipsis part is covered; spec also adds multi-day note bars, which is extra behavior. | Partial. No note-specific busy-day title/wrap assertion; multi-day only tested in month L186. | Covered for the clarified bug, but extra note behavior needs tighter spec. |
| List opens on historic items; user wants today, with past above by scrolling up. | Goals L21; list layout L130-L138; data scope L152-L155. | Yes for component mechanics. | Yes-ish: list test L188 asserts chronological order and `scrollIntoView({ block: 'start' })`. | Covered for events page; dashboard data assumptions are wrong. |
| Past/future list needs visual separation. | Group headers L132-L138; past styling L148-L150. | Buildable. | L188 checks reduced opacity class. | Covered mechanically; accessibility risk noted below. |
| Build a new shared component and replace events + dashboard. | Architecture L33-L42; rollout L214-L221. | Mostly. New files and call sites are named. | Migration smoke L207-L209. | Direction is good, but not yet buildable due to view-switcher and dashboard data contradictions. |
| Dashboard shows parking and gets all three views. | Changed file L40; kind L54; parking adapter L76; legend L160; risk L199. | Partial. Parking exists, but `/parking/:id` does not exist; current app routes to `/parking`. | Missing dashboard component test. | Not buildable as written. |
| “Is this date free for an incoming booking request?” | Problem L9; goal L19; month view L78-L99. | Partial. Showing all entries supports this, but there is no explicit availability affordance. | No acceptance criterion proves fast availability checking. | Under-specified. |

## Missing Requirements

- **Whole page is too long:** The spec names this at L15, but the solution mostly addresses week height via L110-L118. Month may intentionally grow on busy months L196. There is no requirement like “week fits without vertical scroll at desktop,” “calendar body is viewport-bounded,” or “list has an internal scroll container.”
- **Available-date check affordance:** The spec names the use case at L9/L19, but only offers dense month entries. There is no “available / occupied” signal, kind filter, or toggle to hide calendar notes if notes clutter availability checks. The legend L159-L161 labels types but does not let the operator reduce noise.
- **Events page view hierarchy:** Spec says `AnchorCalendar` handles Month/Week/List L34, but also says existing `ControlBar` with view switcher stays above calendar L164. Current `ControlBar` is `calendar | grid | list`, where list is separate `EventList`. The spec does not say whether old Grid/List remain, are removed, or are replaced by `AnchorCalendar`’s List.
- **Dashboard private-booking guest counts:** User confirmed full name + guest count. Events page private bookings have `guest_count`; dashboard summaries do not. Spec does not add `guest_count` or accurate end-time fields to dashboard private-booking data.
- **Dashboard list past accessibility for all kinds:** Spec says dashboard list uses a “30-day past + future window currently loaded” L154, but the repo loads 25 past events, 25 upcoming events, upcoming private bookings only, and upcoming parking only. Past private bookings/parking cannot be scrolled to without data changes.

## Ambiguities / Contradictions

- **Month row height vs multi-day bars:** L82 says each row grows to fit the busiest day’s cell content. L88 says multi-day bars are absolutely positioned per week row. If bars are absolute, they will not naturally contribute to content height. The spec must define reserved all-day-band height and whether it participates in the row-height calculation.
- **Week duration math:** L118 sets `1 hour = 40px`; L119 expects time/title/subtitle lines; L120 collapses under ~45 minutes. But `EventOverview` currently has no `end`, `end_time`, or `duration_minutes`; the spec only adds `bookingsCount` L41. It must define event duration derivation.
- **Past opacity accessibility:** L149 says past rows render at 60% opacity. That reduces text contrast for every child element and may fail WCAG. Use explicit muted colors/backgrounds with contrast targets instead.
- **Mobile fallback:** L176-L177 says Month/Week automatically fall back to List, but also says the switcher lets operators manually force Month/Week. That needs precise behavior: does selecting Month render Month, or silently render List while Month is selected?
- **Parking route:** L76 specifies `onClickHref: '/parking/:id'`; the repo has no authenticated `/parking/[id]` page. Current behavior routes to `/parking`.
- **Pure adapters vs `tooltipBody: ReactNode`:** L36 calls adapters pure functions, while L67 requires `tooltipBody: ReactNode` and L39 says callers retain tooltip builders. Decide whether adapters return serializable data and wrappers provide renderers, or adapters own React nodes.

## Testing Coverage Gaps

- **Busy-day ellipsis regression:** L186 says “full titles visible,” but that can pass while CSS still truncates visually. Add a busy April 25/26-style fixture, assert no `truncate`/ellipsis class on title text, assert wrapping styles, and include a Playwright/visual check from L209 focused on the busy day.
- **Guest/bookings count visibility:** Tests should assert `22 booked`, `40 guests`, and dashboard parking subtitles render in Month, Week, and List where applicable.
- **Today anchor:** L188 covers `scrollIntoView({ block: 'start' })`; also test the floating Today button from L138 and behavior when there is no Today group in the loaded window.
- **Multi-day notes:** L186 covers month single-bar behavior. Add week all-day-band coverage from L114-L115 and assert the title is not repeated in each day cell.
- **ControlBar integration:** No test proves the old events `calendar/grid/list` switcher will not conflict with the new Month/Week/List switcher.
- **Dashboard migration:** Add tests for dashboard three views, parking rendering, parking click target, tooltip preservation, and private booking guest count after data enrichment.
- **Mobile fallback and accessibility:** No tests cover L176-L177 or the opacity contrast issue from L149.

## Verdict

Not ready to implement as written.

The spec captures the main product direction: variable-height Month, condensed Week, today-anchored List, shared component, dashboard reuse. But it needs a revision pass before planning because several requirements are not buildable against the repo: the events page has an unresolved dual view-switcher model, dashboard data does not match the spec’s list/guest-count assumptions, and the parking detail URL is invalid.

Highest-priority fixes: define the events page view hierarchy, correct the dashboard data contract, specify month all-day-bar height behavior, clarify mobile fallback, and strengthen tests so the original `...` bug would actually fail.