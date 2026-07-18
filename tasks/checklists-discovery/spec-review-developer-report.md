# Developer Review: Checklists & Todos Specification

**Reviewed document:** `tasks/checklists-discovery/spec.md`  
**Review date:** 2026-07-17  
**Review scope:** technical correctness, functional completeness, security, data, integrations, reliability, accessibility, testing, migration, deployment, and delivery  
**Original specification changed:** no

## Executive assessment

**Readiness: not ready for approval or implementation.**

The specification is unusually well researched and contains useful production evidence, but it still has several design contradictions and missing implementation contracts. The most serious problems are:

1. Floating tasks cannot work as described because their lifecycle conflicts with the daily sweep and locking rules.
2. Overnight trading windows and rota coverage are not defined, although Friday and Saturday midnight closing is central to the design.
3. The generation, due, sweep, retry, and email flows are not durably or atomically connected.
4. The accountability rule conflicts with the stated rule that the closer owns every miss.
5. The proposed personal “completion score” excludes all missed tasks, so it measures timeliness among completed ticks rather than completion.
6. RLS policies and safe mutation paths are not specified for personally identifiable scoring data.
7. Several values needed for the seed are still undecided: actual Friday/Saturday hours, weekend interval behaviour, floating intervals, temperature thresholds, and spot-check eligibility.
8. Reporting in TypeScript without explicit pagination or aggregation will return incomplete data at the expected volume.
9. The rollback claim is incorrect; Phase 2 adds live generation, UI, permissions, queue work, and email behaviour, not only the FOH mode change.

The design should return to specification work before database migrations or UI work begin.

## Classification

- **Status**
  - **Confirmed issue:** the specification or current repository provides direct evidence of a defect, contradiction, or missing requirement.
  - **Optional improvement:** not required for correctness, but reduces complexity, delivery risk, or operating cost.
- **Priority**
  - **P0:** blocks approval or can produce wrong, lost, insecure, or misleading records.
  - **P1:** required before production release.
  - **P2:** should be resolved during delivery unless explicitly accepted.
  - **P3:** useful improvement that may be deferred.

---

## Findings

### F-01: Required seed decisions are still unresolved

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Requirements / Delivery dependency
- **Relevant section:** §3.2.1, §4, §11, §14, §17; `bar-checklist.md` §5
- **Description:** The specification says the design is ready and describes the remaining owner inputs as “not spec gaps,” but the Phase 2 seed cannot be created safely without them. The actual Friday/Saturday close time, weekend `every 2h` behaviour, all variable task intervals, value thresholds, and which tasks are spot-checkable are not settled.
- **Rationale:** These inputs directly change generated instances, breach emails, and whether two spot checks can be drawn.
- **Impact:** Developers must guess production behaviour or create a seed that cannot satisfy the stated requirements.
- **Recommended action:** Add a blocking seed-decision table with an owner, due date, and chosen value for every seeded template. Do not start the Phase 2 seed until all entries are approved.
- **Open questions:** What are the exact temperature units and limits? Which tasks are spot-checkable? What interval and tolerance applies to each variable task? Do Friday/Saturday close at 22:00 or 00:00? Should weekend checks start at 14:00 or 18:00?

### F-02: Floating task lifecycle contradicts the sweep and locking rules

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Functional / Scheduling
- **Relevant section:** §4 floating, §5.3, §5.6, §7 locking
- **Description:** Floating tasks are said to remain as one pending instance until completed and not become missed until the tolerance expires. However, §5.3 gives them `grace_until = due_at`, and §5.6 marks every pending instance missed and locks it at the end of that business day.
- **Rationale:** A floating task cannot both remain pending for several days and be swept and locked on its first due day.
- **Impact:** Floating tasks will become missed too early, recreate incorrectly, or become impossible to complete.
- **Recommended action:** Define a separate floating lifecycle. Store an explicit `due_date` and `miss_after`, do not include the instance in the daily sweep before `miss_after`, and specify what happens after a miss. Add a state-transition table and exact date examples.
- **Open questions:** After tolerance expires, should one missed instance remain visible, should a new cycle start, or should the same instance stay actionable? Can a floating task be completed after `miss_after`?

### F-03: Floating recurrence formula is incomplete

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Functional / Data
- **Relevant section:** §4 floating, §16 assumptions 5–6
- **Description:** The “early completion clamp” is described but not defined mathematically. `created_at` is also proposed as the first-run seed while migration-time staggering is required, but no field stores that stagger without falsifying `created_at`.
- **Rationale:** Different implementations will calculate different next dates. Audit timestamps should not be changed to represent recurrence anchors.
- **Impact:** Tasks drift, bunch together, or become due on inconsistent days.
- **Recommended action:** Add `first_due_date` or `cadence_anchor_date`. Define the formula, for example `next_due = max(previous_due, completed_business_date) + interval_days`, and show early, on-time, late, missed, and never-completed examples.
- **Open questions:** Is recurrence based on a date or exact completion time? Does a late completion push the next due date later? What date starts a new cycle after a miss?

### F-04: Calendar recurrence cannot represent all promised frequencies deterministically

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Functional / Data model
- **Relevant section:** §3.2, §4 calendar
- **Description:** Bi-weekly recurrence has no anchor week. Monthly, quarterly, and annual recurrence has no day-of-month, month-of-year, invalid-date rule, or recurrence anchor. `freq_interval` is present but its behaviour is undefined for most frequencies.
- **Rationale:** “Every two weeks” and “annual” do not identify a date without an anchor.
- **Impact:** Required checklist types may run on different dates depending on developer assumptions.
- **Recommended action:** Add an explicit recurrence anchor and relevant `by_month`/`by_month_day` fields, or use a small validated recurrence object. Define rules for the 29th–31st and leap day.
- **Open questions:** Should a task due on the 31st move to the last day of shorter months or skip? What anchors bi-weekly schedules?

### F-05: Cross-midnight trading windows are undefined

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Scheduling / Timezone
- **Relevant section:** §2 business day, §4 intervals, §5.1–§5.3, §17
- **Description:** The model stores `opens` and `closes` as times and compares slots while `slot < closes`, but it does not say that `closes <= opens` means the next calendar day. This is essential for a 16:00–00:00 trading window.
- **Rationale:** Plain time comparison treats midnight as earlier than opening and produces no evening interval slots.
- **Impact:** Friday/Saturday 22:00 checks and closing tasks may not generate or may receive the wrong timestamp and business date.
- **Recommended action:** Define a single function that expands a local date plus open/close times into zoned start/end instants. State that a close time less than or equal to open is next-day. Reuse those instants everywhere.
- **Open questions:** Can trading continue past the 06:00 business-day boundary? Is `opens = closes` a 24-hour day, a closed day, or invalid data?

### F-06: Rota coverage at the closing boundary is undefined

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Functional / Scheduling
- **Relevant section:** §6
- **Description:** Accountability requires a shift “covering” `due_at`, but a closing task is due exactly when the closing shift ends. Normal interval semantics `[start, end)` would say the shift does not cover that instant. The required query range for next-day and previous-day shifts is also not defined.
- **Rationale:** Midnight and end-boundary behaviour changes who is blamed for a miss.
- **Impact:** Closers may be null or inconsistent on the most important tasks.
- **Recommended action:** Define shift instants in London, the date range queried, and inclusive/exclusive boundaries. For close tasks, explicitly choose the latest eligible scheduled shift for the business date rather than relying on generic coverage.
- **Open questions:** If the latest shift ends before advertised close, is that person still the closer or is accountability null? Can an early-morning shift from the next rota date cover the prior business day?

### F-07: Accountability rules contradict each other

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Functional / Business rule
- **Relevant section:** §6 accountability, §7 misses; `decisions.md` decisions 8 and 24
- **Description:** §6 says most tasks belong to the department shift covering their due time and only close tasks ignore department. §7 and decision 24 say all misses are attributed to the accountable closer.
- **Rationale:** These rules assign the same missed mid-service task to different people.
- **Impact:** The Problems view cannot be implemented consistently and may name the wrong employee.
- **Recommended action:** Choose one rule and include examples for opening, temperature, mid-service, closing, floating, no-cover, and multi-department tasks. Suggested wording: “All misses are attributed to [chosen rule]; `accountable_employee_id` is resolved using [exact algorithm].”
- **Open questions:** Does the closer own every missed task, or only closing tasks? If every miss belongs to the closer, why resolve due-time accountability for other tasks?

### F-08: The sweep has no complete trigger or timing contract

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Background processing / Reliability
- **Relevant section:** §5.2, §5.4–§5.7
- **Description:** The daily cron enqueues generation, but the specification does not state who enqueues `checklist_sweep_missed`. It also says both “business-day end plus grace” and that the sweep runs at 06:00.
- **Rationale:** A job type registration is not a schedule. At 06:00, tasks with grace after the business-day boundary may not yet be eligible.
- **Impact:** Instances may remain pending forever or lock before their grace expires.
- **Recommended action:** State that generation schedules exactly one sweep for a resolved instant, define that instant, and make the handler idempotent. Clarify whether the latest `grace_until` or a fixed 06:00/06:30 boundary controls locking.
- **Open questions:** Is one sweep used per day or repeated catch-up sweeps? What happens if generation never ran?

### F-09: `checklist_slot_due` has no behaviour

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Integration / Scope
- **Relevant section:** §5.5, §5.7, §9.2
- **Description:** A due job is created and registered, but no state change, notification, event, or handler result is defined. The modal already discovers due instances through a minute tick, polling, and realtime.
- **Rationale:** A job with no defined effect cannot be implemented or tested.
- **Impact:** Delivery effort is wasted, or developers invent an unreviewed notification mechanism.
- **Recommended action:** Remove this job type unless it has a required server-side effect. If retained, specify its inputs, side effects, retries, idempotency, and failure behaviour.
- **Open questions:** What must happen at due time that polling `window_start`/`due_at` cannot do?

### F-10: Queue “unique” keys do not provide durable idempotency

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Reliability / Integration
- **Relevant section:** §5.5; `src/lib/unified-job-queue.ts`
- **Description:** The specification says `unique` provides idempotency. Current queue code releases its enqueue lock immediately and only searches pending or processing jobs. A completed or failed job does not prevent a later duplicate.
- **Rationale:** A manual regeneration or retry after the original job completes can enqueue the same logical work again.
- **Impact:** Duplicate emails, repeated sweep work, or inconsistent counters are possible.
- **Recommended action:** Make every handler independently idempotent using a durable database key or outcome table. Add unique database constraints for logical job effects. Do not treat queue enqueue deduplication as business idempotency.
- **Open questions:** What is the durable idempotency key and retention period for generation, sweep, weekly summary, and breach emails?

### F-11: Generation is not atomic and has no recovery contract

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Reliability / Data
- **Relevant section:** §5.4–§5.6
- **Description:** Generation inserts instances, writes expectations and mismatches, resolves accountability, and enqueues future work, but the specification does not define transaction boundaries or recovery after a partial failure.
- **Rationale:** Supabase writes and queue inserts can fail independently.
- **Impact:** A day can have instances but no sweep, expectations but incomplete instances, or scheduled work without its source data.
- **Recommended action:** Use a database transaction or an outbox pattern. Record a generation run with `pending/running/complete/failed`, expected counts, and errors. A retry must reconcile every required side effect.
- **Open questions:** Which operations must commit together? How is a partially generated day shown to staff and administrators?

### F-12: Late hours regeneration does not correct existing open and close instances

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Scheduling / Data correction
- **Relevant section:** §5.4
- **Description:** The rerun only deletes pending instances whose slot is outside the new window. An `open` or `close` instance keeps the same slot string after the hours change, so the unique constraint blocks replacement and its old timestamps remain.
- **Rationale:** Slot identity is not enough to detect a changed resolved schedule.
- **Impact:** Staff see tasks at the old opening or closing time after a special-hours correction.
- **Recommended action:** On rerun, compare all untouched pending instances with the newly resolved desired rows. Update or replace changed timestamps and reconcile scheduled jobs. Preserve done or otherwise touched rows with a visible “schedule changed after completion” marker.
- **Open questions:** What counts as untouched? Should dismissed prompts count as touched?

### F-13: State integrity is not enforced by the database

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Data integrity
- **Relevant section:** §3.2–§3.6
- **Description:** The proposed checks validate text enums but not valid field combinations. For example, `done` does not require completer and completion time; a required value does not require `value_recorded`; `missed` can contain completion data; recorded spot checks can have a checked employee different from the instance completer.
- **Rationale:** Background jobs, server actions, retries, and future code can create impossible records even when the UI validates correctly.
- **Impact:** Scores, breach reporting, and audits become unreliable.
- **Recommended action:** Add database checks for state invariants, positive intervals, non-negative grace/lead/tolerance, valid season strings, `min <= max`, required fields, and spot-check identity consistency. Document allowed transitions.
- **Open questions:** Are one-sided value limits allowed? Can a done task have no selected employee? Can spot checks ever intentionally target someone other than the stored completer?

### F-14: Hard-delete rules conflict with immutable history

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Data lifecycle
- **Relevant section:** §3.1–§3.4, §9.4 Setup
- **Description:** Templates cascade-delete with a checklist, while instances reference templates and historical records are meant to remain immutable. Once instances exist, deletion will either fail or destroy required parent data depending on the final foreign-key actions.
- **Rationale:** “CRUD” implies delete, but the intended history model requires deactivation.
- **Impact:** Setup deletion can break in production or erase/report-corrupt history.
- **Recommended action:** Prohibit hard deletion after use. Use archive/deactivate actions, `ON DELETE RESTRICT`, and clear UI wording. Define whether never-used drafts may be hard-deleted.
- **Open questions:** May a checklist with zero instances be deleted? How are archived checklists shown in historical reports?

### F-15: RLS and mutation boundaries are unspecified

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Security / Authorization
- **Relevant section:** §3, §9, §12
- **Description:** “RLS on” is not a policy design. The tables contain employee attribution, scores, notes, threshold breaches, and audit-related data. The specification does not define table-by-table select, insert, update, and delete policies or whether client code may access raw rows.
- **Rationale:** UI hiding does not protect data. A `view` user reading raw instance rows can see employee IDs even when names are hidden in the screen.
- **Impact:** Staff may access personal scoring data or mutate fields outside the intended conditional action.
- **Recommended action:** Add an access matrix for every table and operation. Prefer server-only reads for attributed instances and server-only atomic mutation functions. Test RLS with FOH, staff, manager, superadmin, anonymous, and service-role identities.
- **Open questions:** Should FOH users ever receive `completed_by_employee_id` or `accountable_employee_id`? Which role can read free-text notes and breaches?

### F-16: Email delivery is not durably linked to the triggering event

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Integration / Reliability
- **Relevant section:** §3.7, §9.3, §10
- **Description:** A value tick must save even when an email is needed, but the design does not state how a failed email is retried after the database update commits. The email log has only `sent/failed`, no `pending`, source reference, attempt count, or idempotency key.
- **Rationale:** Direct “save then send” loses alerts on process failure; retries can send duplicates.
- **Impact:** A dangerous reading can be stored without notifying anyone, or notify repeatedly.
- **Recommended action:** Write a delivery/outbox row in the same transaction as the breach. Add source type/id, idempotency key, attempts, next attempt, and final status. Process it with retries and alert on permanent failure.
- **Open questions:** What retry policy and escalation apply? Does correcting a reading send a second email?

### F-17: Reporting will silently truncate expected data volumes

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Reporting / Performance
- **Relevant section:** §9.4, §13, §16 assumption 10; `src/app/actions/mileage.ts`
- **Description:** The specification requires TypeScript aggregation and cites a function that fetches all rows without pagination. At about 58 instances per day, a 30-day view has about 1,740 rows and a current-plus-previous 30-day comparison has about 3,480, above normal API result limits.
- **Rationale:** “Aggregate in TypeScript” is safe only when all pages are deliberately fetched.
- **Impact:** Scores and problem counts can be wrong without any visible error.
- **Recommended action:** Use bounded SQL/RPC aggregation or explicit deterministic pagination with a completeness assertion. Define query date ranges and maximum row counts.
- **Open questions:** Must insights support arbitrary historical ranges? What is the largest permitted export or screen range?

### F-18: The personal “completion score” is not a completion score

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Metric definition / Product
- **Relevant section:** §1 success criteria, §7
- **Description:** The score excludes every missed task and averages only 10 or 5 points from tasks a person completed. It measures timeliness among recorded completions, not completion. A person doing one easy task on time can score higher than someone completing most of the list.
- **Rationale:** The label will cause readers to infer a denominator that is not present.
- **Impact:** Management decisions may be based on a misleading metric even though the formula is technically implemented correctly.
- **Recommended action:** Keep the settled formula if required, but rename it to “timeliness score for completed ticks.” Always show completed count, venue/task completion rate including misses, and missed tasks separately. Add exact metric definitions to the UI and email.
- **Open questions:** Is the owner willing to approve the renamed metric? What metric answers “who is doing what” without assigning misses to a personal score?

### F-19: Hours mismatch table cannot store all detected problems

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Data model / Monitoring
- **Relevant section:** §3.9, §8
- **Description:** `business_date` is unique while the detector can find up to three different kinds on the same date. The table also stores time-only values and one `mismatch_minutes`, which is inadequate for overnight windows and multiple mismatches.
- **Rationale:** A day can have both opening and closing coverage problems.
- **Impact:** One issue overwrites or blocks another; alerts and the Problems tab become incomplete.
- **Recommended action:** Use unique `(business_date, kind)`, store resolved timestamps or structured evidence, and add status/acknowledgement fields if the view needs a workflow.
- **Open questions:** Can multiple mismatches of the same kind occur by department? Is acknowledgement required or is the record informational only?

### F-20: Spot-check drawing is not atomic

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Concurrency / Data integrity
- **Relevant section:** §3.5, §3.10, §11
- **Description:** Two concurrent opens can both observe no draw, select different instances, and insert more than the expected two. `unique(instance_id)` prevents duplicate selection of one instance but does not limit rows per business date.
- **Rationale:** Billy may open the tab on more than one device or double-submit during latency.
- **Impact:** The daily draw is not sticky and expected/drawn counts become inconsistent.
- **Recommended action:** Implement drawing in one database transaction or RPC with a per-date lock and a unique draw ordinal such as `(business_date, draw_number)`.
- **Open questions:** If fewer than two candidates exist initially, may the system draw the remainder later when more tasks are completed?

### F-21: Spot-check selection and counters are underdefined

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Analytics
- **Relevant section:** §3.10, §11
- **Description:** “Weighted against recently checked templates” has no algorithm, history window, or deterministic test seam. `expected`, `drawn`, and `recorded` are denormalised counters with no rule for transactional updates or repair.
- **Rationale:** Different implementations produce different audit coverage and counters can drift from source rows.
- **Impact:** The spot-check metric cannot be trusted or reproduced.
- **Recommended action:** Define the weighting algorithm and inject a random source for tests. Prefer calculating drawn/recorded from spot-check rows, or maintain counters transactionally with reconciliation checks.
- **Open questions:** How many prior days affect weight? Are recently failed templates more or less likely to be selected?

### F-22: Employee-name visibility contradicts the FOH journey

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Privacy / UX
- **Relevant section:** §9.3–§9.4
- **Description:** §9.4 says names appear only on the manage area and never on the shared FOH screen. §9.3 requires the FOH attribution picker to show employee names and says a concurrent completion should show who won.
- **Rationale:** Both statements cannot be satisfied.
- **Impact:** Developers may expose more attribution history than intended or make the picker unusable.
- **Recommended action:** Replace the absolute statement with a field-level display rule. For example: the picker may show active employee names, but completed-by, accountable, scores, and historical attribution are restricted to authorised manage views.
- **Open questions:** May the shared screen show “completed by Amanda” immediately after a tick? May it show the current selected identity between ticks?

### F-23: Skip, not-applicable, undo, and correction journeys are missing

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Error handling
- **Relevant section:** §3.3, §7, §9.3
- **Description:** Instance states include `skipped` and `not_applicable`, but no actor, reason, permission, score treatment, UI, or transition is defined. There is also no path to correct the wrong employee, value, note, or accidental tick before locking.
- **Rationale:** These are normal checklist mistakes and exceptions.
- **Impact:** Staff either cannot correct honest errors or managers alter data through ad hoc database work.
- **Recommended action:** Add a state-transition table covering pending, done, missed, skipped, not applicable, correction, and lock. Define who may act, required reasons, audit events, and reporting treatment.
- **Open questions:** Can staff undo their own tick? Can managers correct after lock through an append-only adjustment? Do skipped and not-applicable tasks enter completion denominators?

### F-24: “Manager override” has no defined subject or storage

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Audit
- **Relevant section:** §6 manual override, §7 rules
- **Description:** The specification mentions a closer reassignment and separately a manager override that never mutates the instance. It does not say what the latter overrides or where the result is stored.
- **Rationale:** An audit log alone is not a queryable source of current business state.
- **Impact:** Reporting cannot consistently apply or display overrides.
- **Recommended action:** Define separate concepts: accountability reassignment and record correction. Use an append-only adjustment table with reason, actor, before/after values, and effective result, or remove the undefined override.
- **Open questions:** Can an override change attribution, score, state, value, or only the displayed closer? Is it allowed after lock?

### F-25: Schedule configuration lacks database validation and singleton enforcement

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Data integrity / Configuration
- **Relevant section:** §3.2, §3.8
- **Description:** Invalid combinations are possible: floating rows with calendar fields, `every` with zero hours, `at_times` without times, negative grace, invalid `MM-DD`, and multiple settings rows. “Single row” is not enforced.
- **Rationale:** A bad setup entry can cause an infinite loop, silent non-generation, or unpredictable defaults.
- **Impact:** Billy can create a checklist the engine cannot safely run.
- **Recommended action:** Add cross-field database checks plus the same Zod validation in the UI. Give settings a fixed primary key or singleton check. Fail configuration before activation, not during daily generation.
- **Open questions:** Are draft invalid templates allowed while inactive? What validation preview does Setup show before activation?

### F-26: Snapshotting is incomplete

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Historical data
- **Relevant section:** §3.3–§3.5, §11
- **Description:** Instances do not snapshot `is_spot_checkable`, checklist name, or employee display names. Spot-check selection therefore needs a live template join, and historical labels can change after checklist or employee edits.
- **Rationale:** The stated snapshot principle is that edits must not rewrite historical records.
- **Impact:** Historical reports and spot-check eligibility can change after the fact.
- **Recommended action:** Snapshot all fields needed to interpret an instance, including spot-check eligibility and checklist label. Decide whether employee names are historical snapshots or always current identity labels.
- **Open questions:** Should legal/name corrections update history? Should a template made spot-checkable mid-day affect existing instances?

### F-27: Trading-window override truth table is incomplete

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Integration / Data semantics
- **Relevant section:** §5.1
- **Description:** Field-by-field coalescing is specified, but the meaning of partial special-hours rows is not fully defined. For example, a special row may supply times while `is_closed` is null or inherit a closed business day.
- **Rationale:** The existing tables allow nullable `is_closed` and nullable times, so several conflicting combinations are possible.
- **Impact:** A special reopening may be treated as closed, or an invalid partial row may generate against mixed hours.
- **Recommended action:** Add a complete truth table for special row absent/present, closed true/false/null, and missing open/close fields. Validate impossible combinations and return a named configuration error.
- **Open questions:** Does providing special open/close times imply `is_closed=false`? May only one of the two times be overridden?

### F-28: Prompt dismissal is not persisted or defined across devices

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** UX / Realtime
- **Relevant section:** §9.2
- **Description:** Human dismissal “consumes” a prompt, but no database or browser storage field is defined. The FOH screen may be open on several clients, may reload, and may have several tasks due at once.
- **Rationale:** Client memory is lost on refresh and is not shared between devices.
- **Impact:** Staff can be repeatedly interrupted or each device can show a different prompt state.
- **Recommended action:** Define whether dismissal is per device or shared. Specify persistence, expiry, modal grouping, priority, and what happens when another modal or form is active.
- **Open questions:** Should one modal list all tasks due in a slot? Does dismissing defer until a later reminder or permanently consume that prompt?

### F-29: The 90-second success criterion conflicts with per-task attribution

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** UX / Acceptance
- **Relevant section:** §1 success criteria, §9.3, `bar-checklist.md`
- **Description:** The opening flow has 19 opening items plus three value readings. Opening an attribution picker for every tick leaves roughly four seconds per item to read, verify, select, enter values, and save.
- **Rationale:** The interaction design is unlikely to meet its own acceptance target even if every network request is fast.
- **Impact:** Staff will batch-tick without checking, abandon the list, or fail the stated launch criterion.
- **Recommended action:** Prototype and time the real iPad flow before implementation. Consider a sticky “completing as” identity with per-task override, grouped saving, and keeping notes optional.
- **Open questions:** Does the 90 seconds include physically doing the tasks or only recording them? Is identity selected once per checklist session acceptable?

### F-30: Weekly cron is not DST-correct as specified

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Scheduling / Deployment
- **Relevant section:** §10
- **Description:** `0 8 * * 1` runs at 08:00 London in winter and 09:00 in summer. A route that requires 09:00 London will skip the winter run; a broad window sends at different local times.
- **Rationale:** A single fixed UTC hour cannot represent 09:00 Europe/London all year.
- **Impact:** The weekly summary is missing in winter or arrives at the wrong time.
- **Recommended action:** Follow the existing hourly-cron pattern used by the private-bookings weekly summary: run hourly on Monday, gate on London weekday/hour, and use a durable weekly idempotency key.
- **Open questions:** Must delivery be exactly 09:00, or is an 08:00–09:00 local window acceptable?

### F-31: Weekly summary, Insights, and Problems metrics are not defined

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Reporting
- **Relevant section:** §1, §7, §9.4, §10–§11
- **Description:** The screens and email are named, but their exact fields, date boundaries, filters, denominators, sorting, and empty states are absent. “Spot-check pass rate” and “recorded / expected” are different metrics. “By day-part” has no categories.
- **Rationale:** Reporting is part of the stated success criteria and adoption strategy.
- **Impact:** Developers can deliver visually complete reports that answer different questions or use misleading denominators.
- **Recommended action:** Add a metric dictionary and wireframe-level data contract. Define business-date ranges, current partial day handling, missed/skipped treatment, pass/recorded, recorded/expected, comparison windows, and suppression rules.
- **Open questions:** What exactly appears in the weekly email? Can Problems be acknowledged/resolved? How does one screen answer “what was missed and who was on?”

### F-32: Missing-generation and recovery user journeys are absent

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Error handling / Operations
- **Relevant section:** §5.1–§5.4, §9
- **Description:** When hours are unresolved or generation fails, staff receive no instances. The UI behaviour is not defined, so a blank checklist can look like a successful day with nothing to do.
- **Rationale:** Silent absence is more dangerous than a visible error.
- **Impact:** Staff may assume all tasks are complete while only Peter receives an email.
- **Recommended action:** Store generation status and show a prominent “checklist unavailable” state on FOH and manage screens. Add an authorised retry action with result details and reconciliation.
- **Open questions:** Should staff fall back to the paper list? Who can retry, for which dates, and how often?

### F-33: Operational monitoring is missing

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Monitoring / Reliability
- **Relevant section:** §3.7, §5, §10, §14
- **Description:** There are no required health signals for missing generation, queue lag, failed sweeps, incomplete days, email backlog, realtime failure, or unexpected instance counts. `system_alert` exists in the email type but has no defined producer.
- **Rationale:** Reporting cannot reveal a system that failed to create the records being reported.
- **Impact:** The module can silently report perfect compliance because nothing was generated.
- **Recommended action:** Define alerts and daily reconciliation: trading day exists, generation complete, expected instance count plausible, sweep complete, no old pending instances, delivery backlog healthy, and jobs not exhausted.
- **Open questions:** Where are alerts shown and who receives them? What thresholds avoid duplicate noise?

### F-34: Audit coverage is incomplete

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Security / Auditability
- **Relevant section:** §3–§12
- **Description:** Audit logging is named for spot checks and closer changes but not for checklist/template/settings changes, activation, threshold edits, skip/not-applicable, corrections, todos, manual regeneration, or permission changes. The existing audit helper also swallows write failures.
- **Rationale:** These actions change scoring, alerts, or historical interpretation.
- **Impact:** Administrators cannot explain why tasks changed or why an alert was or was not produced.
- **Recommended action:** Add an audit-event matrix with actor, target, before/after values, reason, and whether failure blocks the action. Use durable domain audit tables for business-critical changes rather than relying only on the best-effort generic log.
- **Open questions:** Which audit failures must fail closed? How long must audit records be retained?

### F-35: Privacy and employee-monitoring controls are not delivery requirements

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Privacy / Governance
- **Relevant section:** §7 recorded risk, §9.4, §10, §12
- **Description:** The owner accepts not telling staff, but the specification does not define access reviews, purpose limitation, retention, correction/dispute handling, or who approves use of named scores. “No consequences” conflicts in practice with using the Problems view to raise issues with people.
- **Rationale:** Named employee scoring is personal employment data even when it is internal and low consequence.
- **Impact:** Trust, employee relations, and privacy risk remain unmanaged outside the code.
- **Recommended action:** Require an owner-approved privacy record before launch covering purpose, viewers, retention, correction requests, exports, and periodic access review. Record the accepted communication decision separately.
- **Open questions:** Who is the data owner? Can an employee ask to see or correct their records? Does the weekly email retain named data indefinitely in mailboxes?

### F-36: Accessibility requirements are absent

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Accessibility / UX
- **Relevant section:** §9
- **Description:** Using Headless UI provides a focus trap, but there are no acceptance requirements for touch targets, keyboard operation, visible focus, screen-reader labels, live status announcements, contrast, error association, numeric input help, or reduced motion.
- **Rationale:** Raw FOH buttons, badges, modal auto-open, and colour-coded breach rows need explicit accessible behaviour.
- **Impact:** Some staff may be unable to complete or understand tasks, and automated checks may pass while the real iPad flow fails.
- **Recommended action:** Add WCAG-oriented acceptance criteria and test with keyboard, VoiceOver on the iPad, zoom, portrait/landscape, and colour-independent status cues.
- **Open questions:** What iPad model, iPadOS version, browser, orientation, and kiosk settings are supported?

### F-37: Test scope omits several release-critical layers

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Testing / Quality
- **Relevant section:** §13
- **Description:** Unit and selected integration tests are listed, but there are no required RLS tests, migration tests, cron/job retry tests, email idempotency tests, end-to-end user journeys, accessibility checks, pagination completeness tests, load tests, or rollback rehearsal.
- **Rationale:** The highest risks cross database, queue, auth, browser, and email boundaries.
- **Impact:** The test suite can pass while production loses alerts, exposes data, truncates reports, or breaks the kiosk.
- **Recommended action:** Add a release test matrix covering all roles, duplicate/retry paths, network failures, two-device concurrency, DST and midnight, production-like row counts, migrations from the current schema, and actual iPad UAT.
- **Open questions:** Is there a staging environment with Vercel cron, Supabase realtime, and safe email recipients?

### F-38: Migration and go-live procedure is missing

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Migration / Delivery
- **Relevant section:** §14
- **Description:** The phases do not define migration order, generated database types, seed activation time, first business date, partial-day handling, environment variables, or verification after each migration.
- **Rationale:** Migrations, app code, cron configuration, permissions, and seed activation cannot become live atomically in a normal deploy.
- **Impact:** Jobs can run before handlers or seed data exist, and FOH permissions can change before the screen is safe.
- **Recommended action:** Add a step-by-step deployment runbook: expand schema, deploy compatible code, set env vars, verify jobs, seed inactive, grant permissions with the FOH change, activate on a chosen future business date, and reconcile the first day.
- **Open questions:** Is historical data intentionally not backfilled? What happens if deployment occurs after the day’s generation time?

### F-39: Phase rollback description is materially incorrect

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Delivery / Rollback
- **Relevant section:** §14 rollback
- **Description:** The specification says the FOH-only predicate is the only live behaviour in Phase 2. Phase 2 also adds generation cron, four queue job types, instances, FOH UI, attribution, breach emails, seed data, and permissions.
- **Rationale:** Rolling back application code can leave queued jobs, cron calls, generated rows, permissions, and sent emails behind.
- **Impact:** A rollback can repeatedly fail jobs, strand work, keep exposing UI, or leave a partially active module.
- **Recommended action:** Replace the rollback paragraph with a per-phase rollback runbook. Include disabling generation, draining/cancelling jobs, handling existing rows, reverting grants and FOH routing together, and verifying the iPad.
- **Open questions:** Are database migrations reversible or forward-fix only? How are already-sent emails and completed rows treated?

### F-40: No feature flag or operational kill switch is defined

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Delivery / Operations
- **Relevant section:** §14
- **Description:** Phase 1 is dark, but later phases have no module activation flag, generation flag, prompt flag, or email flag.
- **Rationale:** “No pilot” does not remove the need to stop faulty automation without a code deploy.
- **Impact:** A bad seed, hours error, or modal defect can keep affecting staff while a rollback is prepared.
- **Recommended action:** Add explicit server-side flags for generation, FOH entry, prompts, and outbound email, with safe defaults and audited changes.
- **Open questions:** May superadmins control flags in Settings, or are they environment-only?

### F-41: Phase acceptance, estimates, and ownership are missing

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Delivery planning
- **Relevant section:** §14
- **Description:** Scores of 2–4 are not delivery estimates. There are no owners, dependencies, exit criteria, UAT sign-offs, time ranges, or go/no-go checks per phase.
- **Rationale:** “Independently deployable” is not verifiable without acceptance criteria.
- **Impact:** Work may enter the next phase with unresolved defects or missing operational setup.
- **Recommended action:** For each phase, add owner, estimate, dependencies, deliverables, automated checks, manual checks, telemetry, rollback test, and named approver.
- **Open questions:** Who owns product decisions, database work, iPad UAT, security review, and launch support?

### F-42: Network and degraded-mode behaviour is unspecified

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Error handling / UX
- **Relevant section:** §1 out of scope, §9
- **Description:** Offline capture is out of scope, but normal request failure, slow Wi-Fi, realtime disconnect, expired login, and poll failure still need defined behaviour.
- **Rationale:** “No offline capture” must not become an optimistic tick that was never saved.
- **Impact:** Staff may believe a task is complete when the server has no record.
- **Recommended action:** Define pending, success, conflict, and failure feedback; disable repeat submission while saving; keep unsaved input on retry; show connection state; and rely on polling when realtime fails.
- **Open questions:** What is the expected action when the iPad is offline: retry, use paper, or tell a manager?

### F-43: Value capture rules are incomplete

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional / Data validation
- **Relevant section:** §3.2.1, §3.3, §9.3
- **Description:** Precision, scale, one-sided limits, inclusive boundaries, blank values, negative values, unit display, locale decimal input, correction, and the “10x outside” formula are not defined.
- **Rationale:** Temperature and threshold handling drives immediate email alerts.
- **Impact:** Equivalent readings can be accepted, rejected, or alerted differently across UI and server.
- **Recommended action:** Define numeric storage precision, exact threshold comparisons, unit and display format, typo-confirmation formula, and correction/email behaviour. Enforce the same rules in Zod and the database.
- **Open questions:** Is exactly `value_min` or `value_max` valid? What does “10x outside the band” mean when the band crosses zero or has one limit?

### F-44: Todo requirements are too thin to implement

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Functional / Scope
- **Relevant section:** §2, §3.6, §14 Phase 4
- **Description:** The table is described, but there are no journeys for creation, assignment, viewing, reassignment, overdue handling, completion, cancellation, permissions, notifications, filtering, or audit.
- **Rationale:** A table definition is not a usable todo feature.
- **Impact:** Phase 4 scope and acceptance cannot be estimated.
- **Recommended action:** Either add a short todo feature specification or explicitly defer todos to a separate project and remove them from the current delivery claim.
- **Open questions:** Who may create or assign todos? Can assignees see them in the staff portal? Are overdue reminders required?

### F-45: Index and query plans are incomplete

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Performance / Data
- **Relevant section:** §3, §9, §11, §16
- **Description:** Only instance indexes are listed. Expected access paths for spot checks, todos, email delivery, template generation, mismatch filtering, audit filtering, employee search, and realtime subscriptions are not covered.
- **Rationale:** Small initial volume does not prevent slow queries or broad realtime payloads, especially for audit and insights views.
- **Impact:** Screens may become slow and queue/email workers may scan tables unnecessarily.
- **Recommended action:** Define important queries first, then add targeted indexes such as spot-check date/state, todo state/due/assignee, email status/next-attempt, and active template fields. Scope realtime to the current business date.
- **Open questions:** What response-time targets apply to FOH load, tick save, picker search, and Insights?

### F-46: Retention, backup, and restore are not defined

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Data operations
- **Relevant section:** §1 out of scope, §15
- **Description:** Retention automation is deferred, but the specification does not state the intended retention period, backup reliance, restore expectations, or deletion approach for employee-linked records.
- **Rationale:** “No automation” still requires an explicit operational policy.
- **Impact:** Data may accumulate indefinitely, be lost without a tested recovery path, or conflict with later employee-data handling.
- **Recommended action:** State the initial retention policy, backup owner, restore objective, and how employee deletion/anonymisation affects historical records.
- **Open questions:** Is indefinite retention intentionally approved? What recovery point and recovery time are acceptable?

### F-47: Historical employee identity behaviour is unspecified

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Data lifecycle / Privacy
- **Relevant section:** §3.3, §3.5, §3.6
- **Description:** Employee foreign-key delete actions and display-name history are not stated. Employees can leave or change names while records remain.
- **Rationale:** Historical attribution must survive normal employee lifecycle changes without falsely showing a new name where a historical label is required.
- **Impact:** Rows may block employee deletion, become null, or display misleading history.
- **Recommended action:** Define `ON DELETE` behaviour and whether to snapshot display names. Prefer stable employee IDs plus a deliberate anonymisation process.
- **Open questions:** Are employees ever hard-deleted in this system? Should leavers remain searchable in historical reports?

### O-01: Remove per-slot jobs and use existing polling/realtime

- **Status:** Optional improvement
- **Priority:** P2
- **Type:** Simplification / Reliability
- **Relevant section:** §5.5, §9.2
- **Description:** The client already has minute-aligned evaluation, 60-second polling, and realtime updates.
- **Rationale:** A per-slot job adds registration, scheduling, retries, queue traffic, and failure modes without a stated server-side effect.
- **Impact:** Keeping it increases code and operations work.
- **Recommended action:** Remove `checklist_slot_due`; derive due status from stored timestamps on read.
- **Open questions:** Is there an unstated requirement for a server-originated event at due time?

### O-02: Use narrow database functions for atomic writes

- **Status:** Optional improvement
- **Priority:** P2
- **Type:** Simplification / Security
- **Relevant section:** §9.3, §11, §12
- **Description:** Completion, spot-check draw, and correction each require conditional multi-row behaviour.
- **Rationale:** Narrow RPCs can enforce state, locking, attribution, audit/outbox writes, and concurrency in one transaction while reducing broad table update policies.
- **Impact:** This reduces duplicated server logic and RLS risk.
- **Recommended action:** Consider dedicated functions such as `complete_checklist_instance` and `draw_daily_spot_checks`, with permission checks and strict inputs.
- **Open questions:** Does the team prefer database functions or a transactional server-side data layer?

### O-03: Defer unready cadence types rather than ship guesses

- **Status:** Optional improvement
- **Priority:** P2
- **Type:** Scope simplification
- **Relevant section:** §4, §14
- **Description:** Floating tasks and long-period recurrence add much of the scheduling complexity, while exact floating intervals are not yet known and no other checklist has been supplied.
- **Rationale:** Opening, closing, fixed interval, weekly, seasonal, and value tasks can deliver the immediate bar-list value with a smaller engine.
- **Impact:** Deferral shortens the critical path and reduces scheduling risk.
- **Recommended action:** Consider making floating plus monthly/quarterly/annual a later phase after concrete examples and decisions exist.
- **Open questions:** Must all 12 variable tasks be live on day one?

### O-04: Make attribution sticky for a checklist session

- **Status:** Optional improvement
- **Priority:** P2
- **Type:** UX simplification
- **Relevant section:** §1, §9.3
- **Description:** Reopening the picker for every tick is repetitive on a 19–21 item list.
- **Rationale:** A visible “completing as” choice with per-task override keeps attribution while reducing taps.
- **Impact:** This makes the 90-second target more achievable and reduces pencil-whipping pressure.
- **Recommended action:** Test a session-level identity selector on the real iPad, while preserving one stored employee per task.
- **Open questions:** Can two staff alternate tasks on one device without confusion?

### O-05: Store schedule provenance on each generated day

- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Operability / Debugging
- **Relevant section:** §5.1–§5.4
- **Description:** The instance stores resolved timestamps but not a generation-run ID or the exact hours-source record used.
- **Rationale:** Production scheduling defects are much easier to diagnose when the source and resolver result are retained.
- **Impact:** Without provenance, support must reconstruct mutable hours and rota state later.
- **Recommended action:** Link instances to a generation run that stores source, resolved window, settings version, counts, and errors.
- **Open questions:** How much resolver input should be retained without duplicating unnecessary data?

---

## Required changes before approval

1. Resolve all seed inputs listed in F-01.
2. Redesign floating recurrence and its interaction with sweep/locking.
3. Define cross-midnight trading and rota instants with worked examples.
4. Resolve the single accountability rule for missed tasks.
5. Define triggers, transactions, retries, and durable idempotency for generation, sweep, spot checks, and email.
6. Add complete state transitions and database invariants.
7. Provide a table-by-table RLS and mutation design.
8. Rename or redefine the personal score and publish a complete metric dictionary.
9. Replace unbounded TypeScript aggregation with bounded, complete queries.
10. Add missing-generation status, monitoring, and recovery.
11. Replace the rollback section with a realistic deployment and rollback runbook.
12. Expand the release test plan to cover RLS, migrations, retries, E2E, accessibility, volume, and the real iPad.

## Unresolved decisions

- Actual Friday/Saturday closing time.
- Whether weekend interval checks start at 14:00 or later.
- Exact interval and tolerance for every variable-cadence task.
- Temperature unit, minimum, and maximum for each value task.
- Which seeded tasks are spot-checkable.
- Whether all misses belong to the closer or to the shift covering each task.
- Floating behaviour after tolerance expires and after a miss.
- Whether staff may correct or undo a tick before and after lock.
- Whether names may be shown on the shared FOH screen after completion.
- Exact content and denominators for Insights, Problems, and the weekly email.
- Whether todos and advanced recurrence are required for the first production release.

## Major risks

1. **Misleading management data:** the named score is not a completion rate and reports can truncate.
2. **Incorrect attribution:** accountability and overnight coverage are unresolved.
3. **Silent operational failure:** a missing generation run can look like a day with no work.
4. **Lost or duplicated alerts:** breach email is not transactionally durable or idempotent.
5. **Privacy exposure:** raw instance data and RLS boundaries are not specified.
6. **Kiosk disruption:** permissions, routing, prompts, and shared-device behaviour change live FOH use.
7. **Unsafe rollback:** cron, queued jobs, grants, data, and UI can outlive reverted code.
8. **Adoption failure:** the long checklist and repeated attribution interaction conflict with the speed target.

## Delivery dependencies and preconditions

- Owner decisions listed in F-01 and the Unresolved decisions section.
- Accurate `business_hours` and `special_hours`, including confirmed overnight closing times.
- Published rota data and an agreed fallback when it is absent or does not cover trading hours.
- Supabase migrations, generated database types, RLS policies, realtime configuration, and transactional functions.
- Vercel cron configuration, a working `CRON_SECRET`, and the existing minute job processor.
- Email recipient environment variables, a safe staging recipient, retry handling, and delivery monitoring.
- A staging environment with production-like roles and enough generated rows to test reporting limits.
- Access to the actual FOH iPad, supported iPadOS/browser details, and a named UAT approver.
- A go-live owner, support cover for the first trading days, and authority to use the operational kill switches.

## Recommended next steps

1. Hold a short owner decision session for the unresolved seed and accountability questions.
2. Produce a v4 design addendum covering recurrence, state transitions, metric definitions, RLS, background-job flow, and rollback. Keep the original specification unchanged if preferred.
3. Prototype only the FOH checklist and attribution flow on the real iPad, then measure the 90-second target.
4. Build a small scheduling test harness for London time, midnight, DST, floating recurrence, and late hours changes before writing migrations.
5. Review the revised design against this report and close every P0 finding before approval.
