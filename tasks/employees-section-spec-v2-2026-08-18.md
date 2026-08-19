# Employees section, specification v2

Date: 2026-08-18
Supersedes: `tasks/employees-section-review-spec-2026-08-18.md`
Responds to: `tasks/employees-section-spec-developer-review-2026-08-18.md` (findings F-01 to F-34)
Code baseline: commit `7756bcf8`, branch `feat/employees-section-2026-08-18`
Findings are traced by symbol name plus that commit, never by line number (closes F-30).

---

## 1. Corrections to v1

Two figures in v1 were wrong. Both are corrected here and the corrected numbers make the case
stronger, not weaker.

**The "Holidays tab" column was wrong for 4 of 11 people.** v1 computed weekday leave days inside the
calendar year. `EmployeeHolidaysTab` actually counts weekdays across each request's header date range,
filtered by the stored `holiday_year` column, minus that employee's `non_working_weekdays`. Live
figures on 2026-08-18:

| Employee id (prefix) | Roster list column | Holidays tab | v1 claimed |
|---|---|---|---|
| b15306cb | 77 | 53 | 53 |
| c418660e | 45 | 21 | 32 |
| 2a38c5d1 | 37 | 12 | 26 |
| bd45f2cf | 30 | 20 | 20 |
| 5723ebbd | 30 | 19 | 19 |
| 7ff6951d | 27 | 4 | 14 |
| 83cc4abc | 18 | 11 | 12 |
| b64e6ae5 | 15 | 13 | 13 |
| 469d76ad | 13 | 1 | 1 |
| ca08139d | 6 | 3 | 3 |
| 9d0d61ce | 2 | 1 | 1 |

No employee currently has `non_working_weekdays` set, so the whole divergence comes from two causes:
weekends being excluded from the tab, and the `holiday_year` column being derived from the request
start date so a request beginning in December is charged wholly to the previous year.

**v1 named individuals inline.** It should not have. Names are replaced with employee id prefixes here,
and every figure is reproducible from the queries in the Evidence section (closes F-22, F-34).

---

## 2. Decision log

Seven decisions were put to the owner and answered on 2026-08-18. They are settled and are not
reopened anywhere below (closes F-01).

| # | Decision | Answer |
|---|---|---|
| D1 | Status of holiday agreed at hire | Auto approved. No manager review step. |
| D2 | Is the holiday question mandatory | Yes, mandatory, with a "nothing booked" option. |
| D3 | Does allowance count Saturdays and Sundays | Yes. The Anchor is a pub. Weekends are working days. |
| D4 | Add a leave type so long unavailability stops eating allowance | Yes. |
| D5 | Right to work | Checked in person by a manager who sees the original documents, or online with the applicant's share code. No employee self certification, no employee document upload. The onboarding flow carries a notice instead. |
| D6 | HMRC new starter data | Yes, capture it. |
| D7 | The developer review's recommendations | All accepted. |

### D8, the scope decision (mine, stated for the record)

D7 accepted 34 findings. Specifying all of them in one pass produced 61,000 words across ten sections,
and every section failed adversarial verification with contradictions between sections. That is the
second failed review of this specification.

So the work is split. Nothing is dropped. Part 3 items are decided in principle and carry the reason
they are not being built today.

- **Part 2, build now.** Self contained, verifiable, and directly serves the original request.
- **Part 3, decided but not built.** Each needs either the owner's business input, the accountant, or
  a change to how everyone's holiday is calculated. Building these wrong is worse than the bug they fix.

---

## 3. Live facts this specification relies on

Read on 2026-08-18 from production. Re-run the Evidence queries before implementing.

| Fact | Value | Why it matters |
|---|---|---|
| Incomplete unexpired onboarding invites | 0 | A new mandatory step strands nobody. The whole mixed version rollout problem in F-23 does not arise. |
| Leave days sitting on a `scheduled` rota shift | 7 | Double booking already happens. The rota has no leave conflict guard. |
| Approved requests longer than 35 days | 1 | The 63 day "cannot work" block. It is the case that proves D4. |
| Employees with `non_working_weekdays` set | 0 | The column is dead. D3 removes the concept entirely. |
| Active employees with no right to work record | 6 of 12 | Drives the Part 3 remediation. |

---

## 4. Part 2, build now

### 4.1 One holiday count, and weekends count (D3, D4)

**The problem.** Two screens compute holiday differently and disagree by up to 23 days for one person.
Separately, `isCountedLeaveDate` in `src/lib/leave/working-days.ts` returns false for any day with ISO
weekday above 5, so a weekend off costs a pub employee nothing.

**The rule.** There is exactly one function that turns leave rows into a number, and every screen calls
it. Every calendar day of leave counts, including Saturday and Sunday. Leave that does not consume
allowance is excluded by its type, never by which day of the week it falls on.

**Changes.**

1. `src/lib/leave/working-days.ts`
   - `isCountedLeaveDate(isoDate, ...)` drops the `isoDay > 5` exclusion and the `nonWorkingWeekdays`
     parameter. It now answers one question: is this date inside a leave request whose type consumes
     allowance.
   - Delete `WEEKDAY_OPTIONS` and `normalizeNonWorkingWeekdays`.
   - Add `countAllowanceDays(leaveDays: {leave_date: string, leave_type: LeaveType}[]): number`, which
     counts dated `leave_days` rows whose type consumes allowance. Dated rows, not header ranges, so a
     range crossing 31 December is charged to the year each day actually falls in (closes F-07).

2. Call sites that must switch to it:
   - `EmployeeService.getEmployeesRoster` in `src/services/employees.ts` (the roster Holiday column)
   - `EmployeeHolidaysTab` in `src/components/features/employees/EmployeeHolidaysTab.tsx`
   - `getHolidayUsage` in `src/app/actions/leave.ts`
   All three must return the same number for the same employee and year. That is the acceptance test.

3. `employee_pay_settings.non_working_weekdays` is retained but unread, and its writer in
   `upsertEmployeePaySettings` (`src/app/actions/pay-bands.ts`) is removed along with the zod field and
   the `EmployeePayTab` control. The column is dropped in a later release once nothing references it.
   Dropping a column and removing its readers in one migration is how silent breakage happens.

**Leave types (D4).**

New table `leave_types`, seeded with two rows. A lookup table rather than an enum so a type can be
added without a migration.

| code | label | consumes_allowance | paid | shown_on_rota | counts_in_reliability | allowed_at_onboarding |
|---|---|---|---|---|---|---|
| `holiday` | Holiday | true | true | true | true | true |
| `unavailable` | Not available to work | false | false | true | false | true |

`leave_requests.leave_type` is added as `text not null default 'holiday'` with a foreign key to
`leave_types.code`. Every existing row becomes `holiday`, which is what they are recorded as today.
Reclassifying the 63 day block to `unavailable` is a separate, signed off data change (Evidence).

The holiday year boundary is handled by counting dated `leave_days`. The `holiday_year` column stays on
the request header for the existing filter UI, but nothing computes a total from it.

**Acceptance criteria.**

1. For every active employee, the roster Holiday column and the Holidays tab show the same number.
2. A Saturday and a Sunday of `holiday` each add 1 to the total.
3. A request of type `unavailable` adds 0 to the total and still appears on the rota.
4. A request from 28 December to 3 January charges 4 days to the first year and 3 to the second.
5. `npm run lint`, `npx tsc --noEmit` and `npx vitest run` all pass.

### 4.2 Capturing already booked time off at onboarding

**The journey.** A new step, "Time off already booked", is added to the token onboarding flow after
Personal Details. It is mandatory (D2).

Screen copy:

> **Time off already booked**
>
> If you have already booked a holiday, or there are dates you know you cannot work, tell us now and we
> will put them straight into the rota. It is much easier to plan around them now than later.

Each row captures first day, last day, a type (Holiday, or Not available to work), and an optional
note. A required tick, "I have nothing booked", disables the rows.

The note field carries the hint "Please do not include medical details." (closes part of F-21).

**Date rules.** The on screen `min` and `max`, the client validation and the server validation are
generated from one shared constant so they cannot disagree (closes F-11).

- Earliest accepted date: today.
- Latest accepted date: today plus 12 months.
- Maximum 10 rows, maximum 60 days per row.
- Ranges may not overlap each other or any existing leave day for that employee.

**Durable answer (closes F-04).** "Nothing booked" is stored, never inferred from an absence of rows.
New table `employee_onboarding_responses` holding `employee_id`, `question` (`booked_time_off`),
`answer` (`has_dates` or `none`), `answered_at`, `submission_version`. It is read by
`getOnboardingSnapshot`, included in `completedSections`, checked by `ReviewStep`, and enforced by
`complete_employee_onboarding`.

**Atomic write (closes F-03, F-05).** One transaction function,
`save_onboarding_time_off(p_token text, p_answer text, p_blocks jsonb, p_submission_version int)`.

It locks the employee row, validates every block, deletes the previous set of onboarding origin rows
for that employee, inserts the new request and day rows, writes the response row, and returns a result.
No `ON CONFLICT DO NOTHING`. If any one of ten blocks is invalid the whole call fails and nothing is
written. Re-submitting the same `submission_version` returns the previous success rather than an error,
so a retry after a lost response is safe. A changed payload replaces the whole set. `SET search_path`,
`REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO service_role`.

**Provenance (closes F-06).** Structured columns, not a note prefix:
- `leave_requests.request_channel`: `portal`, `manager`, `onboarding`
- `leave_requests.leave_origin`: `normal_request`, `agreed_at_hire`, `migration`

D1 means onboarding rows are written `status = 'approved'`. `reviewed_by` is null and `reviewed_at` is
the write time. The Holidays tab and the rota render "Agreed at hire" from `leave_origin`, never from
the note text. The approver is shown as "Agreed at hire", not a person, because no person approved it.

**Reliability (closes F-14).** This is the rule, stated explicitly because both obvious options are
wrong. Writing through `bookApprovedHoliday` would give a new starter a score eligible `late_holiday`
event on day one for naming dates a fortnight away. Writing through a bespoke save would give them no
trail at all.

> Rows with `leave_origin = 'agreed_at_hire'` record a single non score eligible
> `holiday_agreed_at_hire` event. They never record `late_holiday` or `holiday_conflict`.
> Later employee initiated changes to those dates score normally.

**Rota (closes F-15).** These rows are approved, so they render as approved leave. Because the rota
lists only Active and Started Separation employees (`getActiveEmployeesForRota`), they become visible
the moment the profile is submitted. That is correct and is an acceptance criterion, not a bug.

**Manager visibility (closes F-16).** The onboarding complete email lists the dates. The email send is
already best effort and its result is ignored by the caller; that is fixed here by writing a row to
`rota_email_log` with the send status, exactly as the leave actions already do, so a failure is visible
rather than silent. Onboarding completion still succeeds if the email fails, because blocking a new
starter on a mail server is worse than a missed notification.

**Token binding (closes F-21).** After account creation the onboarding token remains a bearer token.
`saveOnboardingSection` and `getOnboardingSnapshot` gain a check: if the employee row has an
`auth_user_id`, the caller's session user must match it. A forwarded link stops working once the
account exists.

**Manual path (closes F-13).** The same block is added to `/employees/new`. The manual form commits the
employee first and then runs best effort follow ups. Rather than rewrite that orchestration now, the
holiday block calls the same RPC and, on failure, the manager is shown exactly which part failed and a
retry control, instead of the current generic "some sections could not be saved" toast.

**In flight invites (closes F-23).** There are zero incomplete unexpired invites, so the new step can be
enforced immediately. The Evidence query must be re-run at deploy time; if it returns anything other
than zero, the step ships optional for one week first.

**Limits and errors (closes F-27).** Maximum 10 blocks of 60 days, hard cap 200 days total per
submission. Named error codes, each with fixed user facing copy: `TIME_OFF_INVALID_RANGE`,
`TIME_OFF_TOO_LONG`, `TIME_OFF_OVERLAP`, `TIME_OFF_TOO_FAR_AHEAD`, `TIME_OFF_TOO_MANY`,
`TIME_OFF_TOKEN_EXPIRED`, `TIME_OFF_ALREADY_SUBMITTED`.

**Acceptance criteria.**

1. A new starter cannot pass the step without entering dates or ticking "nothing booked".
2. Entered dates appear on `/rota` for the right week once the employee becomes Active.
3. They appear on the Holidays tab marked "Agreed at hire".
4. `holiday` rows count towards the year total; `unavailable` rows do not.
5. Ticking "nothing booked" writes a response row and no leave rows.
6. Re-submitting an identical payload succeeds and creates no duplicates.
7. One invalid block in ten writes nothing at all.
8. No `late_holiday` reliability event is created for an agreed at hire row.
9. The manager's completion email lists the dates and its send status is logged.

### 4.3 Right to work notice (D5)

D5 removes the self certification step from v1. The employee facing part is a notice, not a check.

A new informational panel appears in the onboarding flow and on the starter's portal page until a check
is recorded. Exact copy, using the official GOV.UK terminology:

> **Before your first shift**
>
> Before you can start any shifts, a manager needs to see your right to work documents in person. This
> is a legal check every UK employer must make, and we do it for everyone. Please bring your passport
> with you, or send us your right to work share code if you have an eVisa. If you are unsure what to
> bring, just ask and we will help. Once the check is done, we can put you on the rota straight away.

Two conditional lines sit underneath:
- "A British or Irish passport is fine even if it has expired."
- "Get your share code at gov.uk/prove-right-to-work and send it to us with your date of birth. It
  lasts 90 days."

The employee ticks to acknowledge. The acknowledgement is stored with a timestamp, because it is the
record that we told them. It is not a right to work check and must never be displayed as one.

Official names used, verified against the employer's guide of 26 June 2025: the worker gets a share
code from "Prove your right to work to an employer: get a share code"; the employer uses "Check a job
applicant's right to work: use their share code". A right to work share code begins with W and lasts 90
days. Biometric residence permits are no longer acceptable for a manual check.

**Acceptance criteria.**

1. The notice appears before the review step and requires an acknowledgement.
2. The acknowledgement is stored with employee id and timestamp.
3. Nowhere in the app does the acknowledgement satisfy or substitute for a right to work check.

### 4.4 Database access control (closes F-10, F-24, and v1 B3, B4, B19)

Three tables are readable and writable by any authenticated user, including a staff portal employee,
through PostgREST. The server actions check permissions; the actions are not the only way in.

| Table | Policy today | Change |
|---|---|---|
| `leave_requests` | `FOR ALL USING (auth.uid() IS NOT NULL)` | Drop. Split into SELECT (`leave:view` or own record), INSERT (`leave:create` or own), UPDATE (`leave:approve`), DELETE (deny, see below). |
| `leave_days` | `FOR ALL USING (auth.uid() IS NOT NULL)` | Drop. SELECT only, gated on `leave:view` or own record. All writes move to the service role. |
| `employee_pay_settings` | `FOR ALL USING (auth.uid() IS NOT NULL)` | Drop. SELECT gated on `employees:view` or own record. Writes gated on `employees:edit`. |
| `employee_financial_details` | SELECT gated on `employees:view` | Tighten to `employees:edit`, matching what `getEmployeeDetailData` already enforces in code. |
| `employee_health_records` | SELECT gated on `employees:view` | Tighten to `employees:edit`. |

Every existing broad policy must be dropped, not supplemented, because PostgreSQL policies are
permissive and combine with OR. Separate policies per operation. `USING` and `WITH CHECK` both set on
updates. Self access resolves through `employees.auth_user_id`.

An approver must not be able to change dates or the employee. Rather than attempt column level
restriction in a policy, status changes move to a `SECURITY DEFINER` function
`review_leave_request(p_request_id uuid, p_decision text, p_note text)` which updates only the status
fields, and direct UPDATE is denied to everyone but the service role.

**Deletion.** Hard delete is removed. `deleteLeaveRequest` and `cancelOwnLeaveRequest` currently hard
delete the request and its days. They become status changes to `cancelled`, recording who cancelled it,
when and why. `leave_days` for a cancelled request are marked inactive rather than removed. This is
required because holiday records must be retained.

**Export permission (closes F-24).** `checkUserPermission('employees', 'export')` is called by
`/employees` and by `exportEmployees`, but no such permission row exists, so only `super_admin` can
export. The v1 suggestion of falling back to `employees:view` is rejected: the export emits email,
phone, date of birth, home address, employment dates and keyholder status, which is a bulk extraction
risk quite different from viewing a roster row. A dedicated `employees:export` permission row is added
and granted to `manager` and `super_admin`.

**Deploy order.** The permission grant migration is applied *after* the code deploy, never before.

**Verification.** Before production, every cell of the matrix is proved by running the same query as
each real JWT role against a Supabase branch. The queries and expected results are in the Evidence
section. A migration only change that breaks the rota or the portal is the main risk here, so the read
sites using the cookie client are enumerated and checked one by one.

### 4.5 Onboarding data completeness

1. **Preferred name.** The whole app displays preferred names and enforces uniqueness across current
   employees, yet the self service path, which 11 of 12 current employees came through, never asks.
   It is added to the Personal Details step with the same clash check `addEmployee` already performs.
2. **Missing rows on manual create.** `create_employee_transaction` inserts only `employees`,
   `employee_financial_details` and `employee_health_records`. The invite path creates an onboarding
   checklist row; the manual path does not. The function is updated to create the checklist row and a
   pay settings row. Existing employees missing either are backfilled.
3. **Employment start date.** `complete_employee_onboarding` sets status to Active without one, so one
   active employee has no start date and the roster shows a blank length of service. The invite form
   gains a required employment start date, which is written to the employee row at invite time.
4. **First shift date** stays optional. It is genuinely unknown at invite time and 9 of 12 employees
   not having it is not causing harm.

### 4.6 Interface and operational fixes

1. **Onboarding page layout.** Two headers render: one from `(employee-onboarding)/layout.tsx` and one
   from `OnboardingClient`. The layout also caps width at `max-w-2xl`, 672px, while `.onboard__body`
   in `globals.css` is designed for 1100px with a 260px stepper rail, and the single column override
   only applies at 820px and below. Above 820px the form fields end up about 280px wide under a
   duplicated header. Fix: the route group layout drops its header and its width cap and becomes a
   passthrough. `OnboardingClient` keeps its topbar and its own grid. Verified in a browser at 320,
   375, 768, 821 and 1280px.
2. **Onboarding design system.** The five step components are hand rolled inputs with hardcoded
   `green-600`, `gray-300` and `red-500` classes. They move to `@/ds` components: `Input`, `Textarea`,
   `Checkbox`, `RadioGroup`, `FormGroup`, `Button`, `Alert`. The workspace rule is design tokens only.
3. **Accessibility for the new step.** The repeating rows use a `fieldset` and `legend` per row, unique
   labels, an `aria-live` error summary, focus moved to the first invalid field on submit, and keyboard
   add and remove. Ticking "nothing booked" disables the rows and preserves their values, so unticking
   restores what was typed. Checked at 200% zoom and 320 CSS pixels.
4. **Employees list.** Add the Birthdays link, which is currently orphaned with nothing linking to it.
   Add a Started Separation tab, since the filter already accepts it and the badge already renders.
   Fix the stat tiles: `grid grid-cols-4` has no responsive prefix and is not caught by the global
   mobile override, which only rewrites `md:`, `lg:` and `xl:` prefixed classes, so four tiles stay
   side by side at 375px. Counts currently appear three times, in the subtitle, the tiles and the tab
   labels; the subtitle repetition is removed.
5. **Separation and future leave.** `finalizeEmployeeSeparation` blocks on future rota shifts and open
   timeclock sessions but ignores leave. It gains the same check for future leave days, with a message
   naming the dates.
6. **Pending leave reminders.** Eight requests are pending, the oldest raised on 17 July for leave
   starting 30 August. A daily cron emails the manager about requests pending more than 3 days or
   starting within 21 days. A reminder ledger keyed on request id plus reminder kind prevents the same
   request being emailed twice. Agreed at hire rows are approved on write so never enter this queue.
7. **Legacy RPC.** The single argument `create_employee_invite` overload is dropped. Nothing calls it;
   it does a case sensitive duplicate check and does not set `invite_type`.

---

## 5. Part 3, decided but not built today

Each of these is accepted in principle. Each needs something I cannot supply.

### 5.1 Hours based statutory holiday entitlement

**Why it matters.** Most Anchor staff are irregular hours or part year workers on casual worker
agreements. For those workers the lawful accrual method is 12.07% of hours worked, not a flat day
allowance. A flat 25 days also sits below the 28 day statutory floor for a five day worker. Tracking
in hours also makes a 4 hour Sunday lunch cost less than a 10 hour Friday night, which a day based
model cannot express.

**Why not today.** It replaces how every employee's holiday is calculated, needs the accountant to
confirm the entitlement basis per worker, and needs a decision on rolled up holiday pay. Section 4.1
fixes the two live defects (weekends free, two screens disagreeing) without pre-empting it.

**To unblock:** confirm with your accountant whether staff are irregular hours or part year, and
whether holiday pay is rolled up.

### 5.2 Right to work manager verification gate

**Why it matters.** Six of twelve active employees have no record at all, and four of the six who do
were checked after their start date. There is no reminder for expiring documents.

**Why not today.** The gate blocks people being put on the rota, which can stop the pub trading if it
goes in wrong. It needs your call on the two founder records, on who is authorised to perform checks,
and on the exception path.

**To unblock:** confirm who may perform checks, and what should happen to the six existing records.

### 5.3 HMRC new starter checklist (D6)

**Why not today.** The captured fields must match what your accountant actually consumes, and the
checklist changes between tax years. Capturing the wrong fields creates a false record.

**To unblock:** ask your accountant which fields they want and in what format.

### 5.4 Employee lifecycle state machine

Replacing the four statuses with an explicit machine (Invited, Employee Submitted, Awaiting Manager
Checks, Ready to Start, Active, Started Separation, Former) is the right shape, and it is what makes
5.2's gate enforceable. It is deferred with 5.2 because the two are the same change.

---

## 6. Delivery (closes F-02, F-28, F-29)

Tests ship in every pull request. There is no final test pull request.

| PR | Scope | Depends on | Reversible |
|---|---|---|---|
| 1 | Leave types, one counting function, weekends count | none | Schema additive, yes. Counts change, expected. |
| 2 | RLS policies, cancellation replaces hard delete | 1 | Yes, down migration included |
| 3 | Onboarding time off capture, both paths | 1, 2 | Schema additive; written rows are not, forward fix only |
| 4 | Right to work notice and acknowledgement | none | Yes |
| 5 | Onboarding data completeness | none | Yes |
| 6 | Onboarding layout and design system | none | Yes |
| 7 | Employees list, separation check, pending reminders, legacy RPC | 1 | Yes |
| 8 | `employees:export` permission grant | deploys after 7 | Yes |

Every pull request that touches data carries a pre and post reconciliation query. Every migration is
verified with `npx supabase db push --dry-run` first. `src/types/database.generated.ts` is regenerated
whenever the schema changes.

**Regression scope.** These are not being redesigned but must be regression tested because their data,
policies or counts change: the rota grid and its leave overlay, the staff portal leave screens, payroll
hours, reliability scoring, and RBAC policy behaviour.

**Testing.** Vitest, config `vitest.config.ts`. Baseline before any change: 661 files, 5,469 tests
passing, lint clean, typecheck clean. Required additions: unit tests for the counting function
including weekends and the year boundary; tests for the atomic RPC including a failing block and a
repeated submission; token binding tests; component tests for the repeating rows and the "nothing
booked" tick; and a browser check of the onboarding layout and the employees list at 320, 375, 768,
821 and 1280px.

---

## 7. Evidence

Queries live in `tasks/employees-section-evidence-2026-08-18.sql`. They contain no personal data and
are re-run immediately before each release rather than trusted from this document.

Any reclassification of live leave data needs the owner's approval per record, recording old value, new
value, reason, who approved, when, and the rollback statement. The 63 day block is the only such record
today.

---

## 8. Decisions of 2026-08-19, and what they changed

| # | Question put to the owner | Answer |
|---|---|---|
| 1 | Rebuild holiday so it accrues from hours worked | Yes |
| 2 | Block rostering until right to work is checked | **No** |
| 3 | Capture HMRC new starter data | No, the accountant has what they need from the New Starter PDF |
| 4 | Chase unapproved holiday requests | Yes |

### 4 is built and live

`/api/cron/leave-approval-reminders`, daily at 09:30, backed by `leave_reminder_log`.

### 2 is closed, with one thing recorded

No scheduling gate will be built. Six of twelve active employees still have no right to work
record and four of the six who do were checked after their start date. Nothing in the app will
prevent that, so it is a manual matter. The employee facing notice built earlier still tells every
new starter to bring their documents.

### 3 is closed, but the premise is not quite right

The New Starter PDF contains: full name, date of birth, address, phone, mobile, email, job title,
employment status, start date, first shift date, National Insurance number, and the right to work
fields. It does **not** contain the HMRC starter declaration (the A, B or C statement) or the
student loan plan, and neither is captured anywhere in the app.

Those two answers are what set a new starter's tax code and loan deductions. If the accountant is
collecting them another way then nothing is missing. If they are not, the gap is real. Recorded
here rather than acted on, because the owner has said the accountant is covered.

### 1 needs the numbers below looked at before it is built

Holiday is currently a flat 25 days for everyone. Under the lawful method for irregular hours
staff, entitlement accrues at 12.07% of hours actually worked. For the current team in 2026 to
date, using the same paid hours rule as `calculatePaidHours`:

| Employee | Shifts | Hours worked | Holiday earned (hours) | Roughly, in shifts | Leave days taken |
|---|---|---|---|---|---|
| b64e6ae5 | 151 | 467 | 56.4 | 18.2 | 15 |
| c418660e | 88 | 425 | 51.2 | 10.6 | 45 |
| 2a38c5d1 | 87 | 362 | 43.7 | 10.5 | 37 |
| 7ff6951d | 75 | 305 | 36.8 | 9.1 | 27 |
| 83cc4abc | 46 | 207 | 25.0 | 5.6 | 18 |
| 5723ebbd | 43 | 191 | 23.0 | 5.2 | 30 |
| 469d76ad | 44 | 144 | 17.4 | 5.3 | 13 |
| b15306cb | 32 | 80 | 9.7 | 3.9 | 14 |
| bd45f2cf | 22 | 75 | 9.1 | 2.7 | 30 |
| 8d4ecdaf | 12 | 58 | 7.0 | 1.4 | 0 |
| ca08139d | 3 | 8 | 1.0 | 0.4 | 6 |

The last two columns are in different units and that is the whole problem. Leave days are calendar
days; earned holiday is shifts. Somebody taking a week off loses seven leave days but perhaps three
shifts. One person has worked three shifts all year and has six days of holiday recorded against a
25 day allowance, which describes nothing.

**What this means.** The days model does not fit this workforce. Switching to hours is the right
answer and is what the law requires for irregular hours staff.

**Why it is not built yet.** It changes the entitlement figure every employee sees, and entitlement
affects pay. Two things were asked for and not supplied: whether the accountant treats these staff
as irregular hours or part year, and whether holiday pay is already being rolled up. The second
matters because the staff portal already shows each employee a holiday pay figure of 12.07% of
their actual pay, while the payroll export carries no holiday line at all. Those two facts need
reconciling by somebody who knows what is actually paid, before the app asserts a third number.

**The build, once confirmed.** Add `holiday_basis` to `employee_pay_settings` (`fixed_days` for
salaried, `accrued_hours` for everyone else). Compute entitlement on read as 12.07% of paid hours
in the holiday year, and hours taken as leave days valued at that person's average paid hours per
worked shift. No ledger table and no accrual job: for twelve people the figure is cheap to compute
and always reconcilable, which a stored balance is not. Display hours, with an approximate shift
count underneath as a reading aid only.
