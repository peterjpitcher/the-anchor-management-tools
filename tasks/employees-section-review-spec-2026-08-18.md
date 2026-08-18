# /employees end to end review and spec

Date: 2026-08-18
Status: SPEC ONLY. No code changed.
Scope: `/employees` (list, detail, new, edit, birthdays, reliability), the token based
self service onboarding flow at `/onboarding/[token]`, the invite and separation
lifecycle, and the holiday data that feeds `/rota`.

All live figures below were read from the production Supabase project
`tfcasgxopxegwrabvwat` on 2026-08-18.

---

## 0. Open decisions

These are recorded in chat with recommendations. Nothing in Part A is built until they
are answered.

| # | Decision | Recommendation |
|---|----------|----------------|
| 1 | Onboarding holidays land approved or pending | Approved |
| 2 | Holiday step mandatory with a "nothing booked" option, or skippable | Mandatory with the tick box |
| 3 | Does holiday allowance count Saturday and Sunday | Yes |
| 4 | Add a leave type so long unavailability stops eating allowance | Yes |
| 5 | Make Right to Work a required part of the new starter flow | Yes |
| 6 | Add HMRC starter declaration and student loan capture | Yes |
| 7 | Fix the RLS holes as a separate first PR | Yes |

---

## 1. How it works today

There are two ways an employee gets created, and they capture different things.

**Path A, invite (`Invite` button on `/employees`).** Manager enters email plus optional
job title. `create_employee_invite` writes a stub `employees` row with status
`Onboarding`, an invite token, and an onboarding checklist row. The employee follows the
emailed link and completes five steps: create account, personal, emergency contacts,
financial, health. `complete_employee_onboarding` then flips them to `Active`.
11 of the 12 current active employees came in this way.

**Path B, manual (`Add employee` button).** A single 1,060 line client form with six
tabs: employee, emergency contacts, financial, health, right to work, office checklist.
It calls `addEmployee`, then a series of follow up actions.

Holidays live in `leave_requests` plus `leave_days`. `leave_days` rows are written
immediately, even while a request is pending, and `/rota` reads `leave_days` directly.
That means **anything written to those two tables shows on the rota with no extra
plumbing**, which is what Part A relies on.

---

## 2. Part A: capture already committed holiday at onboarding

### 2.1 The gap

Nothing anywhere in either path asks a new starter about time off they have already
booked. Not the invite email, not the five onboarding steps, not the manual form, not the
New Starter PDF. The first the pub hears of it is when the rota is already published.

### 2.2 What gets built

**A new onboarding step, "Time off already booked"**, placed after Personal Details and
before Emergency Contacts. The new starter is in "about me" mode at that point and has
just entered their own dates of birth and address, so the context fits.

Content:
- Plain question: "Have you already booked or committed to any time off before you start,
  or in the next few months? Tell us now and we will put it in the rota."
- A repeating row: first day, last day, optional reason (free text, 200 chars).
- Add another (cap 10 rows).
- A required tick: "I have nothing booked" (disables the rows) so we always get an answer
  rather than an empty step.

**The same block added to the manual `/employees/new` form** as a section on the Employee
Details tab, so both paths capture it.

### 2.3 Storage and rota behaviour

Reuse `leave_requests` and `leave_days`. Each row the starter enters becomes one
`leave_requests` row plus its expanded `leave_days` rows, exactly as `bookApprovedHoliday`
does today.

- `note` is prefixed `Agreed at hire: ` plus whatever reason they gave, so it is obvious
  on the rota and on the Holidays tab where it came from.
- `holiday_year` is derived with `getHolidayYear` against the live rota settings (holiday
  year currently starts 1 January).
- `created_by` is null, because the employee is not an authenticated staff user at this
  point. A new `source` column on `leave_requests` (`onboarding` / `portal` / `manager`)
  is the cleaner alternative, and is recommended.

The rota only lists employees with status `Active` or `Started Separation`
(`src/app/actions/rota.ts:450`), so these entries stay invisible until the profile is
submitted and the employee flips to Active. That is correct behaviour, not a defect, but
it must be stated in the acceptance criteria so it is not reported as a bug.

### 2.4 Server action

Extend `saveOnboardingSection` in `src/app/actions/employeeInvite.ts` with a `holidays`
section. Do **not** reuse `submitLeaveRequest`: it requires an authenticated session and
`isOwnEmployeeRecord` only matches employees in `Active` or `Started Separation`, so it
rejects anyone still onboarding.

Follow the existing pattern exactly: validate the token, use the admin client, write, then
call `auditOnboardingSectionWrite`.

Validation:
- Both dates required per row, valid ISO, end on or after start.
- Start date on or after today.
- Reject a single range longer than 60 days (typo guard). Longer genuine unavailability is
  handled by decision 4.
- No overlaps inside the submission, and none against existing `leave_days` for that
  employee.
- Reject dates before `employment_start_date` when the manager has already set one.

### 2.5 Visibility for the manager

- The onboarding complete email to the manager lists the dates that came in, so it is not
  buried in a tab.
- The Holidays tab on `/employees/[id]` shows them with an "Agreed at hire" badge.
- The "Setup incomplete" alert on the employee record gains a line when a starter has
  agreed holiday inside their first four weeks, so it is not missed at rota build time.

### 2.6 Acceptance criteria

1. A new starter completing the invite flow is asked about booked time off and cannot pass
   the step without either entering dates or ticking "nothing booked".
2. Entered dates appear on `/rota` for the correct week as soon as the profile is
   submitted and the employee becomes Active.
3. The same dates appear on the Holidays tab of the employee record, marked as agreed at
   hire, and count towards the year total on the same basis as every other holiday.
4. The manager's onboarding complete email lists the dates.
5. Submitting the same dates twice, or overlapping dates, is refused with a clear message
   and does not create partial rows.
6. A starter who ticks "nothing booked" creates no rows at all.
7. The manual `/employees/new` form captures the same thing and produces identical data.

---

## 3. Part B: defect register

Ordered by severity. Every item was verified against the live database or the current
source on `main`.

### P1, compliance and security

**B1. Right to Work is missing for half the active team and is not part of either flow.**
6 of 12 active employees have no `employee_right_to_work` row at all: Billy, Peter, Lance,
Laura, Jacob Hambridge, Samuel. The self service onboarding flow never asks for it, and
the manual form makes it optional. There is no cron or alert for `document_expiry_date` or
`follow_up_date`: those dates only render as a banner on that one employee's own record,
so nobody sees them unless they happen to open the page.
Fix: add a Right to Work step to the onboarding flow (or an explicit manager gate before
Active), plus a weekly cron that emails the manager about missing checks and checks
expiring within 60 days.

**B2. Right to Work checks are being recorded after the employment start date.**
Marty started 2025-09-07, verified 2025-10-01. Ryan started 2026-02-01, verified
2026-02-27. Jacob Hambridge started 2026-05-22, verified 2026-05-27. Martha started
2026-07-20, verified 2026-07-29. The check must be completed before the first shift for
the statutory excuse to apply. Nothing in the form warns about this.
Fix: warn (do not block) when `verification_date` is after `employment_start_date`, and
surface it on the employee record.

**B3. RLS on the sensitive employee tables is looser than the app.**
`employee_financial_details` and `employee_health_records` both have SELECT policies gated
on `employees:view`, not `employees:edit`. `getEmployeeDetailData` correctly redacts them
behind `edit`, and the code comment says so, but the database itself will hand bank
account numbers, NI numbers and health records to anyone holding only `employees:view`
(the `staff` role) if they query PostgREST directly with their own session.
Fix: change both SELECT policies to `employees:edit` to match the app.

**B4. `employee_pay_settings`, `leave_requests` and `leave_days` are wide open to any
logged in user.** All three carry a single `FOR ALL USING (auth.uid() IS NOT NULL)`
policy. Any authenticated user, including a staff portal employee, can read, edit,
approve or delete anyone's leave and change anyone's pay settings and holiday allowance
straight through PostgREST. The server actions check permissions, but the actions are not
the only route in.
Fix: replace with `user_has_permission` policies (`leave:view` to read, `leave:approve`
to change status, self read for own rows). This matters more once Part A ships, because
the onboarding flow starts writing to these tables.

### P2, the new starter flow does not capture everything

**B5. Self service onboarding never captures nine things the manual form does.**
Preferred name, employment start date, first shift date, uniform preference, keyholder
status, Right to Work, pay rate and holiday allowance, handbook acceptance, and (once
Part A lands) booked holiday. Preferred name is the sharpest one: the whole app displays
preferred names and enforces uniqueness across current employees, yet the only path 11 of
12 people came through never asks for it.

**B6. `complete_employee_onboarding` sets status Active without an employment start
date.** The function flips status and stamps `onboarding_completed_at`, but nothing sets
`employment_start_date` or `first_shift_date`. Live effect: Samuel Powell is Active with a
null start date, so the roster shows `--` and length of service is blank. 9 of 12 active
employees have no first shift date.
Fix: require the manager to set the start date on the invite, or block completion until it
is set, or prompt the manager in the completion email.

**B7. Manually created employees get no onboarding checklist row and no pay settings
row.** `create_employee_transaction` inserts only `employees`, `employee_financial_details`
and `employee_health_records`. The invite path creates the checklist row; the manual path
does not. Live: 5 of 12 active employees have no checklist row, 2 have no pay settings.
Missing pay settings silently means "25 day allowance, no non working days".
Fix: create both rows in `create_employee_transaction`.

**B8. Nothing in the new employee flow sets a pay rate or holiday allowance.**
Both live on the Pay tab of the finished record and there is no prompt. `getHourlyRate`
falls back to the age band so payroll does not break, but the allowance quietly defaults.

**B9. No HMRC new starter data.** No starter declaration (A/B/C) and no student loan plan.
The only mention of P45 in the codebase is a reminder line in a payroll email template.

### P3, the holiday model

**B10. Holiday allowance only counts Monday to Friday.**
`isCountedLeaveDate` returns false for any day with ISO weekday above 5, and
`WEEKDAY_OPTIONS` only offers Monday to Friday as configurable non working days. For a pub
where Saturday and Sunday are the busiest trading days, a weekend off costs nothing
against allowance. Effect on Jacob Hambridge: 13 approved leave days in 2026, of which the
allowance counter recognises **1**.

**B11. The roster list and the Holidays tab give two different holiday numbers for the
same person.** The `/employees` list counts every approved `leave_day` in the calendar
year. The Holidays tab counts Monday to Friday days in the holiday year. Live 2026:

| Employee | Roster list column | Holidays tab |
|---|---|---|
| Harry Jefferyes | 77 | 53 |
| Billy Summers | 46 | 32 |
| Laura Bradshaw | 37 | 26 |
| Marty Pitcher-Summers | 30 | 19 |
| Peter Pitcher | 30 | 20 |
| Lance Marlow | 27 | 14 |
| Ryan Bond | 18 | 12 |
| Amanda Jones | 15 | 13 |
| Jacob Hambridge | 13 | 1 |
| Martha Lilley | 6 | 3 |
| Samuel Powell | 2 | 1 |

Fix: one shared counting function used by both surfaces, whatever decision 3 lands on.

**B12. There is no leave type, so unavailability is being booked as holiday.**
Harry has an approved 63 day entry from 2026-06-29 to 2026-08-30 noted "Back in Oxford,
can't work". That is student term time unavailability, and it is being counted as annual
leave. It is why Harry reads 53 of 25 days and why four people are already over allowance.
The allowance figures are not usable as they stand. This is also exactly the shape of what
Part A will collect from new starters, so it should be settled before Part A ships.

**B13. Pending holiday requests sit unactioned with no reminder.**
8 requests are pending right now. The oldest was raised on 17 July for leave starting
30 August, 12 days from today. Nothing chases the manager, and the pending count is not
shown on `/employees`, on the employee record, or as a nav pill. The employee gets a
"request received" email and then silence.
Fix: a daily reminder for requests pending more than 3 days or starting within 21 days.

**B14. The Holidays tab can book holiday but cannot cancel or amend it.**
`deleteLeaveRequest`, `cancelOwnLeaveRequest` and `updateLeaveRequestDates` all exist but
are only wired up on the rota and portal screens.

**B15. Separation does not check future approved leave.**
`finalizeEmployeeSeparation` blocks on future rota shifts and open timeclock sessions but
ignores `leave_days`. Data is clean today (0 future leave days for Former employees) so
this is prevention, not a live problem.

### P4, UI, navigation and consistency

**B16. The onboarding page renders two headers and is squeezed to about a third of its
design width.** `(employee-onboarding)/layout.tsx` renders a header ("The Anchor /
Employee Onboarding") and wraps everything in `max-w-2xl` (672px). `OnboardingClient` then
renders its own `onboard__topbar` ("The Anchor - Staff Portal Setup") inside that. The
`.onboard__body` grid in `globals.css` is designed for `max-width: 1100px` with a 260px
stepper rail, and the single column override only applies at 820px and below. Above 820px
the form fields end up roughly 280px wide inside a 672px shell, with a duplicated header
above them. This is the first thing every new employee sees.
Fix: drop the header and the width cap from the route group layout, or drop the topbar
from the client. One of the two, not both.

**B17. The onboarding steps do not use the design system.** All five step components are
hand rolled `<input>` and `<label>` markup with hardcoded `green-600`, `gray-300` and
`red-500` classes. Everything else in the app imports from `@/ds`, and the workspace rule
is design tokens only, no hardcoded colours.

**B18. `/employees/birthdays` is orphaned.** Nothing links to it. The only reference in the
codebase is the page's own breadcrumb. `/employees` links to Reliability but not
Birthdays.

**B19. The `employees:export` permission does not exist.** `/employees/page.tsx` and
`employeeExport.ts` both check `checkUserPermission('employees', 'export')`, but there is
no `export` row in the `permissions` table for the employees module. `user_has_permission`
short circuits true for `super_admin`, so it works for you and silently never works for a
manager. Either add the permission row or switch the check to `employees:view`.

**B20. The employees list stat tiles stay four across on a phone.**
`<div className="grid grid-cols-4 gap-4">` in `EmployeesClient.tsx` has no responsive
prefix, and the global mobile override at 820px only rewrites classes matching
`md:grid-cols`, `lg:grid-cols` or `xl:grid-cols`, so it does not catch this one. Four stat
cards at 375px is about 82px each. Flagged from code, **not yet confirmed in a browser**.

**B21. There is no "Started Separation" tab on the employees list.** The page accepts the
filter from the URL, the badge renders, and the status exists in the type, but the tab row
only offers All, Active, Onboarding and Former. Someone on notice can only be found via
All.

**B22. The same counts are rendered three times on the employees list.** In the page
subtitle, in the four stat tiles, and again in the tab labels.

**B23. A legacy single argument `create_employee_invite` still exists in the database.**
The app calls the two argument version. The one argument overload is dead but callable,
does a case sensitive duplicate email check, does not lowercase the stored email, and does
not set `invite_type`. Drop it.

**B24. There are no tests for any of this.** The only employee related test is
`src/lib/employees/__tests__/display-name.test.ts`. No coverage for `addEmployee`,
`saveOnboardingSection`, `submitOnboardingProfile`, `beginSeparation`, the leave actions,
or holiday day counting.

---

## 4. Suggested delivery order

Each part is independently deployable.

| PR | Contents | Complexity |
|----|----------|-----------|
| 1 | B3, B4 RLS fixes (migration only, no app change) | S |
| 2 | B10, B11, B12 holiday model: leave type, one shared counting function, backfill Harry's unavailability | M |
| 3 | Part A: holiday capture at onboarding, both paths | M |
| 4 | B1, B2 Right to Work step plus expiry cron | M |
| 5 | B5, B6, B7, B8 onboarding data completeness | M |
| 6 | B16, B17 onboarding page layout and design system | S |
| 7 | B13, B14, B18, B19, B20, B21, B22, B23 the smaller fixes | S |
| 8 | B24 tests across the above | M |

B9 (HMRC starter data) sits outside this list until decision 6 is answered.

---

## 5. Explicitly out of scope

- `/rota`, `/portal` and payroll beyond the holiday tables those screens share.
- The reliability scoring model.
- Recruitment, which has its own review.
- Any change to auth or the RBAC model itself, beyond adding the missing permission row.
