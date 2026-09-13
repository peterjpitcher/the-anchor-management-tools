# Timeclock sessions across the clock changes, 11 September 2026

Follows item 1 of the sweep in `tasks/date-defects-2026-09-11.md` (branch
`fix/london-date-days-ahead`). Branch `fix/timeclock-overnight-clock-change`, commit c1b397f0,
rebased on origin/main 339bfcf1. Nothing is pushed.

- [x] Confirm the defect: `createTimeclockSession` and `updateTimeclockSession` added 24 hours
      to an overnight clock-out
- [x] Check how the missing and repeated hours resolve, and choose
- [x] Check the other timeclock paths for the same pattern
- [x] Tests at both clock changes and an ordinary night, under `npm test` and `npm run test:utc`
- [x] Gates and commit
- [ ] Owner approval to push, merge and deploy (before Sunday 25 October 2026)
- [ ] Read-only production check of sessions across past clock changes, once the owner agrees

## Results

- Old behaviour, measured in tests: 20:00 to 02:00 on Saturday 24 October 2026 stored ending at
  01:00 GMT (6 hours, not 7); on Saturday 27 March 2027 ending at 03:00 BST (6 hours, not 5).
  A repeated-hour clock-out (01:30 on 25 October) was stored as the first 01:30. A date that
  does not exist (2026-02-30) was stored as 2 March; "24:30" threw a RangeError.
- Choice for the clock-change hours: a time from 01:00 to 01:59 is read as the later moment it
  could mean. Missing hour (28 March): 01:30 is 01:30 GMT, shown as 02:30 BST, the same as the
  old code. Repeated hour (25 October): the second 01:30, GMT, an hour later than the old code.
- Edits keep a time the manager did not change exactly as stored, because both edit screens
  send both times back as HH:mm on every save.
- Same pattern fixed: the premium window boundary on the timeclock manager screen.
- Checked, no change: kiosk clock-in and clock-out, rota-auto-close cron, premium resolver and
  paid hours in `src/lib/rota/pay-math.ts`, shift starts in `src/app/actions/payroll.ts`, and the
  UTC-anchored date shifts across the rota code.
- History: the table was created by `20260228100000_rota_system.sql` and the 24-hour code
  shipped on 2 March 2026 (c5d688ea); before that an overnight manual entry was refused. No
  session from 2025 went through it unless someone back-dated a manual entry. The one clock
  change with it live was Sunday 29 March 2026. Computed old against new: a manual or edited
  overnight clock-out typed at 02:00 or later on the night of 28 to 29 March, or from 00:00 to
  00:59 on the night of 29 to 30 March, was stored an hour late (an hour over-paid). Times typed
  from 00:00 to 01:59 on the first night, and from 01:00 on the second, came out the same.
- Gates on Node 20.19.5: lint 0, tsc 0, `npm test` and `npm run test:utc` 838 files, 7,963 passed,
  2 skipped; cold build passed.

Not changed, found on the way: `updatePayrollRowTimes` in `src/app/actions/payroll.ts` passes no
notes to `updateTimeclockSession`, which writes `notes: notes ?? null`, so a time edit from the
payroll screen clears the session's notes.
