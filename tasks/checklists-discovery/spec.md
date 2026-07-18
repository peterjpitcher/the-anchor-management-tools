# Spec, Checklists & Todos

**Status:** v4, awaiting owner approval of the seed table (§17). No code written.
**Date:** 2026-07-17
**Complexity:** 5 (XL). New module, 10 tables, 4 screens, scheduling engine, scoring.
Split into phases, see [§14](#14-delivery-phases).

**v4** applies the external developer review
([spec-review-developer-report.md](spec-review-developer-report.md)): every P0 closed,
disposition of all 52 findings in
[spec-review-disposition.md](spec-review-disposition.md). The review was right that v3
was not buildable at the contract level; the biggest self-inflicted defects were the
floating-task lifecycle contradicting the sweep, two accountability rules that disagreed,
a due-time job with no behaviour, and a rollback claim that ignored most of Phase 2.

Companions: [decisions.md](decisions.md) (25 settled decisions, the source of truth),
[technical-findings.md](technical-findings.md), [bar-checklist.md](bar-checklist.md),
[research-findings.md](research-findings.md), [review-log.md](review-log.md),
[spec-review-disposition.md](spec-review-disposition.md).

---

## 1. What this is

A checklists system for The Anchor. Billy and superadmins set up recurring tasks; staff
complete them on the FOH iPad; superadmins see who's doing what, what's being missed, and
per-person timeliness. Billy spot-checks two items a day.

**It is an internal ops tool** (decision 1). It makes no compliance claim and does not
replace the paper food-safety diary.

### Success criteria

- Billy can build the bar checklist without a developer.
- A bartender can complete the opening list on the iPad in under 90 seconds of recording
  time (not counting doing the work). Measured on the real iPad in Phase 2 UAT with the
  sticky-identity flow (§9.3) before go-live; if it fails, the flow changes before launch.
- A superadmin can answer "what didn't get done last week, and who was on?" in one screen
  (the Problems tab, §9.4).
- Billy's spot-check recorded/expected and pass rates are visible over time. Those are the
  numbers that say whether the ticks mean anything.

### Explicitly out of scope

Photo evidence, offline capture, QR/NFC location proof, Bluetooth probes, sensors,
compliance export/EHO mode, retention automation, staff-visible scores, gamification,
cross-site anything. Revisited in [§15](#15-deferred).

---

## 2. Concepts

| Term | Meaning |
|------|---------|
| **Checklist** | A named group of tasks, e.g. "Bar Opening", "Bar Closing". |
| **Task template** | A recurring job, e.g. "Hoover carpet area". Defines cadence, department, whether it needs a value, whether it's spot-checkable. |
| **Task instance** | One occurrence of a template on one business day/slot. What staff tick. |
| **Business day** | 06:00 London to 06:00 London the next calendar day. A 00:30 closing task belongs to the night before. |
| **Trading window** | The day's expected `opens`/`closes`/`is_closed`, resolved per [§5.1](#51-the-trading-window-resolver). A `closes` at or before `opens` means the **next calendar day** (§5.3). |
| **Closer** | The person accountable for the business date, resolved per [§6](#6-accountability). Every miss is attributed to the closer. |
| **Completer** | Who ticked it. Owns the tick and its timeliness (decision 24). |
| **Todo** | A one-off, non-recurring job. Own table (§3.6), own mini-spec before build (§15). Never an instance. Not scored. |

---

## 3. Data model

Eleven new tables. `snake_case`, RLS on with **deny-all policies** (§12), manual camelCase
mapping in query transforms (this project has no `fromDb<T>()` helper).

Employee FKs are `ON DELETE RESTRICT` throughout: employees in this app are
status-lifecycle rows (`Active`/`Started Separation`/former), never hard-deleted, so
history keeps its names and leavers remain reportable.

### 3.1 `checklists`

```
id                uuid pk
name              text not null            -- "Bar Opening"
description       text
department        text not null references departments(name)   -- decision 20
sort_order        int not null default 0
is_active         boolean not null default true
created_at/by, updated_at
```

`departments` is `(name, label, sort_order, created_at)`. `name` is the PK. Live rows: bar,
kitchen, runner, host, cleaning.

**Deletion:** a checklist or template that has ever generated an instance cannot be hard
deleted (`ON DELETE RESTRICT` from instances). Setup offers deactivate/archive instead. A
never-used draft may be hard-deleted.

### 3.2 `checklist_task_templates`

```
id                    uuid pk
checklist_id          uuid not null references checklists(id) on delete restrict
title                 text not null
instruction           text                  -- the cleaning-check points blurb
sort_order            int not null default 0
department            text references departments(name)  -- null = inherit from checklist

-- cadence (§4)
schedule_kind         text not null check (schedule_kind in ('calendar','floating'))
freq                  text check (freq in ('daily','weekly','monthly','quarterly','annual'))
freq_interval         int not null default 1        -- every N units of freq
anchor_date           date                           -- recurrence anchor (§4); required
                                                     --   when freq_interval > 1 or freq in
                                                     --   ('monthly','quarterly','annual')
by_weekday            int[]                          -- 0=Sun. null = every day (daily/weekly)
anchor                text not null default 'open'
                        check (anchor in ('open','close','every','at_times','anytime'))
at_times              time[]                         -- literal fixed clock times (at_times only)
every_hours           numeric                        -- 'every' anchor: interval, e.g. 2
first_offset_minutes  int                            -- 'every': first slot after open;
                                                     --   null = every_hours*60
not_before            time                           -- 'every': optional floor, drop earlier slots
lead_minutes          int not null default 0         -- §5.3
grace_minutes         int                            -- null = checklist_settings default
interval_days         int                            -- floating only
tolerance_days        int                            -- floating only
first_due_on          date                           -- floating only: seed anchor (§4);
                                                     --   set at creation, staggered in the seed
season_start          text                           -- 'MM-DD', null = all year
season_end            text                           -- wraps the year end

-- value capture (§3.2.1)
requires_value        boolean not null default false
value_unit            text                           -- 'degC' (the only unit in v1)
value_min             numeric(5,1)
value_max             numeric(5,1)

is_spot_checkable     boolean not null default false
is_active             boolean not null default true
version               int not null default 1         -- §3.4
created_at/by, updated_at
```

Cross-field validity is enforced in the database (§3.12) and mirrored in Zod in the Setup
UI, and checked **at activation**, never discovered at generation time.

#### 3.2.1 Value capture rules (one threshold pair)

Decision 14 specifies one behaviour: out of threshold → save the tick, email manager@,
show "Contact Billy or Peter". So one pair, and `value_breach` is a boolean. If a quieter
"keep an eye on it" second tier is ever wanted, it is a cheap addition, queued in §17.

Exact rules (F-43):

- Storage `numeric(5,1)`. UI input `step="0.1"`, locale decimal point only.
- **Bounds are inclusive**: in range means `value_min <= v <= value_max`. Exactly 8.0
  against a max of 8.0 is in range.
- **One-sided bands are allowed**: a null bound is unbounded on that side. At least one
  bound must be set when `requires_value` (§3.12).
- Negative values are valid (freezers later).
- **Typo guard** (§9.3): with both bounds, confirm once when
  `v < min - 3*span or v > max + 3*span` where `span = max(max - min, 1.0)`. With one
  bound, confirm when `abs(v - bound) > 20`. Confirming saves as entered. A reading is
  never silently rejected.
- **Correction** (§5.8): pre-lock, by `manage`, audited. A corrected value that is still or
  newly out of range does not re-email; corrections appear in the weekly summary. One
  breach email per instance (outbox key `value_breach:<instance_id>`, §10).

### 3.3 `checklist_task_instances`

```
id                        uuid pk
template_id               uuid not null references checklist_task_templates(id) on delete restrict
template_version          int not null
checklist_id              uuid not null references checklists(id) on delete restrict
generation_run_id         uuid references checklist_generation_runs(id)   -- §3.11
business_date             date not null
slot                      text not null            -- 'open' | 'close' | 'HH:MM' | 'anytime'
department                text not null

-- snapshotted at generation (never joined live)
title_snapshot            text not null
instruction_snapshot      text
requires_value            boolean not null
value_unit                text
value_min                 numeric(5,1)
value_max                 numeric(5,1)
is_spot_checkable         boolean not null          -- snapshotted so the draw needs no live join

window_start              timestamptz not null      -- §5.3
due_at                    timestamptz not null      -- §5.3
grace_until               timestamptz not null      -- §5.3; for floating this spans the
                                                    --   whole tolerance window (§4)
state                     text not null default 'pending'
                            check (state in ('pending','done','missed','skipped','not_applicable'))
locked_at                 timestamptz               -- §5.6/§7; set per instance by the sweep

accountable_employee_id   uuid references employees(employee_id) on delete restrict
                          -- context only: the covering shift (§6). NOT used for blame.
completed_by_employee_id  uuid references employees(employee_id) on delete restrict
completed_at              timestamptz               -- always the TRUE time
was_late                  boolean not null default false
value_recorded            numeric(5,1)
value_breach              boolean not null default false
notes                     text                      -- decision 2
skip_reason               text

created_at, updated_at

unique (template_id, business_date, slot)
```

Indexes: `(business_date, checklist_id)`, `(completed_by_employee_id, business_date)`,
`(state, grace_until) where state = 'pending'`, `(generation_run_id)`.

**Why snapshot?** Editing "Hoover carpet area" must not rewrite last month's records. The
checklist's *name* is deliberately a live join: renaming "Bar Opening" is cosmetic and
should update everywhere.

### 3.4 Template versioning

Changes to `title`, `instruction`, `requires_value`, `value_min`, `value_max`,
`is_spot_checkable` **bump `version`**. Instances pin the version they were generated
under. Cadence changes do not bump; they affect future generation only.

A template edited mid-day does not touch today's existing instances: the unique constraint
stops re-creation and the snapshots keep the old text. Intended.

### 3.5 `checklist_spot_checks`

Two-phase lifecycle: drawn, then recorded.

```
id                   uuid pk
instance_id          uuid not null references checklist_task_instances(id)
business_date        date not null
draw_number          int not null              -- 1..spot_checks_per_day
checked_employee_id  uuid not null references employees(employee_id) on delete restrict
                     -- snapshot of instance.completed_by at draw time; server-enforced equal
drawn_at             timestamptz not null
state                text not null default 'drawn' check (state in ('drawn','recorded'))
checked_by_user_id   uuid                       -- Billy, set at recording
result               text check (result in ('pass','fail'))
note                 text
recorded_at          timestamptz

unique (instance_id)
unique (business_date, draw_number)

constraint spot_check_recorded_complete check (
  state <> 'recorded' or (result is not null and recorded_at is not null
                          and checked_by_user_id is not null)
)
```

Index: `(business_date)`.

Drawn-but-never-recorded rows surface on the Problems tab: that is the signal Billy is not
walking the floor, which §11 says is the real risk.

#### Why a sibling table, not `employee_reliability_events`

Its `event_type` CHECK is a closed `IN` list
(`20260706000000_employee_reliability_events.sql:6-17`), so Postgres rejects the insert
outright. Widening it would also mean widening
`src/lib/employee-reliability-scoring.ts:128-178`, an exhaustive switch with no default,
and its shift-acceptance denominator at `:179-180`.

Recording also writes `logAuditEvent({ resource_type: 'employee', resource_id: <checked
employee> })` so it lands on the existing employee trail (decision 7).

⚠️ The employee trail is hardcoded `.limit(50)` (`src/services/employees.ts:1019`).
2 checks/day is ~730/year. **This build must raise the limit and add a filter** to
`EmployeeAuditTrail.tsx`. Not optional.

⚠️ `audit_logs.user_id` is the **acting** user (Billy). The checked employee goes in
`resource_id`, never `user_id`.

⚠️ Use operation_type **`update`**, never a new one: `employee_version_history` has no
operation_type filter, so a new one shifts `version_number` across all existing employee
history.

### 3.6 `checklist_todos`

One-off tasks (decision 2). Not scored. Never an instance. **Deferred to Phase 4 behind a
one-page mini-spec** (§15); the table ships in Phase 1 so the schema is settled.

```
id, title, description, department references departments(name),
assigned_employee_id uuid references employees(employee_id) on delete restrict,
due_date date,
state text not null default 'open' check (state in ('open','done','cancelled')),
completed_by_employee_id, completed_at, notes, created_at/by, updated_at
```

Index: `(state, due_date)`.

### 3.7 `checklist_email_outbox`

An **outbox**, not a log. The row is written **in the same transaction** as the event that
requires it (a breach with its tick, a mismatch with its detection); the jobs queue then
delivers it with retries. Own table; do not extend `rota_email_log`'s `email_type` CHECK.

```
id               uuid pk
email_type       text not null check (email_type in
                   ('weekly_summary','value_breach','system_alert'))
source_type      text not null            -- 'instance' | 'mismatch' | 'generation_run' | 'week'
source_id        text not null
idempotency_key  text not null unique     -- e.g. value_breach:<instance_id>,
                                          --      weekly_summary:<iso-week>
to_addresses     text[] not null
subject          text not null
status           text not null default 'pending'
                   check (status in ('pending','held','sent','failed'))
attempts         int not null default 0
next_attempt_at  timestamptz
error_message    text
message_id       text
created_at, sent_at
```

Index: `(status, next_attempt_at)`.

`held` = created while `emails_enabled = false` (§3.8): the record exists, nothing sends.
Delivery: up to 5 attempts with exponential backoff; on final failure, `status='failed'`
and a `system_alert` row to Peter (which itself retries).

### 3.8 `checklist_settings`

Singleton, enforced: `id int primary key default 1 check (id = 1)`.

```
id int pk (=1)
autumn_winter_start text default '10-01', autumn_winter_end text default '03-31',
spot_checks_per_day int default 2, default_grace_minutes int default 30,
business_day_start_hour int default 6,
open_lead_minutes int default 0, close_lead_minutes int default 60,
mismatch_threshold_minutes int default 30, mismatch_early_threshold_minutes int default 90,

-- kill switches (F-40): superadmin-changeable without a deploy, every change audited
module_enabled      boolean not null default false,  -- master: hides FOH entry + nav
generation_enabled  boolean not null default false,  -- generation job no-ops when false
prompts_enabled     boolean not null default false,  -- mid-shift modal (Phase 4)
emails_enabled      boolean not null default false,  -- outbox rows created as 'held' when false

updated_at/by
```

A table not constants: Billy moves the season boundary and spot-check count, and Peter can
stop faulty automation, without a deploy.

### 3.9 `checklist_hours_mismatches`

```
id uuid pk, business_date date not null,
kind text not null check (kind in ('no_cover_at_open','no_cover_at_close','rota_before_open')),
expected_opens_at timestamptz, expected_closes_at timestamptz,
rota_earliest_start_at timestamptz, rota_latest_end_at timestamptz,
mismatch_minutes int not null,
notified_at timestamptz, created_at,
unique (business_date, kind)
```

A single date can carry all three kinds (F-19). Instants, not bare times, so overnight
windows compare correctly. Informational in v1: no acknowledge workflow.

### 3.10 `checklist_spot_check_expectations`

```
business_date date pk, expected int not null
```

Written at generation. `drawn` and `recorded` are **derived from `checklist_spot_checks`
rows at read time**, never maintained as counters (F-21): counters drift, source rows
don't. A day with no draw is then a stored 0-of-2, not an absence.

### 3.11 `checklist_generation_runs`

```
id uuid pk, business_date date not null,
attempt int not null default 1,
status text not null check (status in ('running','complete','failed','skipped_closed')),
window jsonb,               -- the resolved TradingWindow, verbatim (provenance)
instances_created int, instances_updated int, instances_retracted int,
error_message text,
started_at, finished_at,
unique (business_date, attempt)
```

Answers three questions v3 could not: did today generate (F-11), what hours did it use
(O-05), and what should the FOH screen say when it didn't (F-32). The latest run's status
drives the "checklist unavailable" state (§9.3) and the manage Today tab (§9.4).

### 3.12 Integrity constraints (database-enforced)

State invariants (F-13), enforced as CHECKs so jobs, retries and future code cannot write
impossible rows:

- `state='done'` ⇒ `completed_by_employee_id`, `completed_at` not null.
- `state in ('missed','pending')` ⇒ `completed_by_employee_id`, `completed_at`,
  `value_recorded` all null.
- `state='skipped'` ⇒ `skip_reason` not null.
- `requires_value and state='done'` ⇒ `value_recorded` not null.
- `not requires_value` ⇒ `value_recorded` null.
- `window_start <= due_at` and `due_at <= grace_until`.

Template validity:

- `schedule_kind='calendar'` ⇒ `freq` not null; `interval_days`, `tolerance_days`,
  `first_due_on` null.
- `schedule_kind='floating'` ⇒ `interval_days >= 1`, `tolerance_days >= 0`, `first_due_on`
  not null; `freq`, `anchor` forced to `'anytime'`, `at_times`/`every_hours` null.
- `anchor='every'` ⇒ `every_hours > 0`. `anchor='at_times'` ⇒ `at_times` non-empty.
  `anchor not in ('every')` ⇒ `every_hours`/`first_offset_minutes`/`not_before` null.
- `freq_interval >= 1`; `anchor_date` not null when `freq_interval > 1` or `freq in
  ('monthly','quarterly','annual')` or (`freq='weekly'`).
- `grace_minutes >= 0`, `lead_minutes >= 0` where set.
- `value_min <= value_max` when both set; `requires_value` ⇒ at least one bound and
  `value_unit` set.
- `season_start`/`season_end`: both or neither; format `^[0-1][0-9]-[0-3][0-9]$`.

Cross-table rules that CHECKs cannot express are enforced in the two RPCs (§9.3, §11):
spot-check `checked_employee_id = instance.completed_by_employee_id` at draw; every
mutation gated on `locked_at is null`.

---

## 4. The cadence model

The bar list needs eight shapes. Two `schedule_kind`s cover them.

### `calendar`, anchored to the trading day

| Need | Config |
|------|--------|
| Opening list | `freq=daily, anchor=open` |
| Closing list | `freq=daily, anchor=close` |
| Daily temps | `freq=daily, anchor=open, requires_value=true` |
| The 2-hourly cleaning checks | `freq=daily, anchor=every, every_hours=2` |
| Weekly | `freq=weekly, by_weekday={1}, anchor_date=<first Monday>` |
| Bi-weekly | `freq=weekly, freq_interval=2, anchor_date=<first occurrence>` |
| Monthly / quarterly / annual | `freq=monthly \| quarterly \| annual, anchor_date=<first occurrence>` |
| Autumn/Winter candles | `freq=daily, anchor=open, season_start='10-01', season_end='03-31'` |

#### Recurrence anchors (F-04)

`anchor_date` is the template's first occurrence date and makes every frequency
deterministic:

- **daily**, `freq_interval=N`: due when `days_between(anchor_date, d) % N = 0`.
- **weekly**: due when `d`'s weekday ∈ `by_weekday` and
  `weeks_between(week_start(anchor_date), week_start(d)) % freq_interval = 0`.
- **monthly**, `freq_interval=N`: due when `months_between % N = 0` on
  `day_of_month(anchor_date)`, **clamped to the last day of shorter months** (31st → 30
  Apr, 28/29 Feb).
- **quarterly**: monthly with an interval of 3 months.
- **annual**: same month and day as `anchor_date`; 29 Feb falls on 28 Feb in non-leap
  years.

#### The 2-hourly checks are `every N hours from open` (decision 25)

Slots are computed at generation from the day's actual trading window:

```
first = opens + (first_offset_minutes ?? every_hours*60)
slots = first, first + every_hours, ...   while slot_instant < closes_instant
drop slots earlier than not_before (if set)
```

A slot landing exactly at close is dropped: that is the closing list's job. Comparison is
on **instants** (§5.3), so a midnight close yields evening slots correctly.

Worked against prod hours:

| Day | Window | Slots | vs the written list |
|-----|--------|-------|---------------------|
| Mon to Fri | 16:00 to 22:00 | 18:00, 20:00 | matches |
| Fri (if close 00:00) | 16:00 to 00:00 | 18:00, 20:00, 22:00 | the "22:00 Fri/Sat" check falls out automatically |
| Sat/Sun | 12:00 to 22:00 | 14:00, 16:00, 18:00, 20:00 | two extra afternoon checks, owner to confirm (§17) |

`at_times` (literal fixed clock times) stays in the model for future checklists; no bar
task uses it now.

**All `every` and `at_times` slots clamp to the trading window.** A 19:00 special open
means no 18:00 slot is generated, not generated-then-missed.

**Seasons wrap the year end.** `10-01` to `03-31` means Oct to Mar:
`start <= end ? (d >= start && d <= end) : (d >= start || d <= end)` on `MM-DD` strings.

**Pool table is two templates.** "Brush pool table (only spray once a week)" is a floating
brush plus a weekly spray. Seeded as two.

### `floating`, anchored to last completion (rewritten in v4, F-02/F-03)

For the "between daily and weekly" items. "Roughly weekly, no fixed day" has no calendar
representation; this is the only honest model.

**The recurrence formula.** All dates are business dates:

```
next_due(template) =
  if no prior instance:            first_due_on          (set at creation; seed staggers these)
  else, prior instance considered = the most recent instance in a terminal state
    if it was done:                max(its due date, its completion business date) + interval_days
    if it was missed:              its miss date (grace_until's business date) + interval_days
    if skipped/not_applicable:     its due date + interval_days
```

`max(due, completed)` is the early-completion clamp stated precisely: completing 2 days
early does not pull the next due earlier than the original rhythm, and completing late
pushes the next one out (drift is the point).

**The instance lifecycle** (this is what v3 got wrong):

- Generated on its due date with `slot='anytime'`, `window_start` = business day start,
  `due_at` = **end of the due business day**, and
  `grace_until = due_at + tolerance_days * 24h`. The grace window IS the tolerance.
- The daily sweep (§5.6) acts on `grace_until`, per instance. So a floating instance with
  2 days' tolerance survives two sweeps untouched and is only marked `missed` (and locked)
  by the third. No contradiction with locking: floating instances lock when resolved, not
  at the end of their first day.
- At most one open instance per template: generation skips any template with a `pending`
  instance.
- After a miss, the missed instance stays as the record; the next instance appears
  `interval_days` after the miss date (formula above).
- Completion is allowed any time while `pending`; `was_late` is false while
  `completed_at <= grace_until` (so within tolerance = on time, by design).

**Worked example** (`interval_days=4, tolerance_days=2`, first_due_on Mon 6th):

The "miss date" is the business date of `grace_until` (the day tolerance runs out), and the
next cycle starts `interval_days` after it. `due_at` for a floating instance is the end of
the due business day (next 06:00), so with a Mon 6th due date and 2 days' tolerance,
`grace_until` is 06:00 Thu 9th and its business date is the 9th.

| Event | Result |
|-------|--------|
| Generated Mon 6th | due Mon 6th, grace runs to 06:00 Thu 9th (miss date = 9th) |
| Done Tue 7th | on time. Next due `max(6th, 7th) + 4` = Sat 11th |
| Done Sun 12th (within the next cycle's grace) | on time, next due `12th + 4` = Thu 16th |
| Never touched | swept + locked at 06:00 Thu 9th as missed; next due `9th + 4` = Mon 13th |

- Floating instances never carry personal blame (§6): nobody is accountable for a
  "whenever" task. Their misses appear on the Problems tab against the venue, not a person.
- First-run pile-up: the seed staggers `first_due_on` across each template's
  `interval_days` so 12 tasks don't all land on day one.

### Timezone

Rules in local wall time, expanded in `Europe/London`, instances store resolved
`timestamptz`. **All tests run under `TZ=UTC`**: every timezone bug in this codebase's
history was invisible on a London laptop (`reference_manager_alert_utc_bug`, commit
`baa8f428`).

⚠️ `src/services/business-hours.ts:760` (`isSiteOpen`) uses `new Date(date).getDay()`,
server-local, the pattern `CLAUDE.md` forbids. Do not call it. Use `:191`'s `getUTCDay()`
approach or `dateUtils`.

**DST:** expansion is from local wall time. A slot that does not exist on the
spring-forward day is skipped; one that occurs twice on the autumn day takes the first.
Neither affects the pub (earliest slot 14:00), but the expander must not throw. The 06:00
business-day boundary is clear of both transitions.

---

## 5. Instance generation

### 5.1 The trading-window resolver

The FOH page's existing hours logic (`src/app/api/foh/schedule/route.ts:241-318`) **must
not be reused**: `is_closed` there uses row precedence, not COALESCE (`:293-302`), a
closed day silently becomes a fabricated `09:00 to 23:00, source:'fallback'` window
(`:277-286`, `:307`), `is_closed` is absent from its return type, and there is no
extractable function. Had the generator reused it, the first closed day would have
generated ~45 instances, swept them all as missed, and locked the damage in permanently.
Latent, not live: prod `special_hours` has no `is_closed = true` rows yet.

**Write our own**, `src/lib/checklists/trading-window.ts`:

```ts
export type TradingWindow =
  | { isClosed: true; source: 'special_hours' | 'business_hours' }
  | { isClosed: false; opensAt: Date; closesAt: Date;      // zoned instants (§5.3)
      source: 'special_hours' | 'business_hours' }
  | { resolved: false; reason: 'query_error' | 'no_hours' | 'invalid_hours' }
```

True field-by-field COALESCE, **including `is_closed`**. Never fabricates a window.

**Truth table** (F-27), per field with S = special row, B = business row:

| Case | Result |
|------|--------|
| No S row | B's values throughout |
| S exists, `S.is_closed = true` | closed (S), times irrelevant |
| S exists, `S.is_closed = false` | open; each time field = `S.x ?? B.x` |
| S exists, `S.is_closed IS NULL` | `is_closed = B.is_closed ?? false`; times `S.x ?? B.x` |
| Resolved open but `opens` or `closes` still null | `{resolved:false, reason:'no_hours'}` |
| `opens = closes`, or closes-instant past the business-day end | `{resolved:false, reason:'invalid_hours'}` |
| Query error | `{resolved:false, reason:'query_error'}` |

A partial S row (times only, `is_closed` null) therefore inherits the closed flag from B
and overrides only the times it supplies. Providing times does **not** imply open.

Refactoring the FOH route onto this resolver is out of scope (live route, own fallback
semantics, no coverage); noted as debt in §15.

### 5.2 The trigger

A thin daily cron, `/api/cron/checklists-generate`, `0 4 * * *` UTC in `vercel.json`,
guarded by `authorizeCronRequest()` (`src/lib/cron-auth.ts:22`), re-checking London wall
time over a window to absorb DST (the pattern at `rota-auto-close/route.ts:22-33`). It
does two things and holds no logic:

1. Enqueue `checklist_generate_day` for today's business date.
2. Enqueue `checklist_sweep` (no date parameter: the sweep is a catch-up scan, §5.6).

If `generation_enabled = false` (§3.8), the generation job records a run with
`status='skipped_closed'`? No: it no-ops without a run row, and the FOH screen shows the
module-disabled state instead. Flags are checked inside the jobs, not the cron.

`0 4 * * *` UTC is 04:00/05:00 London: before the 06:00 boundary, hours before any open.

### 5.3 Windows, instants, and cross-midnight (F-05)

One function expands a business date plus local times into zoned instants, used
everywhere (generation, mismatch detection, accountability):

```
opensAt  = zoned(date, opens, Europe/London)
closesAt = zoned(closes <= opens ? date + 1 day : date, closes, Europe/London)
valid only if closesAt <= businessDayEnd(date)   -- 06:00 London next day
opens = closes  → invalid_hours
```

So `16:00 to 00:00` is a valid Friday window ending Saturday 00:00, and its every-2h slots
are 18:00, 20:00, 22:00. Trading past 06:00 is a configuration error surfaced to Peter,
not a silent misparse.

Per-anchor instants:

| anchor | `window_start` | `due_at` | `grace_until` |
|--------|---------------|----------|---------------|
| `open` | `opensAt - open_lead_minutes` (default 0) | `opensAt` | `due_at + grace` |
| `close` | `closesAt - close_lead_minutes` (default 60: the closing list appears an hour before the doors shut) | `closesAt` | `due_at + grace` |
| `every` | `slot - lead_minutes` | `slot` | `due_at + grace` |
| `at_times` | `t - lead_minutes` | `t` | `due_at + grace` |
| `anytime` (floating) | business day start | end of due business day | `due_at + tolerance_days*24h` (§4) |

`grace = template.grace_minutes ?? settings.default_grace_minutes` (30).

Each `every`/`at_times` slot is its own instance with `slot = 'HH:MM'` of the local wall
time, so `unique(template_id, business_date, slot)` holds.

### 5.4 The generation job (atomic, recorded, reconciling)

`checklist_generate_day(business_date)`:

1. Insert a `checklist_generation_runs` row, `status='running'`, next `attempt` number.
2. `resolveTradingWindow(date)`.
   - `{resolved:false}` → run `status='failed'` with the reason, **generate nothing**, and
     write a `system_alert` outbox row to Peter (decision 22). Never generate against
     hours we could not resolve.
   - `{isClosed:true}` → run `status='skipped_closed'`. Nothing generated, not a failure.
3. Compute the **desired instance set** for the date: every active `calendar` template
   matching date/season/weekday expanded per §4 and §5.3, plus every active `floating`
   template whose `next_due <= date` and which has no pending instance.
4. **Reconcile inside one transaction** (F-11, F-12):
   - Insert desired rows that do not exist (`unique` key makes retry idempotent).
   - For existing `pending` rows whose slot still exists but whose computed
     `window_start/due_at/grace_until` changed (a late `special_hours` edit): update the
     timestamps in place, same id.
   - Delete `pending` rows whose slot is no longer in the desired set.
   - Never touch a row that has left `pending`. If hours changed after a completion, the
     done row keeps its history.
   - Resolve `accountable_employee_id` (§6) for new and updated rows.
   - Upsert `checklist_spot_check_expectations(date, spot_checks_per_day)`.
   - Detect mismatches (§8) and insert their outbox rows.
   - Mark the run `complete` with counts.
5. After commit: nothing to enqueue. Due-ness is read from the stored instants by the FOH
   screen (the minute tick and 60s poll, §9.2); there is **no per-slot job** (v3's
   `checklist_slot_due` had no defined behaviour and is removed, review F-09/O-01).

A failed run leaves prior instances untouched and is safe to retry: step 4 is a
reconciliation, not an append. Manual re-run: an audited "Regenerate today" action on the
manage Today tab (`manage` permission), same job.

### 5.6 The sweep

`checklist_sweep`, enqueued daily by the cron, idempotent, catch-up safe:

```
for every instance where state='pending' and grace_until < now():
    state = 'missed', locked_at = now()
for every instance where state in ('done','skipped','not_applicable')
    and locked_at is null and business_date < today_business_date():
    locked_at = now()
```

- Acts on `grace_until`, **per instance**, so floating instances survive until their
  tolerance genuinely expires (F-02) and a calendar task with a long grace is never locked
  early (F-08).
- Resolved instances lock at the first sweep after their business day ends. Same-day
  corrections (§5.8) stay possible until then.
- Runs at ~04:00-05:00 London. Anything from yesterday with `grace_until` past is swept;
  if generation never ran, there is nothing pending and the sweep is a no-op, while the
  missing run row drives the unavailable state (§9.3).

### 5.7 Job-type registration

⚠️ A new job type must be added in **three** places or it silently never runs:
`JobType` union (`src/lib/unified-job-queue.ts:26-41`), `SUPPORTED_JOB_TYPES` (`:43-59`,
filters `claim_jobs` at `:642`), and the `executeJob` switch (`:985`, default throws).

**Three types**: `checklist_generate_day`, `checklist_sweep`,
`checklist_email_outbox_process`. (The weekly summary is an outbox row created by the
Monday cron, §10, delivered by the outbox processor.)

⚠️ Durable idempotency does **not** come from `enqueue(..., {unique})`: verified in code,
that is a 15-minute enqueue lock plus a pending/processing search
(`unified-job-queue.ts:224-261`); a completed job does not block a later duplicate. Every
handler is idempotent through database constraints instead: the instance unique key, the
outbox `idempotency_key`, the run `unique(business_date, attempt)`, and the sweep's
state-guarded updates.

### 5.8 State transitions and corrections (F-23, F-24)

| From | To | Who | Rules |
|------|----|----|-------|
| pending | done | `view` (staff) | via the completion RPC: sets completer, true `completed_at`, `was_late`, value, notes |
| pending | skipped | `manage` | reason required; excluded from all denominators |
| pending | not_applicable | `manage` | reason required; excluded from all denominators |
| pending | missed | the sweep only | never manual |
| done | pending (undo) | the completer | within **15 minutes** of `completed_at`, pre-lock; clears completion fields; audited |
| done/skipped/NA | (field correction) | `manage` | pre-lock only: completer, value, notes; audited with before/after; a corrected value does not re-email (§3.2.1) |
| anything, `locked_at` set | nothing | nobody | post-lock the record is immutable; a manager may add an audit annotation, never a mutation |

Separately, **closer reassignment** (§6): changes the business date's closer for the
Problems attribution, pre- or post-lock (it is not instance data), audited. v3's vague
"manager score override" is deleted: scores are derived from instance rows; there is
nothing else to override.

**Audit events** (all via existing `logAuditEvent`): checklist/template create, update,
activate, deactivate; settings and flag changes; seed activation; regenerate; undo;
correction; skip/NA; closer reassignment; spot-check draw and recording (against the
checked employee, §3.5). Audit failure never blocks the action (house behaviour), except
spot-check recording, which requires its own table write to succeed.

---

## 6. Accountability

Decision 8: the closer is responsible for all checks. Decision 19: never parse the shift
name. Decision 24: whoever ticks it scores it.

### One rule for misses (F-07)

> **Every missed instance on a business date is attributed to that date's closer.**

That is the entire blame model, and it is decision 8 verbatim. The Problems tab groups
misses by closer. Floating instances are the exception: their misses are venue-level
(nobody is accountable for a "whenever" task).

`accountable_employee_id` on the instance is **context, not blame**: the person whose
shift covered the slot ("kitchen on duty: Laura"), shown alongside a miss so Billy knows
who was around. Coverage = shift `[startAt, endAt]` **inclusive**, instants built per
§5.3 with `end_time <= start_time` meaning next-day; only shifts whose `shift_date` equals
the business date are considered. If no shift covers the slot, null.

### Resolving the closer

Over the business date's `rota_published_shifts` rows passing the canonical filter:

```
.eq('status','scheduled').eq('is_open_shift', false).not('employee_id','is',null)
```

```sql
ORDER BY (end_time <= start_time) DESC,   -- next-day finishes are latest
         end_time DESC,
         (department = 'bar') DESC,        -- preference, NOT a filter
         start_time ASC,
         employee_id ASC                   -- stable tail (the pure resolveCloser has no shift-row id)
LIMIT 1
```

- A non-bar shift can be the closer (40 real dates have no bar shift at the max finish; on
  2 dates two bar shifts tie, hence the stable tail). The tail key is `employee_id` (not the
  shift row id) so the SQL query and the pure `resolveCloser` pick the identical closer, since
  the pure function receives shift rows without their database id.
- The closer is resolved **for the business date**, not per instant, so "the closing shift
  ends exactly at close" boundary cases (F-06) cannot null it.
- Monday and Wednesday bar are a single all-day shift named just `Monday`/`Wednesday`, so
  names are never parsed. `end_time='00:00:00'` is genuine midnight on Fri/Sat Close and a
  placeholder on 20 sick rows; the status filter removes the sick rows and the first sort
  key handles midnight. `is_overnight` is a hand-set checkbox
  (`ShiftDetailModal.tsx:227`); never used, derived from `end_time <= start_time` instead.

Read the **published snapshot** (`rota_published_shifts`), what staff were actually told
(`src/app/(staff-portal)/portal/shifts/page.tsx:331` reads the same), never the draft.

### Fallbacks

| Situation | Behaviour |
|-----------|-----------|
| Week not published | closer null; misses venue-level. **Never invent a closer.** |
| Nobody rostered at all | closer null, plus a mismatch flag (§8) |
| Floating instances | always venue-level |

Rota publishes ~4 weeks out and generation is on the day, so the null window is small.

**Closer reassignment:** the close screen and manage Today tab let the closer be
reassigned for the date (audited). This is the "manual override" and the only one.

---

## 7. Scoring

Decision 2: score people. Decision 3: no consequences. Decision 24: whoever ticks it
scores it.

### Timeliness, not "completion" (F-18)

The per-person number is named **Timeliness (completed ticks)** everywhere: UI, exports,
emails. It is exactly what decision 24 defines and nothing more:

| Outcome, over instances the person completed | Points |
|---------------------------------------------|--------|
| `completed_at <= grace_until` | **10** |
| `completed_at > grace_until` | **5** |

Average out of 10, always shown with its count (n ticks). Bands: green >= 9.6, amber 7.6
to 9.5, red <= 7.5. Rolling 30 locked business days vs the previous 30. Suppressed below
30 completed instances in the window.

It deliberately contains no misses: a missed task has no ticker, and per §6 misses belong
to the closer on the Problems tab. The review is right that this number alone cannot
answer "who is completing the work", which is why it never appears without the two venue
metrics beside it (§9.4's dictionary): **Venue completion rate** (which does include
misses) and **Missed, by closer**. Labelling this narrow number "performance" or
"completion" is prohibited; that is both an ICO expectation and simple accuracy.

### Grace is the boundary, and it never lies

Grace is the 10-vs-5 boundary. It never rewrites `completed_at`; the recorded time is
always the true time. The same instant is the sweep threshold (§5.6), a separate use of
the same number. `was_late` is set at completion, never recomputed.

### Locking

Instances lock per §5.6 (misses when swept; resolved instances at the first sweep after
their day). Every mutation path gates on `locked_at is null`. Metrics are computed **over
locked days only**, so a day's numbers never change after they first appear. No
retroactive recalculation; Trail refuses it deliberately and they're right.

### Recorded risk and the privacy paragraph (F-35)

Staff aren't told they're scored (decision 4, owner-accepted, not re-litigated). Recorded
privacy position: purpose is supporting staff who need help (owner's words); viewers are
superadmins only (individual numbers) and Peter+Billy via manager@ (named misses, no
individual scores in email); no consequences attach (decision 3); an employee who asks
Peter may see their own records; retention is an open owner decision (§16, §17); the
weekly email carries no individual timeliness figures so mailboxes accumulate no score
history.

---

## 8. The hours mismatch flag

Decision 18. At generation, compare the expected window against the rota (instants per
§5.3):

| Kind | Test |
|------|------|
| `no_cover_at_open` | earliest scheduled start > `opensAt` + 30 min |
| `no_cover_at_close` | latest scheduled end < `closesAt` - 30 min |
| `rota_before_open` | earliest start < `opensAt` - 90 min |

Multiple kinds per date allowed (`unique(business_date, kind)`). Writes the row plus a
`system_alert` outbox entry to **peter@orangejelly.co.uk** (decision 22) in the same
transaction; surfaced on the manage screen.

Live precedent: 2026-05-25, special_hours said "Kitchen and bar open from 12pm!" and
nobody was rostered until 16:00; 2026-04-03, rota in two hours early. Nothing noticed
either. ⚠️ The Sunday `Cleaning` shift runs 10:30 to 11:30 before a 12:00 open **by
design**, hence the 90-minute threshold and its test fixture.

---

## 9. Screens

Accessibility acceptance for all of them (F-36, proportionate): touch targets >= 44px,
visible focus on every interactive element, labels/`aria-label` on icon buttons, state
never conveyed by colour alone (breach rows carry an icon and text), modals trap focus and
close on Escape (Headless UI provides both), numeric inputs get `inputmode="decimal"`, and
a VoiceOver pass on the actual iPad is part of Phase 2 UAT.

### 9.1 FOH button, `/table-bookings/foh`

FohHeader's action row (`FohHeader.tsx:225-297`), next to Food Order / Walk-in / Add
booking. Not `PageLayout headerActions` (that slot demotes into the nav row outside kiosk
mode, `page.tsx:120`, `PageLayout.tsx:174`). ⚠️ FOH buttons are raw `<button>` with
hand-rolled Tailwind, `cn()`-branched on `isManagerKioskStyle`, not `@/ds` Button: match
the local style. Outstanding-count badge. Hidden entirely when `module_enabled = false`.

### 9.2 Mid-shift modal (decision 11, Phase 4, behind `prompts_enabled`)

`Modal` from `@/ds` (`src/ds/primitives/Modal.tsx:38`). In-FOH precedent:
`FohMiniModals.tsx:26-66`. The parts exist in `FohScheduleClient.tsx`: minute-aligned tick
(`:150`) and the idle/focus guard (`:180-193`), which must be copied so a prompt never
steals focus mid-booking.

Prompt contract (F-28):

- On each minute tick: collect `pending` instances past `window_start` for today.
- **One modal lists all of them**, never one modal per task.
- The guard defers, it never consumes: if typing/booking is in progress the prompt stays
  owed and retries next tick.
- **Dismissal is per device**, stored in `sessionStorage` keyed
  `(instance_id, business_date)`; a dismissed instance re-prompts once more when it passes
  `due_at`, then stays quiet on that device. A reload re-arms prompts (sessionStorage is
  the intended scope; cross-device suppression is not needed, ticking the task everywhere
  via the poll is).
- Ticking from the modal follows §9.3's flow. The 60s poll closes the modal if another
  device completes everything.

### 9.3 Open/close screen (decision 11)

Cashing-up section-layout pattern: section layout with `PageHeader` + `SectionNav`, bare
server pages beneath, permission-gated in the layout (`cashing-up/layout.tsx:14-15,17-23`).
Routes: `/checklists` (today), `/checklists/[date]`.

**Generation status is explicit** (F-32). If today has no `complete` generation run:
a prominent "Today's checklist is unavailable, tell Peter" banner (plus "use the paper
list"), never a blank page that looks like a finished day. `skipped_closed` shows "Closed
today". Module disabled hides the section.

Per task: title, instruction, tick, notes box, numeric input for value tasks.

**Attribution, sticky identity** (decision 2 + F-29/O-04): the screen holds a visible
"Completing as: Amanda" selector. Choose once, tick many; per-task override is one tap.
The selector's list:

1. **Clocked in now**, top. `getOpenSessions()` exists
   (`src/app/actions/timeclock.ts:314-339`) and the FOH page already calls it
   (`page.tsx:82`); `FohClockWidget.tsx:34-68` is the picker precedent.
2. **Rostered today** in the task's department.
3. **Search any active employee.**

An empty list never blocks (groups 2 and 3 are required: Billy has never clocked in, 0 of
40 shifts, settled and intentional, decision 23).

**Name visibility rule** (F-22, field-level): the picker may show active employee names
(unavoidable and harmless); after a tick a transient "Done, Amanda" confirmation may show;
the shared screen never shows historical attribution, lists of who-did-what, or any score.
Those live only in `/checklists/manage`.

**The tick is an RPC** (O-02): one transaction that checks `state='pending' and locked_at
is null`, writes completion fields, and (for a breach) inserts the outbox row. Zero rows
updated means someone beat you: refresh and show who. Decision 24 is enforced by the
database, not the UI.

**Value tasks.** House form standard (`mgd/_components/CollectionForm.tsx:94-138`):
`<Field label required>` + `<Input type="number" step="0.1" inputmode="decimal">` +
`<Textarea rows={2}>` from `@/ds`. Zod server-side, returning
`{ error: parsed.error.issues[0]?.message }`. On a breach: the tick saves (never block a
true reading), the row shows a red icon + "out of range", the screen says "Contact Billy
or Peter" (decision 14), the outbox row is already committed (§3.7). Typo guard per
§3.2.1.

**Degraded network** (F-42): every tick shows saving state and disables resubmit until the
server answers; failure keeps the input and shows a retry toast; if the 60s poll fails
twice a "Connection lost, entries may not save, use the paper list and tell Billy" banner
shows. There is no optimistic tick: unconfirmed means not saved, visibly.

**Undo:** the completer can un-tick within 15 minutes (§5.8), one tap on their own fresh
tick.

### 9.4 Superadmin setup and insights, `/checklists/manage`

Nav item in `NAV_GROUPS` (`src/ds/shell/SidebarNav.tsx:28-79`), group 3.
`filterNavGroupsForPermissions` (`:81-94`) hides it automatically.

Tabs:

- **Setup** (`manage`): CRUD checklists/tasks, cadence, thresholds, spot-check flag,
  activation (validation runs here, §3.12), archive (no hard delete after use, §3.1).
- **Today** (`manage`): live state, outstanding, breaches, mismatch flags, generation-run
  status, outbox backlog count, audited Regenerate button, flag switches (superadmin).
- **Insights** (**super_admin only**): the metric dictionary below, by person / checklist
  / day-part.
- **Spot checks** (`manage`): §11.
- **Problems** (**super_admin only**): misses grouped by closer, breaches, mismatches,
  failed spot checks, drawn-but-unrecorded spot checks. Informational, no acknowledge
  workflow in v1. This is the brief's "surface problems and who to address them with".

Names appear only here (see §9.3's field rule).

#### Metric dictionary (F-31)

All metrics are computed over **locked business days** in the selected window (default:
rolling 30 vs previous 30; maximum range 92 days). "Day-part" buckets: open list
(`anchor='open'`), during service (`every`/`at_times`), close list (`anchor='close'`),
floating (`anytime`).

| Metric | Formula | Notes |
|--------|---------|-------|
| Timeliness (completed ticks), per person | avg(10 if on time else 5) over their completed instances | shown with n; suppressed n < 30 |
| Venue completion rate | done / (done + missed) | skipped/NA excluded from both sides |
| Late rate | done late / done | venue and per-person |
| Missed, by closer | count of missed calendar instances grouped by the date's closer | floating misses shown as venue |
| Value breaches | count + list (task, value, band, date, completer) | |
| Spot checks recorded/expected | sum(recorded rows) / sum(expected) | drawn-not-recorded listed |
| Spot-check pass rate | pass / recorded | |

**Aggregation is TypeScript over paginated reads** (F-17, verified: the mileage pattern
fetches without pagination and Supabase caps at 1000 rows; a 60-day comparison here is
~3,500 rows). Every aggregate read loops `.range(offset, offset+999)` until a short page
and asserts completeness; ranges are bounded by the 92-day cap. Per-person model
otherwise: `rota/hours/page.tsx`; aggregation-shape model: `getMileageInsights()`
(`src/app/actions/mileage.ts:1350-1450`).

---

## 10. Emails

Three addresses, three purposes, all **env vars** (`CHECKLIST_MANAGER_EMAIL`,
`CHECKLIST_SYSTEM_EMAIL`), following the `PAYROLL_ACCOUNTANT_EMAIL` pattern.

| Trigger | To | When |
|---------|-----|------|
| Weekly summary | `manager@the-anchor.pub` | Monday 09:00 London |
| Value breach | `manager@the-anchor.pub` | Immediate (via outbox) |
| Hours mismatch | `peter@orangejelly.co.uk` | On detection |
| Generation failed / hours unresolvable / outbox exhausted | `peter@orangejelly.co.uk` | On failure |
| Staff missed items | nobody | Dropped (decision 16) |

Is the pub broken or is the app broken: pub → manager@, app → Peter.
`manager@the-anchor.pub` is read only by Peter and Billy (decision 10).

**Delivery is the outbox** (§3.7, F-16): rows are committed with their triggering event
and processed by `checklist_email_outbox_process` (enqueued each minute the queue already
runs, or piggybacked on the sweep/generation jobs; processor claims `pending` rows whose
`next_attempt_at` has passed). Retries with backoff, 5 attempts, terminal failure alerts
Peter. `emails_enabled = false` creates rows as `held`.

**Weekly summary** (F-30, F-31): cron `0 * * * 1` (hourly on Mondays, UTC), route gates on
London hour == 09 and writes one outbox row with key `weekly_summary:<iso-week>`; the
unique key makes the DST double-fire and any retry harmless. Contents, over the previous 7
locked business days: venue completion rate, missed items with date and closer, value
breaches with readings, spot checks recorded/expected plus fails, unresolved mismatches,
generation failures, corrections made. **No individual timeliness scores in email** (§7's
privacy paragraph).

⚠️ `sendEmail` takes a single options object (`src/lib/email/emailService.ts:111`);
`CLAUDE.md`'s positional signature is stale. Templates are exported HTML-string functions
(`src/lib/rota/email-templates.ts`); the send loop copies `sendRotaWeekEmails()`
(`src/lib/rota/send-rota-emails.ts:36`). ⚠️ Lesson from commit `baa8f428`: name the
person, format in London, reproduce with `TZ=UTC`.

---

## 11. Spot checks

Decision 6: 2/day. Decision 7: a fail doesn't void the tick; Billy records it; it lands on
the employee's audit log; no automated notification.

### Drawing (atomic, F-20)

Drawing happens in **one RPC** holding `pg_advisory_xact_lock(hashtext('spot_draw:' ||
business_date))`:

- If rows exist for the date, return them (sticky, no re-roll, two devices get the same
  pair).
- Else select up to `spot_checks_per_day` from today's instances that are `done` and
  `is_spot_checkable` (snapshot column, no live join), insert with `draw_number` 1..n and
  `checked_employee_id = completed_by_employee_id`.
- **Top-up allowed**: if fewer candidates existed at first draw, a later open of the tab
  draws the remainder (same lock, `draw_number` continues). A day with one done task at
  11:00 can still reach 2 checks by evening.

**Weighting** (F-21, deterministic and testable): candidate weight
`1 / (1 + checks of the same template in the last 14 days)`; selection is weighted random
without replacement; the RNG is injected (seeded in tests). Unpredictable, but not the
same fridge four days running.

Drawing on open of the tab means it only happens on days Billy is in; no rota check
needed. Expected/drawn/recorded reporting per §3.10 (expected stored, others derived):
a day Billy never opened the tab is a 0-of-2, not an absence, and §1's success criterion
reads from exactly this.

### Recording

Pass/fail + note → `state='recorded'`, plus `logAuditEvent` against the checked employee
(§3.5's three warnings apply). No automated notification, Billy handles it in person.

### Honest note

If Billy doesn't walk the floor, the ticks are unverifiable; recorded-vs-expected will
show whether 2/day is real.

---

## 12. Permissions and RLS

New module **`checklists`** (`ModuleName` union, `src/types/rbac.ts:31-63`; snake_case
convention).

| Action | Roles | For |
|--------|-------|-----|
| `view` | foh_staff, staff, manager, super_admin | see and tick |
| `manage` | manager, super_admin | Setup, Today, Spot checks |

**Insights and Problems are super_admin only**: their server actions check
`getCachedIsSuperAdmin` in addition to `checkUserPermission`, because super_admin
short-circuits permission rows entirely (`src/services/permission.ts:180-196`, cached 60s
under `permissions-${userId}`). Seeding: the defensive `DO $$` pattern
(`20260703090000_feedback_rbac_permissions.sql` is the model).

### RLS design (F-15)

All ten tables: **RLS enabled with no policies for `anon` or `authenticated`**
(deny-all), `service_role` only. Every read and write goes through server components and
server actions using the admin client **after** `checkUserPermission` (house pattern; the
ESLint rule already blocks the admin client in client components). Consequences, stated:

- No client-side Supabase reads of checklist tables, ever. The FOH screen is
  server-rendered; its 60s refresh calls a server action.
- **No Supabase realtime on checklist tables** (realtime would require SELECT policies).
  The minute tick + 60s poll are the freshness mechanism; `useFohRealtime` continues to
  serve only the existing booking tables.
- The two concurrency-sensitive writes (tick §9.3, draw §11) are SECURITY DEFINER RPCs
  granted to `service_role` only, called from server actions.
- RLS tests (§13) assert deny-all for anon, authenticated-with-view, and
  authenticated-with-manage identities on raw table access.

FOH staff therefore never receive raw rows containing other people's attribution; they get
exactly the fields the server action returns (§9.3's field rule).

### The FOH chromeless change: 7 call sites, one a 403 gate

`isFohOnlyUser` (`src/lib/foh/user-mode.ts:7`) ends
`permissions.every(p => p.module_name === 'table_bookings')`; a second module fails it
instantly, un-kiosking the iPad.

```ts
const FOH_MODULES = new Set<ModuleName>(['table_bookings', 'checklists'])
return permissions.every(p => FOH_MODULES.has(p.module_name))
```

| Site | Kind |
|------|------|
| `AuthenticatedLayout.tsx:33` | chromeless flag |
| `table-bookings/page.tsx:11` | UI redirect |
| `table-bookings/foh/page.tsx:51` | UI |
| `table-bookings/boh/page.tsx:32` | UI redirect |
| `table-bookings/[id]/page.tsx:24` | UI redirect |
| `table-bookings/reports/page.tsx:79` | UI redirect |
| **`src/lib/foh/api-auth.ts:23`** | **API authz, returns 403** |

Broadening `FOH_MODULES` tightens the 403 gate (a `table_bookings`+`checklists` user still
403s on BOH APIs): correct, and covered by a required regression test. **Two path gates,
not one**: `AuthenticatedLayout.tsx:35`'s `isFohPath` is consumed by the redirect
(`:92-100`) **and** the render gate (`:130`); both become an allowlist
(`/table-bookings/foh`, `/checklists`), or FOH staff land on a permanent "Redirecting"
screen. `user-mode.ts` has no test file; Phase 1 adds
`src/lib/foh/__tests__/user-mode.test.ts` before the predicate is touched. This touches
live chromeless mode: verified on the actual iPad
(`feedback_mobile_audit_misses_interaction`).

---

## 13. Testing

Vitest, mocks for Supabase/email/queue, **everything under `TZ=UTC`**.

**Pure functions** (model: `payrollCycleStats.test.ts`): `resolveTradingWindow` (the §5.1
truth table, closed, invalid, never fabricates), `expandWindow` (cross-midnight, DST both
ways, past-06:00 invalid), `expandCalendarTemplate` (weekday, season wrap, every-slot
clamping, anchors incl. 31st-clamp and 29 Feb), `nextFloatingDue` (the §4 example table
verbatim: early clamp, late push, miss, never-completed, no history), `resolveCloser` (the
full ordering), `resolveCoverage` (inclusive bounds), `scoreInstances` (10/5, suppression
floor), `detectHoursMismatch` (Sunday cleaning shift must not fire), `drawSpotChecks`
(sticky, weighted with seeded RNG, top-up, <2 candidates), `isFohOnlyUser` (new file,
before the change).

**Integration:** generation reconcile (fresh, retry, late special_hours edit updates
pending timestamps in place and never touches done rows), sweep idempotency + floating
survives its tolerance, tick RPC concurrency (one winner), undo window, mutation blocked
post-lock, breach writes outbox in-transaction, outbox retry/backoff/terminal alert,
weekly idempotency key, draw RPC two-device concurrency, **RLS deny-all per role**,
**pagination completeness** (3,500-row fixture), migration `db push --dry-run`.

**Fixtures, each a real prod trap:** Monday single all-day bar shift; latest finish
kitchen/host with no bar at max (40 real dates); two bar shifts tied at max (2 dates);
Sunday Cleaning 10:30 before a 12:00 open; Friday `end_time='00:00:00'`; a sick row with
`end_time='00:00:00'`; an open shift with null employee; 2026-05-25 (special 12:00,
earliest shift 16:00); an unpublished week; Billy's kitchen shift with no session; a
special row with `is_closed = NULL`; a closed day (zero instances); a 16:00-to-00:00
window.

**Phase 2 iPad UAT checklist:** chromeless intact for foh_staff, `/checklists` reachable,
BOH API still 403s, opening list timed end-to-end (<90s recording), sticky identity flow,
value entry incl. typo guard, breach banner, offline banner, undo, VoiceOver pass.

---

## 14. Delivery phases

Complexity 5, split. Each phase independently deployable. Peter approves each phase and
the iPad UAT; the implementing developer owns the rest (a fuller ownership matrix is
ceremony for a two-person operation).

### Phase 1, foundation (score 3), ships dark

Migrations (all 10 tables, constraints, RBAC seeding, settings singleton with **all flags
false**), `trading-window.ts`, cadence/accountability/scoring as pure tested functions,
`user-mode.test.ts` written. **Grants:** `checklists` to staff/manager/super_admin only,
deliberately **not** `foh_staff` (the only role satisfying `isFohOnlyUser`); nothing is
user-visible while `module_enabled=false`.

Deploy: `npx supabase db push --dry-run` → push → verify seeding queries → deploy code.
Rollback: revert code; tables sit unused (forward-fix migrations, house norm).

### Phase 2, capture (score 4)

Generation cron + the three job types (registered in all three places), sweep, outbox
processor, open/close screen with sticky attribution + values + breach email, FOH button,
the `FOH_MODULES`/allowlist change (both gates), **seed migration** of the bar checklist
from [bar-checklist.md](bar-checklist.md) using the §17 values, templates seeded
**inactive**.

Deploy order: code (flags still false) → env vars (`CHECKLIST_*`, cron entry) → verify
cron hits and jobs no-op → seed → **same deploy**: `checklists:view` grant to `foh_staff`
with the `FOH_MODULES` change → iPad UAT (§13) → set `module_enabled` +
`generation_enabled` (+`emails_enabled` when ready) on a chosen quiet business date →
reconcile the first day's run by hand.

Rollback: flags off first (stops generation, prompts, email instantly, no deploy) → then
revert code if needed → revert the `foh_staff` grant **together with** the `FOH_MODULES`
revert → verify the iPad. Queued jobs for unregistered types are skipped by
`claim_jobs`' type filter; generated instances are inert data.

### Phase 3, oversight (score 3)

Setup UI, Insights + metric dictionary, Problems, spot checks (RPC + expectations), the
audit-trail limit fix, weekly summary cron, mismatch detection live.
Rollback: additive; flags gate the email.

### Phase 4, polish (score 2)

Mid-shift modal (behind `prompts_enabled`), todos (after their mini-spec, §15), seasonal
boundary prompt to Billy.

The modal is deliberately last: the only piece that interrupts service, landing after the
data model has proven itself.

---

## 15. Deferred

| Thing | Why | Revisit when |
|-------|-----|--------------|
| Refactoring the FOH route onto `trading-window.ts` | live route, own fallback semantics, no coverage | the FOH hours logic changes anyway |
| Todos UX | table ships, feature needs its own one-page mini-spec (journeys, permissions, portal visibility) | before Phase 4 builds it |
| Photo evidence | deterrent mostly psychological; retention liability | spot checks say ticks are unreliable |
| Offline capture | needs timestamp-on-capture | cellar readings get entered late |
| QR/NFC at location | disproportionate at one site | pencil-whipping proven |
| Equipment register | 3 appliances is not a register | a 4th fridge |
| Two-tier thresholds | decision 14 specifies one behaviour | owner asks (§17) |
| Compliance mode | decision 1 | the paper diary retires |
| Staff-visible scores | decision 4 | staff are told |
| Problems acknowledge/resolve workflow | informational is enough for one pub | volume proves otherwise |

---

## 16. Assumptions

1. Autumn/Winter = 1 Oct to 31 Mar. Configurable; Billy prompted at the boundary (Phase 4).
2. Grace = 30 minutes and is the 10-vs-5 boundary; never rewrites `completed_at`.
3. `close_lead_minutes = 60`: the closing list appears an hour before the doors shut.
4. Business day starts 06:00 London; trading past 06:00 is a config error, not supported.
5. Floating tolerance defaults to half the interval, rounded up; overridable per task.
6. Floating `first_due_on` is staggered by the seed; `created_at` is never a recurrence
   anchor.
7. Mismatch thresholds 30/90 minutes (the 90 spares the Sunday cleaning shift).
8. Todos aren't scored and never generate instances.
9. Closer reassignment needs no approval flow.
10. Volume ~58 instances/day, ~21k rows/year: no partitioning; pagination still mandatory
    for aggregates (§9.4).
11. `departments` is stable enough to FK (zero violations today); code still tolerates
    unexpected strings, `rota_shifts.department` is free text (CHECK dropped by
    `20260301120000_rota_shifts_drop_department_check.sql`).
12. Nothing is completable past `grace_until`; the sweep resolves it. Locked is locked.
13. Retention: **24 months** (owner, 2026-07-17). A purge job is committed scope, due
    before the first records age out (mid-2028); Supabase managed backups are the
    recovery path. Employees are never hard-deleted, so history keeps names.
14. Values are °C only in v1.

---

## 17. The seed table: RESOLVED 2026-07-17

All values approved by the owner (S6, S16, S20 answered directly; the rest taken as
proposed under the standing rule that unanswered recommendations stand). Wording cleanup
also approved: closing item 16 loses its hard-coded times, and the source typos (Cultery,
Condaments, celler, "beer mats removes", "striped") are corrected in the seed. Nothing
blocks the build.

| # | Decision | Proposal |
|---|----------|----------|
| S1 | Fri/Sat close time | **RESOLVED 2026-07-17.** No midnight trading planned; `business_hours` stays 22:00 every day and needs no change. So today the every-2h checks are 18:00 and 20:00 on every day, and **no 22:00 check generates anywhere**. Hours do change sometimes: that is handled by design, because generation reads `special_hours → business_hours` fresh each morning. Extend any day's close past 22:00 and its 22:00 check appears that same day, with no developer involved. Cross-midnight (§5.3) stays fully supported for whenever it's needed. One consequence: closing item 16's text hard-codes "10 pm Sun-Thu / 12 am Fri-Sat"; the seed rewords it to "All machines & music switched off" so the task text cannot go stale against the real hours |
| S2 | Weekend 14:00/16:00 checks (every-2h from a noon open) | Generate them (honest interval). Veto = `not_before 18:00` on the template |
| S3 | Bottle fridges band | 0.0 to 8.0 °C (8 is the legal max for chilled food) |
| S4 | Cellar cooler band | 10.0 to 14.0 °C (beer quality, not law) |
| S5 | Spot-checkable set | All opening, closing and cleaning-check tasks plus the three value tasks; todos never |
| S6 | Two-tier thresholds | Not in v1 |
| S7 | Wipe chairs and tables | floating 3d, tolerance 2 |
| S8 | Wipe pool table and legs | floating 3d, tolerance 2 |
| S9 | Clean glass racks | floating 5d, tolerance 2 |
| S10 | Clean display bottles and shelves | floating 5d, tolerance 2 |
| S11 | Window seals and windows | floating 7d, tolerance 3 |
| S12 | Brush pool table | floating 2d, tolerance 1 |
| S13 | Spray pool table | calendar weekly, Monday |
| S14 | Stock rotation | floating 3d, tolerance 1 |
| S15 | Refill caddies | floating 2d, tolerance 1 |
| S16 | "Freshen Pub Cleanliness" | **RESOLVED: left off** (owner, 2026-07-17) |
| S17 | Glass clean jukebox | floating 5d, tolerance 2 |
| S18 | Restock fridges/snacks/bottles + rotate | floating 3d, tolerance 1 |
| S19 | Hoover/mop (variable list) | floating 3d, tolerance 1 |
| S20 | Retention period for instances/spot checks | **RESOLVED: 2 years** (owner, 2026-07-17). Records older than 24 months are purged. No row can reach that age before mid-2028, so the purge job ships as a later phase, but it is now committed scope, not deferred scope |

### The thing no spec fixes

The bar list is 19 opening and 21 closing items. The evidence says 5 to 9 per pause point,
60 to 90 seconds, killer items only. Decision 5 builds it as supplied, which is right for
v1, but nothing here rescues a 21-item list bulk-ticked at 23:55. The simplification is
what makes the scoring, the spot checks and the emails mean anything.
