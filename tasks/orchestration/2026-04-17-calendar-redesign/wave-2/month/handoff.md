# Wave 2 · Month — Handoff

## Outputs
- `src/components/schedule-calendar/ScheduleCalendarMonth.tsx`
- `tests/components/schedule-calendar/ScheduleCalendarMonth.test.tsx`

## Test results
- 3/3 pass (`npx vitest run tests/components/schedule-calendar/ScheduleCalendarMonth.test.tsx`)
  - renders full titles on busy days without truncation
  - renders multi-day notes as a single bar not per-day repeats
  - renders cancelled entries with strikethrough class

## Typecheck
- clean (`npx tsc --noEmit`)

## Truncation guard
- `grep -n "truncate\|text-ellipsis" src/components/schedule-calendar/ScheduleCalendarMonth.tsx` returns zero matches.

## Assumptions made
- `EntryBlock`: spec only described the `<a href>` path; when `entry.onClickHref` is null, rendered a `<button type="button">` instead so keyboard semantics and `onEntryClick` still work for entries without a destination URL (e.g. calendar notes). Classes/style are identical.
- Band bar status styling: the plan's skeleton did not apply status styling to band bars, but the spec says cancelled/postponed/rescheduled get `text-muted-foreground/80` overall and cancelled gets `line-through`. Applied the same muted + strikethrough rules to band bars so a cancelled multi-day note still reads as cancelled.
- Band `endCol` fallback: when a band's visible end falls on the last day of the week, `findIndex` still resolves correctly, but added a `safeEnd` fallback mirroring `safeStart` for defence-in-depth (never produces a negative span).
- Did not hide the `HH:mm` prefix for timed entries (spec skeleton had it). For timed entries titles are prefixed with formatted start time; for the rare case of an all-day single-day entry falling into the per-day list, the `HH:mm` is suppressed to avoid `00:00` noise.
- `title` attribute on entry blocks is only set when no `renderTooltip` is supplied, so the wrapper (Wave 3) can safely layer its own tooltip without duplicate native tooltips.

## Notes for downstream (Wave 3 wrapper)
- Props: `entries`, `anchor`, `firstDayOfWeek`, `onEntryClick?`, `onEmptyDayClick?`, `renderTooltip?`. All except the first three are optional. `ScheduleCalendarMonthProps` is exported.
- Titles use `data-entry-title` attribute (testing hook + integration point for tooltip wrapping if needed).
- Empty-day-click: only fires on the day-number button when the click target is the button itself (prevents bubbling from child clicks inside the day cell).
- Colour system: uses `entry.color` inline via `borderLeftColor` + `${color}10` (day cells) / `${color}15` (band). Kind-colour mapping is assumed to be set upstream in the adapters.
- No `truncate` / `text-ellipsis` anywhere — titles wrap via `whitespace-normal break-words`. Please preserve this invariant if you extend the component.
