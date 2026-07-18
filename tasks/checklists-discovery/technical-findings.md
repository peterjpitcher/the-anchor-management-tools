# Checklists, Technical Findings

Date: 2026-07-17. Six probes + adversarial verify. 59 findings, 14 blockers verified.
Raw: `_raw-tech.json`. Live prod queried read-only (`tfcasgxopxegwrabvwat`).

**Three owner decisions collide with production reality.** Those are §1–§3.

---

## 1. ⚠️ The rota is NOT the source of truth for trading hours, CONFIRMED against prod

Decision 12 says the rota tells us when we actually open. **Prod data disproves it in both
directions:**

| Date | `special_hours` says | Earliest rota shift | Gap |
|------|---------------------|---------------------|-----|
| 2026-04-03 (Good Friday) | opens **16:00** | **14:00** | rota 2h earlier |
| 2026-05-25 (Spring bank hol) | opens **12:00**, note: *"Kitchen and bar open from 12pm!"* | **16:00** | rota 4h later |

On the Spring bank holiday the pub advertised a 12:00 open and **nobody was rostered until
16:00**. On Good Friday the rota had people in two hours before the advertised open.

On normal weeks they agree, which is exactly why this idea looks fine in a spot-check and
fails in production. Two systematic exceptions even then:
- The **Sunday `Cleaning` shift runs 10:30–11:30, 90 minutes before the 12:00 open.** So
  `min(start_time)` isn't "we opened".
- Saturdays 2026-07-11 and 07-18 have `max(end_time)` of 21:00 against a 22:00 close, no
  bar close shift was rostered at all. So `max(end_time)` isn't "we closed".

**Neither source records what happened. Both are plans.** The rota is a plan about *people*;
`business_hours`/`special_hours` is a plan about *trading*.

### There's already a working resolver, and it ignores the rota

`src/app/api/foh/schedule/route.ts:241-318` resolves the trading day for the FOH page
today: fetches `business_hours` + `special_hours` and coalesces
`specialHours?.opens ?? businessHours?.opens` (`:303-306`). `special_hours` is **live and
actively maintained**, 12 real overrides in the last ~3 months.

**Recommendation:** resolve *expected* hours from `special_hours → business_hours` (reuse
this resolver, it's already on the FOH screen), use the rota only for **who**, and let the
**open checklist's own completion timestamp become the record of when we actually opened**.
That last part is free and gives you the thing neither table has.

This also dissolves the 22:00-vs-midnight contradiction differently than assumed: fix
`special_hours`/`business_hours` when hours change, which is already the habit.

---

## 2. ✅ Staff DO clock in, CORRECTED. Only Billy and Peter don't.

**A previous version of this document claimed 73% of shifts had no clock-in. That was
wrong**, the query counted sick, cancelled and open shifts as "didn't turn up". The owner
challenged it and was right. Re-run properly (60 days, `status='scheduled'`,
`is_open_shift=false`, real employees):

| Person | Job title | Shifts | Clocked in | % |
|--------|-----------|--------|-----------|---|
| Amanda Jones | Bartender | 45 | 37 | 82% |
| **Billy Summers** | **Cook** | **40** | **0** | **0%** |
| Lance Marlow | Bartender | 23 | 23 | 100% |
| Laura Bradshaw | Cook | 17 | 17 | 100% |
| Ryan Bond | Bartender | 16 | 16 | 100% |
| Jacob Hambridge | Bartender | 13 | 13 | 100% |
| Marty Pitcher-Summers | Runner | 11 | 10 | 91% |
| Harry Jefferyes | Bartender | 11 | 11 | 100% |
| **Peter Pitcher** | **Host** | **8** | **0** | **0%** |
| Jacob Williams | Bartender | 8 | 8 | 100% |
| Oakley McNulty | Runner | 1 | 1 | 100% |

Job titles are `employees.job_title` and are correct as stored, Bartenders: Amanda, Harry,
Jacob H, Jacob W, Lance, Martha Lilley, Ryan. Cooks: Billy, Laura. Host: Peter. Runner:
Marty. **No data fix needed.**

**Everyone who works clocks in, 82–100%.** The exceptions are exactly two people: **Billy
(0 of 40) and Peter (0 of 8)**, and per decision 23 **that is settled and fine, not a
defect**. Between them that's 70 kitchen shifts, 11 host, 1 bar.

Two unrelated oddities noticed while checking: **Martha Lilley** is Active with no shifts in
60 days, and **Oakley McNulty** appears in the shift data but is not Active (a leaver).
Neither affects this build.

**And people are still clocked in when the closing list gets done.** Clock-out hour
distribution (last 60 days): **48 sessions at 22:00–22:59, 8 at 23:00, 9 at midnight.** The
closing list happens inside the session, before they clock out. No problem.

**Auto-close never fires**, 142 sessions in 60 days, `is_auto_close = false` on every one.
So the `rota-auto-close` cron isn't a threat to attribution.

**So the real issue is narrow: kitchen tasks.** Billy does 70 kitchen shifts and never
clocks in, so a kitchen task's picker would be empty whenever he's the only one on.

**Recommendation (unchanged in shape, much smaller in scope):** the picker shows anyone
clocked in (pre-ticked, usually 1–2 names, so it stays a single tap), plus anyone rostered
that day, plus a search over active employees. An empty picker must never block ticking.
`timeclock_sessions.linked_shift_id` joins a clock-in back to its rota shift.

**Lesson recorded:** don't put a subagent's aggregate to the owner without running the
query. See `tasks/lessons.md`.

---

## 3. ⚠️ "The closer is responsible" has no data definition, CONFIRMED

Decision 8 makes the closer responsible for all checks. Live bar templates:

- `Sunday Open` 12:00–17:00 → `Sunday Close` 17:00–22:00 ✅
- `Tuesday Open` 16:00–18:00 → `Tuesday Close` 18:00–22:00 ✅
- Thursday, Friday, Saturday, same pattern ✅
- **`Monday` 16:00–22:00**, one all-day shift. No Open, no Close. ❌
- **`Wednesday` 16:00–22:00**, same. ❌

Monday and Wednesday used to be split (the inactive Open/Close pairs are still there) and
were **merged**. One person opens *and* closes. The name contains neither word.

The `name` field is unreliable anyway: NULLs, ad-hoc values, and duplicate names
distinguished only by `is_active` (two `Saturday Close`, two `Friday Close`, and more).

**Recommendation:** define the closer as **the scheduled shift with the latest `end_time`
on that date, tie-broken to `department='bar'`**, with a manual override on the close
screen. Never parse the name.

**Trap:** `end_time = '00:00:00'` is overloaded, it's genuine midnight for Friday/Saturday
Close *and* the placeholder on 20 `status='sick'` rows. `is_overnight` won't save you: it's
**hand-set via a checkbox** (`ShiftDetailModal.tsx:227`), not derived, so it can just be
wrong.

---

## 4. ⚠️ Five departments, not two, CONFIRMED

Decision 8 tags tasks bar/kitchen. Live: **bar 1113, kitchen 277, runner 91, cleaning 18,
host 17.** Bar/kitchen-only orphans **126 shifts (8%)**.

Two concrete breaks:
- **The `Cleaning` 10:30–11:30 shift is the first person in the building every Sunday.** If
  open tasks are bar/kitchen-only, **the person physically opening the pub is invisible to
  the checklist.**
- A kitchen-tagged task on a Monday has nobody to assign it to:
  `business_hours.is_kitchen_closed = true` for Monday.

**No FK and no CHECK exist**, `rota_shifts.department` is free text (the CHECK was dropped
by `20260301120000_rota_shifts_drop_department_check.sql`). Department is **per-shift, not
per-employee**, the same person works bar one day, kitchen the next.

**Recommendation:** FK task tags to the `departments` table. `departments.name` is already a
PK, zero rows would violate it today, and a sixth department later needs no migration.
Code must tolerate unexpected strings rather than switch exhaustively.

---

## 5. The rota publish horizon

Published through week_start **2026-08-10** (~4 weeks out). Beyond that: two draft weeks
*with* shifts, then empty placeholder weeks. **Three states, not two.**

Right now `has_unpublished_changes = true` for 2026-07-27, the draft has drifted from the
snapshot mid-horizon.

`published_at` is **overwritten on every re-publish** (`rota.ts:3009`), so it's a last-touch
date, not a first-publish date, publish lag isn't measurable from it.

**Recommendation:** read **`rota_published_shifts`** (what staff were actually told, you
can't hold someone to a draft edit they never saw), generate instances **lazily on the day
or T-1**, and when no rota is published, **show the checklist with nobody pre-blamed**.
Never invent a closer.

Note: `rota_published_shifts` drops `template_id` and `sick_reason` but **keeps
`status='sick'` rows** (only `cancelled` is filtered at `rota.ts:2879`).

---

## 6. The "employee audit log" for spot checks

Two candidate homes, and one trap.

**`employee_reliability_events`** (`20260706000000_employee_reliability_events.sql:3-41`) is
the right *shape*: per-employee, append-only, scored, service-role writes, idempotency key,
**and it already has a Reliability tab on the employee record** (`page.tsx:278-279`).

But **verify refuted extending it**: its `event_type` CHECK is closed, and
`src/lib/employee-reliability-scoring.ts:128-178` is an exhaustive switch **with no
default**, with a shift-acceptance denominator at `:179-180`. Adding spot checks would
**pollute the reliability score**.

**Trap on `audit_logs`:** the employee trail is hardcoded `.limit(50)`
(`src/services/employees.ts:1019`). **2 spot checks/day is ~730/year**, real HR history
gets pushed off the page within weeks. Also `audit_logs.user_id` is the **acting** user
(Billy), not the person checked, the credited employee must go in
`resource_id`/`additional_info`.

Also: `employee_version_history` has **no `operation_type` filter**, so a new operation_type
against `resource_type='employee'` would appear unfiltered in Recent Changes *and shift
`version_number` for every existing employee history row*.

**Recommendation:** a **sibling `spot_checks` table** (checker, checked employee, task
instance, pass/fail, note, date) modelled on `employee_reliability_events`, **plus** a
`logAuditEvent()` row for the trail, and raise or filter the 50-row cap.

---

## 7. ✅ Good news: the jobs queue solves the 2-hourly problem

**No new cron needed.** `* * * * *` → `/api/jobs/process?process=true&batch=30` already
runs (`vercel.json`, first entry). Table `jobs` with leasing
(`20260414000000_job_queue_claiming.sql`): `claim_jobs()` is SECURITY DEFINER,
`FOR UPDATE SKIP LOCKED`, service_role only.

`jobQueue.enqueue(type, payload, { priority, maxAttempts, delay, unique })`
(`src/lib/unified-job-queue.ts:212`), `delay` sets `scheduled_for = now + delay`
(`:351`); `unique` takes a 15-min idempotency lock **and** copies into
`payload.unique_key` (`:347`).

**This means trading hours never need to be known by a cron.** Generate the day's instances
once, enqueue each 2-hourly check with `delay` set to its London due-instant and
`unique = checklist:<templateId>:<londonDate>:<slot>`. `scheduled_for` does the rest.

**Gotcha:** a new job type must be added in **three** places or it silently never runs:
the `JobType` union (`:26-41`), `SUPPORTED_JOB_TYPES` (`:43-59`, which filters
`claim_jobs` at `:642`), and the `executeJob` switch (`:985`), whose default **throws**.

---

## 8. FOH chromeless, a one-line change

`src/lib/foh/user-mode.ts:7`, `isFohOnlyUser` currently tests
`permissions.every(p => p.module_name === 'table_bookings')`. A second module fails it
instantly, and those users get the full sidebar on the FOH iPad.

**Recommendation:**
```ts
const FOH_MODULES = new Set(['table_bookings', 'checklists'])
// ...
permissions.every(p => FOH_MODULES.has(p.module_name))
```
Keep `table_bookings:view` as the anchor. FOH-only users have no sidebar by design, so the
checklists nav item is invisible to them, which is what we want. They reach it from the
FOH button and the modal.

---

## 9. Smaller notes

- **FOH buttons are raw `<button>`, not `@/ds` Button** (`FohHeader.tsx:225-297`). Match
  the local style rather than introducing `@/ds` mid-row.
- **Two competing page conventions.** Recommend the cashing-up section-layout pattern, it
  matches a multi-screen shape and centralises the permission redirect.
- **Email log:** recommend a new `checklist_email_log` rather than extending
  `rota_email_log`'s `email_type` CHECK.
- **`manager@the-anchor.pub` should be an env var**, not hard-coded, follow the
  `PAYROLL_ACCOUNTANT_EMAIL` pattern.
- **Lesson from commit `baa8f428`** (manager alert fix): the alert named nobody and printed
  raw UTC. Any checklist email must name the person and format in London. Reproduce with
  `TZ=UTC`, the bug is invisible on a London laptop.
