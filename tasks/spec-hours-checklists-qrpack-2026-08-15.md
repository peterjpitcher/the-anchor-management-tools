# Spec v2: checklist day boundary, future-dated opening hours, designer QR pack

Date: 2026-08-15
Version: 2, revised after developer review
Review: `tasks/review-spec-hours-checklists-qrpack-2026-08-15.md`
Discovery: `tasks/discovery-qr-pack-and-checklist-day-boundary.md`
Implementation plan: `tasks/impl-plan-hours-checklists-qrpack-2026-08-15.md` (v2,
which supersedes this document wherever the two disagree)
Status: owner decisions resolved. Design revised after two developer reviews.
Implementation started 2026-08-15 with Change 1.

**The plan is the source of truth for sequencing, dates and acceptance.** This
document holds the reasoning. Three parts of it were overtaken by plan v2 and are
corrected in place below: the enforcement flag is gone (the stale slot data is
fixed instead), service windows now ship before versioning, and the rollout is
expand-and-contract rather than a single PR.

## What changed in v2

The review raised 40 findings. Every load-bearing factual claim was checked
against the live database, both repositories and, where reasoning was involved, a
runnable test. Results:

| Finding | Verdict | Evidence |
|---|---|---|
| C01 writer breaks between PRs | Confirmed | `ON CONFLICT (day_of_week)` needs the unique index the same PR removes |
| C08 stale function bodies | Confirmed, worse | 3 of 6 functions cited the wrong migration. `table_booking_matches_service_window_v05` has two later bodies I missed |
| C09 reader inventory wrong | Confirmed | `kitchen-pacing.ts:352` reads `special_hours` only. `isSiteOpen` at `services/business-hours.ts:789` was missing. Real count is 11 sites in 7 files |
| C14 UI cannot edit slots | Confirmed | `BusinessHoursManager.tsx:89-124` edits Sunday Lunch only; every other day's `schedule_config` is passed through as opaque JSON at `:147` |
| C22 DST bug | Confirmed by test | The subtract-elapsed-hours method returns the wrong date on 3 of 6 boundary cases |
| C28 duplicate links | **Refuted on re-check** | Those ten rows per event are deliberate Meta Ads creative variants flagged `utm_variant`. Excluding variants there are **zero** duplicates. A variant-aware guard is still added |
| C29 stale links | Confirmed | `needsUpdate` is applied at `event-marketing.ts:477` but not in the single-link path at `:574` |
| C30 helper and select list | Confirmed | `sanitizeFilename` at `events/export/route.ts:44` is not exported; the select list omits `image_alt_text`, `accessibility_notes` and `slug` |
| C06 website is stale | Confirmed, worse | Booking horizon is **12 months**, and the site returns a local 400 before AMS is consulted |
| C07 website cache | Confirmed, narrower | The 1 hour TTL affects SEO and display pages only. The booking path uses `revalidate: 0`, so it is live but reads the wrong field |

All 40 findings are accepted. Twenty-two change the design; the rest change
wording, scope or acceptance criteria. The full disposition table is in the plan.

Three material design changes follow:

1. **A version header table.** Seven loose rows sharing a date cannot express
   draft versus published, cannot be completed atomically, and let an edit to the
   active version silently rewrite history. A header with an explicit status
   solves C02, C03, C04 and most of C15 at once.
2. **The website is a blocking dependency, not an owner action.** It fails closed.
   Publishing a September version without the website change would make the site
   reject valid September bookings.
3. **The checklist boundary is fixed at 5 and not exposed in the UI.** Exposing it
   safely requires linking grace, cron and generation invariants that are not
   worth building for a value nobody needs to change.

## Scope

| # | Change | Complexity | Deadline |
|---|---|---|---|
| 1 | Checklists roll over at 5am, not midnight | 3 (M) | none |
| 2 | Future-dated regular weekly opening hours | 5 (XL), 4 PRs across 2 repos | hours correct on 2026-09-01 |
| 3 | Batch QR pack for the designer | 3 (M) | none |

Changes 1 and 2 are **separately deliverable but not independent**: both touch
`src/lib/checklists/trading-window.ts`. Change 1 lands first. Change 3 is fully
independent.

### Non-goals

- No change to how `special_hours` date overrides work.
- No new QR pipeline; Change 3 reuses the existing event marketing short links.
- No new business-day concept; Change 1 honours the setting that exists.
- No estate-wide punctuation cleanup (see Hard rules).
- No general schedule-config editor unless decision D3 says otherwise.

## Hard rules

1. **Do not introduce em dashes in lines changed by these PRs**, including code,
   comments, migrations, copy and commit messages. Existing em dashes in untouched
   lines are out of scope.
2. Project conventions: manual snake_case to camelCase mapping (no `fromDb`
   helper), server actions return `{ success?, error? }`, `checkUserPermission()`
   in every action, `logAuditEvent()` on every mutation, `dateUtils` for display
   dates, `no-console` (warn and error only).
3. **The live database is the only authoritative source for function bodies.**
   Before touching any PL/pgSQL, export `pg_get_functiondef` and
   `pg_get_function_identity_arguments` from production and patch that exact text.
   Migration files contain superseded copies; three of the six I cited in v1 were
   stale.
4. **Reader inventories are generated mechanically, never by hand.** v1's
   hand-written list contained one false entry and one omission.
5. Never run a destructive migration without explicit approval.
6. Verify against the live system before reporting anything as working.

---

# Change 1: checklists roll over at 5am

## Problem

Staff lose the night's closing checks at midnight. The engine still holds them
live until 05:00. Over 27 nights, 4 had every closing task marked missed, 7 had at
least one, and only 5 tasks in total were ever completed after midnight.

## Root cause

`src/app/actions/checklists.ts:18-20` computes a plain London calendar date and
never reads `checklist_settings.business_day_start_hour` (live value 6). Seven
other call sites do the same.

## The algorithm (revised, C22)

The two existing private implementations subtract `startHour` elapsed
milliseconds from the instant and then format in London. **That is wrong on both
clock-change mornings.** Measured, with a 5am boundary:

| Instant (London) | Subtract method | Correct | |
|---|---|---|---|
| 2026-03-29 05:01 (spring forward) | 2026-03-28 | 2026-03-29 | wrong, day never rolls |
| 2026-10-25 04:59 (autumn back) | 2026-10-25 | 2026-10-24 | wrong, day rolls an hour early |
| 2026-08-15 04:59 (ordinary BST) | 2026-08-14 | 2026-08-14 | correct |

The helper must therefore read the **London wall-clock parts** and shift the
calendar date only when the local hour is before the boundary. It must never do
instant arithmetic.

New file `src/lib/checklists/business-day.ts`:

```ts
/**
 * The checklist business date for an instant.
 *
 * Reads the London wall clock and shifts the calendar date back one day when the
 * local time is before the boundary. Never subtract elapsed hours from the
 * instant: on 2026-03-29 that lands on the previous date at 05:01 London, and on
 * 2026-10-25 it rolls an hour early.
 */
export function businessDateOf(instant: Date, startHour: number): string
export async function currentBusinessDate(): Promise<string>
```

`Intl.DateTimeFormat` with `hourCycle: 'h23'` for the parts. Note
`reference_engb_hour12_v8_quirk`: never use `hour12` on this Node version.

The private copies at `src/lib/checklists/jobs/generate.ts:65-68` and the inline
shift at `src/lib/checklists/jobs/sweep.ts:36-37` are deleted and replaced. Both
carry the DST bug today.

## Call sites

Eleven, listed in the plan. `src/lib/checklists/window.ts:12`
`DEFAULT_BUSINESS_DAY_START_HOUR` moves from 6 to 5.

## The setting (revised, C23 and O03)

`business_day_start_hour` stays in the database and is set to 5. It is **not**
exposed in the settings UI in this release, because `CLOSING_GRACE_END_HOUR`,
the generation cron window and the trading-window validity rule all assume a
value near 5, and none of those links would be enforced.

Add `CHECK (business_day_start_hour BETWEEN 0 AND 23)` so a manual edit cannot
set nonsense.

Apply the value **after** the code deploy. Applying first would move generation
and sweep while the screen still rolled at midnight, widening the gap.

## The cron (revised, C25)

**No change.** The 04:00 UTC firing lands at 04:00 London under GMT and 05:00
London under BST, both inside the existing 04:00 to 06:00 gate. v1 proposed
widening the lower bound to 03:00 for a reason that does not hold. Only the
comment at `route.ts:30-31` changes, to state that the date derives from the
setting and that the run is deliberately at or before the boundary.

## The screen (revised, C24)

Two changes:

1. The header shows the business date, formatted with `formatDateInLondon`, so a
   member of staff at 01:00 knows which night they are on.
2. The page schedules a client-side refresh at the next London boundary. Without
   it, an iPad left open on the bar simply moves the stale-screen problem from
   midnight to 5am. Compute the milliseconds to the next boundary, set a timer,
   and call `router.refresh()`. If a task edit is in flight, defer the refresh
   until it settles and show a "moved to today's list" notice.

## Safety

- **Trading windows.** `expandInstants` rejects a close later than the business
  day end. All standard closes are 22:00; the latest special-hours close on record
  is Halloween at 00:00. No window becomes `invalid_hours` at 5.
- **Dead zone removed.** Closing grace already ends at 05:00 while the day flips
  at 06:00. Setting both to 5 closes that hour.
- **Database.** No function, trigger or view computes a checklist day.
  `draw_daily_spot_checks` takes the date as a parameter.
- **Weekday cadence.** `cadence.ts:95` uses `getUTCDay()` on a UTC-midnight
  anchored date string, not a wall clock. Correct, and it follows the boundary
  automatically.

---

# Change 2: future-dated regular weekly opening hours

## Problem

The weekly schedule is seven rows. Editing it takes effect immediately. There is
no way to enter the 1 September schedule without breaking the schedule in force
until 31 August.

## The confirmed September schedule

Supplied by the owner on 2026-08-15 and corrected the same day, effective
2026-09-01. **Only Tuesday to Friday change.**

| Day | Bar | Kitchen outer bound | Service slots | Changing |
|---|---|---|---|---|
| Sunday | 12:00 to 22:00 | 13:00 to 18:00 | sunday_lunch 13:00 to 18:00 | no |
| Monday | 16:00 to 22:00 | kitchen closed | none | **no** |
| Tuesday | 12:00 to 22:00 | 12:00 to 21:00 | **lunch 12:00 to 15:00, dinner 16:00 to 21:00** | yes |
| Wednesday | 12:00 to 22:00 | 12:00 to 21:00 | lunch 12:00 to 15:00, dinner 16:00 to 21:00 | yes |
| Thursday | 12:00 to 22:00 | 12:00 to 21:00 | lunch 12:00 to 15:00, dinner 16:00 to 21:00 | yes |
| Friday | 12:00 to 22:00 | 12:00 to 21:00 | lunch 12:00 to 15:00, dinner 16:00 to 21:00 | yes |
| Saturday | 12:00 to 22:00 | 12:00 to 19:00 | lunch 12:00 to 14:30, dinner 17:00 to 19:00 | no |

Slot capacity stays at 50 on every service (owner, confirmed).

**Monday is not closing.** An earlier reading of "Monday we'll be closed" as
`is_closed = true` was wrong: the kitchen is closed on Mondays and the bar still
trades 16:00 to 22:00, which is exactly the current Monday row. No change, and
none of the closure knock-ons (checklists skipped, cashups, rota, website showing
closed) apply.

So the change is narrower than v2 assumed. Two things happen, both Tuesday to
Friday:

1. **The bar opens four hours earlier**, 12:00 instead of 16:00. Opening checklist
   tasks move with it.
2. **Two food services with a one hour gap, 15:00 to 16:00.** This is the hard
   part, and the current booking engine cannot express it.

## The service gap cannot be enforced today (P0, new)

The Tuesday to Friday pattern is lunch 12:00 to 15:00, **nothing 15:00 to 16:00**,
dinner 16:00 to 21:00. The current model cannot enforce that gap.

**What the code actually does**, verified against live function bodies:

| Path | Gate | Enforces service slots for a food booking? |
|---|---|---|
| `check_table_availability_v06:82-95` | single `kitchen_opens` to `kitchen_closes`, 15 minute steps | no, never reads `schedule_config` |
| `create_table_booking_core_v06:271-277` | single `kitchen_opens` to `kitchen_closes` | no |
| `create_table_booking_v05:192-198` | single `kitchen_opens` to `kitchen_closes` | no |
| `table_booking_matches_service_window_v05` | per-slot, matches `booking_type = 'regular'` | it would, but **nothing calls it** |
| Website `lib/table-booking-service-windows.ts:301-310` | filters slots on `booking_type = 'food'` | **no**, see below |

Two separate reasons the slots are ignored today:

1. `table_booking_matches_service_window_v05` has **no caller**. Not in either
   create function, not in any trigger on `table_bookings`, not in TypeScript
   beyond the generated types. Only a `service_role` grant survives, in
   `20260711000000_revoke_booking_engine_and_reporting_security_definer_grants.sql`.
2. The **website filters `schedule_config` for `booking_type === 'food'`**, but
   every slot in the data is tagged `regular` (the enum is `regular`,
   `sunday_lunch`, `christmas`; there is no `food`). So the filter matches
   nothing, and the resolver falls through to the kitchen window. This is the
   mismatch already recorded in `project_friday_lunch_service_window`.

**Correction to an earlier draft of this spec:** it claimed the website was
stricter than AMS and already refused these bookings. That was wrong. Both
systems currently use the kitchen window for food, and they agree. Live data
proves it: in the last 180 days Saturday bookings were taken at 14:30, 15:00,
16:00 and 16:30, several of them from `brand_site`, all inside the supposed
Saturday slot gap.

So with kitchen 12:00 to 21:00 on a Tuesday in September, **nothing would stop a
15:30 food booking** on either side. The gap would simply not exist in practice.

### The fix

Wire the existing service-window function into the two paths that need it, rather
than inventing a multi-segment kitchen model:

1. `check_table_availability_v06` builds its 15 minute slot ladder **per service
   segment** rather than once across the whole kitchen window, and keeps the
   existing "last slot leaves 30 minutes before service ends" rule per segment.
2. `create_table_booking_core_v06` calls
   `table_booking_matches_service_window_v05` for food bookings, with the kitchen
   window retained as the outer bound.

`schedule_config` already expresses the two services, the validation trigger
already checks slots against kitchen hours, and the website already trusts this
data. This reuses machinery that exists rather than adding a parallel one.

### Superseded: there is no deferred flag

An earlier draft gated enforcement behind a setting held off until 1 September.
The second review showed that cannot work: the schedule is date-effective but a
flag is global, so with it off the September gap is unenforced from the moment the
version is published, and with it on early, wanted August bookings are rejected.
There is no safe state between the two.

The cause was **stale slot data on every day**, not just Saturday. Tuesday to
Friday have a dinner slot starting at 17:00 inside a kitchen opening at 16:00,
which is the same fault. Correcting all of them to match how the pub actually
trades makes enforcement a no-op that can be switched on immediately, and the
September gap then arrives with the September data, date-effective and automatic.

A kill switch remains for incident rollback, enabled from the start. See plan v2,
Change 2 Phase 1 and Phase 2.

### One shared rule

A food booking is valid if its arrival falls inside a service window for that date
and is at least 30 minutes before that window ends. Drinks use pub hours. Sunday
lunch uses `sunday_lunch` slots. So with lunch 12:00 to 15:00 the last arrival is
**14:30**, not 14:45 as an earlier draft's acceptance criteria wrongly stated.
This extends the rule the engine already applies once across the kitchen window.

### `regular` is not kitchen-validated today

An earlier draft claimed the existing trigger already validates these slots
against kitchen hours. It does not: `validate_schedule_config` checks only `food`
and `sunday_lunch` slots (line 108), and every live slot is `regular`. Since
`regular` slots become the food service windows, the trigger is extended to cover
them. After the Phase 1 data corrections all live rows comply. Code can ship days earlier without changing anything.

### Saturday: fix the data, not the code

Saturday's stored slots are lunch 12:00 to 14:30 and dinner 17:00 to 19:00, inside
a kitchen window of 12:00 to 19:00. Taken literally that describes a two and a half
hour hole on a Saturday afternoon.

**It does not describe how Saturday runs.** The owner confirmed on 2026-08-15 that
Saturday food service is **continuous, 12:00 to 19:00**, and the bookings back that
up: 14:30, 15:00, 16:00 and 16:30 all taken in the last six months. The slot rows
are stale, left over from a pattern that no longer applies, and harmless only
because nothing reads them.

The moment enforcement is switched on they stop being harmless. So Saturday's
`schedule_config` is corrected as part of this work to a single continuous service
covering 12:00 to 19:00, matching the kitchen window and matching reality.

This is a data fix, not a code exception. Adding a Saturday carve-out to the
booking engine would leave the wrong data in place to trip over later.

Sunday and Monday need nothing: Sunday's `sunday_lunch` slot already spans its
whole kitchen window, and Monday has no kitchen.

### The website must match on the same booking type

Because the website filters slots on `booking_type === 'food'` and no slot is ever
tagged `food`, it will keep falling back to the kitchen window even after AMS
starts enforcing slots. That flips the current agreement into a fresh
disagreement, with AMS refusing 15:30 on a Tuesday and the website accepting it.

So **PR D must also fix the website's booking-type matching**: a food booking
should match `regular` slots, which is what the data and the enum actually use.
This is a prerequisite for the gap working, not a nicety.

This ships as **PR E** in the plan. It is the only piece that can be dropped if
time runs out, at the cost of staff being able to book into the 15:00 to 16:00 gap
until it lands.

## Why effective dating, not a staged table

Bookings are taken up to **12 months** ahead
(`OJ-The-Anchor.pub/lib/table-booking/horizon.ts:14`). A staged table promoted by
a cron would keep offering August availability for September dates right up to
the cutover. Effective dating makes every question about a future date resolve
correctly the moment the schedule is published.

## Data model (revised, C02, C03, C04, O01)

v1 defined a version as seven loose rows sharing an `effective_from`. That cannot
express draft versus published, cannot be completed atomically, and lets an edit
to the active version silently rewrite every historical resolution. Replaced by an
explicit header.

```sql
CREATE TABLE public.business_hours_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_from date NOT NULL,
  status        text NOT NULL CHECK (status IN ('draft','published','withdrawn')),
  label         text,
  is_baseline   boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES auth.users(id),
  published_at  timestamptz,
  published_by  uuid REFERENCES auth.users(id)
);

-- At most one published version per effective date.
CREATE UNIQUE INDEX business_hours_versions_published_date_key
  ON public.business_hours_versions (effective_from)
  WHERE status = 'published';

-- Exactly one baseline, ever.
CREATE UNIQUE INDEX business_hours_versions_single_baseline
  ON public.business_hours_versions ((true)) WHERE is_baseline;

ALTER TABLE public.business_hours
  ADD COLUMN version_id uuid REFERENCES public.business_hours_versions(id) ON DELETE CASCADE;
-- backfill to the baseline version, then:
ALTER TABLE public.business_hours ALTER COLUMN version_id SET NOT NULL;
ALTER TABLE public.business_hours DROP CONSTRAINT business_hours_day_of_week_key;
ALTER TABLE public.business_hours ADD CONSTRAINT business_hours_version_day_key
  UNIQUE (version_id, day_of_week);
```

Notes:

- No `effective_from` column on `business_hours` itself, and therefore no
  permanent default to hide a writer mistake (C11). The date lives once, on the
  header.
- The composite unique index `(version_id, day_of_week)` plus the header's
  `effective_from` index serve every query. **No extra descending index** (C11);
  confirm with `EXPLAIN` before adding one.
- `business_hours_versions_published_date_key` is a **partial** unique index. Per
  `reference_onconflict_partial_index`, PostgREST upsert always fails with 42P10
  against a partial index. The publish path must use an explicit RPC, never
  `.upsert()`.
- A trigger blocks `UPDATE` and `DELETE` on any row belonging to a published
  version, and blocks deleting the baseline outright.

### The baseline is synthetic (C12)

The migration creates one baseline version with `effective_from = '2000-01-01'`,
`is_baseline = true`, `label = 'Baseline (schedule as at migration)'`, and points
the seven existing rows at it.

This preserves today's behaviour for every historical query. It is **not**
historical truth: the table has been overwritten many times. Dates before the
first post-migration version resolve to a snapshot taken on migration day. This
is stated in the migration comment, in the UI, and in the version label.

## Lifecycle rules (C03, C04, C05, C15)

- A version is created as `draft`. Drafts are invisible to the resolver and have
  no operational effect.
- **Publish is one transactional RPC** that validates exactly one row for each
  weekday 0 to 6, then flips the status. An incomplete version cannot be
  published.
- Published versions are **immutable**. A correction creates a new version.
- A published version whose `effective_from` is still in the future may be
  **withdrawn** (status `withdrawn`), which removes it from resolution. A version
  whose date has passed may not be withdrawn.
- "Past" and "future" are decided by the **London** calendar date, using
  `getTodayIsoDate()` from `dateUtils`, never by UTC or the server clock's zone.
- Cloning a new draft copies the version in force on `effective_from - 1 day`,
  not today's version, so a later change cannot silently revert an earlier one.
- Multiple future versions are allowed. The UI orders them by date.

## The resolver (revised, C10, C20, O02)

One SQL function for point lookups, one pure TypeScript function for ranges.

```sql
CREATE OR REPLACE FUNCTION public.business_hours_for_date(p_date date)
RETURNS SETOF public.business_hours
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT bh.*
  FROM public.business_hours bh
  JOIN public.business_hours_versions v ON v.id = bh.version_id
  WHERE bh.day_of_week = EXTRACT(DOW FROM p_date)::int
    AND v.status = 'published'
    AND v.effective_from <= p_date
  ORDER BY v.effective_from DESC
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.business_hours_for_date(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.business_hours_for_date(date) TO service_role;
```

`SECURITY INVOKER`, not `DEFINER` (C10). The table already has a public select
policy, so no elevation is needed, and
`project_short_link_grants_hardening` records that anon EXECUTE on
`SECURITY DEFINER` functions was the actual hole last time. Grant `anon` and
`authenticated` only if a caller is proven to need them; today every application
path uses the admin client.

Returning `SETOF business_hours` keeps every caller's shape: the existing
`FROM public.business_hours bh WHERE bh.day_of_week = EXTRACT(DOW FROM d)` becomes
`FROM public.business_hours_for_date(d) bh`, leaving the `LEFT JOIN special_hours`
and the field-by-field COALESCE untouched.

### Range reads must batch (C20)

`missing-cashups` deliberately reduced up to 728 queries to three. Resolving
per-date with an RPC per day would undo that. The shared batch resolver fetches
every published version overlapping the range once, then resolves in memory:

```ts
// src/lib/business-hours/resolve.ts
export function resolveForDates(
  versions: LoadedVersion[],   // published, ordered by effectiveFrom ascending
  isoDates: string[],
): Map<string, BusinessHours>
```

Pure, no I/O, shared by every range caller, and covered by the same parity
fixtures as the SQL resolver so the two cannot drift.

## Postgres readers (revised, C08)

Six functions read the hours tables with the same
`WHERE bh.day_of_week = EXTRACT(DOW FROM <date>) ... LIMIT 1` shape. With more
than one version, `LIMIT 1` picks arbitrarily.

**v1 cited the wrong migration for three of them.** The authoritative body is
whatever `pg_get_functiondef` returns from production. For reference, the latest
migration containing each is:

| function | latest migration containing it |
|---|---|
| `create_table_booking_core_v06` | `20260803000200_seasonal_deposit_on_create.sql` |
| `create_table_booking_v05` | `20260728000000_highchair_outside.sql` |
| `check_table_availability_v06` | `20260801001200_availability_v06.sql` |
| `table_booking_matches_service_window_v05` | `20260711000000_revoke_booking_engine_and_reporting_security_definer_grants.sql` |
| `generate_slots_from_business_hours` | `20251123120000_squashed.sql` |
| `debug_booking_hours` | export from live |

Patching an older body would silently remove seasonal deposits, high-chair
handling, pacing or grant hardening. The migration must assert, before and after,
that each function's identity arguments are unchanged.

The kitchen-pacing gate (`20260726000001_kitchen_pacing_gate_v06.sql:154`) reads
`special_hours` and is unaffected, but is re-checked in the same audit.

## TypeScript readers (revised, C09)

The mechanical inventory is **11 read sites across 7 files**, not the nine v1
claimed:

| file:line | note |
|---|---|
| `src/app/actions/missing-cashups.ts:42` | range read, must batch |
| `src/app/api/business/hours/route.ts:17` | public API |
| `src/app/api/business-hours/route.ts:20` | public API |
| `src/app/api/foh/schedule/route.ts:248` | per date |
| `src/lib/checklists/trading-window.ts:63` | per business date |
| `src/lib/rota/opening-exceptions-query.ts:32` | range read, must batch |
| `src/services/business-hours.ts:208` | `getKitchenWindowForDate` |
| `src/services/business-hours.ts:254` | `getBusinessHours`, becomes version-aware |
| `src/services/business-hours.ts:265` | `getBusinessHoursByDay`, gains a date |
| `src/services/business-hours.ts:315` | the writer |
| `src/services/business-hours.ts:789` | `isSiteOpen`, **missed in v1** |

`src/lib/table-bookings/kitchen-pacing.ts:352` was listed in v1 in error: it reads
`special_hours` only.

`isSiteOpen` also does `new Date(date).getDay()`, a local-timezone parse. Fix it
to `getIsoWeekday` from `dateUtils` while it is being touched, or delete it if
decision D5 says it is dead.

A CI guard forbids `from('business_hours')` outside
`src/lib/business-hours/` and the resolver modules, so a new direct reader cannot
be added silently.

## Writer (revised, C01, C13)

The current writer does `.upsert(updatedData, { onConflict: 'day_of_week' })` at
`src/services/business-hours.ts:315`. That upsert **requires** the unique index
the migration removes, so the writer cannot lag the schema by even one deploy.
The writer therefore ships **in the same PR as the migration**, not the next one.

New shape:

- `saveDraftVersion(versionId, days)` writes seven rows against a draft.
- `publishVersion(versionId)` calls the transactional RPC.
- `withdrawVersion(versionId)` for a future published version.
- Editing today's hours creates a new version effective today, subject to D2.

Slot regeneration stops being silently non-fatal (C13). On failure the action
returns a visible warning, enqueues a durable retry through the existing job
queue, and logs at error level. Generation also runs from the **earliest changed
date**, not `CURRENT_DATE`, so a version dated beyond the 90 day horizon is not
skipped. If the effective date is past the horizon, the save is accepted and a
note records that slots will materialise when the horizon reaches it.

## Admin UI (revised, C03, C14, C37, O06)

Path is `src/app/(authenticated)/settings/business-hours/`. All four components
sit directly in that folder; there is no `_components` subfolder and no dead
duplicate.

- A version strip: "Current (since 22 March)", any future versions, and past
  versions collapsed behind a toggle.
- "Schedule a change" creates a **draft** from the version in force the day
  before the chosen date.
- Drafts carry a banner: "Draft. These hours have no effect until you publish."
- Published future versions carry: "These hours already apply to bookings dated
  1 September 2026 or later." Never "not live yet", which is false.
- Publish opens a confirmation showing a day-by-day diff and the affected-booking
  report (below). Publishing is a deliberate second action.
- Accessibility: the version strip uses the design system's semantic tabs with
  roving focus, or a labelled select if that is simpler; the publish dialog
  manages focus and is escapable; status is conveyed by text and icon, not colour
  alone; the long-running publish sets `aria-busy` and announces its result in a
  live region rather than a transient toast only.

### The booking slot gap (C14)

`BusinessHoursManager.tsx` edits pub and kitchen hours plus **Sunday Lunch start
and end only**. Every other day's `schedule_config` is round-tripped as opaque
JSON at `:147`. Live data has `dinner` slots Tuesday to Friday and `lunch` plus
`dinner` on Saturday, none of them editable.

If the September change alters food service windows, they cannot be entered
through this screen. Decision D3 settles whether to build a slot editor or to
declare slots unchanged. Hidden JSON pass-through must not be relied on for new
values.

## Public API and the website (revised, C06, C07)

**The website is a blocking dependency.** `OJ-The-Anchor.pub` resolves any
selected date, up to 12 months out, from the **current week's** `regularHours`
(`lib/table-booking-service-windows.ts:268`), and its booking POST runs a local
service-window check that returns a **400 before AMS is called**
(`app/api/table-bookings/route.ts:535-563`). The declared `upcomingWeek` field is
never read anywhere in that repo.

Publishing a September version without the website change would make the site
reject valid September bookings. This is not an optional owner action.

### The contract

Add an optional `?date=YYYY-MM-DD` to `GET /api/business/hours`. When present,
`regularHours` is resolved for that date. When absent, behaviour is exactly as
today. This is the smallest change that fixes the website's booking path without
restructuring its resolver.

Also on the AMS side:

- `upcomingWeek` (`route.ts:267-286`) resolves per date, so a week spanning
  1 September shows the correct hours on each side.
- Add `upcomingVersions: [{ effectiveFrom, hours }]`, an **ordered array** rather
  than v1's singular field, since several future versions are allowed (C05).
- `planning.seasonalChanges` (`:469-475`) is hardcoded; populate it from the
  published future versions.
- `src/app/api/business-hours/route.ts` filters to the active version and keeps
  its legacy aliases exactly.
- **Bug fix:** `src/app/actions/business-hours.ts` revalidates
  `/api/business/hours` in seven places and never `/api/business-hours`. Add it.

### Website changes required

1. `getBusinessHours()` gains a date parameter and passes it through.
2. The booking POST and the availability route pass the booking date.
3. `WeekHours` and `lib/hero-context.ts` may stay on the current week, since they
   display today.
4. Structured data (`lib/opening-hours-schema.ts`, `lib/schema-utils.ts`, emitted
   on eight pages) stays on current hours. It describes today, which remains
   correct.

### Cache cutover (C07)

The 1 hour TTL from `getBusinessHoursSnapshot()` affects display and SEO pages
only; the booking path uses `revalidate: 0` and is live. There is **no
revalidation endpoint anywhere in the website repo**, so nothing in AMS can purge
it. One hour of stale display copy on the morning of 1 September is the accepted
outcome unless decision D4 says otherwise. The alternative is a small on-demand
revalidate route in the website plus a call from AMS.

## Affected bookings (C16, O06)

v1 listed five bookings as if that were the answer. It was a snapshot, and the
September schedule did not exist yet.

Build a repeatable report instead: given a version, list every booking on or after
its effective date whose time falls outside the new pub window, kitchen window or
service slots, across all operationally committed states (confirmed, pending
payment, holds, staff-created), with any deposit or pre-order obligation flagged.

Run it at draft preview, at publish, and again at cutover. It is shown in the
publish dialog and saved with the release evidence. It warns; it does not block.
Contacting guests is an owner decision, not an automated action.

## Testing (C17, C18)

The v1 "old_id versus new_id" query only proved a single baseline resolves to
itself. It would pass even if a function body had been mangled.

Replaced by a **golden dataset**: before the migration, capture the output of
every affected function and both public APIs across a representative matrix of
dates and requests, including a Sunday, a Monday with the kitchen closed, a
Saturday with two slots, a special-hours date, Halloween's midnight close, and
cases exercising seasonal deposits, high chairs, kitchen pacing and accessible
tables. After the migration, with only the baseline version present, the outputs
must be byte-identical.

Then a second matrix with a published future version: dates before, on and after
the effective date; two future versions; a withdrawn version; an incomplete draft;
special-hours precedence over a future version.

Plus unit tests for the batch resolver, contract tests for the RPC and both APIs,
concurrency tests on publish, permission tests, and a cross-repository test that
the website's booking POST accepts a date the AMS API accepts.

## Rollback (C19)

Restoring function bodies is not enough: old readers and the old writer require
one row per weekday and the original unique constraint, which cannot coexist with
multiple versions. The runbook, rehearsed before go-live, is: take a backup;
disable version creation by flag; withdraw and export future versions; delete
their rows; regenerate slots; restore the constraint; roll back application code
in that order; then review any bookings accepted under the withdrawn schedule.

Forward-fix is preferred once bookings depend on the new schedule.

## Monitoring (C38, scoped)

Proportionate to a single-site pub, not a platform. Structured `console.error`
with a stable prefix, surfaced in Vercel logs, for: publish success and failure,
resolver returning no row for a date, slot regeneration retry exhaustion, and
checklist generation failure. One daily check during the cutover week rather than
a paging rota.

---

# Change 3: designer QR pack

## What already exists

`poster` and `table_talker` are print channels with tracked short links
(`src/lib/short-links/channels.ts:28,30`); QR rendering is at
`src/services/event-marketing.ts:557,635`; a per-event download button at
`EventMarketingLinksCard.tsx:110-118`; `events.brief` is a populated markdown
brief; and `src/app/api/invoices/export/route.ts` is a date-range zip template.

## Method and audit (revised, C27)

The route is a **POST**, not a GET. It creates short links, and GET must be safe
and idempotent-by-default; a prefetch or retry must not mint tracking assets.
Same-origin protection applies, with explicit 401 and 403 responses.

Link creation is audited. One atomic server operation records every created or
repaired link id with before and after values in a single
`logAuditEvent({ operation_type: 'export', resource_type: 'events' })` entry.
Failed builds are logged too.

## Get-or-create must be atomic (revised, C28)

### Correction: there are no duplicate links

Spec v2 and my earlier report claimed five events carried ten duplicate
`meta_ads` links each. **That was wrong.** Those ten rows are deliberate Meta Ads
creative variants, created on 2026-07-07 by
`POST /api/marketing/meta-ads-link`, which accepts a `variants` array. Each has a
distinct name ("Last Chance | Booking urgency | Var 1") and carries
`metadata.utm_variant = true`. One canonical link per event and channel sits
alongside them with the deterministic `ma` prefix.

Excluding variants, **zero** event and channel pairs have more than one link.
There is nothing to clean up, and no root-cause bug to fix. My grouping was too
coarse: it ignored `utm_variant`.

### What is still true

`short_links` is unique on `short_code` and `id` only, so the race the review
describes remains possible: two concurrent exports could each see no link and
create one. It has not happened, but the QR pack raises the odds by generating
many links at once.

The guard must not break the variants feature, which legitimately needs many rows
per event and channel. So the unique index is partial **and** excludes variants:

```sql
CREATE UNIQUE INDEX short_links_event_channel_canonical_key
  ON public.short_links ((metadata->>'event_id'), (metadata->>'channel'))
  WHERE link_type = 'promotion'
    AND metadata ? 'event_id'
    AND metadata ? 'channel'
    AND COALESCE(metadata->>'utm_variant', '') <> 'true';
```

Verify it builds against live data first; the query above returns zero rows today,
so it should. Because it is partial,
`reference_onconflict_partial_index` applies: PostgREST upsert will fail 42P10
against it. Use an explicit insert with conflict handling inside a function, never
`.upsert()`.

## Stale links (revised, C29)

`generateSingleLink` at `event-marketing.ts:574` returns the first existing
event-and-channel link without applying the `needsUpdate` check used by the bulk
path at `:477`. A slug rename would therefore ship artwork pointing at a dead URL
for the poster's whole physical life.

Export resolution is **validate and repair**: check the destination and UTM
metadata against the event's current slug and channel config; repair if stale;
if repair is not allowed because artwork may already exist, fail the build with a
named stale-link report.

## Inclusion and failure (revised, C32)

- Included: events whose `event_status` is `scheduled`, `sold_out`,
  `rescheduled` or `postponed`. Excluded by default: `draft` and `cancelled`.
- The export honours the status and category filters already applied in the
  events UI, not just the date range.
- **Preflight before any mutation.** Every event is checked for a slug and the
  required brief fields first. If any fails, nothing is created and the response
  lists the offending events. This makes retries idempotent.
- No partial packs.

## Scope: all QR channels, clearly labelled (owner decision, 2026-08-15)

The pack carries **every QR channel**, not just poster and table talker. That is
all 23 print channels plus all 5 screen channels, 28 per event
(`src/lib/short-links/channels.ts`). Digital channels are excluded because they
have no QR by design (`event-marketing-links.ts:258-260`).

This reverses assumption A1 and changes the size materially: 16 events becomes
448 links, 448 PNGs and 448 SVGs. The bounds in "Bounds" below stop being
theoretical.

Labelling is the point of the request, so every layer names the placement:

- Files are `NN-channel-key.png` and `.svg`, numbered so they sort in catalogue
  order, for example `01-poster.png`, `07-table-talker.svg`.
- Print and screen QRs sit in separate subfolders, because a designer laying out
  posters should not have to sift through venue-screen assets.
- The per-event `brief.md` carries a table of every file with its human label
  ("Local Partner Poster"), its type, its short link and its destination.
- `manifest.json` carries the same, machine-readable.

Use the label from `EVENT_MARKETING_CHANNELS`, not from `short_links.name`: the
stored names drift, with older rows saying "Poster QR" where newer ones say
"Poster".

## Zip structure (revised, C31)

```
anchor-qr-pack-2026-09-01-to-2026-11-30/
├── README.md
├── manifest.json
└── 2026-09-02 - End of Summer Cash Bingo - 3f2a/
    ├── brief.md
    ├── print/
    │   ├── 01-poster.png
    │   ├── 01-poster.svg
    │   └── ...
    └── screen/
        └── ...
```

Folder names are `YYYY-MM-DD - Event Name - <short event id>`, date first so the
designer's file browser sorts chronologically. Two events can share a date and
name, and two different names can sanitise identically, in which case JSZip
merges folders and later files replace earlier ones silently. The event-id suffix
prevents that, and the route asserts folder count equals event count before
returning.

Tested against: duplicate names, punctuation-only differences, names that
sanitise to empty, very long names, Unicode, and Windows-reserved forms such as
`CON` and trailing dots. Live names already contain colons, for example
"Sleigh My Name: Festive Music Bingo".

A `manifest.json` accompanies the README (O05) listing event ids, channels, short
codes, destinations and generation time, so a pack can be validated
automatically.

## Brief content (revised, C30, C36)

The events export select list does **not** include `image_alt_text`,
`accessibility_notes` or `slug`; the QR route needs its own explicit select list.

`sanitizeFilename` at `events/export/route.ts:44` is module-private. Extract it
and the ISO date validation into a tested shared utility rather than duplicating
them.

**External sharing: approved** (owner, 2026-08-15). `events.brief` and
`accessibility_notes` go into the pack as they are. The full field list is: name,
date, times, category, performer name and type, price, capacity,
`short_description`, `brief`, `image_alt_text`, `accessibility_notes`, the public
event URL, and the QR table.

The archive is still served `Cache-Control: private, no-store`, and the route
still requires authentication, because the pack is a bulk extract even if each
field is externally safe.

## QR rendering (revised, C34, O04)

One shared options object drives both formats, so the PNG and SVG encode the same
matrix and quiet zone. v1's SVG call passed no options and would have differed.

```ts
const QR_OPTIONS = { errorCorrectionLevel: 'H', margin: 4, color: { dark: '#000000', light: '#FFFFFF' } } as const
// PNG: QRCode.toBuffer(url, { ...QR_OPTIONS, type: 'png', width: 2048 })
// SVG: QRCode.toString(url, { ...QR_OPTIONS, type: 'svg' })
```

`toBuffer` directly, with no base64 round trip (O04). Margin 4 is the standard
quiet zone; margin 2 is below spec for print.

The README states: do not recolour to low contrast, do not stretch, do not crop
the quiet zone, minimum printed size 25mm for a table talker and 40mm for a
poster. Acceptance requires scanning a **printed proof** at both sizes on an iOS
and an Android device, not a screen scan.

## Bounds (revised, C33, C35, and now load-bearing)

At 28 channels per event this is no longer a small job. Sixteen events means 448
link resolutions and 896 renders. At a conservative 40ms per 2048px PNG that is
roughly 40 seconds of rendering alone, before link creation.

- Dates validated with `isValidIsoDate` from `dateUtils`, which rejects
  impossible calendar dates that `Date.parse` normalises.
- The window is **366 inclusive days**, stated explicitly.
- Hard caps on event count and uncompressed archive size, returning a clear error
  rather than truncating. Start at 40 events and 100MB and tune from a measured
  run.
- Bounded QR render concurrency, and one in-flight build per user.
- **Confirm the production Vercel plan permits `maxDuration = 300` before relying
  on it.** If it does not, or if a measured 40-event run exceeds it, move to the
  streaming `archiver` pattern at `receipts/export/route.ts:91-116` or a queued
  job that emails a link. Decide this from a measurement, not an estimate.
- Duration, event count, link count and archive size recorded in the audit entry.

## UI (C37)

A "Download QR pack" button beside "Export CSV" in `EventFilterPanel.tsx`, reusing
the existing date range. Because the build can take a minute, the button sets
`aria-busy`, and progress and result are announced in a live region rather than by
a transient toast alone.
