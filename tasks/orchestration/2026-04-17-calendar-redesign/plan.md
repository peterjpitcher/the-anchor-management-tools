# Orchestration Plan — Calendar Redesign

**Source plan:** `docs/superpowers/plans/2026-04-17-calendar-redesign.md`

## Plan Summary
Implement the calendar redesign across `/events` and `/dashboard` by building a new `ScheduleCalendar` component and migrating both pages to it. Three natural phases map to three PRs in the source plan.

## Work Streams
| # | Agent | Wave | Depends On | Outputs |
|---|-------|------|-----------|---------|
| A | Library | 1 | None | `src/components/schedule-calendar/types.ts`, `sort.ts`, `hour-range.ts`, `adapters.ts` + tests |
| B | Events backend | 1 | None | Modified `get-events-command-center.ts`, `CommandCenterShell.tsx` (search filter), `events.ts` + `privateBookingActions.ts` revalidation |
| C | Dashboard data | 1 | None | Modified `dashboard-data.ts` (EventSummary, PrivateBookingSummary, past loaders) |
| E | Month view | 2 | A | `ScheduleCalendarMonth.tsx` + tests |
| F+G | Week + List views | 2 | A | `ScheduleCalendarWeek.tsx`, `ScheduleCalendarList.tsx` + tests |
| H | Wrapper + events migration | 3 | A, E, F+G | `ScheduleCalendar.tsx`, `index.ts` + tests; migrated `EventCalendarView.tsx`, `CommandCenterShell.tsx`, `ControlBar.tsx`; deleted `EventList.tsx`, `EventGrid.tsx` |
| I | Dashboard migration + cleanup | 4 | A, C, H | Migrated `UpcomingScheduleCalendar.tsx`; deleted `EventCalendar` re-export |

## Wave Structure
- **Wave 1** (3 agents in parallel): A, B, C — independent data/library work.
- **Wave 2** (2 agents in parallel): E, F+G — depend on Wave 1's library.
- **Wave 3** (1 agent): H — depends on Wave 2's views.
- **Wave 4** (1 agent): I — depends on Wave 3's wrapper.

Total: 7 agents, 4 waves.

## Integration policy
- Agents **do NOT commit**. They write files, run tests, report via `handoff.md`.
- Orchestrator (Claude) reviews at each wave gate, runs lint/typecheck/test/build, and commits wave work in one coherent commit per wave.
- Final adversarial review via `codex-qa-review` before delivery.

## Workspace
- `tasks/orchestration/2026-04-17-calendar-redesign/wave-N/<agent>/handoff.md` — each agent writes here.
- `tasks/orchestration/2026-04-17-calendar-redesign/verification/` — wave gate + final verification results.
