# Developer Review Report — Table Prioritisation Implementation Plan

**Reviewed document:** `tasks/table-prioritisation-plan-2026-07-27.md`  
**Related specification:** `tasks/table-prioritisation-spec-v2-2026-07-27.md`  
**Related earlier review:** `tasks/table-prioritisation-spec-review-2026-07-27.md`  
**AMS repository snapshot reviewed:** `e8d725a416e14c0f1d8fb1d0fe68d9b0f01ba7b2`  
**Website repository snapshot reviewed:** `197ef06de71377fb99e564edad322f9b45407007`  
**Review date:** 2026-07-27  
**Original plan changed:** No  
**Review scope:** technical correctness, confirmed scope, functional coverage, data, integrations, security, performance, accessibility, monitoring, migration, deployment, testing, delivery, and operational readiness

## 1. Overall assessment

**Readiness: not ready to execute.**

The plan is much stronger than the original specification. It introduces a shared candidate function, separates customer and occupancy duration, uses durable outside reservations, adds contract and concurrency tests, records a deployment gate, and covers staff and website work.

However, its `ready to execute` status is incorrect. The plan and its v2 specification record owner decisions that were not made, and one directly reverses the owner’s instruction:

- The owner chose **Low 4a and Low 4b** as held tables because High 4 is difficult for people with mobility issues. The plan uses Low 4a and High 4.
- The approved direction was for drinks bookings to be unassigned, with the ceiling changed to 40. The plan replaces that with a new assigned-table “bump” system without recorded approval.
- Accessibility attributes, an unheated-seasonal message, staff bookings up to 40, and unjoined-table overrides were added as if approved.

There are also serious technical blockers. The proposed `v06` grants allow callers to spoof staff channels and overrides, the liveness rule uses a payment enum value that does not exist, the feature gate cannot preserve current FOH walk-in behaviour after the old code is deleted, date-keyed locks do not protect cross-midnight races, and the deployment task does not actually include most new database functions.

The plan should be corrected and reviewed again before implementation. The private-booking fix should remain part of the single release, as the owner requested, but that does not remove the need for safe incremental development and dormant deployment.

### Strengths worth keeping

- Work is split into clear dependency streams.
- The repository and database baseline is named.
- Additive schema and a disabled activation gate are the right general rollout shape.
- The plan recognises that availability and creation must use the same candidate rules.
- Existing `v05` behaviour is intended to be captured before changes.
- Availability uses `available | unavailable | unknown`.
- Customer and assignment end times are separated.
- Outside resource cost is stored rather than always recalculated from current settings.
- BOH edits and multi-table moves are intended to become atomic.
- Accessibility requirements for the interfaces themselves are included.
- Real concurrency tests, production smoke tests, staff briefing, and monitoring are included.
- Recovery correctly avoids destructive migration rollback.

### Finding counts

| Classification | Count |
|---|---:|
| Confirmed issues | 40 |
| Optional improvements | 7 |
| P0 approval blockers | 11 |
| P1 issues | 23 |
| P2 issues | 6 |

## 2. Classification

- **Confirmed issue:** a contradiction, incorrect assumption, missing requirement, security fault, technical gap, or delivery problem that must be resolved for the affected scope.
- **Optional improvement:** useful simplification or hardening that is not required to make the core plan viable.
- **P0:** do not start implementation until resolved.
- **P1:** resolve before work on the affected stream starts.
- **P2:** resolve before production activation.
- **P3:** optional improvement.

### Evidence checked

| Evidence | Result |
|---|---|
| Owner’s seven answers in the review thread | Several are reversed or expanded in v2 and the plan |
| Original specification §1 and §8 | Drinks-unassigned was already a decision; the later answer only changes its ceiling to 40 |
| `tasks/table-prioritisation-spec-v2-2026-07-27.md` | Contains invented “resolved” decisions and internal technical contradictions |
| Current payment enum and table-booking code | Valid paid state is `completed`, not `paid` |
| Current `create_table_booking_v05` | Large existing contract; direct execute grants already broad |
| Current FOH create route | Walk-in fallback raw-inserts to bypass past/hours rules and seats immediately |
| Current BOH party-size route | Also manages linked event seats and deposit transitions |
| Current FOH schedule route | Displays assignment end as booking end, so a longer assignment will display the gap as guest time |
| Current website booking form | High-chair shortfall and outside messaging already have substantial implementation |
| Current route and file tree | Some plan paths do not exist or are named incorrectly |
| Project production migration guidance | Production uses the Supabase migration workflow, not the plan’s `db push` step |

## 3. Approval blockers

### F-01 — The held-table decision is recorded incorrectly

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Requirements / direct contradiction  
**Relevant section:** Header; A2; A6; B2; E7; Risks; spec v2 D7 and §7

**Description:** The owner explicitly said: “let’s hold Low 4a and 4b. The High 4 can be difficult for people with mobility issues.” The plan and v2 specification instead use Low 4a and High 4 and claim that choice was confirmed.

**Rationale:** This is not an interpretation issue. The documented choice is the opposite of the owner’s answer.

**Impact:** The implementation would hold the wrong table and ignore the stated mobility concern.

**Recommended action:** Replace Low 4a + High 4 with **Low 4a + Low 4b** everywhere. Remove claims that High 4 was selected. Re-evaluate the separate assumption that walk-in holds do not apply to joins, because that weakens what “hold Low 4a and Low 4b” means and was not approved.

**Suggested wording:** “Hold Low 4a and Low 4b for walk-ins, released 24 hours before the sitting. High 4 is not held because it may be unsuitable for guests with mobility needs.”

**Open questions:** Do the holds also exclude Low 4a + Low 4b from online joined-table allocation, or only from single-table allocation?

### F-02 — The drinks bump system reverses the approved direction

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Scope / product decision  
**Relevant section:** A4; A6; B7; E5; F staff surfaces; Monitoring; Risks

**Description:** The original confirmed decision was to keep drinks bookings but leave them unassigned until arrival. The owner’s fifth answer changed the proposed drinks ceiling from 20 to **40 per 30 minutes**. It did not approve keeping a table and automatically bumping drinks bookings. The plan introduces `assignment_soft`, a bump engine, a protection window, audits, staff UI, concurrency tests, and monitoring as if this were settled.

**Rationale:** This is a materially different customer promise and a large new optimisation feature.

**Impact:** The plan may deliver the wrong operating model and spends a large part of its 18–24 day estimate on unapproved work.

**Recommended action:** Restore the confirmed unassigned-drinks requirement and solve its physical capacity concern explicitly, or return to the owner with a clear choice between:

1. unassigned with a real concurrent bar/seating capacity model;
2. assigned and never moved automatically; or
3. assigned with the proposed bump rule.

Do not start B7, A4’s soft-assignment backfill, or related UI until this is approved.

**Open questions:** Is a drinks booking a guaranteed seat, guaranteed entry, or an arrival reservation? Does the owner accept automatic table movement before arrival?

### F-03 — Major accessibility and large-party features are presented as approved

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Scope control / unconfirmed assumptions  
**Relevant section:** A2; A4; A6; B2; E1; E6; F3; F5; G4; G6; G7; H1

**Description:** The plan adds:

- `step_free`, `standard_height`, `high_chair_capable`, and `heated`;
- a stored accessible-table requirement;
- an accessibility booking question;
- seasonal unheated-outside messaging;
- a staff maximum of 40;
- bookings over 26 across unjoined tables;
- an `override_unjoined` permission.

None of these decisions appears in the owner’s seven answers. The v2 document states that extra owner answers existed, but they are not present in the supplied decision record.

**Rationale:** These features affect data protection, customer wording, physical suitability, staff authority, and delivery scope.

**Impact:** Unapproved functionality can delay the urgent correctness release and create unsafe assumptions about the venue.

**Recommended action:** Move these items into a clearly marked proposed extension and obtain explicit owner confirmation. Until then, remove them from the critical path, estimates, schema, and `ready to execute` claim.

**Open questions:**

- Is Small Bay definitely the only non-step-free table?
- Is High 4 definitely unsuitable for standard seating and high chairs?
- Are all outside tables unheated?
- May staff accept parties over 26 across separated tables?
- Is 40 the intended staff ceiling or merely a typo guard?

### F-04 — Anonymous callers can spoof trusted channels and overrides

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Security / authorisation  
**Relevant section:** B5; B7; F5; E10; spec v2 §6 and §13

**Description:** `create_table_booking_v06` adds caller-controlled `p_channel`, `p_pin`, and `p_overrides`, while reproducing execute grants to `anon` and `authenticated`. The allocation rules trust the channel to choose online versus staff limits and allow staff-only unjoined or other overrides.

**Rationale:** A direct Supabase RPC caller can claim `p_channel='staff'`, request a pin, or submit override data without passing through AMS permission checks. `SECURITY DEFINER` makes this especially serious.

**Impact:** Public callers may bypass online party limits, holds, minimums, or join restrictions and create pinned or otherwise privileged bookings.

**Recommended action:** Do not grant the new privileged function to `anon` or general `authenticated` callers. Grant it to `service_role` only, or split public and privileged functions so the database derives permitted behaviour from a trusted entry point. Validate a fixed override schema and reject unknown keys. Never trust a caller-supplied channel as proof of authority.

**Open questions:** Is there any verified production caller that invokes the booking RPC directly rather than through AMS?

### F-05 — The liveness rule uses a payment value that does not exist

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Data correctness / payment safety  
**Relevant section:** B1; H3; spec v2 §3.5

**Description:** The v2 rule treats an expired hold as paid when `payment_status = 'paid'`. The table-booking `payment_status` enum is `pending | completed | failed | refunded | partial_refund`; current table-booking code uses `completed`. `paid` belongs to a different parking enum.

**Rationale:** Comparing the table-booking enum with `paid` can fail at function creation or execution, and it certainly does not preserve completed deposits.

**Impact:** Paid bookings may be released, excluded from capacity, or cancelled incorrectly—the exact defect this rule claims to fix.

**Recommended action:** Use the proven current predicate with `payment_status = 'completed'`, while deciding how `refunded` and `partial_refund` should behave. Add a migration compile test and real data fixtures for every enum value.

**Open questions:** Should a fully refunded but still confirmed booking remain live? Is payment capture ID also authoritative when status drift exists?

### F-06 — The feature gate cannot preserve current behaviour after old paths are deleted

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Rollout / functional regression  
**Relevant section:** B6; D1–D8; I3–I9; Recovery

**Description:** B6 only says that `v06` uses the old selection path when the gate is false. Stream D deletes or replaces entire caller behaviours before activation, including the FOH raw walk-in allocator. The current walk-in fallback can bypass past/hours checks, creates a seated booking, and has different deposit and pacing behaviour. Falling back to `v05` table selection does not recreate that route.

**Rationale:** A selection gate is not an end-to-end behaviour gate.

**Impact:** Deploying AMS with the gate off can still change production behaviour, and disabling the gate after activation may not restore the previous flows.

**Recommended action:** Keep old caller paths intact until activation, with route-level branching between complete old and new operations. Test gate-off behaviour for every caller, not only public creation. Define how gate-off handles records already carrying holds, pins, outside reservations, or soft assignments.

**Open questions:** Is the gate intended to control only ranking or the full create/move/edit workflow?

### F-07 — The deployment step omits most database work and uses the wrong production method

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Migration / deployment  
**Relevant section:** A7; B1–B11; I2

**Description:** I2 applies only A2 through A6. A7 and most of Stream B create or replace database functions and require migrations, but no filenames or production apply steps are assigned to them. I2 also says to use `db push`, while the project’s current production workflow uses Supabase `apply_migration` with apply-time history.

**Rationale:** Code cannot call database functions that were never deployed. Using the wrong migration path risks history drift and unintended pending migrations.

**Impact:** Production activation will fail or apply a broader migration set than reviewed.

**Recommended action:** Give every database change a numbered migration and exact dependency order. Apply each reviewed SQL file through the project’s production migration workflow, with explicit approval, live smoke calls, ACL checks, and generated-type regeneration. Use CLI dry-run only as an additional local check, not as production deployment.

**Open questions:** How many Stream B migrations are intended, and who is authorised to apply them?

### F-08 — Date-keyed locks do not protect cross-midnight or cross-date moves

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Concurrency / data integrity  
**Relevant section:** B5; B8; B10; B11; H4; spec v2 §9

**Description:** The proposed allocation and outside locks are keyed only by `booking_date`. A late booking recorded on one date can overlap an early booking recorded on the next date, but the two transactions take different locks. Moving a booking between dates also needs both old and new locks in a deterministic order.

**Rationale:** The plan explicitly supports cross-midnight bookings, so its lock domain must cover overlapping resource windows rather than one nominal date.

**Impact:** Two transactions can both select the last table or outside resource across midnight and race into trigger failures or inconsistent retry behaviour.

**Recommended action:** Use a lock scope that covers every overlapping service date or the venue/resource itself. For cross-date moves, acquire all relevant keys in sorted order. Add real races spanning midnight and moves between dates.

**Open questions:** Can normal services run past midnight, and how is the service date defined?

### F-09 — Outside occupancy and capacity changes are not representable safely

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Data model / physical capacity  
**Relevant section:** A4; B3; B8; E4; spec v2 §5.2

**Description:** The plan stores outside table count and capacity basis but no outside occupancy end including the turnaround gap. Outside bookings have no assignment row, while the booking end intentionally excludes the gap. The plan also says a capacity change from 8 to 6 may be acknowledged while old bookings retain a one-table cost based on 8.

**Rationale:** If the physical tables now seat 6, an existing party of 8 requires two tables. Acknowledging the conflict without updating its reservation does not create the missing physical capacity.

**Impact:** Outside capacity can be oversold, and turnaround space can be ignored or recalculated from later settings.

**Recommended action:** Store a durable outside reservation window and table count, or use a resource-reservation table. When capacity changes, every affected booking must be resolved and re-costed before activation; acknowledgement alone is insufficient.

**Open questions:** Are old eight-seat layouts physically retained for existing bookings, or must every future booking adopt six seats on the change date?

### F-10 — The shared candidate function lacks inputs required by the plan

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** API design / implementability  
**Relevant section:** B2; B5; B10; C1; E9; F2; G4

**Description:** The defined candidate signature has no high-chair count, accessible-table requirement, preferred/selected table IDs, pin state, soft-assignment handling, or actor context. Yet B2 must filter high-chair and accessibility suitability, F2 must honour a staff-picked table, and B10 must apply pin rules.

**Rationale:** These values are known before a booking row exists and cannot be safely inferred inside the side-effect-free function.

**Impact:** Different callers will add extra checks outside the primitive, recreating rule drift, or overload untyped `p_overrides`.

**Recommended action:** Publish a complete typed signature or typed request composite. Keep booking requirements separate from privileged override flags. Add explicit selected-target validation for staff mutations.

**Open questions:** Should the primitive rank all candidates and a separate validator check staff-selected IDs, or should one function support both modes?

### F-11 — The staff large-party flow conflicts with the preserved `v05` guard

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Functional contradiction  
**Relevant section:** B5; E6; F5; H1; spec v2 §5.4 and §6

**Description:** The v2 contract says the `party of 21 or more` guard is preserved verbatim, while also saying staff can book up to 40 and 21–26 should use Dining Room joins. B5 says to preserve every rule in spec §6. H1 tests only 1–26.

**Rationale:** The hard guard runs before allocation and prevents the new staff path.

**Impact:** Staff bookings above 20 will still be refused, or a developer will silently change parity behaviour.

**Recommended action:** Resolve the contract explicitly: online and trusted staff validation must occur before the shared create core, with staff authority proven at the API boundary. Update all route schemas and tests through the actual maximum.

**Open questions:** Is staff acceptance over 20 approved at all? If so, is 40 a real limit or only input validation?

## 4. Other confirmed issues

### F-12 — Stream A is not behaviourally inert

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Rollout / configuration  
**Relevant section:** Stream A introduction; A6; Stream A gate

**Description:** A6 writes existing live kitchen pacing keys to 15 with zero reserve. Current `v05` and the current availability code already read those keys. If A6 updates them, production behaviour changes before the allocation gate; if it uses `ON CONFLICT DO NOTHING`, the agreed values are not applied.

**Rationale:** Existing settings are outside the new feature gate.

**Impact:** Kitchen acceptance can tighten during the supposedly dormant foundation deployment.

**Recommended action:** Seed only missing new keys in Stream A. Move changes to existing live settings into the controlled activation transaction or add a separate pacing activation flag and explicit old-value capture.

**Open questions:** What are the live values immediately before activation, and must disabling `v06` restore them?

### F-13 — The ID and row-count preflights are not executable as written

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Data migration / baseline  
**Relevant section:** A1; A2; A4

**Description:** A2 says to backfill by 12 expected IDs but lists only table names, not UUIDs. A1 captures five functions but not the table grid or IDs. A4 expects nine “live” outside bookings based on discovery, although discovery reported nine outside bookings in a historical sample, not necessarily nine future live bookings at migration time.

**Rationale:** Production data changes between discovery and migration.

**Impact:** The migration can abort incorrectly or backfill the wrong rows.

**Recommended action:** Capture a dated baseline artifact containing table IDs, bookable state, join links, future outside bookings, future drinks bookings, and live settings. Preflight expected structure, but derive backfill row counts from the apply-time query and report them for approval.

**Open questions:** How many future outside and drinks bookings exist at actual migration time?

### F-14 — New allocation columns lack database invariants

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Data integrity  
**Relevant section:** A4

**Description:** The plan gives no constraints for:

- paired nullability and positivity of `outside_tables_reserved` and `outside_capacity_basis`;
- outside fields being set only for outside bookings;
- `assignment_soft` being valid only for drinks;
- pinned bookings requiring an indoor assignment;
- accessible requirement override recording.

**Rationale:** Application checks alone will drift across multiple mutation paths.

**Impact:** Invalid combinations can be persisted and later counted incorrectly.

**Recommended action:** Add appropriate check constraints or authoritative RPC validation and tests for direct writes. Define purpose and seating conversions so flags are updated atomically.

**Open questions:** Can a drinks booking be made hard-assigned without being pinned?

### F-15 — The hold model cannot represent all planned holds

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Data model / requirements  
**Relevant section:** A3; A6; E7; spec v2 §7

**Description:** `table_holds` requires finite `starts_on` and `ends_on`, but the default walk-in holds appear permanent. No task seeds the selected held tables. The same table requires an indoor `table_id`, so it cannot represent the planned venue-wide outside weather closure.

**Rationale:** The schema and plan use one object for three different scopes without modelling them.

**Impact:** Default holds may never exist, may expire accidentally, or outside closure cannot be recorded.

**Recommended action:** Define permanent recurrence or nullable effective end, seed the approved tables explicitly, and model outside closure with a resource/scope field or a separate outside block.

**Open questions:** Are walk-in holds weekly, daily, service-specific, or always active until cancelled?

### F-16 — Maintenance override can leave a booking on a blocked table

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Workflow / safety  
**Relevant section:** A3; E7; E10; spec v2 §7 and §13

**Description:** The plan permits an authorised user to create a maintenance block over existing bookings after confirmation, then lists those bookings for manual relocation. At that point the block is active while bookings remain assigned. Elsewhere the specification says maintenance is never bypassable.

**Rationale:** A warning does not resolve the conflict.

**Impact:** The diary can enter an impossible state, and creation/edit checks may disagree about the existing assignment.

**Recommended action:** Create the block as pending until all conflicts are moved, or make block activation and relocation one controlled workflow. Do not activate a hard block while conflicting assignments remain.

**Open questions:** Is it acceptable to cancel a block if one affected booking cannot be moved?

### F-17 — Settings optimistic concurrency is not well-defined

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** API / concurrency / audit  
**Relevant section:** A7; E1–E9

**Description:** One section is stored across several `system_settings` rows, each with its own `updated_at`, but the RPC accepts one `expected_updated_at`. The plan does not define the section version, transaction, audit actor, old/new values, or exact grants.

**Rationale:** Using the maximum row timestamp can still miss changes or create false conflicts.

**Impact:** Stale tabs may overwrite part of a section, and audits may not identify who changed production behaviour.

**Recommended action:** Introduce an explicit section version or settings revision row. Update and audit the whole section in one transaction. Grant the RPC only to the trusted backend and pass authenticated actor details from the route.

**Open questions:** Is `system_settings` required, or can typed section tables be used for this high-risk configuration?

### F-18 — The drinks bump algorithm is not specified enough to implement safely

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Algorithm / transactional integrity  
**Relevant section:** B7; H4

**Description:** If retained, the bump rule can move a “set of relocations,” but the plan does not define maximum moved bookings, deterministic search order, how alternative assignments avoid conflicting with each other, complexity bounds, or what happens when one audit write fails.

**Rationale:** Validating each drinks move independently does not prove the full set is jointly valid.

**Impact:** The allocator can choose conflicting moves, become expensive, or partially mutate the diary.

**Recommended action:** Specify a bounded joint relocation plan returned without writes, then validate and commit the whole plan atomically. Include actor, reason, and full before/after assignments in the same transaction.

**Open questions:** May one food booking move multiple drinks bookings? What is the hard search bound?

### F-19 — Availability does not model bump behaviour

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Availability parity  
**Relevant section:** B2; B7; B9; H7

**Description:** B9 calls the normal candidate function per slot. B7 only attempts bumping during creation after no normal candidate exists. Availability can therefore say unavailable when creation would move drinks bookings and succeed.

**Rationale:** The plan’s parity test only asserts that “available” must create successfully; it does not catch false-unavailable slots.

**Impact:** Valid capacity remains hidden from customers, and the mismatch metric understates disagreement.

**Recommended action:** Decide whether online availability is allowed to rely on bumping. If yes, make a side-effect-free bump-plan calculation part of both availability and creation. Test parity in both directions, allowing only documented race outcomes.

**Open questions:** Should a public availability check be allowed to promise capacity that requires moving another booking?

### F-20 — The private-booking availability acceptance test expects the wrong result

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Testing / functional correctness  
**Relevant section:** B9

**Description:** B9 says that when the Dining Room is held by a private booking, small parties should show `tables_full`. The original defect was that the allocator failed to fall back to free Main Bar tables. If any valid Main Bar table is free, the correct result is available.

**Rationale:** An acceptance test must state all occupied/free inventory.

**Impact:** A developer could encode the original false refusal as the expected behaviour.

**Recommended action:** Split the test:

1. Dining Room blocked and Main Bar free → available with a Main Bar table.
2. Dining Room blocked and all other valid tables occupied → `tables_full`.

**Open questions:** None.

### F-21 — “Unknown for every slot” is impossible when the database is unreachable

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Error handling / API contract  
**Relevant section:** C3; G2

**Description:** If the database is unreachable, AMS may not know the service window or slot list, so it cannot necessarily return `unknown` for every slot. The current website builds service slots locally from business hours, which may fail independently.

**Rationale:** The degraded response needs a defined source of slot times.

**Impact:** Clients may receive an invalid empty list, stale times, or a shape not covered by the contract.

**Recommended action:** Add a top-level calculation state and define degraded variants: whole-date unknown with no slots, unknown slots built from a trusted cached schedule, or HTTP 503 mapped by the website to a call-us state.

**Open questions:** Is stale business-hours data acceptable during an outage?

### F-22 — The FOH walk-in override cannot be replaced by the proposed `v06`

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Functional coverage / integration  
**Relevant section:** D3; B5

**Description:** The current fallback raw-inserts walk-ins when regular creation returns past, outside-hours, cutoff, or hours-not-configured. It can mark the booking seated immediately. The `v06` signature has no seat-now flag and says current past/hours guards are preserved.

**Rationale:** `p_channel='walkin'` alone does not define which guards are bypassed or how seated state is stored.

**Impact:** Real walk-ins may be refused or created in the wrong status after D3 deletes the fallback.

**Recommended action:** Document and implement a trusted walk-in mode with exact bypass rules, `seated_at`, deposits, pacing, and audit behaviour. Keep the old path until parity tests prove the replacement.

**Open questions:** Can a walk-in be recorded with a start time in the recent past, and by how much?

### F-23 — The staff table picker has no atomic create contract

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** User journey / concurrency  
**Relevant section:** F2; B2; B5

**Description:** B2 can return ranked candidates, but `create_table_booking_v06` has no explicit preferred table IDs. F2 says the create modal will replace the current post-create move with a picker.

**Rationale:** The chosen table must be revalidated and written in the same create transaction.

**Impact:** The UI can display a picker but the booking may still be assigned elsewhere, or a race can reintroduce the best-effort move.

**Recommended action:** Add a typed optional target assignment to the trusted staff create API and RPC. Validate it under the allocation lock; return a clear 409 if it is no longer valid.

**Open questions:** If the selected table is lost, should creation fail or fall back automatically?

### F-24 — The party-size migration omits linked-event and deposit behaviour

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Integration / regression risk  
**Relevant section:** D5; D6; B11

**Description:** The current BOH party-size route calls `updateTableBookingPartySizeWithLinkedEventSeats` and then manages deposit threshold changes and SMS. Its schema also caps size at 20 and selected table IDs at four. D5 only says to “use B2.”

**Rationale:** Table selection is only one part of the mutation.

**Impact:** Linked event seats, deposits, notifications, and current atomic safeguards can regress.

**Recommended action:** Define one orchestration transaction and post-transaction side effects for party-size changes. Update validation limits only after the large-party decision is approved. Preserve event-seat and deposit tests.

**Open questions:** Must deposit amount change for staff bookings over 20?

### F-25 — Pinned manual move behaviour is contradictory

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Functional contradiction  
**Relevant section:** B10; F1; spec v2 §8

**Description:** Spec v2 says staff manual moves of pinned bookings are allowed and the booking remains pinned. B10’s done condition says a pinned booking is refused with `pinned_conflict`.

**Rationale:** The same operation cannot be both allowed and blocked.

**Impact:** Developers and tests will implement opposing behaviour.

**Recommended action:** Distinguish manual table move from automatic time/party-size reallocation. Permit an authorised manual move and keep the pin; reject automatic moves or incompatible time changes.

**Open questions:** Is unpin permission separate from move permission?

### F-26 — The turnaround-gap floor display has no complete task

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** UI / data contract  
**Relevant section:** B3; F1

**Description:** The current FOH schedule response uses assignment `end_datetime` as the visible booking end. Under B3 that value includes the gap, so the floor will show a 105-minute guest booking rather than a 90-minute booking. The specification promises separate shading, but F1 does not define the new response fields or acceptance test.

**Rationale:** The UI needs both customer end and occupancy end.

**Impact:** Staff may tell guests the wrong duration or not understand why the table remains blocked.

**Recommended action:** Add customer end and occupancy end to the FOH contract, update timeline rendering, printing and drag calculations, and test the shaded gap.

**Open questions:** Should the gap be visible in BOH lists and print sheets?

### F-27 — The caller and file inventory contains factual errors

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Plan accuracy / scope  
**Relevant section:** D2; F2; F3; D9

**Description:** `src/app/api/external/table-bookings/route.ts` does not exist; the similarly named tree contains only PayPal child routes, while `external/create-booking` creates private bookings. The FOH hook path is under `foh/hooks/`. The plan also schedules high-chair shortfall and floor badges that are already substantially implemented.

**Rationale:** File-level plans should match the pinned baseline before being declared executable.

**Impact:** Work estimates and caller coverage are unreliable.

**Recommended action:** Complete the grep sweep before, not after, implementation. Mark live, dead, already-complete, and unrelated paths. Correct every file path and adjust estimates.

**Open questions:** Which external API, if any, creates table bookings separately from `POST /api/table-bookings`?

### F-28 — Public customer messages have no delivery endpoint

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Integration / content management  
**Relevant section:** A6; A7; E8; C1; G1–G3

**Description:** Messages are stored and editable, but the plan does not add a public-safe AMS response or website fetch for them. Availability returns a public reason code, not the configured text.

**Rationale:** The website cannot use manager-configured text unless a contract transports it.

**Impact:** Messages will remain hard-coded, or settings data may be exposed too broadly.

**Recommended action:** Include resolved safe text in each availability result, or provide a versioned public message endpoint containing only the fixed public enum. Define cache and fallback behaviour.

**Open questions:** Should message changes appear immediately or after a short cache?

### F-29 — The date picker still creates a month-level N+1 pattern

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Performance / integration  
**Relevant section:** B9; G5

**Description:** Whole-date availability removes one call per slot, but marking every calendar day still requires one whole-date call per day unless a date-range endpoint exists.

**Rationale:** A month view can trigger roughly 30 expensive allocation queries on every party-size change.

**Impact:** Slow date picking and avoidable database load.

**Recommended action:** Add a bounded date-range summary endpoint or lazy-load only visible/selected dates with deduplication and cancellation. Load-test it.

**Open questions:** How many days does the current date picker display and prefetch?

### F-30 — New permissions are not assigned to roles

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** RBAC / delivery  
**Relevant section:** E10; F1; F5

**Description:** The plan adds action names not currently present in `ActionType`, and says to seed permissions, but it does not say which roles receive them. It also inconsistently lists `override_unjoined` only in the plan.

**Rationale:** Creating a permission without assigning it leaves features inaccessible; broad assignment can expose risky overrides.

**Impact:** FOH controls may fail in production or be available to the wrong users.

**Recommended action:** Add every action to types, seed it, assign it to named roles, update permission caches, and test UI hiding plus server enforcement. Keep the override set aligned with approved scope.

**Open questions:** Which of staff, manager, and super-admin can pin, block, override holds, override minimums, and use unjoined tables?

### F-31 — Atomic audit attribution is not designed

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Audit / transaction design  
**Relevant section:** B7; B10; A7; E10

**Description:** Bump moves, pins, overrides, and settings changes must be audited, but `v06` has no trusted actor parameter and service-role calls cannot rely on `auth.uid()`. Application-level audit after an RPC is not atomic with the mutation.

**Rationale:** A failed audit must not leave a privileged change untraceable.

**Impact:** Override and bump records may lack a reliable actor or disappear after partial failure.

**Recommended action:** Pass a server-validated actor ID and reason into privileged RPCs and write the audit row in the same transaction. Do not accept actor identity from public callers.

**Open questions:** What should happen if the audit insert fails?

### F-32 — Byte-identical parity tests are impractical

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Testing / acceptance criteria  
**Relevant section:** B5; Stream B gate; H2

**Description:** Separate booking calls generate different booking UUIDs, references, timestamps, hold expiry values, payment IDs, and database side effects. Their JSON cannot be byte-identical even when behaviour is equivalent.

**Rationale:** An impossible gate either blocks delivery or is weakened informally later.

**Impact:** Parity can become a misleading checkbox.

**Recommended action:** Compare normalised stable fields and side-effect invariants in rolled-back fixtures. Explicitly ignore generated values while verifying their formats and relationships.

**Open questions:** Can both functions be exercised against the same deterministic clock and transaction fixture?

### F-33 — Test coverage does not match the planned risk

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Testing / CI  
**Relevant section:** H1–H11; I1

**Description:** Missing or incomplete coverage includes:

- staff parties 27–40 and unjoined allocation;
- direct RPC privilege spoofing;
- gate-off parity for every route;
- settings stale-write and audit behaviour;
- multi-booking bump plans;
- failure injection during moves and audits;
- outside recosting and turnaround gaps;
- purpose and indoor/outside conversions;
- performance targets;
- recovery after new-state bookings exist.

I1 also lists only the AMS toolchain. The website uses a different lint, Jest, TypeScript, and build pipeline.

**Rationale:** The highest-risk behaviours are not covered by the stated gate.

**Impact:** Both technical faults and cross-repository build failures can reach production.

**Recommended action:** Add a traceability matrix from each plan requirement to tests. Run lint, typecheck, tests, and cold builds in **both** repositories.

**Open questions:** Where will real database concurrency tests run safely?

### F-34 — Recovery refers to feature switches that do not exist

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Recovery / operations  
**Relevant section:** I9; Recovery; Risks

**Description:** Recovery says to disable the specific feature first, but the plan defines one global allocation gate and only a drinks bump toggle. Turn times, holds, outside reservations, accessibility filtering, pinning, and reason handling do not have independent activation controls.

**Rationale:** A recovery step must name an actual control and its effect on existing data.

**Impact:** Operators may be unable to isolate a failing feature without disabling the whole allocator.

**Recommended action:** Either add explicit safe feature gates with tested combinations, or remove the claim and document global disable plus manual reconciliation.

**Open questions:** Which features genuinely need independent kill switches?

### F-35 — Monitoring is listed but not implemented

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Observability / delivery  
**Relevant section:** Monitoring; I8

**Description:** No task adds event schemas, logs, metrics aggregation, dashboard queries, alerts, data retention, or an owner-facing view. Some required values, such as availability/create mismatch and bump pairs, do not exist automatically.

**Rationale:** “Watch the dashboard” assumes a dashboard is available.

**Impact:** Launch problems may be invisible or require manual log searching.

**Recommended action:** Add an observability work item with exact events, fields, privacy rules, storage, dashboard, alert thresholds, and owner. Verify data before activation.

**Open questions:** Which current monitoring system will store and display these metrics?

### F-36 — The estimate and ownership model are unsupported

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Delivery planning  
**Relevant section:** Estimate; dependency map; I5–I8

**Description:** Eighteen to twenty-four focused working days covers complex SQL allocation, multi-booking relocation, two repositories, a large settings rebuild, staff UI, migrations, test infrastructure, accessibility, deployment, and monitoring. There are no per-task estimates, owners, review time, UAT allowance, or contingency.

**Rationale:** Streams are described as parallel, but no team size or ownership is stated.

**Impact:** Delivery expectations are likely too optimistic and critical review work may be compressed.

**Recommended action:** Estimate each stream and its review/UAT separately. Name owners for database, AMS, website, product decisions, FOH training, migration, and launch monitoring. Add contingency for production-schema drift.

**Open questions:** How many developers can work in parallel?

### F-37 — Index and performance acceptance is too weak

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Performance / database design  
**Relevant section:** A5; B2; B9; H tests

**Description:** A three-column B-tree with two range inequalities may not provide efficient overlap searching. “Shows an index scan” does not prove that the plan is fast. Candidate enumeration returns invalid and valid combinations for every slot and may also simulate bumping.

**Rationale:** Availability runs far more often than booking creation.

**Impact:** A technically indexed query can still scan many rows or time out on month views.

**Recommended action:** Compare B-tree and range/GiST designs using realistic data. Set p50/p95 and query-count targets for one date and a date range. Add `EXPLAIN (ANALYZE, BUFFERS)` evidence and a load test.

**Open questions:** What production-like row count and concurrency should be tested?

### F-38 — Success metrics are not measurable as written

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Delivery / analytics  
**Relevant section:** Monitoring; Success

**Description:** “Mismatch below 1%” lacks a numerator, denominator, exclusions for races and unknown states, and minimum sample size. “No fall against the same period last year” may not have comparable booking data and is heavily affected by weather, events, and demand.

**Rationale:** Low volume makes a percentage unstable, and year-on-year acceptance is not a controlled measure.

**Impact:** The release can be declared successful or unsuccessful arbitrarily.

**Recommended action:** Define each metric precisely. Use counts plus rates, distinguish false-available and false-unavailable, and compare against a recent baseline by channel and service where possible.

**Open questions:** Is comparable 2025 table-booking data complete?

### F-39 — Production baseline and migration rehearsal are not proven

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Migration / environment  
**Relevant section:** Baseline; A1; H8; I2

**Description:** The plan says production is verified through a future-dated migration set, but attaches no schema, function hash, ACL output, settings snapshot, or query evidence. It does not require a full migration rehearsal from the current baseline in a safe database before production.

**Rationale:** Capturing five functions is not enough for a change involving tables, settings, holds, joins, permissions, and current bookings.

**Impact:** Production drift may only be found while applying the live change.

**Recommended action:** Capture the complete baseline artifact set, restore it into a disposable environment, apply every migration in order, run tests and smoke SQL, then repeat the preflight immediately before production.

**Open questions:** Is a production-like Supabase staging project available?

### F-40 — Dual-contract compatibility and removal are vague

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** API lifecycle / integration  
**Relevant section:** B4; C1; G1; I9

**Description:** AMS will return old and new shapes for “one release,” while the gate is removed after a clean fortnight. The plan does not define nesting, negotiation, client detection, schema ownership, deprecation logging, or whether external clients have upgraded.

**Rationale:** Returning two shapes is only safe when precedence and sunset are explicit.

**Impact:** Website or external callers may parse the wrong fields, and old fields may be removed too soon.

**Recommended action:** Publish exact versioned envelopes, consumer contract tests, deprecation telemetry, and removal criteria based on observed client usage rather than elapsed time alone.

**Open questions:** Are there external consumers beyond the pinned website repository?

## 5. Optional improvements

### O-01 — Remove the unused `heated` table column

**Status:** Optional improvement  
**Priority:** P3  
**Type:** Simplification  
**Relevant section:** A2; E1; G6

**Description:** Outside seating is not represented by rows in `tables`, while all indoor tables default to heated. The column cannot describe the aggregate outside resource and is not used by allocation.

**Rationale:** It adds schema and UI without implementing the stated disclosure.

**Impact:** Removing it reduces dead configuration.

**Recommended action:** Keep outside heating as an outside-setting/message property if approved.

**Open questions:** Could individual outside tables become first-class rows later?

### O-02 — Split the settings manager before adding more sections

**Status:** Optional improvement  
**Priority:** P3  
**Type:** Maintainability  
**Relevant section:** Stream E

**Description:** `TableSetupManager.tsx` is already about 1,400 lines.

**Rationale:** Adding nine sections to one client component increases state coupling and test difficulty.

**Impact:** Smaller section components and hooks reduce delivery risk.

**Recommended action:** Keep one page shell but split each settings section and API client into focused modules.

**Open questions:** None.

### O-03 — Use a generic reservation record for non-table resources

**Status:** Optional improvement  
**Priority:** P3  
**Type:** Architecture  
**Relevant section:** A4; B8

**Description:** Outside tables, high chairs, and any future bar capacity all reserve quantities over time.

**Rationale:** A resource-reservation model can store quantity, basis, start, end, and audit consistently.

**Impact:** More initial design work may remove several special-case columns and locks.

**Recommended action:** Compare this with the proposed outside columns before migration design is frozen.

**Open questions:** Is the current scope too small to justify a generic model?

### O-04 — Add shadow comparison before activation

**Status:** Optional improvement  
**Priority:** P3  
**Type:** Risk reduction / observability  
**Relevant section:** I3–I6

**Description:** With no writes changed, sampled requests can compare `v05` and `v06` ranking and availability.

**Rationale:** Real demand reveals unexpected table choices and refusal changes.

**Impact:** Defaults can be corrected before activation.

**Recommended action:** Add sampled, non-sensitive old/new comparison logs while the global gate is off.

**Open questions:** What sample rate keeps latency acceptable?

### O-05 — Generate shared contract types

**Status:** Optional improvement  
**Priority:** P3  
**Type:** Integration quality  
**Relevant section:** B4; C1; G1

**Description:** Two repositories “reference the same version number,” but can still hand-code different types.

**Rationale:** Generated types and fixtures make contract drift harder.

**Impact:** Fewer cross-repository runtime errors.

**Recommended action:** Generate TypeScript types from one JSON Schema and copy or package them with a checked hash.

**Open questions:** Is a shared package acceptable, or should CI compare the schema hash?

### O-06 — Add service simulation to settings preview

**Status:** Optional improvement  
**Priority:** P3  
**Type:** UX / validation  
**Relevant section:** E9

**Description:** One selected request shows a local choice but not service-wide fragmentation.

**Rationale:** Managers need to see how priorities and holds affect several bookings.

**Impact:** Safer configuration changes.

**Recommended action:** Add preset scenarios or a read-only selected-service replay after the core preview works.

**Open questions:** Should it use unsaved draft settings?

### O-07 — Use generated range columns or GiST for overlap-heavy resources

**Status:** Optional improvement  
**Priority:** P3  
**Type:** Database performance  
**Relevant section:** A5

**Description:** PostgreSQL range types can express half-open overlap directly.

**Rationale:** They are often clearer and more indexable than paired inequalities.

**Impact:** Better query plans and fewer boundary mistakes, if compatible with current schema.

**Recommended action:** Benchmark a generated `tstzrange` plus GiST before choosing the final index.

**Open questions:** Would adding a generated range column complicate current Supabase types or triggers?

## 6. Required changes before implementation

The plan should not be marked ready until it:

1. Corrects the held tables to Low 4a and Low 4b.
2. Removes or obtains approval for the drinks bump design.
3. Separates every unapproved accessibility, heating, large-party, and unjoined-table feature.
4. Restricts privileged `v06` execution and prevents channel/override spoofing.
5. Corrects the payment status predicate to use the real enum.
6. Defines an end-to-end gate that preserves every old caller while disabled.
7. Gives A7 and all Stream B SQL changes migrations and the correct production workflow.
8. Fixes cross-midnight and cross-date locking.
9. Completes the outside reservation window and capacity-change workflow.
10. Publishes a complete candidate/create/move contract including requirements and staff-selected targets.
11. Resolves the 21+ guard before adding a staff large-party path.
12. Keeps Stream A behaviourally inert until activation.
13. Reworks hold scope, default seed, maintenance activation, and outside closure.
14. Completes settings versioning, RBAC assignments, and atomic audit attribution.
15. Makes availability reflect every capacity-making rule or explicitly excludes those rules.
16. Preserves walk-in, linked-event, deposit, and notification behaviour.
17. Corrects the caller/file inventory and removes already-complete scope.
18. Adds the customer-message transport and month-level availability design.
19. Replaces impossible parity criteria with normalised invariant tests.
20. Adds both-repository CI, recovery, performance, security, and failure-injection tests.
21. Adds actual monitoring implementation, measurable success criteria, owners, and realistic estimates.

## 7. Unresolved decisions

These require owner or technical approval:

- Whether held Low 4a and Low 4b are excluded from online joins as well as singles.
- Whether drinks bookings remain unassigned, keep a fixed table, or use bumping.
- What a drinks booking guarantees to the customer.
- Whether accessibility table attributes and the website checkbox are in scope.
- The verified physical accessibility of each table.
- Whether seasonal unheated-outside messaging is required.
- Whether staff can accept 21–26 and 27+ through normal table booking.
- Whether unjoined tables may ever be treated as one party allocation.
- The real staff maximum party size.
- How eight-seat outside bookings are handled when tables physically change to six.
- How hard maintenance blocks become active when bookings already exist.
- Whether public availability may rely on moving another booking.
- Which roles receive each new permission.
- Whether independent feature kill switches are required.

## 8. Major risks

1. **Wrong product delivered:** the plan reverses explicit owner decisions.
2. **Privilege bypass:** public RPC callers can claim staff-only behaviour.
3. **Paid booking released:** the liveness predicate uses the wrong payment value.
4. **Unsafe disabled state:** old caller behaviour is removed even while the gate is off.
5. **Missing production functions:** the deployment list omits most Stream B database work.
6. **Cross-midnight race:** date-only locks do not cover overlapping dates.
7. **Outside oversell:** no durable gap window and no real capacity recosting.
8. **Availability drift:** bump-only capacity and customer messages are not represented consistently.
9. **Walk-in regression:** the current hours/past/seated override has no replacement contract.
10. **Scope and schedule overrun:** several large features were added without approval or detailed estimates.
11. **Weak recovery:** “disable the feature” refers to controls that do not exist.
12. **Invisible launch failure:** monitoring is listed but not built.

## 9. Recommended next steps

1. Correct the decision register using the owner’s actual seven answers.
2. Hold a short approval session only for the genuinely new proposals.
3. Reduce the plan to confirmed scope before re-estimating it.
4. Redesign trusted RPC entry points, the gate, and cross-date locking.
5. Fix the liveness predicate and outside reservation model.
6. Produce exact migration files/order and a complete caller contract.
7. Re-run the repository inventory and mark existing versus new work.
8. Expand the test, monitoring, recovery, and two-repository deployment tasks.
9. Re-review the corrected plan before any implementation begins.

