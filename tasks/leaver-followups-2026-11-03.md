# Leaver follow-ups, 3 November 2026

Branch `fix/leaver-followups`, from `main` at `5913d75e6` (PR 303 merged). Follows
`tasks/separation-leavers-2026-11-03.md` and `tasks/leavers-past-last-day-2026-11-03.md`.

## What changed

1. **Back-dated separations finish at once.** `beginEmployeeSeparation`
   (`src/app/actions/employeeSeparation.ts`) calls `finalizeEmployeeSeparation` straight after the
   separation starts when the last working day is before today (London date), as the morning
   `employee-separations` job would. A refusal keeps the separation and says so; the job tries
   again next morning. The dialog says a past date marks them as Former at once, and the toast
   says it was done.
2. **Holiday is pro-rated for starters and leavers.** `getHolidayEntitlement`
   (`src/lib/leave/working-days.ts`) scales the yearly allowance by the calendar days of the
   holiday year they are employed for (Working Time Regulations 1998, regs 13 and 14). Used by
   `getHolidayUsage` (rota leave manager and its "over allowance" flag) and the employee
   Holidays tab, which also says how it was pro-rated.
3. **Untaken holiday for final pay.** The Holidays tab shows a leaver's untaken holiday at their
   last working day. Marking someone as Former writes it to their record as a note (earned, taken,
   untaken) and into the `access_revoked` audit row (`untaken_holiday`). If it cannot be worked
   out, the note says to check by hand; the separation never waits on it.
4. **Database backstop for shifts after the last day.** Migration
   `20261104143348_guard_shifts_after_last_working_day.sql` (drafted as 20261103145125) adds trigger
   `guard_shift_after_last_working_day` on `rota_shifts`: a new assignment or a moved date after
   the last working day of someone on notice or Former is refused, whatever their separation
   policy. Edits to rows already on the rota still save. Tested by
   `scripts/testing/shift-after-last-working-day-postgres.py`. On its own branch,
   `feat/shift-last-day-guard`, so main never holds a migration production has not had; it merges
   once applied, renamed to its applied version. The app's own check already refuses these writes,
   so items 1 to 3 do not depend on it.
   Applied to production on 4 November 2026 at 14:33 UTC with the owner's yes (checksum
   6693550c...4d87b unchanged). Smoke-tested in transactions that rolled back: a new shift or a
   moved date after the last day was refused, the last day itself, an edit to an existing row and
   a cancelled shift were allowed, and a signed-in manager session was refused the same way. The
   guard reads `employees` as the caller (SECURITY INVOKER, like the existing guard), so it relies
   on the writer seeing the employee: true for the service-role writes the rota actions use, and
   for every live role that can edit the rota, all of which can view employees.
   Review follow-up (Codex on PR 305): INSERT ... ON CONFLICT runs the guard as an INSERT before the
   conflict is resolved, so the rota's snapshot restore (an upsert of a whole published week) would
   be refused in full by one historic row after a leaver's last day. Migration
   `20261104144148_guard_shifts_after_last_working_day_upsert.sql` lets an upsert through when the
   row is already on the rota with the same employee and date; anything else is checked as before.
   No week met the restore condition on 4 November, so nothing had been refused. Needs its own
   approval before it is applied.

## Assumptions

- Pro-rating counts calendar days, matching how leave is counted (every day, weekends included).
- Entitlement is rounded to one decimal place, never to a whole or half day: rounding is a pay
  decision the app does not make.
- The allowance pro-rated is whatever is set for the person (or the default); the app has no
  separate irregular-hours (12.07%) accrual and this change does not add one.
- A Former person with no last working day recorded keeps the whole allowance.
- The untaken holiday figure is not emailed: owner rule of 2 November, email only when something
  is wrong. It is on the record and the Holidays tab.

## Data found (live, 3 November)

- 12 Former staff have no last working day. Six have a last shift and clock-in on the same day,
  the other six have no shifts or clock-ins in the app at all.
- `b15306cb` has one approved "cannot work (not holiday)" request, 29 June to 30 August 2026,
  after their last day of 26 June. It does not count against holiday.
- Seven sick shifts sit after leavers' last days. They no longer block anything (only scheduled
  shifts block finalising), and the new trigger leaves edits to them alone.
