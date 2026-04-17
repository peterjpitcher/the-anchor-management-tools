# Wave 2 · Week + List — Handoff (orchestrator-reconstructed)

The original Wave 2 Week+List agent produced all four files but hit an API overload before writing its own handoff. The orchestrator verified the outputs and writes this note on its behalf.

## Outputs
- `src/components/schedule-calendar/ScheduleCalendarWeek.tsx`
- `src/components/schedule-calendar/ScheduleCalendarList.tsx`
- `tests/components/schedule-calendar/ScheduleCalendarWeek.test.tsx`
- `tests/components/schedule-calendar/ScheduleCalendarList.test.tsx`

## Test results
- Week: 3/3 pass
- List: 4/4 pass (after orchestrator-level fix to advance fake timers for the rAF-driven scrollIntoView assertion — see below)

## Orchestrator-level fix applied
- `ScheduleCalendarList.test.tsx`: the scroll-anchoring test mocked `scrollIntoView` but used `vi.useFakeTimers()` globally. Because `requestAnimationFrame` is faked under that harness, the rAF callback never fired and the mock was never called. Fix: added `vi.runAllTimers()` after `render` and before the assertion. Component behaviour is unchanged.

## Typecheck
- `npx tsc --noEmit` clean.

## Checks
- `grep -c "truncate\|text-ellipsis"` on both component files: 0.
- `grep -c "opacity-60\|opacity-50"` on List: 0.

## Notes for downstream (Wave 3 wrapper)
- `ScheduleCalendarWeek` props: `entries`, `anchor`, `firstDayOfWeek`, `onEntryClick?`, `renderTooltip?`.
- `ScheduleCalendarList` props: `entries`, `onEntryClick?`.
- Both exported via named imports from their file; the Wave 3 wrapper needs an `index.ts` barrel to re-export them.
