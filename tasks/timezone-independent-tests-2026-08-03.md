# Timezone-independent test suite + date source fixes (2026-08-03)

Pre-existing on main: 9 tests across 4 files fail on any host not on Europe/London
(reproduced on CEST, +0200). Off-by-one dates, e.g. quarter start 2026-04-01 comes back as 2026-03-31.

## Root cause

Two patterns, both mixing a **host-local** date with **London** formatting:

1. `new Date(year, month, day)` builds midnight in the host's zone, then the result is formatted
   in London. On CEST, 2026-04-01T00:00+0200 is 2026-03-31T23:00 London, so the date moves back a day.
2. date-fns `parseISO('2026-07-24')` returns **local** midnight, then `formatInTimeZone(..., 'Europe/London')`
   reads it in London. Same one-day slip.

Both are real source defects, not test-only artefacts. On Vercel (UTC) they happen to come out
right, because a UTC midnight is always the same London calendar date, but the logic is wrong
for anyone running the app, a script, or a local dev server outside the UK.

## Plan

- [x] Add timezone-free calendar-date helpers to `src/lib/dateUtils.ts`
      (`isValidIsoDate`, `getIsoWeekday`, `eachIsoDateInRange`) using UTC arithmetic only
- [x] Fix `src/lib/invoices/date-ranges.ts`: derive the quarter from the London calendar date and
      build the range as strings, with no local `new Date(y, m, d)`
- [x] Fix `src/lib/leave/working-days.ts`: drop the parseISO/formatInTimeZone mix
- [x] Fix `src/app/actions/leave.ts`
      - `isValidIsoDate` rejected **every** date on a host east of London (worst of the three)
      - `leave_days` rows were written a day early when expanding a range
      - `getHolidayYear` compares ISO strings instead of constructing local Dates
- [x] Pin the suite to the project timezone in `vitest.config.ts` (`test.env.TZ`)
- [x] Verify `npx vitest run` with no TZ override passes on a non-London host

Added after the sweep for the same pattern elsewhere:

- [x] Share one `getHolidayYear` from `src/lib/leave/working-days.ts` and delete the two
      broken local copies in `portal/leave/page.tsx` and `EmployeeHolidaysTab.tsx`
- [x] Cover `getHolidayYear` in `tests/lib/leaveWorkingDays.test.ts`, boundary day included

## Review

**Suite pinned.** `vitest.config.ts` now sets `test.env.TZ = 'Europe/London'`. Verified this
actually reaches V8's date arithmetic, not just `process.env` and `Intl`: with the host on
Berlin, New York and Tokyo, a probe test read `summerOffset=-60` (BST) and `winterOffset=0`
(GMT) every time. The probe was throwaway and has been deleted.

**Source was genuinely wrong, not just the tests.** Reproduced independently of the working
tree: under CEST the old quarter logic returned `2026-03-31 -> 2026-06-29` for Q2 2026, both
ends a day early. On Vercel (UTC) it happened to come out right, which is why this never
showed in production.

**Same bug found in two more places.** `getHolidayYear` existed in three copies. The one in
`leave.ts` was fixed; the copies in the staff portal leave page and `EmployeeHolidaysTab`
still built the year boundary with `new Date(year, month, day)`. `EmployeeHolidaysTab` is a
client component, so that one ran in the staff member's own browser and would name the wrong
holiday year for anyone viewing from outside the UK around the 1 April boundary. All three now
call one shared, string-comparing implementation.

**Checked and found safe** (locally built and locally read, so internally consistent):
`src/app/actions/expenses.ts` quarter end, `src/lib/checklists/jobs/generate.ts`,
and the `new Date(y, m, 0).getDate()` days-in-month calls in the expenses and mileage
insights clients.

**Verification.** `npx tsc --noEmit` clean, `npm run lint` clean (zero warnings), and the full
suite passes at 572 files / 4082 tests with the host on Berlin, New York, Tokyo, and with no
TZ override.

**Trade-off worth knowing.** Pinning the suite to London means it can no longer catch this
class of bug by failing on a foreign machine. The protection now comes from the source itself:
the calendar-date helpers are pure UTC or string arithmetic, so they give the same answer in
any timezone, and `getHolidayYear` has boundary-day coverage.
