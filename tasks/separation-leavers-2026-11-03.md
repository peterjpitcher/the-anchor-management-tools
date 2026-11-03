# Separation: leavers stuck on notice (3 November 2026)

## Trigger

The `employee-separations` job alerted at 06:00 UTC on 3 November 2026: one leaver could not be
marked as Former because "leave booked on 4, 5, 6 November". Employee
`2a38c5d1-1ba6-4b44-90c9-7bfc9fe8c10e`: last working day 28 October, separation started 2 November
(back-dated, resigned by message on 30 October), approved holiday 1 to 8 November booked on 31
August. The job had skipped them every night since 29 October.

## Discovery (read only, production checked)

Checked the separation code, the live `begin_employee_separation` (identical to the repo), every
table that references `employees` or `auth.users`, payroll, holiday allowance, and every path that
messages or lets in a leaver.

Found and fixed in this change:

1. **Leave after the last working day refused finalising.** Only leave after *today* was checked,
   so leave between the last day and today was ignored (a Former leaver, `b15306cb`, still has 63
   days of "unavailable" leave after leaving). The Begin Separation dialog only warned.
2. **Removing the login always failed.** `audit_logs.user_id` and 50 other columns reference
   `auth.users` with no delete action, and every current member of staff with a login (12 of 12)
   is named on `audit_logs`. The hard delete would have left every future leaver with a login and
   a warning email. The same hard delete sat in the "delete an onboarding employee" path.
3. **Sick shifts blocked finalising.** `begin_employee_separation` releases only scheduled shifts,
   so a future sick shift after the last day stalled the job. 7 sick shifts sit after a leaver's
   last day in production (none in the future today).
4. **Clock-ins after the last working day were never mentioned.** They mean either the date is
   wrong or there are hours to pay after it.
5. **Pending open-shift requests stayed in the manager's queue for good** once the person was
   Former (approval refuses them).
6. **The shift-acceptance email reached a Former employee.** On 18 July 2026 an employee marked as
   Former on 16 July was asked to accept shifts: the job reads the published rota, which can still
   list a leaver, and never checked status.

Not changed (payroll): payroll never reads leave, holiday pay is not exported, and there is no
untaken-holiday figure, so removing leave after the last day does not change anyone's pay.

## What changed

- `src/lib/employees/separation.ts`: on finalising, leave after the last working day is removed
  (a request that straddles it is cut to end on it, one that starts after it is deleted, then every
  leave day after it is cleared), with a note on the record and an audit entry per request.
  Only scheduled shifts block. Clock-ins after the last day come back as a warning (the job's
  "needs follow-up" alert). Pending open-shift requests are declined. The login is soft-deleted.
- `src/services/employees.ts`: deleting an onboarding employee soft-deletes their login too.
- `src/app/api/cron/rota-shift-acceptance/route.ts`: no email and no auto-accept for Former staff.
- `src/app/actions/employeeSeparation.ts`, `src/components/features/employees/EmployeeStatusActions.tsx`:
  the Begin Separation preview sees leave before today too (a back-dated last day), and both
  dialogs say leave after the last day is removed automatically.

Leave is removed when the person becomes Former, not when the separation starts, so a cancelled
separation keeps its holiday.

## Not in this change (follow-ups)

- An on-notice person whose last day has passed is still treated as current staff by the portal,
  the timeclock kiosk, rota emails, portal-access invites, signing sends and pickers. With
  finalising no longer stalling, that window is now under a day unless the separation is entered
  late.
- A separation entered with a last day already past is finalised by the next 06:00 run, not at once.
- Open-shift requests and manager assignment can still put an on-notice person on a shift after
  their last day (the database guard covers only "release remaining"); finalising then refuses
  until it is reassigned, with a clear alert.
- Holiday allowance is not pro-rated for starters or leavers, and there is no untaken-holiday
  figure for final pay.
- Historic data: 12 Former staff have no end date; `b15306cb` has 63 leave days after leaving;
  7 sick shifts sit after leavers' last days.
