# Implementation plan v2: checklists, opening hours, QR pack

Date: 2026-08-15 (Saturday)
Spec: `tasks/spec-hours-checklists-qrpack-2026-08-15.md`
Reviews: `tasks/review-spec-hours-checklists-qrpack-2026-08-15.md` (round 1),
`tasks/developer-review-spec-v2-hours-checklists-qrpack-2026-08-15.md` (round 2)
Supersedes: plan v1, which had wrong weekday labels, an unsafe rollout and a
global enforcement flag that could not work.

## What changed from plan v1

Round 2 raised 28 confirmed issues, 5 unconfirmed assumptions and 5 optional
improvements. Every factual claim that changes the design was checked against the
live database or a runnable test.

| Finding | Verdict | Evidence |
|---|---|---|
| C20 wrong weekdays | **Confirmed** | 22 and 29 August are Saturdays. I had scheduled the main merge and the go/no-go on weekends |
| C08 `getIsoWeekday` mismatch | **Confirmed** | It returns 1=Mon..7=Sun (`dateUtils.ts:141`); `business_hours.day_of_week` is 0=Sun..6=Sat. My fix would have shifted every day |
| C03 `regular` not kitchen-validated | **Confirmed** | `validate_schedule_config` line 108 checks only `food` and `sunday_lunch`. My spec claimed otherwise |
| C01 global flag cannot work | **Confirmed** | Accepted, and it removes the flag problem entirely. See below |
| C02 14:45 contradiction | **Confirmed** | My own acceptance criteria contradicted my own 30-minute rule |
| C04 PR is not a deploy boundary | **Confirmed** | Migrations and Vercel rollout are separate operations |
| C23 use `parent_link_id IS NULL` | **Refuted** | 460 canonical links have a non-null parent. That discriminator would miss all of them. `utm_variant` gives 0 duplicates and is correct. The underlying fragility point is accepted |

Three structural changes follow.

### 1. No enforcement flag. Fix the data instead.

The round 2 lead finding is right: a global flag cannot serve a date-effective
schedule. Off, and September gap bookings slip through. On early, and wanted
August bookings get rejected.

The cause is that **every current day has stale slot data**, not just Saturday:

| Day | Kitchen | Slots | Hole |
|---|---|---|---|
| Tue to Fri | 16:00 to 21:00 | dinner 17:00 to 21:00 | 16:00 to 17:00 |
| Saturday | 12:00 to 19:00 | 12:00 to 14:30, 17:00 to 19:00 | 14:30 to 17:00 |
| Halloween | 12:00 to 18:00 | 12:00 to 14:30, 17:00 to 18:00 | 14:30 to 17:00 |
| Sunday, Monday | matched | matched | none |

Correct all of them to match how the pub actually trades, and enforcement becomes
a no-op that can be switched on immediately, with zero behaviour change. The
September gap then arrives with the September data, date-effective and automatic.

A kill switch remains for emergency rollback, enabled from the start rather than
held off until cutover.

### 2. Service windows ship before versioning

This fixes the dependency clash (C05) and gives a far better fallback (C07). If
versioning slips, the owner edits the hours by hand on 1 September and the gap is
**still enforced**, because enforcement no longer depends on versioning.

Order is now: data corrections, then service windows, then versioning, then the
public API and website.

### 3. Real expand and contract

A PR is not a deployment boundary. The old writer needs `UNIQUE(day_of_week)`; the
new schema removes it. So the constraint is dropped in a **later** migration, after
the new writer is live and verified. Both unique constraints coexist while there is
only one version, which is always true until the contract step.

## Calendar

Today is **Saturday 15 August 2026**. There are 11 working days to 1 September.

**Monday 31 August is the late summer bank holiday.** The pub will be busy and
nothing ships that day. Everything must be done by Friday 28 August.

| Date | Day | Work |
|---|---|---|
| Mon 17 Aug | Mon | Change 1 (checklists) built, shipped, verified |
| Tue 18 Aug | Tue | Phase 1: slot data corrections, shipped |
| Wed 19 to Thu 20 Aug | Wed, Thu | Phase 2: service-window enforcement |
| Fri 21 Aug | Fri | Phase 2 verified live. **Gate 1** |
| Mon 24 to Wed 26 Aug | Mon to Wed | Phase 3: versioning, expand then deploy then contract |
| Thu 27 Aug | Thu | Phase 4: AMS `?date=` API and website, deployed together |
| Fri 28 Aug | Fri | Owner enters and publishes the September version. **Gate 2, final** |
| Mon 31 Aug | Bank holiday | Freeze. No deploys, no data changes |
| Tue 1 Sep | Tue | Verification only. Nothing should need doing |
| From 2 Sep | | Change 3 (QR pack), benchmark first |

Publishing on 28 August rather than 1 September is deliberate (C06). The schedule
is date-effective, so publishing early is safe once the website is ready, and it
turns 1 September into a non-event instead of a live cutover.

## Fallback matrix (C07)

| Shipped by 28 Aug | 1 September outcome | Action needed |
|---|---|---|
| Nothing | Old hours, no gap | Owner edits hours by hand. Gap not enforced |
| Phase 1 | Old hours, no gap | Owner edits hours by hand. Gap not enforced |
| Phases 1 and 2 | **Correct hours and gap enforced** | Owner edits hours by hand on the morning of 1 Sept. Fully correct, just manual |
| Phases 1 to 3 | As above | Do **not** publish a future version: the website would reject September bookings until Phase 4 |
| Phases 1 to 4 | Fully automatic | Nothing. Published 28 Aug |

The meaningful gate is **Phase 2 by Friday 21 August**. After that the September
schedule is achievable by hand, so nothing customer-facing depends on the rest
landing.

## Owner decisions still open

Only two, both flagged in the reply rather than blocking work:

- **D11:** last lunch arrival. Lunch ends 15:00 and the engine already refuses
  arrivals within 30 minutes of service end, so the last bookable lunch is
  **14:30**, and the last dinner 20:30. Proceeding on that.
- **D12:** correcting current Tuesday to Friday slots to 16:00 to 21:00 assumes
  the kitchen genuinely serves from 16:00 today. The owner's "why would you reject
  4-5 bookings" implies yes. Proceeding on that.

---

# Change 1: checklist 5am boundary

One PR. Monday 17 August.

## 1.1 The helper

`src/lib/checklists/business-day.ts`, exporting `businessDateOf(instant, startHour)`
and `currentBusinessDate()`.

Read London wall-clock parts with `Intl.DateTimeFormat` and `hourCycle: 'h23'`
(never `hour12`). Shift the calendar date back one day when the local hour is
below the boundary. **Never** subtract elapsed hours from the instant.

Tests first. These fail with the current production method:

| Instant (London) | Expected |
|---|---|
| 2026-03-29 05:01, spring forward | `2026-03-29` |
| 2026-10-25 04:59, autumn back | `2026-10-24` |
| 2026-10-25 05:01 | `2026-10-25` |

Plus 04:59, 05:00, 05:01 on an ordinary BST day and an ordinary GMT day.

## 1.2 Call sites

Eleven: `checklists.ts:18-20` (delete), `:68`, `:398`;
`checklists-admin.ts:817`; `manage/review/page.tsx:11` (hardcoded 6 hours);
`get-outstanding-counts.ts:63,138` (checklist usage only);
`checklists-insights.ts:76`; `checklists-spotcheck.ts:89,205`;
`jobs/generate.ts:65-68` (delete, has the DST bug); `jobs/sweep.ts:36-37`
(delete, has the DST bug); `window.ts:12` (default 6 becomes 5).

## 1.3 Cron: comment only (C18 corrected)

**Do not change the gate, and do not use `currentBusinessDate()` here.** The route
deliberately generates the **upcoming London calendar day** so it is ready before
that day's boundary. At 04:00 GMT with a 05:00 boundary, `currentBusinessDate()`
still returns yesterday, so using it would regenerate the wrong day.

Comment to write: "Generate the upcoming London calendar day's instances before or
at its business-day boundary. This is deliberately the calendar date, not
`currentBusinessDate()`."

Add tests asserting the queued date under both GMT and BST.

## 1.4 Screen (C19)

- Subtitle shows the business date via `formatDateInLondon`.
- Client refresh at the next London boundary.
- **Mutation-in-flight interface**: `ChecklistScreen` holds a pending-mutation
  counter, incremented and decremented by `TaskRow` through a callback. The
  boundary refresh waits for zero. If a mutation never settles, a 30 second
  timeout refreshes anyway rather than pinning the screen on yesterday.
- Preserve focus across the refresh and announce the day change through a
  `role="status"` live region.

## 1.5 Migration

`CHECK (business_day_start_hour BETWEEN 0 AND 23)` on `checklist_settings`. The
setting is not exposed in the UI.

## 1.6 Cutover (C19 corrected)

**Run after 06:00 London**, not vaguely "in the morning". Between 05:00 and 06:00
the setting change would itself move the resolved business date, so the runbook's
"nothing should change" check would be false.

1. Precheck instance states for the last two business dates.
2. Deploy. Confirm the production alias moved and the commit matches.
3. With the setting still 6, load `/checklists` and confirm no visible change.
4. `UPDATE checklist_settings SET business_day_start_hour = 5, updated_at = now() WHERE id = 1;`
5. Reload. Same date, same tasks.
6. Rollback lever: set it back to 6. Code is correct at either value.

## Acceptance

- The three DST cases pass.
- At 00:30 London, with an injected clock, `getTodayChecklist()` returns the
  previous calendar date's instances.
- A screen open across 05:00 moves on without a manual refresh, and an in-flight
  tick is not lost.
- The next 04:00 cron records `success` for the correct business date, under both
  GMT and BST in test.
- Acceptance is **not** measured by staff completion rates.

---

# Change 2, Phase 1: slot data corrections

Tuesday 18 August. Standalone, no behaviour change, no schema change.

Every current day whose slots do not cover its kitchen window is corrected to
match how the pub trades. This is what makes Phase 2 safe.

| Row | From | To |
|---|---|---|
| Tue to Fri | dinner 17:00 to 21:00 | one service 16:00 to 21:00 |
| Saturday | 12:00 to 14:30 plus 17:00 to 19:00 | one service 12:00 to 19:00 |
| Halloween (special) | 12:00 to 14:30 plus 17:00 to 18:00 | one service 12:00 to 18:00 |

Sunday and Monday need nothing.

### Migration contract (C15)

Idempotent, with a guard that refuses to overwrite a newer owner edit:

- Match on `day_of_week` or `date`, and **assert the expected current
  `schedule_config`** before updating. Abort with a clear message if it differs,
  because that means someone edited it after 15 August.
- Record old and new values in the migration output and in an audit event.
- Ship the rollback SQL in the same file as a comment.
- Re-run the coverage sweep immediately before Phase 2 goes live.

Capacity stays 50. Booking type stays `regular`. Names become plain (`lunch` and
`dinner` collapse to a single service, so use `food service`).

---

# Change 2, Phase 2: service-window enforcement

Wednesday 19 to Thursday 20 August, live and verified Friday 21 August. This is
**Gate 1**, the point after which 1 September is achievable by hand.

## 2.1 One shared rule (C02, O02)

Written once, obeyed by availability, creation, the website and the conflict
report:

> A food booking is valid if its arrival time falls inside a service window for
> that date, and is at least 30 minutes before that window ends. Drinks bookings
> use pub hours and ignore service windows. Sunday lunch uses `sunday_lunch`
> slots.

So for lunch 12:00 to 15:00 the last arrival is **14:30**, and for dinner 16:00 to
21:00 it is **20:30**. This extends the existing rule per service rather than
inventing one; today it already applies once across the kitchen window.

A language-neutral fixture file of (date, purpose, time, expected) drives the
PostgreSQL tests and the website tests, so the two cannot drift.

## 2.2 Availability

`check_table_availability_v06` builds its 15 minute ladder **per service window**
from `schedule_config`, applying the 30 minute rule to each. With no slots of the
required type, behave exactly as today (kitchen window).

## 2.3 Creation

`create_table_booking_core_v06` calls `table_booking_matches_service_window_v05`
for food bookings, with the kitchen window retained as the outer bound, **plus**
the 30 minute end rule, which the helper does not currently apply. Staff overrides
do not bypass it: staff and customers see one rule.

## 2.4 `regular` semantics (C03)

`validate_schedule_config` currently kitchen-validates only `food` and
`sunday_lunch` (line 108). Since `regular` slots are now the food service windows,
extend it to validate `regular` against kitchen hours whenever the kitchen is
open. After Phase 1 all live data complies, so this adds no failures.

Document the meaning explicitly in the migration: `regular` is the normal food
service window; drinks are governed by pub hours and are not slot-gated.

## 2.5 Kill switch

`service_window_enforcement_enabled`, via `get_setting_bool`, **enabled** as part
of this release. It exists to switch enforcement off in an incident, not to defer
it.

## Acceptance

Against corrected current data, before any versioning:

- Tuesday 16:30 food is **accepted**. This is the case the owner explicitly asked
  not to break.
- Tuesday 20:45 food is refused (inside kitchen hours, within 30 minutes of close).
- Saturday 15:00 food is **accepted**, because Saturday is now one continuous
  service.
- A drinks booking at 15:30 is accepted on any open day.
- Sunday lunch and Monday behave exactly as today.
- AMS and the website agree across a full day of 15 minute candidate times on all
  seven weekdays, driven by the shared fixture.
- With the kill switch off, behaviour is byte-identical to today.

Phase 2 requires the website booking-type fix (Phase 4 item 4) to be **agreed and
built**, because the website filters slots on `food` while the data says `regular`.
If the website ships later, AMS is stricter in the interim, which is the safe
direction.

---

# Change 2, Phase 3: versioning

Monday 24 to Wednesday 26 August. Three deployment steps, not one PR (C04).

## 3.1 Evidence pack first

Export `pg_get_functiondef` and `pg_get_function_identity_arguments` for every
function touching the hours tables, plus grants, constraints, triggers, policies
and view dependencies. Attach to the PR with a timestamp (A01). Patch **those**
bodies. This is doubly important now, because Phase 2 has just rewritten two of
them: Phase 3 must build on the Phase 2 output, never on a migration file.

## 3.2 Expand (Monday)

Additive only. Nothing breaks if the code deploy lags.

- Create `business_hours_versions` with `id`, `effective_from`, `status`
  (`draft|published|withdrawn`), `label`, `is_baseline`, `created_at/by`,
  `published_at/by`.
- Insert the baseline: `effective_from = '2000-01-01'`, `status = 'published'`,
  `is_baseline = true`, labelled as a synthetic snapshot (C12).
- Add `business_hours.version_id`, **nullable**, backfill to the baseline.
- Add `UNIQUE (version_id, day_of_week)` while **keeping** `UNIQUE (day_of_week)`.
  Both hold while one version exists, which stays true until 3.4.
- Partial unique index on published `effective_from`; single-baseline index.
- `business_hours_for_date(p_date)`, `SECURITY INVOKER`, `REVOKE ALL FROM PUBLIC`,
  grant `service_role` only (C10).
- `publish_business_hours_version(p_version_id, p_actor uuid)` validating exactly
  one row per weekday 0 to 6 (C11 actor propagation).
- Database-enforced invariants (C09): block header mutation once published, block
  inserting a header directly as published except the migration baseline, block
  child inserts into a published version, protect every baseline attribute, and
  forbid withdrawing a version whose `effective_from` has passed, evaluated as
  `(now() AT TIME ZONE 'Europe/London')::date` inside PostgreSQL, not in
  TypeScript (C12).
- Same-day correction path (C10): a published version effective today may be
  superseded by an atomic withdraw-and-replace inside one transaction, audited.
  Without this a bad cutover cannot be fixed.
- RLS enabled on the new table with explicit grants and policies matching
  `settings.manage` (C11).

## 3.3 Deploy (Tuesday)

Application code that works against **both** shapes.

- Resolver modules: SQL for point lookups, one pure TypeScript batch resolver for
  ranges, shared parity fixtures (O02).
- All 11 read sites. Range readers (`missing-cashups.ts:42`,
  `opening-exceptions-query.ts:32`) use the batch resolver; assert
  `missing-cashups` stays at three queries (C20 round 1).
- `isSiteOpen` at `services/business-hours.ts:789`: check callers first. If live,
  fix `new Date(date).getDay()` with a **0 to 6** helper, not `getIsoWeekday`,
  which is 1 to 7 (C08). If dead, delete it.
- Writer becomes version-aware but still satisfies `UNIQUE(day_of_week)` while one
  version exists, so old and new instances can coexist during rollout.
- Regenerate `database.generated.ts`; hand-update `types/business-hours.ts`, which
  is also missing `kitchen_pace_covers` and `kitchen_walk_in_reserve` (C21).
- Slot regeneration retry: define the job type, payload, idempotency key, backoff
  and terminal alert (A05). Generate from the earliest changed date, not
  `CURRENT_DATE`.
- CI guard: no `from('business_hours')` outside the resolver modules.

**Verify in production before 3.4.** Save the hours screen. Confirm reads and
writes work on the new code with the old constraint still present.

## 3.4 Contract (Wednesday)

Only after 3.3 is verified live: drop `UNIQUE (day_of_week)`, set `version_id`
`NOT NULL`. Multiple versions become possible from this moment.

## 3.5 Version UI

Version strip, draft creation cloning the version in force on
`effective_from - 1 day` (C05 round 1), honest banners, publish confirmation with
a day-by-day diff and the conflict report, withdraw for future versions.

**Slot editor** (C14): typed schema shared by Zod and PostgreSQL. Add and remove
services, 15 minute increments, no overlaps, capacity required and positive,
booking type from a fixed list, at least one service or an explicit "no food
today", inline errors, keyboard operable, and a read-only diff before saving.
`capacity` is documented as metadata not used by the current gates (O05).

**Conflict report** (C13): evaluated over the version's real interval
`[effective_from, next_published_effective_from)`, not open-ended. Uses the same
evaluator as enforcement. Re-run inside the publish transaction; if new conflicts
appeared since acknowledgement, refuse and show them. Store the acknowledgement
with a timestamp and a hash of the report.

## Acceptance

- Golden dataset (C17) on a seeded branch database with a frozen clock, canonical
  JSON ordering and a declared allowlist of volatile fields. Identical before and
  after 3.2 and 3.4.
- An incomplete version cannot be published, enforced by the database.
- Two concurrent publishes yield one published version.
- A draft has no effect on resolution.
- Editing a published version is refused by the database, not just the UI.
- Every forbidden operation in 3.2 is tested at database level.
- Indexes exist and a 50-version fixture resolves within a stated latency budget.
  **Do not** assert an index-scan plan node: seven rows may legitimately seq-scan
  (C28).

---

# Change 2, Phase 4: public API and website

Thursday 27 August, both deployed together.

## 4.1 AMS

- `?date=YYYY-MM-DD` on `/api/business/hours`. It returns the **same seven-day
  `regularHours` shape**, resolved to the version in force on that date. Not a
  single weekday row (C16).
- Absent `?date=`, existing fields are unchanged in shape and value. New fields
  (`upcomingVersions`, populated `planning.seasonalChanges`) are additive.
  "Field-level compatibility", not "byte-identical" (C16).
- Documented examples for: valid date, absent date, malformed date (400), date
  before the baseline, and a date with special hours.
- Per-date `upcomingWeek`.
- Fix the missing `revalidatePath('/api/business-hours')`.

## 4.2 Website (`OJ-The-Anchor.pub`)

Record the deployed commit of both repos before starting (A02).

1. `getBusinessHours()` accepts a date and passes `?date=`.
2. Booking POST and availability route pass the booking date.
3. **Booking-type matching fixed**: a food booking must match `regular` slots. It
   currently filters on `food`, which no slot ever uses, so it silently falls back
   to the kitchen window. Without this the gap does not work.
4. The shared service-window fixture passes in both repos.
5. `WeekHours`, `hero-context` and structured data stay on current hours.

## 4.3 Cutover checklist (C21)

Named owner, dated, with evidence recorded for each: resolver returns a row for
every date in the next 120 days; AMS and website agree on a canary accept and a
canary reject; booking error rate unchanged; slot regeneration completed;
checklist generation succeeded. Reviewed daily from 28 August to 3 September.

---

# Change 3: QR pack

From 2 September. No deadline.

## 3a Benchmark gate first (C22, A03)

Before any route code: confirm the production Vercel plan's duration, memory and
response-size limits, then benchmark 40 events (up to 1,120 links, 2,240 renders)
in a preview environment, measuring link resolution, render time, zip memory and
output size.

**Decision rule:** if the run uses more than half the available duration or
memory, build it as a queued job with a durable build record and a private
temporary archive (O04). Otherwise an in-request POST. This is a formal gate, not
a later judgement call.

## 3b Canonical link guard (C23, corrected)

The reviewer proposed keying on `parent_link_id IS NULL`. **That is wrong here:**
460 canonical promotion links have a non-null parent, so it would miss all of
them. `metadata->>'utm_variant'` is the only correct discriminator and yields zero
duplicates today.

Their fragility point stands, so: fix the metadata spread order in
`getOrCreateShortLinkVariantInternal` so caller metadata cannot overwrite
`utm_variant: true`, backfill and assert the flag, then add the partial unique
index excluding variants, then make get-or-create atomic through an explicit
insert-or-return function (never `.upsert()`, which 42P10s on a partial index).

## 3c Build semantics (C24)

Do not describe the export as atomic; hundreds of mutations plus a long response
are not one transaction. Instead: a durable build record with a build id, every
created or repaired link audited against that id as it happens, and a finalizer
that records success or failure. A timed-out build leaves an open record that is
visible and retryable.

## 3d Remaining decisions (C25, C26)

Enumerate required brief fields; define filter precedence including search text
and explicit status filters; settle whether `events:export` alone may build a pack
given it creates links (recommend requiring `events:manage`); define one stale-link
policy; and implement the one-build-per-user limit as a database row with a unique
active constraint and expiry, not an in-memory lock.

---

# Round 2 disposition

Accepted and actioned: C01 to C22, C24 to C28, A01 to A05, O01 (as the data fix,
which removes the need for version-level policy), O02, O04, O05.

Partly refuted: **C23**, whose recommended discriminator would miss 460 canonical
links; the fragility concern is accepted and actioned instead.

Deferred: **O03** (versioned public API). No consumer other than the website was
found in either repository, so the `?date=` parameter is sufficient. Revisit if an
external consumer appears.

C27 (stale statements) is actioned by this rewrite and by patching the spec's
status, opening table and disposition entries.
