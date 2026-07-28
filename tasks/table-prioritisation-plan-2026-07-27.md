# Table prioritisation: implementation plan (revision 2)

Date: 2026-07-27. Status: **corrected after review, ready for re-review.**
Spec: `tasks/table-prioritisation-spec-v2-2026-07-27.md`.
Review: `tasks/table-prioritisation-plan-review-2026-07-27.md`.
Disposition: `tasks/table-prioritisation-plan-review-response-2026-07-27.md` (8 of 11 P0s accepted and
fixed here, 3 rejected with evidence).

**Baseline.** AMS `e8d725a4`, website `197ef06d`, Supabase `tfcasgxopxegwrabvwat`, migration history
through `20260731000600`. New migrations start at `20260801000000`.

**Estimate.** 24 to 32 working days. Revised up from 18 to 24 after the review; the original number did
not survive contact with the detail.

---

## Verified facts that changed the plan

Checked at the pinned commit and against production, not assumed.

| Fact | Consequence |
|------|------------|
| **Only two callers of the booking RPC exist**: `src/app/api/table-bookings/route.ts:251` and `src/app/api/foh/bookings/route.ts:1209`. `src/app/api/external/table-bookings/route.ts` does not exist | Stream D shrinks. The old D2 is deleted |
| `table_bookings.payment_status` is enum `payment_status` = `pending, completed, failed, refunded, partial_refund`. There is **no `paid`** | The liveness predicate uses `completed` |
| `table_bookings.seated_at` exists | The bump rule's "already seated" guard is implementable |
| `create_table_booking_v05_core`, `_core_legacy`, `_core_sunday_deposit_legacy` exist in the generated types | Must be checked for live callers before stream B |
| Production migrations are applied with `db push`. MCP `apply_migration` has repeatedly caused history drift here, most recently 2026-07-23 | `db push` stands |

---

## Dependency map

```
A  Foundations (additive schema, new settings only)
│
├── B  Primitive + public/staff function split   ── depends on A
│   ├── C  Availability                          ── depends on B
│   │   └── G  Website                           ── depends on C (contract frozen at B4)
│   ├── D  Caller migration, behind a route gate ── depends on B
│   │   └── F  Staff surfaces                    ── depends on D
│   └── E  Settings page                         ── depends on A, preview needs B
│
├── H  Tests            ── alongside B to G, gates I
└── I  Deployment       ── depends on everything
```

---

## Stream A. Foundations (4 to 5 days)

Additive and **behaviourally inert**. Seeds only keys that do not exist; it never rewrites a live setting.
The kitchen pacing change from today's 19/14 to 15 happens at activation (I6), not here.

- [ ] **A1. Baseline artefact.** Capture to `tasks/artefacts/2026-07-27/`: the definitions, ACLs, owner,
      `prosecdef` and `proconfig` of `create_table_booking_v05` and its three `_core*` variants,
      `enforce_booking_table_assignment_integrity_v05`, `is_table_blocked_by_private_booking_v05`, both
      `move_*_v05` functions; the full `tables` grid **with UUIDs**; `table_join_links` contents; every
      live table-booking setting with its current value; and counts of future outside and drinks bookings.
      *Done when:* the artefact directory is committed and dated.

- [ ] **A2. `20260801000000_table_attributes.sql`.** Add `priority`, `min_party_size`, `step_free`,
      `standard_height`, `high_chair_capable`, `heated` to `tables`. Check constraint
      `min_party_size between 1 and capacity`. Backfill **by UUID from A1**, with a preflight that aborts
      if any expected id is missing.

      | Table | priority | min_party | Attributes |
      |-------|---------|-----------|------------|
      | High 4 | 10 | 1 | `standard_height=false`, `high_chair_capable=false` |
      | Low 4a | 20 | 1 | |
      | Low 4b | 30 | 1 | |
      | Small Bay | 40 | 1 | `step_free=false` |
      | Big Bay | 50 | 4 | |
      | Dining Room 4a | 60 | 1 | |
      | Dining Room 4b | 70 | 1 | |
      | Dining Room 6a | 80 | 4 | |
      | Dining Room 6b | 90 | 4 | |
      | Dining Room 6c | 100 | 4 | |
      | Electric Cupbard, High 2 | 999 | 1 | not bookable |

- [ ] **A3. `20260801000100_table_holds.sql`.** `table_holds` per spec section 7, with `ends_on`
      **nullable** for open-ended walk-in holds, a `scope` column (`table` or `outside_all`) so a weather
      closure is representable, and `status` (`pending`, `active`, `cancelled`) so a maintenance block
      cannot go active while conflicting bookings remain. RLS on, service-role write only.
      Seed the two approved walk-in holds: **Low 4a and High 4**, open-ended, all services.

- [ ] **A4. `20260801000200_booking_allocation_columns.sql`.** Add `table_pinned`, `assignment_soft`,
      `requires_accessible_table` to `table_bookings`. Constraints: `assignment_soft` only where
      `booking_purpose='drinks'`; `table_pinned` only where an indoor assignment exists. Backfill
      `assignment_soft` for live future drinks bookings, reporting the **apply-time count** for approval
      rather than asserting a number from discovery.

- [ ] **A5. `20260801000300_outside_reservations.sql`.** New table `outside_reservations`:
      `table_booking_id`, `tables_reserved int`, `capacity_basis int`, `starts_at`, `ends_at` (occupancy,
      including the turnaround gap), with positivity constraints. Backfill from live future outside
      bookings at `capacity_basis = 8`. Replaces the two columns in the previous revision.

- [ ] **A6. `20260801000400_allocation_indexes.sql`.** `booking_table_assignments (table_id,
      start_datetime, end_datetime)`, `table_bookings (booking_date, status) where left_at is null`,
      `table_holds (table_id, starts_on, ends_on) where status='active'`,
      `outside_reservations (starts_at, ends_at)`. Benchmark B-tree against a generated `tstzrange` plus
      GiST on realistic data and keep whichever wins.

- [ ] **A7. `20260801000450_allocation_settings.sql`.** Insert **new keys only**, `ON CONFLICT DO
      NOTHING`: turn times, Sunday uplift, turnaround gap, release lead hours, drinks arrivals ceiling,
      bump toggle and protection window, outside table count and capacity, online and staff party
      maximums, the seven public reason messages, and the feature flags:
      `table_allocation_v06_enabled` (false), `turn_times_enabled`, `holds_enabled`,
      `accessibility_filter_enabled`, `drinks_bump_enabled`, all false.
      **Does not touch** `kitchen_pace_covers_*` or `kitchen_walk_in_reserve_*`. Those change at I6.

- [ ] **A8. `20260801000500_settings_rpc.sql`.** `settings_revision` table, one row per section, with
      `get_table_booking_settings()` and `set_table_booking_settings(section, payload, expected_revision,
      actor_id)`. Whole section written and audited in one transaction. Server-side range and cross-field
      validation. `service_role` execute only.

**Stream A gate:** applied to production, `select` proves nothing behaves differently, both repositories
lint, typecheck, test and cold-build green.

---

## Stream B. Allocation core (8 to 10 days)

- [ ] **B1. `20260801000600_liveness_helpers.sql`.** `is_booking_live(status, left_at, hold_expires_at,
      payment_status)` and a shared half-open overlap predicate.
      **Liveness:** `status NOT IN ('cancelled','no_show')` AND `left_at IS NULL` AND NOT (an expired hold
      in `pending_payment`/`pending_card_capture` whose `payment_status <> 'completed'`).
      `refunded` and `partial_refund` bookings stay live while their status is live: only `status` releases
      a table.
      *Done when:* a test asserts every one of the eight `table_booking_status` and five `payment_status`
      values, and the function compiles against the real enums.

- [ ] **B2. `20260801000700_allocation_candidates.sql`.** `find_table_allocation_candidates` with the
      **complete** typed signature:

      ```
      p_start_at, p_end_at, p_party_size, p_purpose, p_outside,
      p_high_chair_count int, p_requires_accessible_table boolean,
      p_preferred_table_ids uuid[], p_max_party_size int,
      p_channel text, p_exclude_booking uuid,
      p_overrides table_allocation_overrides   -- typed composite, not jsonb
      ```

      Validity per spec 3.2 including the accessibility and high-chair filters. Ranking per spec 3.3.
      Undirected join links, `table_number` cast to integer for sorting, canonical UUID array tie-break.
      Returns every candidate, valid ones ranked, invalid ones with an internal reason.
      *Done when:* party sizes 1 to 26 on an empty room reproduce the expected grid, and a party of 7
      returns Low 4a + Low 4b ahead of Dining Room 4a + 4b.

- [ ] **B3. Turn times helper.** Customer duration to `table_bookings.end_datetime`; occupancy duration
      (customer plus gap) to `booking_table_assignments.end_datetime` and to
      `outside_reservations.ends_at`. Gated by `turn_times_enabled`.

- [ ] **B4. Freeze the availability contract.** Committed JSON Schema plus example payloads for
      available, tables full, kitchen full, outside full, closed, too late, too large, unknown, and a
      whole-date `calculation_state` of `unknown` with no slot list. Generate TypeScript types from the
      one schema for both repositories, compared by hash in CI. **Blocks stream G, do it first.**

- [ ] **B5. `20260801000800_booking_core_v06.sql`.** The shared internal core. Built by diffing A1.
      Takes `p_max_party_size` as a parameter rather than hard-coding 21, so the guard follows the caller.
      Preserves every rule listed in spec section 6. Not granted to anyone directly.

- [ ] **B6. `20260801000900_booking_public_and_staff_v06.sql`.** **The security fix for review F-04.**

      | Function | Parameters | Grants |
      |----------|-----------|--------|
      | `create_table_booking_public_v06` | the 13 existing `v05` parameters only; channel hard-coded `online`; no pin, no overrides; `p_max_party_size` from the online setting | `postgres, anon, authenticated, service_role` |
      | `create_table_booking_staff_v06` | adds `p_channel`, `p_pin`, `p_overrides`, `p_actor_id`, `p_override_reason`; `p_max_party_size` from the staff setting | `postgres, service_role` only |

      Both `SECURITY DEFINER`, owner `postgres`, `search_path=public`, `REVOKE ALL FROM PUBLIC` first.
      Authority is proven at the AMS route boundary by the existing RBAC check, **never by a parameter**.
      `p_overrides` is a typed composite; unknown keys are impossible by construction.
      Audit rows are written inside the same transaction using `p_actor_id`.
      *Done when:* a direct `anon` RPC call cannot set a channel, a pin or an override, proven by test.

- [ ] **B7. Venue-level locking.** **The fix for review F-08.** One
      `pg_advisory_xact_lock(hashtext('table_alloc'))` for the whole venue, taken **before** selection,
      replacing the per-date key. At 3.6 bookings a day contention is nil, and cross-midnight and
      cross-date races disappear rather than being ordered around. High chairs keep their existing global
      lock, taken second.

- [ ] **B8. Drinks bump.** Gated by `drinks_bump_enabled`. Bounded per review F-18: **at most 2 bookings
      moved**, deterministic search order, the whole relocation plan computed **without writes**, then
      validated as jointly conflict-free, then committed atomically with its audit rows. Never a pinned,
      seated, or within-protection-window booking. Never a food booking. Never cascading.

- [ ] **B9. Outside capacity.** Enforced against `outside_reservations` under the venue lock.
      **Lowering capacity re-costs every affected future booking** and either reallocates it or surfaces
      it for cancellation. Acknowledgement alone is not accepted (review F-09).

- [ ] **B10. `20260801001000_availability_v06.sql`.** `check_table_availability_v06`, whole-date, calls
      B2 per slot in one query. Returns the B4 contract with **public reason codes and resolved message
      text**. `service_role` only.
      **Availability does not model bumping** (review F-19): a slot needing a bump reads unavailable, and
      creation may still succeed. False-unavailable is safe; false-available is what we are fixing.
      *Done when:* two separate tests pass. Dining Room blocked by a private booking with Main Bar free
      returns **available with a Main Bar table**. Dining Room blocked with all other valid tables
      occupied returns `tables_full`.

- [ ] **B11. `20260801001100_move_rpcs_v06.sql`.** `move_table_booking_assignments_v06` and
      `move_table_booking_time_v06` on B2. Pin rules per review F-25: **an authorised manual move is
      allowed and keeps the pin**; automatic reallocation and conflicting time or party-size edits are
      refused.

- [ ] **B12. `20260801001200_boh_edit_rpc.sql`.** Atomic booking-plus-assignment window edit.

- [ ] **B13. Date-range availability summary.** Bounded endpoint for the month view (review F-29).

**Stream B gate:** H1 to H4 green, normalised parity fixtures green, direct-RPC privilege test green.

---

## Stream C. Availability in AMS (2 days)

- [ ] **C1.** Rewire `GET /api/table-bookings/load` to `check_table_availability_v06`. Accept
      `party_size`, `purpose`, `outside`, `requires_accessible_table`. Versioned envelope carrying old and
      new shapes, with precedence and a sunset criterion based on observed client usage, not elapsed time.
- [ ] **C2.** Strip internal reason codes at the boundary. A private-booking block leaves AMS as
      `tables_full` and is logged as `table_private_block`.
- [ ] **C3.** Remove fail-open. Degraded responses use `calculation_state`, with whole-date unknown and no
      slot list as a valid shape (review F-21).
- [ ] **C4.** **Leave kitchen pacing arrival-based.** Add a regression test asserting a 120-minute booking
      at 18:00 contributes zero covers to the 19:00 pacing window, commented with a pointer to spec 2.1.
      Discovery finding 4.3 is withdrawn; do not "fix" it.
- [ ] **C5.** Public message endpoint or inline resolved text, per review F-28.

---

## Stream D. Caller migration (4 to 5 days)

**Every migrated caller keeps its old path behind a route-level gate** (review F-06). Nothing is deleted
until I9.

- [ ] **D1.** `src/app/api/table-bookings/route.ts:251` calls `create_table_booking_public_v06` when the
      gate is on, `v05` when off.
- [ ] **D2.** `src/app/api/foh/bookings/route.ts:1209` calls `create_table_booking_staff_v06`, with the
      route's existing RBAC check supplying `p_actor_id`.
- [ ] **D3.** FOH walk-in override. **A trusted walk-in mode is specified first** (review F-22): exactly
      which of the past-time, hours, cutoff and hours-not-configured guards it bypasses, how `seated_at`
      is set, and its deposit and pacing behaviour. The old raw-insert path stays until its parity
      fixtures pass.
- [ ] **D4.** `getMoveTableAvailability` in `src/lib/table-bookings/move-table.ts` delegates to B2.
- [ ] **D5.** BOH party-size. **Preserves `updateTableBookingPartySizeWithLinkedEventSeats`, the deposit
      threshold transitions and the SMS** (review F-24). Allocation is one part of the mutation, not all
      of it. Raise the schema's party cap only after the staff maximum is confirmed.
- [ ] **D6.** Customer manage link, `src/lib/table-bookings/manage-booking.ts`. Fixes the raw 500 and the
      silent third-table grab. Public path, so it uses the public function.
- [ ] **D7.** FOH time drag to `move_table_booking_time_v06`.
- [ ] **D8.** BOH window edit to B12.
- [ ] **D9. Grep sweep, before the stream starts not after.** Confirm live callers of
      `create_table_booking_v05` and its three `_core*` variants, `check_table_availability`,
      `check_and_reserve_capacity`, and the retired helpers. Mark each path live, dead, already-complete
      or unrelated. Correct the caller matrix in spec section 11.

---

## Stream E. Settings page (4 to 5 days)

**Split `TableSetupManager.tsx` first** (1400 lines today, review O-02): one page shell, one component and
API client per section.

- [ ] **E1.** Tables: priority via drag plus keyboard buttons and a visible number, minimum party size,
      four attribute toggles. Warn before a save that affects future bookings.
- [ ] **E2.** Turn times. **E3.** Kitchen pacing, relabelled "arrivals", derived ceiling shown live.
      **E4.** Outside seating, with the re-costing workflow from B9. **E5.** Drinks. **E6.** Party size
      limits. **E7.** Holds and blocks, including the pending-to-active maintenance workflow.
      **E8.** Customer messages. **E9.** Preview panel using B2.
- [ ] **E10. Permissions.** Add to `src/types/rbac.ts`, seed, **and assign to roles**:
      `table_bookings:pin` and `:block` to staff and above; `:override_minimum`, `:override_hold` and
      `:override_unjoined` to manager and above. Test both UI hiding and server enforcement.

---

## Stream F. Staff surfaces (4 to 5 days)

- [ ] **F1.** FOH floor screen: pin, per-table hold and block, and the join drag fix. **The schedule
      contract gains customer end and occupancy end separately**, with the gap shaded, so the floor stops
      showing the gap as guest time (review F-26). Update timeline rendering, drag maths and print sheets.
- [ ] **F2.** Create modals gain a table picker fed by B2, with `p_preferred_table_ids` validated **inside
      the allocation lock** and a clear 409 if it is lost (review F-23). Replaces the current
      best-effort post-create move.
- [ ] **F3.** Accessibility and high-chair fields on both create modals and on the floor screen.
      **Check what is already implemented first**: the review notes high-chair shortfall handling and
      outside messaging are substantially built already.
- [ ] **F4.** Booking detail: pin state, chosen-table reasoning, override history.
- [ ] **F5.** Staff large-party path and the `allow_unjoined_tables` override, with its warning.
- [ ] **F6.** Confirm the live component for every screen touched. This repository has dead duplicate
      `*Client.tsx` files.

---

## Stream G. Website (4 to 5 days)

Blocked on B4. Manual deploy. Uses the generated types from B4.

- [ ] **G1.** Availability route passes party size, purpose, outside and accessibility; returns the new
      state, public reason and resolved text.
      **Verified 2026-07-28**, `app/api/table-bookings/availability/route.ts`: the route already accepts
      `party_size`, but line 120 is `void searchParams.get('purpose')`, with a comment saying purpose is
      accepted "for backwards compatibility" and then discarded. Harmless today, wrong the moment food
      and drinks use different house orders, because the same slot can then be available for one and not
      the other. The route also builds its slot list **locally** from service windows plus a busyness
      figure (`buildSlotsWithKitchenState`), and line 89 tests `available_capacity >= partySize`, which
      is a covers number and not a table. The website never asks whether a table exists. This is the
      false-availability problem seen from the website side.
- [ ] **G2.** Remove the fail-open helper; render `calculation_state=unknown` as the call-us path.
- [ ] **G3.** Form re-requests availability on any change to party size, purpose, outside or
      accessibility. Unavailable slots greyed with the reason beneath.
- [ ] **G4.** Accessibility checkbox. No free-text reason prompt.
- [ ] **G5.** Date picker uses the B13 range summary, not one call per day.
- [ ] **G6.** Unheated outside disclosure, stronger October to April. **Check what already exists.**
- [ ] **G7.** Above the online maximum, route to the private-booking enquiry.
- [ ] **G8.** Submit re-check; 409 offers the nearest three alternatives.
- [ ] **G9.** Update `lib/table-booking-slot-window.ts` and `lib/table-booking-service-windows.ts`.
- [ ] **G10.** Booking agent path. **G11.** WCAG 2.2 AA pass. **G12.** Update
      `tests/api/table-bookings*.test.ts`.

---

## Stream H. Tests (runs alongside, 4 to 5 days of dedicated effort)

A traceability matrix from every requirement to a test is part of the deliverable.

- [ ] **H1.** SQL unit: party sizes 1 to 40, every minimum, join eligibility and ranking, the Low versus
      Dining Room pair at 7 and 8, accessibility and high-chair filters, unjoined staff allocation,
      determinism across repeated runs.
- [ ] **H2. Normalised parity**, not byte-identical (review F-32). Generated ids, references, timestamps
      and payment ids are excluded from equality but asserted for format and relationship. Everything else
      must match `v05` for requests touching no new feature: high chairs, outside, Christmas, Sunday
      lunch, deposits at 10 and over, every blocked reason, every hours edge, and **the public path still
      refusing 21**.
- [ ] **H3.** Liveness across all eight booking statuses and all five payment statuses, `left_at`, expired
      holds, completed-but-expired holds, and boundary equality at the turnaround edge.
- [ ] **H4.** Real concurrency in a disposable database: two bookings racing for the last table, two for
      the last outside table, **a race spanning midnight**, a create racing an edit, a bump racing a
      cancellation.
- [ ] **H5.** Direct-RPC privilege spoofing: an `anon` caller cannot reach staff behaviour.
- [ ] **H6.** Gate-off parity **for every route**, not just public create.
- [ ] **H7.** Blocks: private booking, communal event, maintenance pending and active, walk-in hold before
      and after release.
- [ ] **H8.** Time: Sunday, Sunday lunch, Christmas, both DST transitions, bookings crossing midnight.
- [ ] **H9. Availability-versus-create parity** in both directions, with false-unavailable-by-bump
      documented as the one accepted asymmetry.
- [ ] **H10.** Settings stale-write and audit. **H11.** Multi-booking bump plans and failure injection
      mid-move. **H12.** Outside re-costing and turnaround windows. **H13.** Purpose and indoor/outdoor
      conversions. **H14.** Migration rehearsal from the A1 baseline in a disposable environment.
      **H15.** Website component tests. **H16.** End to end. **H17.** Accessibility.
- [ ] **H18.** Performance: `EXPLAIN (ANALYZE, BUFFERS)` evidence plus p50/p95 targets for one date and a
      month range under realistic row counts.

---

## Stream I. Deployment (2 to 3 days)

- [ ] **I1.** Full pipeline green in **both repositories**: lint, typecheck, tests, and a **cold**
      `rm -rf .next && npm run build` on Node 20. A cached build has masked a real type error here before.
- [ ] **I2.** Migration rehearsal: restore the A1 baseline into a disposable database, apply
      `20260801000000` to `20260801001200` in order, run H14 and the smoke SQL.
- [ ] **I3.** Apply to production with `db push`, in file order. Verify ACLs before and after. Regenerate
      `src/types/database.generated.ts`.
- [ ] **I4.** Deploy AMS. Confirm Ready **and** that the production alias moved to the new commit.
- [ ] **I5.** Deploy the website with `vercel --prod` from a clean checkout. Confirm the alias moved.
- [ ] **I6. Shadow week** (review O-04). Gate off, sampled logging comparing `v05` and `v06` ranking and
      availability on real demand. Review the table distribution and refusal reasons before activating.
- [ ] **I7.** Staff briefing, named owner. Pinning, holds and blocks, the drinks bump, the large-party
      override, the accessibility flag.
- [ ] **I8. Activation.** Set the pacing keys to 15 with zero reserve **and** enable
      `table_allocation_v06_enabled` and the four feature flags, in one transaction, with the old pacing
      values captured first. **Monday or Tuesday only**, never before a Sunday service or a Wednesday
      evening.
- [ ] **I9.** Smoke test one real booking per channel, then cancel them.
- [ ] **I10.** Watch at end of day one, end of the first weekend, end of the first fortnight.
- [ ] **I11.** After a clean fortnight: remove the route gates, delete the old caller paths, and retire
      `v05`.

**Recovery ladder.** Change a setting. Disable one of the four feature flags (turn times, holds,
accessibility filtering, bump). Disable `table_allocation_v06_enabled`, which returns every route to its
old path because the old paths still exist until I11. Revert the AMS deployment. **Never revert the
migrations**; they are additive and reverting would delete holds, pins and outside reservations. Anything
created while the gate was on is reconciled by a named owner.

---

## Monitoring (build it, do not just list it)

- [ ] **M1.** Event schema and emitters for: availability results by state and reason; create attempts and
      every blocked reason; **availability-versus-create mismatches, split into false-available and
      false-unavailable**; chosen tables and combinations; pacing, outside and drinks refusals; bump
      events with both references; override use by actor; allocator p50 and p95.
- [ ] **M2.** Dashboard and alert thresholds, with a named owner who can disable a flag without a
      developer.
- [ ] **M3.** Verify data is flowing **before** I8.

**Success, defined precisely.** False-available count of zero (numerator: creates that failed with
`no_table` or `outside_full` after availability said available, excluding documented races; denominator:
all creates). Zero double bookings. Zero private-booking false refusals. Accepted-booking count per channel
per service compared against the four weeks before activation, not year on year.

---

## Owners

| Area | Owner |
|------|-------|
| Database and migrations | to assign |
| AMS application | to assign |
| Website | to assign |
| Product decisions | Peter |
| FOH training and readiness | to assign |
| Launch monitoring and flag control | to assign |

---

## Out of scope, recorded

`tables.is_active` cleanup; booking-reference collision retry; visual floor plan; guest allergy and VIP
tags; bar-zone capacity modelling; tightening the pre-existing `anon` and `authenticated` grants on the
public booking function.
