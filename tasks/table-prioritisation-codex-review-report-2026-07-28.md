# Adversarial code review: `feat/table-allocation-v06`

Date: 2026-07-28  
Reviewed branch: `feat/table-allocation-v06`  
Reviewed base: `36001722`  
Review type: SQL, migrations, test harness, and backtest  
Production impact today: none; the branch has not been applied  

## Executive summary

Do not activate the new allocator yet.

The normal branch test suite passes, but targeted tests reproduced failures that could:

- refuse valid customer and staff bookings;
- allocate guests to a table under maintenance;
- make every allocation call fail after a settings save;
- keep tables blocked by cancelled event bookings;
- select a table and then fail when the production integrity trigger rejects it;
- give staff different tables from the ones they selected;
- give false confidence from a stale, non-reproducible backtest.

The main ranking idea is sound:

- food uses `tables.priority`;
- drinks and communal events use `tables.bar_priority`;
- singles rank by best fit and then house order;
- combinations rank by table count, capacity, worst priority, and stable UUID order.

The problems are around completeness of the search, hold handling, enforcement parity, settings validation,
and the evidence used to approve the change.

## Severity

| Level | Meaning |
|---|---|
| P0 | Can stop all or almost all bookings after one allowed action |
| P1 | Can refuse a valid booking, allocate an unusable table, or break a booking transaction |
| P2 | Can mislead staff, allow unsafe configuration, or remove an important deployment guard |
| P3 | Contract, explanation, or test-quality defect with lower immediate operational impact |

## Confirmed findings

### F1. P0: the settings RPC can store a value that breaks every allocation call

Files:

- `supabase/migrations/20260801000500_table_booking_settings_rpc.sql:127-180`
- `supabase/migrations/20260801000500_table_booking_settings_rpc.sql:287-293`
- `supabase/migrations/20260801000700_allocation_candidates.sql:175-177`

The validator casts numeric settings to `numeric`, but never checks that settings used as integers are
whole numbers.

Concrete failure:

1. A manager saves `hold_release_lead_hours = 24.5`.
2. `validate_table_booking_settings` returns no error.
3. `set_table_booking_settings` returns `{"ok": true}` and stores the value.
4. `find_table_allocation_candidates` casts `"24.5"` directly to `integer`.
5. PostgreSQL raises `invalid input syntax for type integer: "24.5"`.
6. Every call to the shared picker fails until the setting is repaired.

This was reproduced in the throwaway database.

There are two related validation defects:

- `walk_in_reserve = pace` is allowed because the check rejects only `reserve > pace`. The live pacing
  formula uses `GREATEST(0, pace - reserve)`, so equality creates a zero-cover online ceiling.
- partial turn-time updates are compared with hard-coded defaults rather than the stored values. A stored
  sequence of `200, 210, 220, 230` accepted a partial update to `200, 210, 220, 150`.

Proposed fix:

1. Define the type of every key in one database-owned key registry.
2. For integer keys, reject values where `v_num <> trunc(v_num)`.
3. Reject non-object payloads, missing `value` properties, nulls, and extra properties if they are not
   intentionally supported.
4. Require `walk_in_reserve < pace` while pacing is enabled. If managers need to close online food
   bookings deliberately, provide a separate explicit switch.
5. Merge partial turn-time payloads with the current stored values before checking ordering.
6. Read settings through safe typed helpers that return a coded default for malformed stored data, as
   required by the specification. Do not use an unguarded text-to-integer cast in the allocator.

Required tests:

- every integer key rejects `1.5`, strings, null, arrays, and objects;
- pace 10 and reserve 10 is rejected;
- partial turn-time updates are checked against current stored values;
- a deliberately corrupted stored setting returns the coded default and does not break availability.

### F2. P1: maintenance holds are checked at one instant, not across the booking window

Files:

- `supabase/migrations/20260801000700_allocation_candidates.sql:57-104`
- `supabase/migrations/20260801000700_allocation_candidates.sql:235`

`table_is_held` receives `p_start_at` but not `p_end_at`. It checks only whether the booking start time is
inside the hold.

Concrete failure:

- requested booking: 18:00 to 20:00;
- active maintenance hold: 19:00 to 21:00;
- current result: `table_is_held = false`;
- wrong outcome: the table may be assigned even though the booking overlaps the repair.

The current date and day-of-week calculation also misses some overnight holds. A Monday 22:00 to Tuesday
02:00 hold should block a Tuesday 01:00 booking by using Monday as the hold occurrence date.

Proposed fix:

1. Change the helper to accept both `p_start_at` and `p_end_at`.
2. Convert each relevant hold occurrence into a real Europe/London `timestamptz` range.
3. For overnight holds, check the service date before the booking date as well.
4. Use the shared half-open overlap rule.
5. Apply `day_of_week` to the date on which the hold occurrence starts.
6. Pass the full occupancy window, including turnaround time, for maintenance checks.

Alignment decision:

- Recommendation: maintenance uses full-window overlap.
- Confirm whether walk-in holds also use full-window overlap or only the advertised sitting start. This
  should be an explicit rule rather than an accident of the helper signature.

Required tests:

- hold starts during booking;
- hold ends during booking;
- booking fully contains hold;
- overnight hold from the previous service date;
- both daylight-saving transitions;
- exact half-open boundary equality.

### F3. P1: the event allocator ignores maintenance holds completely

File:

- `supabase/migrations/20260801000800_event_communal_allocation_v02.sql:91-100`

The event allocator checks `is_bookable`, capacity, private-booking blocks, exclusive assignments, and
communal allocations. It never checks `table_holds`.

Concrete failure:

1. Low 4a has an active maintenance block from 17:00 to 23:00.
2. A four-seat communal event is allocated at 19:00.
3. Low 4a is first by `bar_priority`.
4. v02 confirms the event on Low 4a.

This was reproduced in the throwaway database.

Proposed fix:

- call the corrected full-window hold helper from v02;
- use a non-online channel so walk-in holds do not affect events;
- ensure maintenance still applies to every channel;
- add a test that the event falls through to the next free bar table;
- add a test where all remaining tables are maintained and the event returns a stable blocked response.

### F4. P1: walk-in holds wrongly remove tables from valid combinations

Files:

- `supabase/migrations/20260801000700_allocation_candidates.sql:235-243`
- `supabase/migrations/20260801000700_allocation_candidates.sql:266-300`
- `tasks/table-prioritisation-spec-v2-2026-07-27.md:533-545`

The specification says walk-in holds apply to single-table online selection but do not stop Low 4a being
used with Low 4b for a large joined party.

The implementation records `table_held` in `scored`, removes the table from `valid`, and builds all
combinations from `valid`. The held table is therefore unavailable to combinations.

Concrete failure:

- online party size: 7;
- Dining Room: privately blocked;
- Low 4a and Low 4b: free and joined;
- Low 4a: standing online walk-in hold;
- expected: Low 4a + Low 4b;
- actual: zero ranked candidates.

This was reproduced.

Proposed fix:

Split eligibility into at least two sets:

- `valid_for_single`: excludes an active online walk-in hold;
- `valid_for_combination`: allows a walk-in-held table but still excludes maintenance, occupancy, private
  bookings, communal events, accessibility failures, and other hard failures.

Do not make maintenance joinable. A maintained table is invalid everywhere.

Required tests:

- online party of two cannot use Low 4a before release;
- online party of seven can use Low 4a + Low 4b before release;
- the same pair is invalid when Low 4a is under maintenance;
- after release, Low 4a becomes valid as a single.

### F5. P1: the combination search has a current-floor eight-table refusal

File:

- `supabase/migrations/20260801000700_allocation_candidates.sql:286-312`

The recursive search stops at eight tables.

Concrete failure on the current floor:

1. One six-seat table is occupied.
2. Nine bookable tables remain.
3. Their total capacity is 43.
4. Any eight of those tables can seat at most 39.
5. Staff request a party of 40 with `allow_unjoined = true`.
6. Expected: all nine free tables.
7. Actual: zero ranked candidates.

This was reproduced.

This contradicts the approved staff maximum of 40 and the stated live-situation use of unjoined tables.

Proposed fix:

- remove the hard-coded eight-table limit;
- derive the maximum from the number of currently valid bookable tables;
- keep the staff party-size ceiling as the typo guard, not as a search shortcut.

With ten tables, exhaustive subset search remains very small.

Required test:

- one six-top occupied, nine tables and 43 seats free, party 40 with `allow_unjoined` returns all nine.

### F6. P1: UUID pruning can miss a connected combination

File:

- `supabase/migrations/20260801000700_allocation_candidates.sql:267-300`

`v.id > w.last_id` ensures that a set is not enumerated twice. However, adjacency is also required at
every intermediate step.

Concrete failure:

- UUID order: A, B, C;
- physical links: A-C and B-C;
- capacities: two seats each;
- party size: six;
- the set A+B+C is connected;
- A cannot add B, A can add C but then cannot add lower UUID B;
- B can add C but cannot add lower UUID A;
- result: the valid connected set is never produced.

This does not affect the current Dining Room clique or the current Low pair, but it will break a valid
future floor topology or changed UUID set.

Proposed fix:

Because the floor has only ten bookable tables, enumerate canonical subsets in ascending UUID order
without requiring intermediate adjacency. After forming a subset:

1. check capacity;
2. check that its induced undirected graph is connected, unless `allow_unjoined` is true;
3. rank it.

At most 1,023 non-empty subsets exist for ten tables, so the simpler complete algorithm is preferable to
unsafe pruning.

Required tests:

- A-C-B bridge topology;
- a longer path;
- a disconnected set with the same total capacity remains invalid;
- each valid set appears exactly once.

### F7. P1: cancelled and expired event allocations still block table bookings

Files:

- `supabase/migrations/20260801000700_allocation_candidates.sql:225-231`
- `supabase/migrations/20260801000800_event_communal_allocation_v02.sql:80-88`

The picker treats any overlapping row in `event_communal_seat_allocations` as active. It does not join the
parent event booking or call `is_active_event_booking_for_capacity_v01`.

Concrete failure:

1. A communal allocation row remains for Dining Room 4a.
2. Its event booking is cancelled or its payment hold has expired.
3. The existing event capacity code correctly treats the allocation as inactive.
4. The new table picker reports `table_communal`.
5. A customer may be refused even though the table is free.

This was reproduced with a cancelled event booking.

Proposed fix:

Join `event_communal_seat_allocations` to `bookings` and require
`is_active_event_booking_for_capacity_v01(status, hold_expires_at)`.

Required tests:

- confirmed event allocation blocks;
- unexpired pending-payment allocation blocks;
- cancelled allocation does not block;
- expired pending-payment allocation does not block.

### F8. P1: the picker and production integrity triggers disagree about expired unpaid holds

Files:

- `supabase/migrations/20260801000700_allocation_candidates.sql:215-224`
- `supabase/migrations/20260801000800_event_communal_allocation_v02.sql:71-79`
- `supabase/migrations/20260611000000_communal_event_seating.sql:174-187`
- `supabase/migrations/20260611000000_communal_event_seating.sql:252-266`

The picker and event allocator use `is_booking_live`, so an expired unpaid deposit hold releases its
table.

The production event-allocation and table-assignment triggers still use:

- status is not cancelled or no-show;
- `left_at` is null.

They do not release expired unpaid holds.

Concrete failure:

1. Low 4a has an overlapping assignment belonging to an expired unpaid `pending_payment` booking.
2. v02 considers Low 4a free and selects it.
3. The insert trigger considers the old booking active.
4. The insert fails with SQLSTATE `23P01`, `table_assignment_overlap`.
5. The event booking receives an exception rather than falling through to another table.

This was reproduced by adding the production overlap predicate to the harness.

The future table-booking v06 insert will have the same selection-versus-enforcement mismatch unless the
triggers are updated.

Proposed fix:

Create a migration that updates both integrity functions to use the shared liveness predicate for:

- the booking receiving a new assignment;
- every conflicting existing assignment;
- event communal allocation checks.

Use transaction-stable `now()` so selection and enforcement see the same time.

Required tests:

- selection followed by insert for every liveness state;
- expired unpaid hold permits insert;
- expired paid hold rejects insert;
- two real concurrent transactions still cannot double-book the table.

### F9. P1: lowering outside capacity bypasses the required re-cost workflow

Files:

- `supabase/migrations/20260801000500_table_booking_settings_rpc.sql:56`
- `supabase/migrations/20260801000500_table_booking_settings_rpc.sql:287-293`
- `supabase/migrations/20260801000300_outside_reservations.sql:23-39`
- `tasks/table-prioritisation-plan-2026-07-27.md:186-188`

`outside_table_capacity` is saved through the generic settings loop. Lowering it does not inspect or
re-cost future outside reservations.

Concrete failure:

1. A future party of eight reserves one outside table at basis eight.
2. A manager lowers capacity to six.
3. The RPC updates only `system_settings`.
4. The existing booking still consumes one table, although it now needs two under the new configuration.
5. The venue can accept later bookings using capacity that the re-cost workflow should have reserved.

Proposed fix:

Until the re-cost workflow exists, reject capacity decreases in the generic settings RPC.

The final dedicated workflow should:

1. acquire the venue allocation lock;
2. identify every affected live future outside booking;
3. calculate its new table cost;
4. confirm all existing promises still fit;
5. either commit every revised reservation atomically or return the affected bookings without changing
   the setting;
6. write one audit record containing the old setting, new setting, and every changed reservation.

Capacity increases can remain a simple settings update.

### F10. P2: a preferred joined-table selection is ignored

File:

- `supabase/migrations/20260801000700_allocation_candidates.sql:246-264`
- `supabase/migrations/20260801000700_allocation_candidates.sql:301-309`

`p_preferred_table_ids` affects single-table ranking only. Combination ranking ignores it.

Concrete failure:

- staff select Low 4a + Low 4b for a party of seven;
- both tables are valid and free;
- current result: Dining Room 4a + 4b is rank 1 and the selected Low pair is rank 2;
- wrong outcome: the create flow may save different tables from the ones staff chose.

Proposed fix:

1. Normalize preferred IDs with distinct ascending UUID order.
2. If the exact preferred set is a valid candidate, promote that exact set ahead of normal ranking.
3. Revalidate it inside the allocation lock.
4. If it was lost, return the planned stable 409 rather than silently choosing another table.

Required tests:

- preferred valid single;
- preferred valid pair;
- preferred invalid pair;
- preferred pair lost between preview and locked insert.

### F11. P2: purpose changes are not safe without an atomic edit path

File:

- `supabase/migrations/20260801000200_booking_allocation_columns.sql:30-64`

The migration marks future drinks bookings as soft and adds a constraint that soft assignments must be
drinks.

Two opposite failures are possible:

- drinks to food: changing only `booking_purpose` fails the constraint unless `assignment_soft` is cleared
  in the same statement;
- food to drinks: changing only `booking_purpose` succeeds but leaves `assignment_soft = false`, so the
  drinks booking remains hard and can block later food bookings.

The booking may also remain on a table chosen using the old purpose order.

Proposed fix:

Purpose changes must go through the planned atomic edit RPC. Under the allocation lock it should:

1. validate or reallocate the current table set using the new purpose;
2. set `assignment_soft = true` for drinks and false for food;
3. preserve or reject pins according to the approved pin rules;
4. update the booking and assignments in one transaction;
5. audit the purpose, soft state, and table changes together.

To keep the foundation migration truly inert, either:

- deploy this constraint with the atomic edit RPC and migrated callers, or
- prove that no current route can edit purpose before leaving the constraint in the earlier migration.

### F12. P2: the event function fingerprint preflight does not guard anything

Files:

- `supabase/migrations/20260801000800_event_communal_allocation_v02.sql:24-36`
- `tasks/artefacts/2026-07-27/baseline.md:73-89`

The migration calculates the live v01 MD5 but never compares it with an expected value. If v01 is absent,
it raises only a notice and still creates v02.

The baseline says every touched function is fingerprinted, but it contains no
`allocate_event_communal_seats_v01` entry.

Concrete failure:

1. production v01 changes after this branch was written;
2. the migration computes the new MD5;
3. no comparison occurs;
4. the stale copied implementation is installed as v02;
5. the production change is silently dropped from the new path.

Proposed fix:

- capture the exact production v01 fingerprint and add it to the baseline;
- find the function by exact signature, not only name;
- `RAISE EXCEPTION` when missing or mismatched;
- include expected and actual MD5 in the error;
- add a migration test that deliberately changes v01 and proves the migration aborts.

Current source comparison result:

Apart from the intended priority order and liveness predicate, no other behaviour was dropped from the
repository v01 definition. The problem is that the migration does not prove production still matches that
definition.

### F13. P2: the table-attribute preflight does not prove the floor is unchanged

File:

- `supabase/migrations/20260801000000_table_attributes.sql:14-41`
- `supabase/migrations/20260801000000_table_attributes.sql:47-54`
- `supabase/migrations/20260801000000_table_attributes.sql:134-177`

The preflight checks only that the expected UUIDs exist. It does not reject:

- extra tables;
- changed capacities;
- changed `is_bookable` values;
- a UUID now representing different table metadata.

Concrete failure:

1. a new bookable table is added before deployment;
2. all expected UUIDs still exist, so the preflight passes;
3. the new table receives generic defaults: priority 100, accessible, standard height, high-chair capable;
4. the post-check accepts priority 100 as real;
5. the allocator can use the new table with attributes nobody approved.

Proposed fix:

Compare the complete expected baseline in both directions:

- expected rows missing from production;
- unexpected rows present in production;
- mismatched number, name, capacity, and bookable state.

Abort and require a new explicit backfill when the floor has intentionally changed.

### F14. P3: rejected reason rows are incomplete

File:

- `supabase/migrations/20260801000700_allocation_candidates.sql:210-214`
- `supabase/migrations/20260801000700_allocation_candidates.sql:246-264`
- `supabase/migrations/20260801000700_allocation_candidates.sql:327-330`

Capacity and minimum party size are excluded from `scored.reason`. They are later used only to filter
singles. A table failing one of these checks disappears rather than returning a reason row.

Concrete failure:

- Big Bay is the only bookable table;
- party size is seven;
- expected explanation: `too_large_for_table`;
- actual output: no Big Bay row at all.

The ranked rows and current reason rows do not collide because reason rows have `rank = NULL`. The problem
is missing explanations, not collision.

Proposed fix:

- return `too_large_for_table` and `below_table_minimum` for rejected single candidates;
- keep separate hard eligibility for combination members so a small table is not rejected merely because
  it cannot hold the whole party alone;
- document whether reason rows describe single-table suitability, combination suitability, or both.

## Liveness review

The predicate itself matches the stated business rule:

- cancelled and no-show bookings release resources;
- `left_at` releases resources;
- an expired unpaid pending hold releases resources;
- an expired paid hold remains live;
- confirmed bookings remain live regardless of payment state until status or `left_at` releases them.

Treating a confirmed refunded or partially refunded booking as live is correct if a refund is not itself a
cancellation. A goodwill or partial refund must not silently give the table away.

An expired `pending_payment` or `pending_card_capture` booking with refunded payment is released, because
the hold has expired and no completed payment protects it. That is also reasonable.

The main liveness defect is not the helper. It is that the production triggers and the new candidate/event
paths do not all use it.

The current self-test also does not meet the plan's stated every-status/every-payment-state matrix. Add a
generated 8 x 5 test, plus `left_at`, null hold, expired hold, unexpired hold, and boundary equality.

## Two opposed house orders

The static orders are internally consistent:

- food goes to the Dining Room first;
- drinks and events go to the bar first;
- best fit still wins before house order.

No finding is raised against those owner decisions.

The unsafe case is a purpose edit. A purpose change must re-run allocation using the new order and update
`assignment_soft` atomically, as described in F11.

The drinks-bump feature is not on this branch and was deliberately out of scope. Before activation, it
must still prove that:

- only drinks bookings move;
- pinned, seated, and protected bookings never move;
- the displaced drinks booking has a jointly valid alternative;
- the whole relocation plan commits or rolls back together.

## Settings RPC review

What is sound:

- the revision row is locked with `FOR UPDATE`;
- stale revisions return a clear failure;
- setting updates, revision bump, and audit insert are in one database transaction;
- an audit insert failure rolls back the settings change, so the audit row cannot be silently lost;
- service-role-only execution is appropriate for the planned route-level permission check.

What must change:

- F1 validation defects;
- F9 outside-capacity workflow;
- partial updates must be validated against merged stored state;
- all writers must use this RPC or also bump the same revision. Direct writes to `system_settings` bypass
  optimistic concurrency;
- the function is declared `IMMUTABLE` even though it reads `system_settings`. It should be `STABLE`, or
  the state-dependent cross-field merge should move into the locked write function.

## Migration safety review

What is sound:

- new feature flags ship false;
- new tables have RLS enabled;
- production default privileges give `service_role` table access, while RLS blocks normal roles because
  no anon/authenticated policy is added;
- the outside reservation has a unique booking key and stores its capacity basis;
- `NOT VALID` is reasonable for rules that should apply to new writes without failing on historical rows;
- migrations are wrapped in transactions.

What must change:

- event MD5 guard, F12;
- exact floor preflight, F13;
- purpose-edit compatibility, F11;
- trigger liveness parity, F8;
- outside-capacity decrease safety, F9.

One additional invariant needs alignment:

`table_bookings_pin_requires_indoor` proves only that `is_outside_seating = false`. It does not prove an
assignment exists. The specification says an unassigned booking cannot be pinned. Enforce that in the
atomic pin RPC or with a deferred constraint trigger that can inspect assignments.

## Test harness review

The command `./tests/sql/run.sh` passes.

It does not give production-level confidence because the harness omits or simplifies important behaviour:

1. It does not install the production table-assignment or event-allocation integrity triggers. This hides
   F8.
2. Its private-booking function is a direct fixture lookup. It does not model table areas, venue spaces,
   booking statuses, overnight normalization, or the 30-minute buffer.
3. Its event-booking liveness stub treats nearly every non-cancelled status as active. Production accepts
   only confirmed and unexpired pending-payment bookings.
4. It has no settings RPC tests.
5. It has no migration drift/fingerprint tests.
6. It does not test the complete party-size grid.
7. It has no real concurrent transactions.

Proposed harness fix:

- use production-compatible DDL for the relevant tables and constraints;
- include the real integrity trigger definitions;
- either include the real private-booking dependencies or build a faithful fixture-backed version with
  the same status, area, buffer, and overnight semantics;
- install a real v01 event allocator and prove the fingerprint guard;
- add a second test process for concurrency cases.

Minimum new SQL cases:

- all party sizes 1 to 40;
- every status/payment liveness combination;
- walk-in holds for singles and joins;
- maintenance overlap and overnight windows;
- cancelled event allocations;
- staff-selected combinations;
- nine-table party of 40;
- A-C-B bridge topology;
- invalid settings payloads;
- selection followed by the real insert trigger.

## Backtest review

The current backtest should not be used for approval.

### It is stale

It was produced before the later commits reversed the food order. It says:

- Dining Room usage falls from 71 to 16;
- High 4 becomes the default;
- selected parties of seven and eight move to the Low pair.

The final branch instead sends food bookings to the Dining Room first and its current SQL tests expect the
Dining Room pair for parties of seven and eight.

The zero-refusal result therefore does not prove the final branch.

### It is not reproducible from committed files

The exporter writes `/tmp/replay_data.sql`, but:

- no anonymized replay fixture is committed;
- `tests/sql/run.sh` never loads replay data;
- there is no committed `replay_source` schema or replay algorithm;
- the report does not record a fixture checksum or exact branch commit.

### It uses final status, not historical state

The exporter removes bookings whose current status is cancelled or no-show.

That does not recreate the diary as it stood when each later booking was made. A booking may have occupied
a table when another booking was accepted and then been cancelled days later. Removing it from the whole
replay understates historical occupancy.

### “All online” is not always pessimistic

Applying online minimums can preserve larger tables for later large parties. That may reduce refusals
rather than increase them. Online holds also change fragmentation. The all-online scenario is a useful
stress case, but it is not mathematically guaranteed to be the worst case.

### Proposed replacement

Commit an anonymized replay fixture containing:

- booking ID;
- created time;
- service date and time;
- original channel/source;
- party size and purpose;
- high chairs and accessibility;
- outside flag;
- cancellation/no-show/release time where known;
- original assignment for comparison.

Then run two named scenarios:

1. **Historical-channel replay:** use each booking's real channel and release resources at the recorded
   historical time.
2. **All-online stress replay:** deliberately force online rules, clearly labelled as a stress scenario
   rather than a worst-case proof.

Both scenarios must:

- run against the final branch;
- use the final priorities;
- apply holds over the replay service dates;
- record the branch commit and fixture checksum;
- fail the test command if any replayed booking is unexpectedly refused;
- report refusals, table changes, purpose changes, and maximum remaining joined capacity.

## Proposed implementation order

1. Fix typed settings validation and block unsafe outside-capacity decreases.
2. Correct full-window maintenance handling.
3. Separate single and combination hold eligibility.
4. replace the recursive combination search with complete canonical subset enumeration.
5. apply event-booking liveness to communal rows.
6. update both integrity triggers to use shared liveness.
7. add maintenance checks to the event allocator.
8. support exact preferred combinations.
9. make purpose edits atomic.
10. repair migration fingerprints and exact floor preflights.
11. upgrade the harness.
12. rerun and commit the backtest evidence.

## Activation gate

Do not turn on any v06 feature flag until all of these are true:

- every P0 and P1 finding above is fixed;
- the production-compatible SQL harness passes;
- selection followed by insert is proven for each liveness state;
- the full 1-to-40 party-size matrix passes;
- the final-priority backtest is reproducible and rerun;
- the event v01 fingerprint matches at migration time;
- outside capacity decreases cannot bypass re-costing;
- purpose edits use the atomic path;
- two concurrent transactions cannot take the last table or outside slot.

## Review conclusion

The branch has a good core direction and the two owner-approved orders are represented clearly. The main
work is not a redesign. It is making the shared primitive complete, ensuring every enforcement path agrees
with it, and replacing optimistic evidence with tests that reproduce production behaviour.

No production or application code should be changed until the build developer agrees the proposed fixes
and activation gate above.
