# Adversarial review prompt: `feat/table-allocation-v06`

Hand this to Codex verbatim.

---

You are performing an adversarial code review of a **partially complete** feature branch in
`/Users/peterpitcher/Cursor/OJ-AnchorManagementTools`.

Branch: `feat/table-allocation-v06`, 4 commits on top of `36001722`.
**Nothing on this branch has been applied to production.** It is SQL and tests only, no application
code yet.

## What the branch is for

The Anchor is a 10-table country pub. Table selection currently happens in one database function,
`create_table_booking_v05`, and its ordering is:

```sql
ORDER BY t.capacity ASC, COALESCE(t.name, t.table_number) ASC
```

The tie-break is the table's **name**, so the seating order of the pub is alphabetical by accident.
Two consequences drove this work:

1. Every party of four or fewer was sent to Dining Room 4a first, and every party of seven or eight
   took the two Dining Room four-tops rather than the identical pair of Low tables. The Dining Room is
   the only run of tables that joins to 26 seats, so it was being consumed by couples.
2. The allocator contains **zero** references to `is_table_blocked_by_private_booking_v05`. The insert
   trigger does check it and raises `23P01`. So when a private function holds the Dining Room, the
   allocator picks a blocked table, the insert fails, and the whole booking returns `no_table` instead
   of falling back to the free Main Bar tables. Verified live: `position(...) > 0` returns false.

## What is on the branch (in scope for your review)

Eight migrations, `supabase/migrations/20260801000000` through `20260801000800`:

- `000000_table_attributes` : adds `priority`, `bar_priority`, `min_party_size`, `step_free`,
  `standard_height`, `high_chair_capable`, `heated` to `tables`, backfilled by UUID.
- `000100_table_holds` : new `table_holds` table (walk-in holds and maintenance blocks), seeded.
- `000200_booking_allocation_columns` : `table_pinned`, `assignment_soft`, `requires_accessible_table`.
- `000300_outside_reservations` : durable outside cost and capacity basis per booking.
- `000400_allocation_settings` : new settings keys and five feature flags, all shipped false.
- `000500_table_booking_settings_rpc` : settings read/write with per-section revision concurrency,
  server-side validation and an audit row in the same transaction.
- `000600_booking_liveness_helpers` : `is_booking_live`, `windows_overlap`.
- `000700_allocation_candidates` : `find_table_allocation_candidates`, the shared side-effect-free
  table picker that every path will eventually call.
- `000800_event_communal_allocation_v02` : event communal seating, reordered.

Plus `tests/sql/` (harness, 40+ behavioural assertions, runner) and `scripts/export-booking-replay-fixture.ts`.

Run the tests with:

```bash
./tests/sql/run.sh
```

It needs Docker. It creates a throwaway Postgres, applies the harness schema and the eight migrations,
runs the assertions, and destroys the container. It touches nothing else. **Note there is a local
Supabase stack running on this machine belonging to a different project (BARONS-BaronsHub). Do not
touch it. This repo has no `supabase/config.toml` and `supabase start` will fail.**

## The design, so you can attack the reasoning and not just the syntax

**Two opposed house orders on one floor**, both owner decisions:

| Purpose | Column | Order |
|---------|--------|-------|
| Food table bookings | `tables.priority` | Dining Room first (that is where diners should eat), High 4 last |
| Drinks bookings and events | `tables.bar_priority` | Bar first, Dining Room only as overflow |

Ranking for a single table: `capacity ASC, priority ASC, table_number::int ASC`. Best fit first, so no
seat is wasted when a perfect fit exists; the house order breaks ties inside a capacity band.

Ranking for a combination: `table_count ASC, total_capacity ASC, worst_member_priority ASC,
canonical_uuid_array ASC`.

Other rules the picker enforces: private-booking blocks, communal event allocations, maintenance
blocks, walk-in holds (online channel only, released 24 hours before the sitting), minimum party size
(online only, also released), step-free plus standard-height when an accessible table is requested,
and high-chair capability.

## Verified production facts, so you do not re-derive them wrongly

All checked against the live database on 2026-07-27, project `tfcasgxopxegwrabvwat`:

- `table_bookings.payment_status` is the enum `payment_status` =
  `pending | completed | failed | refunded | partial_refund`. **There is no `paid`.** `paid` belongs to
  `parking_payment_status`, a different enum.
- `table_booking_status` = `pending_payment | confirmed | cancelled | no_show | completed |
  pending_card_capture | visited_waiting_for_review | review_clicked`.
- There are exactly **two** callers of the booking RPC in the whole codebase:
  `src/app/api/table-bookings/route.ts:251` and `src/app/api/foh/bookings/route.ts:1209`.
  `src/app/api/external/table-bookings/route.ts` does not exist.
- The floor: 10 bookable tables, 49 seats. The whole Dining Room (4a, 4b, 6a, 6b, 6c) is a fully
  connected 5-clique reaching 26 seats. Low 4a and Low 4b join only to each other. Big Bay, Small Bay
  and High 4 join to nothing.
- `table_join_links` stores some pairs in one direction only; the picker treats links as undirected.
- `tables.table_number` is **text**, so `'10'` sorts before `'2'` unless cast.
- Production migrations are applied with `db push`. MCP `apply_migration` has repeatedly caused
  migration-history drift on this project. If you want to argue otherwise, argue it, but know that is
  the established workflow here.
- Full baseline including function fingerprints: `tasks/artefacts/2026-07-27/baseline.md`.

## Owner decisions, verbatim, so you do not report them as unilateral changes

A previous reviewer flagged three "P0 blockers" that were simply decisions it had not been shown.
Do not repeat that. The register is in `tasks/table-prioritisation-spec-v2-2026-07-27.md` section 1.
The ones most likely to look wrong:

- **"Leave the walk in tables as 4a and high 4, bookings take priority."** Low 4a and High 4 are held
  from online sale. This was chosen after being advised against on accessibility grounds.
- **"I want the high 4 to be lowest priority. I want the dining room tables to be top priority... dining
  room bookings should be lowest priority for event bookings."**
- **"anyone booking for drinks should be put onto non-dining room tables first, then overflow to the
  dining room after."**
- **"they should keep their tables unless someone else is booked."** Drinks bookings are assigned but
  soft, meaning a food booking may relocate one that has a valid alternative.
- **"All tables are step free except the small bay."** and **"The high 4 can't use a high chair either."**
- **"Staff maximum is 40."**

## What is deliberately NOT on this branch

Do not report these as omissions. Report only if you think the branch is unsafe **without** them:

`create_table_booking_v06` itself and its public/staff split; the availability function; migrating the
two RPC callers; the settings page UI; the FOH and BOH screens; the website
(`/Users/peterpitcher/Cursor/OJ-The-Anchor.pub`); monitoring. The plan is
`tasks/table-prioritisation-plan-2026-07-27.md`.

Also out of scope by decision: `tables.is_active` cleanup, booking-reference collision retry, visual
floor plan, guest allergy tags, and tightening the pre-existing `anon`/`authenticated` execute grants
on the booking function.

## What I want from you

Attack it. Specifically:

1. **Correctness of `find_table_allocation_candidates`.** Read it line by line. It is the heart of the
   change and everything else will call it. I already found and fixed one bug in it where the capacity
   check rejected every table for a party of seven so no combination could form. Find the next one.
   Pay attention to: the recursive combination search and whether it can miss a valid combination or
   enumerate one twice; the `v.id > w.last_id` pruning; the `w.cap < p_party_size` growth condition;
   whether combinations rank correctly against singles; NULL handling; and whether the reported
   `reason_code` rows can ever collide with the ranked rows.
2. **Whether the two opposed orders can produce a pathological outcome** that the tests do not cover.
   For example a drinks booking and a food booking competing for the same table, or a purpose change on
   an existing booking.
3. **The liveness predicate.** Is `is_booking_live` right for every combination of the eight booking
   statuses and five payment statuses? Is treating `refunded` as still live correct?
4. **Migration safety.** Preflights, post-checks, idempotency, constraint ordering, `NOT VALID`
   constraints, RLS on the new tables, grants, and whether any of these can fail on real production data
   that the throwaway harness does not reproduce.
5. **The settings RPC.** Validation completeness, the revision-based concurrency, whether the audit row
   can be lost, and whether a manager can put the venue into a state where nothing can be booked.
6. **The event allocator v02.** It was rewritten from the live v01. Diff it against the live definition
   (fingerprint `md5` is in the baseline artefact) and tell me if any behaviour was dropped.
7. **The test harness itself.** `tests/sql/harness-schema.sql` is a stand-in for the real schema. Where
   does it differ from production in a way that would let a real bug pass? The
   `is_table_blocked_by_private_booking_v05` stub in particular is much simpler than the real function.
8. **The backtest.** `tasks/table-prioritisation-backtest-2026-07-27.md` claims zero refusals across 139
   real bookings. Is the methodology sound, or is it flattering itself? It replays in creation order
   with new turn times and forces every booking onto the `online` channel.

Be specific. Cite file and line. For each finding give a concrete failure scenario: inputs, state,
and the wrong output. Rank by whether it would actually cause a customer to be refused a booking, a
double booking, or a member of staff to lose trust in the screen.

If something is fine, say so briefly rather than padding. I would rather have six real findings than
forty defensible ones.
