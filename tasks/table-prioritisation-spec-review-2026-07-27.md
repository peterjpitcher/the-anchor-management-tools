# Developer Review Report — Table Prioritisation Implementation Specification

**Reviewed document:** `tasks/table-prioritisation-spec-2026-07-27.md`  
**Related discovery:** `tasks/table-prioritisation-discovery-2026-07-27.md`  
**AMS repository snapshot reviewed:** `e8d725a416e14c0f1d8fb1d0fe68d9b0f01ba7b2`  
**Website repository snapshot reviewed:** `197ef06de71377fb99e564edad322f9b45407007`  
**Review date:** 2026-07-27  
**Original document changed:** No  
**Review scope:** technical correctness, functional completeness, data, integrations, security, performance, accessibility, monitoring, migration, deployment, testing, delivery, and operational readiness

## 1. Overall assessment

**Readiness: not ready for implementation or production approval.**

The specification has a good product direction. It correctly prioritises the confirmed private-booking and false-availability faults, makes table ordering understandable to managers, separates later staff workflow changes from correctness work, and avoids destructive database changes.

However, the current draft is not yet implementable as written. Seven approval blockers need to be resolved:

1. The stated migration order and the three rollout phases cannot work together.
2. No shared allocation primitive is defined, so the promised “one rule used by every path” cannot be delivered by the two named functions.
3. The `v06` input, output, and compatibility contract omits current high-chair, outside, Christmas, deposit, hours, and payment behaviour.
4. Kitchen pacing is changed from arrival pacing into occupancy counting without confirming that this is the intended business rule.
5. The outside-table cap has no durable allocation or effective-dated capacity model.
6. A drinks-arrival cap does not reserve physical seating, so a confirmed drinks booking can arrive with nowhere to sit.
7. Pointing callers back to `v05` is not a valid rollback after the new data and workflows are active.

The specification should be revised before coding begins, except for a narrowly scoped private-booking hotfix that can be designed, tested, and released independently.

### Strengths worth keeping

- The owner’s preferred fill order is explicit and easy to explain.
- Priority-first behaviour and its wasted-seat trade-off are stated honestly.
- The private-booking regression and false website availability are correctly treated as urgent.
- A new function version is safer than silently changing an existing public function during a staged rollout.
- Settings, permissions, audit, staff workflow, and website work are recognised as part of the feature rather than treated as database-only work.
- Outside and drinks changes are correctly separated from the first correctness release.
- The draft recognises that availability and creation must agree and that creation remains the authoritative concurrency gate.

### Finding counts

| Classification | Count |
|---|---:|
| Confirmed issues | 37 |
| Optional improvements | 7 |
| P0 approval blockers | 7 |
| P1 issues | 21 |
| P2 issues | 9 |

## 2. Classification

- **Confirmed issue:** a contradiction, missing requirement, unsafe assumption, factual gap, or delivery problem that must be resolved for the affected scope.
- **Optional improvement:** useful simplification or hardening that is not required to make the core release correct.
- **P0:** do not approve or implement the affected design until resolved.
- **P1:** resolve before implementation starts.
- **P2:** resolve before production rollout.
- **P3:** optional backlog item.

### Evidence checked

| Evidence | Review result |
|---|---|
| Specification and discovery documents | Requirements and source claims compared section by section |
| Current `create_table_booking_v05` migrations | Current allocator has a large existing contract not captured for `v06` |
| `20260728000000_highchair_outside.sql` | Adds defaulted high-chair and outside parameters and outside-specific behaviour to `v05` |
| `src/app/api/foh/bookings/route.ts` | Contains a separate raw-insert override allocator with its own join search and rules |
| `src/lib/table-bookings/manage-booking.ts` | Customer party-size growth has separate table movement logic |
| `src/lib/table-bookings/move-table.ts` | Manual moves use a separate availability calculation and mutation RPC |
| `src/app/api/boh/table-bookings/[id]/route.ts` | Booking and assignment window edits are separate writes and do not use the proposed allocator |
| `src/lib/table-bookings/kitchen-pacing.ts` | Current pacing is a centred arrival-time window, not full booking-span occupancy |
| AMS `GET /api/table-bookings/load` | Currently carries pacing and high-chair data, requires auth, and returns `no-store` |
| Website availability route | Already accepts party size, ignores purpose, uses a fail-open load helper, and builds schedule-based slots locally |
| Website booking code | Main form, legacy components, API client, and booking-agent path all use booking or availability contracts |
| Current settings page and APIs | Multiple existing table and pacing save paths must be preserved or replaced deliberately |

## 3. Approval blockers

### F-01 — Migration order and rollout phases contradict each other

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Migration / delivery / contradiction  
**Relevant section:** §3 M1–M6; §7

**Description:** The document says six migrations are applied in the order M1 through M6. It then says Phase 1 applies M1, M4, M5, and M6, while M2 and M3 are deferred to Phase 2. M4 is also specified to respect holds and blocks from M2 and pin-related behaviour from M3, and to include Phase 3 outside and drinks behaviour.

**Rationale:** A migration cannot safely reference tables or columns that have not been created. A single M4 containing all three phases also cannot be activated one phase at a time merely by changing callers.

**Impact:** Phase 1 can fail at migration time, or it can accidentally activate Phase 2 and Phase 3 behaviour. The claimed independent deployability is not true.

**Recommended action:** Redesign the migration and activation sequence. Use either:

1. additive schema migrations for all future fields first, with all new behaviour disabled by explicit feature settings; or
2. one allocator version per phase, such as `v06_correctness`, `v07_controls`, and `v08_capacity`.

For every phase, list the exact schema prerequisites, function version, caller switch, feature flags, and rollback action.

**Open questions:**

- Should dormant M2 and M3 schema be installed before Phase 1, or must each phase contain only its own schema?
- Is the project willing to carry multiple allocator versions, or should one version be feature-gated?
- Which migration timestamps and production apply order will be used across already queued migrations?

### F-02 — “One allocation rule” has no shared technical primitive

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Architecture / functional correctness  
**Relevant section:** §2; §3 M4–M5; §5

**Description:** M4 creates a booking function and M5 creates a separate read-only availability function. The specification then says public creation, the FOH override, manual moves, party-size changes, and customer management will all use one rule. It does not define a shared SQL function, view, or library that both M4 and M5 call, nor how a create-only function can serve move and edit operations.

**Rationale:** Two independently implemented functions will drift. Current code already has separate rules in the FOH raw-insert override, customer party-size growth, move-table availability, time moves, and BOH edits.

**Impact:** Availability can still disagree with creation, and fixes for no-shows, private bookings, holds, pinning, or joins may apply to one path but not another.

**Recommended action:** Define one side-effect-free candidate function, for example:

`find_table_allocation_candidates(start, end, party_size, purpose, outside, channel, exclude_booking_id, override_flags)`

It should return ordered candidate allocations plus internal reason codes. Creation, move, edit, availability, and preview must call it. Mutating operations must then lock, re-check, and write atomically. Document which current paths are retired and which RPCs are rebuilt around this primitive.

**Open questions:**

- Does a manual move use the same ranking, or only the same validity checks while honouring the staff-selected target?
- Does an edit keep a valid current assignment before considering a better-ranked one?
- Which function owns business hours, pacing, deposit, and table selection: the candidate primitive or an orchestration layer?

### F-03 — The `v06` compatibility contract is incomplete

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Integration / regression risk  
**Relevant section:** §3 M4; §5; §7

**Description:** The proposed `create_table_booking_v06` is described only by its new behaviour. The current `v05` contract also handles or is being extended for high chairs, outside seating, Christmas and Sunday booking types, business and kitchen hours, cutoff bypasses, pacing bypasses, deposits, pending-payment holds, committed party size, customer records, references, payment rows, notifications, and a structured JSON response. The repository also contains a dated migration that adds `p_high_chair_count` and `p_outside_seating` to `v05`.

**Rationale:** Rewriting the large function from a feature list is likely to drop an existing branch, parameter, response field, grant, or security property.

**Impact:** Existing booking flows can break even if priority allocation itself works. High-chair requests, outside bookings, Christmas bookings, deposits, or current API callers may silently regress.

**Recommended action:** Add a versioned compatibility contract containing:

- the exact `v06` signature, defaults, and accepted enum values;
- the full success and blocked JSON shapes;
- every preserved `v05` rule;
- required `SECURITY DEFINER`, `search_path`, revoke, and grant statements;
- caller-by-caller parameter and response mapping;
- parity tests proving that requests unaffected by the new feature behave exactly as under `v05`.

Pin the source production function definition or repository commit used to build `v06`.

**Open questions:**

- Must `v06` accept all 13 current or queued `v05` parameters?
- Which current blocked reason codes must remain stable for external clients?
- Are Christmas, Sunday lunch, high-chair, and deposit paths in every rollout phase?

### F-04 — Kitchen pacing changes business meaning without confirmation

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Business rule / capacity model  
**Relevant section:** §1 decision 4; §2.3; §4

**Description:** “15 covers every 30 minutes” normally describes arrivals or kitchen order starts. The draft then says each booking will count against every window its table span overlaps. A six-person two-hour booking could therefore consume six covers repeatedly across four or more windows, even though those covers did not all order again.

**Rationale:** Table occupancy and kitchen production load are different constraints. The current implementation uses a centred rolling arrival window. Replacing it with full-span counting can make a ceiling of 15 far more restrictive than the owner intended.

**Impact:** Valid later bookings may be refused, especially on Sundays. The business may lose capacity while believing only a bug was fixed.

**Recommended action:** Obtain a precise owner decision and define one of these models:

- arrivals in a rolling or fixed window;
- estimated kitchen demand distributed over a service curve;
- concurrent seated covers;
- both kitchen pacing and room occupancy as separate gates.

Provide worked examples at 18:00, 18:15, 18:30, and 19:00 and compare the old and new results against real services before choosing the default.

**Open questions:**

- Does “15 covers” mean arrivals, orders sent, or guests still dining?
- Is the window centred, trailing, leading, or a fixed half-hour bucket?
- Do staff-created bookings and walk-ins consume or bypass the same limit?

### F-05 — The outside capacity model cannot be enforced durably as specified

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Data model / concurrency / migration  
**Relevant section:** §2.4; §3 M4 and M6; §4; §7 Phase 3

**Description:** An outside booking consumes a calculated number of abstract tables, but no migration stores that allocation or snapshots the capacity used. Only current settings are proposed. Changing capacity from 8 to 6 can therefore change the resource cost of every existing future booking immediately and can make the diary oversubscribed. No outside-resource row, reservation count, or atomic locking rule is defined.

**Rationale:** A setting is not a durable reservation record. Availability, creation, edits, and existing bookings must agree about how many outside tables have been committed.

**Impact:** The outside cap can be oversold, existing bookings can become impossible after the settings change, and rollback or audit cannot reconstruct what was promised.

**Recommended action:** Choose and document a durable model:

- store `outside_tables_reserved` and the capacity basis on each booking; or
- create a generic resource inventory and reservation table with effective-dated capacity.

Define atomic count-and-insert locking, edit/rebook rules, and a migration check before lowering capacity. Do not describe the 8-to-6 change as a simple same-day setting edit until future bookings have been validated.

**Open questions:**

- Are bookings made before the change honoured under eight-seat layouts?
- Can one party reserve more than one outside table?
- Is the capacity change date-specific, service-specific, or global?
- How are outside tables held for walk-ins or taken out of service?

### F-06 — Unassigned drinks bookings do not guarantee a place for the guest

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Functional / customer promise / capacity model  
**Relevant section:** §2.5; §4; §5; §7 Phase 3

**Description:** A ceiling of 20 drinks covers per 30 minutes limits arrivals, not concurrent bar or seating occupancy. With 90-minute turns, three accepted waves can produce 60 concurrent drinks guests, in addition to dining and walk-ins. The booking has no reserved table or named bar-capacity resource.

**Rationale:** A confirmed booking implies that the venue can accommodate the party. “Seat them on arrival” is an operational instruction, not a capacity guarantee.

**Impact:** Guests may arrive for confirmed bookings and have nowhere to sit. FOH staff inherit an unsolved allocation conflict during service.

**Recommended action:** Define a real drinks capacity model before removing assignments. Options include:

- keep drinks table-assigned;
- reserve a separate bar-zone capacity across the full booking span;
- accept drinks as a clearly labelled non-seated reservation with an owner-approved concurrent cover limit.

Model dining guests, walk-ins, and drinks guests that compete for the same physical space.

**Open questions:**

- Is a drinks booking guaranteed a seat, guaranteed entry only, or a request?
- What physical capacity supports the default of 20?
- Can FOH refuse seating or convert the booking on arrival?

### F-07 — The rollback claim is unsafe

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Deployment / recovery  
**Relevant section:** §7

**Description:** The document says every phase is reversible by repointing callers to `v05`. After Phase 2, `v05` ignores holds, blocks, minimum-release behaviour, and pins. After Phase 3, it does not understand the new outside cap or unassigned-drinks operating model. New settings and records remain, and existing bookings created under the new rules are not transformed back.

**Rationale:** Code rollback is not state rollback. A prior allocator can accept bookings that violate new operational promises or mis-handle records produced by the new workflow.

**Impact:** An emergency rollback can create bookings on maintenance-held tables, ignore outside limits, or leave confirmed unassigned drinks bookings in a UI that treats them as errors.

**Recommended action:** Give each phase its own rollback matrix:

- safe caller rollback window;
- data written by the phase;
- old-code compatibility;
- feature disable sequence;
- booking reconciliation;
- staff instruction;
- forward-fix plan where rollback is unsafe.

State plainly that Phases 2 and 3 may require feature disablement and forward repair rather than `v05`.

**Open questions:**

- How long after activation is a caller-only rollback considered safe?
- Who reconciles bookings created while a phase was enabled?
- Is the accepted recovery approach rollback, feature disable, or forward fix?

## 4. Other confirmed issues

### F-08 — Core requirements are still proposals but are presented as decisions

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Product approval / ambiguity  
**Relevant section:** §1; §2.1, §2.3, §2.5; §8

**Description:** Section 1 says decisions have been made, while Section 8 still asks for confirmation of priority-first ordering, the 24-hour release, pacing reserve zero, held tables, drinks ceiling, staff workflow, and private-fix release strategy.

**Rationale:** These choices change customer acceptance and staff work. Recommended defaults are not approved requirements.

**Impact:** A developer can implement a recommendation that the owner later rejects.

**Recommended action:** Add a decision register with `approved`, `rejected`, or `pending`, decision owner, and date. Do not begin affected phases while a required decision is pending.

**Open questions:** All seven questions in §8 remain unresolved unless there is separate recorded approval.

### F-09 — `max_party_size` is not used by the allocation rule

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Functional correctness / data integrity  
**Relevant section:** §2 Step 1 and default table; §3 M1; §4 Tables

**Description:** The table model and UI add `max_party_size`, but candidate validity checks only physical capacity and minimum party size. The specification never says whether `max_party_size` is enforced or how it differs from capacity.

**Rationale:** An editable field that does not affect allocation is misleading. If it is intended to restrict usable covers below physical capacity, ignoring it is a booking bug.

**Impact:** Managers may believe a configured limit is active when it is not.

**Recommended action:** Either remove `max_party_size`, or define candidate capacity as `LEAST(capacity, max_party_size)` when non-null. Add constraints for positive values and `min_party_size <= effective_max <= capacity`.

**Open questions:** Is there any real table whose bookable maximum differs from its physical capacity?

### F-10 — Joined-table validity and deterministic ordering are incomplete

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Allocation algorithm / edge cases  
**Relevant section:** §2 Step 3

**Description:** The draft does not define:

- whether every table in a combination must be mutually joinable or merely connected;
- whether joined capacity is the sum of seats or a configured usable capacity;
- how per-table minimum and maximum party sizes apply to a combination;
- whether a party of two may receive two joined tables when no single table is free;
- what `table_number ASC` means for an array of tables;
- how equal or duplicate priorities are resolved.

`table_number` is text in the current schema, so values such as `10` and `2` sort lexically unless normalised.

**Rationale:** These details determine valid candidates and stable allocation.

**Impact:** Different implementations can choose different joins, allocate physically invalid combinations, or produce non-deterministic results.

**Recommended action:** Specify combination eligibility, capacity, minimum party, maximum join size, and a canonical array tie-break such as ordered table UUIDs after a numeric/display sort. Add examples for parties 1, 2, 7, 10, 20, and 21.

**Open questions:**

- Is the Dining Room join graph intended to require a clique?
- Can a small party ever be seated on a join?
- Do joins lose seats when tables are combined?

### F-11 — Turn-time settings are contradictory and incomplete

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Requirements / configuration  
**Relevant section:** §2.2; §4 Turn times

**Description:** The document shows four base values, four Sunday results, and one turnaround gap, then says all eleven numbers are editable. The settings section instead describes four bands, one Sunday uplift, and one gap: six inputs. It also says these values replace separate food and drinks durations but does not confirm that drinks use the same party-size bands.

**Rationale:** The database keys, UI controls, and duration calculation cannot be built from inconsistent input counts.

**Impact:** Developers can create incompatible settings models or accidentally lengthen drinks bookings.

**Recommended action:** Define the exact stored settings and calculation. Prefer four base durations plus one Sunday uplift plus one turnaround gap if the uplift is shared. State whether `Sunday` means every Sunday booking or only `sunday_lunch`, and whether food and drinks share durations.

**Open questions:**

- Are Sunday values independently editable or calculated?
- Does a Sunday evening drinks booking receive the uplift?
- Do Christmas and special services override these bands?

### F-12 — The turnaround gap has no defined storage or display model

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Data / functional behaviour  
**Relevant section:** §2.2; §3 M4

**Description:** The gap “lengthens the table’s reservation, not the booking,” but the current system stores `start_datetime` and `end_datetime` on both bookings and assignments and uses them in UI, notifications, high-chair counts, moves, and conflict checks. The draft does not say where the extra 15 minutes lives.

**Rationale:** Adding the gap to the booking end can show guests and staff a false duration. Keeping it out of stored assignment windows can allow back-to-back bookings.

**Impact:** Conflict checks, the floor view, edits, reminders, high-chair availability, and customer messages can disagree.

**Recommended action:** Define separate customer booking end and occupancy/assignment end semantics. Prefer keeping the customer duration unchanged and applying a clearly named `turnaround_gap_minutes` to table-conflict windows. Specify how move and edit RPCs calculate the assignment end.

**Open questions:**

- Does the gap block only tables or also high chairs and outside resources?
- Is the gap before, after, or both?
- Can staff override it for a specific booking?

### F-13 — Existing and future bookings have no transition rule

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Data migration / customer impact  
**Relevant section:** §2.2–§2.6; §3; §7

**Description:** The draft does not state whether new turn times, gaps, holds, outside capacity, and unassigned-drinks behaviour apply only to new bookings or also to existing future bookings. It also does not define what happens when an old booking is edited after rollout.

**Rationale:** A diary can contain bookings created under several rule versions. Stored start/end times and assignments are already commitments.

**Impact:** Availability may be calculated against mixed rules, edits can unexpectedly shorten or lengthen bookings, and staff may see unexplained assignment changes.

**Recommended action:** Define per feature:

- treatment of existing future bookings;
- whether any backfill is performed;
- edit and reschedule behaviour;
- customer communication if a promise changes;
- rule/version or configuration snapshot stored on the booking where needed.

**Open questions:** Should an existing assigned drinks booking keep its table? Should a reschedule adopt the new rule set?

### F-14 — The holds and blocks schema is not sufficiently defined

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Data model / validation  
**Relevant section:** §2.1; §3 M2; §4 Holds and blocks

**Description:** `table_holds` is described as an optional date range or recurring day and time window. The draft does not define required column combinations, timezone, inclusive boundaries, overnight windows, recurrence start/end dates, soft deletion, active state, or whether `other` auto-releases.

**Rationale:** Optional temporal columns without constraints create invalid and ambiguous records.

**Impact:** A hold can apply to the wrong service, never expire, or be interpreted differently by availability and creation.

**Recommended action:** Provide a concrete schema with check constraints. Separate operational blocks from online walk-in holds if their release behaviour differs. Store times as Europe/London service-local values with explicit rules for overnight windows and DST.

**Open questions:**

- Can recurring holds span midnight?
- Can maintenance blocks recur?
- Are date ranges inclusive at both ends?
- Is cancellation represented by deletion, `active`, or `cancelled_at`?

### F-15 — Hold and block creation does not address existing bookings

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** User journey / error handling  
**Relevant section:** §3 M2; §4; §5 FOH floor

**Description:** The specification does not say what happens when staff create a hold or maintenance block that overlaps a current assignment, joined booking, private booking, or communal event.

**Rationale:** A control that silently hides or invalidates an existing booking recreates the trust problem identified in discovery for `is_bookable`.

**Impact:** Staff can create an impossible floor plan or believe a table is protected when it is already promised.

**Recommended action:** On create and edit, detect conflicts and either reject or require an explicit override that lists affected bookings. Define how the bookings are moved, left in place, or escalated. Show blocks distinctly from online-only holds.

**Open questions:**

- May an online hold overlap an existing booking because it affects only new sales?
- Must maintenance always reject when an assigned booking exists?
- Who may use the override?

### F-16 — Pin behaviour is under-specified

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Functional / workflow  
**Relevant section:** §1 decision 8; §2.6; §3 M3; §5

**Description:** A booking-level boolean does not define behaviour when:

- a pinned party grows beyond table capacity;
- its time changes into a conflict;
- a joined booking is partly dragged;
- staff manually move it;
- a table is blocked for maintenance;
- an unassigned drinks booking has no table;
- an automatic retry or future re-optimiser runs.

**Rationale:** “Never moved automatically” is not enough to decide whether an edit fails, unpins, overbooks, or retains an invalid assignment.

**Impact:** Staff can be blocked without a recovery path or the pin guarantee can be silently broken.

**Recommended action:** Define a state machine. A pin should refer to the full assignment set, not merely the booking. State which operations are automatic, which require unpinning, and what exact 409/warning is shown for incompatible edits.

**Open questions:**

- Can authorised staff manually move a pinned booking?
- Does a successful manual move remain pinned to the new table?
- Can unassigned or outside bookings be pinned?

### F-17 — Staff overrides lack scope, authority, and audit requirements

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Permissions / safety / audit  
**Relevant section:** §2.1; §4; §5

**Description:** The draft says staff can override minimums and held-back tables with a warning. It does not define whether the override bypasses pacing, private bookings, maintenance, communal events, capacity, outside limits, or drinks limits. It also gives only `settings:manage` for the settings page, not permissions for FOH pin, hold, block, and override controls.

**Rationale:** Broad bypass flags are a common source of unsafe bookings.

**Impact:** Ordinary staff may bypass hard constraints or be unable to perform necessary same-day actions.

**Recommended action:** Define named override permissions and flags. Hard safety constraints such as physical capacity, private blocks, and maintenance should not share a general bypass. Audit actor, reason, before/after state, affected booking, and request source.

**Open questions:**

- Which role can pin, block, hold, release, and bypass a minimum?
- Is an override reason mandatory?
- Which constraints are never bypassable?

### F-18 — Outside booking journeys are incomplete

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Functional coverage  
**Relevant section:** §2.4; §5; §6

**Description:** The draft covers initial outside creation but not party-size changes, time changes, cancellation, no-show, conversion between indoor and outside, split indoor/outdoor requests, weather closure, staff overrides, or existing outside bookings.

**Rationale:** Every change can alter outside resource consumption and kitchen pacing.

**Impact:** Resource counts can become stale or customers can be moved between seating types without a valid allocation.

**Recommended action:** Add explicit acceptance journeys for create, edit, reschedule, convert, cancel, no-show, and weather closure. Make outside precedence clear if a stray indoor assignment exists.

**Open questions:**

- Can customers self-convert between indoor and outside?
- What happens when rain closes outside after bookings exist?
- Are deposits and cancellation terms different for outside?

### F-19 — Drinks booking lifecycle and customer communications are incomplete

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Functional / communications / migration  
**Relevant section:** §2.5; §5; §6; §7

**Description:** The draft does not define how existing assigned drinks bookings are treated, how a drinks booking is seated and later unseated, whether the table becomes pinned, what happens if no table is free, or how payment, confirmation, reminder, manage-link, and staff copy avoid promising “your table is held.”

**Rationale:** Removing the assignment changes the meaning of the booking throughout its lifecycle, not only on the floor screen.

**Impact:** Guests can receive misleading confirmation, and staff can lose track of whether an unassigned booking is expected or broken.

**Recommended action:** Define a distinct intentional state such as `awaiting_arrival_assignment`, separate from assignment failure. Inventory every customer and staff surface and update the wording. Specify the arrival allocation transaction and failure/escalation path.

**Open questions:**

- Does seating a drinks booking use the normal ranking or staff choice?
- Does it begin occupying a table at booked time or actual seated time?
- Do existing drinks bookings retain their current assignments?

### F-20 — The availability function contract is too vague

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** API / integration  
**Relevant section:** §3 M5; §5; §6

**Description:** “Returning what could be seated and why not” does not define the return columns or JSON, reason enum, duration basis, assignment preview, source/channel, release behaviour, high-chair output, pacing output, or whether the function evaluates one slot or a whole date.

**Rationale:** AMS, the website, tests, and settings preview all need a stable contract.

**Impact:** The two repositories can implement incompatible types, and a reason-code change can break customer messages.

**Recommended action:** Add a versioned request and response schema with examples for available, no table, pacing full, outside full, closed, cutoff, held, and system error. Separate internal diagnostic reason from customer-safe reason. Include a contract version.

**Open questions:**

- Does an available result include the chosen table or only `available=true`?
- Is the function one-slot or batch-per-date?
- Does staff availability include online holds and minimum release rules?

### F-21 — Availability freshness, failure, and race behaviour are undefined

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Error handling / consistency  
**Relevant section:** §3 M5; §5 availability; §6

**Description:** The current website builds schedule slots locally and uses an AMS load helper intended to fail open. The new spec does not say whether a database or AMS failure should show slots as available, unavailable, or temporarily unknown. It also does not define cache policy, re-check at final submit, or the response when a previously available slot loses a race.

**Rationale:** Read-only availability can never reserve capacity. A safe customer flow must treat create as authoritative and avoid falsely presenting degraded results as real availability.

**Impact:** The “website stops lying” goal can still fail during cache staleness, partial deployment, or transient outage.

**Recommended action:** Use an explicit `available | unavailable | unknown` state. Re-check availability when relevant fields change and on submit; return a stable 409 with alternatives if creation loses capacity. Define cache keys by date, party size, purpose, outside, and contract version, with short or no caching for scarce resources.

**Open questions:**

- Should the website fail closed or show “call us” when AMS is unavailable?
- What maximum staleness is acceptable?
- Are alternative nearby times returned by the create failure?

### F-22 — Customer reason messages need a safe mapping layer

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Security / UX / content management  
**Relevant section:** §4 Customer messages; §5 blocked reasons; §6

**Description:** Editable text is proposed for every unavailable reason, but the draft does not separate internal causes from public messages, define fallbacks, validate length or markup, or prevent private-booking and maintenance details from leaking. It also does not state how messages are rendered safely.

**Rationale:** Internal diagnostic codes should not be exposed directly, and manager-entered text is untrusted input.

**Impact:** Customers may see sensitive or confusing reasons, or unsafe HTML if a client renders configured content incorrectly.

**Recommended action:** Maintain a small public reason enum and map multiple internal reasons to it. Store plain text only, apply length limits, escape on output, provide immutable safe defaults, and show a preview. Audit changes.

**Open questions:**

- Which exact reasons may customers see?
- Should private bookings appear only as “not available”?
- Are messages English-only?

### F-23 — The large-party rule contradicts physical capacity and shared logic

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Product / functional contradiction  
**Relevant section:** §2 Step 3; §5 join depth; §6 Large parties

**Description:** The Dining Room has 26 seats and join search is expanded to reach five tables, but current and queued create logic rejects parties of 21 or more. The website will give 21+ a “clear route,” while the draft also says every path uses one rule.

**Rationale:** It is unclear whether 21–26 is bookable by staff, online after contact, or never.

**Impact:** The system may advertise a route that staff cannot complete, or continue refusing parties the new join depth was intended to support.

**Recommended action:** Define online and staff maximums separately if needed. State the CTA, contact workflow, deposit handling, and whether an authorised staff path can allocate 21–26 through the same candidate engine.

**Open questions:**

- Can staff confirm parties of 21–26?
- Is 20 an operational limit unrelated to table capacity?
- What happens for outside parties over 20?

### F-24 — Settings validation, atomicity, and concurrency are missing

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Configuration / data integrity  
**Relevant section:** §3 M6; §4

**Description:** “One save per section” does not define allowed ranges, cross-field constraints, optimistic concurrency, transaction boundaries, or behaviour when only part of a section saves. Examples include reserve greater than pace, minimum greater than maximum, zero outside tables, duplicate priorities, and overlapping party-size bands.

**Rationale:** Invalid settings can stop all bookings or create different behaviour in SQL and TypeScript fallbacks.

**Impact:** A manager typo or stale browser can put production into an invalid state.

**Recommended action:** Define validation in both the application and authoritative database/RPC layer. Save each section atomically with a version or `updated_at` precondition. Reject invalid cross-field combinations and show the live effect before activation.

**Open questions:**

- Are duplicate priorities allowed?
- What are minimum and maximum values for every setting?
- Does settings corruption fail open or fail closed?

### F-25 — Editing table configuration can invalidate future bookings

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** User journey / data safety  
**Relevant section:** §4 Tables

**Description:** Managers can change capacity, bookable state, minimum, maximum, and order. The draft does not define warnings or blocking when a table has future assignments or participates in join groups.

**Rationale:** The discovery already notes that disabling a table can dump bookings into Unassigned. Lowering capacity or changing joins can also make current assignments invalid.

**Impact:** Configuration changes can silently break confirmed bookings.

**Recommended action:** Before save, show affected future bookings and join groups. Reject unsafe changes or require a separate migration workflow that moves or acknowledges each affected booking. Keep priority-only changes safe and independent.

**Open questions:**

- Can a table be made unbookable while keeping existing assignments?
- Does capacity reduction affect existing bookings?
- May a table number used in messages be renamed?

### F-26 — Database and public-endpoint security requirements are incomplete

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Security  
**Relevant section:** §3; §4; §5; §6

**Description:** The draft mentions reproducing grants for M4 but not M5 or `table_holds`. It does not specify RLS, `SECURITY DEFINER`, fixed `search_path`, revokes from `PUBLIC`, allowed roles, input validation, rate limiting, or abuse protection for party-size/date enumeration.

**Rationale:** Availability must read protected booking and private-event data without exposing it. Security-definer functions require deliberate grant and search-path handling.

**Impact:** The feature can expose operational data or create an overly broad callable function.

**Recommended action:** Add a security section covering:

- RLS and write policies for holds and pin changes;
- exact function owner, security mode, `search_path`, revoke, and grants;
- server-only access for diagnostic output;
- public-safe response filtering;
- rate limiting and request logging at the website boundary.

**Open questions:** Is M5 callable only by `service_role`, or by authenticated staff as well?

### F-27 — The integration and user-surface inventory is incomplete

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Integration / scope  
**Relevant section:** §5; §6

**Description:** The specification lists five AMS allocator paths and two main website components. Current code also has BOH time/duration edits, FOH time moves, booking-agent availability and create paths, API client mappings, legacy booking components, payment pages, confirmations, reminders, and campaign-prefilled booking links.

**Rationale:** Shared contract changes must cover every caller and every customer promise.

**Impact:** Some channels may ignore party size, purpose, outside capacity, new reason codes, pin rules, or unassigned-drinks wording.

**Recommended action:** Add a caller and surface matrix with route/file, operation, auth, current allocator, target shared primitive, request version, response version, UI copy, and test owner. Search both repositories at the pinned commits before implementation.

**Open questions:** Which legacy website booking components are still live? Must the AI booking agent support all new options?

### F-28 — Locking and edit transactions are not designed

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Concurrency / data integrity  
**Relevant section:** §3 M4; §5

**Description:** “Move the advisory lock ahead of table selection” does not name the lock key, scope, or acquisition order. The system already has pacing and high-chair locks, while outside and drinks add more resources. Current BOH edits can update assignment windows and booking rows in separate operations.

**Rationale:** Multiple locks acquired in inconsistent order can deadlock. Separate writes can leave assignment and booking windows inconsistent after partial failure.

**Impact:** Concurrent bookings or edits can fail unpredictably or leave corrupt state.

**Recommended action:** Document a single transaction and lock order for booking, pacing, outside, drinks, and high-chair resources. Key locks narrowly enough for performance but broadly enough for safety. Move time, party-size, purpose, and assignment updates into atomic RPCs.

**Open questions:**

- Is the allocator lock keyed by date, service, time window, or venue?
- Does taking the lock before selection remove the need for a retry loop?
- What is the lock order when a booking needs table, outside, and high-chair resources?

### F-29 — Performance requirements and query design are absent

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Performance / scalability  
**Relevant section:** §2 Step 3; §3 M2, M4, M5; §5; §6

**Description:** The draft has no latency target, query plan, index list, or bound for combination search. A one-slot availability function can create an N+1 loop across every slot and calendar day. Recurring holds and eight-table join searches can add more work.

**Rationale:** Website availability is a customer-facing path and will run much more frequently than successful booking creation.

**Impact:** Slow date picking, database load spikes, and timeouts can replace false availability with no availability.

**Recommended action:** Prefer a batch date or date-range availability function. Add indexes for assignment overlap, active booking status, holds by table/date/time, and relevant private/communal ranges. Set p95 targets and test realistic month-view and concurrent traffic.

**Open questions:**

- How many days does the date picker load at once?
- What is the acceptable p95 for a date and a month?
- What table-count growth should join search support?

### F-30 — Cross-repository deployment and contract activation are not sequenced

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Deployment / integration  
**Relevant section:** §6; §7

**Description:** AMS auto-deploys from main, the website deploy is manual, and the database is a separate production change. The draft does not define which goes first, how old and new clients coexist, how the website selects `v05` or `v06`, or how a partial deployment behaves.

**Rationale:** Three independently deployed components require backward-compatible contracts and controlled activation.

**Impact:** A website can call a missing function, AMS can return fields the website does not understand, or new booking behaviour can activate before the staff UI is ready.

**Recommended action:** Use this broad sequence:

1. additive database schema and dormant functions;
2. AMS support that can read both contracts;
3. website support that can read both contracts;
4. staff UI and training;
5. feature activation;
6. production smoke tests;
7. removal only after an observation period.

Document exact feature flags and a deployment checklist for both repositories.

**Open questions:** Is there a staging Supabase project and website preview using production-like data?

### F-31 — There is no acceptance or test plan

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Testing / quality  
**Relevant section:** §5; §6; §7

**Description:** The only explicit testing note is that existing website API tests need updating. There are no required SQL, unit, integration, concurrency, contract, component, end-to-end, migration, accessibility, or production smoke tests.

**Rationale:** The allocator is a rules engine with high regression risk and several concurrent resources.

**Impact:** A release can pass ordinary route tests while still double-allocating outside tables, ignoring private blocks, moving pins, or disagreeing with website availability.

**Recommended action:** Add a finding-to-test matrix. At minimum test:

- every party-size band and every default table;
- join ranking and tie-breaks;
- private and communal blocks;
- all active/inactive booking statuses and expired holds;
- holds before and after release;
- pins and incompatible edits;
- turnaround boundary equality;
- regular Sunday, Sunday lunch, Christmas, and DST days;
- outside and drinks concurrent caps;
- availability/create parity;
- real concurrent create and edit transactions;
- old/new API compatibility;
- migration upgrade and phase disable;
- keyboard and screen-reader behaviour.

**Open questions:** What real database test environment is available for concurrency and migration tests?

### F-32 — Accessibility requirements are missing

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Accessibility  
**Relevant section:** §4; §5; §6

**Description:** The design relies on drag-to-reorder, greying unavailable slots, warning controls, and visual pin/hold states. It does not specify keyboard alternatives, contrast, accessible names, focus management, error announcements, or associations between a slot and its reason.

**Rationale:** Colour and drag-only interactions are not accessible.

**Impact:** Staff or customers using keyboards, screen readers, or low-contrast displays may be unable to configure tables or understand availability.

**Recommended action:** Require keyboard reorder buttons, visible numeric order, non-colour state labels, WCAG-compliant contrast, `aria-describedby` for reasons, live-region save errors, and accessible pin/hold controls. Add component and manual accessibility checks.

**Open questions:** Is WCAG 2.2 AA the project target?

### F-33 — Monitoring and operational success measures are missing

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Observability / operations  
**Relevant section:** §2.3; §2.5; §7

**Description:** “Keep an eye on the first fortnight” and “watch” the drinks cap do not define metrics, dashboards, alerts, owners, or rollback thresholds.

**Rationale:** The changes alter acceptance rates and staff work. Problems may appear as lost demand rather than application errors.

**Impact:** The venue can lose bookings or struggle with unassigned guests without a clear signal.

**Recommended action:** Record by channel, purpose, party size, and slot:

- availability results and reasons;
- create success/failure and availability/create mismatch;
- chosen tables and joins;
- pacing, outside, and drinks refusals;
- unassigned drinks wait time and seating failures;
- override use;
- API latency and database errors.

Set owner-reviewed thresholds for the first day, first weekend, and first fortnight.

**Open questions:** Who owns the launch dashboard and who can disable each phase?

### F-34 — Migration preflight and reproducible evidence are missing

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Migration / evidence  
**Relevant section:** document header; §3; §7

**Description:** The specification names two repositories but no commit or production function snapshot. Priority backfill appears to depend on table names, and the current repository contains later-dated migrations that may change `v05`. No preflight checks verify the expected ten tables, join graph, settings, function signature, grants, or future booking conflicts.

**Rationale:** The discovery says live production was authoritative, but a developer needs reproducible input and must detect drift before applying SQL.

**Impact:** Backfill can target the wrong rows or a later migration can overwrite assumptions.

**Recommended action:** Pin both repository commits and save the relevant production schema/function definitions. Make the migration abort if expected table IDs/names/counts or function signatures differ. Include pre- and post-migration grant and smoke checks.

**Open questions:** Which queued migrations will be in production before this work starts?

### F-35 — Important status, time, and payment edge cases are not specified

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Edge cases / error handling  
**Relevant section:** §2; §3 M4–M5; §5

**Description:** The common “overlapping booking” rule is not written explicitly for `cancelled`, `no_show`, `left_at`, `completed`, pending payment, pending card capture, expired holds, paid-but-cleaned-up holds, or bookings that cross midnight. Equality at start/end boundaries and London DST transitions are also omitted.

**Rationale:** Current paths already disagree on liveness, and the discovery identifies paid-hold cleanup risk.

**Impact:** Tables or capacity can remain blocked incorrectly, or be released while a valid payment exists.

**Recommended action:** Define one booking-liveness predicate and one half-open overlap rule, then reuse them in table, pacing, outside, drinks, high-chair, and availability logic. Add DST and overnight tests.

**Open questions:** Does `completed` always release immediately? Does `left_at` override status? Which payment state keeps an expired hold active?

### F-36 — The delivery plan lacks estimates, owners, gates, and staff readiness

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Delivery management  
**Relevant section:** §7; §8

**Description:** The phases have no effort estimates, dependencies, responsible owner, approval gate, support window, training material, or definition of done. “Tell the team” is not a rollout task with an owner or proof.

**Rationale:** Phase 2 and Phase 3 change live service work, while AMS and website releases are controlled differently.

**Impact:** Technically complete code can ship without operational readiness or production verification.

**Recommended action:** For each phase, add owner, estimate, prerequisite decisions, schema/app/site changes, training, test gate, activation window, smoke tests, monitoring owner, and go/no-go criteria. Avoid activating Phase 3 immediately before a busy service.

**Open questions:** Who approves product rules, database changes, website deployment, and FOH readiness?

### F-37 — Known discovery defects are neither included nor explicitly deferred

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Scope / traceability  
**Relevant section:** discovery §4.10 and §5; specification §5–§7

**Description:** The discovery identifies expired paid-hold cleanup conflict, silent high-chair shortfall, booking-reference retry, drag-collapse of joins, and `is_bookable` orphaning. The specification addresses some adjacent code but does not state whether these are fixed, unaffected, or deliberately out of scope.

**Rationale:** Rebuilding allocators and the floor screen is the point at which these behaviours can regress or be mistaken as included.

**Impact:** Stakeholders may expect a known fault to be fixed, while developers may unknowingly preserve or worsen it.

**Recommended action:** Add an explicit traceability table from every discovery finding to `fixed in phase`, `separate hotfix`, `accepted`, or `out of scope`. Do not silently absorb unrelated fixes into M4.

**Open questions:** Which discovery defects are release blockers for Phase 1?

## 5. Optional improvements

### O-01 — Remove `max_party_size` unless a real use case exists

**Status:** Optional improvement  
**Priority:** P3  
**Type:** Simplification  
**Relevant section:** §2; §3 M1; §4

**Description:** Every default maximum equals physical capacity.

**Rationale:** Capacity already provides the same rule and has existing UI and data.

**Impact:** Keeping a duplicate field adds validation, migration, UI, and drift risk.

**Recommended action:** Omit it from this release unless an actual table needs a lower bookable maximum. It can be added later with a defined use case.

**Open questions:** None beyond F-09.

### O-02 — Ship the private-booking regression as an isolated hotfix

**Status:** Optional improvement  
**Priority:** P3  
**Type:** Delivery simplification  
**Relevant section:** §8 item 7

**Description:** The private-booking check is urgent and materially smaller than the prioritisation programme.

**Rationale:** Isolating it reduces lead time and prevents a broad feature design from delaying a confirmed production fault.

**Impact:** Customers stop being falsely refused around private bookings sooner.

**Recommended action:** Create a small, parity-tested function patch or new correctness-only version, deploy it before the larger programme, and remove it from Phase 1’s critical path.

**Open questions:** Can this be safely applied before any queued high-chair/outside migration?

### O-03 — Run the new allocator in shadow mode first

**Status:** Optional improvement  
**Priority:** P3  
**Type:** Observability / risk reduction  
**Relevant section:** §7

**Description:** Availability and create calls can calculate both old and new choices while still writing with the old allocator.

**Rationale:** This reveals unexpected assignment, refusal, and performance differences using real demand.

**Impact:** Defaults can be corrected before customers or staff are affected.

**Recommended action:** Log only non-sensitive old/new result differences for one representative week, then review table distribution and refusal reasons.

**Open questions:** Is dual calculation latency acceptable on the public path, or should sampling be used?

### O-04 — Consider explicit ranked join groups

**Status:** Optional improvement  
**Priority:** P3  
**Type:** Product simplification  
**Relevant section:** §2 Step 3; §4

**Description:** The venue has a small, stable set of useful joins. Ranking joins directly may be easier to explain than deriving priority from the worst member.

**Rationale:** Explicit join ranking avoids surprising interactions when one table’s single-table priority changes.

**Impact:** Managers gain predictable control at the cost of one additional list.

**Recommended action:** Compare `worst_member_priority` against an editable join-group priority before committing to the schema.

**Open questions:** Do managers want Low 4a+4b and Dining Room combinations ranked separately?

### O-05 — Use a generic resource inventory for outside, drinks, and high chairs

**Status:** Optional improvement  
**Priority:** P3  
**Type:** Architecture / simplification  
**Relevant section:** §2.4–§2.5; §3

**Description:** Outside tables, drinks/bar capacity, and high chairs are all scarce resources with overlapping-window reservations.

**Rationale:** A common resource/reservation model could reduce repeated locking, overlap, audit, and effective-date logic.

**Impact:** It is more initial design work but may make later capacity features safer and simpler.

**Recommended action:** Evaluate a small generic model before adding several unrelated setting keys and one-off counters.

**Open questions:** Is this too broad for the current release, or can it be limited to outside and drinks?

### O-06 — Expand the settings preview beyond one empty Wednesday

**Status:** Optional improvement  
**Priority:** P3  
**Type:** UX / validation  
**Relevant section:** §4 Tables

**Description:** One party-of-four example does not expose join behaviour, minimum release, Sunday durations, or a partly occupied room.

**Rationale:** The most costly settings mistakes occur under constrained conditions.

**Impact:** Managers can understand changes before activation.

**Recommended action:** Include preset scenarios for parties 2, 4, 7, 10, and 20, plus a real selected service. Show chosen table, rejected candidates, and reason.

**Open questions:** Should preview use unsaved draft settings or only saved settings?

### O-07 — Defer unassigned drinks until measured physical capacity exists

**Status:** Optional improvement  
**Priority:** P3  
**Type:** Scope reduction  
**Relevant section:** §2.5; §7 Phase 3

**Description:** Table prioritisation and correct availability do not require drinks to become unassigned.

**Rationale:** Leaving drinks assigned preserves the current customer guarantee and removes the highest operational-risk part of the programme.

**Impact:** Phase 3 becomes smaller while the venue gathers bar occupancy and wait-time data.

**Recommended action:** Keep the setting capability dormant or omit it until a physical capacity rule and staff process are approved.

**Open questions:** Can the business collect two to four weeks of drinks seating data first?

## 6. Required changes before implementation

The specification should not be approved until it:

1. Records owner approval for every decision in §8.
2. Replaces the migration/phase contradiction with a deployable schema and activation sequence.
3. Defines one shared side-effect-free allocation candidate primitive.
4. Publishes the complete `v06` input, output, security, and compatibility contract.
5. Separates kitchen arrival pacing from table occupancy and confirms the intended rule.
6. Defines durable outside and drinks capacity models.
7. Defines booking, assignment, turnaround, pin, hold, and override state transitions.
8. Defines how existing future bookings and later edits are treated.
9. Adds a caller/surface matrix for both repositories.
10. Adds exact security, validation, locking, indexing, and error-handling requirements.
11. Adds contract, concurrency, migration, accessibility, end-to-end, and smoke-test acceptance criteria.
12. Replaces the blanket rollback statement with a phase-specific recovery plan.
13. Adds owners, estimates, deployment gates, staff training, and monitoring thresholds.

## 7. Unresolved decisions

The following decisions need named owners:

- Priority-first versus capacity-first.
- Release lead time and whether minimums and online holds share one value.
- Which tables are held and for which services.
- Whether pacing measures arrivals, kitchen workload, or concurrent occupancy.
- Exact pacing window boundaries and bypass rules.
- Whether Sunday turn times apply to all Sunday bookings.
- Whether drinks bookings guarantee seating.
- The physical drinks/bar capacity and whether unassigned drinks should ship.
- How the outside 8-to-6 change affects existing future bookings.
- Whether 21–26 guests can be booked by staff.
- Pin behaviour during incompatible edits and manual moves.
- Which roles may hold, block, pin, release, and override.
- Whether existing assigned drinks bookings keep their tables.
- Fail-open, fail-closed, or unknown behaviour when availability cannot be calculated.

## 8. Major risks

1. **Lost bookings:** an over-restrictive pacing interpretation can reject valid demand.
2. **Broken customer promise:** unassigned drinks can arrive without physical space.
3. **Capacity oversell:** outside reservations can be recalculated differently after a settings change.
4. **Cross-path drift:** separate create, availability, move, and edit implementations can continue to disagree.
5. **Regression:** a `v06` rewrite can drop existing high-chair, Christmas, deposit, or payment behaviour.
6. **Unsafe recovery:** `v05` cannot interpret all new state after later phases.
7. **Operational failure:** staff workflow can change before the floor UI, copy, permissions, and training are ready.
8. **Partial deployment:** database, AMS, and website versions can become incompatible.
9. **Poor visibility:** acceptance-rate and service problems can occur without an application error.

## 9. Recommended next steps

1. Ship or formally schedule the private-booking regression fix separately.
2. Hold a short owner decision session for the unresolved capacity and workflow rules.
3. Produce a `v06` contract and shared-candidate-function design before writing migrations.
4. Split the implementation into genuinely deployable phases with feature flags.
5. Build the caller/surface and discovery-traceability matrices.
6. Validate pacing, outside, and drinks rules against representative real services.
7. Add the test, deployment, recovery, training, and monitoring plans.
8. Re-review the revised specification before implementation begins.
