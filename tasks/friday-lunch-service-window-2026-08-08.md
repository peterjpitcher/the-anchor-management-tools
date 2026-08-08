# Friday lunch service window fix (2026-08-08)

`business_hours.schedule_config` for Friday advertised a `lunch` service
12:00-14:30, but Friday `opens` is 16:00 and the kitchen runs 16:00-21:00.
Owner confirmed 8 August 2026 that Friday food starts at 16:00.

## Live schema (queried before changing anything)

`schedule_config` is `jsonb DEFAULT '[]'` on two tables, `business_hours` and
`special_hours`. No views depend on either table, so nothing froze a column list.

## Audit of every slot against its own day

| Row | Slot | Type | Window | Verdict |
|---|---|---|---|---|
| Sunday | sunday_lunch | sunday_lunch | 13:00-18:00 | ok (kitchen 13:00-18:00) |
| Mon | none | | | ok |
| Tue/Wed/Thu | dinner | regular | 17:00-21:00 | ok |
| **Friday** | **lunch** | **regular** | **12:00-14:30** | **before opens 16:00** |
| Friday | dinner | regular | 17:00-21:00 | ok |
| Saturday | lunch | regular | 12:00-14:30 | ok |
| Saturday | dinner | regular | 17:00-21:00 | past kitchen close 19:00, see below |
| special 2026-05-07 | dinner | regular | 17:00-21:00 | kitchen closed that day, historic |
| special 2026-05-09 | lunch/dinner | regular | 12:00-14:30 / 17:00-21:00 | outside kitchen 13:00-19:00, historic |
| special 2026-07-05 | sunday_lunch | sunday_lunch | 13:00-16:00 | ok |

Friday was the only slot starting before its day opens. The three special_hours
rows are all in the past.

## Live impact, narrower than first reported

A Friday 12:00 booking could not actually be created:

- The website resolves food windows from `booking_type === 'food'` entries.
  Every live entry is `regular`, so it falls back to the kitchen window
  (16:00-21:00) and never offered a 12:00 food slot.
- The live `create_table_booking_v05` independently enforces pub hours and
  kitchen hours and returns `blocked / outside_hours` for Friday 12:00.
  Confirmed via `debug_booking_hours('2026-08-14','12:00')`.

So this was wrong published hours, not a bookable hole. Worth knowing: the live
`create_table_booking_v05` no longer calls
`table_booking_matches_service_window_v05` at all, so `schedule_config` is not
currently enforced at booking time. Not changed here.

## Knock-on defect found and fixed

`src/app/api/business/hours/route.ts` derived the venue-wide
`services.kitchen.lunch` / `.dinner` from **Friday alone** (`dayOfWeek = 5`
hardcoded default), then fell back to a hardcoded `12:00:00-14:30:00`. Removing
the Friday entry alone would have left the API still publishing a 12:00-14:30
lunch service. It now scans every day and reports null rather than inventing a
window. It was also unsafe on `s.name` for the Sunday row, which has no `name`.

## Changes

1. `20260808120000_validate_schedule_config_windows.sql`
   - removes the Friday lunch entry, keeping dinner
   - adds `validate_schedule_config()` + BEFORE INSERT/UPDATE triggers on both
     tables: slots must be HH:MM, must sit inside the day's opens-closes, and
     `food` / `sunday_lunch` slots must also sit inside kitchen hours.
     `regular` is deliberately excluded from the kitchen rule because it gates
     drinks bookings too. Midnight-spanning sessions are handled.
2. `route.ts` `findServiceTimes` as above.
3. `business-hours.ts` passes through the guard's message (check_violation
   23514 only) so staff see which slot is wrong instead of a generic failure.

## Verification

- Simulated the guard against every existing row first: all accepted.
- typecheck 0, lint 0, tests 613 files / 4616 passed.
- Applied to prod via `db push` (dry run showed only this migration pending).
- Re-adding the Friday lunch entry is rejected:
  `"lunch" runs 12:00-14:30 but the venue is only open 16:00-22:00`
- A `sunday_lunch` slot past kitchen close is rejected on the kitchen rule.
- A valid write still succeeds (no false positives).
- Public API now returns Friday with the dinner slot only.

## Open, needs an owner decision

Saturday's `dinner` slot runs 17:00-21:00 but the Saturday kitchen closes at
19:00. Its `booking_type` is `regular`, which gates drinks as well as food, so
the guard accepts it and food bookings are still clamped to 19:00 by the kitchen
check. It is not breaking anything today, but "dinner until 21:00" on a day the
kitchen shuts at 19:00 is misleading. Either shorten the slot to 17:00-19:00 or
extend the Saturday kitchen hours.
