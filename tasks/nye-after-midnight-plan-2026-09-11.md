# After-midnight defects on a 1am close (New Year's Eve 2026), 11 September 2026

Branch `fix/nye-after-midnight` (management app) and `fix/nye-open-until` (website), both cut from
origin/main. Production: 31 December 2026 is 12:00 to 01:00, 1 January 2027 is closed, every
regular day closes at 22:00 (checked live, read only).

## Verified (read the code, and the live rows where they matter)

1. FOH auto-return and page load use the calendar date; the schedule route gives a closed day an
   invented 09:00 to 23:00 window. Confirmed.
2. Walk-ins: only the calendar date is allowed; the time suggestion ignores the late tail; the
   walk-in fallback insert builds its start from date plus time, so 00:31 on the 31 December
   session lands at 00:31 on 31 December. Confirmed.
3. Change time: the new start is built on the old start's calendar date. Confirmed, both ways
   (22:00 to 00:15 lands a day early; 00:15 back to 23:30 would land a day late).
4. Missing cash-ups: range ends at the host's calendar yesterday. Confirmed.
5. Website header prints today's close (none on 1 January); WeekHours says "Open now" beside
   "Closed". Confirmed.
6. fromZonedTime for clock times in checklists (expandInstants), screening hours (instant) and
   the FOH schedule (toLondonIso, and +24h for a private booking's late end). Confirmed.
7. Same pattern, found while verifying: the BOH booking edit builds its start from date plus time
   (write path), and `create_table_booking_core_v06` does the same in SQL while the live
   availability already offers 00:00, 00:15 and 00:30 on 31 December. Database change needs the
   owner, so reported, not applied.

## Plan

- [x] `src/lib/business-hours/trading-day.ts`: `tradingDayInForce`, `serviceInstantFor`,
      `loadTradingHours`, `resolveTradingDayNow`, with tests (23:30 31 Dec, 00:30 1 Jan, 01:00,
      ordinary day, both clock-change nights)
- [x] FOH schedule route: default date and `trading_day_now`; closed day marked closed;
      whenLondonClockReaches for private booking and standing event windows
- [x] FOH page initial date, client auto-return, header Today button, timeline label
- [x] Walk-ins: client date and time, `walk-in.ts`, both FOH create routes, fallback insert start
- [x] Change time route and BOH edit: start within the booking's trading day
- [x] Missing cash-ups: skip the trading day still in progress, London dates
- [x] Checklists and screening hours: whenLondonClockReaches
- [x] `/api/business/hours`: `currentStatus.closes`, `closesAt`, `tradingDate`
- [x] Website: type, StatusBar, WeekHours, tests
- [x] Gates in both repos, both zones; commit on the branches; no push without the owner

## Results

Management app, branch `fix/nye-after-midnight`, six commits on origin/main a1ba68db:
48017762 helpers, 8caa41d8 clock-change nights, dab30ef1 FOH screen and walk-ins, 4caee809 change
time and BOH edit, 7a29cf4c cash-ups, a4759f15 live status fields. Each commit type-checks alone.

Website, branch `fix/nye-open-until`, one commit e4aab53d on origin/main 62d5d6b6.

Gates (Node 20 for the management app, Node 22 for the website, whose audit scripts load
TypeScript directly):
- Management, after the rebase: lint clean; tsc clean at every commit; `npm test` 849 files,
  8,049 passed, 2 skipped; `npm run test:utc` the same; build exit 0.
- Website: lint and audits clean; `npm test` and `npm run test:utc` 226 suites, 2,663 passed,
  1 skipped; build exit 0 without the production env (API calls fall back), after the rebase.

Proof the tests test the fix: the new tests run against origin/main's code fail exactly the
after-midnight cases (walk-in at 00:31, move to 00:15 and back, 00:30 screen date, closed-day
label, clock-change instants, 00:30 header) and pass the ordinary-day, 23:30 and after-close
cases, so ordinary days are unchanged.

Not done here, needs the owner:
- Deploy. Commits dab30ef1 and 4caee809 change how bookings are written (walk-in fallback,
  management override, FOH change time and BOH edit after midnight).
- `create_table_booking_core_v06` still builds the start from date plus time, and the live
  availability (`check_table_availability_v06`) already offers 00:00, 00:15 and 00:30 on 31
  December for drinks, measured correctly on 1 January. A booking taken online or by staff at
  those times would be stored on the morning of 31 December. Needs a migration; not drafted.
