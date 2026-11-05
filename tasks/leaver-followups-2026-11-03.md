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

   **Items 2 and 3 were removed on 4 November 2026** (branch `fix/remove-final-pay-holiday`). The
   owner: "Staff don't earn holidays, they get paid them as part of their pay." The worker
   agreement (`src/lib/worker-agreement-template.ts`) makes staff irregular-hours workers on
   rolled-up holiday pay, 12.07% paid on every payslip, so there is no untaken holiday to pay or
   claw back when someone leaves, and the final-pay figures were wrong. The Holidays tab, the
   leave pages' allowance, `getHolidayUsage` and `finalizeEmployeeSeparation` are back exactly as
   they were before PR 304. No untaken-holiday note had been written in production. Item 1 stays.
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
   `20261104144422_guard_shifts_after_last_working_day_upsert.sql` (drafted as 20261104144148) lets
   an upsert through when the row is already on the rota with the same employee and date; anything
   else is checked as before. No week met the restore condition on 4 November, so nothing had been
   refused. Applied with the owner's yes on 4 November at 14:44 UTC (checksum faf7d4f6...388fa6
   unchanged) and smoke-tested in rolled-back transactions: an unchanged upsert of a row after a
   last day saved; an upsert handing an existing shift to a leaver, or adding a new row, after the
   last day was refused; the earlier cases behaved as before.

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

## Holiday requests filed under the wrong year (5 November)

- Found while checking PR 306: 23 leave requests (14 staff), all entered on 6 March 2026 while the
  holiday year still began on 6 April, kept their April-based `holiday_year`. The setting is now
  1 January (matching the worker agreement), so the Holidays tab and the rota leave page listed
  them under the year before the one their days count in. Totals were always right (they read the
  dated `leave_days` rows); only the list and the "Allowance used" label were off. Example: Laura
  B's 10 to 27 February 2026 holiday was listed under 2025/26, so her 2026/27 list showed 19 of
  the 37 days counted.
- Owner said yes on 5 November. Migration
  `20261105163417_restamp_leave_request_holiday_year.sql` (drafted as 20261105163320, checksum
  d6c53284...ee37f36d) recomputes `holiday_year` with `holiday_year_for_date` where it differs, and
  stops if more than 23 rows would change. Dry run in a rolled-back transaction: 23 changed, 0 left
  wrong, rollback restored all 23 and the table matched its starting state. Applied 16:34 UTC:
  23 rows updated, 0 mismatched of 193. The only trigger on `leave_requests` sets `updated_at`;
  nothing was sent or synced.
- Checked live: Laura B's Holidays tab lists all four 2026/27 requests (37 days, matching the
  total); the rota leave page shows her February request as holiday year 2026/27, allowance used
  37 / 25.
- Rollback: `supabase/rollbacks/20261105163417_restamp_leave_request_holiday_year.sql` puts the 23
  back by id, only where they still hold the new year.
