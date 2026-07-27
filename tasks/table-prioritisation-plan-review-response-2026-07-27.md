# Response to the plan review

Date: 2026-07-27. Reviewed document: `tasks/table-prioritisation-plan-2026-07-27.md`.
Review: `tasks/table-prioritisation-plan-review-2026-07-27.md` (40 findings, 11 P0).

**Summary: 8 of the 11 P0 blockers are correct and are being fixed. 3 are based on a decision record the
reviewer did not have.** Two of the reviewer's other claims are factually wrong and are rebutted with
evidence below. Everything else is accepted.

The reviewer also found real errors in my file inventory that I should have caught myself. Those are
corrected.

---

## 1. The three findings I am rejecting, with evidence

The reviewer worked from the owner's first set of seven answers. Four further rounds of decisions
followed. Verbatim, from the owner:

### F-01, held tables. Rejected.

Round one: *"lets hold low 4a and 4b. The high 4 can be difficult for people with mobility issues."*
Round two, after I flagged that holding both Low tables breaks the seven-and-eight join pair:
**"Switch the low 4a and high 4 out instead."**
Round three, after I recommended reverting to Low 4a and Low 4b on accessibility grounds:
**"Leave the walk in tables as 4a and high 4, bookings take priority."**

The plan is correct. The owner considered the accessibility argument, was given my recommendation against,
and overruled it on the principle that pre-booked guests get first pick of the good tables. Their reasoning
is sound: **a hold withholds a table from online sale, it does not restrict walk-ins to it**, so accessible
seating stays available to whoever needs it.

No change, other than recording the quotes.

### F-02, drinks bump. Rejected.

Round one: drinks unassigned, ceiling changed to 40.
Round two, when I put the arithmetic in front of the owner (40 arrivals per 30 minutes at a 90 minute turn
allows up to 120 drinks guests against 49 seats) and offered three options:
**"they should keep their tables unless someone else is booked."**

That sentence is the bump rule. Drinks keep a table, and yield it when a food booking needs it. The
reviewer's own F-06 in the earlier spec review argued that unassigned drinks was unsafe, so the two reviews
are asking for opposite things; this one resolves it.

No change to the design. I am adding the reviewer's F-18 refinements, which are correct and separate.

### F-03, accessibility and large parties. Mostly rejected, one part accepted.

Verbatim: *"All tables are step free except the small bay, add that flag."*
*"The high 4 can't use a high chair either, all other tables can."*
*"All outside tables are unheated."*
*"Any groups over 20 are a private booking but in a live situation, we'd never turn that away. The rules
for staff in the moment for a walk in should let them accept the booking."*

So the four table attributes, the accessibility question, the unheated disclosure and the staff large-party
path are all approved, and the physical facts came from the owner directly. The reviewer's "open questions"
about whether Small Bay is really the only non-step-free table are answered by the owner's own sentence.

**Accepted part:** the staff maximum of **40** and the `override_unjoined` permission were mine. I flagged
40 as an assumption in spec section 18, but the reviewer is right that it appears in the plan without that
caveat attached. Both are now marked as proposals in the plan.

### The real defect underneath all three

The reviewer could not verify any of this because **my decision register recorded conclusions, not the
owner's words.** That is a genuine documentation failure and it cost a reviewer a day. Every decision in
the spec now carries the verbatim quote and the round it was decided in.

---

## 2. Two factual corrections to the review

**The production migration method.** F-07 says the project uses Supabase `apply_migration` and that `db
push` is wrong. It is the other way round on this project. Using MCP `apply_migration` has repeatedly
created migration-history drift here, most recently on 2026-07-23. `db push` is the correct workflow and
the plan keeps it. The rest of F-07 is accepted.

**`src/app/api/external/table-bookings/route.ts`.** F-27 says it does not exist, and F-27 is right, but
the reviewer understates the finding. Verified at the pinned commit: there are exactly **two** callers of
the booking RPC in the whole codebase.

```
src/app/api/table-bookings/route.ts:251
src/app/api/foh/bookings/route.ts:1209
```

The `external/table-bookings` tree contains only PayPal child routes. So plan task D2 was fictional and is
deleted. This makes stream D materially smaller than I estimated, which is good news.

The grep also turned up `create_table_booking_v05_core`, `_core_legacy` and
`_core_sunday_deposit_legacy` in the generated types. Those need to be checked for live callers before
stream B starts, and are added to the D9 sweep.

---

## 3. The eight P0 blockers I accept

### F-04. Channel and override spoofing. Accepted, serious.

**The reviewer is right and this is the most important finding in the review.** I designed
`create_table_booking_v06` to take `p_channel`, `p_pin` and `p_overrides` while keeping the existing
`EXECUTE` grants to `anon` and `authenticated`. A `SECURITY DEFINER` function that trusts a caller-supplied
channel is a privilege escalation: anyone could call it directly claiming `p_channel='staff'` and bypass
the online party limit, the holds and the minimums.

**Fix.** Split into two functions.

| Function | Parameters | Granted to |
|----------|-----------|------------|
| `create_table_booking_public_v06` | the 13 existing `v05` parameters only. Channel hard-coded to `online`. No pin, no overrides | `anon`, `authenticated`, `service_role` |
| `create_table_booking_staff_v06` | adds `p_channel`, `p_pin`, `p_overrides`, `p_actor_id`, `p_override_reason` | `service_role` **only** |

Both call the same internal core. Authority is proven at the AMS route boundary by the existing RBAC
check, never by a parameter. `p_overrides` takes a fixed key set and rejects unknown keys.

This also gives F-31 its answer: `p_actor_id` is passed by the trusted route and the audit row is written
in the same transaction.

### F-05. `payment_status = 'paid'` does not exist. Accepted.

**Verified in production.** `table_bookings.payment_status` is the enum `payment_status`:

```
pending | completed | failed | refunded | partial_refund
```

`paid` belongs to `parking_payment_status`, a different enum entirely. My liveness predicate would have
failed at function creation. The correct value is **`completed`**.

Refunded bookings raise a question the reviewer is right to ask: a `refunded` booking that is still
`confirmed` should stay live and keep its table, because the guest is still coming until someone cancels
it. `partial_refund` likewise. Only `status` releases a table, never `payment_status` on its own.

### F-06. The gate does not preserve behaviour once old paths are deleted. Accepted.

Correct. My B6 gated only table selection, while stream D deletes whole caller behaviours, including the
FOH raw-insert walk-in path that deliberately bypasses the past-time and hours guards and can mark a
booking seated immediately.

**Fix.** The gate moves up to the route level. Every migrated caller keeps its old code path intact behind
`if (v06Enabled) { new } else { old }` until the gate is removed after a clean fortnight. Gate-off parity
is tested for every caller, not just public create. Stream D's deletions move to task I9, after
activation has proved itself.

### F-07. Missing migrations for stream B. Accepted (except the `db push` point above).

Every stream B object now has a numbered migration file and an explicit apply order,
`20260801000500` through `20260801001200`. Generated types are regenerated after apply.

### F-08. Date-keyed locks miss cross-midnight races. Accepted.

Correct. Two bookings on either side of midnight overlap in time but take different locks.

**Fix.** The allocation lock is keyed on the **venue**, not the date: a single
`pg_advisory_xact_lock(hashtext('table_alloc'))`. At 3.6 bookings a day the contention cost is nil and it
removes an entire class of race. Cross-date moves need no special ordering because there is only one key.

### F-09. Outside occupancy window and capacity recosting. Accepted.

Correct on both counts. Storing a table count with no time window means the turnaround gap is invisible to
outside bookings, and acknowledging a capacity change does not conjure physical seats.

**Fix.** Outside reservations become rows in a small `outside_reservations` table carrying
`table_booking_id`, `tables_reserved`, `capacity_basis`, `starts_at` and `ends_at` (occupancy, including
the gap). Lowering capacity from 8 to 6 must **re-cost** every affected future booking and either
reallocate it or surface it for cancellation. It cannot be waved through.

### F-10. The primitive's signature is incomplete. Accepted.

Correct. I wrote the signature before the accessibility decisions and never went back. It gains
`p_high_chair_count`, `p_requires_accessible_table` and `p_preferred_table_ids`, and `p_overrides` becomes
a typed composite rather than free-form `jsonb`.

### F-11. The 21-plus guard contradicts the staff path. Accepted.

Correct contradiction in my own spec: section 6 says the guard is preserved verbatim, section 5.4 says
staff can book above it.

**Fix.** The guard moves out of the core and becomes a parameter, `p_max_party_size`, supplied by the
calling function: the public function passes `table_booking_max_party_online`, the staff function passes
`table_booking_max_party_staff`. Parity fixtures assert the public path still refuses 21 exactly as `v05`
does.

---

## 4. Notable P1s accepted

| Finding | Fix |
|---------|-----|
| F-12 Stream A is not inert | Stream A seeds **only new keys**. The pacing change from 19/14 to 15 moves into the activation step, with the old values captured first |
| F-13 Preflights not executable | A dated baseline artefact captures table UUIDs, join links, live settings and future outside and drinks bookings. Backfill counts are derived at apply time and reported, not asserted from stale discovery numbers |
| F-14 No database invariants | Check constraints added: outside columns paired and positive and only for outside bookings, `assignment_soft` only for drinks, pinned only with an indoor assignment |
| F-15 Hold model too narrow | `ends_on` becomes nullable for open-ended walk-in holds. Weather closure gets its own venue-wide outside scope rather than being forced through `table_id`. The two approved held tables are seeded explicitly |
| F-16 Maintenance block over a live booking | A block is created `pending` and only becomes active once every conflicting booking is moved or cancelled. No impossible states |
| F-17 Settings concurrency | A single `settings_revision` row per section replaces per-key `updated_at` comparison. Whole section updated and audited in one transaction |
| F-18 Bump algorithm underspecified | Bounded: at most 2 bookings moved, deterministic search order, the whole relocation plan computed without writes then validated and committed atomically |
| F-19 Availability does not model bumping | **Availability will not rely on bumping.** A slot that needs a bump shows as unavailable and creation may still succeed. That direction is safe; the reverse is not. Documented as an accepted asymmetry |
| F-20 Wrong acceptance test | Correct catch, and an important one. Split into two tests: Dining Room blocked with Main Bar free must be **available**; Dining Room blocked with everything else occupied must be `tables_full`. My original wording would have encoded the bug as the expected result |
| F-21 "Unknown for every slot" impossible | A top-level `calculation_state` is added. Whole-date unknown with no slot list is a valid response, mapped by the website to the call-us path |
| F-22 Walk-in override has no replacement contract | A trusted walk-in mode with explicit bypass rules, `seated_at` handling and its own parity fixtures. The old path stays until those pass |
| F-23 Staff picker has no atomic contract | `p_preferred_table_ids` validated under the lock, `409` if lost |
| F-24 Party-size change is more than allocation | Linked event seats, deposit transitions and SMS all preserved. Named as their own subtasks |
| F-25 Pinned move contradiction | Resolved: manual moves by authorised staff are allowed and keep the pin; automatic reallocation and conflicting time or party-size edits are refused |
| F-26 Turnaround gap display | FOH contract carries customer end and occupancy end separately, with the gap shaded |
| F-28 Messages have no transport | Resolved public text is returned inside each availability slot |
| F-29 Month view N+1 | A bounded date-range summary endpoint |
| F-30 Permissions not assigned to roles | Each new action assigned: `pin` and `block` to staff and above, the three overrides to manager and above |
| F-32 Byte-identical parity impossible | Correct. Replaced with normalised comparison: generated ids, references and timestamps excluded from equality but asserted for format and relationship |
| F-33 Both-repo CI | The website's own lint, test and build pipeline added to the gate |
| F-34 Recovery names controls that do not exist | Independent flags added for turn times, holds, accessibility filtering and the bump. Anything without a flag is documented as global-disable only |

Accepted without further comment: F-35 monitoring needs building not just listing, F-36 estimates and
owners, F-37 index design proven with `EXPLAIN (ANALYZE, BUFFERS)`, F-38 measurable success criteria,
F-39 migration rehearsal in a disposable environment, F-40 contract versioning and sunset.

Optional improvements accepted: O-02 split the 1400-line settings component, O-04 shadow comparison before
activation, O-05 generated shared types. O-01 rejected, `heated` stays as a table column so individual
outside tables can become first-class rows later without a schema change.

---

## 5. What this changes

- **Stream D shrinks.** Two RPC callers, not the five I listed. D2 deleted.
- **Stream B grows.** The public/staff function split, eight numbered migrations, the typed primitive
  signature, venue-level locking, and `outside_reservations`.
- **Deletions move after activation.** Old caller paths survive behind a route-level gate.
- **Estimate revised from 18 to 24 days up to 24 to 32 days**, with per-stream estimates and named
  owners. The reviewer is right that the original number did not survive contact with the detail.

The plan is being updated now. It should be re-reviewed before implementation, and the reviewer should be
given the decision register with the verbatim quotes so rounds two to five are visible.
