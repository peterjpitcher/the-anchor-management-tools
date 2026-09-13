# Date defects from the 11 September 2026 review

Two defects found by code review during the email-first messaging work (commit 506c3c69 on
main). Worktree `.claude/worktrees/nifty-brattain-f44283`, branched from origin/main at
506c3c69.

## Defect 1: London "days ahead" and "days ago" helpers

`getLocalIsoDateDaysAhead` and `getLocalIsoDateDaysAgo` in `src/lib/dateUtils.ts` move the
host's calendar with `setDate`. On the UTC server that is n x 24 hours, which lands on the wrong
London date for one hour a night when a clock change falls inside the span.

- [x] Confirm the defect in the current code
- [x] List every caller and what it uses the date for
- [x] Write failing tests at both clock changes (25 October 2026, 28 March 2027)
- [x] Fix with London calendar arithmetic (`shiftIsoDate(toLocalIsoDate(now), n)`, the
      approach of `londonDateDaysAhead`, commit ee5d18ed)
- [x] Prove the result is unchanged on ordinary days (exhaustive old vs new comparison)
- [x] Sweep the app for the same pattern and record what it cleared
- [x] Gates: lint, tsc, `npm test`, `npm run test:utc`, cold build
- [x] Commit on `fix/london-date-days-ahead`

## Defect 2: one-day event reminder held by quiet hours

`processReminders` in `src/app/api/cron/event-guest-engagement/route.ts` sends the reminder
from 24 hours before the start. Due at 21:00 or later, quiet hours hold it to 09:00 on the
event day, where it says "is tomorrow".

- [x] Find the sender, the timing and the quiet-hours hold
- [x] Confirm the scenario with a test at the real instants
- [x] Smallest fix, on its own branch, not merged or deployed
- [x] Render the before and after wording for the owner
- [x] Gates, then commit on `fix/event-reminder-landing-day`
- [ ] Owner approval of the wording, then merge and deploy

## Results

All gates ran on Node 20.19.5 against origin/main at a32f9b30. Nothing is pushed.

### Defect 1: commit e9bc0829 on `fix/london-date-days-ahead`

- Both helpers now return `shiftIsoDate(getTodayIsoDate(), n)`. A fractional day count throws
  (every caller passes an integer).
- Callers: dashboard (14 ahead), dashboard-data (90 ago, 180 ahead, 90 ahead, 90 ago), calendar
  datasets (90 ago, 180 ahead), vouchers ledger buckets (30, 31, 90, 91, 180, 181 ago),
  import-messages default (7 ago), quotes page and convert action (30 ahead), business hours
  API special hours (90 ahead), crons table-booking-confirm (1 ahead, 10:00 UTC),
  preorder-reminders (cutoff days ahead, 12:00 UTC), communications-retention (730 ago, 03:30 UTC
  Sundays), client components DishOverviewTab (56), voucher handout (30, 60, 90), RightToWorkTab
  (30).
- Old against new, every 15 minutes from 11 September 2026 to 31 December 2027, for every day
  count above: under UTC 10,132 of 686,880 checks differ, all in the 23:00 or 00:00 London
  hour, all by exactly one day; under Europe/London none differ. A 90-day window met the bad
  hour on about half the nights, a 180-day window on about four nights in five. The three crons
  never run in those hours, so their output is unchanged.
- Tests: 16 new in `src/lib/__tests__/dateUtils.test.ts`. The 12 clock-change cases failed on
  the old code under `npm run test:utc` and passed under `npm test`.
- Gates: lint 0, tsc 0, `npm test` and `npm run test:utc` 825 files, 7,809 passed, 2 skipped;
  cold build passed.
- Website: does not use these helpers; its events window already shifts London dates
  (`shiftLondonIsoDate`, lib/api/events.ts). No counterpart change.

### Defect 2: commit e6bd2c7a on `fix/event-reminder-landing-day` (awaiting owner approval)

- Sender: `processReminders` in `src/app/api/cron/event-guest-engagement/route.ts`, template
  `event_reminder_1d`, due at start minus 24 hours, cron every 15 minutes. `sendSMS`
  (`src/lib/twilio.ts`, quiet hours from `src/lib/sms/quiet-hours.ts`) holds anything from 21:00
  to 09:00.
- Affected before the fix: any start after 20:45 (held to 09:00 on the event day, every week);
  on Sunday 25 October 2026 any start after 19:45; on Sunday 28 March 2027 any start after 21:45.
- Fix: `resolveEventReminderDay` in `src/lib/events/reminder-eligibility.ts` works out when the
  text lands. The day before: wording unchanged. The event day: "is today" and no second
  "tomorrow". After the start: not sent. Send time unchanged.
- Tests: 11 route cases in `tests/api/eventGuestEngagementReminderDay.test.ts` (6 failed on the
  old route in both zones, 5 unchanged cases passed before and after), 6 helper cases in
  `tests/lib/eventReminderEligibility.test.ts`.
- Gates: lint 0, tsc 0, `npm test` and `npm run test:utc` 826 files, 7,810 passed, 2 skipped;
  cold build passed.

### Same patterns elsewhere, not changed here

Verified in the code:

1. `src/app/actions/timeclock.ts` lines 603 and 711: a manually entered overnight session moves
   the clock-out to the next day by adding 24 hours, so it is stored an hour short on
   25 October 2026 and an hour long on 28 March 2027. Affects pay.
2. `src/lib/google-calendar.ts` `combineDateAndTime` (`addDays` on an instant): a calendar end
   time after midnight is an hour out on the two clock-change nights.
3. `src/app/actions/missing-cashups.ts`: formats host dates with date-fns, so on the server the
   range uses the UTC date, which is wrong from 00:00 to 00:59 London every night in BST.
4. The 24-hour promotional follow-up (`src/lib/sms/cross-promo.ts` lines 347 and 368, sent by
   `processFollowUps`) says "is tomorrow" and is held the same way for guests first eligible
   after 21:00 the day before. Runs only while `event_promo_last_push` is off.
5. The parking "offer expires tomorrow" text (`src/lib/parking/notifications.ts` line 65, sent
   when under 24 hours remain): an offer due after about 20:45 gets it held to 09:00 on the day
   it expires.

Reported by the sweep but not verified line by line: next-day end times in
`google-calendar-events.ts`, `api/foh/schedule` and `api/foh/events`; UTC date reads in
`get-outstanding-counts.ts`, `cashing-up.service.ts`, `financials.ts`, the birthdays page and
`api/rota/resync-calendar`; a double London offset in the rota-staff-email and
rota-manager-alert crons (right at their scheduled times); the private-booking-monitor windows
(right at 09:00 UTC); client-only date defaults in private-bookings/new and HoursVersionStrip.

Cleared: the two inline copies in `src/app/actions/event-categories.ts` are never called;
invoices/new anchors on UTC midnight and is right on either host; the local `shiftIsoDate`
copies in the FOH code are UTC-anchored.
