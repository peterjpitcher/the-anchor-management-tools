# Table prioritisation: implementation spec v2

Date: 2026-07-27. Status: **all decisions settled, ready to plan. No code written.**
Last amended 2026-07-27 with owner answers closing the four open questions (see section 18).
Supersedes: `tasks/table-prioritisation-spec-2026-07-27.md` (v1).
Inputs: `tasks/table-prioritisation-discovery-2026-07-27.md`, `tasks/table-prioritisation-spec-review-2026-07-27.md`.

**Pinned baseline.** AMS `e8d725a416e14c0f1d8fb1d0fe68d9b0f01ba7b2`. Website
`197ef06de71377fb99e564edad322f9b45407007`. Supabase `tfcasgxopxegwrabvwat`, migration history through
`20260731000600` (verified applied, so the high-chair, outside and drinks-pacing migrations are all live).
Live `create_table_booking_v05` is 13 arguments, `SECURITY DEFINER`, owner `postgres`,
`search_path=public`, `EXECUTE` to `postgres, anon, authenticated, service_role`.

---

## 0. What changed since v1, and why

| Change | Cause |
|--------|-------|
| **Best fit is back as the primary sort.** Priority is now the tie-break inside a capacity band, not the top-level key | Your answer 1: "maximise covers wherever possible" |
| **Kitchen pacing stays arrival-based.** The full-span counting proposed in v1 is withdrawn | Review F-04, and it was my error. See 2.1 |
| **One release, not three phases** | Your answer 7: "do it all together" |
| **A shared allocation primitive is defined**, which both booking and availability call | Review F-02 |
| **Outside and drinks get durable reservation records**, not settings arithmetic | Review F-05, F-06 |
| **Drinks bookings: recommendation reversed.** I now recommend they keep a table | Review F-06 plus your answer 5. See 5.3 |
| Full `v06` contract, security, locking, transition, test and rollback sections added | Review F-01, F-03, F-07 and the P1 set |

Amended after your answers on 2026-07-27:

| Amendment | Cause |
|-----------|-------|
| Held tables are Low 4a and High 4, not Low 4a and Low 4b | Your answer 2 |
| Drinks keep a table but yield it when a food booking needs it, via a new bump rule | Your answer 3 |
| Channel-aware party-size ceiling plus an `allow_unjoined_tables` staff override | Your answer 4 |
| `step_free` flag adopted, Small Bay is the only exception | Your answer 5 |

---

## 1. Decision register

**Verbatim owner answers, by round.** Recorded because a reviewer working from round one alone concluded
that three decisions had been reversed. They had not; the later rounds were simply not in the document.

- **Round 1:** "1. Yes / 2. Agreed / 3. Agreed / 4. lets hold low 4a and 4b. The high 4 can be difficult
  for people with mobility issues. / 5. Lets change that to 40 per 30 minutes / 6. Agreed / 7. Do it all
  together."
- **Round 2:** "We should be maximising covers wherever possible." (reverses the v1 sort order)
- **Round 3:** "Agreed on pacing changes / Switch the low 4a and high 4 out instead. / they should keep
  their tables unless someone else is booked. / Any groups over 20 are a private booking but in a live
  situation, we'd never turn that away. The rules for staff in the moment for a walk in should let them
  accept the booking. Do we need to be able to join tables together for bigger bookings? / All tables are
  step free except the small bay, add that flag."
- **Round 4:** "The high 4 can't use a high chair either, all other tables can. All outside tables are
  unheated."
- **Round 5:** "Leave the walk in tables as 4a and high 4, bookings take priority."


| # | Decision | Status |
|---|----------|--------|
| D1 | Fill order High 4, Low 4a, Low 4b, Small Bay, Big Bay, then Dining Room | Approved 2026-07-27 |
| D2 | Maximise covers wherever possible (best fit first, house order as tie-break) | Approved 2026-07-27 |
| D3 | Minimum party size 4 on Big Bay, DR 6a, 6b, 6c | Approved 2026-07-27 |
| D4 | Turn times 90 / 105 / 120 / 150, plus 15 on Sundays, plus a 15 minute turnaround gap | Approved 2026-07-27 |
| D5 | Minimums and holds release 24 hours before the sitting | Approved 2026-07-27 |
| D6 | Kitchen pacing 15 covers per 30 minutes, every day, measured on **arrivals** | Approved 2026-07-27 |
| D7 | Hold **Low 4a and High 4** for walk-ins, released 24 hours before. Holds apply to single-table selection only, never to joins | Approved 2026-07-27 |
| D8 | 5 outside tables, capped, never individually assigned. Capacity 8 now, 6 later | Approved 2026-07-27 |
| D9 | Drinks arrivals ceiling 40 covers per 30 minutes | Approved 2026-07-27 |
| D10 | Drinks bookings **keep a table, but yield it to a food booking** when the room needs it and they have somewhere else to go | Approved 2026-07-27 |
| D11 | Staff can pin a booking, pinned bookings are never auto-moved | Approved 2026-07-27 |
| D12 | The website tells the customer why a slot is unavailable | Approved 2026-07-27 |
| D13 | Ship as one release, no separate private-booking hotfix | Approved 2026-07-27 |
| D14 | All settings editable at `/settings/table-bookings` | Approved 2026-07-27 |
| D15 | `step_free` flag on tables. Every table is step free except **Small Bay** | Approved 2026-07-27 |
| D16 | Parties over 20 are a private booking online, but staff can always accept one in the moment | Approved 2026-07-27 |

All decisions are settled. Section 18 records the reasoning behind the four that were open at v2 draft,
plus two small assumptions I have made rather than come back to you for.

---

## 2. Two corrections to earlier documents

### 2.1 Kitchen pacing measures arrivals, not occupancy

Discovery 4.3 and spec v1 called it a bug that a two-hour booking at 18:00 contributes no covers to the
19:00 pacing window. **That was wrong and I am withdrawing it.** Kitchen load is driven by when parties
arrive and order, not by how long they sit. A party of six at 18:00 sends one wave of orders to the pass,
not four. Counting them again at 18:30, 19:00 and 19:30 would make your 15 covers behave like roughly
4 covers, and you would lose real trade while believing a bug had been fixed.

So kitchen pacing stays as it is: a rolling window centred on arrival time.

The genuine problem underneath was never a pacing problem. It was that **table availability** ignored
duration, because availability never looked at tables at all. That is fixed properly by the table-aware
availability in section 4, which uses each booking's real occupancy window including the turnaround gap.

Two separate gates, two separate meanings: **pacing limits arrivals, tables limit occupancy.** The
settings screen will label them that way.

### 2.2 Best fit comes first

Spec v1 put priority ahead of capacity, which would have given a party of four the 5-seat Small Bay ahead
of the 4-seat Dining Room 4a. Your answer 1 rejects that. The sort is now:

```sql
ORDER BY t.capacity ASC, t.priority ASC, t.table_number_sort ASC
```

Capacity first means no wasted seat if a perfect fit exists. Priority second means that within a band of
equally sized tables, your house order decides. For four-seaters that gives High 4, Low 4a, Low 4b,
Dining Room 4a, Dining Room 4b, which is exactly your answer to question 1 and still keeps the Dining
Room 4-tops last.

You lose nothing by this change. The 7-and-8 fragmentation fix does not depend on it, because that is
decided by the join ranking in 3.3, where both candidate pairs have identical capacity and priority
breaks the tie.

---

## 3. The allocation rule

### 3.1 One shared primitive (review F-02)

Everything routes through one side-effect-free SQL function:

```
find_table_allocation_candidates(
  p_start_at        timestamptz,
  p_end_at          timestamptz,      -- includes the turnaround gap
  p_party_size      int,
  p_purpose         text,             -- food | drinks
  p_outside         boolean,
  p_channel         text,             -- online | staff | walkin | agent
  p_exclude_booking uuid,             -- so an edit does not conflict with itself
  p_overrides       jsonb             -- named, audited bypasses
) RETURNS TABLE (
  table_ids     uuid[],
  total_capacity int,
  table_count    int,
  rank           int,
  reason_code    text                 -- null when valid, otherwise why rejected
)
```

It returns **all** candidates, valid ones ranked and invalid ones carrying a reason. It never writes.

Callers:

| Caller | Uses it for |
|--------|-------------|
| `create_table_booking_v06` | pick rank 1, then lock, re-check and insert |
| `check_table_availability_v06` | is any candidate valid, and if not, why |
| `move_table_booking_assignments_v06` | validity only, staff choose the target |
| `move_table_booking_time_v06` | validity of the current tables at the new time, then re-rank if invalid |
| Party-size change (BOH and customer manage link) | keep the current assignment if still valid, else rank 1 |
| FOH walk-in override | ranked list for the picker, raw insert path retired |
| Settings preview | ranked list against a chosen date and time |

The FOH override's own join search (`src/app/api/foh/bookings/route.ts`, DFS capped at 4 tables) and
`getMoveTableAvailability` in `src/lib/table-bookings/move-table.ts` are **retired**, not left alongside.
That is the whole point: five allocators become one.

Mutating callers must acquire the lock (section 9), call the primitive again inside the lock, and write in
the same transaction.

### 3.2 Validity

A candidate is valid when every one of these holds. Order matters only for which reason code is returned.

| Check | Reason code if it fails |
|-------|------------------------|
| Table is `is_bookable` | `table_not_bookable` |
| Table is `step_free` and `standard_height`, when the booking requires an accessible table | `not_accessible` |
| Table is `high_chair_capable`, when high chairs are requested | `no_high_chair_here` |
| No overlapping live assignment (see 3.5 for "live") | `table_occupied` |
| No overlapping communal event allocation | `table_communal` |
| **No overlapping private-booking block** (`is_table_blocked_by_private_booking_v05`) | `table_private_block` |
| No overlapping maintenance block | `table_blocked` |
| Not an online-held table, unless within the release window or channel is not `online` | `table_held` |
| `capacity >= party_size` | `too_large_for_table` |
| `party_size >= min_party_size`, unless within the release window or channel is not `online` | `below_table_minimum` |

The private-booking check is the regression from 9 May 2026. It is check number four here, at selection
time, so a blocked table is skipped rather than chosen and then rejected at insert.

`max_party_size` is **removed** from the design (review F-09, O-01). Every table's bookable maximum equals
its physical capacity, so the field would have been decoration. It can be added later with a real case.

### 3.3 Ranking

Single tables:

```sql
ORDER BY capacity ASC, priority ASC, table_number_sort ASC
```

Combinations, only searched when no single table is valid:

```sql
ORDER BY table_count ASC, total_capacity ASC, worst_member_priority ASC, table_ids_canonical ASC
```

`total_capacity ASC` before priority is the "maximise covers" rule applied to joins. For a party of seven,
Low 4a + Low 4b and Dining Room 4a + 4b both give 2 tables and 8 seats, so `worst_member_priority`
decides: 30 for the Low pair against 70 for the Dining Room pair. The Low pair wins. That is the fix for
the most frequent problem in the discovery.

`table_number_sort` is `table_number` cast to integer. The column is text today and `'10'` sorts before
`'2'` lexically (review F-10). `table_ids_canonical` is the sorted UUID array, so ties are deterministic
and reproducible in tests.

Combination eligibility (review F-10):

- Every member must be reachable from every other member through `table_join_links`, treating links as
  **undirected**. The live data stores some pairs one way only (Low 4b to Low 4a exists, the reverse does
  not), so the query must union both directions.
- **Connected is enough, a clique is not required.** The Dining Room happens to be a clique; do not encode
  that assumption.
- Joined capacity is the plain sum of member capacities. No seats are lost or gained.
- Minimum party size is **not** applied to combination members. A party of seven using Dining Room 6a is
  above every member minimum anyway, and applying minimums per member would block valid large joins.
- A combination is only considered when no single table is valid, so a party of two can never be given two
  tables.
- Maximum 8 tables per combination, as today.

### 3.4 Turn times and the turnaround gap

| Party size | Base | Sunday |
|-----------|------|--------|
| 1 to 2 | 90 | 105 |
| 3 to 4 | 105 | 120 |
| 5 to 6 | 120 | 135 |
| 7+ | 150 | 165 |

Stored as **six settings, not eleven** (review F-11): four base durations, one Sunday uplift of 15
minutes, one turnaround gap of 15 minutes. Sunday values are derived, not typed.

"Sunday" means any booking on a Sunday, food or drinks, not only `booking_type = 'sunday_lunch'`. Christmas
bookings keep their existing behaviour untouched.

**Where the gap lives (review F-12).** The customer's booking keeps its honest duration.
`table_bookings.end_datetime` is unchanged in meaning. The gap is added only to
`booking_table_assignments.end_datetime`, which is already a separate column and is already what the
overlap check reads. So:

- Customer sees, and confirmation emails say, 90 minutes.
- The table is unsellable for 105.
- The floor screen shows the booking bar at 90 minutes with the gap shaded differently.

The gap applies after the booking only, not before. It applies to tables and to outside resources. It does
**not** apply to high chairs, which are handed over immediately.

### 3.5 One liveness predicate (review F-35)

Defined once, used by tables, outside, drinks, high chairs, pacing and availability. Today three different
definitions exist across the codebase, which is why no-shows do not free tables for walk-ins.

A booking occupies its resources when **all** of:

- `status NOT IN ('cancelled', 'no_show')`
- `left_at IS NULL`
- not an expired unpaid hold: `NOT (status IN ('pending_payment','pending_card_capture') AND
  hold_expires_at IS NOT NULL AND hold_expires_at <= now() AND payment_status IS DISTINCT FROM 'paid')`

The `payment_status` clause is new and fixes the related defect the discovery found, where the faster of
the two cleanup jobs can cancel a booking whose deposit has already been paid.

Overlap is **half open**: `existing.start < new.end AND existing.end > new.start`. A booking ending at
20:00 does not conflict with one starting at 20:00. With the 15 minute gap the assignment already ends at
20:15, so this is safe.

All timestamps are `timestamptz`. Service-local reasoning uses `Europe/London`. Bookings crossing midnight
and both DST transitions are explicit test cases.

---

## 4. Availability

`check_table_availability_v06` calls the same primitive and returns, **for a whole date in one call** so
the website does not make an N+1 request per slot (review F-29):

```json
{
  "contract_version": 1,
  "date": "2026-08-02",
  "party_size": 4,
  "purpose": "food",
  "outside": false,
  "slots": [
    { "time": "18:00", "state": "available", "public_reason": null },
    { "time": "18:15", "state": "unavailable", "public_reason": "tables_full" },
    { "time": "18:30", "state": "unavailable", "public_reason": "kitchen_full" }
  ]
}
```

`state` is `available | unavailable | unknown` (review F-21). `unknown` is returned when the calculation
itself fails, and the website must then show "please call us" rather than pretending a slot is free or
refusing one that is not. **No fail-open.** The current website helper fails open; that changes.

Two reason vocabularies (review F-22):

- **Internal**, the codes in 3.2 plus `kitchen_full`, `outside_full`, `drinks_full`, `closed`,
  `kitchen_closed`, `cut_off`, `in_past`, `too_large_party`. Server-side only, logged, never sent to a
  customer.
- **Public**, a short fixed enum: `tables_full`, `kitchen_full`, `outside_full`, `closed`, `too_late`,
  `too_large`, `unknown`. Mapped from the internal codes. A private booking or a maintenance block always
  maps to `tables_full`, never revealing that a function is on.

Public messages are editable per public code at `/settings/table-bookings`. Plain text only, 200 character
limit, escaped on output, with immutable safe defaults if a message is blank. No HTML, no markdown.

Availability is advisory. **Creation stays the only authority.** The website re-checks on party-size
change, on purpose change and again at submit, and a lost race returns a stable `409` carrying the nearest
alternative times rather than a bare failure.

Caching: `no-store`, as today. At your volumes a fresh query per date is cheap and staleness is the enemy.

---

## 5. Capacity models

### 5.1 Indoor tables

Covered above. The physical tables are the model.

### 5.2 Outside (review F-05)

Settings alone cannot work, because changing capacity from 8 to 6 would silently re-cost every existing
future booking and could oversubscribe a diary that was legitimately taken.

So each outside booking gets a durable record. New columns on `table_bookings`:

- `outside_tables_reserved int` , how many outside tables this booking consumes
- `outside_capacity_basis int` , the per-table capacity in force when it was taken

At creation, `outside_tables_reserved = ceil(party_size / current capacity)`. It is stored, not recomputed.
An existing booking taken at 8 seats keeps its cost of 1 table even after the change to 6.

The cap is enforced by summing `outside_tables_reserved` across overlapping live outside bookings and
comparing against `outside_table_count`, inside the same lock as everything else.

Lowering capacity from 8 to 6 runs a **preflight**: it lists every future outside booking whose party size
exceeds the new capacity and would now need more tables, and refuses to save until each is acknowledged.
Contrary to v1, this is not a casual same-day settings edit, and the screen will say so.

Outside bookings hold no indoor table, count towards kitchen pacing when they are food, and follow the
same turn times and turnaround gap.

Journeys that must be specified and tested (review F-18): create, party-size change, time change,
cancellation, no-show, indoor to outside conversion and back, and a weather closure that blocks all outside
capacity for a window. Weather closure reuses the maintenance-block mechanism with a venue-wide outside
scope.

### 5.3 Drinks: assigned, but yielding

Drinks bookings get a real table, so a confirmed booking is always a promise of somewhere to sit. That
closes review finding F-06 and it removes the arithmetic problem: at 40 arrivals per 30 minutes with a 90
minute turn, an unassigned model would have allowed up to 120 drinks guests against 49 indoor seats.

But a drinks booking does not get to sit on a table a food booking needs. Every drinks assignment is
**soft**: the allocator may move it to another valid table to make room. New column
`table_bookings.assignment_soft boolean not null default false`, set true for drinks.

**The bump rule.** When no candidate is valid for a new booking, before returning `no_table` the allocator
tries once more:

1. Find live soft-assigned bookings whose window overlaps the requested one and whose tables would create
   a valid candidate if freed.
2. For each, re-rank it against the room **excluding** the tables the new booking needs. It must have a
   valid alternative of its own.
3. If a set of relocations exists that frees a valid candidate, apply them and take the booking.
4. Otherwise return `no_table`. **The drinks booking keeps its table.** Nobody is ever left without one.

Constraints:

- Never bump a **pinned** booking. Pinning is the staff override that makes a drinks table immovable.
- Never bump a booking that has already been seated (`seated_at` set) or whose start is within 60 minutes,
  configurable. Moving someone who is about to walk in is worse than refusing the new booking.
- Never bump a food booking. Soft assignment is drinks only in this release.
- Never bump the same booking twice in one allocation, and never chain bumps more than one level deep.
- Every bump is audited with both booking references and the reason.
- **No customer notification**, consistent with your earlier decision that internal table reassignment is
  not something a guest needs to hear about. The FOH screen shows the move.

Drinks arrivals are separately capped at 40 covers per 30 minutes, on the same rolling window as kitchen
pacing but counted independently, so a busy bar cannot swamp the room even when tables exist.

**Existing drinks bookings keep their current tables** and become soft-assigned at migration. No
retrospective unassignment and no moves at deploy time.

### 5.4 Large parties, and whether we need more joining

**Short answer: no new joining capability is needed.** The join search already reaches 8 tables, and the
Dining Room already joins to 26 seats. What blocks a party of 21 today is a hard `too_large_party` guard
that fires before the search ever runs.

Three separate limits, and only the middle one is a real physical constraint:

| Party size | Online | Staff and walk-in |
|-----------|--------|-------------------|
| 1 to 20 | Booked normally | Booked normally |
| 21 to 26 | Refused, routed to the private-booking enquiry | **Accepted.** The Dining Room joins to exactly 26 |
| 27 and over | Refused, routed to the private-booking enquiry | **Accepted**, using any free tables, joined or not |

So `create_table_booking_v06` takes the party-size ceiling from the channel rather than hard-coding 21:
`table_booking_max_party_online`, default 20, and `table_booking_max_party_staff`, default 40. Both
editable.

Above 26 there is no physically joined combination, because Big Bay, Small Bay and High 4 link to nothing.
For a walk-in party of 30 the honest behaviour is to let staff take whatever is free: the
**`allow_unjoined_tables` override**, available on the staff and walk-in channels only, drops the
join-link requirement from combination search and returns the best set of free tables regardless of
adjacency. The FOH screen shows a plain warning that the tables are not next to each other, so the host
knows they are seating a group across the room. It is audited like any other override.

This is exactly your "in a live situation we'd never turn that away". The rules stop being a wall and
become a default that staff can step past, with a record of it.

Online, 21 and over gets the private-booking route, which is the correct commercial answer and is what
your deposit and contract process already exists for.

### 5.5 High chairs

Unchanged, except that the silent shortfall from the discovery is fixed: when fewer chairs are granted
than requested, the booking response, the confirmation and the staff view all say so explicitly.

---

## 6. The `v06` contract (review F-03)

`create_table_booking_v06` is built **by diffing the live `v05` definition**, not written from a feature
list. The live definition is captured to `tasks/artefacts/create_table_booking_v05-live-2026-07-27.sql`
before work starts, and the migration includes an assertion that the live function still matches that
snapshot, aborting if anything has drifted.

**Signature.** All 13 existing `v05` parameters keep their names, types, order and defaults, so every
current caller compiles unchanged. Three new parameters are appended, all defaulted:

```
p_channel  text    default 'online',
p_pin      boolean default false,
p_overrides jsonb  default '{}'::jsonb
```

**Preserved verbatim from `v05`:** the guard order and reason codes for missing customer, missing datetime,
invalid party size, party of 21 or more, purpose normalisation, Christmas rules and their `22023`
exceptions, the Sunday-lunch guard, the past-time check, the business-hours and special-hours lookup, both
kitchen and pub window arithmetic including the past-midnight lift, the drinks-near-close setting, both
cut-off rules, deposit calculation at party 10 or more, `booking_holds` and `payments` side effects,
reference generation, high-chair reservation and its advisory lock, and the full success response shape
including `table_id`, `table_ids`, `table_name`, `table_names`, `tables_joined`, `hold_expires_at`,
`high_chairs_granted` and `is_outside_seating`.

**Changed:** table selection delegates to the primitive; the lock moves ahead of selection; the private
block, holds and minimums are honoured; turn times replace flat durations; drinks and outside follow
section 5; the new reason codes in 3.2 are added.

**Reason-code stability.** Every existing code keeps its meaning. `outside_hours` and `cut_off` are
currently emitted from five and three different conditions. New, more specific codes are added alongside
them, and the coarse codes remain valid for one release so the external API and the website keep working
during deployment.

**Security.** `SECURITY DEFINER`, owner `postgres`, `search_path = public`, `REVOKE ALL FROM PUBLIC`, then
`GRANT EXECUTE` to exactly `postgres, anon, authenticated, service_role`, reproducing the live ACL.

The live `anon` and `authenticated` grants are a pre-existing over-exposure noted in the discovery.
I am reproducing them rather than fixing them here, because tightening a grant inside a behaviour release
is how you find out at 7pm on a Friday which caller depended on it. Flagged as a follow-up.

`check_table_availability_v06` and `find_table_allocation_candidates` are `SECURITY DEFINER`,
`search_path = public`, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE` to `service_role` only. The website
reaches them through the AMS API, which already uses the service role. They return public reason codes
only; internal codes are stripped at the AMS boundary.

**Parity tests.** A fixture set of requests that touch none of the new features must return byte-identical
responses under `v05` and `v06`. That fixture set covers high chairs, outside, Christmas, Sunday lunch,
deposits at 10 and over, every blocked reason and every hours edge case.

---

## 7. Schema

One migration set, applied in one production change, all additive.

| Object | Change |
|--------|--------|
| `tables` | add `priority int not null default 100`, `min_party_size int not null default 1`, `step_free boolean not null default true`, `standard_height boolean not null default true`, `high_chair_capable boolean not null default true`, `heated boolean not null default true`. Backfill by table **id**, not by name (review F-34), with a preflight asserting the expected 12 rows and their ids. Small Bay `step_free = false`; High 4 `standard_height = false` and `high_chair_capable = false`. Check constraint `min_party_size >= 1 AND min_party_size <= capacity` |
| `table_holds` | new. See below |
| `table_bookings` | add `table_pinned boolean not null default false`, `assignment_soft boolean not null default false`, `requires_accessible_table boolean not null default false`, `outside_tables_reserved int`, `outside_capacity_basis int`. Backfill `assignment_soft = true` for live future `booking_purpose = 'drinks'` bookings |
| `find_table_allocation_candidates` | new |
| `check_table_availability_v06` | new |
| `create_table_booking_v06` | new |
| `move_table_booking_assignments_v06`, `move_table_booking_time_v06` | new, built on the primitive |
| `system_settings` | seed all new keys |
| Indexes | `booking_table_assignments (table_id, start_datetime, end_datetime)`; `table_bookings (booking_date, status) where left_at is null`; `table_holds (table_id, starts_on, ends_on)` |

Nothing is dropped. `tables.is_active` is dead but stays, so no cleanup is mixed into a behaviour release.

### `table_holds` (review F-14, F-15)

```
id             uuid pk
table_id       uuid not null references tables(id)
hold_type      text not null check (hold_type in ('walk_in_hold','maintenance'))
starts_on      date not null
ends_on        date not null          -- inclusive both ends
day_of_week    smallint null          -- null = every day in range
starts_at      time not null
ends_at        time not null          -- ends_at <= starts_at means it crosses midnight
note           text null
active         boolean not null default true
created_by     uuid not null
created_at     timestamptz not null default now()
cancelled_at   timestamptz null
cancelled_by   uuid null
check (ends_on >= starts_on)
```

Times are Europe/London service-local. Cancellation is `active = false` plus `cancelled_at`, never a
delete, so the audit trail survives.

The two hold types behave differently and the UI shows them differently:

- **`walk_in_hold`** affects online bookings only, and only until the release window. It may overlap an
  existing booking, because it changes what is sold, not what is promised.
- **`maintenance`** affects every channel including staff. Creating one that overlaps an existing live
  assignment is **rejected**, with the affected bookings listed, unless a user with the override
  permission confirms. If confirmed, the affected bookings are listed for manual relocation and are
  **never silently unassigned**. This is deliberately the opposite of what `is_bookable` does today.

### Holds versus joins

**Held tables: Low 4a and High 4** (D7). They are withheld from online single-table selection until 24
hours before the sitting, then released.

**Walk-in holds apply to single-table selection only, never to combinations.** A party of seven or eight
can still be offered Low 4a + Low 4b online, because a walk-in group of that size is vanishingly rare: 25
parties of 7 or more in 180 days, against 41% of all bookings being walk-ins that are mostly 1 to 4. Without
this rule, holding either Low table would push every online seven and eight into Dining Room 4a + 4b and
undo the single most frequent problem this release exists to fix.

Maintenance blocks are different and do apply to combinations, because a table that is out of service is
out of service.

**Worth watching after launch.** You have five four-seaters. Holding two of them leaves three for online
single-table bookings, so online parties of 1 to 4 will reach the Dining Room sooner than they do today.
The 24 hour release and the monitoring in section 16 will show whether that matters. If it does, the fix
is a settings change: hold one table instead of two, or shorten the release window.

---

## 8. Pinning (review F-16)

`table_pinned` is a property of the whole assignment set, not one table.

| Event | Behaviour when pinned |
|-------|----------------------|
| Automatic re-rank or retry | Never moves it. This is the guarantee |
| Staff manual move | Allowed. The booking stays pinned to the new tables. Audited |
| Party grows beyond the pinned capacity | Rejected with `pinned_capacity_exceeded`, naming the pin. Staff either unpin or move it manually |
| Time change into a conflict | Rejected with `pinned_conflict`, listing the conflicting booking |
| Maintenance block created over it | Rejected unless overridden, per section 7 |
| Drag one chip of a joined booking | Rejected. The whole set moves or nothing does. This also fixes the silent join-collapse the discovery found |
| Unassigned or outside booking | Cannot be pinned. There is nothing to pin to |

Every pin, unpin and override is audited with actor, reason, before and after state.

---

## 9. Locking and transactions (review F-28)

One lock order for every mutating path, always in this sequence, to make deadlock impossible:

1. `pg_advisory_xact_lock(hashtext('table_alloc:' || booking_date))`
2. `pg_advisory_xact_lock(hashtext('outside_alloc:' || booking_date))` , only when outside
3. `pg_advisory_xact_lock(hashtext('high_chair_reservation'))` , only when chairs are requested, existing
   global lock kept as is

The allocation lock is per date, matching the existing pacing lock. At your volumes, roughly 3.6 bookings
per trading day, per-date locking costs nothing.

Taking the lock **before** selection removes the need for a retry loop, because no one else can take the
table between choosing it and writing it. The trigger's `SELECT ... FOR UPDATE` stays as a belt-and-braces
guard. The FOH override's current 8-attempt retry loop is removed with the rest of that code path.

Booking row, assignment rows, pacing check, outside count and high-chair grant all happen in **one**
transaction. Current BOH edits that update the booking and its assignment windows in separate operations
are moved into an atomic RPC.

---

## 10. Existing bookings (review F-13)

| Feature | Existing future bookings |
|---------|-------------------------|
| Priority and minimum party size | Not applied retrospectively. Nothing is moved |
| Turn times and turnaround gap | Not backfilled. Existing bookings keep their stored windows. New and rescheduled bookings get the new rules |
| Holds and maintenance blocks | Do not invalidate existing bookings. Maintenance conflicts are surfaced at hold-creation time |
| Outside | Backfilled once: `outside_tables_reserved = ceil(party_size / 8)`, `outside_capacity_basis = 8`, for the 9 live outside bookings |
| Drinks | Keep their tables under every option in 5.3 |
| Pin | Defaults false everywhere |

An edit to an old booking adopts the new rules for whatever it changes, and leaves the rest alone. A full
reschedule is treated as a new booking. No customer is emailed about a rule change they will never notice.

---

## 11. Caller and surface matrix (review F-27)

Both repositories at the pinned commits.

**AMS, allocation paths:**

| Path | Today | After |
|------|-------|-------|
| `POST /api/table-bookings` | `v05` | `v06` |
| `POST /api/foh/bookings` walk-in override | own raw-insert allocator, DFS depth 4, retry loop | primitive, retired |
| `POST /api/external/table-bookings` | `v05` | `v06`, coarse reason codes preserved |
| `src/lib/table-bookings/move-table.ts` | own availability calc | primitive |
| `src/lib/table-bookings/manage-booking.ts` party-size growth | own logic, cannot join, 500s | primitive |
| `api/boh/table-bookings/[id]` window edits | two separate writes | atomic RPC |
| `api/foh/bookings/[id]/time` drag | `move_table_booking_time_v05` | `v06` |
| `api/boh/table-bookings/[id]/party-size` | own logic | primitive |
| `GET /api/table-bookings/load` | pacing only | `check_table_availability_v06` |

**AMS, other surfaces to update:** FOH floor screen (pin, hold, block, join drag), booking detail page,
BOH list, settings page, confirmation and reminder templates if 5.3 option C is chosen, the daily summary
and rota views that show table names.

**Website:** `app/api/table-bookings/availability/route.ts`, `app/api/table-bookings/route.ts` (proxy),
`components/features/TableBooking/ManagementTableBookingForm.tsx`,
`components/features/TableBooking/BookingDatePicker.tsx`, `components/BookTableButton.tsx`,
`lib/table-booking-slot-window.ts`, `lib/table-booking-service-windows.ts`, the booking-agent availability
and create path, the confirmation and payment pages, and the campaign-prefilled booking links.

Before implementation, both repositories are grepped again at the pinned commits for any caller of
`create_table_booking`, `/api/table-bookings/load` and `/availability`, and the matrix is completed. Legacy
website booking components are identified as live or dead at that point.

---

## 12. Website behaviour

- Availability is requested for a whole date, with party size, purpose and outside flag.
- The form re-requests availability whenever party size, purpose or outside changes. It does not do this
  today, which is why a customer can be shown slots that were only ever valid for a different party.
- Unavailable slots are shown greyed with the public reason beneath, not hidden. Hidden slots read as a
  closed pub.
- `unknown` shows "we cannot check availability right now, please call us on the number below", with the
  slot neither offered nor refused.
- Submit re-checks. A `409` shows the nearest three alternative times.
- The date picker marks days with no capacity **for that party size**.
- Parties of 21 and over are routed to the private-booking enquiry, not bare-refused. See section 5.4.
- Reason strings come from the AMS settings API, cached for 5 minutes, with the built-in defaults as
  fallback.

Accessibility (review F-32), target WCAG 2.2 AA:

- Slot state is never colour alone. Unavailable slots are `aria-disabled` with `aria-describedby` pointing
  at the reason text.
- The settings table reorder has keyboard up and down buttons alongside drag, and the numeric priority is
  always visible.
- Save errors go to a live region.
- Pin, hold and block controls have accessible names and visible focus.

**Access and suitability (D15, extended 2026-07-27).** Three booleans on `tables`, all defaulting to true:

| Flag | False for | Meaning |
|------|-----------|---------|
| `step_free` | Small Bay | There is a step to reach it |
| `standard_height` | High 4 | Bar-height table with stools |
| `high_chair_capable` | High 4 | A high chair cannot be used here |

Plus `heated boolean not null default true`, false for all outside seating.

**One question to the customer, not three.** A single checkbox on the website form and on both staff create
modals:

> I need an accessible table (step-free, with standard-height seating)

When ticked it sets `table_bookings.requires_accessible_table` and filters candidates to tables that are
both `step_free` and `standard_height`. Reason code `not_accessible`. It is a **hard filter that never
releases** at the 24 hour mark, because access is not a capacity trade. Staff can override it only with an
explicit recorded reason, for the guest who says the step is fine.

**We do not ask why.** The question is about the table, not about the person. No condition, no diagnosis,
no free-text prompt inviting one. Under UK GDPR, health information is special-category data; a seating
requirement is not, provided we never record a reason. This also happens to be the framing that converts,
because nobody wants to declare a disability to book a pub lunch.

The requirement is stored **on the booking only**. Carrying it to the customer profile would make it
persistent data about a person's health, so it is offered as an explicit opt-in ("remember this for next
time") and never inferred.

**High chairs need no new question.** The existing high-chair count already drives it: when
`high_chair_count > 0`, tables with `high_chair_capable = false` become invalid, reason code
`no_high_chair_here`. Today the system will happily seat a family with a high chair at High 4, where it
cannot be used. Nothing has hit this yet (zero high-chair bookings have been assigned since the feature
shipped on 2026-07-07) but it is a real defect and it is fixed here.

**Unheated outside seating is a disclosure, not a filter.** All five outside tables are unheated. The
website shows it on the outside option and repeats it in the confirmation, with stronger wording between
October and April. Nobody should discover it on arrival in November. Editable message, same mechanism as
the other customer messages.

**Capacity cost is small.** Only Small Bay fails `step_free` and only High 4 fails `standard_height`, so a
guest needing an accessible table still has 8 of your 10 tables. This is a cheap adjustment, not a
trade-off.

### Why the held tables are Low 4a and High 4

Settled 2026-07-27: **bookings take priority over walk-ins.** The two tables withheld from online sale are
the ones an online booker would miss least, which is why High 4 is one of them despite being the least
accessible table in the pub.

This works because a hold **withholds a table from online booking; it does not restrict walk-ins to it.**
A walk-in family with a toddler, or a walk-in who cannot manage stools, is seated on whatever suits them
from everything that is free. The hold only makes it more likely that something is.

The one thing to watch: High 4 cannot take a high chair, so if it is the only free table when a walk-in
family arrives, they cannot be seated there. With ten tables and 3.6 bookings a day that will be rare, and
the monitoring in section 16 will show it if it is not.

---

## 13. Settings page

All at `https://management.orangejelly.co.uk/settings/table-bookings`.

| Section | Contents |
|---------|----------|
| **Tables** | name, number, capacity, bookable, priority (drag to reorder, number always visible), minimum party size, step-free, standard-height, high-chair capable, heated. Per-table hold and block buttons |
| **Turn times** | four base durations, Sunday uplift, turnaround gap. Six inputs, Sunday values shown as derived |
| **Kitchen pacing (arrivals)** | pace covers regular and Sunday, walk-in reserve, window minutes, and a live read-out of the resulting online ceiling. Labelled "arrivals", per 2.1 |
| **Outside seating** | table count, capacity per table, total seats shown. Lowering capacity runs the preflight in 5.2 |
| **Drinks bookings** | arrivals ceiling, whether drinks assignments may be bumped, and the protection window before arrival during which they may not |
| **Party size limits** | online maximum (20) and staff maximum (40) |
| **Holds and blocks** | which tables are held for walk-ins, release lead time in hours, one-off maintenance blocks with reason and date range |
| **Customer messages** | one plain-text message per public reason code, with preview |
| **Preview** | party size, date, time and purpose, showing the chosen tables, the rejected candidates and why (review O-06) |

Validation (review F-24), enforced in **both** the UI and the database RPC, not just the UI:

- walk-in reserve must not exceed pace covers
- minimum party size must be between 1 and the table's capacity
- outside table count at least 1, capacity per table at least 1
- turn times between 30 and 480 minutes, turnaround gap between 0 and 60
- release lead time between 0 and 168 hours
- duplicate priorities are allowed but flagged, since `table_number_sort` breaks the tie deterministically

Each section saves atomically with an `updated_at` precondition, so a stale browser tab cannot overwrite
someone else's change. Invalid settings **fail closed** on save, never on read: if a stored value is
somehow invalid, the allocator uses the coded default and logs a warning rather than refusing all bookings.

Permissions: `settings:manage` for the settings page as today. New named permissions for the floor
controls (review F-17): `table_bookings:pin`, `table_bookings:block`, `table_bookings:override_minimum`,
`table_bookings:override_hold`. Physical capacity, private-booking blocks, communal events and maintenance
blocks are **never** bypassable by anyone. Every override records actor, reason (mandatory), before and
after state, and the affected booking.

---

## 14. Testing (review F-31)

| Layer | Must cover |
|-------|-----------|
| SQL unit | every party size 1 to 21 against an empty room; every table's minimum; join eligibility and ranking; the Low-versus-Dining-Room pair at 7 and 8; determinism across repeated runs |
| SQL parity | the `v05` versus `v06` fixture set from section 6 |
| Liveness | every status, `left_at`, expired holds, paid-but-expired holds, half-open boundary equality |
| Blocks | private booking, communal event, maintenance, walk-in hold before and after release |
| Concurrency | two real concurrent transactions for the last table; two for the last outside table; a create racing an edit. Needs a real database, not mocks |
| Time | Sunday, Sunday lunch, Christmas, both DST transitions, bookings crossing midnight |
| Contract | availability and create agree for a generated matrix of date, time, party size and purpose. This is the regression test for the whole point of the release |
| Migration | apply forward, run the preflight assertions, verify grants before and after |
| Component | website form re-checks on party-size change; greyed slots carry their reason; `unknown` renders the call-us path |
| End to end | book online, see it on the floor screen, move it, pin it, grow it, cancel it |
| Accessibility | keyboard reorder, screen-reader slot states, contrast |
| Production smoke | after deployment, one real booking per channel, then removed |

The existing website tests under `tests/api/table-bookings*.test.ts` are updated as part of the work.

---

## 15. Deployment and recovery (review F-01, F-07, F-30)

One release, per D13, but three components deploy separately, so ordering matters.

1. Capture the live `v05` definition and grants to the artefact file.
2. Apply the migration. Every new function exists but **`table_allocation_v06_enabled` defaults to false**,
   so `v06` behaves exactly like `v05`. This is the feature gate that makes one release recoverable.
3. Deploy AMS. It can read both the old and new availability contracts.
4. Deploy the website manually with `vercel --prod`. It can read both contracts.
5. Staff briefing and floor-screen walkthrough, with a named owner. Not "tell the team".
6. Enable the gate, ideally on a Monday or Tuesday, never before a Sunday service or a Wednesday evening,
   which are your two peak sessions.
7. Smoke test one booking per channel.
8. Watch for a fortnight, then remove the gate and the `v05` fallback.

**Recovery.** Repointing callers at `v05` is not a valid rollback once new state exists, because `v05`
knows nothing about holds, blocks, pins or outside reservations and would happily book a table that is out
of service. So recovery is, in order of preference:

| Situation | Action |
|-----------|--------|
| Bad ranking or a wrong setting | Change the setting. No deployment |
| A behaviour is wrong but bookings are being taken correctly | Disable the specific feature setting |
| The allocator itself is wrong | Set `table_allocation_v06_enabled` to false. `v06` falls back to `v05` selection while keeping the new columns intact. Bookings taken under `v06` remain valid |
| Something is catastrophically wrong | Revert the AMS deployment and disable the gate. The migration is not reverted, because it is additive and reverting it would delete holds, pins and outside reservations |

Anything created while the gate was on is reconciled by a named owner, not automatically.

---

## 16. Monitoring (review F-33)

Recorded per channel, purpose, party size and slot, from day one:

- availability results by state and public reason
- create attempts, successes, and every blocked reason
- **availability-versus-create mismatches**, the single most important number in this release
- chosen tables and combinations, so fragmentation can be seen rather than guessed
- pacing, outside and drinks refusals
- override use, by actor
- allocator latency p50 and p95, and database errors

Thresholds reviewed at end of day one, end of the first weekend and end of the first fortnight, with a
named owner who can disable a feature without waiting for a developer.

Success is measured as: zero double bookings, zero private-booking false refusals, the
availability-to-create mismatch rate below 1%, and no fall in accepted bookings against the same period
last year.

---

## 17. Discovery traceability (review F-37)

| Discovery finding | Disposition |
|-------------------|-------------|
| 4.1 private-booking blindness | Fixed |
| 4.2 availability ignores tables | Fixed |
| 4.3 duration ignored in pacing | **Reframed**, see 2.1. Fixed as a table-occupancy issue, not a pacing one |
| 4.4 small parties eat the Dining Room | Fixed by priority plus minimum party size |
| 4.5 wrong pair for 7 and 8 | Fixed by join ranking |
| 4.6 customer manage link 500 | Fixed by the shared primitive |
| 4.7 no-shows do not free tables | Fixed by the single liveness predicate |
| 4.8 outside uncapped | Fixed |
| 4.9 lost race becomes a false refusal | Fixed by moving the lock ahead of selection |
| 4.10 vague blocked reasons | Fixed |
| 4.10 expired paid holds | Fixed in the liveness predicate |
| 4.10 silent high-chair shortfall | Fixed |
| 4.10 `tables.is_active` dead | **Out of scope.** Left alone, flagged for a cleanup |
| 4.10 booking-reference retry | **Accepted.** One in ten million, and a retry works |
| 4.10 drag collapses joins | Fixed in section 8 |
| 5 no per-table blocking | Fixed by `table_holds` |
| 5 no floor plan | **Out of scope** |
| 5 no manual table pick at creation | Fixed, the create modals gain a table picker fed by the primitive |
| 5 no staff availability query | Fixed by the settings preview and the floor screen |

---

## 18. Resolutions and assumptions

### Resolved 2026-07-27

1. **Pacing measures arrivals**, not people still eating. Confirmed. Section 2.1 stands, and my discovery
   finding 4.3 is formally withdrawn.
2. **Held tables are Low 4a and High 4**, not Low 4a and Low 4b. Holds apply to single-table selection
   only. Section 7.
3. **Drinks keep a table but yield it** when a food booking needs it and the drinks booking has somewhere
   else to go. Section 5.3.
4. **Parties over 20 are a private booking online, and always acceptable by staff.** No new joining
   capability is needed: the Dining Room already joins to 26 and the search already reaches 8 tables. What
   was missing was a channel-aware party-size ceiling, plus an `allow_unjoined_tables` override for staff
   seating a group above 26 across tables that are not linked. Section 5.4.
5. **`step_free` adopted.** Small Bay is the only table that is not step free. Section 12.

6. **Held tables stay Low 4a and High 4.** Confirmed 2026-07-27 on the principle that bookings take
   priority over walk-ins, so the tables withheld from online sale are the ones an online booker would
   miss least. A hold does not restrict walk-ins to those tables, so accessible seating remains available
   to whoever needs it. Section 7.

### Assumptions I have made rather than come back to you

- **The bump rule protects an imminent arrival.** A drinks booking within 60 minutes of its start, or one
  already seated, is never moved, even if that means refusing the food booking. Moving someone who is
  about to walk through the door is worse than turning away a booking. The 60 minutes is a setting.
- **Bumping is drinks-only and one level deep.** No food booking is ever moved to make room, and a bump
  never cascades. Cascading relocation is how a diary becomes unexplainable to the person holding it.
- ~~**Staff maximum party size defaults to 40.**~~ **Confirmed by the owner 2026-07-27: "Staff maximum
  is 40."** No longer an assumption. Editable in settings.
- **The private-booking route for 21 and over is the existing enquiry form**, not a new flow.

None of these change the data model, so implementation can start. Flag any you disagree with and they are
settings changes, not rework.
