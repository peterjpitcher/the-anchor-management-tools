# /rota end-to-end review — 2026-08-18

Scope: every route, server action, cron, API route and library under the rota
section. 21,269 lines across 59 files.

## Baseline

Repository findings were re-checked against commit `7756bcf8`. Production
findings were checked on 2026-08-18 (Europe/London) against the live database.
Restricted operational evidence, including employee identifiers and the exact
verification queries, lives in `tasks/rota-2026-08-18-runbook.md`, not here.

## Revision history

**Rev 2, 2026-08-18** — revised after the developer review in
`tasks/rota-review-2026-08-18-developer-report.md`. Three factual errors in
Rev 1 are corrected below and the delivery plan is rewritten around the
decisions in the next section. Corrections:

- There are **eight** local paid-hours copies, not nine.
- `src/app/actions/rota.ts` and `src/lib/rota/publish-status.ts` **do** have
  tests, in the root `tests/` directory. Rev 1's F11 searched only `src/` and
  was wrong. F11 is replaced with a real coverage gap analysis.
- The 14-day cutoff is declared in **four** files, not two.
- `src/lib/rota/pay-calculator.ts` imports `@/lib/supabase/server`, so it
  cannot be imported by client components. This changes the F1 fix.
- `src/lib/rota/summary.ts` already resolves rates, applies premium windows and
  tracks cost coverage. It is a fourth rate resolver and it is the right basis
  for the dashboard.

The prior review (`tasks/rota-review-2026-08-10.md`) covered the rejection and
reassign flows. Those are re-confirmed working and are not repeated here.

---

# Decisions

Owner decisions, 2026-08-18:

| # | Decision |
|---|---|
| D1 | A shift may **never** be assigned to an employee with approved leave on that date. Blocked outright. No override, no permission that bypasses it. |
| D2 | The labour ratio uses **total takings**, not private-booking revenue. |
| D3 | The holiday year is **1 January to 31 December**, aligning with the financial year. The live setting is already correct; the code default of 6 April is wrong and changes to 1 January. |
| D4 | Rota Settings stays restricted to `settings:manage`. Billy was to be made a super_admin — **already is one** (verified 2026-08-18), so no change is required and he can already reach the page. |

Engineering decisions taken to close the developer review's open questions:

| # | Decision | Closes |
|---|---|---|
| D5 | Hours and cost count **only** rows with `status = 'scheduled'`. This is a positive rule, not an exclusion list, so a future status cannot silently re-open F1. Absence and cancelled rows stay visible on screen but never contribute to a total. | C05 |
| D6 | Pure pay arithmetic moves to `src/lib/rota/pay-math.ts` with no server imports. `pay-calculator.ts` re-exports it so server callers are unchanged. UI imports the pure module. | C04 |
| D7 | A leave conflict covers `shift_date`, plus `shift_date + 1` when `is_overnight OR end_time <= start_time`. This copies the rule already live in `approve_rota_open_shift_request` verbatim, so every path agrees. | C09 |
| D8 | Leave checking and snapshot publishing are enforced inside Postgres functions with row locks, not by application preflight queries. | C07, C12, C13 |
| D9 | Week readiness is a four-state model: `missing`, `draft`, `published_stale`, `published_current`, evaluated over a configured horizon. Navigation, the page, the cron and the email all read the same result. | C11, C14 |
| D10 | The Labour Cost Dashboard requires `payroll:view` for any cost or pay-derived data, matching `getRotaSummaryForWeek`. Without it the page shows hours only and never queries dates of birth or pay rates. | C20 |
| D11 | The dashboard is rebuilt on `buildRotaSummary`, which already handles premium, salaried and missing-rate coverage. Its inline rate resolver and cost loop are deleted. | C16, C18 |
| D12 | The cutoff is **336 hours before the London shift start instant**, in one client-safe module used by all four call sites. Calendar-date deadline labels are derived from that instant. | C22 |
| D13 | Publishing inside the cutoff is **allowed but never auto-accepts**. A shift first published to an employee inside the cutoff gets a 48-hour grace window, from publish, in which they may still reject. Blocking late publication would strand the already-late week of 2026-08-31. | C15 |
| D14 | `/rota/print` is removed and `/rota/print` redirects to `/api/rota/pdf`, preserving `?week=`. Done first, so no later refactor touches it. | C23, O05 |
| D15 | One server-only manager-email resolver: database setting, then environment variable, otherwise a logged configuration error. No hard-coded addresses remain. | C21 |
| D16 | Departments are derived from the union of configured budgets and departments present in the data. No hard-coded five-value list. | C19 |
| D17 | Every delivery item carries acceptance criteria and the risk-based test matrix from the developer review. Production repairs move to a separate runbook with a named approver. | C01, C26, C27 |

## What is healthy

- Permission checks are present on all 39 exported server actions, all 6 API
  routes and all 4 crons. One is too weak: see F16. Rev 1's blanket "no auth
  holes" claim was too broad.
- No overlapping shifts exist in production.
- The hours report (`/rota/hours` + its PDF) already shares one arithmetic
  module (`src/lib/rota/hours-report.ts`). This is the pattern the rest of the
  section should follow.
- The premium-rate columns are carried correctly through the publish snapshot.
- `src/lib/rota/summary.ts` already resolves rates, applies premium windows via
  `computePlannedShiftPremiumPay` and tracks cost coverage as
  `complete | partial | missing_rate | salaried | none`. The dashboard should be
  rebuilt on it rather than reinventing it.
- `approve_rota_open_shift_request` already enforces overlap, sickness and leave
  under row locks. It is the model the other write paths should follow.
- Rota tests exist and pass: 21 cases in `tests/actions/rota.test.ts`, 8 in
  `tests/lib/rota/publish-status.test.ts`, 24 in `tests/lib/rotaHoursReport.test.ts`,
  plus summary, cron and permission suites.

---

# P1 — live now, wrong numbers or wrong people on shift

## F1. A "Couldn't Work" marker counts as a 24-hour shift

**Confirmed by execution.** There are eight hand-rolled copies of the paid-hours
calculation in the rota section. Every copy tests `endMinutes <= startMinutes`
where the canonical `calculatePaidHours` in `src/lib/rota/pay-calculator.ts:99`
tests `endMinutes < startMinutes`.

Absence rows are stored with `start_time = end_time = '00:00:00'`. The canonical
version returns 0 hours. Every UI copy returns **24 hours**:

| input | UI copies | canonical |
|---|---|---|
| `00:00:00` → `00:00:00` | 24.0 | 0.0 |
| `19:00:00` → `00:00:00` | 5.0 | 5.0 |

Two surfaces then include absence rows in their totals:

- `src/app/api/rota/pdf/route.ts:66` filters only `status !== 'cancelled'`, so
  the weekly total on the printed rota is 24 hours too high for anybody with an
  absence that week.
- `src/app/(authenticated)/rota/dashboard/page.tsx:52` does the same, so the
  Labour Cost Dashboard adds 24 phantom hours **and costs them at that person's
  hourly rate**.

Live impact: 4 absence rows in August 2026 → 96 phantom hours and roughly
£1,100 of phantom labour cost on the August figure, against a base of 84 real
bar/kitchen shifts. 5 rows in July, 10 in May.

`RotaGrid` is not affected: it filters `status === 'scheduled'` first.

**Fix (per D5, D6).** `calculatePaidHours` cannot simply be imported into the UI:
`pay-calculator.ts:1` imports `@/lib/supabase/server`, so pulling it into a client
component risks a server-only module error. Extract the pure arithmetic into
`src/lib/rota/pay-math.ts` with no server imports, have `pay-calculator.ts`
re-export it, and import the pure module from the eight call sites.

Then apply the positive rule: scheduled hours and estimated cost include **only**
rows with `status = 'scheduled'`. Absence markers stay on screen but never count.

Files (eight, all confirmed at commit `7756bcf8`): `RotaGrid.tsx:102`,
`dashboard/page.tsx:27`, `CreateShiftModal.tsx:25`, `ShiftDetailModal.tsx:36`,
`AddShiftsModal.tsx:48`, `templates/ShiftTemplatesManager.tsx:45`,
`print/page.tsx:29`, `api/rota/pdf/route.ts:27`. `print/page.tsx` is deleted
under D14 before this work starts, leaving seven to change.

**Acceptance:** no local paid-hours function remains under `src/app/**`; a
`00:00:00`-to-`00:00:00` row returns 0.0; the PDF weekly total and the dashboard
month total both exclude absence rows; tests cover equal times, explicit
overnight, implicit overnight, a break longer than the shift, and each of
`scheduled`, `sick`, `cancelled`, open and assigned.

## F2. Nothing stops a shift being rostered on top of approved leave

There is no server-side check for approved leave in `createShift`, `moveShift`,
`updateShift`, `autoPopulateWeekFromTemplates` or `addShiftsFromTemplates`. The
only guard is a client-side toast in `RotaGrid.tsx` fired **after** the move has
already saved, and only on the drag path.

The reverse direction is no better. `reviewLeaveRequest` does not check for
existing shifts. It records a `holiday_conflict` reliability event against the
**employee** (`src/services/employee-reliability.ts:336`), which reads
`rota_published_shifts` only, so a draft-week clash is invisible. Nobody is told
to re-cover the shift, and the employee's reliability score is docked for a
clash the manager created.

**Live right now:** Billy Summers has approved leave 22–23 August 2026 and is
rostered on Saturday Kitchen (12:00–21:00) and Sunday Kitchen (12:00–18:00) for
exactly those days. Both are published, so the staff portal is telling him he is
working. This weekend. Nine such clashes exist historically.

**Fix:** a shared `findLeaveConflicts(employeeId, dates)` helper called by every
write path. Recommend blocking with an explicit override rather than a silent
warning, and surfacing conflicts to the manager when leave is approved instead
of only scoring them against the employee.

## F3. A week can be marked "published" while most of it is invisible to staff

`rota_published_shifts` is a snapshot written only by `publishRotaWeek`. Every
edit after publishing sets `rota_weeks.has_unpublished_changes = true`, but:

- `RotaPublishStatus` only ever shows the state of the week currently on screen.
- The Sunday `rota-manager-alert` cron
  (`src/app/api/cron/rota-manager-alert/route.ts:110`) checks **only next
  Monday's week**. A week three weeks out can sit stale indefinitely.

**Live drift:**

| week | week status | in staff snapshot | missing from staff snapshot | ghost shifts staff still see |
|---|---|---|---|---|
| 2026-09-07 | published | 4 | **28** | 0 |
| 2026-08-03 | published | 23 | 0 | 3 |
| 2026-06-15 | published | — | 0 | 1 |

The 2026-09-07 week is the live one: 32 shifts exist, staff can see 4.

There is also a hole in the publish horizon. Week 2026-08-31 is `draft` while
2026-09-07 after it is `published` — staff can see a week further out than one
they cannot see at all.

**Fix (per D8, D9, D13).** A badge driven by `has_unpublished_changes` alone
cannot see this: that flag only marks a *changed published* week. It cannot see a
draft week, a missing week row, or the horizon hole where 2026-08-31 is draft
while 2026-09-07 after it is published. The flag is also unreliable — several
shift actions update it in a second, unchecked call, so a failed flag write
leaves a dirty week looking clean (C13).

Three parts:

1. **A readiness model (D9).** `getRotaWeekReadiness` returns `missing`, `draft`,
   `published_stale` or `published_current` per week across a configured horizon,
   computed by diffing live against published rather than trusting the flag.
   Navigation badge, page banner, cron and email all consume it.
2. **Atomic publish (D8).** `publishRotaWeek` currently reads shifts, deletes the
   snapshot, inserts a replacement and clears the flag in four separate requests.
   The code comment calls this atomic; it is not. A failed insert leaves staff
   with an empty rota. Move snapshot replacement and week-state update into one
   transactional function that preserves the old snapshot on error and rejects a
   concurrent edit with "rota changed, review and publish again". Emails and
   calendar sync fire only after commit.
3. **Late publication (D13).** Publishing inside the cutoff is allowed but must
   not auto-accept. A shift first published to an employee inside the cutoff gets
   a 48-hour grace window from publish in which they may still reject, and the
   publish dialog states this before it happens.

The Sunday cron widens to the readiness horizon and groups by week, capping
detail with a link rather than listing every shift, and failing visibly rather
than treating a query error as "nothing to report" (C14).

**Acceptance:** the horizon hole at 2026-08-31 is reported; a forced insert
failure leaves the previous snapshot intact and the week still dirty; a
concurrent edit makes publish fail rather than silently drop the edit; a shift
published inside the cutoff is rejectable for 48 hours and is not auto-accepted.

Secondary consequence: 75 future shifts sit at `acceptance_status = 'pending'`
but are absent from the snapshot, so staff cannot accept or reject them and the
auto-accept cron cannot see them. The 2026-08-31 week is already inside the
14-day rejection cutoff, so when it is published nobody on it will be allowed to
reject.

## F4. The Labour Cost Dashboard's headline hours and headline cost count
different shifts

`dashboard/page.tsx:243` builds `weekTotalHours` as `weekBarHours +
weekKitchenHours` only. `weekTotalCost` on line 250 is computed over **every**
shift with no department filter.

Five departments are live (bar 1113, kitchen 277, runner 91, cleaning 18,
host 17). So runner, cleaning and host hours are excluded from the hours figure
but included in the cost figure sitting next to it. In August that is 17 shifts
costed but not counted.

**Fix (per D5, D11, D16).** Counting all departments does not by itself make the
two agree: planned hours can include open shifts that cost cannot price, and cost
silently skips salaried and missing-rate employees. Rebuild both cards on
`buildRotaSummary`, which already reports coverage as
`complete | partial | missing_rate | salaried | none`, and show that coverage
rather than presenting a partial total as complete.

Departments come from the union of configured budgets and departments present in
the data (D16), so a sixth department cannot silently recreate this.

The card labelled "to date" currently queries the whole month including future
dates. Either relabel it as a full-month forecast or restrict the range.

**Acceptance:** hours and cost describe the same shift set; a missing-rate
employee makes the card read "partial", never a silently low number; adding a new
department to the data makes it appear without a code change.

---

# P2 — misleading or half-wired

## F5. "Labour / Revenue Ratio" divides by private-booking revenue alone

`dashboard/page.tsx:257` computes `weekTotalCost / weekPrivateBookingRevenue`.
For a pub whose main revenue is regular trade, this is not a labour ratio. A
quiet week with one £500 private booking would show several hundred per cent in
red; a week with no private booking shows a dash.

The red threshold is hardcoded at 40% on line 305, while the configured
`rota_wage_target_percent` is **25** and is already read and used by
`getRotaSummaryForWeek` (`rota.ts:1069`). The two surfaces disagree.

**Fix (per D2).** Use total takings. `resolveSalesTargets` in
`src/lib/rota/summary.ts` already produces exactly the right denominator: it uses
cash-up actuals where a day is `submitted`, `approved` or `locked`, falls back to
a per-day override, then to the configured day-of-week target, and labels which
source it used. Reuse it and show the source, so a week built on forecast is not
mistaken for a week built on takings.

Read the threshold from `rota_wage_target_percent` (currently 25), not the
hard-coded 40.

**Acceptance:** the ratio names its denominator source; a week with no cash-up
and no target shows "no revenue data", not a dash implying zero; the threshold
follows the setting.

## F6. The dashboard cost ignores premium rates

`computeEstimatedCost` does not select or apply `rate_multiplier`,
`rate_override`, `premium_start_time` or `premium_end_time`. Premium pay shipped
2026-07-07 and is live. Any premium shift is costed at base rate, understating
the forecast.

## F7. Hourly-rate resolution exists in three places

1. `src/lib/rota/pay-calculator.ts` — `getHourlyRate` / `getBatchHourlyRates`
   (canonical, premium-aware)
2. `src/app/actions/payroll.ts:245` — `getHourlyRateSync`
3. `src/app/(authenticated)/rota/dashboard/page.tsx:57` — its own inline copy

Three implementations of override → age band → band rate. Payroll and the
dashboard can silently disagree about what a shift costs. This was flagged in
the premium-rate work and never unified.

## F8. Rota Settings' manager email only drives one of three notification paths

`/settings/rota` writes `system_settings.rota_manager_email`. Only
`rota-manager-alert` reads it. Both other paths hardcode the address:

- `src/app/actions/rota.ts:176` — `MANAGER_SHIFT_EMAIL`
- `src/app/api/cron/rota-shift-acceptance/route.ts:14` — `MANAGER_SHIFT_EMAIL`

Currently latent (the setting happens to equal the hardcode) but the settings
screen is lying about what it controls.

## F9. The rota shows the wrong week for the first hour of a Monday in summer

`page.tsx:111` and `print/page.tsx:146` derive "this week" from
`new Date().getUTCDay()`. During British Summer Time, Monday 00:30 local is
Sunday 23:30 UTC, so the page opens on the previous week. Proven:

```
local London : 24/08/2026, 00:30:00
week shown   : 2026-08-17
week expected: 2026-08-24
```

The pub trades past midnight, so this is a real window. `dashboard/page.tsx`
already does it correctly with `getTodayIsoDate()` for the week, but then uses
raw `new Date()` for the month range on line 159, so the same class of error
applies to the month label in the first hour of the 1st.

**Fix:** use `getTodayIsoDate()` from `src/lib/dateUtils.ts` as the single source
of "today" throughout the section.

## F10. Nothing chases a pending leave request

There is no cron for pending leave. The sidebar Rota pill does count them
(`src/actions/get-outstanding-counts.ts:132`), but 8 requests are pending, the
oldest raised 2026-07-17, one of them starting 2026-08-30. A pill alone is not
chasing it.

**Fix:** fold a pending-leave count into the existing Sunday manager alert
rather than adding a cron.

---

# P3 — structural, no user impact today

## F11. Test coverage is real but misses the highest-risk paths

**Rev 1 was wrong here.** It searched only `src/` and missed the root `tests/`
directory. `tests/actions/rota.test.ts` has 21 cases against `rota.ts`;
`tests/lib/rota/publish-status.test.ts` has 8; `tests/lib/rotaHoursReport.test.ts`
has 24; there are also summary, acceptance-cron and holiday-permission suites.

The real gap is which paths are covered. `tests/actions/rota.test.ts` covers
`getOrCreateRotaWeek`, `getWeekShifts`, `createShift`, `updateShift`,
`deleteShift`, `markShiftSick`, `markEmployeeCouldntWork` and one
`acceptPortalShift` error case. It does **not** cover `publishRotaWeek`,
`moveShift`, `rejectPortalShift`, `requestOpenShift`,
`autoPopulateWeekFromTemplates` or `addShiftsFromTemplates` — which is every path
this work changes.

Required additions, by risk:

| area | cases |
|---|---|
| paid hours | equal times, explicit overnight, implicit overnight, excessive break, each status, open vs assigned |
| leave conflicts | all ten matrix rows, bulk insert, overnight boundary, concurrent write, DST weekends |
| publishing | first publish, republish, empty week, insert failure, concurrent edit, stale version, old snapshot preserved |
| readiness and alerts | missing, draft, stale, current, horizon boundary, out-of-order week, no manager email, query error, email error |
| cutoff | exact boundary, either side, both DST changes, late first publish, changed republish |
| dashboard | every department, new department, premium whole and windowed, salaried, missing rate, open shift, no revenue, partial actuals, permission denied |

## F12. `/rota/print` is orphaned

347 lines plus `PrintTrigger.tsx`, with no link anywhere in the application. It
was superseded by `/api/rota/pdf`, which is what `RotaGrid.tsx:1059` links to.
It carries its own copy of the F1 bug and is still being maintained by unrelated
commits. Removed under D14, with `/rota/print?week=` redirecting to
`/api/rota/pdf?week=` so any saved link still works. Done first, so no later
refactor touches a route that is about to disappear.

## F13. Section navigation is incomplete and not permission-filtered

`rotaNavItems` lists 7 of the 9 pages. Shift Templates and Rota Settings are
reachable only from buttons on `/rota` itself, so from `/rota/payroll` you have
to navigate back to reach them. `/settings/rota` renders no rota nav at all.

The nav is also a static list rendered for anyone with `rota:view`, but Payroll
needs `payroll:view`, Timeclock needs `timeclock:view` and Leave needs
`leave:view`. A user without those is shown the tab and bounced to `/`. Latent
today — only `manager` and `super_admin` hold rota permissions and both hold the
full set — but it will bite the first time a narrower role is created.

## F14. The 14-day cutoff is declared in four files with two different meanings

**Rev 1 said two files. It is four**, all at commit `7756bcf8`:

- `src/app/actions/rota.ts:175`
- `src/app/api/cron/rota-shift-acceptance/route.ts:15`
- `src/app/(staff-portal)/portal/shifts/page.tsx:79`
- `src/app/(authenticated)/rota/RotaGrid.tsx:89`

Worse than the duplication, they do not all mean the same thing. Three compute
`14 * 24 * 60 * 60 * 1000` from the shift start instant;
`portal/shifts/page.tsx:216` does calendar-date subtraction
(`deadline.setDate(deadline.getDate() - 14)`) to render the deadline label. Those
two rules differ by an hour across each British Summer Time transition, so the
portal can show a staff member a deadline that the server does not honour.

**Fix (per D12):** one client-safe module holding the constant and a single
London-aware decision function. The rule is 336 hours before the shift start
instant; the displayed deadline is derived from that same instant rather than
computed separately. Test both DST changes, the exact boundary and one second
either side.

## F15. Design-system inconsistency across the section

Three components have been converted to design tokens; fourteen have not.

| converted | raw Tailwind palette |
|---|---|
| RotaGrid (229 tokens) | PayrollClient (135 raw) |
| HoursByEmployeeClient (69) | TimeclockManager (80) |
| ReassignQueueClient (17) | HolidayDetailModal (50), LeaveManagerClient (49), ShiftDetailModal (47), AddShiftsModal (45), dashboard (35), ShiftTemplatesManager (29), PayrollSummaryBar (25), RotaFeedButton (17), CreateShiftModal (14) |

Raw `<button>` is mixed with the DS `Button` in twelve files;
`HolidayDetailModal` and `RotaPublishStatus` import from `@/ds` not at all.
Workspace standard is design tokens only.

`PayrollClient` (763 lines) has 2 responsive classes and relies entirely on
horizontal scroll; `LeaveManagerClient` has 1. `RotaGrid` is a fixed
`min-w-[1040px]` behind `overflow-x-auto` with a 260px sticky name column,
leaving 115px of usable width on a 375px phone. **Not verified in a browser —
mobile usability here is an open question, not a finding.**

## F16. The Labour Cost Dashboard shows pay data behind `rota:view` only

`dashboard/page.tsx:156` checks `rota:view`, then uses the **admin client** to
read `employee_pay_settings`, `employee_rate_overrides`, `pay_band_rates` and
employee dates of birth, and renders estimated cost.

`getRotaSummaryForWeek` gets this right: it checks `rota:view` for the rota, then
separately checks `payroll:view` before exposing spend. The dashboard does not.

Latent today, because only `manager` and `super_admin` hold rota permissions and
both hold `payroll:view`. It becomes live the moment a narrower role exists.
Rev 1's claim of "no auth holes found" was too broad.

**Fix (per D10):** require `payroll:view` for every cost card, and do not fetch
dates of birth or pay rates at all without it.

## F17. `has_unpublished_changes` can be silently wrong

Several shift actions save the shift, then update the week flag in a separate
call whose error is not checked. A saved edit can therefore leave the week marked
clean, which is exactly the flag F3's new warning would have relied on. Covered
by D8: the shift write and the week state change go in one transaction.

---

# Proposed delivery

Rev 1 proposed four "independently deployable" PRs. They were not independent:
PR1 and PR4 both rewrote dashboard arithmetic, PR2 needed a database function it
did not mention, and PR3's manual republish depended on an undecided
late-acceptance policy. Re-sequenced into six, with dependencies stated.

```
PR0 print removal ──┐
                    ├──> PR1 pure arithmetic ──┐
PR0 ────────────────┘                          ├──> PR5 dashboard rebuild
                                               │
PR2 database foundations ──┬──> PR3 leave conflicts
                           └──> PR4 publish, readiness, alerts
PR6 settings and config (independent)
```

**PR0 — remove the orphan print route (XS).** Delete
`src/app/(authenticated)/rota/print/` and redirect `/rota/print?week=` to
`/api/rota/pdf?week=`. First, so nothing else refactors a route that is going.
Closes F12.

**PR1 — pure arithmetic (S).** Create `src/lib/rota/pay-math.ts` (no server
imports) and `src/lib/rota/acceptance-cutoff.ts`; `pay-calculator.ts` re-exports.
Replace all seven remaining paid-hours copies and all four cutoff declarations.
Apply the `status = 'scheduled'` rule to the PDF and dashboard totals. Closes F1
and F14. Depends on PR0.

**PR2 — database foundations (M).** Two Postgres functions with rollback
migrations: a leave-conflict-enforcing shift write, and a transactional publish
that replaces the snapshot and updates week state together. No UI change; ships
unused. Closes the integrity half of F2, F3 and F17.

**PR3 — leave conflicts (M).** Route all ten mutation-matrix paths through PR2's
function. Add clash listing and resolution links at leave approval. Remove the
employee reliability penalty for manager-created clashes. Closes F2 and F10's
approval half. Depends on PR2.

**PR4 — publish, readiness and alerts (M).** Switch `publishRotaWeek` to PR2's
transactional function. Add the readiness model, the section-nav badge, the
48-hour late-publish grace window, the widened Sunday alert and pending-leave
chasing. Closes F3, F10 and F17. Depends on PR2.

**PR5 — dashboard rebuild (M).** Rebuild on `buildRotaSummary`. Delete the inline
rate resolver and cost loop. Align hours and cost, show coverage, derive
departments, switch the ratio to total takings with the configured threshold, and
gate all cost data on `payroll:view`. Closes F4, F5, F6, F7 and F16. Depends on
PR1.

**PR6 — settings and configuration (S).** One manager-email resolver wired to all
three notification paths; holiday-year default changed to 1 January per D3;
`getTodayIsoDate()` as the single source of "today" across the section. Closes
F8, F9 and D3. Independent of the others.

Deferred, not blocking: F11 test backfill beyond what each PR carries, F13 nav
and permission filtering, F15 design tokens.

## Production repairs

Not code, and not to be done by whoever writes the code without sign-off. Moved
to `tasks/rota-2026-08-18-runbook.md`: Billy Summers' 22–23 August clash, the
28 unpublished shifts in the week of 2026-09-07, the draft gap at 2026-08-31,
the three ghost shifts in 2026-08-03, and the historical `holiday_conflict`
reliability events. Each needs a named approver, a pre-change export, an
explicit decision on whether staff are emailed, and a rollback.

Enforcement (PR2, PR3) deploys **before** the data is cleaned, so a repair
cannot immediately be undone by the next edit.
