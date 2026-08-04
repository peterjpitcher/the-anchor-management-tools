# Seasonal pre-order journey: specification v2

> **STATUS: NOT BUILDABLE AS IT STANDS. Reference material, not a build brief.**
>
> Three independent adversarial readers found **35 blocking defects**, listed in
> `tasks/seasonal-preorder-spec-v2-defect-register-2026-08-04.md`. Two of the three returned
> "do not ship". All three independently found the same migration failure, so the schema in
> this document does not apply to a database as written.
>
> The honest reading is that this specification is too large for the problem it solves. It grew
> to twelve tables and six thousand lines to let a pub take Christmas dinner orders, and at that
> size it contradicts itself faster than the contradictions can be removed.
>
> Keep it for the design thinking, the verified findings about the existing code, and the Phase 2
> ideas. Do not hand it to a developer to build.


Date: 2026-08-04
Supersedes: `tasks/seasonal-preorder-journey-spec-2026-08-03.md` (v1)
Answers: `tasks/seasonal-preorder-journey-spec-developer-review-2026-08-04.md` (44 findings)
Status: **for build, subject to the open decisions in Part 3 section 14**

## How to read this

Version 1 was rejected by an external developer as not implementable, with 44 findings and a red
readiness verdict. This is the rewrite. Every one of the 44 findings is dispositioned in Part 1
section 7: closed here, deferred to Phase 2, or named as a decision that belongs to the owner or to a
lawyer rather than to a developer.

Three things a reader should know before starting.

**It is phased.** Phase 1 is what Christmas 2026 needs: the booker orders for everyone, and the kitchen
gets what it needs to cook. Phase 2 adds per-guest phone numbers and guest self-service. Almost every
serious privacy and messaging risk in the review exists only because somebody other than the booker
submits choices, so deferring that one idea removes most of the risk from the first season. The cut
line is in Part 1 section 5 and is the owner's to overturn.

**The automatic deposit refund is a separate workstream.** It is real work the owner has asked for, but
it is about deposits, not pre-orders, and neither one blocks the other. Treating it as part of Christmas
was making Christmas look impossible.

**Two questions block the build and are not technical.** They are listed first in Part 1 section 4.

---

## Table of contents

- **Part 1**: scope, phasing, the data model and the completeness rule
- **Part 2**: journeys, kitchen and front-of-house fulfilment, tokens and API contracts
- **Part 3**: chase ladder, privacy and retention, the refund workstream, delivery, testing, and the
  consolidated register of open decisions

---

## Part 1: scope, phasing, data model and completeness

### 1. Document control

| Item | Value |
|---|---|
| Replaces | `tasks/seasonal-preorder-journey-spec-2026-08-03.md` (version 1) |
| Answers | `tasks/seasonal-preorder-journey-spec-developer-review-2026-08-04.md` (44 findings) |
| Status | This document is the single source. The working papers it was assembled from (`CANON.md` and the seven lettered section drafts) are superseded background and must not be built from |
| AMS repository | `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools`, branch `work/outstanding-book-table-2026-08-03`, review snapshot `63525547` |
| Website repository | `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub`, branch `work/outstanding-book-table-2026-08-03`, review snapshot `14aa6be7` (**not merged to `origin/main`**, see Part 3 §10.1) |
| Target season | Christmas 2026. Menu published October, database deployable September |

### 1.1 How the spec is assembled

Three parts, one document. A reference of the form "Part 2 §7.4" resolves inside this file.

| Part | Covers |
|---|---|
| **Part 1 (this part)** | Front matter, finding disposition, phase cut line, the completeness rule, the canonical data model and SQL, database invariants, settings, migration order, database acceptance criteria |
| **Part 2** | The booker journey, the staff-on-behalf journey, the kitchen and front-of-house fulfilment surfaces, tokens and the bearer threat model, API contracts, the access matrix, journey acceptance criteria |
| **Part 3** | The chase ladder and the outbox, privacy and retention, subject access and erasure, the separate refund and growth workstream, activation and backfill, release and rollback, observability, the test plan, the Phase 2 appendix |
| **Ends with** | One consolidated register of every open owner decision, legal decision and unconfirmed fact, deduplicated across the three parts. In-body references of the form `OB1`, `OD9`, `OW2`, `L2` or `U4` resolve there |

### 1.2 Verification standard, and what each label means

| Label | Meaning |
|---|---|
| **VERIFIED** | Read in the named repository on 2026-08-04, at the path given |
| **SECTION-CLAIMED** | An assembly source claims it with a line reference. Confirm before build |
| **ASSUMED** | A judgement, not a fact. Named so nobody treats it as checked |
| **UNKNOWN** | Nobody knows. Listed in the consolidated register as a `U` item |


Everything marked VERIFIED below was read by the author in the two repositories on 2026-08-04. Nothing is
inherited from an earlier draft's claim. Anything a developer must confirm before writing code is marked
ASSUMED, or listed as a `U` item in the consolidated register at the end of the document.

| # | Fact | Status | Evidence |
|---|---|---|---|
| V0 | On this project a new `public` function is granted `EXECUTE` to `anon` and `authenticated` **by name**, so `REVOKE ALL FROM PUBLIC` alone does not lock it down | VERIFIED | `20260803000100` §11 header comment, and the two-revoke loop that follows it |
| V1 | No table, column, function or code named `booking_preorder*` exists anywhere in `src/`, `supabase/` or `scripts/` | VERIFIED | repository-wide grep returns nothing outside `tasks/` |
| V2 | `booking_periods` and `booking_period_menu_items` exist, RLS enabled, service-role-only policy | VERIFIED | `supabase/migrations/20260803000100_seasonal_booking_periods.sql` lines 181 to 219 |
| V3 | `booking_period_menu_items.course` is constrained to `('starter','main','dessert','side','drink','other')` | VERIFIED | same file, `bpmi_course_ck`, line 197 |
| V4 | `booking_period_menu_ready(period_id)` returns true if ANY active item exists, with no course check | VERIFIED | same file, lines 323 to 338 |
| V5 | `upsert_booking_period_menu_item` lets a manager change an existing item's `course` in place | VERIFIED | same file, line 930 (`course = COALESCE(NULLIF(p_payload ->> 'course', ''), course)`) |
| V6 | `guest_tokens.customer_id` is `NOT NULL REFERENCES customers(id) ON DELETE CASCADE` | VERIFIED | `20260420000003_bookings_v05_foundations.sql` line 464 |
| V7 | Table bookings ARE hard deleted by production tooling | VERIFIED | `scripts/cleanup/delete-all-table-bookings.ts` and `src/lib/delete-all-table-bookings-safety.ts` both exist |
| V8 | Seasonal amendments currently return `state: 'manual_review'` and change no money | VERIFIED | `src/lib/table-bookings/staff-deposit-transitions.ts` lines 113 to 123 |
| V9 | Every function created by the seasonal migration is revoked from `PUBLIC`, `anon` and `authenticated`, granted only to `service_role`, with a closing assertion that raises if any of it was missed | VERIFIED | `20260803000100` lines 1106 to 1164, and `20260801001300_lock_down_new_function_grants.sql` |
| A1 | `table_bookings` row count is small enough for an inline `ADD CONSTRAINT` | ASSUMED, not measured. §13 gives a build that does not depend on the answer |
| A2 | No production process updates `table_bookings.booking_period_id` after creation | ASSUMED. Grep found no writer, the search was not exhaustive |
| A3 | The target PostgreSQL version accepts a `WHEN` clause on a `CONSTRAINT TRIGGER` | ASSUMED. §11.2 gives the fallback |

---

## 2. Scope

**In scope.** Collecting a food choice for every seat on a seasonal booking, storing it so the kitchen can
cook from it, chasing the booker until it is complete, and producing the kitchen and staff output.

**Out of scope, explicitly.** Taking payment for food at pre-order time. Changing the deposit rules.
Retiring the website's existing four-step booking flow. Changing the Sunday lunch journey. Anything to do
with `table_bookings.sunday_preorder_cutoff_at`, which is a legacy column with a different meaning and is
not reused.

**Adjacent, recorded but not owned.** Two pieces of work share this release window and are described in
Part 3 so the risk is visible, but neither is pre-order build work and neither gates Phase 1: the
**automatic deposit refund on amendment and the party-growth payment link** (Part 3 §7, its own workstream
with its own switch and tests) and the **retirement of the website's four-step booking flow** (Part 3
§10.3.1 and §10.4, an adjacent website workstream carrying its own analytics waiver). If a reader finds
either of them in this document and concludes they are Phase 1, they have misread it.

**The business outcome, stated once.** A chef holds a sheet on the morning of service that says how many
of each dish to cook, which plate carries which allergy, and which tables are still missing choices. Rows
in a database are not the outcome.

---

## 3. What changed since version 1

| # | Version 1 | Version 2 | Finding |
|---|---|---|---|
| 1 | Choices stored, journey ends | A full kitchen and staff fulfilment output, with a named kitchen representative signing that it is usable | F01 |
| 2 | `cover_index` integer | `booking_preorder_covers`, one row per seat, with its own id, name, dietary fields, completion timestamps and tombstone | F05 |
| 3 | Invariants described in prose | Five invariants enforced by PostgreSQL: composite foreign keys, deferred constraint triggers, partial unique indexes | F04 |
| 4 | `booking_periods.required_courses` | Deleted. A main is always required, starter and dessert are per cover. Owner answer O4 | F06 |
| 5 | Absence of a row meant "declined" | An explicit `choice = 'none'` row means declined. Absence means "not told yet" | F06 |
| 6 | `guest_tokens` reused, `customer_id` made nullable | A separate `booking_preorder_tokens` table. `guest_tokens` is not touched. Owner answer O1 | F10 |
| 7 | A booking could be moved between periods | Refused by the database, twice over. Owner answer O2 | F23 |
| 8 | Shrink ordering described, not computable | `preorder_plan_shrink` then `preorder_apply_amendment`, deterministic order, preview stored before anything changes | F22 |
| 9 | Three different cutoff instants | One instant, `booking_preorder_orders.cutoff_at`, computed once, stored, read by everybody | F18 |
| 10 | Chase idempotency by insert conflict | Live-scoped unique indexes. A cancelled row is a ledger entry and never blocks a legitimate re-arm | F19 |
| 11 | Automatic refund on amendment inside the release | A separate workstream, not blocking Christmas. It is about deposits, not pre-orders | F26 to F30 |
| 12 | Third-party guest contacts in the first release | Phase 2. Phase 1 is booker only | F44, F12, F16 |
| 13 | Allergy data "health-adjacent" | Health data. Schema built so either answer to the Article 9 question ships without a migration | F13 |
| 14 | Retention mentioned | Every table this feature creates carries a named rule and a deletion date | F14, F15 |
| 15 | Publishing a menu enabled the feature | Four settings switches with `preorder_module_enabled` as master, all defaulting false, all failing closed | F33 |
| 16 | No plan for bookings already taken | A manager call list, not a silent conversion. Retro-stamping would rewrite terms a guest already agreed | F35 |

---

## 4. Owner and legal decisions

Named as decisions, not invented. Nothing in this spec re-opens them.

| Ref | Decision | Source | Status |
|---|---|---|---|
| O1 | Pre-order tokens live in a separate table. `guest_tokens.customer_id` stays `NOT NULL` | Owner | Binding |
| O2 | Moving a booking outside its period is refused. Staff cancel and rebook | Owner | Binding |
| O3 | Party growth is settled by a payment link, never an automatic further charge | Owner | Binding |
| O4 | **A main is always required.** Starter and dessert are optional. Each cover chooses its own course count (1, 2 or 3), and covers in one party may differ. "Declined a course" must be distinguishable from "has not answered yet" | Owner | Binding. §6 is the only statement of it |
| O5 | Keep dish and cover-count data 2 years for planning. Delete personal data (phone numbers, guest names, free text) far sooner, because the stated planning purpose needs no personal data at all | Owner, refined | Binding |
| D2 | Seasonal amendments do build the automatic deposit refund. The owner was asked on 2026-08-04 whether it should stay a manual correction and answered no | Owner, 2026-08-04 | Binding |

### 4.1 D2 supersession, stated plainly

`tasks/seasonal-amendment-deposit-decision-2026-08-03.md` (commit `dac862b7`) records the opposite
decision: that shrinking a party stays a manual correction for the first season. **That record is stale
and is superseded by the owner's answer of 2026-08-04.** VERIFIED (V8): the live code at
`src/lib/table-bookings/staff-deposit-transitions.ts` lines 113 to 123 still returns
`state: 'manual_review'` for any booking carrying a `booking_period_id`, which is the behaviour the stale
record describes. Amend or delete that decision record in the same change that builds the refund. A stale
committed decision record is worse than none.

D2 being live does **not** put the refund in Phase 1. See §5.4.

### 4.2 Legal decisions, outstanding

These are for a qualified person, not a developer and not the owner alone.

| Ref | Question | Blocks |
|---|---|---|
| L1 | Article 6 lawful basis for the pre-order journey | Privacy notice wording |
| **L2** | **Article 9 condition for dietary and allergy data.** Gates whether `dietary_note` free text is collected through a web form at all | Nothing structural: §10.4.1 ships either way with no migration |
| L3 | DPIA | Release sign-off |
| L4 | Article 14 notice to guests whose numbers the booker supplied | Phase 2 only |
| L5 | Privacy notice update. The live notice contains no occurrence of "allergy", "dietary", "health", "special category" or "retention", and that gap applies to what the pub already does today | Release sign-off |
| L6 | Food-safety retention need for dietary data. Sets 90 days or 14 days | The dietary row of the retention schedule, Part 3 §5.1 |
| L7 | Who may read cover-level allergy free text | The allergy rows of the access matrices, Part 2 §8 and Part 3 §4.4 |
| L8 | Whether the pre-existing `table_bookings.allergies` field joins the controlled list | Separate change |

Ask L1, L2, L3 and L6 in one session before schema approval.

---

## 5. The phase cut line

**Status: this is the recommended default. The owner has NOT confirmed it.**

It is reversible. Nothing in Phase 1 blocks Phase 2, every Phase 2 column already exists in the Phase 1
schema as nullable, and Phase 2 turns on with a settings flag rather than a migration.

### 5.1 Why the line is here

Nearly every P0 privacy and messaging risk in the developer review exists **only because somebody other
than the booker submits choices.** Third-party phone numbers create the STOP defect, the
"create a customer record for a guest" trap, the quiet-hours failure, the Article 14 question, the
permission-evidence machinery, the suppression list and most of the token threat model. Remove that one
thing and the risk register collapses.

Phase 1 still delivers the actual business need: **per-cover food choices the kitchen can cook from.**

### 5.2 Phase 1, needed for Christmas 2026

| In Phase 1 | Where |
|---|---|
| Per-cover storage with the O4 completeness rule | §6, §10 |
| **The booker submits choices for every cover.** One contact per order, `is_booker = true` | §10.3 |
| A token link so the booker can finish later | §10.7 |
| Staff enter choices by phone on a guest's behalf, recorded as `decided_by_kind = 'staff'` | §10.5 |
| The full kitchen and staff fulfilment output: service-day view, prep sheet, plating list, A4 sheet, CSV, sign-off, lock, late-change fingerprint | Part 2 §5 |
| Chase to the booker only, SMS and email, four-occasion cap | Part 3 §2 |
| Manager escalation when incomplete at the cutoff | Part 3 §3.10 |
| Readiness flag and kill switches | §12.3, §12.3.1, Part 3 §8 |
| Backfill of existing seasonal bookings as a call list | Part 3 §9 |
| The retention split and the aggregate table, live before the first D+1 aggregate run | §10.10, Part 3 §5 |

**Explicitly NOT in Phase 1: third-party guest contacts.** No number belonging to anyone but the booker is
stored, and no message is sent to anyone but the booker and the manager.

### 5.3 Phase 2, deferred

Delegated guest contacts. Per-guest phone numbers. The guest SMS chase ladder. STOP handling and the
suppression list. Third-party permission evidence. The FOH read route. Cover reassignment between
contacts. Selective reprint. The menu-allergen cross-check. Letting the booker see another contact's
choices (counts only).

### 5.4 Separate workstream, not blocking Christmas

The automatic deposit refund on amendment (D2, findings F26 to F30) and the party-growth payment link
(O3, F29). Two separate questions were being conflated: "should it exist" (yes, D2) and "must it ship for
Christmas" (no). It is about deposits, not pre-orders, and it couples to neither the cover model nor the
chase ladder. It ships on its own schedule with its own table (`booking_amendments`) and its own tests.

The one structural link it needs is declared now so it is not invented twice:
`booking_preorder_amendments.booking_amendment_id`, nullable, set by the money workstream (§10.6).

### 5.5 What Phase 1 costs the owner, stated plainly

The booker types in everyone's choices. For a party of twelve that is twelve names and up to thirty-six
dish picks on one form. That is the whole cost. It is real, and it is smaller than the cost of getting
third-party consent wrong at Christmas.

### 5.6 The non-functional bar

Stated here so it is a requirement rather than an aspiration. The delivery part elaborates each one.

| Area | Requirement | Finding |
|---|---|---|
| Accessibility | The guest pre-order page meets WCAG 2.2 AA: keyboard operable, visible focus, labelled inputs, errors announced, 4.5:1 contrast, usable at 320 CSS px wide with no horizontal scroll and at 400% zoom (1.4.10 Reflow), no clipping at 1.5 line height (1.4.12). Staff screens are keyboard operable, every icon-only control has an accessible name, and touch targets are 44 px because the FOH surface is an iPad. Verified with axe plus one keyboard-only pass and one screen-reader pass, recorded. **Full criterion list and test method: Part 3 §12.4** | F39 |
| Capacity | Sized for the busiest service day (register item `U13`). **These four numbers are the only ones; Part 2 §5.11 and Part 3 §11.7 restate them and must not diverge.** Guest page first contentful paint under **2.5 s** on 4G mobile; the `preorder-day` API response under **800 ms** at 30 bookings and 250 covers; the full service-day view server render under **2 s** at 40 bookings; the day print route (prep, plating or the A4 sheets) under **60 s**, inside `maxDuration = 300`. Every index listed in §10 present before activation | F40 |
| Observability | Every cron persists a result through `persistCronRunResult`. Every message and mutation carries a `correlation_id`. A `/preorders/health` page shows the last successful digest send. A daily 08:00 heartbeat, so silence is a signal | F41 |
| Copy | Every guest-facing string and every error journey has an acceptance criterion in the API part, in plain British English, naming the pub and the booking date | F43 |

---

## 6. The completeness rule (owner answer O4), stated once

This is the only definition in the whole specification. Every component reads it from here: the kitchen
output, the chase ladder, the API, the views and the alerts.

> Let `A` be the order's `course_set`, a snapshot taken at creation, always containing `main`.
>
> A selection row is **live** when `invalidated_at IS NULL`.
>
> A cover is **decided for course `c`** when a live selection row exists for that cover with `course = c`.
>
> **A cover is complete when, for every course `c` in `A`, the cover is decided for `c`.**
>
> A declined course is an explicit row with `choice = 'none'`. An absent row means "we have not been
> told". `choice = 'none'` is forbidden on `main`.

### 6.1 The state machine

Ordered branches, first match wins. Implement as one `CASE`, never as independent booleans.

```
cover_state(cover) =
  dropped     if dropped_at IS NOT NULL
  blocked     if any selection row for the cover has invalidated_at IS NOT NULL
  unstarted   if the cover has no live selection rows
  complete    if for every c in A the cover is decided for c
  partial     otherwise

contact_state(contact) =
  inactive    if the contact has no live covers
  blocked     if any of its live covers is blocked
  complete    if every live cover assigned to it is complete
  unstarted   if every live cover assigned to it is unstarted
  partial     otherwise

order_state(order) =
  cancelled   if status = 'cancelled'
  complete    if live cover count = booking party size, and every live cover is complete
  incomplete  otherwise
```

**Chasing stops for a contact when `contact_state` is `complete` or `inactive`, and only then.**

### 6.2 Worked examples, so there is nothing to interpret

`course_set = {starter, main, dessert}` in every row below.

| Cover | Rows present | `cover_state` | Chased? |
|---|---|---|---|
| 1 | main = Turkey | `partial` | Yes |
| 2 | main = Turkey, starter = none, dessert = none | `complete` | No |
| 3 | main = Turkey, starter = Soup, dessert = Pudding | `complete` | No |
| 4 | no rows | `unstarted` | Yes |
| 5 | main = Turkey (withdrawn, `invalidated_at` set) | `blocked` | Yes, with a notice, not a chase |
| 6 | starter = Soup only | `partial` | Yes |
| 7 | dropped in a shrink | `dropped` | No |

Cover 1 and cover 2 are the whole point of O4. Under the wrong reading they are the same thing. Under this
rule the kitchen can tell "no starter" from "not asked", and cover 1 is still chased.

### 6.3 Exit from `blocked` is not optional tidying

Any successful write to a selection row sets `invalidated_at = NULL` and `invalidated_reason = NULL`,
whoever the actor is. Without this, a cover whose dish the pub withdrew is permanently `blocked`,
permanently short of complete, and permanently in the chase queue with nothing the guest can do about it.

### 6.4 The blocking website conflict this creates

**VERIFIED in `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub` at `14aa6be7`:** the website asserts, in
published customer-facing copy and in a passing test, that a one-course guest does **not** pre-order at
all. `SSOT.json:897` reads "1 course is pre-book only, no pre-order. 2 course and 3 course are pre-book
and pre-order", repeated at `:1087` and `:1386`, and `tests/ssot-drift-guard.test.ts` asserts those two
substrings in a test named "keeps Christmas pre-order rules course-conditional, never blanket", with a
comment marking it owner-confirmed 2026-07-21.

**The exact change set, enumerated by grep rather than estimated.** These eleven files carry the claim
and must move in one commit if the owner confirms `OB2`:

```
SSOT.json                                          docs/SSOT.md
app/christmas-parties/page.tsx                     app/christmas-parties/client-components.tsx
app/api/enquiry/christmas/route.ts                 lib/christmas-parties-schema.ts
tests/ssot-drift-guard.test.ts                     tests/api/christmas-enquiry.test.ts
tests/unit/christmas-2026-offer-rules.test.tsx     tests/unit/christmas-parties-booking-journeys.test.ts
tests/unit/christmas-parties-schema.test.ts
```

`lib/christmas-parties-schema.ts` was named by no earlier draft and is the one a developer would miss:
the rule is encoded in the schema, not only in the copy. `tasks/christmas-2026-build-plan.md` also
records the July decision and must get a superseding header (Part 3 §10.2).

The conflict is larger than "does a one-course guest pre-order". The website models courses as a
**party-level tier** (the table books "the 1 course"). O4 models courses as a **per-cover choice** and
says covers in one party may differ. Those are different commercial products.

**Ruling: O4 wins.** It is the later decision (2026-08-04 versus 2026-07-21), it is explicit that covers
may differ, and the owner named it binding. Every cover pre-orders a main, so there is no "no pre-order"
tier.

**This is a blocking owner confirmation (`OB2`), because it changes published copy and how the Christmas
offer is sold. A developer cannot make it. AMS Phase 1 proceeds in the meantime**, because AMS is
per-cover in every reading.

---

## 7. Disposition of the 44 findings

Every finding, with one of four outcomes and a pointer. "Closed" means this specification answers it well
enough to build from.

| # | Finding (P) | Outcome | Where |
|---|---|---|---|
| F01 | No kitchen or FOH fulfilment journey (P0) | Closed | Part 2 §5. Named kitchen representative signs the printed output; that gate is an operational approval, not a developer sign-off |
| F02 | APIs and ownership boundaries unspecified (P0) | Closed | Part 2 §7. Ownership boundaries §7.1, versioning §7.2, the phase-tagged endpoint and auth table §7.3, the error contract §7.4, the full catalogue §7.6 |
| F03 | Booking creation has no safe failure model (P0) | Closed | §10.2.1 (when the order row is created and what happens when it cannot be), Part 2 §2 (the creation state machine and the three guards), Part 3 §3 (failure and retry) |
| F04 | Schema does not enforce its invariants (P0) | Closed | §11, invariants I1 to I5, all enforced by PostgreSQL |
| F05 | `cover_index` is not a stable cover model (P0) | Closed | §10.4, `booking_preorder_covers` |
| F06 | Completeness rules unresolved (P0) | **Owner decision O4**, answered | §6 |
| F07 | Menu versioning and withdrawn items (P1) | Closed | Data half §10.5 (snapshot columns, `invalidated_at`, `RESTRICT` foreign keys). Messaging half, including who approves a mass re-chase, is owned by Part 3 §2.11 |
| F08 | Food price meaning and guest payment expectation (P1) | **Owner decision, open** | Recommendation: no money is taken at pre-order time, prices are shown for information only, `item_price_gbp` is a snapshot for kitchen and margin reporting, and the deposit rules are unchanged. `OB4` |
| F09 | Booker and guest visibility rules (P1) | Closed for Phase 1, **Phase 2** for the rest | In Phase 1 the booker enters everything, so there is nothing to hide. Cross-contact visibility (counts only) is Phase 2 |
| F10 | Shared guest tokens (P0) | **Owner decision O1**, answered | §10.7, a separate token table. `guest_tokens` is not touched |
| F11 | Public token-page security controls (P1) | Closed | §10.7 (hash storage, expiry, revocation, one live token per contact) plus Part 2 §6 (threat model, the fifteen controls, throttle scopes, headers, no-index, error shape) |
| F12 | Permission confirmation absent from the schema (P0) | **Phase 2** | §10.11 `booking_preorder_permission_evidence`, and the send gate `preorder_contact_is_covered` which is already correct in both phases |
| F13 | Allergy data legally misclassified (P0) | **Legal decision L2** | §10.4.1. The schema ships either way with no migration |
| F14 | Retention and anonymisation incomplete (P0) | Closed | Part 3 §5's sweep covers every table this spec creates. The columns that make it possible (`phone_cleared_at`, `retention_hold_until`, `retention_hold_reason`, `erased_at`) are in §10 |
| F15 | Subject access and erasure not designed (P1) | Closed | Part 3 §6. The `erased-%` sentinel is permitted by `bpc_phone_ck` in §10.3 |
| F16 | Phone validation, consent scope, inbound messaging (P1) | Closed for Phase 1, **Phase 2** for inbound | E.164 enforced by CHECK plus a per-order unique index (§10.3). Guest phone validation is Part 3 §13.2, STOP handling Part 3 §13.3, both Phase 2 |
| F17 | "Four messages" versus dual-channel contact (P1) | Closed | Part 3 §2.10. Four **occasions**, not four transmissions: SMS and email at the same point are one occasion |
| F18 | Chase timing contradiction (P1) | Closed | §10.2.2. One instant, `cutoff_at`, default 12:00 London, stored on the order |
| F19 | Chase idempotency can lose messages (P0) | Closed | §10.8. Unique indexes scoped to live rows, so a cancelled row is a ledger entry and never blocks a re-arm |
| F20 | Failure, retry and "unreachable" rules missing (P1) | Closed | §10.8 columns plus Part 3 §3.1 to §3.7, the lease, retry, outcome-mapping and reconciliation rules |
| F21 | Party growth state and chase reset (P1) | Closed for the data model, **separate workstream** for the money | §10.6 (`kind = 'grow'`), Part 3 §2.12 (one notice, no budget reset), Part 3 §7.10 (payment link, O3) |
| F22 | Shrink ordering not implementable (P0) | Closed | §10.6. Plan then apply, deterministic order, preview stored before anything changes |
| F23 | Booking moves and period transitions (P0) | **Owner decision O2**, answered and enforced | §11, I5. `ON UPDATE RESTRICT` plus a date-guard trigger |
| F24 | "Last write wins" risks silent lost updates (P1) | Closed | `booking_preorder_orders.revision` plus `p_expected_revision` on every mutating RPC (§10.2, §12.2) |
| F25 | Cancellation versus cascade delete (P1) | Closed | §11.5. Three different operations, each defined, plus the redacted tombstone |
| F26 | Refund arithmetic after earlier refunds (P0) | **Separate workstream** | Part 3 §7.4, §7.5 |
| F27 | Payment and booking changes cannot be atomic (P0) | **Separate workstream** | Part 3 §7.7, the saga |
| F28 | Existing refund plumbing not usable by automation (P1) | **Separate workstream** | Part 3 §7.6, §7.8 |
| F29 | Party growth payment is a release blocker (P0) | **Owner decision O3**, answered. **Separate workstream** to build | Part 3 §7.10. A payment link, never an automatic further charge |
| F30 | Refund outcomes and customer communication (P1) | **Separate workstream** | Part 3 §7.11 |
| F31 | Alert requirements split and conflicting (P1) | Closed | §10.9, one `preorder_alerts` table, one digest path through the single outbox |
| F32 | Alert reliability and sensitive email handling (P1) | Closed | §10.9 and Part 3 §11.4 (heartbeat, re-notify rules, auto-resolve) plus Part 3 §11.5: no phone number, guest name or dietary content in any digest, ever |
| F33 | Publishing a menu is an unsafe feature switch (P0) | Closed | §12.3, four settings switches with `preorder_module_enabled` as master, all default false, all fail closed, plus **§12.3.1, the mandatory per-component check table**. Activation order Part 3 §8.4. Plus the `booking_period_menu_ready` fix in §12.1 |
| F34 | Migration, access policy and query design (P1) | Closed | §13 (four migrations, `CONCURRENTLY` first), §11.6 (grants), §10 (every index the queries need) |
| F35 | Existing eligible bookings have no backfill plan (P0) | Closed | Part 3 §9. A manager call list, not a silent conversion, with a fingerprint-gated commit and no new personal-data table |
| F36 | Cross-repo delivery evidence not reproducible (P1) | Closed | §1.2 and the VERIFIED table below (commit-pinned) plus Part 3 §8.3's preflight and §10.2's release manifest |
| F37 | Old code removal confused with rollback (P0) | Closed | §2: retiring the existing booking flow is out of scope. Rollback is a settings flip plus a redeploy of the previous commit, and no `DROP TABLE` is ever needed to recover (§13.2) |
| F38 | Test plan materially incomplete (P1) | Closed | §14 (the database invariant tests, each a transaction that must fail), Part 2 §9 (66 journey criteria) and Part 3 §12.2 (the 56-row requirement-to-test matrix) |
| F39 | Accessibility requirements absent (P1) | Closed | §5.6, expanded in Part 3 §12.4 |
| F40 | Capacity and performance requirements missing (P2) | Closed | §5.6 holds the four numbers, sized from register item `U13`. Volume scenarios Part 3 §11.7 |
| F41 | Observability does not cover the journey (P1) | Closed | §5.6 plus Part 3 §11 |
| F42 | Delivery plan lacks owners, estimates and gates (P1) | **Partly closed. Stated honestly rather than overclaimed** | Gates are closed: Part 3 §8.3's fifteen-line preflight and §10.2's release manifest. Owners are closed as far as a document can close them: the six roles are named in the register as `OR1` and only the owner can fill them. **Estimates are not given and this spec does not attempt them**, because effort belongs to the third-party developer who will do the work, not to the party writing the requirement. The developer should return estimates against the Phase 1 line in §5.2 |
| F43 | Guest copy and error journeys need acceptance criteria (P2) | Closed | Part 2 §3.2 and §3.3 (page states), Part 2 §7.4 (error codes), Part 3 §12.5 (the guest and staff error-state matrix and the copy slots that block build) |
| F44 | A smaller first release would remove the highest risk (P2) | Closed, **adopted** | §5. Booker-only Phase 1, Phase 2 appendix at Part 3 §13. Owner confirmation still outstanding (`OB1`) |

**Totals, counted by the primary outcome in the column above, so they add to 44.**

| Outcome | Count | Findings |
|---|---|---|
| Closed | 32 | Everything not listed below |
| Partly closed, stated honestly | 1 | F42, estimates only |
| Owner decision, answered | 4 | F06 (O4), F10 (O1), F23 (O2), F29 (O3) |
| Owner decision, still open | 1 | F08, register item `OB4` |
| Legal decision | 1 | F13, register item `L2` |
| Deferred wholly to Phase 2 | 1 | F12 |
| Deferred to the separate refund workstream | 4 | F26, F27, F28, F30 |

F29 is both an answered owner decision and separate-workstream build work; it is counted once, as an
owner decision. F09, F16 and F21 are counted as closed because Phase 1 is fully specified and only the
Phase 2 remainder is deferred.

---

## 8. Naming rules (binding)

| Rule | Detail |
|---|---|
| Table prefix | `booking_preorder_*` for anything keyed to one booking's pre-order. `preorder_*` for feature-level tables not keyed to a booking. `booking_period_*` for period-level aggregates |
| Constraint prefix | One prefix per table, listed against each table below. No two tables share a prefix |
| Function prefix | **Every** new function is `preorder_*`, with no exceptions, so the grant lockdown is a single `proname LIKE 'preorder\_%'` filter that cannot miss a name |
| View prefix | `v_booking_preorder_*` |
| Columns | `snake_case`. TypeScript is `camelCase`, mapped **manually** in query transforms. This project has no `fromDb<T>()` helper |
| Timestamps | `*_at timestamptz`. Never a naive timestamp, never a date for an instant |
| Booleans | Positive sense, no `not_` prefixes |
| The triple key | Every child of the order carries `order_id` and `booking_period_id` alongside its own parent id, and points at its parent with a **composite** foreign key. Denormalise, then let the database police the denormalisation |
| Foreign keys to one parent | **Exactly one.** A second foreign key from a child to the same parent makes PostgREST embeds ambiguous. That is a known trap in this codebase |

---

## 9. The table list

**9 tables in Phase 1. 12 in the full design. 3 views.**

| Table | Prefix | Phase | One row per |
|---|---|---|---|
| `booking_preorder_orders` | `bpo_` | 1 | Booking that needs a pre-order. Lifecycle and fulfilment merged |
| `booking_preorder_contacts` | `bpc_` | 1 (one row) | Person who submits choices. Phase 1: the booker only |
| `booking_preorder_covers` | `bpcov_` | 1 | Seat |
| `booking_preorder_selections` | `bps_` | 1 | Decision, for one cover, for one course |
| `booking_preorder_amendments` | `bpa_` | 1 | Party-size change (the cover plan, not the money) |
| `booking_preorder_tokens` | `bpt_` | 1 | Issued guest link |
| `booking_preorder_outbox` | `bpx_` | 1 | Outbound message of any class |
| `preorder_alerts` | `pal_` | 1 | Deduplicated operational alert |
| `booking_period_demand_stats` | `bpds_` | 1 | Anonymous planning aggregate |
| `booking_preorder_permission_evidence` | `bppe_` | 2 | Covered person in a permission batch |
| `preorder_sms_suppression` | `pss_` | 2 | Suppressed number hash |
| `booking_amendments` | n/a | Separate workstream | Money saga |

Deliberately **not** in the model, and why:

- **No `cover_index` keyed to anything.** Covers have `ordinal` for display order only, never renumbered.
  Gaps after a shrink are normal.
- **No `contacts.covers` integer.** A contact's cover count is `count(*)` of its live cover rows.
- **No `booking_periods.required_courses`.** O4 removes the need for it.
- **No `course_count` on the cover.** A stored count is a second source of truth that can disagree with
  the rows it summarises.
- **No `table_booking_id` on `booking_preorder_covers`.** Join through the order. Any query that references
  that column is wrong, and any index on it must not be created.
- **No separate print-run tables.** Three columns on the order (§10.2) replace them.
- **No `preorder_backfill_runs` table.** It would have stored `customer_name` with no deletion schedule.
- **No reuse of `table_booking_items`,** whose `menu_item_id` points at the general `menu_items` table.
- **No reuse of `table_bookings.sunday_preorder_cutoff_at`,** a legacy column still written for legacy
  Sunday bookings. Reusing it would put two meanings in one column.

---

## 10. The canonical data model, full SQL

### 10.1 Two prerequisite unique keys on existing tables

Composite foreign keys need composite unique keys to point at. Neither changes existing behaviour.
§13 gives the non-blocking way to build the first one.

```sql
-- Lets a child row prove that the booking it names really is in the period it names.
ALTER TABLE public.table_bookings
  ADD CONSTRAINT table_bookings_id_period_uk UNIQUE (id, booking_period_id);

-- Lets a selection prove that the dish it names really is in the period it names,
-- on the course it claims.
ALTER TABLE public.booking_period_menu_items
  ADD CONSTRAINT bpmi_id_period_course_uk UNIQUE (id, period_id, course);
```

### 10.2 `booking_preorder_orders` (Phase 1, prefix `bpo_`)

One row per booking that needs a pre-order. Lifecycle and fulfilment, merged: a booking has exactly one of
each, and two tables keyed on the same booking is a join for nothing.

```sql
-- Must exist BEFORE the table: a CHECK may call an IMMUTABLE function but may not contain a subquery,
-- and the duplicate test needs a DISTINCT count.
CREATE OR REPLACE FUNCTION public.preorder_course_set_ok(p text[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p IS NOT NULL
     AND cardinality(p) BETWEEN 1 AND 3
     AND p <@ ARRAY['starter','main','dessert']::text[]
     AND 'main' = ANY (p)
     AND cardinality(p) = (SELECT count(DISTINCT x) FROM unnest(p) AS x);
$$;
-- Treat this body as frozen. PostgreSQL does NOT re-validate existing rows if it changes.
-- If the rule must change, write a new function, a new constraint and a validation pass.

CREATE TABLE public.booking_preorder_orders (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_booking_id     uuid NOT NULL,
  booking_period_id    uuid NOT NULL,

  -- Snapshot taken at creation. The courses this booking's covers must answer for.
  -- Always contains 'main'. Never re-read from the menu. See §6 and §10.2.3.
  course_set           text[] NOT NULL,

  -- THE cutoff instant. One value, computed once, read by everybody. §10.2.2.
  cutoff_at            timestamptz NOT NULL,

  -- Lifecycle. Derived from the covers by preorder_recompute_order_status(), never hand-set.
  status               text NOT NULL DEFAULT 'open',

  -- Bumped by every committed mutation. Drives optimistic concurrency (F24) and the
  -- stale-body rebuild in the outbox.
  revision             integer NOT NULL DEFAULT 1,

  -- Fulfilment workflow. Surfaces and transitions: Part 2 §2.7 and §5.
  fulfilment_state     text NOT NULL DEFAULT 'open',
  checked_by           uuid REFERENCES auth.users(id),
  checked_at           timestamptz,
  checked_fingerprint  text,
  checked_note         text,
  locked_at            timestamptz,                     -- a lock is a TIMESTAMP, never a status
  locked_by            uuid REFERENCES auth.users(id),  -- NULL means "locked by the cutoff"
  unlocked_reason      text,

  -- Last print. Replaces the two print-run tables version 1 would have needed.
  printed_fingerprint  text,
  printed_at           timestamptz,
  printed_by           uuid REFERENCES auth.users(id),

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  erased_at            timestamptz,

  -- O2, enforced by PostgreSQL and not by a code path somebody might forget to call.
  -- ON UPDATE RESTRICT means the booking's period cannot change, and cannot become NULL,
  -- while an order exists.
  CONSTRAINT bpo_booking_period_fk
    FOREIGN KEY (table_booking_id, booking_period_id)
    REFERENCES public.table_bookings (id, booking_period_id)
    ON UPDATE RESTRICT ON DELETE CASCADE,

  CONSTRAINT bpo_one_per_booking_uk UNIQUE (table_booking_id),
  CONSTRAINT bpo_id_period_uk       UNIQUE (id, booking_period_id),

  CONSTRAINT bpo_status_ck CHECK (status IN ('open','complete','cancelled','abandoned')),
  CONSTRAINT bpo_fulfilment_ck
    CHECK (fulfilment_state IN ('open','checked','locked','served','void')),
  CONSTRAINT bpo_revision_ck CHECK (revision >= 1),
  CONSTRAINT bpo_course_set_ck CHECK (public.preorder_course_set_ok(course_set)),

  -- A signature is all three fields or none. Half a signature is worse than none.
  CONSTRAINT bpo_signature_whole_ck CHECK (
    (checked_at IS NULL AND checked_by IS NULL AND checked_fingerprint IS NULL)
    OR (checked_at IS NOT NULL AND checked_by IS NOT NULL AND checked_fingerprint IS NOT NULL)),
  -- Must NOT be widened to 'locked' or 'served': both are legally reachable with no sign-off.
  CONSTRAINT bpo_checked_is_signed_ck
    CHECK (fulfilment_state <> 'checked' OR checked_at IS NOT NULL),
  CONSTRAINT bpo_locked_ck
    CHECK (fulfilment_state <> 'locked' OR locked_at IS NOT NULL),

  CONSTRAINT bpo_checked_note_ck
    CHECK (checked_note IS NULL OR length(checked_note) <= 300),
  CONSTRAINT bpo_unlocked_reason_ck
    CHECK (unlocked_reason IS NULL OR length(unlocked_reason) BETWEEN 3 AND 200),
  CONSTRAINT bpo_print_whole_ck CHECK (
    (printed_at IS NULL AND printed_fingerprint IS NULL)
    OR (printed_at IS NOT NULL AND printed_fingerprint IS NOT NULL))
);

-- The lock cron's only query.
CREATE INDEX bpo_due_lock_idx ON public.booking_preorder_orders (cutoff_at)
  WHERE fulfilment_state IN ('open','checked');
CREATE INDEX bpo_open_idx ON public.booking_preorder_orders (booking_period_id)
  WHERE status = 'open';
```

**Four ideas, kept apart permanently.** There is no `'locked'` status value.

| Idea | Where it lives | Values |
|---|---|---|
| Lifecycle | `status`, stored | `open`, `complete`, `cancelled`, `abandoned` |
| Locked for service | `locked_at`, stored, nullable | set or not set |
| Staff workflow | `fulfilment_state`, stored | `open`, `checked`, `locked`, `served`, `void` |
| Progress | derived at read time, **never stored** | `unstarted`, `partial`, `blocked`, `complete` |

`status` is derived from the covers by `preorder_recompute_order_status()` and is never hand-set, with one
exception: **`abandoned` is set only by an explicit staff action** ("the pub gave up chasing this one"),
and **nothing automatic ever sets it**, because `OD16` puts the nightly tidy-up job outside Phase 1. If no
staff action is built in Phase 1 the value is simply unreachable, which is acceptable; do not add a cron to
reach it.

"No pre-order required" is **not a status.** It is the absence of an order row. The API reports
`preorder.required: false` with no `order_id`.

#### 10.2.1 When the order row is created (F03)

One row at booking creation when `booking_period_requires_preorder IS TRUE` **and**
`booking_period_answer IS TRUE`. **Both conditions.** A guest who answered "no, this is not a Christmas
dinner" inside a Christmas period must never get an order row, or the pub will chase them for choices they
were told they did not have to make.

Not created lazily when the first cover arrives. `cutoff_at` is `NOT NULL` and is computable at creation,
and both the lock cron and the Outstanding tab scan order rows, so a booking with no order row would be
invisible to exactly the screens that exist to chase it.

Creation is **idempotent** on `bpo_one_per_booking_uk`, so a retry after a partial failure is safe.

**Two callers, two behaviours, and they are not a contradiction.** Say which is which or a developer will
build one and break the other.

| Caller | No active `main` on the period | Why |
|---|---|---|
| The `AFTER INSERT` bootstrap trigger on `table_bookings` (Part 2 §2.2) | **Returns NULL and raises a `preorder_alerts` row. It never raises.** The booking still commits with no order row | A raise inside that trigger kills a booking, and a lost booking is worse than a missing pre-order. The repair sweep (Part 2 §2.5, G3) picks it up once the menu exists |
| A direct call to `preorder_create_order`, from the staff "add a pre-order" action or a repair | **Refuses**, with a sentence a manager can act on and not a raw `23514` | A person asked for it and a person can fix it |

```
The <period name> menu does not have any main courses on it yet, so pre-orders cannot be taken.
Add at least one main in Settings, Table bookings.
```

The same condition is added to `booking_period_menu_ready` (§12.1), so in the normal case the period is
not bookable at all and neither branch is reached.

**Staff may add a pre-order to a booking taken without one** (owner default, Phase 1, a small staff
action).

#### 10.2.2 The cutoff instant (F18)

**One instant. Computed once at creation. Stored on the order. Read by everybody.**

```
cutoff_at = the UTC instant of
            (booking_date - period.preorder_cutoff_days)
            at period.preorder_cutoff_hour_local:00:00 Europe/London

then clamped: cutoff_at := least(computed, booking_start_utc - interval '2 hours')
```

The clamp is a clamp, not the definition. A booking made three hours before service still gets a coherent
cutoff.

```sql
ALTER TABLE public.booking_periods
  ADD COLUMN preorder_cutoff_hour_local smallint NOT NULL DEFAULT 12
    CHECK (preorder_cutoff_hour_local BETWEEN 9 AND 21);
```

**Default 12:00 noon London**, an owner decision held in a settings column so changing it is a settings
edit and not a deploy. Existing orders keep the `cutoff_at` they were created with: a guest who has been
told a deadline never has it moved. The resulting ladder reads coherently, which is the point:

| Event | Instant | Why |
|---|---|---|
| Final chase `CUT` | 10:00 London, cutoff day | Two hours' notice, clear of the 09:00 quiet-hours edge |
| **Cutoff, link goes read-only** | **12:00 London** | `cutoff_at` |
| Manager escalation `ESC` | 12:05 London | Fires when the list is final and a manager can still act |

#### 10.2.3 The cutoff is hard

Once `now() >= cutoff_at` the token still resolves and the page still renders, **read-only**, showing what
was ordered. The guest cannot submit. Staff can still edit, and every staff edit after the cutoff is
flagged as a late change.

The kitchen buys food against these numbers. A guest who needs a late change should reach a person. Owner
default: hard. Expiry and lock are different things (§10.7).

### 10.3 `booking_preorder_contacts` (Phase 1, one row, prefix `bpc_`)

```sql
CREATE TABLE public.booking_preorder_contacts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id               uuid NOT NULL,
  booking_period_id      uuid NOT NULL,

  is_booker              boolean NOT NULL DEFAULT false,
  display_name           text,
  phone_e164             text,

  -- Whether we can REACH this person. Deliberately separate from completeness, which is
  -- derived from covers. There is no contacts.status column: a contact must be able to be
  -- both reachable and half done.
  reachability           text NOT NULL DEFAULT 'ok',

  -- PHASE 2. Nullable now so PHASE 2 needs no migration.
  permission_evidence_id uuid,

  -- Retention bookkeeping. Answers the subject-access question "did we ever hold a number".
  phone_cleared_at       timestamptz,
  retention_hold_until   timestamptz,
  retention_hold_reason  text,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bpc_order_fk
    FOREIGN KEY (order_id, booking_period_id)
    REFERENCES public.booking_preorder_orders (id, booking_period_id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT bpc_id_order_period_uk UNIQUE (id, order_id, booking_period_id),

  CONSTRAINT bpc_reachability_ck
    CHECK (reachability IN ('ok','unreachable','opted_out','removed')),
  -- The 'erased-%' branch is REQUIRED by the erasure sentinel. Without it, erasure would be
  -- rejected by the very constraint meant to protect the column.
  CONSTRAINT bpc_phone_ck
    CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
           OR phone_e164 LIKE 'erased-%'),
  CONSTRAINT bpc_display_name_ck
    CHECK (display_name IS NULL OR length(btrim(display_name)) BETWEEN 1 AND 80),
  CONSTRAINT bpc_hold_ck
    CHECK ((retention_hold_until IS NULL) = (retention_hold_reason IS NULL))
);

-- At most one booker. "At least one" is invariant I1's job: an index cannot require a row to exist.
CREATE UNIQUE INDEX bpc_one_booker_uk
  ON public.booking_preorder_contacts (order_id) WHERE is_booker;
-- The same number cannot be added twice to one booking.
CREATE UNIQUE INDEX bpc_phone_uk
  ON public.booking_preorder_contacts (order_id, phone_e164) WHERE phone_e164 IS NOT NULL;
CREATE INDEX bpc_order_idx ON public.booking_preorder_contacts (order_id);
```

**Phase 1 rule, enforced in the RPC and not in the schema:** `is_booker = false` is refused while the
delegated-contacts flag is off. Keeping it out of the schema means Phase 2 turns on with a flag, not a
migration.

`bpc_phone_uk` only works if every write normalises to E.164 first (`formatPhoneForStorage`). The CHECK
refuses anything that is not E.164 shaped, so a non-normalised number cannot reach the index at all.

**Vocabulary.** There is no `pending` contact status: use `contact_state` values `unstarted` and `partial`
from §6.1. There is no `contacts.order_revision`: the revision lives on the order and is copied onto each
outbox row. There is no `contacts.previously_completed_at`: "was previously complete" is derived as every
live cover having `first_completed_at IS NOT NULL`.

### 10.4 `booking_preorder_covers` (Phase 1, prefix `bpcov_`, closes F05)

```sql
CREATE TABLE public.booking_preorder_covers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id           uuid NOT NULL,
  order_id             uuid NOT NULL,
  booking_period_id    uuid NOT NULL,

  -- Display position ONLY. Assigned once, NEVER renumbered. Gaps after a shrink are normal.
  -- The guest page shows "Guest 2 of 4" by row_number() at read time.
  ordinal              integer NOT NULL,

  guest_name           text,

  -- THE dietary fields. One name and shape everywhere. §10.4.1.
  dietary_codes        text[] NOT NULL DEFAULT '{}',
  dietary_note         text,                -- gated on legal decision L2
  needs_kitchen_call   boolean NOT NULL DEFAULT false,

  -- Completion. Two timestamps, two different meanings.
  --   first_completed_at: set ONCE, never moved. The shrink order depends on it.
  --   completed_at:       the CURRENT state. Cleared and re-set as the cover changes.
  first_completed_at   timestamptz,
  completed_at         timestamptz,

  -- Tombstone. A dropped cover is never deleted.
  dropped_at           timestamptz,
  dropped_reason       text,
  dropped_amendment_id uuid,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bpcov_contact_fk
    FOREIGN KEY (contact_id, order_id, booking_period_id)
    REFERENCES public.booking_preorder_contacts (id, order_id, booking_period_id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT bpcov_id_order_period_uk UNIQUE (id, order_id, booking_period_id),

  CONSTRAINT bpcov_ordinal_ck CHECK (ordinal >= 1),
  CONSTRAINT bpcov_dropped_ck
    CHECK ((dropped_at IS NULL AND dropped_reason IS NULL AND dropped_amendment_id IS NULL)
        OR (dropped_at IS NOT NULL AND dropped_reason IS NOT NULL)),
  CONSTRAINT bpcov_dropped_reason_ck
    CHECK (dropped_reason IS NULL
           OR dropped_reason IN ('party_shrink','staff_removed','contact_removed')),
  -- A cover cannot be currently complete without ever having been complete.
  CONSTRAINT bpcov_completed_order_ck
    CHECK (completed_at IS NULL OR first_completed_at IS NOT NULL),
  CONSTRAINT bpcov_guest_name_ck
    CHECK (guest_name IS NULL OR length(btrim(guest_name)) BETWEEN 1 AND 80),

  -- 200, not 500. A cap is a data-minimisation control, not a UI preference: 500 characters
  -- is room for a medical history.
  CONSTRAINT bpcov_note_ck
    CHECK (dietary_note IS NULL OR length(dietary_note) <= 200),

  -- Closed enum in the database. A manager adding "diabetic" would silently change the data
  -- class of the column, so changing this list is a migration and goes through review.
  CONSTRAINT bpcov_dietary_codes_ck CHECK (
    dietary_codes <@ ARRAY['vegetarian','vegan','gluten_free','dairy_free','nut_free',
                           'shellfish_free','halal','no_pork','no_alcohol','other']::text[])
);

CREATE UNIQUE INDEX bpcov_live_ordinal_uk
  ON public.booking_preorder_covers (order_id, ordinal) WHERE dropped_at IS NULL;
CREATE INDEX bpcov_contact_live_idx
  ON public.booking_preorder_covers (contact_id) WHERE dropped_at IS NULL;
CREATE INDEX bpcov_outstanding_idx
  ON public.booking_preorder_covers (order_id)
  WHERE dropped_at IS NULL AND completed_at IS NULL;
```

There is deliberately **no `table_booking_id`** on this table. Join through `booking_preorder_orders`:

```sql
-- The reconciliation query. Any booking that thinks it is seasonal but whose live covers
-- do not sum to the party size. It must return zero rows before activation.
SELECT tb.id, tb.booking_reference, tb.party_size, count(c.id) AS cover_rows
FROM public.table_bookings tb
JOIN public.booking_preorder_orders o ON o.table_booking_id = tb.id
LEFT JOIN public.booking_preorder_covers c
       ON c.order_id = o.id AND c.dropped_at IS NULL
WHERE tb.booking_period_id IS NOT NULL
  AND tb.status IN ('confirmed','pending_payment')
  AND tb.booking_date >= current_date
GROUP BY tb.id, tb.booking_reference, tb.party_size
HAVING count(c.id) <> tb.party_size;
```

```sql
-- WITHDRAWN. This column does not exist and this index must NOT be created:
-- CREATE INDEX ON public.booking_preorder_covers (table_booking_id);
```

The `contact_id, order_id, booking_period_id` triple is redundant on purpose, and the redundancy is what
makes it unbreakable: a cover cannot be moved to a contact on a different order and cannot carry a
different period from its contact, because the composite foreign key would not resolve. Phase 2 cover
reassignment is therefore `UPDATE ... SET contact_id = ?` where the new contact must be on the same order,
which the foreign key allows and nothing wider.

#### 10.4.1 The dietary fields, settled (F13)

**One name, one shape, one picklist, everywhere.**

| Field | Type | Cap |
|---|---|---|
| `dietary_codes` | `text[]`, closed enum, 10 codes | n/a |
| `dietary_note` | `text` | 200 characters |
| `needs_kitchen_call` | `boolean` | n/a |

Picklist: `vegetarian`, `vegan`, `gluten_free`, `dairy_free`, `nut_free`, `shellfish_free`, `halal`,
`no_pork`, `no_alcohol`, `other`. The wording deliberately describes the food ("no nuts") and not the
person ("nut allergy"). Names retired from earlier drafts and never to be reintroduced: `dietary_tags`,
`allergy_note`.

Guest-facing label for the note, capped at 200 characters:

> Anything else the kitchen should know about this meal? Please keep it to the food. If you have a serious
> allergy, do not rely on this box: call us on 01753 682707 so we can talk it through properly.

**If legal decision L2 says free text must not be collected through a web form,** ship Phase 1 with
`dietary_note` present, never written and never displayed. No schema change, no migration, no delay.

**Kitchen merge rule, non-negotiable.** Every kitchen output shows **both** levels, labelled:

```
Allergies
  BOOKING (applies to the table): nut allergy on the table, please keep separate boards
  COVER 3, Dave: coeliac
```

Never silently concatenate. A booking-level note is a table-wide instruction; a cover-level note is one
plate. Showing only the new per-cover fields would make a real allergy typed into the existing
`table_bookings.allergies` field disappear from the sheet the chef reads. That is a food-safety regression
introduced by a feature.

**Dietary content never appears** in a totals row, in a manager digest, in an SMS or email body, in
telemetry, in a log, in a CSV filename, or in an `audit_logs` payload.

### 10.5 `booking_preorder_selections` (Phase 1, prefix `bps_`)

```sql
CREATE TABLE public.booking_preorder_selections (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cover_id           uuid NOT NULL,
  order_id           uuid NOT NULL,
  booking_period_id  uuid NOT NULL,

  course             text NOT NULL,
  -- 'item' = they picked a dish. 'none' = they told us they are not having this course.
  -- Absence of a row = we have not been told. See §6.
  choice             text NOT NULL,
  menu_item_id       uuid,                  -- NULL exactly when choice = 'none'

  -- Snapshot of everything the guest was shown when they chose (F07).
  item_name          text,
  item_description   text,
  item_allergens     text,
  item_price_gbp     numeric(10,2),
  menu_item_seen_at  timestamptz,           -- the menu row's updated_at at choosing time

  item_note          text,                  -- optional per-dish instruction. PHASE 2 in the UI.

  invalidated_at     timestamptz,
  invalidated_reason text,

  -- WHO decided. A column, not a join to audit_logs, because a service-day screen must not
  -- join to audit_logs. Overwritten on every write; the history lives in audit_logs.
  decided_by_kind    text NOT NULL DEFAULT 'guest',
  decided_by_user_id uuid,

  decided_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bps_cover_fk
    FOREIGN KEY (cover_id, order_id, booking_period_id)
    REFERENCES public.booking_preorder_covers (id, order_id, booking_period_id)
    ON UPDATE RESTRICT ON DELETE CASCADE,

  -- The dish must belong to this booking's period AND its course must be the course this row
  -- claims. Both checked by PostgreSQL on every insert and update.
  CONSTRAINT bps_menu_item_fk
    FOREIGN KEY (menu_item_id, booking_period_id, course)
    REFERENCES public.booking_period_menu_items (id, period_id, course)
    ON UPDATE RESTRICT ON DELETE RESTRICT,

  -- One decision per cover per course. Changing your mind is an UPDATE.
  CONSTRAINT bps_cover_course_uk UNIQUE (cover_id, course),

  CONSTRAINT bps_course_ck CHECK (course IN ('starter','main','dessert')),
  CONSTRAINT bps_choice_ck CHECK (choice IN ('item','none')),
  -- O4: you cannot decline the main.
  CONSTRAINT bps_main_must_be_item_ck CHECK (NOT (course = 'main' AND choice = 'none')),
  CONSTRAINT bps_choice_item_ck
    CHECK ((choice = 'item' AND menu_item_id IS NOT NULL AND item_name IS NOT NULL)
        OR (choice = 'none' AND menu_item_id IS NULL AND item_name IS NULL)),
  CONSTRAINT bps_invalidated_ck
    CHECK ((invalidated_at IS NULL AND invalidated_reason IS NULL)
        OR (invalidated_at IS NOT NULL AND invalidated_reason IS NOT NULL)),
  CONSTRAINT bps_price_ck
    CHECK (item_price_gbp IS NULL OR (item_price_gbp >= 0 AND item_price_gbp <= 500)),
  CONSTRAINT bps_item_note_ck CHECK (item_note IS NULL OR length(item_note) <= 120),
  CONSTRAINT bps_decided_by_ck CHECK (decided_by_kind IN ('guest','staff','system')),
  -- A staff decision names the member of staff. A guest decision never does, because we do
  -- not have a user id for a guest and must not pretend we do.
  CONSTRAINT bps_decided_by_user_ck
    CHECK ((decided_by_kind = 'staff' AND decided_by_user_id IS NOT NULL)
        OR (decided_by_kind <> 'staff' AND decided_by_user_id IS NULL))
);

CREATE INDEX bps_cover_idx ON public.booking_preorder_selections (cover_id);
CREATE INDEX bps_order_idx ON public.booking_preorder_selections (order_id);
-- Without this, the RESTRICT check on a menu item is a sequential scan of every selection ever
-- made, so editing a dish gets slower every season.
CREATE INDEX bps_menu_item_idx
  ON public.booking_preorder_selections (menu_item_id, booking_period_id, course)
  WHERE menu_item_id IS NOT NULL;
```

Two behaviours a developer will otherwise discover the hard way:

1. **PostgreSQL uses `MATCH SIMPLE`.** When `menu_item_id` is NULL the whole composite foreign key is
   treated as satisfied and no lookup happens. That is exactly right for a `choice = 'none'` row.
   `bps_choice_item_ck` is what stops it becoming a loophole.
2. **`ON UPDATE RESTRICT` blocks a manager moving a dish between courses once anybody has ordered it,**
   and `ON DELETE RESTRICT` blocks deleting it. VERIFIED (V5): `upsert_booking_period_menu_item` currently
   permits the course change. Both existing functions must be updated in the **same** migration or a
   manager gets a raw `23503`. §12.1.

### 10.6 `booking_preorder_amendments` (Phase 1, prefix `bpa_`, closes F22)

The cover-drop plan. **Not** the money.

```sql
CREATE TABLE public.booking_preorder_amendments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             uuid NOT NULL
                         REFERENCES public.booking_preorder_orders(id) ON DELETE CASCADE,

  kind                 text NOT NULL,
  from_party_size      integer NOT NULL,
  to_party_size        integer NOT NULL,

  -- The plan, computed and shown BEFORE anything changes (F22 asked for a preview).
  -- [{ "cover_id":"...", "ordinal":3, "contact_id":"...", "guest_name":"Ann",
  --    "state":"complete", "first_completed_at":"...", "dishes":["Turkey","no dessert"] }]
  -- CONTAINS PERSONAL DATA. It is in the retention sweep (Part 3 §5.2): guest_name and dishes are
  -- stripped at D+60 and the row is deleted at D+90.
  planned_drops        jsonb NOT NULL DEFAULT '[]'::jsonb,

  state                text NOT NULL DEFAULT 'planned',
  planned_at           timestamptz NOT NULL DEFAULT now(),
  applied_at           timestamptz,
  actor_user_id        uuid,
  actor_kind           text NOT NULL,
  reason               text,

  -- Set by the SEPARATE refund workstream when it lands. Nullable now so that workstream
  -- needs no migration on this table.
  booking_amendment_id uuid,

  CONSTRAINT bpa_state_ck CHECK (state IN ('planned','applied','abandoned')),
  CONSTRAINT bpa_kind_ck  CHECK (kind IN ('shrink','grow','course_set_rebaseline')),
  CONSTRAINT bpa_actor_ck CHECK (actor_kind IN ('staff','guest','system')),
  CONSTRAINT bpa_applied_ck CHECK ((state = 'applied') = (applied_at IS NOT NULL)),
  CONSTRAINT bpa_sizes_ck CHECK (from_party_size > 0 AND to_party_size > 0),
  -- The kind and the direction must agree, or a 'shrink' row can grow a party and the
  -- preview in planned_drops means nothing.
  CONSTRAINT bpa_kind_direction_ck CHECK (
    (kind = 'shrink'                AND to_party_size <  from_party_size) OR
    (kind = 'grow'                  AND to_party_size >  from_party_size) OR
    (kind = 'course_set_rebaseline' AND to_party_size =  from_party_size)),
  CONSTRAINT bpa_drops_ck CHECK (kind = 'shrink' OR planned_drops = '[]'::jsonb)
);

CREATE INDEX bpa_order_idx ON public.booking_preorder_amendments (order_id, planned_at DESC);

ALTER TABLE public.booking_preorder_covers
  ADD CONSTRAINT bpcov_amendment_fk FOREIGN KEY (dropped_amendment_id)
  REFERENCES public.booking_preorder_amendments(id) ON DELETE SET NULL;
```

**The shrink order, deterministic.** Rank the live covers and drop from the top of this list:

| Rank term | Direction | Why |
|---|---|---|
| 1. `first_completed_at IS NULL` first | never-completed before ever-completed | Somebody who answered keeps their seat |
| 2. Among the never-completed **only**, fewer live selection rows first | emptier first | The `CASE` scoping is not decoration: unscoped it would penalise a guest who deliberately chose two courses |
| 3. Among the ever-completed, `first_completed_at DESC` | latest completer first | The prompt replier is protected |
| 4. `created_at DESC`, then `ordinal DESC`, then `id DESC` | | Total order, so the result is reproducible |

Plan and apply are **separate calls.** `preorder_plan_shrink` writes one amendment row and touches nothing
else. `preorder_apply_amendment` re-runs the plan and **aborts if the cover set changed** since the
preview. Party growth adds covers to the booker contact and does not reset any chase budget.

**The booker does not choose who is removed** (owner default, Phase 1). Staff can drop a specific cover as
`staff_removed` and then shrink.

### 10.7 `booking_preorder_tokens` (Phase 1, prefix `bpt_`, closes F10)

Owner answer O1: a separate table. `guest_tokens.customer_id` stays `NOT NULL` (VERIFIED, V6) and
`guest_tokens` is not touched by this feature at all.

```sql
CREATE TABLE public.booking_preorder_tokens (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hashed_token      text NOT NULL UNIQUE,

  -- The triple, denormalised so the composite FK can police it. There is deliberately NO
  -- second single-column FK to booking_preorder_contacts: two foreign keys from one child to
  -- one parent make PostgREST embeds ambiguous.
  contact_id        uuid NOT NULL,
  order_id          uuid NOT NULL,
  booking_period_id uuid NOT NULL,

  issued_at         timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  revoked_at        timestamptz,
  revoked_reason    text,
  last_used_at      timestamptz,
  use_count         integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bpt_contact_fk
    FOREIGN KEY (contact_id, order_id, booking_period_id)
    REFERENCES public.booking_preorder_contacts (id, order_id, booking_period_id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT bpt_revoked_reason_ck CHECK (revoked_reason IS NULL OR revoked_reason IN
    ('resend','wrong_number_corrected','contact_changed','contact_removed',
     'booking_cancelled','staff_revoked','erasure')),
  CONSTRAINT bpt_revoked_ck CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);

CREATE UNIQUE INDEX bpt_one_live_per_contact
  ON public.booking_preorder_tokens (contact_id) WHERE revoked_at IS NULL;
CREATE INDEX bpt_expiry_idx ON public.booking_preorder_tokens (expires_at);
```

| Rule | Value |
|---|---|
| Reuse | Reusable until expiry. There is deliberately no `consumed_at` |
| `expires_at` | The booking's start time plus 24 hours |
| Expiry versus lock | **Different things.** After `cutoff_at` the token still resolves and the page is read-only. A guest who opens the link on the day should see their meal, not an error. `order_locked` is deliberately not a revocation reason |
| Storage | Hash only, via the existing `hashGuestToken` (plain SHA-256, which is fine for a 256-bit random token and must not be "fixed" into HMAC) |
| Shared code | VERIFIED: `src/lib/guest/tokens.ts` exports `hashGuestToken` (line 29) and declares `generateGuestToken` **without** `export` (line 25). Exporting it is the **only** edit this feature makes to shared token code. `src/lib/guest/token-throttle.ts` is reused with no change: a new scope string `guest_preorder_view` works today |

`bpc_id_order_period_uk` is already exactly what `bpt_contact_fk` targets, so no new unique key is needed
on the parent.

### 10.8 `booking_preorder_outbox` (Phase 1, prefix `bpx_`, closes F19)

**One outbox for every message this feature sends:** chases, notices, manager escalations and alert
digests. Two outboxes would mean two lease mechanisms, two reconcilers, two retention rules and two ways
to lose a message. Part 3 §2 and §3 own the semantics; the shape is canonical here.

```sql
CREATE TABLE public.booking_preorder_outbox (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULL only on message_class = 'alert', which is a cross-booking digest.
  table_booking_id      uuid REFERENCES public.table_bookings(id) ON DELETE CASCADE,
  contact_id            uuid REFERENCES public.booking_preorder_contacts(id) ON DELETE CASCADE,

  chase_point           text NOT NULL,
  channel               text NOT NULL,
  message_class         text NOT NULL DEFAULT 'chase',
  notice_kind           text,               -- set only on message_class = 'notice'

  due_at                timestamptz NOT NULL,
  -- A COPY of booking_preorder_orders.revision at compose time. Drives the stale-body rebuild.
  order_revision        integer,

  -- All four are written by the WORKER at claim time, then frozen, so every retry sends
  -- identical text.
  recipient             text,
  body                  text,
  subject               text,
  body_html             text,

  status                text NOT NULL DEFAULT 'pending',
  cancel_reason         text,

  lease_token           uuid,
  lease_expires_at      timestamptz,
  lease_recoveries      integer NOT NULL DEFAULT 0,

  attempt_count         integer NOT NULL DEFAULT 0,
  max_attempts          integer NOT NULL DEFAULT 3,
  next_attempt_at       timestamptz,
  last_error            text,
  last_error_code       text,

  idempotency_key       text NOT NULL UNIQUE,
  provider              text,
  provider_message_id   text,
  message_row_id        uuid,
  accepted_at           timestamptz,
  delivered_at          timestamptz,
  delivery_unknown      boolean NOT NULL DEFAULT false,

  correlation_id        uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bpx_channel_ck CHECK (channel IN ('sms','email')),
  CONSTRAINT bpx_class_ck CHECK (message_class IN ('chase','notice','escalation','alert')),
  CONSTRAINT bpx_point_ck CHECK (chase_point IN ('T0','C1','C2','CUT','NOTICE','ESC','ALERT')),

  -- There is deliberately NO 'undelivered' status. A delivery failure after provider
  -- acceptance is 'failed'.
  CONSTRAINT bpx_status_ck CHECK (status IN
    ('pending','sending','accepted','delivered','failed','dead_letter','cancelled')),

  -- Fourteen values. There is deliberately no 'stale_revision': a stale pending row is rebuilt
  -- in place, never cancelled, because cancel-and-reinsert is what created the index conflict
  -- that F19 identified.
  CONSTRAINT bpx_cancel_reason_ck CHECK (cancel_reason IS NULL OR cancel_reason IN
    ('skipped_past','skipped_cap','quiet_window','after_cutoff','duplicate_instant',
     'completed','cancelled_booking','opted_out','unreachable','rescheduled',
     'kill_switch','amended','no_permission','suppressed')),

  CONSTRAINT bpx_notice_kind_ck CHECK (notice_kind IS NULL OR notice_kind IN
    ('amendment','item_withdrawn','cover_dropped')),

  -- One shape rule per class. This is what merging the outboxes costs, and it is worth it.
  CONSTRAINT bpx_shape_ck CHECK (
       (message_class = 'chase'      AND table_booking_id IS NOT NULL AND contact_id IS NOT NULL
                                     AND chase_point IN ('T0','C1','C2','CUT')
                                     AND order_revision IS NOT NULL AND notice_kind IS NULL)
    OR (message_class = 'notice'     AND table_booking_id IS NOT NULL AND contact_id IS NOT NULL
                                     AND chase_point = 'NOTICE'
                                     AND order_revision IS NOT NULL AND notice_kind IS NOT NULL)
    OR (message_class = 'escalation' AND table_booking_id IS NOT NULL AND contact_id IS NULL
                                     AND chase_point = 'ESC' AND channel = 'email'
                                     AND order_revision IS NULL AND notice_kind IS NULL)
    OR (message_class = 'alert'      AND table_booking_id IS NULL AND contact_id IS NULL
                                     AND chase_point = 'ALERT' AND channel = 'email'
                                     AND order_revision IS NULL AND notice_kind IS NULL)),

  CONSTRAINT bpx_accepted_ck CHECK (status <> 'accepted' OR accepted_at IS NOT NULL),
  CONSTRAINT bpx_cancel_shape_ck CHECK ((status = 'cancelled') = (cancel_reason IS NOT NULL))
);

-- The business key, restricted to LIVE rows ONLY. This is the F19 fix: a cancelled or terminal
-- row is a ledger entry and must never block a legitimate re-arm of the same point.
CREATE UNIQUE INDEX bpx_contact_point_channel_live_uq
  ON public.booking_preorder_outbox (contact_id, chase_point, channel)
  WHERE message_class = 'chase' AND status IN ('pending','sending');
CREATE UNIQUE INDEX bpx_booking_esc_live_uq
  ON public.booking_preorder_outbox (table_booking_id)
  WHERE chase_point = 'ESC' AND status IN ('pending','sending');
CREATE INDEX bpx_due_idx ON public.booking_preorder_outbox (due_at) WHERE status = 'pending';
CREATE INDEX bpx_lease_idx ON public.booking_preorder_outbox (lease_expires_at)
  WHERE status = 'sending';
CREATE INDEX bpx_provider_msg_idx ON public.booking_preorder_outbox (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Required on EXISTING tables so the reconciler does not sequentially scan `messages`.
CREATE INDEX IF NOT EXISTS messages_metadata_stage_idx
  ON public.messages ((metadata ->> 'stage')) WHERE metadata ->> 'stage' IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_messages_metadata_stage_idx
  ON public.email_messages ((metadata ->> 'stage')) WHERE metadata ->> 'stage' IS NOT NULL;
```

**The send gate.** The claim statement's `WHERE` clause must include the permission gate, and a
`BEFORE UPDATE` trigger must refuse a transition to `sending` for an uncovered contact. A function is not a
constraint; the trigger is what turns a convention into a guarantee.

```sql
-- Written so it is correct in BOTH phases with no Phase 2 change to the claim path: the booker
-- is always covered, because they gave us their own number.
CREATE OR REPLACE FUNCTION public.preorder_contact_is_covered(p_contact_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.booking_preorder_contacts c
                  WHERE c.id = p_contact_id AND c.is_booker)
      OR EXISTS (SELECT 1 FROM public.booking_preorder_permission_evidence pe
                  WHERE pe.contact_id = p_contact_id AND pe.revoked_at IS NULL);
$$;
```

`SECURITY INVOKER`, not `SECURITY DEFINER`. The only caller is the claim step, which already runs as
`service_role`. A definer-rights function reachable by `anon` would be a free oracle for "is this contact
id real and permitted", and it buys nothing.

An uncovered contact goes to `cancelled` with `no_permission`. A suppressed number goes to `cancelled`
with `suppressed`. **`blocked_no_permission` is not a status and must not be invented.**

### 10.9 `preorder_alerts` (Phase 1, prefix `pal_`)

```sql
CREATE TABLE public.preorder_alerts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_key         text NOT NULL UNIQUE,   -- e.g. 'incomplete_at_cutoff:<booking_id>'
  alert_type        text NOT NULL,
  severity          text NOT NULL,
  table_booking_id  uuid REFERENCES public.table_bookings(id) ON DELETE CASCADE,
  correlation_id    uuid,
  -- Structured and minimal. NEVER a phone number, guest name or dietary note. Enforced by an
  -- acceptance test (§14.2), not only by this comment.
  detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            text NOT NULL DEFAULT 'open',
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  occurrence_count  integer NOT NULL DEFAULT 1,
  notified_at       timestamptz,
  resolved_at       timestamptz,
  resolved_by       uuid,

  CONSTRAINT pal_type_ck CHECK (alert_type IN
    ('incomplete_at_cutoff','menu_item_withdrawn','covers_mismatch','outbox_stalled',
     'backfill_candidates','sms_budget_exceeded','completion_floor_breached',
     'amendment_manual_review','refund_failed')),
  CONSTRAINT pal_severity_ck CHECK (severity IN ('info','warning','critical')),
  CONSTRAINT pal_status_ck CHECK (status IN
    ('open','notified','acknowledged','resolved','suppressed'))
);

CREATE INDEX pal_open_idx ON public.preorder_alerts (severity, first_seen_at)
  WHERE status IN ('open','notified');
```

`amendment_manual_review` and `refund_failed` are declared now but only fire once the separate refund
workstream lands. Declaring them costs nothing and avoids a second CHECK migration later.

`info` and `warning` batch every 15 minutes into one digest. `critical` (`refund_failed`,
`covers_mismatch`) sends immediately: money and data integrity do not wait. An open alert re-notifies at
most once every 24 hours until acknowledged. Digest cap 50 items, then a summary with a link. Alerts
auto-resolve when the condition clears and the next digest says so in one line, because staff should see
problems close, not only open. Digests go through `booking_preorder_outbox` with `message_class = 'alert'`
and carry **no phone number, no guest name and no dietary content, ever.**

### 10.10 `booking_period_demand_stats` (Phase 1, prefix `bpds_`, the O5 aggregate)

```sql
CREATE TABLE public.booking_period_demand_stats (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NOT cascaded. O5 asked to keep this for 2 years; a cascade from a period delete would
  -- destroy exactly the data the retention split promised to preserve.
  booking_period_id uuid REFERENCES public.booking_periods(id) ON DELETE SET NULL,
  period_name       text NOT NULL,          -- snapshot, survives the FK being nulled

  service_date      date NOT NULL,
  -- NOT NULL with a sentinel. A nullable column in a UNIQUE key does not deduplicate in
  -- PostgreSQL, so the "idempotent on its unique key" promise would silently fail.
  service_slot      text NOT NULL DEFAULT 'all',

  metric            text NOT NULL,          -- 'dish' | 'course_shape'
  course            text,                   -- set when metric = 'dish'
  menu_item_id      uuid,                   -- deliberately NOT a foreign key
  item_name         text,                   -- set when metric = 'dish'
  course_shape      text,                   -- set when metric = 'course_shape'

  party_size_band   text NOT NULL,          -- '1-2'|'3-5'|'6-9'|'10-19'|'20+'
  covers_count      integer NOT NULL CHECK (covers_count  >= 0),
  bookings_count    integer NOT NULL CHECK (bookings_count >= 0),
  computed_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bpds_metric_ck CHECK (metric IN ('dish','course_shape')),
  CONSTRAINT bpds_slot_ck   CHECK (service_slot IN ('lunch','evening','all')),
  CONSTRAINT bpds_band_ck   CHECK (party_size_band IN ('1-2','3-5','6-9','10-19','20+')),
  CONSTRAINT bpds_shape_ck CHECK (
       (metric = 'dish'         AND course IS NOT NULL AND item_name IS NOT NULL
                                AND course_shape IS NULL
                                AND course IN ('starter','main','dessert'))
    OR (metric = 'course_shape' AND course IS NULL AND item_name IS NULL
                                AND menu_item_id IS NULL AND course_shape IS NOT NULL
                                AND course_shape IN ('main_only','starter_main',
                                      'main_dessert','all_three','incomplete')))
);

CREATE UNIQUE INDEX bpds_key_uq ON public.booking_period_demand_stats (
  booking_period_id, service_date, service_slot, metric,
  coalesce(course,''), coalesce(item_name,''), coalesce(course_shape,''), party_size_band);
```

`course_shape` is a **metric derived from the selection rows at aggregate time,** not a stored count on
the cover. Without it, "how many people took three courses" (a first-order ordering question) could not be
answered from the aggregate, and the claim that the aggregate serves O5's purpose would be untrue.
`incomplete` covers a meal that happened with a cover that never finished, which is itself useful.

Party size is **banded** and bookings are counted, because "1 booking, party of 17, on 12 December,
ordered the beef" is re-identifiable by anyone who can see the diary.

**Known weakness, stated rather than hidden.** On a quiet service a band can hold a single booking and
`covers_count` can be 1. That row holds no name, number or note, so the residual risk is low.
**Recommendation: do not suppress single-booking rows in version 1**, but the aggregate is therefore not
certified anonymous and nobody should later assume it is.

### 10.11 Phase 2 and separate-workstream tables

Declared here so nobody invents a second shape later. Neither ships in Phase 1.

`booking_preorder_permission_evidence` (prefix `bppe_`): one row per covered person, grouped by
`batch_id`. Append only; a correction is a new batch; withdrawal sets `revoked_at` on the affected rows
only. Not cascaded from the booking or the contact, because it must outlive both: it is the record that we
were entitled to contact people. Stores `phone_hmac` (HMAC-SHA256 with a new secret
`PREORDER_PHONE_HMAC_SECRET`, never a plain hash, because the UK mobile space is small enough to brute
force a plain SHA-256 in seconds). Treat that secret as non-rotatable in normal operation: rotating it
orphans every suppression row, and people who opted out would silently become contactable again.

`preorder_sms_suppression` (prefix `pss_`): `phone_hmac` primary key, `suppressed_at`, `source`, `note`.
**Never deleted from, no retention period.** The one place where keeping data forever is the
privacy-protective choice: the instruction must outlive the booking and the contact row. It holds no name,
no number and no booking link, only an irreversible hash and a date. Say so in the privacy notice. Opt
back in only by asking a member of staff, recorded as `source = 'staff'` with a note; there is no
self-service opt-back-in, because the only way to offer one is to text them, which is what they asked us
to stop.

`booking_amendments` (separate workstream): the money saga. Its only link to this model is
`booking_preorder_amendments.booking_amendment_id`, set by the money workstream. The pre-order amendment
is the parent concept (a party change) and the money saga is the consequence.
`payment_refunds.booking_amendment_id` continues to point at `booking_amendments`, which is correct: a
refund is a money fact. Two tables is deliberate: different lifecycles (a cover plan applies in one
transaction, a refund saga can sit in manual review for days), different retention, different owners.

### 10.12 The views (Phase 1)

Three, not four: two views over the same key is how two callers end up disagreeing.

| View | Contents |
|---|---|
| `v_booking_preorder_cover_status` | Per cover: `cover_state` per §6, live and invalid selection counts, dishes chosen |
| `v_booking_preorder_contact_status` | Per contact: `contact_state` per §6, live cover count, `occasions_consumed`, `transmissions_attempted`, `last_chased_at`, `has_dead_letter` |
| `v_booking_preorder_order_status` | Per order: `order_state` per §6, covers outstanding, party size, `cutoff_at`, `fulfilment_state`, `locked_at`, changed-since-print boolean |

```sql
CREATE VIEW public.v_booking_preorder_cover_status AS
SELECT
  c.id AS cover_id, c.order_id, c.contact_id, c.ordinal,
  c.guest_name, c.first_completed_at, c.completed_at, c.dropped_at,
  o.course_set,
  count(s.id) FILTER (WHERE s.invalidated_at IS NULL)                       AS live_selections,
  count(s.id) FILTER (WHERE s.invalidated_at IS NOT NULL)                   AS invalid_selections,
  count(s.id) FILTER (WHERE s.invalidated_at IS NULL AND s.choice = 'item') AS dishes_chosen,
  CASE
    WHEN c.dropped_at IS NOT NULL THEN 'dropped'
    WHEN count(s.id) FILTER (WHERE s.invalidated_at IS NOT NULL) > 0 THEN 'blocked'
    WHEN count(s.id) FILTER (WHERE s.invalidated_at IS NULL) = 0 THEN 'unstarted'
    WHEN (SELECT bool_and(EXISTS (
            SELECT 1 FROM public.booking_preorder_selections s2
             WHERE s2.cover_id = c.id AND s2.course = needed AND s2.invalidated_at IS NULL))
          FROM unnest(o.course_set) AS needed) THEN 'complete'
    ELSE 'partial'
  END AS cover_state
FROM public.booking_preorder_covers c
JOIN public.booking_preorder_orders o ON o.id = c.order_id
LEFT JOIN public.booking_preorder_selections s ON s.cover_id = c.id
GROUP BY c.id, o.course_set;
```

`occasions_consumed` counts **distinct** `chase_point` values in terminal sent states, excluding `ESC`, so
a cancelled or re-armed point never charges a contact twice.

**PostgreSQL views freeze their column lists.** If any of these tables gains a column later, every view
must be recreated in the same migration. Write that into the migration header.

---

## 11. Invariants, enforced in the database (F04)

| # | Invariant | Mechanism |
|---|---|---|
| I1 | Exactly one booker contact per order | Partial unique index for "at most one", plus a `DEFERRABLE INITIALLY DEFERRED` constraint trigger for "at least one" |
| I2 | Live covers on an order sum to the booking's party size | Deferred constraint trigger on covers, orders and `table_bookings.party_size` |
| I3 | A child's period matches its booking's period | Composite foreign key chain, checked immediately |
| I4 | A selection's dish belongs to the right period and its course agrees with the dish | `bps_menu_item_fk`, checked immediately |
| I5 | A booking with an order cannot change period and cannot move to a date outside its period | `ON UPDATE RESTRICT` on the composite key, plus one date-guard trigger |

Deferred is essential for I1 and I2: an order and its booker are two statements in one transaction, so an
immediate check would fail on the first. Deferring judges the transaction on its result, not on its write
order. Deferred checks alone are **not** concurrency-safe, because two transactions can each add a cover
and each pass their own commit-time check; §11.3 closes that with a lock.

### 11.1 I1, exactly one booker

```sql
CREATE OR REPLACE FUNCTION public.preorder_assert_has_one_booker()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order_id uuid;
  v_bookers  integer;
BEGIN
  -- NEW and OLD are records of the TRIGGERING table, and NEW is unassigned on DELETE.
  -- Branch on both before naming any column, or plpgsql raises at runtime.
  IF TG_TABLE_NAME = 'booking_preorder_orders' THEN
    v_order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    v_order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  END IF;

  -- The order may have been deleted in this same transaction. Nothing to assert.
  IF NOT EXISTS (SELECT 1 FROM public.booking_preorder_orders WHERE id = v_order_id) THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_bookers
  FROM public.booking_preorder_contacts
  WHERE order_id = v_order_id AND is_booker;

  IF v_bookers <> 1 THEN
    RAISE EXCEPTION
      'A pre-order must have exactly one booker contact. Order % has %.', v_order_id, v_bookers
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER bpc_one_booker_deferred
  AFTER INSERT OR UPDATE OR DELETE ON public.booking_preorder_contacts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.preorder_assert_has_one_booker();

CREATE CONSTRAINT TRIGGER bpo_one_booker_deferred
  AFTER INSERT ON public.booking_preorder_orders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.preorder_assert_has_one_booker();
```

### 11.2 I2, covers sum to party size

```sql
CREATE OR REPLACE FUNCTION public.preorder_assert_cover_balance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_booking_id uuid;
  v_order_id   uuid;
  v_party      integer;
  v_live       integer;
BEGIN
  IF TG_TABLE_NAME = 'table_bookings' THEN
    v_booking_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    SELECT id INTO v_order_id
      FROM public.booking_preorder_orders WHERE table_booking_id = v_booking_id;
    IF v_order_id IS NULL THEN RETURN NULL; END IF;   -- no pre-order, nothing to balance
  ELSIF TG_TABLE_NAME = 'booking_preorder_orders' THEN
    v_order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    SELECT table_booking_id INTO v_booking_id
      FROM public.booking_preorder_orders WHERE id = v_order_id;
    IF v_booking_id IS NULL THEN RETURN NULL; END IF; -- order deleted in this transaction
  ELSE                                                -- booking_preorder_covers
    v_order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
    SELECT table_booking_id INTO v_booking_id
      FROM public.booking_preorder_orders WHERE id = v_order_id;
    IF v_booking_id IS NULL THEN RETURN NULL; END IF;
  END IF;

  SELECT party_size INTO v_party FROM public.table_bookings WHERE id = v_booking_id;
  IF v_party IS NULL THEN RETURN NULL; END IF;        -- booking deleted in this transaction

  SELECT count(*) INTO v_live
  FROM public.booking_preorder_covers
  WHERE order_id = v_order_id AND dropped_at IS NULL;

  IF v_live <> v_party THEN
    RAISE EXCEPTION
      'Pre-order covers must match the party size. Booking % has % live cover(s) for a party of %.',
      v_booking_id, v_live, v_party
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER bpcov_balance_deferred
  AFTER INSERT OR UPDATE OR DELETE ON public.booking_preorder_covers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.preorder_assert_cover_balance();

CREATE CONSTRAINT TRIGGER bpo_balance_deferred
  AFTER INSERT ON public.booking_preorder_orders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.preorder_assert_cover_balance();

CREATE CONSTRAINT TRIGGER table_bookings_preorder_balance_deferred
  AFTER UPDATE ON public.table_bookings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.party_size IS DISTINCT FROM OLD.party_size)
  EXECUTE FUNCTION public.preorder_assert_cover_balance();
```

**This fires on the existing amendment path without changing it.** Party size is amended by TypeScript in
`src/lib/table-bookings/manage-booking.ts`, not by a single RPC (SECTION-CLAIMED, re-read before writing
the migration). The trigger on `table_bookings` means that path cannot shrink a party and leave the covers
behind, whatever it does: it gets an error at commit. That is why `preorder_plan_shrink` has to exist and
why the amendment path has to call it.

**A3, the `WHEN` clause.** If the target PostgreSQL version rejects `WHEN` on a `CONSTRAINT TRIGGER`, drop
it and put `IF NEW.party_size IS NOT DISTINCT FROM OLD.party_size THEN RETURN NULL; END IF;` as the first
line of the function body. `table_bookings` is a hot table and the guard must exist in one form or the
other.

### 11.3 One lock, taken by everybody

```sql
-- Inside every mutating RPC, before anything else.
PERFORM 1 FROM public.booking_preorder_orders
  WHERE table_booking_id = p_booking_id FOR UPDATE;

-- The party-size path does not go through those RPCs today, so it gets the lock from a trigger.
CREATE OR REPLACE FUNCTION public.preorder_lock_order_for_party_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM public.booking_preorder_orders
    WHERE table_booking_id = NEW.id FOR UPDATE;
  RETURN NEW;
END;
$$;

CREATE TRIGGER table_bookings_preorder_lock
  BEFORE UPDATE OF party_size ON public.table_bookings
  FOR EACH ROW EXECUTE FUNCTION public.preorder_lock_order_for_party_change();
```

Every writer that could break I2 serialises on one row per booking, with no change to the existing
amendment code. Concurrent writers to different bookings do not contend at all. Bulk withdrawal takes
order locks in **ascending `order_id` order**, which is what stops two concurrent withdrawals deadlocking.

### 11.4 I5, the date half of O2

VERIFIED: the existing `assert_seasonal_booking_type_in_period` trigger only guards
`booking_type = 'christmas'` against `period_kind = 'christmas'`. It never looks at `booking_period_id`
and does not fire for Mother's Day, Easter or Father's Day. It is not sufficient and is not touched.

```sql
CREATE OR REPLACE FUNCTION public.preorder_assert_booking_stays_in_period()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_period public.booking_periods;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.booking_preorder_orders WHERE table_booking_id = NEW.id
  ) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_period FROM public.booking_periods WHERE id = NEW.booking_period_id;

  IF v_period.id IS NULL
     OR NEW.booking_date NOT BETWEEN v_period.starts_on AND v_period.ends_on THEN
    RAISE EXCEPTION
      'This booking has food pre-orders for %, which runs % to %. Moving it to % would leave the orders behind. Cancel it and take a new booking instead.',
      v_period.name, to_char(v_period.starts_on,'DD Mon'), to_char(v_period.ends_on,'DD Mon'),
      to_char(NEW.booking_date,'DD Mon YYYY')
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER table_bookings_preorder_date_guard
  BEFORE UPDATE OF booking_date ON public.table_bookings
  FOR EACH ROW EXECUTE FUNCTION public.preorder_assert_booking_stays_in_period();
```

**One date guard, not two.** There is exactly one trigger name and one function name, listed above. Two
`BEFORE UPDATE OF booking_date` triggers with different semantics, near a period whose dates a manager
later edits, is a bug waiting for December. Together with `ON UPDATE RESTRICT`, O2 is enforced twice over
and cannot be walked around by staff, a script or a future code path.

### 11.5 Cancellation, deletion and erasure are three different operations (F25)

| Operation | Booking row | Pre-order | Mechanism |
|---|---|---|---|
| **Cancellation** (`status = 'cancelled'`) | Stays, status changes | Nothing deleted. `orders.status = 'cancelled'`. Chases stop, tokens are revoked, the guest link shows a plain "this booking has been cancelled" page | A status-sync trigger, `preorder_sync_order_on_booking_status()` |
| **Administrative hard delete** | Gone | Cascade removes everything. A **redacted** tombstone is written first | `ON DELETE CASCADE` plus the `BEFORE DELETE` trigger below |
| **GDPR erasure** | Stays | No rows removed. Personal fields cleared, food data kept, `orders.erased_at` stamped | Part 3 §5.4 |

The status-sync trigger stops at the order row. Revoking tokens and cancelling queued messages cannot be
done safely inside a trigger and belong to the token and outbox components. What the trigger guarantees is
that those components have one reliable thing to read.

I2 still holds on a cancelled order, because the covers are still there and the party size did not change.
That is intentional: a cancelled booking's pre-order remains a coherent historical record.

**The tombstone ships redacted.** VERIFIED (V7): table bookings are hard deleted by production tooling.
`audit_logs` rows are permanently undeletable, so `guest_name`, `dietary_note` and `item_note` must never
enter one. The question a tombstone answers is "did this booking have twelve pre-ordered meals when it
vanished", and that is answerable with ids, dish names, courses and counts alone.

```sql
CREATE OR REPLACE FUNCTION public.preorder_tombstone_before_booking_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.booking_preorder_orders;
  v_snapshot jsonb;
BEGIN
  SELECT * INTO v_order FROM public.booking_preorder_orders WHERE table_booking_id = OLD.id;
  IF v_order.id IS NULL THEN RETURN OLD; END IF;

  SELECT jsonb_build_object(
    'order', jsonb_build_object(
       'id', v_order.id, 'table_booking_id', v_order.table_booking_id,
       'booking_period_id', v_order.booking_period_id, 'course_set', v_order.course_set,
       'cutoff_at', v_order.cutoff_at, 'status', v_order.status,
       'revision', v_order.revision, 'created_at', v_order.created_at),
    'cover_count', (SELECT count(*) FROM public.booking_preorder_covers c
                     WHERE c.order_id = v_order.id AND c.dropped_at IS NULL),
    'dropped_cover_count', (SELECT count(*) FROM public.booking_preorder_covers c
                     WHERE c.order_id = v_order.id AND c.dropped_at IS NOT NULL),
    'covers', (SELECT jsonb_agg(jsonb_build_object(
                 'cover_id', c.id, 'ordinal', c.ordinal,
                 'first_completed_at', c.first_completed_at,
                 'completed_at', c.completed_at, 'dropped_at', c.dropped_at))
               FROM public.booking_preorder_covers c WHERE c.order_id = v_order.id),
    'selections', (SELECT jsonb_agg(jsonb_build_object(
                 'cover_id', s.cover_id, 'course', s.course, 'choice', s.choice,
                 'menu_item_id', s.menu_item_id, 'item_name', s.item_name,
                 'item_price_gbp', s.item_price_gbp))
               FROM public.booking_preorder_selections s WHERE s.order_id = v_order.id)
  ) INTO v_snapshot;

  INSERT INTO public.audit_logs
    (user_id, operation_type, resource_type, resource_id, operation_status,
     old_values, additional_info)
  VALUES
    (NULL, 'delete', 'booking_preorder_order', v_order.id::text, 'success', v_snapshot,
     jsonb_build_object('cause','table_booking_hard_deleted','table_booking_id', OLD.id));

  RETURN OLD;
END;
$$;

CREATE TRIGGER table_bookings_preorder_tombstone
  BEFORE DELETE ON public.table_bookings
  FOR EACH ROW EXECUTE FUNCTION public.preorder_tombstone_before_booking_delete();
```

**`BEFORE DELETE` is load bearing.** PostgreSQL implements a referential cascade as an internal `AFTER`
trigger on the referenced table, so this runs while the child rows still exist and can still be read. An
`AFTER DELETE` version would snapshot nothing, silently.

### 11.6 Grants: the door everybody forgets

VERIFIED (V9): on this project a new function in `public` gets `EXECUTE` granted to `anon` and
`authenticated` **by name**, not through `PUBLIC`. That distinction is the whole point: `REVOKE ALL FROM
PUBLIC` does **not** remove a grant made to a named role, so revoking from `PUBLIC` alone leaves the
function wide open while looking locked down. The migration header of `20260803000100` says this in as
many words. Both revokes are therefore required. Because every function is `preorder_*`, the lockdown is
one loop that cannot miss a name.

```sql
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'preorder\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;
```

Then copy the assertion block from `20260803000100` with the same filter, so the migration **raises**
rather than reporting success if anything is still open. **Run it last,** so it sees every function the
migration created. Trigger functions are included on purpose: a trigger fires under the table owner's
rights regardless of who may call it, so revoking `EXECUTE` costs nothing and removes a directly callable
`SECURITY DEFINER` entry point.

**Table grants.** All twelve tables: RLS enabled, one `FOR ALL TO service_role` policy,
`REVOKE ALL FROM anon, authenticated`. Nothing is reachable by `anon` or `authenticated`, not the tables
and not the functions. Guest pages are served by server-side routes using the admin client, exactly as the
existing `/g/` journeys are. A guest has no Supabase identity, so there is nothing for an RLS policy to
match on.

**Recorded decision, not left implicit:** `service_role` gets **full DML**, following the established
project pattern, rather than `SELECT` only with all writes through RPCs. Deviating from an established
pattern for one feature is a maintenance tax, and the deferred triggers still hold the invariants at
commit. The cost is that a concurrent writer which skips the §11.3 lock fails at commit instead of
blocking, which is noisier but still correct.

---

## 12. Changes to existing database objects

### 12.1 Three existing functions must change in the same migration, not later

All three are SECTION-CLAIMED from `20260803000100` and must be re-read before writing the migration.
Shipping the new foreign keys without these changes gives managers raw PostgreSQL errors.

| Function | Change | Why |
|---|---|---|
| `delete_booking_period_menu_item` | Refuse when any selection references the item, with a sentence a manager can act on | `bps_menu_item_fk` `ON DELETE RESTRICT` otherwise raises a `23503` |
| `upsert_booking_period_menu_item` | Refuse a `course` change when any selection references the item. The guard must **not** filter on `invalidated_at IS NULL`: match the constraint, which counts every referencing row, not the intuition | VERIFIED (V5): the function currently allows the edit. `ON UPDATE RESTRICT` will start rejecting it |
| `booking_period_menu_ready` | Require an active row on `course = 'main'`, not any active row | VERIFIED (V4): it currently returns true for a period publishing only desserts, on which no cover can ever be completed. One line, and it fixes the guest flow, the staff flow and the website endpoint at once |

### 12.2 New columns on `booking_periods`

```sql
ALTER TABLE public.booking_periods
  ADD COLUMN preorder_cutoff_hour_local smallint NOT NULL DEFAULT 12
    CHECK (preorder_cutoff_hour_local BETWEEN 9 AND 21),
  ADD COLUMN chase_offsets_days integer[] NOT NULL DEFAULT '{7,4}',
  ADD COLUMN chase_anchor text NOT NULL DEFAULT 'booking'
    CHECK (chase_anchor IN ('booking','cutoff'));

ALTER TABLE public.booking_periods
  ADD CONSTRAINT booking_periods_chase_offsets_ck CHECK (
    coalesce(array_length(chase_offsets_days, 1), 0) BETWEEN 0 AND 2
    AND NOT EXISTS (SELECT 1 FROM unnest(chase_offsets_days) v WHERE v < 0 OR v > 120));
```

`preorder_cutoff_days` already exists on `booking_periods` and defaults to 7 (SECTION-CLAIMED,
`20260803000100`). It is not added here.

**The column defaults and the Christmas 2026 row are deliberately different, and both are correct.** The
column default must be the safe value for a period nobody has configured, so it stays `'booking'` and
`{7,4}`. The Christmas 2026 period row is seeded `chase_anchor = 'cutoff'`, `chase_offsets_days = '{7,3}'`
in M3, because on a 7-day cutoff the column defaults collapse the four-rung ladder to two rungs. Part 3
§2.4 works the arithmetic and Part 3 §12.2 T14 tests both configurations. An array shorter than two
elements is legal and simply means fewer rungs.

### 12.3 New settings keys

Four booleans in a new `preorders` settings section, plus one threshold. All default false, all read
server-side through the existing `public.get_setting_bool(key, default)`, all **failing closed** on a read
error. Registered in `table_booking_settings_keys('preorders')` with one `settings_revisions` row, matching
migration `20260803000100`. Flipping is gated by `checkUserPermission('settings','manage')` and every flip
is audit-logged. §12.3.1 is the per-component check table; Part 3 §8 owns activation.

| Key | Gates | Phase |
|---|---|---|
| `preorder_module_enabled` | **Master.** When false the other three are ignored and treated as false | 1 |
| `preorder_collection_enabled` | Whether choices may be saved by anyone, guest or staff | 1 |
| `preorder_chases_enabled` | Whether any outbound message is queued **or sent**. Checked **per row at claim time**, not only at cron start | 1 |
| `preorder_auto_refund_enabled` | Whether an amendment refund is issued automatically. Gates nothing until the refund workstream lands. Create the key now so the switch exists before the code | Separate |
| `preorder_withdrawal_confirm_threshold` | Distinct contacts above which a mass withdrawal needs typed confirmation. Default 10 | 1 |

Withdrawn and never to be built: `SUSPEND_PREORDER_SMS` and `PREORDER_OUTBOX_ENABLED` environment
variables. An environment variable needs a deploy to flip; a settings row does not. The pre-existing
`SUSPEND_ALL_SMS` and `SUSPEND_EVENT_SMS` variables stay as they are and are not this feature's to change.
Note that pre-order chases carry `table_booking_id`, so `SUSPEND_EVENT_SMS` blocks them too. **That is
documented behaviour, not a bug**, and it is why the dedicated switch exists.

#### 12.3.1 Where every component checks, and what it does when the answer is false

**This table is mandatory. A component with no check is a bug, and this is the F33 answer.** "Reads"
names the keys; the master is implied by all of them, because when the master is false the others are
treated as false.

| Component | Reads | Where the check goes | Behaviour when false |
|---|---|---|---|
| `preorder_create_order()` | `module`, `collection` | First statement, before the order lock | Returns `{ok:false, code:'PREORDER_NOT_ENABLED'}`. Creates nothing |
| `table_bookings` AFTER INSERT bootstrap trigger | `module`, `collection` | First statement of the trigger function | `RETURN NULL`. No order row, **and no raise**: a booking must never fail because of this feature |
| `preorder_save_selections()`, `preorder_set_selection()`, `preorder_set_cover_details()` | `module`, `collection` | First statement | Raises `PREORDER_NOT_ENABLED` |
| Guest page `GET /g/{token}/preorder` | `module`, `collection` | Route handler, **before token resolution** | **404.** Do not confirm the token exists |
| Guest save `POST /g/{token}/preorder/save` | `module`, `collection` | Route handler, before token resolution | **404** |
| Guest JSON `GET /g/{token}/preorder/data` | `module`, `collection` | Route handler, before token resolution | **404** |
| Staff pre-order card, S1 | `module` | Server component, before the query | Card hidden. The legacy Sunday card is unchanged |
| Staff service-day view, S2 | `module` | Server component | Route 404s and the nav item is hidden |
| Staff entry modal, S5 | `module`, `collection` | Server action | `PREORDER_NOT_ENABLED` |
| Sign-off, lock, unlock, S6 | `module` | Server action | `PREORDER_NOT_ENABLED` |
| Print and CSV routes | `module` | Route handler | 404 |
| Lock cron | `module` | First statement after `authorizeCronRequest` | Returns `{skipped:'module_disabled'}` and still persists a cron result |
| Chase **scheduler** cron | `module`, `chases` | Same | Queues nothing |
| Chase **worker** cron | `module`, `chases` | **At claim time, per row, not only at cron start** | Rows stay `pending`. Nothing sends. **This is the rule everybody misses**: checking once at the top of the run leaves a window in which a mid-run flip still sends |
| Outbox reconciler cron | `module` | Same | Skipped |
| Alert digest cron | `module` | Same | Skipped. Alert rows still accumulate |
| **Retention cron** | **none** | n/a | **Deliberate exception.** Retention must run with the module off, or turning the feature off would stop deletion of data already collected. Put that sentence in the route as a comment so nobody "fixes" it |
| Backfill dry run and commit | `module` | Route handler | 409 `PREORDER_NOT_ENABLED` |
| Website periods endpoint, the `preorder` block | `module`, `collection` | AMS side, inside the endpoint | Omits the `preorder` block. **The website then ships dark by construction** |

One behaviour that is deliberately **not** gated: a period with `requires_preorder = true` and a published
menu stays **offerable** while `preorder_module_enabled` is false. Guests can book and pay the seasonal
deposit; they are simply not asked for choices yet. That is what lets the menu be published on schedule in
October without the pre-order journey being ready. Staff see a banner naming the reason.

### 12.4 The function list, canonical names

| Function | Phase | Purpose |
|---|---|---|
| `preorder_course_set_ok(text[])` | 1 | CHECK helper. IMMUTABLE, body frozen |
| `preorder_applicable_courses(uuid)` | 1 | The active starter, main and dessert set for a period |
| `preorder_create_order(uuid, jsonb)` | 1 | Idempotent per booking. Snapshots `course_set` and `cutoff_at`, creates the booker contact and one cover per head, in one transaction |
| `preorder_recompute_order_status(uuid)` | 1 | Derives `status` from the covers. Called inside every mutating transaction |
| `preorder_set_cover_details(...)` | 1 | Guest name, `dietary_codes`, `dietary_note`, `needs_kitchen_call` |
| `preorder_set_selection(...)` | 1 | One decision. Snapshots the dish, clears any invalidation, stamps `decided_by_*`, recomputes completion |
| `preorder_save_selections(uuid, jsonb, integer)` | 1 | Batch transactional wrapper the guest form posts to. Takes the expected revision and raises on mismatch. Kept alongside the single-row primitive: the guest submits a whole form, staff correct one dish |
| `preorder_plan_shrink(uuid, integer)` | 1 | Computes and records the drop plan. Writes one amendment row and nothing else |
| `preorder_apply_amendment(uuid, jsonb)` | 1 | Applies a previously planned shrink or grow, aborting if the cover set moved |
| `preorder_invalidate_selections_for_item(uuid, text, jsonb)` | 1 | Withdrawal, with a preview mode |
| `preorder_rebaseline_course_set(uuid, text[], jsonb)` | 1 | Deliberate, previewed, confirmed re-opening after a menu course change |
| `preorder_issue_token(uuid, text, timestamptz)` | 1 | Revokes the old token and inserts the new one atomically |
| `preorder_revoke_tokens(uuid, text)` | 1 | Cancellation, contact edit, erasure |
| `preorder_booking_fingerprint(uuid)` | 1 | `md5` content fingerprint for late-change detection. Uses built-in `md5`, so `pgcrypto` is not required |
| `preorder_contact_is_covered(uuid)` | 1 | Send gate. §10.8 |
| `preorder_assert_has_one_booker()` | 1 | I1 trigger |
| `preorder_assert_cover_balance()` | 1 | I2 trigger |
| `preorder_assert_booking_stays_in_period()` | 1 | I5 trigger |
| `preorder_lock_order_for_party_change()` | 1 | §11.3 trigger |
| `preorder_sync_order_on_booking_status()` | 1 | Cancellation sync trigger |
| `preorder_tombstone_before_booking_delete()` | 1 | §11.5 |
| `preorder_phone_hmac(text)` | 2 | HMAC-SHA256 of an E.164 number under `PREORDER_PHONE_HMAC_SECRET`. The only place the secret is read. Used by the suppression gate in the outbox claim (Part 3 §3.2) and by the permission-evidence lookup (Part 3 §6.4). **In Phase 1 it is not created and the claim's suppression subquery is a constant false**; declared here so it is not invented under a second name |
| `preorder_add_contact(...)`, `preorder_remove_contact(...)`, `preorder_reassign_cover(...)` | 2 | Delegated contacts |

Withdrawn without replacement: any `preorder_apply_party_size` that skips the plan-then-apply preview
(F22 requires the preview), and any new updated-at trigger function, because
`public.update_updated_at_column()` already exists and is used by dozens of triggers. Reuse it.

Every mutating RPC takes `p_expected_revision` and raises on mismatch. That is the F24 answer: not last
write wins, but "your copy is out of date, here is the current one".

---

## 13. Migration order

Four migrations, each safe on its own, each independently deployable, all inert until the master switch is
flipped.

| # | File | Contents | Safe with old code? |
|---|---|---|---|
| M0 | `…_preorder_prereq_index.sql` | `CREATE UNIQUE INDEX CONCURRENTLY table_bookings_id_period_idx ON public.table_bookings (id, booking_period_id);` **Its own file, no other statements**, because the Supabase CLI wraps each migration in a transaction and `CONCURRENTLY` cannot run inside one | Yes |
| M1 | `…_preorder_foundation.sql` | `ALTER TABLE table_bookings ADD CONSTRAINT table_bookings_id_period_uk UNIQUE USING INDEX table_bookings_id_period_idx`, the `bpmi_id_period_course_uk` constraint, `preorder_course_set_ok`, the nine Phase 1 tables, every index, RLS, grants, updated-at triggers, the three views | Yes. Nothing queries them |
| M2 | `…_preorder_functions.sql` | Every `preorder_*` function, the constraint triggers, the date guard, the lock trigger, the status-sync trigger, the redacted tombstone, and the three changes to existing functions (§12.1). Ends with the grant lockdown loop and the assertion block | Yes |
| M3 | `…_preorder_settings_and_bootstrap.sql` | The four boolean settings keys seeded **false** plus `preorder_withdrawal_confirm_threshold` seeded 10, `table_booking_settings_keys('preorders')`, one `settings_revisions` row, the `booking_periods` columns and CHECK (§12.2), **the Christmas 2026 period row seeded `chase_anchor = 'cutoff'` and `chase_offsets_days = '{7,3}'`**, and the `table_bookings` bootstrap trigger | Yes, because the flag is false so the trigger returns NULL on its first statement |

**Why M0 is separate.** `table_bookings` is a live, hot table and its row count is ASSUMED, not measured
(A1). The two-step build is safe whatever the measurement says; an inline `ADD CONSTRAINT` is not. Set
`SET lock_timeout = '3s'` at the top of M1, M2 and M3 as well, so any `ALTER TABLE` fails fast rather than
blocking bookings. **Do not raise the timeout; retry in a quiet hour.**

`booking_period_menu_items` is ASSUMED small or empty (the Christmas menu is not published until October).
Check the row count before running its constraint. `btree_gist` is not needed and is not installed;
nothing here uses an exclusion constraint.

### 13.1 Deployment order

1. M0, M1, M2, M3. Database only, no behaviour change, everything gated off.
2. AMS application code. Inert, because `preorder_module_enabled` is false.
3. Website code. Ships dark, because AMS is not returning the `preorder` block yet.
4. Cron schedules added to `vercel.json`. **`vercel.json` is the source of truth. Creating a route
   directory is not scheduling a cron.**
5. Regenerate `src/types/database.generated.ts` in its own commit and check the diff for unrelated drift.
   It is already stale in this repo, so this is inherited work, not work this feature causes.
6. Preflight (Part 3 §8.3), then flip the switches in the Part 3 §8.4 order.

### 13.2 Rollback

A settings flip plus a redeploy of the previous commit. **No `DROP TABLE` is ever needed to recover,**
because the tables and triggers are inert while the master flag is false. That is the property that makes
this deployable in September ahead of an October menu. Once real orders exist, dropping the tables means
data loss and is not a real option; that is stated plainly rather than pretending rollback stays free.

---

## 14. Acceptance criteria

### 14.1 Database invariant tests

Each is a transaction that must fail, or a stated outcome. These are database tests, not application tests.

| # | Test | Expected |
|---|---|---|
| 1 | Insert an order with no booker contact, commit | Fails at commit, "exactly one booker" |
| 2 | Insert an order with two booker contacts | Fails, `bpc_one_booker_uk` |
| 3 | Delete the booker contact from a live order | Fails at commit |
| 4 | Insert an order with 3 covers for a party of 4 | Fails at commit, "covers must match" |
| 5 | `UPDATE table_bookings SET party_size = 3` on a booking with 4 live covers | Fails at commit |
| 6 | Insert a selection whose `menu_item_id` belongs to a different period | Fails immediately, `bps_menu_item_fk` |
| 7 | Insert a selection with `course = 'starter'` naming a dish whose course is `main` | Fails immediately, `bps_menu_item_fk` |
| 8 | `UPDATE booking_period_menu_items SET course = 'starter'` on a dish with live selections | Fails immediately |
| 9 | `DELETE` a menu item with live selections | Fails immediately |
| 10 | `UPDATE table_bookings SET booking_period_id = <other>` on a booking with an order | Fails immediately |
| 11 | `UPDATE table_bookings SET booking_period_id = NULL` on a booking with an order | Fails immediately |
| 12 | `UPDATE table_bookings SET booking_date = <outside the period>` on a booking with an order | Fails, date guard, with the plain-English message |
| 13 | Insert a `choice = 'none'` row for `course = 'main'` | Fails, `bps_main_must_be_item_ck` |
| 14 | Insert `choice = 'item'` with `menu_item_id` NULL | Fails, `bps_choice_item_ck` |
| 15 | Two live covers with the same ordinal on one order | Fails, `bpcov_live_ordinal_uk` |
| 16 | The same phone twice on one order | Fails, `bpc_phone_uk` |
| 17 | Set `phone_e164 = 'erased-<uuid>'` | **Succeeds.** The erasure sentinel is permitted |
| 18 | Two concurrent sessions each add a cover to a party of 4 that has 3 | One succeeds, one blocks then fails |
| 19 | Insert an amendment with `kind = 'shrink'` and `to_party_size > from_party_size` | Fails, `bpa_kind_direction_ck` |
| 20 | Withdraw a dish, then re-pick that course | The cover returns to `complete`, not `blocked` |
| 21 | Shrink a party of 6 to 4 with mixed completion states | Drops exactly the two covers the §10.6 rank order predicts, and the full rank order matches |
| 22 | `EXECUTE` every `preorder_*` function as `anon` and as `authenticated` | Permission denied, for all of them |
| 23 | Hard delete a booking with an order, covers and selections | An `audit_logs` row exists, `old_values -> 'covers'` is not null, and the payload contains **no** `guest_name` key |
| 24 | `preorder_create_order` twice for the same booking | The second call is a no-op and returns the same order id |
| 25 | `preorder_create_order` on a period with no active main | Returns the plain-English refusal, not a `23514` |
| 26 | A mutating RPC called with a stale `p_expected_revision` | Raises a revision-conflict error, changes nothing |

### 14.2 Completeness acceptance criteria

| # | Given | Then |
|---|---|---|
| C1 | `course_set = {starter,main,dessert}`, a cover with only a main | `cover_state = 'partial'`, the contact is still chased |
| C2 | The same cover adds `starter = none` and `dessert = none` | `cover_state = 'complete'`, chasing stops for that cover |
| C3 | Every live cover on the order is complete and the live cover count equals the party size | `order_state = 'complete'` |
| C4 | A cover's chosen dish is withdrawn | `cover_state = 'blocked'`, `completed_at` cleared, `first_completed_at` **not** touched |
| C5 | The menu publishes only mains, so `course_set = {main}` | Every cover is complete after one tap. This is correct behaviour, not a bug |
| C6 | A course is added to the menu after orders exist | Live orders are **not** re-opened. Re-baselining is a deliberate, previewed, confirmed action |
| C7 | `preorder_alerts.detail` and every `audit_logs` payload this feature writes | Contain no phone number, guest name, dietary code or free text. UUIDs and counts only. A scanning test asserts it |

---

## 15. What Part 1 leaves open

**Nothing is listed twice in this document.** Every open owner decision, legal decision, unconfirmed fact
and named role lives in the single consolidated register at the end, and Part 1 refers to it by reference.

| Reference | What it decides for Part 1 |
|---|---|
| `OB1` | Whether the phase cut line in §5 is confirmed. **Everything in Part 1 is buildable either way**, because Phase 2 columns already exist as nullable |
| `OB2` | The website one-course conflict (§6.4). It decides whether "complete" can ever mean "no selections at all". **AMS work proceeds meanwhile** |
| `OB3` | The retention numbers, which fix the deletion dates for the columns declared in §10 |
| `OB4` | Finding F08, what a food price means to a guest. It decides nothing structural: `item_price_gbp` is a snapshot column either way (§10.5) |
| `OB5` | The Christmas 2026 period settings seeded in M3 (§13) |
| `OB6` | Amending the stale decision record named in §4.1 |
| `OD1` to `OD23` | Defaults already applied in this part: the cutoff hour (§10.2.2), the hard cutoff (§10.2.3), the dietary picklist (§10.4.1), sides and drinks excluded (§10.5), link reuse (§10.7), staff adding a pre-order (§10.2.1), the shrink order (§10.6), single-booking aggregate rows (§10.10), table grants (§11.6), the nightly tidy-up left out |
| `L2` | Whether `dietary_note` free text is collected at all. **The schema ships either way with no migration** (§10.4.1) |
| `U11`, `U12` | The row counts and the `CONSTRAINT TRIGGER` `WHEN` clause, both of which gate §13's migration plan and have fallbacks written |


---

## Part 2: journeys, fulfilment, tokens and APIs

Verification labels are the ones defined in Part 1 §1.2.

### 0. What this part owns

| Owned here | Not owned here |
|---|---|
| The booker journey, end to end (§3) | The table DDL (Part 1 §10) |
| The staff-on-behalf journey, surface S5 (§4) | The chase ladder timings and the outbox mechanics (Part 3 §2, §3) |
| The kitchen and FOH fulfilment journey, surfaces S1 to S6 (§5) | Retention and erasure (Part 3 §5) |
| The creation state machine (§2) | Deposits, refunds and the growth payment link (Part 3 §7, separate workstream) |
| Token design and the bearer threat model (§6) | Legal classification of dietary free text (`L1` to `L8`) |
| Versioned API contracts, auth, idempotency, error codes (§7) | The readiness switch table (Part 1 §12.3.1) |
| The access matrix (§8) and journey acceptance criteria (§9) | |

**Surface numbering, fixed here so it is used consistently.** S1 the booking-detail pre-order card (§5.4).
S2 the service-day view (§5.5). S3 print, meaning S3a the extended A4 sheet and S3b the prep sheet and
plating list (§5.6). S4 CSV export (§5.7). S5 the staff entry modal (§4). S6 sign-off and lock (§5.10).
**Phase 2 adds** S7 the FOH read view, S8 selective reprint, S9 the menu-allergen cross-check. There is no
other surface number and none should be invented.

### 0.1 The phase cut line, restated

**This is the recommended default. The owner has NOT confirmed it. It is reversible: every Phase 2
column already exists in the Phase 1 schema, nullable, and no Phase 1 contract changes in Phase 2.**

Rationale, stated plainly: nearly every P0 privacy and messaging risk in the developer review exists
**only because somebody other than the booker submits choices**. Remove that one thing and the risk
register collapses. Phase 1 still delivers the actual business need, which is per-cover food choices the
kitchen can cook from.

| | Phase 1, needed for Christmas 2026 | Phase 2 |
|---|---|---|
| Who submits | The booker, for every cover. Plus staff, by phone | Booker plus delegated guest contacts |
| Contacts per order | Exactly one, `is_booker = true` | One booker plus zero or more guests |
| Third-party phone numbers | **None stored** | Stored, with permission evidence |
| Tokens issued | One, to the booker | One per contact |
| Messages sent | Booker (SMS and email) and the manager (email) | Plus guests by SMS, STOP handling, suppression |
| Staff surfaces | S1 to S6 | Plus S7 (FOH read), S8 (selective reprint), S9 (allergen cross-check) |

**Separate workstream, not blocking Christmas:** the automatic deposit refund on amendment (owner
decision D2) and the party-growth payment link (owner decision O3). D2 is binding and the refund **will**
be built; it simply is not Phase 1. The committed decision record
`tasks/seasonal-amendment-deposit-decision-2026-08-03.md` (commit `dac862b7`) records the opposite
decision and **is stale and superseded by the owner's answer of 2026-08-04**. Amend or delete that record
in the same change that builds the refund. VERIFIED: the live code at
`src/lib/table-bookings/staff-deposit-transitions.ts` still returns `state: 'manual_review'` for any
booking carrying a `booking_period_id`, which is the stale behaviour.

### 0.2 Six rulings this part makes, so nobody has to guess

Each resolves a contradiction between the source sections that the source sections left unsettled.

| # | Ruling | Retires |
|---|---|---|
| **R1** | **There is exactly one concurrency token: `booking_preorder_orders.revision`**, carried as `If-Match` on every write, guest and staff alike. A stale value is `409 PREORDER_REVISION_CONFLICT` and the response body carries the current order so the UI can show a per-cover diff. | E's `booking_preorder_covers.revision` and `booking_preorder_contacts.order_revision`. Neither column exists in the canonical schema and neither is built. The good part of E, the per-cover conflict banner, survives: it is built from the 409 body, not from a column. |
| **R2** | **Fingerprints are for print and sign-off staleness only, never for concurrency.** A fingerprint is content-derived, so an edit-and-revert produces the same value, which is exactly right for "has the paper gone stale" and exactly wrong for "did somebody write while I was reading". | A's `expected_fingerprint` request field and its `409 FINGERPRINT_STALE` code. |
| **R3** | **The booking status trigger sets both `status` and `fulfilment_state`**, in the database, not in a server action. A trigger is version-independent and cannot be forgotten by a new code path. | A's instruction to move `fulfilment_state` in `staff-status-actions.ts`. That file still writes the booking status; it simply no longer has to remember the order. |
| **R4** | **Per-selection provenance is `decided_by_kind` and `decided_by_user_id` only** (Part 1 §10.5). The finer channel ("phone", "in person", "correction") is recorded in the `audit_logs` payload, not in a column. | A's `entered_by_user_id`, `entered_via`, `entered_at` columns. They do not exist in the canonical schema. |
| **R5** | **Print state is three columns on the order** (`printed_fingerprint`, `printed_at`, `printed_by`), per Part 1 §10.2. A CSV export writes none of them, so a CSV can never clear a "changed since print" flag by construction. | A's `booking_preorder_print_runs` and `booking_preorder_print_run_items` tables, and the `kind`-filtering rule those tables needed. |
| **R6** | **Guest routes live at `/g/{token}/preorder*`.** VERIFIED: `/g` is a public path prefix in `src/middleware.ts` and six sibling `/g/` journeys already exist. | E's `POST /api/preorder/{token}/selections`. |

---

## 1. The completeness rule, as this part uses it

Copied from Part 1 §6 so nobody builds against a paraphrase. **This is the only definition.**

> Let `A` be the order's `course_set` (a snapshot, always containing `main`).
> A selection row is **live** when `invalidated_at IS NULL`.
> A cover is **decided for course c** when a live selection row exists for that cover with `course = c`.
> **A cover is complete when, for every course `c` in `A`, the cover is decided for `c`.**
> A declined course is an explicit row with `choice = 'none'`. An absent row means "we have not been
> told". `choice = 'none'` is forbidden on `main`.

Three answers per course, and every surface in this part must render all three distinctly:

| Answer | Storage | Guest UI | Staff UI | Printed sheet | CSV |
|---|---|---|---|---|---|
| Chose a dish | live row, `choice = 'item'` | the dish, selected | the dish name | the dish name | the dish name |
| Declined | live row, `choice = 'none'` | "No starter, thank you", selected | an en dash with accessible name "no starter chosen" | `No starter` | `none` |
| Not answered | no live row | nothing selected | `Not answered`, warning colour | **`NOT ANSWERED`**, bold uppercase | empty |

A cover with an invalidated row (a withdrawn dish) is `blocked`, which is neither complete nor merely
partial. It renders as `Not answered` with the extra line "we had to withdraw this dish, please choose
again".

Vocabulary, from Part 1 §6, used verbatim in every API response and every screen:
`cover_state` in `dropped | blocked | unstarted | partial | complete`;
`contact_state` in `inactive | blocked | unstarted | partial | complete`;
`order_state` in `cancelled | complete | incomplete`.
A's `main_only` and `no_main` are **retired** and must not appear anywhere.

---

## 2. The creation state machine (closes F03)

### 2.1 The two rules

1. **A booking that requires a pre-order can never exist without an order row and a booker contact.**
2. **A guest can never be shown a failure for a booking that was actually created.**

Rule 1 is met by creating the order inside the same database transaction as the booking insert.
Rule 2 is met by making everything that cannot be in that transaction non-blocking and self-healing.

### 2.2 What is in the transaction

VERIFIED: the public create path calls `create_table_booking_public_v06` at
`src/app/api/table-bookings/route.ts` line 274. That function is first created by
`20260801001100_create_table_booking_v06.sql`, which has **no** period parameters, and is then replaced
by `20260803000200_seasonal_deposit_on_create.sql`, which adds `p_booking_period_id` and
`p_booking_period_answer`. Do not go looking for those parameters in the `…001100` file. They are not
there.

Rather than editing v06, v05, the staff variant and every future variant, the bootstrap is an
**AFTER INSERT trigger on `public.table_bookings`** calling the canonical function
`public.preorder_create_order(uuid, jsonb)`. A trigger is version-independent: an old AMS deployment
still serving traffic during a rollout creates a correct order without knowing the feature exists.

```
BEGIN
  INSERT INTO table_bookings ...                        -- existing v06 body
  -- AFTER INSERT trigger fires, inside the same transaction:
  --   1. get_setting_bool('preorder_module_enabled', false)      -> false? RETURN NULL
  --   2. get_setting_bool('preorder_collection_enabled', false)  -> false? RETURN NULL
  --   3. booking_period_id IS NULL
  --      OR booking_period_answer IS NOT TRUE
  --      OR booking_period_requires_preorder IS NOT TRUE          -> RETURN NULL
  --   4. period has no active 'main'                              -> RETURN NULL, raise alert
  --   5. INSERT booking_preorder_orders ... ON CONFLICT (table_booking_id) DO NOTHING
  --      snapshot course_set  := preorder_applicable_courses(period_id)
  --      snapshot cutoff_at   := least(computed, S_utc - interval '2 hours')   -- Part 1 §10.2.2
  --   6. INSERT booking_preorder_contacts (is_booker = true, name and phone from customers)
  --   7. INSERT booking_preorder_covers, ordinal 1..party_size, all on that contact
COMMIT
```

Step 3 needs **both** period conditions. A guest who answered "no, this is not a Christmas dinner" inside
a Christmas period must never get an order row, or the pub will chase them for choices they were told
they did not have to make.

Step 5's `ON CONFLICT (table_booking_id) DO NOTHING` is what makes the function idempotent, and idempotency
is what lets the repair sweep (§2.5) and the staff "add a pre-order" action reuse it with no second code
path.

### 2.3 Failure discipline inside the trigger

**A raise inside this trigger kills a booking, and a lost booking is worse than a missing pre-order.**

- Every branch that could raise for a non-invariant reason (missing settings row, unreadable period,
  archived period, customer with no phone) returns NULL instead and raises a `preorder_alerts` row.
- The **only** condition allowed to raise is a genuine invariant breach: covers not summing to party size
  after step 7, which cannot happen unless the code is wrong.
- Database tests assert a booking still commits when the settings row is missing, when the period row was
  archived between resolve and insert, and when the customer has no phone number.

### 2.4 What is deliberately outside the transaction

| Step | In transaction | If it fails |
|---|---|---|
| Booking row | yes | Nothing else happened. Guest sees a normal failure. Correct. |
| Order, booker contact, covers | yes | Same transaction, so it cannot fail alone. |
| The booker's raw token | **no** | Response carries `booker_link_state: "deferred"`. The booking is still `201`. The T0 message mints and carries a link within minutes. |
| T0 SMS and email | **no** | Durable outbox row, leased and retried (Part 1 §10.8). |
| Consent record, dietary arrays | **no** | Already best-effort in the existing route (VERIFIED, with a code comment saying so). Unchanged. |

The token is outside the transaction for one reason: the **raw** token must never be stored, only its
hash. Minting it in Node reuses the already audited generator rather than creating a second source of
randomness. VERIFIED: `src/lib/guest/tokens.ts` uses `crypto.randomBytes(32).toString('base64url')`.
This also sidesteps the UNKNOWN question of whether `pgcrypto` is installed in production.

### 2.5 A paid booking can never exist without its order: the three guards

The order is created at insert, but a booking becomes **paid** later, so three guards are needed, not one.

| Guard | Where | Behaviour |
|---|---|---|
| **G1, creation** | The AFTER INSERT trigger, §2.2 | Order exists from the first commit. |
| **G2, payment confirmation** | The deposit capture path and the payment webhook, immediately after the booking reaches `confirmed` | Calls `preorder_create_order` again (idempotent). If it still returns NULL while `booking_period_requires_preorder AND booking_period_answer` are both true, raise a `covers_mismatch` alert of severity `critical` and **do not** fail the payment. Money that has been taken is never rolled back for a missing food row. |
| **G3, repair sweep** | `/api/cron/preorder-lock`, first block of each run | Finds future-dated bookings in `('confirmed','pending_payment')` with `booking_period_requires_preorder AND booking_period_answer` and no order row. Creates the order, issues no token and queues no chase in the same pass (the scheduler picks it up on its next hourly run). Writes one `preorder_alerts` row of type `covers_mismatch` **at severity `warning`** per repair, so the gap is visible rather than silently patched. |

**Severity matters here and is easy to get wrong.** `covers_mismatch` carries `critical` **only** when
the mismatch was not repaired, which is G2's case: money has been taken and no food row exists. **A G3
repair carries `warning` and goes into the 15-minute digest.** Getting this backwards means the activation
sweep, which by design repairs every booking taken while the module was off, sends one immediate email per
booking. Part 3 §11.4 states the same rule from the alerting side.

G3 exists for one concrete reason: bookings taken while `preorder_module_enabled` was false get no order
row, and the activation sequence in Part 3 §8.4 flips that flag with bookings already in the diary. Without
G3 those bookings are invisible to every screen that exists to chase them.

The reconciliation query in Part 3 §9 must return zero rows before activation, and G3 is what makes that
achievable without hand-written SQL.

### 2.6 The order state machine

```
   no period / answered no / pre-order not required
                 |
                 v
        no order row is created at all      ->  API reports preorder.required: false

  booking created --> status = [ open ]   (order_state: incomplete -> complete)
                          |
                          | every live cover complete AND live cover count = party_size
                          v
                     status = [ complete ]
                          |
                          | party grows / dish withdrawn / staff reopens a cover
                          +-------------------> back to [ open ]

  any state --(booking cancelled or no_show)--> [ cancelled ]
                rows kept, tokens revoked, chases cancelled, guest link shows a cancellation page
  any state --(past cutoff, still incomplete, pub gives up)--> [ abandoned ]

  ORTHOGONAL, never a status value:
     locked_at        set by the cutoff cron or by a manager     -> guest read-only
     fulfilment_state open -> checked -> locked -> served, or void
```

**Three ideas, three columns, permanently apart** (Part 1 §10.2):

| Idea | Column | Values |
|---|---|---|
| Lifecycle | `status`, stored | `open`, `complete`, `cancelled`, `abandoned` |
| Locked for service | `locked_at`, stored, nullable | set or not set |
| Staff workflow | `fulfilment_state`, stored | `open`, `checked`, `locked`, `served`, `void` |
| Progress | derived at read time, **never stored** | `unstarted`, `partial`, `blocked`, `complete` |

There is no `status = 'locked'`. "No pre-order required" is not a status, it is the absence of a row.

`status` is derived from the covers by `preorder_recompute_order_status(uuid)`, called inside every
mutating transaction, and is never hand-set.

### 2.7 Fulfilment transitions, enforced server side

```
open --check--> checked --lock--> locked --service done--> served
 |                 |                 |
 |                 +---unlock--------+     (manage only, typed reason, audited)
 |
 +--lock (manager, early)--> locked
 +--booking cancelled or no_show--> void   (from open, checked or locked)

served and void are terminal.
```

| Rule | Detail |
|---|---|
| `check` | Requires `order_state = 'complete'`, **or** a typed reason of 3 to 300 characters. Refusing an incomplete sign-off outright pushes staff into pretending, so record the truth instead. Writes `checked_by`, `checked_at`, `checked_fingerprint`, `checked_note` together (canon's `bpo_signature_whole_ck` refuses half a signature). |
| `lock` | Reachable from `open` as well as `checked`. Locking does not imply signing off. |
| `unlock` | `table_bookings.manage` only, reason 3 to 200 characters, audited. Late-change flags are kept, not cleared. |
| `served` and `void` | Set by the database trigger `preorder_sync_order_on_booking_status` (ruling R3). `completed` maps to `served`; `cancelled` and `no_show` map to `void`. |
| Every transition | Writes a `booking_audit` row with `event = 'preorder_' || <transition>` and the reason and fingerprint in `meta`, plus `logAuditEvent` with **ids and counts only**. |

**Known operational gap, flagged rather than hidden.** SECTION-CLAIMED: staff do not reliably mark a
booking `completed`. An order that is never marked sits in `locked` after service. That is harmless
(the kitchen has already cooked, and `locked` already blocks the guest), but it means **`served` is not a
trustworthy "service happened" signal and nothing in this part may depend on it.** No nightly tidy-up job
in Phase 1 (`OD16`).

---

## 3. Journey J1: the booker

Phase 1. One contact per order, `is_booker = true`, owning every cover.

### 3.1 The whole journey on one line each

| # | Step | Where | Trigger |
|---|---|---|---|
| 1 | Books a seasonal table, sees "you will be asked to choose meals" | Website booking form | Existing flow, plus the `preorder` block from `GET /api/table-bookings/periods` |
| 2 | Gets a confirmation carrying the pre-order link | SMS and email (T0) | Outbox, Part 3 §2.3 |
| 3 | Opens the link, sees one card per cover | `GET /g/{token}/preorder` | Bearer token |
| 4 | Fills in some covers, saves | `POST /g/{token}/preorder/save` | `If-Match` revision |
| 5 | Comes back later, finishes the rest | Same link, reusable until expiry | `OD12` |
| 6 | Gets reminded if still incomplete | C1, C2, CUT (Part 3 §2.3) | Booker only in Phase 1 |
| 7 | At `cutoff_at`, the link goes read-only | Lock cron | Part 1 §10.2.3, hard |
| 8 | Rings the pub if something must change | Staff journey J2 | |

### 3.2 The page, section by section

`GET /g/{token}/preorder` is a React Server Component with `export const dynamic = 'force-dynamic'`,
matching the four existing `/g/` pages that already set it (SECTION-CLAIMED for the exact four; VERIFIED
that `src/app/g/[token]/table-manage/page.tsx` uses `createAdminClient()` and `checkGuestTokenThrottle`).

1. **Header.** `Your Christmas meal choices` (the snapshotted `booking_period_name`), then
   `Booking TB-2026-0142, Saturday 12 December, 7:00pm, table for 6`.
2. **Deadline line.** `Please choose by 12:00 on Saturday 5 December.` Once locked:
   `Choices are now with the kitchen. Ring us on 01753 682707 if something must change.`
3. **Progress line.** `4 of 6 people done.` Never a percentage, never a progress bar.
4. **One card per cover**, in `ordinal` order. Each card has:
   - The legend `Guest 1 of 6`, computed by `row_number()` over live covers at read time and **not**
     from `ordinal`, which has gaps after a shrink. That exact phrasing is used on the guest page, on the
     staff screens and in the accessibility criteria (Part 3 §12.4), so there is one label, not three.
   - An optional name box, labelled `Name (optional, so we can put the right plate in front of the right
     person)`, capped at 80 characters.
   - **Starter**: a radio group of the period's active starters, plus a final option
     `No starter, thank you`. Nothing selected is a valid draft.
   - **Main**: a radio group of the period's active mains. **There is no decline option.** The label says
     `Main (everyone has a main)`.
   - **Dessert**: same shape as starter.
   - **Dietary**: the ten-code checkbox list from Part 1 §10.4.1, leading the section, then the free text box
     with the exact label in Part 1 §10.4.1 ending "call us on 01753 682707 so we can talk it through
     properly", capped at 200 characters.
   - A `needs_kitchen_call` checkbox, labelled `Please ring me about this person's allergy`.
5. **One Save button** at the foot, plus a per-card `Save this person` for long parties.
6. **Footer.** `Anything else, ring The Anchor on 01753 682707.`

If legal decision **L2** says free text must not be collected through a web form, remove the note box
from item 4 and nothing else changes. No schema change, no migration, no delay (Part 1 §10.4.1).

### 3.3 Page states, exhaustive

Every one of these must render. This is the error-state matrix the review asked for.

| State | Condition | HTTP | What the guest sees |
|---|---|---|---|
| `open` | token live, `now() < cutoff_at`, `status` not `cancelled` | 200 | The editable form |
| `readonly_locked` | `locked_at IS NOT NULL` or `now() >= cutoff_at` | 200 | The same page, inputs disabled, the "with the kitchen" line, the pub number |
| `cancelled` | `orders.status = 'cancelled'` | 200 | `This booking has been cancelled. If that is wrong, ring us on 01753 682707.` No choices shown |
| `dead_link` | hash unknown, expired, or revoked | 200 | **One identical page for all three:** `This link is no longer active. Ring The Anchor on 01753 682707 and we will sort it out.` |
| `rate_limited` | throttle exceeded | 200 | `Too many attempts. Please try again in a few minutes.` |
| `module_off` | `preorder_module_enabled` or `preorder_collection_enabled` false | **404** | The standard Next.js 404. **Do not confirm the token exists.** Part 1 §12.3.1 |

**`dead_link` must not distinguish its three causes.** Unknown hash, expired and revoked render the same
body with the same status code and no timing difference beyond one indexed lookup.

### 3.4 Save semantics

`POST /g/{token}/preorder/save`, contract in §7.5.

- Each course in the order's `course_set` takes an **explicit** answer:
  `{"choice":"item","menu_item_id":…}` or `{"choice":"none"}`. A course key that is absent or `null` is
  "not answered yet", which is a saveable draft but never a complete cover.
- `main` must be `{"choice":"item", …}`. `{"choice":"none"}` on `main` is refused by the database
  constraint `bps_main_must_be_item_ck` and by the endpoint with `422 PREORDER_MAIN_REQUIRED`.
- **One course is expressed as `none` for starter and `none` for dessert.** Two courses is `none` for one
  of them. Three courses is an item for all three. Per cover, and covers in one party may differ. That is
  owner answer O4 and it falls out of per-cover rows with no special handling.
- A partial save is always accepted. Progress is not all-or-nothing.
- A complete cover may be re-saved until the order locks. That is the guest changing their mind.
- Any successful write to a selection row clears `invalidated_at` and `invalidated_reason` (Part 3 §2.11).
  **This is the only exit from `blocked` and it is not optional tidying.**
- Success is a `303` redirect to `/g/{token}/preorder?status=saved`. VERIFIED as the existing pattern at
  `src/app/g/[token]/table-manage/action/route.ts` line 43.
- The form must work with JavaScript disabled: a plain `application/x-www-form-urlencoded` post, with the
  revision in a hidden field as well as in the `If-Match` header. The header wins when both are present.

### 3.5 Concurrency, and what the guest sees (ruling R1)

Two phones on one family link is the normal case, not a rare one.

- The page loads with `order_revision`. Every save sends it as `If-Match`.
- The handler opens a transaction, takes `SELECT ... FROM booking_preorder_orders WHERE
  table_booking_id = $1 FOR UPDATE`, then compares, then writes, then bumps `revision`, then commits.
  **The comparison alone is not atomic. The row lock is what makes it correct**, and the order row is the
  single serialisation point for every write to a booking's pre-order.
- A stale revision returns `409 PREORDER_REVISION_CONFLICT` with the **current order in the body**,
  including every cover and its live selections, plus `changed_covers: [cover_id]`.
- The page then shows an inline banner on the affected cover only:
  `Somebody else chose for Rita while you were looking. They picked the nut roast, you picked the turkey.
  Which is right?` with two buttons, `Keep theirs` and `Use mine`.
- `Use mine` resubmits that one cover with the **current** revision. If a third write landed in between,
  the same banner appears again. That is correct behaviour, not a loop to be engineered away.
- **No timed auto-resolve, no silent overwrite, no discarding the user's typing.**
- Conflicts are audited with `operation_status: 'failure'` and the losing payload, so a "the kitchen got
  the wrong thing" complaint can be reconstructed.

### 3.6 What the booker is never told

- Per-edit notifications are **not** sent. A family of six would become a notification stream and burn the
  SMS budget on nothing. The booker gets `T0`, `C1`, `C2`, `CUT` and amendment notices, and nothing else
  (`OD5`). The exact channel per point is the enrolment table in Part 3 §2.10: `C1` is SMS only.
- In Phase 2 the booker sees **counts only** about other contacts, never another person's name, number,
  dish or note (`OD11`). In Phase 1 the question does not arise: the booker owns every cover.

---

## 4. Journey J2, surface S5: staff entering choices on behalf of a guest

This closes the staff half of review finding F43 and answers "can staff complete choices by phone" with
**yes**.

| Aspect | Decision |
|---|---|
| Where | One modal, two entry points: the booking detail card (S1) and the service-day Outstanding tab (S2 tab 3) |
| Permission | `table_bookings.edit`. **Not `manage`.** Taking an order over the phone is ordinary service work, and requiring a manager would mean orders do not get taken |
| Button copy, exactly | `Enter choices for this booking`. Not "Edit": the common case is first entry, not correction |
| Controls | The same three-state per-course controls the guest sees. Staff **must** be able to record "no starter" as distinct from leaving it blank |
| Free text | Same field, same 200-character cap, same L2 gate as the guest form |
| Provenance | `decided_by_kind = 'staff'` and `decided_by_user_id` on every selection row written (ruling R4). The channel ("phone", "in person", "correction") goes in the `logAuditEvent` payload |
| Effect on chasing | Saving on behalf of a guest **stops that contact's chase**, exactly as a guest submission would, because the chase keys off `cover_state`, not off "the guest used the link". Otherwise the pub texts someone it just spoke to |
| After the cutoff | Staff can still edit. Every staff edit while `locked_at IS NOT NULL` is a **late change**: it writes a `booking_audit` row and shows on every staff surface |
| At `served` or `void` | Blocked. `409 PREORDER_ORDER_CLOSED` |
| Concurrency | The same `If-Match` revision and the same `FOR UPDATE` lock as the guest path (R1). A staff member cannot silently clobber a guest mid-submit, and a guest cannot clobber a correction a manager just made on the phone |

**Finding the booking fast when a guest rings.** The Outstanding tab is searchable by phone number and by
booking reference. The phone search **must** use `generatePhoneVariants` from the existing phone library,
because a guest reads their number out in any format. That is the same helper the existing customer
search uses.

**Adding a pre-order to a booking taken without one** (`OD15`, yes in Phase 1). A staff action
that re-resolves the period and writes `booking_period_id`, `booking_period_answer` **and**
`booking_period_requires_preorder` **together in one statement**, then calls `preorder_create_order`.

Two verified traps that make the naive version silently do nothing:

1. VERIFIED: `booking_period_answer` is written only at creation, by `src/app/api/table-bookings/route.ts`
   (line 296), `src/app/api/foh/bookings/route.ts` (line 1309) and
   `src/app/(authenticated)/table-bookings/foh/hooks/useFohCreateBooking.ts` (line 569). Nothing anywhere
   updates it on an existing booking, so an UPDATE trigger alone would have nothing to fire it.
2. SECTION-CLAIMED at `src/lib/table-bookings/period-deposit.ts` line 355:
   `booking_period_requires_preorder` is set to `null` when the period was not accepted. So a staff update
   that sets only `booking_period_answer = true` leaves `requires_preorder` NULL, step 3 of §2.2 returns
   NULL, and **no order is created, silently.**

Install the AFTER UPDATE trigger anyway (it is harmless and version-independent), but the journey does not
work until that staff action exists. Do not claim otherwise.

**Note on the deposit.** Adding a seasonal pre-order to an existing booking may change what is owed. That
is the separate deposits workstream. Phase 1 rule: the staff action **records the food side and shows a
warning** (`This booking was taken on normal terms. Check the deposit with the guest.`) and changes no
money. Silent repricing of a booking already taken is the same mistake Part 3 §9 refuses in the backfill.

---

## 5. Journey J3: kitchen and front of house (closes F01, P0)

This journey did not exist in v1 at all. It is the reason the feature is worth building: a chef must be
able to cook from paper on a Saturday with no laptop.

### 5.1 Design principles

1. **The kitchen output is the deliverable, not the database row.** A build is not done when selections
   are stored. It is done when a chef can cook from paper.
2. **Extend, do not fork.** The existing A4 sheet gains an optional food block. Non-seasonal bookings must
   render byte-identically afterwards, and that is a testable claim, not a hope.
3. **Nothing on paper is ever the only record.** Every sheet carries the booking reference, the generation
   timestamp and a short fingerprint, so a chef holding an old sheet can be told it is old.
4. **Never aggregate an allergy.** Counts are for dishes. Allergies attach to a named cover and a named
   table, always.

### 5.2 What already exists, VERIFIED at AMS commit `63525547`

| Thing | Where | State |
|---|---|---|
| BOH day/week/month screen | `src/app/(authenticated)/table-bookings/boh/BohBookingsClient.tsx`, page at `boh/page.tsx` | Live. Defaults to week. FOH-only users redirected away |
| Per-booking A4 sheets, one page per booking | `src/app/api/boh/table-bookings/booking-sheets/route.ts` and `src/lib/table-booking-sheet-template.ts` | Live. Puppeteer via `generatePDFFromHTML`. VERIFIED: `runtime = 'nodejs'` and `maxDuration = 300` at module scope |
| Sheet payload type | `TableBookingSheetData` | Nine fields. **No food, no allergen fields** |
| Existing pre-order card and edit modal | `table-bookings/[id]/page.tsx` and `BookingDetailClient.tsx` | Live, wired to the retired Sunday model |
| Existing pre-order endpoint | `src/app/api/boh/table-bookings/[id]/preorder/route.ts` | VERIFIED: `GET` and `POST` return 410 `SUNDAY_PREORDERS_RETIRED`; `PATCH` still works against `table_booking_items` |
| Kitchen sheet endpoint slot | `src/app/api/boh/table-bookings/preorder-sheet/route.ts` | A stub returning 410. Nothing under `src/` calls it |
| Staff auth helper for BOH routes | `requireBohTableBookingPermission(action)` in `src/lib/foh/api-auth.ts` | VERIFIED: its parameter type is `'view' \| 'edit' \| 'manage'` **and nothing else**. It returns the **service-role client** after an explicit permission check, so new tables can stay service-role-only |
| Booking-level dietary fields | `table_bookings.dietary_requirements` and `table_bookings.allergies` | Live, rendered on the booking detail page |
| FOH iPad screen | `table-bookings/foh/`, detail modal at `foh/components/FohBookingDetailModal.tsx` | Live. The `FohBooking` type carries **no** food, allergy or dietary field. `sunday_preorder_state` exists but sits on `FohCreateBookingResponse`, not `FohBooking`. **Do not extend it** |
| Booking audit trail | `booking_audit` table, already surfaced on the booking detail page | Reuse it. Do not build a second timeline |
| The section nav | Written out **by hand** in `boh/page.tsx` (line 55), `foh/page.tsx` (line 56) and `reports/page.tsx` (line 90) | **Not a shared component.** Adding a fourth item means editing four files |
| RBAC actions for `table_bookings` | `view`, `create`, `edit`, `delete`, `manage`, `refund` | **There is no `export` action.** Print and CSV therefore gate on `view` |

**Two traps found in the code that will otherwise cost a day each.**

1. **The BOH list select ladder fails silently.** `loadBookingsRows` in
   `src/app/api/boh/table-bookings/route.ts` tries four `select` strings in turn and falls through on any
   error message containing "does not exist", "unknown column", "undefined column" or "undefined table".
   Get a new column slightly wrong in the first string and the route silently degrades to the second,
   returns 200, and the column is simply absent with nothing reporting a problem.
   **Mitigation, required:** add new columns to the **first** attempt only, and add a test asserting the
   first attempt succeeds against the real schema.
2. **`table_label` logic will drift.** `tableField` in `booking-sheets/route.ts` carries three non-obvious
   rules in about thirty lines: outside-ness is a property of the **booking** not the table, unbookable
   tables are skipped, and the sort is by `table_number` numerically then by `name` while the label shown
   is the name. Its own comment records that sorting by the label produces a different order from the BOH
   screen. **Extract it once into `src/lib/table-bookings/tableLabel.ts` and have both routes call it.** A
   table label that disagrees between the screen and the sheet puts a plate on the wrong table.

### 5.3 Who does what

| Role | Real person | Surface | Needs |
|---|---|---|---|
| Duty manager | manager on shift | S1, S2, S5, S6 | Chase what is missing, enter choices by phone, sign off, unlock |
| Kitchen | chef | S3 (paper), S2 if a screen exists | Totals to prep from, a per-cover list to plate from, allergies impossible to miss |
| Front of house | server on the iPad | S7, Phase 2 | On seating: does this table have a pre-order, is anything missing, is there an allergy |
| Owner | Peter | S2 plus the manager digest | Is every seasonal booking covered before the cutoff |

**UNKNOWN, and it changes the plan if the answer is yes:** whether the kitchen has any screen at all. A
search of the codebase found no kitchen-facing route, and the only existing kitchen signal is a fixed SMS
from a FOH button (`src/app/api/foh/food-order-alert/route.ts`, VERIFIED). **This part therefore treats
paper as the primary kitchen output.** If the owner confirms a kitchen tablet, S2 works on it unchanged
and the priority of S3 drops.

**Phase 1 FOH gap, stated plainly.** FOH-only users are blocked from every `/api/boh/*` route by
`requireBohTableBookingPermission`, so an FOH view needs its own `/api/foh/*` route, which is genuinely
separate work. In Phase 1 the server on the floor works from the **printed plating list**, which carries
the day fingerprint so a stale sheet is detectable. That is a deliberate gap with a named workaround, not
an oversight.

### 5.4 Surface S1: the pre-order card on the booking detail page

Route `/table-bookings/[id]`, component `BookingDetailClient.tsx`, both existing.

Replace the card's contents when `booking_period_id` is set **and** `booking_period_requires_preorder` is
true **and** `booking_period_answer` is true, which is exactly the condition that creates the order row.
Leave the legacy Sunday card in place for bookings that have `table_booking_items` and no period, so
historic bookings still render. Do not delete the legacy `PATCH` handler in this part.

Top to bottom:

1. **Header.** `Seasonal pre-order: <booking_period_name>`, a chip for `fulfilment_state`
   (`Open` / `Checked` / `Locked` / `Served` / `Void`), then `<complete covers> of <party size> covers
   complete`.
2. **Cutoff line.** `Guests can change until <London date and time>`, or once locked
   `Locked on <date and time> by <the cutoff | manager name>`.
3. **Cover table.** One row per cover: number, guest name, starter, main, dessert, dietary, `cover_state`
   chip. Rendering follows the three-answer table in §1 exactly.
4. **Allergy block**, only when anything is present. See §5.8.
5. **Actions**, permission-gated per §8: `Enter choices for this booking`, `Sign off`, `Lock now`,
   `Unlock`, `Print this booking`, `Copy order to clipboard`.
6. **Late-change strip**, only when the current fingerprint differs from `checked_fingerprint` or
   `printed_fingerprint`.
7. **History.** Fold pre-order events into the existing `audit_trail` list. They are already
   `booking_audit` rows, so this is a filter, not a feature.

Empty state, exactly: `No choices submitted yet. <n> covers outstanding.` plus the last chase point sent,
so a manager can see whether chasing has even started before ringing.

### 5.5 Surface S2: the service-day view

New route `/table-bookings/kitchen?date=YYYY-MM-DD`, defaulting to today in London. It adds a fourth item
`Kitchen` to the section nav, gated on `table_bookings.view` in the same shape as the existing `Reports`
item is gated on `reports.view`. **All four `navItems` arrays must be edited** (§5.2 trap). On
`foh/page.tsx` the whole array is already `undefined` for FOH-only users, which is the behaviour to keep
and is why the nav item needs no separate FOH guard. Do not refactor the nav into a shared component
inside this feature: wider blast radius, separate change.

All three tabs read **one** endpoint (§7.6) so the numbers cannot disagree between tabs.

**Tab 1, prep totals.** Headline strip:

| Metric | Definition |
|---|---|
| Seasonal bookings | Bookings on the date that have an order row, excluding `status` in `cancelled` and `no_show` |
| Covers expected | Sum of `party_size` across those bookings |
| Covers with a complete order | Count of covers where `cover_state = 'complete'` |
| Covers outstanding | Expected minus complete |
| Bookings not signed off | Bookings whose `fulfilment_state` is `open` |

Totals table, one row per menu item, grouped by course in the order starter, main, dessert:

| Column | Definition |
|---|---|
| Item | The **snapshotted** `item_name` from the selection, not the live menu row. Two spellings appear as two rows, which is correct and visible rather than silently merged |
| Firm | Covers that chose this item where `fulfilment_state` is `checked`, `locked` or `served` |
| Provisional | Covers that chose this item where `fulfilment_state` is `open` |
| Total | Firm plus provisional |

Below it, the per-course risk line the kitchen actually needs:

```
Starters:  41 chosen, 12 declined, 7 not answered
Mains:     58 chosen,  0 declined, 2 not answered
Desserts:  33 chosen, 19 declined, 8 not answered
```

"Not answered" is the number the manager chases and the number the chef must be told, because it is the
range of possible extra plates.

**Phase 1 models exactly three courses per cover: starter, main and dessert.** VERIFIED:
`booking_period_menu_items.course` also permits `side`, `drink` and `other`. Those three are **out of
scope for per-cover selection** (`OD9`). A guest cannot pick one, so none appears in the
totals, on the plating list, on the sheet or in the CSV.

**Tab 2, plating list.** One row per cover, grouped by booking, ordered by `booking_time` ascending, then
table label, then booking reference, then cover ordinal. That ordering matches the existing booking-sheets
route so the two outputs agree.

| Time | Table | Ref | Cover | Guest | Starter | Main | Dessert | Flags |
|---|---|---|---|---|---|---|---|---|

- `Guest` falls back to `<booker surname> #<ordinal>` when no cover name was given.
- `Flags` shows an allergy marker, the `dietary_codes` list and a `Ring me` badge when
  `needs_kitchen_call` is true. **It never shows the free text inline.** The free text is on the printed
  sheet and in the row expansion, so it cannot be skimmed past on paper and cannot be leaked casually on
  screen.
- Rows whose booking is `open` are tinted and carry a `Provisional` chip.
- Rows changed since the last print carry a `Changed` chip.

**Tab 3, outstanding.** The manager's chase list, soonest cutoff first: bookings whose `order_state` is
not `complete`. Columns: time, ref, guest, party size, covers outstanding, last chase sent, chase
occasions remaining, phone number, and two buttons: `Enter choices` (J2) and the existing message-guests
path (`MessageGuestsModal.tsx` already exists in the BOH folder). **This tab is the reason the feature
does not silently fail. It is where the manager escalation email lands the human.**

**Date range.** Same day, week and month shapes as the BOH screen, but **prep totals are day-only**.
Weekly prep totals across different services would be actively misleading. On week or month, tabs 1 and 2
are disabled with `Prep totals are per service day. Pick a day.`, matching how the existing Download PDF
button already behaves.

### 5.6 Surface S3: print

**S3a, the per-booking A4 sheet, extended. Do not build a new template.**

```ts
export interface TableBookingSheetPreorder {
  /** "Christmas dinner 2026", the snapshotted period name, never the live row. */
  periodName: string
  /** "Signed off by Sarah, 4 December at 3:12pm" or "Not signed off". Never a raw state value. */
  signOff: string
  /** Short fingerprint, e.g. "a3f19c". Printed so a chef can be told a sheet is stale. */
  fingerprint: string
  covers: Array<{
    /** "1. Dave" or "3.". Never blank. */
    label: string
    /** dish name, or "No starter", or "NOT ANSWERED" */
    starter: string
    /** dish name, or "NOT ANSWERED". A main is always required. */
    main: string
    /** dish name, or "No dessert", or "NOT ANSWERED" */
    dessert: string
    /** structured codes only, never free text */
    dietaryCodes: string[]
    dietaryNote: string | null
    needsKitchenCall: boolean
  }>
  /** Booking-level allergy and dietary text, from table_bookings. See 5.8. */
  bookingAllergyNote: string | null
  bookingDietaryNote: string | null
}

export interface TableBookingSheetData {
  // ... all nine existing fields unchanged ...
  preorder?: TableBookingSheetPreorder
}
```

Layout rules:

- The allergy block goes **above** the cover list, boxed, at the largest body size on the page. Anything a
  chef must not miss goes at the top, not in a footnote.
- `NOT ANSWERED` prints in bold uppercase. That is not a styling flourish, it is the difference between a
  missing plate and a wrong plate.
- One booking is still one A4 page. If covers overflow for a very large party, the block continues onto a
  second page with a repeated header `<ref>, <guest>, continued`. **Do not shrink the type.** A verified
  lesson in this repo is that contract PDF footer overlap was caused by the viewer's minimum font size, so
  shrinking type is not a safe answer.
- The compatibility claim is proved by a **snapshot test** over `generateTableBookingSheetsHTML` using the
  existing fixtures, added in the same commit as the type change. Without that test the claim is a hope.

**S3b, the prep sheet and the plating list.** New route
`GET /api/boh/table-bookings/preorder-print?date=…&doc=prep|plating|both`. Same puppeteer pipeline, same
audit shape, same `no-store` headers as booking-sheets. **Both new PDF routes must declare
`export const runtime = 'nodejs'` and `export const maxDuration = 300` at module scope.** A route that
omits `maxDuration` inherits the platform default and times out on a busy December Saturday, which is the
only day it matters.

Do **not** reuse `/api/boh/table-bookings/preorder-sheet`: it is a live 410 contract bound to the retired
Sunday flow, and although nothing in `src/` calls it, an external client might. Leave it returning 410.

- **Prep sheet**: tab 1 content, landscape A4, large type. Header carries the service date, the generation
  time and the day fingerprint.
- **Plating list**: tab 2 table, landscape A4, repeating column headers per page, page breaks never inside
  a booking.

Both footers carry:
`Generated <timestamp>. Day fingerprint <hash>. REPRINT IF THIS DOES NOT MATCH THE SCREEN.`

### 5.7 Surface S4: CSV export

`GET /api/boh/table-bookings/preorder-export?date=YYYY-MM-DD&shape=covers|totals`, `text/csv`. Follow the
server-side pattern at `src/app/api/events/export/route.ts`. VERIFIED: **there is no shared CSV builder in
`src/lib`**, and inventing one is out of scope here.

```
shape=covers:
booking_date, booking_time, booking_reference, table_label, party_size,
cover_ordinal, cover_guest_name, starter, main, dessert,
dietary_codes, dietary_note, needs_kitchen_call, cover_state, fulfilment_state, fingerprint

shape=totals:
booking_date, course, item_name, firm_covers, provisional_covers, total_covers
```

Three rules that are not negotiable:

1. **Prefix guard.** Any cell whose first character is `=`, `+`, `-` or `@` is prefixed with a single
   quote. Guest names and dietary notes are free text a guest typed, and this file is opened in Excel by
   definition.
2. **`shape=totals` carries no allergy column and no guest name.** A totals file is the one most likely to
   be emailed around and it has no operational need for either.
3. **A CSV export writes none of `printed_at`, `printed_fingerprint`, `printed_by`** (ruling R5). Nobody
   cooks from a spreadsheet, and a manager downloading a CSV at a desk must not silently tell the kitchen
   that the paper in the kitchen is current.

Audit-log both exports with `operation_type: 'export'`, the date and the row count, and **never a name**,
matching the existing booking-sheets route.

### 5.8 Dietary requirements and allergies on kitchen output

This is the part that hurts someone if it is wrong.

**The merge rule, non-negotiable.** `table_bookings.allergies` and `.dietary_requirements` already exist
and are already in use (VERIFIED, rendered on the booking detail page). Every kitchen output shows **both
levels, labelled**:

```
Allergies
  BOOKING (applies to the table): nut allergy on the table, please keep separate boards
  COVER 3, Dave: coeliac
```

Never silently concatenate. A booking-level note is a table-wide instruction; a cover-level note is one
plate. Showing only the new per-cover fields would make a real allergy typed into the existing
booking-level field disappear from the sheet the chef reads. **That is a food-safety regression introduced
by a feature.**

**Never:** in a totals row, in the manager digest, in an SMS or email body, in telemetry, in a log, in a
CSV filename, or in an `audit_logs` payload.

Field names are Part 1 §10.4.1's and only those: `dietary_codes` (ten-code closed enum), `dietary_note`
(200 characters), `needs_kitchen_call`. A's `dietary_tags` and `allergy_note` are **retired**.

Legal decision **L7** (who may read cover-level free text) is outstanding. If the answer narrows access,
the only thing that changes is the allergy row of the access matrix in §8.

### 5.9 Change detection: the fingerprint

The requirement is "how are late changes highlighted after the kitchen has already printed". A timestamp
comparison fails the obvious case where a guest changes a dish and changes it back, so use a content
fingerprint.

```
fingerprint(booking) = md5(payload)
```

`payload` is UTF-8 text, built exactly as:

1. `v1|<booking_id>|<party_size>|`
2. For each cover with `dropped_at IS NULL`, one line:
   `<ordinal>|<guest_name or empty>|<starter>|<main>|<dessert>|<dietary_note or empty>|<codes>|<call>`
   where each course field is:
   - the **menu item id** when a live row has `choice = 'item'`,
   - `-` when a live row has `choice = 'none'`,
   - `?` when there is no live row **or** the only row is invalidated,
   and `<codes>` is `dietary_codes` sorted ascending and comma-joined, and `<call>` is `1` or `0` from
   `needs_kitchen_call`.
3. Sort those lines by `ordinal` ascending, then `cover_id` ascending.
4. Append one final line:
   `BOOKING|<table_bookings.allergies normalised>|<table_bookings.dietary_requirements normalised>`
   where "normalised" means: an array is sorted ascending and comma-joined; a string is trimmed; NULL is
   the empty string.
5. Join every line with `\n`.

Notes a developer needs:

- `md5()` is a **built-in** Postgres function. This is change detection, not a security control, so md5 is
  the right choice and it removes the UNKNOWN `pgcrypto` dependency entirely.
- **Menu item ids, not names**, so a manager correcting a typo in a dish name does not fire a false
  "changed" flag across the whole day. A rename genuinely does not change what the kitchen cooks.
- Step 4 exists because the chef reads the booking-level allergy note off the same sheet. A change to it
  must trigger a reprint.
- An invalidated row reads as `?`, so a dish withdrawal changes the fingerprint. That is deliberate.
- The `v1|` prefix means a future recipe change deliberately invalidates every stored hash, which is
  correct behaviour rather than a silent mismatch.
- The **short fingerprint** printed on paper is the first six characters. Six-character collisions are
  possible and harmless: the short form is a human cross-check, the full form is what code compares.
- A **day fingerprint** is `md5` of the ordered concatenation of every booking fingerprint on the date.

**Where it is stored** (ruling R5): `checked_fingerprint` on sign-off, `printed_fingerprint` and
`printed_at` and `printed_by` on print. Three columns on the order row, no ledger tables.

**The three flags a manager sees:**

| Flag | Condition | Where |
|---|---|---|
| `Changed since sign-off` | current fingerprint differs from `checked_fingerprint`, and `fulfilment_state` is `checked` or later | S1, S2 tabs 2 and 3, BOH day list |
| `Changed since print` | current fingerprint differs from `printed_fingerprint` | S2 tabs 1 and 2, with a `Reprint` button |
| `Never printed` | `printed_at IS NULL` | S2 tab 2 |

A booking that changes after sign-off does **not** automatically leave the `checked` state. It stays
`checked` and carries the flag. Automatically un-signing would let a guest's trivial edit silently undo a
manager's decision, which is worse than showing the manager a flag. Re-signing clears the flag by writing
the new fingerprint.

**Phase 1 has no per-booking reprint.** VERIFIED: the existing booking-sheets route accepts a `date`
parameter and nothing else. A day reprint therefore clears `Changed since print` for **every** booking in
the run, so a manager cannot reprint one booking without resetting the flag on the rest. Selective reprint
is S8, Phase 2. Say this to the owner; do not let it be discovered in December.

### 5.10 Surface S6: sign-off and lock

**Who** (`OD13`): the duty manager, meaning any user with `table_bookings.manage`. Not the
kitchen. The kitchen's job is to cook what is signed off, not to decide whether the order is settled.

**When:** the morning of service, from S2. One `Sign off` button per booking, plus a `Sign off all
complete` action for the day which signs off only bookings whose `order_state` is `complete`, shows the
exact count before acting, and requires confirmation. The bulk call carries
`expected_complete_count` and returns `409 PREORDER_COUNT_CHANGED` if the current count differs, because a
bulk action against a moving target is how a manager accidentally signs off an order they never read.

**What it means, shown in the UI in one sentence:** "I have read this order, I have chased what is
missing, and the kitchen can cook from it."

**Incomplete sign-off** is allowed with a typed reason (`OD14`), stored in `checked_note` and
printed on the sheet as `Signed off incomplete: <reason>`.

**The lock cron** `/api/cron/preorder-lock`, every 15 minutes:

1. Runs the §2.5 G3 repair sweep first.
2. Finds orders in `fulfilment_state IN ('open','checked')` whose `cutoff_at` has passed and whose booking
   is not cancelled, using `bpo_due_lock_idx`.
3. Sets `fulfilment_state = 'locked'`, `locked_at = now()`, `locked_by = NULL` (meaning "by the cutoff").
4. Writes one `booking_audit` row per booking.
5. Is idempotent by construction, because the update is conditional on the current state.
6. Batch of 500 per run. Persists a result through `persistCronRunResult`.
7. Checks `preorder_module_enabled` as its first statement after `authorizeCronRequest` and returns
   `{skipped:'module_disabled'}` when false.

Schedule it in `vercel.json`. **`vercel.json` is the source of truth. Creating a route directory is not
scheduling a cron.**

### 5.11 Performance budgets

These are the four numbers from Part 1 §5.6, restated with the reason. **They must not diverge from Part 1
§5.6 or Part 3 §11.7.** Note that the API response budget and the full server render are two different
measurements of the service-day view, which is why there are two numbers and not a contradiction.

| Thing | Budget | Why |
|---|---|---|
| `preorder-day` API response | under **800 ms** at 30 bookings and 250 covers | It is the endpoint a manager refreshes while on the phone |
| Service-day view, full server render | under **2 s** at 40 bookings | The whole page, not just the endpoint |
| Guest pre-order page, first contentful paint on 4G | under **2.5 s** | Most bookers are on a phone |
| `preorder-print` for a full Christmas Saturday | under **60 s**, inside `maxDuration = 300` | The existing route already renders up to 200 pages through the same pipeline. A food block per page increases the render, so **measure before release**, do not assume the headroom holds |
| Print cap | Mirror `MAX_PRINTABLE_ROWS = 200`, return `422 PREORDER_PRINT_TOO_LARGE` above it | Same reason the existing route has one |
| CSV | 5000 rows without streaming | A single service day cannot approach this |

**Register item `U13` changes these numbers:** peak seasonal bookings and covers on the busiest December
Saturday are UNKNOWN. The figures above are ASSUMED at roughly 30 bookings and 250 covers, which is the
planning row of Part 3 §11.7. If the real figure is materially higher, the print cap and the render budget
need revisiting before build, not after.

---

## 6. Tokens and the bearer threat model (closes F10, F11)

### 6.1 The decision, per owner answer O1

**A separate table, `public.booking_preorder_tokens`. `guest_tokens.customer_id` stays `NOT NULL`.**
Share the hashing and generation library, not the storage. DDL is Part 1 §10.7 and is not repeated here.

The audit behind that decision, from the code rather than from memory:

| Fact | Status |
|---|---|
| `guest_tokens.customer_id` is `NOT NULL` and is the leading column of `idx_guest_tokens_customer_action` | SECTION-CLAIMED at `20260420000003_bookings_v05_foundations.sql` |
| 8 action types in use; the CHECK has been dropped and recreated 4 times to add values | SECTION-CLAIMED |
| 15 production modules plus 8 test files create or read `guest_tokens` | SECTION-CLAIMED |
| `createGuestToken` takes a non-optional `customerId`, and guest pages call `getCustomerFirstNameById` to build the greeting | SECTION-CLAIMED |
| `src/types/database.generated.ts` is already stale and does not contain `booking_periods` at all | SECTION-CLAIMED. Regenerating it is inherited work, not work this feature causes |

**What the separate table costs, stated plainly:** a second expiry sweep in the retention cron, a second
table in the subject-access and erasure paths, and the discipline that any future hardening of guest
tokens must be applied to both. That discipline is §6.5 and it is a checklist, not a memory.

### 6.2 Shared library, separate storage

VERIFIED in `src/lib/guest/tokens.ts`:

- `hashGuestToken(raw): string` is **already exported** (line 29). Reused unchanged. It is plain SHA-256
  rather than HMAC; that is fine for a 256-bit random token and **must not be "fixed"**.
- `generateGuestToken(): string` is **module-private** (line 25, no `export` keyword). **Exporting it is
  the only edit this feature makes to shared token code.** One line, no behaviour change.
- `createGuestToken` is untouched and is not called by this feature.

VERIFIED: `src/lib/guest/token-throttle.ts` is reused with **no change at all**. It takes a `rawToken` and
a `scope` string, keys on `scope + token hash + client IP`, persists to `rate_limits`, and never reads
`guest_tokens`. A new scope string works today.

**`guest_tokens` is not touched by Phase 1.** The party-growth top-up link (owner decision O3) proposes a
new `guest_tokens` action type. That belongs to the separate refund workstream and **must not creep into
the pre-order migration.**

### 6.3 Expiry, revocation and reuse

| Property | Rule |
|---|---|
| Expiry | `expires_at` = the booking's start time plus 24 hours |
| Reuse | **Reusable until expiry** (`OD12`). There is deliberately no `consumed_at`: a guest returns to change their mind, and single-use semantics would break the stated journey |
| Live tokens per contact | At most one, by `bpt_one_live_per_contact`. A resend revokes the old one and inserts the new one in **one transaction**, via `preorder_issue_token` |
| Lock is not revocation | `order_locked` is **not** a `revoked_reason`. After the cutoff the token still resolves and the page renders read-only. A guest who opens the link on the day should see their meal, not an error |

Revocation triggers, each in the same transaction as the event:

| Event | `revoked_reason` |
|---|---|
| A link is resent | `resend` |
| The contact's phone number is corrected | `wrong_number_corrected` |
| The contact's name or covers change materially | `contact_changed` |
| The contact is removed from the order (Phase 2) | `contact_removed` |
| The booking is cancelled or marked no-show | `booking_cancelled` |
| Staff revoke manually | `staff_revoked` |
| A GDPR erasure runs against the contact | `erasure` |

### 6.4 The threat

**The URL is the credential.** Anyone holding it can act as that contact until expiry. URLs leak through
browser history, shared screenshots, forwarded texts, referrer headers, server access logs, analytics and
error trackers.

**At risk:** one contact's covers, their guest names, their `dietary_note` free text (which review finding
F13 classifies as potentially special-category health data), and the booking's date, time, reference and
party size.

**Not at risk by design:** other contacts' data, phone numbers, the customer record, payment instruments,
and anything outside this order. **That containment is the single most valuable control here.** In Phase 1
it is trivially true, because the booker owns every cover.

**What a leaked link exposes, for the risk register:** the above, and the holder can change those choices
until the order locks. **Mitigation:** staff revoke and reissue in one click (§7.9).

### 6.5 The fifteen controls

| # | Control | Status | Detail |
|---|---|---|---|
| C1 | 256-bit entropy | **reuse** | `crypto.randomBytes(32).toString('base64url')`, VERIFIED. Not guessable |
| C2 | Hash at rest | **reuse** | SHA-256 hex, VERIFIED. A database dump yields no working links |
| C3 | No secret-dependent comparison | **build** | Lookup is one equality on the indexed hash. The raw token is never compared, so there is no place for a timing side channel. This is not a claim that the index probe is constant-time: the attacker learns only "this hash exists", which is what they already sent |
| C4 | Bind contact, order and period | **build** | The composite foreign key `bpt_contact_fk` in Part 1 §10.7. There is no `action_type` column because the table has exactly one purpose |
| C5 | Expiry | **build** | Checked on every read and every write |
| C6 | Revocation | **build** | §6.3 |
| C7 | One live token per contact | **build** | Partial unique index; revoke then issue in one transaction |
| C8 | Rate limiting | **reuse plus one new limiter** | §6.6 |
| C9 | `Cache-Control: no-store` | **build** | §6.7. This is a real trap in this codebase |
| C10 | `noindex` | **already present** | VERIFIED: `src/middleware.ts` line 85 sets `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` on every response, and `/g` is a public path prefix (line 31) |
| C11 | Referrer policy | **tighten** | VERIFIED: `next.config.mjs` line 45 sets `Referrer-Policy: strict-origin-when-cross-origin` globally, which already stops the token reaching a third-party origin. Override to `no-referrer` on `/g/[token]/preorder*` so it does not reach same-origin subresource logs either |
| C12 | Analytics exclusion | **build** | No analytics script on `/g/*`. VERIFIED: the CSP in `next.config.mjs` already restricts script origins, so this is enforced by policy as well as by omission |
| C13 | Log redaction | **build** | §6.8 |
| C14 | CSRF | **build** | §6.9 |
| C15 | Output escaping | **build** | §6.10 |

### 6.6 Rate limits

VERIFIED: `checkGuestTokenThrottle` keys on `scope + token hash + client IP`, persists to `rate_limits`,
and **fails closed in production** when that table is unreadable.

| Scope | Max | Window | Rationale |
|---|---|---|---|
| `guest_preorder_view` | 80 | 15 min | Matches the existing `guest_table_manage_view` limit. A family passing one phone around reloads a lot |
| `guest_preorder_data` | 120 | 15 min | The JSON re-read after each save, plus the page |
| `guest_preorder_save` | 30 | 15 min | Six covers times three courses plus corrections, comfortably |
| **`guest_preorder_ip`** | **200** | **15 min** | **New. Checked BEFORE the token lookup** |

**`guest_preorder_ip` is new work and it matters.** The existing throttle keys on the token hash, so it
does nothing against an attacker trying many **different** tokens from one IP. With 256-bit tokens
enumeration is not a realistic threat, but this limiter also caps the cost of a bot crawling leaked links,
and it is cheap.

**Invalid tokens must consume the limiter and must not distinguish themselves.** Unknown hash, expired and
revoked all render the identical `dead_link` page from §3.3.

### 6.7 Cache-Control, and a VERIFIED trap in this codebase

**VERIFIED defect risk.** `createApiResponse` in `src/lib/api/auth.ts` (lines 189 onward) sets, for any
GET:

```
Cache-Control: public, max-age=60, stale-while-revalidate=120
```

and only sets `no-store` for non-GET. It also emits an `ETag` for every GET, and an
`Access-Control-Allow-Origin` header. That is correct for the public periods endpoint. It is **wrong and
dangerous** for `GET /g/{token}/preorder/data`, which would then be cacheable by any intermediary for 60
seconds against a URL that is itself a credential, with a cache validator attached.

Requirements, and every one of them is testable:

- `GET /g/{token}/preorder` (HTML): `export const dynamic = 'force-dynamic'` plus an explicit
  `Cache-Control: no-store, no-cache, must-revalidate, private` and `Pragma: no-cache`.
- `GET /g/{token}/preorder/data` (JSON): **build its own `NextResponse`. Do not use `createApiResponse`.**
  Passing a header override would fix the `Cache-Control` (the helper spreads `...headers` last) but would
  **not** remove the ETag and would **not** remove the CORS header, and neither belongs on a token-scoped
  response.
- A **test** asserts the exact `Cache-Control`, the absence of `ETag` and the absence of
  `Access-Control-Allow-Origin` on both routes. Not a comment. A test.

### 6.8 Logs and telemetry

- The raw token is **never** written to a log, an audit row, an alert email, an error tracker or a metric
  label. Log the token **id** or a hash prefix.
- The audit event for a guest save records `contact_id`, `order_id`, `token_id`, the cover ids and the
  before and after menu item ids. **No phone number, no name, no free text.**
- `logger.error` on these routes must not include the request URL, because the URL contains the token.
  VERIFIED good habit to copy: the existing periods route logs `metadata: { date }` rather than the URL.
- **The stored SMS and email body substitutes `[link]`** (Part 3 §2.13), so a bearer credential never enters
  the message log or any export.
- Vercel's own request logs will contain the path and therefore the token. That is outside application
  control. Mitigation: the token expires at booking start plus 24 hours, so a log retained beyond that is
  inert. **UNKNOWN: the Vercel log retention period. Confirm it and record it in the retention schedule.**

### 6.9 CSRF

The token is in the URL path, not a cookie, so classic ambient-authority CSRF does not apply: a cross-site
attacker who does not know the token cannot forge a request. An attacker who **has** the link has full
authority anyway, so CSRF is not the interesting risk here. What is still worth having:

- `POST` only for mutations. No `GET` with side effects.
- **Origin check:** reject a POST whose `Origin` header is present and is not the AMS app origin. Present
  but wrong is a hard reject; absent is allowed, because some browsers omit it on same-origin form posts.
- `SameSite=Lax` is irrelevant here (no session cookie is used) and must not be relied on.
- VERIFIED: the global CSP already sets `form-action 'self'` and `frame-ancestors 'none'` in
  `next.config.mjs` (lines 26 and 27), which stops the page being framed and stops its form posting
  elsewhere.

### 6.10 Input handling and escaping

Guest-supplied free text: `guest_name` and `dietary_note` per cover.

- **Length caps live in the database as CHECK constraints**, not only in the UI: `guest_name` 1 to 80
  (`bpcov_guest_name_ck`), `dietary_note` up to **200** (`bpcov_note_ck`). Part 1 §10.4.1 overrules B's 500
  and F's 300. A cap in a form is a suggestion; a cap in a constraint is a limit.
- Reject control characters and normalise whitespace on input.
- React escapes on render by default. **`dangerouslySetInnerHTML` is banned on every pre-order surface**,
  including the kitchen print sheet and the manager digest email.
- **The email path is the one that actually needs work.** SECTION-CLAIMED: email HTML is assembled by
  string concatenation in this codebase, not by React. Every guest-supplied value interpolated into an
  email body goes through an `escapeHtml()` helper, with a test that a cover note of
  `<img src=x onerror=alert(1)>` arrives as text in the rendered email.
- CSV formula injection is handled by the prefix guard in §5.7.

---

## 7. API contracts

### 7.1 Ownership boundaries

```
  Website (OJ-The-Anchor.pub) --HTTPS + API key--> AMS /api/*        [withApiAuth]
  Guest browser               --bearer token-----> AMS /g/{token}/*  [booking_preorder_tokens]
  Staff browser               --Supabase session-> AMS server actions [checkUserPermission]
  Vercel Cron                 --Bearer CRON_SECRET-> AMS /api/cron/* [authorizeCronRequest]
```

All four mechanisms already exist. None of them is new work.

**Rule, absolute: AMS owns all pre-order state. The website owns no pre-order data and holds no pre-order
database access.** It may only call AMS HTTP endpoints and must never be given a service-role key for
these tables.

**Rule: the guest pre-order page is served by AMS only, at `/g/{token}/preorder`.** It is not proxied or
re-implemented on the website. The website links to it. Same shape as the six existing `/g/` journeys, and
it means the token never crosses a repo boundary.

**The authoritative source of completion is AMS.** The website never computes completion; it displays what
AMS returns. Same rule as the deposit, which the periods endpoint already documents in its own header
comment.

### 7.2 Versioning

VERIFIED: existing AMS API routes are unversioned. They are not retrofitted, because that would be a
breaking change for a live caller for no benefit. New endpoints live under `/api/preorders/v1/`.

- **Additive changes** (a new optional request field, a new response field) do not bump the version.
  Clients must ignore unknown response fields. State that in the website client.
- **Breaking changes** (removing or renaming a field, changing a type, changing what an error code means)
  require `/v2` alongside `/v1` for at least one full release cycle.

Changes to the two existing routes are strictly additive: a client that never sends the new field produces
byte-for-byte the request hash it produced before the field existed.

### 7.3 Auth and scopes

| Endpoint | Auth | Scope | Phase |
|---|---|---|---|
| `GET /api/table-bookings/periods` | API key | `read:table_bookings` (existing, unchanged) | 1 |
| `POST /api/table-bookings` | API key | `create:bookings` (existing, unchanged) | 1 |
| `GET /api/preorders/v1/orders/{orderId}` | API key or staff session | `read:table_bookings` | 1 |
| `POST /api/preorders/v1/contacts/{contactId}/link` | **staff session only** | none | 1 |
| `POST /api/preorders/v1/orders/{orderId}/contacts` | API key or staff session | `write:preorders` | 2 |
| `POST /api/preorders/v1/orders/{orderId}/covers/reassign` | API key or staff session | `write:preorders` | 2 |
| `/g/{token}/preorder*` | bearer token | none | 1 |
| `/api/boh/table-bookings/preorder*` | `requireBohTableBookingPermission` | `view`, `edit` or `manage` | 1 |
| `/api/boh/table-bookings/preorder-backfill` (dry run and commit) | `requireBohTableBookingPermission` | `manage` | 1 |
| `/settings/gdpr/preorder` (subject access search and erasure) | staff session | `table_bookings.manage` | 1 |
| `/api/foh/bookings/{id}/preorder` | `requireFohPermission('view')` | | 2 |
| `/api/cron/preorder-*` | `authorizeCronRequest` | | 1 |

**`write:preorders` is a new scope and it must not be granted early.** It authorises writing third-party
personal data, so it must not be folded into `create:bookings`. **Owner or delivery action: the website's
production API key gets `write:preorders` only when Phase 2 code ships, and never before.** Grants are
data, not code: applying an RBAC grant ahead of the code deploy has already de-kiosked the live FOH iPad
once in this project.

**That rule and the resend link have to agree, so here is the resolution.** Resending a link is a Phase 1
need (a booker mistypes a number, or loses the text), but the website must not hold `write:preorders` in
Phase 1. So **in Phase 1 the link endpoint accepts a staff session only**, and the resend is a button on
the AMS booking screen. The website's Phase 1 recovery path is "ring the pub", which is the same path
every other `/g/` journey already uses. **No Phase 1 endpoint requires a scope the website is not allowed
to have.**

**Staff permissions reuse `table_bookings`.** No new permission rows, no grant migration. Anyone who can
edit a booking can already change the party size, which is more consequential than changing a dish.

### 7.4 Error contract

Envelope, VERIFIED as the existing shape via `createApiResponse` and `createErrorResponse`:

```jsonc
{ "success": true,  "data": { } }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "…", "details": { } } }
```

Guest `/g/` routes do **not** use this envelope: they are HTML pages and form posts, and they redirect with
a `?status=` parameter, matching the existing `/g/[token]/table-manage` pattern. Their JSON sibling
`/g/{token}/preorder/data` returns the envelope but builds its own `NextResponse` (§6.7).

Codes are stable strings. Adding a code is additive; changing what a code means is breaking.

| Code | HTTP | Meaning | Client should |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 | Body or query failed schema validation | Show `details.issues` |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | `Idempotency-Key` missing on a POST | Fix the client. Never retry blind |
| `UNAUTHORIZED` | 401 | Missing or invalid API key | Alert, do not retry |
| `FORBIDDEN` | 403 | Key or user lacks the scope or permission | Alert, do not retry |
| `PREORDER_NOT_FOUND` | 404 | Order, contact or cover does not exist | "We could not find that order" |
| `IDEMPOTENCY_KEY_CONFLICT` | 409 | Same key, different payload | Fix the client. Never retry |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Same key still processing | Retry once after 2 s, then give up |
| **`PREORDER_REVISION_CONFLICT`** | **409** | **`If-Match` revision is stale. The only concurrency error (R1)** | Re-read from the body, show the per-cover diff, ask the user |
| `PREORDER_ORDER_CLOSED` | 409 | `fulfilment_state` is `served` or `void` | Show why. No retry helps |
| `PREORDER_COUNT_CHANGED` | 409 | Bulk sign-off count moved | Re-read the day and show the new count |
| `PREORDER_COVERS_MISMATCH` | 422 | Contact covers do not sum to party size (Phase 2) | Show `details.remaining` |
| `PREORDER_ITEM_UNAVAILABLE` | 422 | The item is inactive, belongs to another period, or is not on the claimed course | Re-read the menu, ask again for that cover |
| `PREORDER_MAIN_REQUIRED` | 422 | A cover was submitted with `main` declined. Owner answer O4 | Show "everyone has a main" |
| `PREORDER_ORDER_LOCKED` | 422 | Past `cutoff_at` or manually locked, and the caller is a guest | Show the pub phone number |
| `PREORDER_NOT_ENABLED` | 422 | The readiness flag is off. **Guest routes return 404 instead, per Part 1 §12.3.1** | Website hides the pre-order step |
| `PREORDER_PRINT_TOO_LARGE` | 422 | Above `MAX_PRINTABLE_ROWS` | Narrow the date |
| `RATE_LIMIT_EXCEEDED` | 429 | Per-key hourly limit | Back off, honour `Retry-After` |
| `RATE_LIMIT_UNAVAILABLE` | 503 | Rate-limit store unreadable, failing closed | Retry with backoff |
| `DATABASE_ERROR` | 500 | Unexpected database failure | Retry once, then alert |
| `INTERNAL_ERROR` | 500 | Anything else | Retry once, then alert |

**Error messages are guest-safe.** No SQL, no table names, no constraint names, no ids of other people's
records. VERIFIED good precedent: the existing create route maps an RPC assignment conflict to a `blocked`
state rather than leaking the constraint name.

**Retired codes, so nobody builds them:** A's `FINGERPRINT_STALE` (R2), A's `ITEM_NOT_IN_PERIOD` (folded
into `PREORDER_ITEM_UNAVAILABLE`), A's `MAIN_REQUIRED` and `ORDER_SERVED` (renamed above),
`INCOMPLETE_NEEDS_NOTE` (an incomplete sign-off is allowed with a reason, so this is a
`VALIDATION_ERROR` on a missing `note`).

### 7.5 Idempotency and concurrency

`Idempotency-Key` is **required** on every POST in this feature, matching the existing create route.
VERIFIED: `src/lib/api/idempotency.ts` exports `claimIdempotencyKey`, `lookupIdempotencyKey`,
`persistIdempotencyResponse`, `releaseIdempotencyClaim`, `computeIdempotencyRequestHash` and
`STALE_PROCESSING_MS = 10 minutes`. Reuse it unchanged.

The request hash includes every field that changes the outcome and nothing else:

| Endpoint | Hashed fields |
|---|---|
| `POST /api/table-bookings` | existing fields plus, only when supplied, the normalised `preorder` block |
| `POST /api/preorders/v1/orders/{orderId}/contacts` | `orderId`, the normalised contact list, `permission_confirmation.version` |
| `POST /api/preorders/v1/contacts/{contactId}/link` | `contactId`, `reason`, `revoke_existing` |
| `POST /g/{token}/preorder/save` | **not applicable** |

**Guest saves do not use `Idempotency-Key`.** A guest browser cannot be relied on to generate one. They use
`If-Match: <order_revision>` instead (R1), which is also what every staff write uses. One mechanism, two
callers.

### 7.6 The endpoint catalogue

Field types: `uuid` is a canonical lowercase UUID string, `date` is `YYYY-MM-DD`, `time` is `HH:MM:SS`,
timestamps are RFC 3339 with an offset, money is a decimal string with two places and never a float.

#### 7.6.1 `GET /api/table-bookings/periods` (existing route, additive)

Additive block inside `data.period`, present only when `requires_preorder` is true **and**
`preorder_module_enabled` and `preorder_collection_enabled` are both true. **Omitting the block when the
module is off is what makes the website ship dark by construction** (Part 1 §12.3.1).

```jsonc
{
  "preorder": {
    "cutoff_days": 7,
    "cutoff_hour_local": 12,
    "courses": [
      { "course": "starter", "may_decline": true,  "max_per_cover": 1 },
      { "course": "main",    "may_decline": false, "max_per_cover": 1 },
      { "course": "dessert", "may_decline": true,  "max_per_cover": 1 }
    ],
    "prices_are_indicative": true
  }
}
```

**Read `may_decline` carefully**, because "required" was doing two jobs in v1 and that is what caused the
confusion this field removes. **Every course in the list must be answered** before a cover is complete.
`may_decline` says whether `{"choice":"none"}` is an acceptable answer. `main` must be answered with a
dish. `starter` and `dessert` must be answered, and "no thank you" is one of the answers. That is how one,
two or three courses per cover is representable with no period-level setting.

The array is derived from the live menu by the single function `preorder_applicable_courses(uuid)`:
`main` always appears; `starter` and `dessert` appear only when the published menu has at least one active
item for that course; `side`, `drink` and `other` never appear. One function, so the website, the guest
page and the staff screens cannot disagree.

**This endpoint derives; an order snapshots.** At order creation that same function's result is frozen
into `booking_preorder_orders.course_set`. Two readers, one function, different points in time. That is
deliberate, not a contradiction.

`booking_periods.required_courses text[]` from v1 §B.3 is **withdrawn** and must not be built.

`prices_are_indicative` is a placeholder for review finding F08's unresolved charging model. **Until F08
is closed the website must not total item prices.**

#### 7.6.2 `POST /api/table-bookings` (existing route, additive)

Additive request field, optional. `null` or absent means "no pre-order information supplied".

```jsonc
{
  "preorder": {
    "mode": "booker_orders_for_all",   // PHASE 1: the only accepted value
    "contacts": [                      // PHASE 2 only; omit entirely in Phase 1
      { "is_booker": true,  "covers": 2 },
      { "is_booker": false, "covers": 4, "display_name": "Sam", "phone": "07700900123" }
    ],
    "permission_confirmation": {       // PHASE 2 only, required when any contact has a phone
      "version": "preorder-permission-v1", "confirmed": true
    }
  }
}
```

Validation, in this order, all before any write:

1. `preorder` present but the resolved period does not require a pre-order: **ignore it silently and log a
   warning. Do not 400.** The period is resolved server-side from the booking date, so a website one
   deploy behind can send a stale block and must not lose the booking over it.
2. `mode` not in the accepted set: `VALIDATION_ERROR`.
3. PHASE 2: more `contacts` entries than `party_size`: `VALIDATION_ERROR`. The cost cap, server-side.
4. PHASE 2: exactly one entry with `is_booker: true`, or `VALIDATION_ERROR`.
5. PHASE 2: `sum(covers) != party_size`: `PREORDER_COVERS_MISMATCH` with
   `details.remaining = party_size - sum(covers)` so the form can say "3 still to allocate".
6. PHASE 2: every non-booker phone normalises to E.164 via the existing `formatPhoneForStorage`. A failure
   is `VALIDATION_ERROR` naming which entry.
7. PHASE 2: a non-booker phone equal to the booker's, or duplicated within the list: `VALIDATION_ERROR`.
   Checked in the API before the database unique index fires, so the guest gets a sentence rather than a
   constraint name.
8. PHASE 2: `permission_confirmation.confirmed` is not `true` while any contact has a phone:
   `VALIDATION_ERROR`. Enforced at the boundary, not only in the UI.

Additive response fields, inside the existing `data`:

```jsonc
{
  "preorder": {
    "required": true,
    "order_id": "…uuid…",
    "status": "open",              // open | complete | cancelled | abandoned
    "order_state": "incomplete",   // derived: incomplete | complete | cancelled
    "locked": false,
    "revision": 1,
    "covers_total": 6,
    "covers_complete": 0,
    "cutoff_at": "2026-12-05T12:00:00Z",
    "booker_link": "https://management.orangejelly.co.uk/g/AbC…/preorder",
    "booker_link_state": "issued"  // issued | deferred
  }
}
```

`booker_link_state: "deferred"` means the booking and the order exist but the link could not be minted in
this request. **It is not an error and the booking is still `201`.** The link arrives by SMS and email
within minutes.

**Returning the raw link in this response is a deliberate, single exception to "a bearer credential never
travels back in a server-to-server response".** It is justified because the booker is the person on the
other end of that HTTP request and the alternative is making them wait for an SMS to finish their own
booking. **The website must not log the response body, must not send the link to analytics, and must not
persist it.** Write that requirement into the website client.

#### 7.6.3 `GET /api/preorders/v1/orders/{orderId}`

Auth: API key `read:table_bookings`, or a staff session. Two callers, one contract, **two field-level
views**.

```jsonc
{
  "order_id": "…", "table_booking_id": "…", "booking_reference": "TB-2026-1234",
  "booking_period_id": "…", "booking_date": "2026-12-12", "booking_time": "19:00:00",
  "party_size": 6, "revision": 7,
  "status": "open",                     // stored
  "order_state": "incomplete",          // derived, Part 1 §6
  "locked_at": null,
  "fulfilment_state": "open",
  "course_set": ["starter","main","dessert"],
  "cutoff_at": "2026-12-05T12:00:00Z",
  "covers_total": 6, "covers_complete": 4,
  "contacts": [
    { "contact_id": "…", "is_booker": true, "display_name": "Peter",
      "contact_state": "partial", "reachability": "ok",
      "covers": 6, "covers_complete": 4,
      "phone_masked": "•••••• 0123", "link_state": "active", "last_messaged_at": "…" }
  ]
}
```

**Field-level access is a privacy boundary, not a nicety.** The shape above is the **staff** view. The
**API-key** view omits `phone_masked`, omits `last_messaged_at`, and omits any other contact's
`display_name`. **Never return another contact's free-text notes on this endpoint under any auth model:**
they may contain allergy information, which review finding F13 reclassifies as special-category data.

Review finding F09 (what the booker may see about other people) is an open owner decision. **Until it is
closed the API-key view returns completion counts only.** That is the fail-closed default, and in Phase 1
it costs nothing because the booker owns every cover.

#### 7.6.4 `GET /g/{token}/preorder` and `GET /g/{token}/preorder/data`

Auth: bearer token in the path. No API key, no session, no cookie.

The JSON sibling exists so the page can re-read after a save without a full navigation.

```jsonc
{
  "order_revision": 7,
  "booking": { "reference": "TB-2026-1234", "date": "2026-12-12", "time": "19:00:00",
               "period_name": "Christmas at The Anchor 2026", "party_size": 6 },
  "cutoff_at": "2026-12-05T12:00:00Z",
  "page_state": "open",                 // open | readonly_locked | cancelled
  "courses": [ { "course": "starter", "may_decline": true  },
               { "course": "main",    "may_decline": false },
               { "course": "dessert", "may_decline": true  } ],
  "menu": [ { "id": "…", "course": "main", "name": "…", "description": "…",
              "price_gbp": "24.00", "allergens": "…" } ],
  "covers": [
    { "cover_id": "…", "ordinal": 1, "guest_name": "Sam",
      "cover_state": "partial",
      "dietary_codes": ["gluten_free"], "dietary_note": null, "needs_kitchen_call": false,
      "selections": [ { "course": "main",    "choice": "item", "menu_item_id": "…",
                        "item_name": "Roast turkey", "invalidated": false },
                      { "course": "starter", "choice": "none", "menu_item_id": null,
                        "item_name": null,          "invalidated": false } ] }
  ]
}
```

`courses` is the order's stored `course_set`, **not** a fresh derivation from the period. Reading the
snapshot is deliberate: a cover that has already answered three courses must not silently lose its dessert
question because the menu changed after the order was created.

`covers` contains **only the covers belonging to the contact this token is bound to**, and that is
**enforced by the query, not by the UI**: the covers filter uses the `contact_id` taken from the token
row, never from the request. The response contains no other contact's anything, no phone numbers, and no
order-wide totals that would let a guest infer the rest of the table.

`menu` lists only **active** items for the period, plus any inactive item a cover has already chosen, so a
guest's existing choice still renders with its name rather than vanishing.

#### 7.6.5 `POST /g/{token}/preorder/save`

Auth: bearer token. Concurrency: `If-Match: <order_revision>`, mirrored in a hidden form field.

```jsonc
{
  "order_revision": 7,
  "covers": [
    { "cover_id": "…", "guest_name": "Sam",
      "dietary_codes": ["gluten_free"], "dietary_note": "", "needs_kitchen_call": false,
      "selections": {
        "starter": { "choice": "none" },
        "main":    { "choice": "item", "menu_item_id": "…" },
        "dessert": { "choice": "item", "menu_item_id": "…" }
      } }
  ]
}
```

Handler order, and every step is required:

1. `guest_preorder_ip` throttle, before the token lookup.
2. Resolve the token by hash. Unknown, expired or revoked all render the identical `dead_link` page.
3. `guest_preorder_save` throttle on the token.
4. Readiness flags. False means **404**, not an error page.
5. Origin check (§6.9).
6. Open a transaction and take the order lock: `SELECT ... FROM booking_preorder_orders WHERE id = $1 FOR UPDATE`. **This is the same single row that §3.5 and Part 1 §11.3 lock by `table_booking_id`.** One row per booking is the serialisation point for every writer, guest, staff, cron or trigger; the key used to reach it is immaterial.
7. Refuse if `locked_at IS NOT NULL` or `now() >= cutoff_at` (`PREORDER_ORDER_LOCKED`,
   `?status=locked`).
8. Compare `revision`. Mismatch is `PREORDER_REVISION_CONFLICT`, `?status=conflict`.
9. Validate every cover belongs to this token's contact. A cover that does not is
   `PREORDER_NOT_FOUND`, and it is logged as a **security event** with the token id.
10. Call `preorder_save_selections(order_id, payload, expected_revision)`.
11. Bump `revision`, recompute `status`, set or clear `completed_at`, set `first_completed_at` once and
    **never move it** (the shrink order depends on it), clear `invalidated_at` on any row written.
12. `logAuditEvent` with ids and menu item ids only. Commit.
13. `303` redirect to `/g/{token}/preorder?status=saved`.

Failure redirects: `?status=conflict`, `?status=unavailable`, `?status=locked`, `?status=rate_limited`,
`?status=error`. The page maps each to a sentence and the pub phone number, matching the existing
`mapBlockedReason` and `statusMessage` helpers in `table-manage/page.tsx` (VERIFIED, lines 47 and 64).

#### 7.6.6 `POST /api/preorders/v1/contacts/{contactId}/link`

Auth: **staff session only in Phase 1**; API key `write:preorders` added in Phase 2 (§7.3).
`Idempotency-Key` required.

```jsonc
{ "reason": "resend", "revoke_existing": true, "deliver": "sms" }
// reason:  resend | wrong_number_corrected | contact_changed | staff_request
// deliver: none | sms | email | both
```

`reason` is the caller's intent and is wider than the stored `revoked_reason` CHECK. Map `staff_request`
to `staff_revoked`; the other three map to themselves.

Response returns `data.link` **only** to a staff session. To an API-key caller it returns
`{ "issued": true, "delivered": "sms" }` and no URL.

#### 7.6.7 Party size change

Not a new endpoint. The existing amendment path calls, **in the same database transaction as the
party-size update**, the canonical function pair:

```sql
SELECT public.preorder_plan_shrink(p_table_booking_id, p_new_party_size);   -- preview, writes an amendment row
SELECT public.preorder_apply_amendment(p_amendment_id, p_actor);            -- applies it
```

Plan and apply are separate calls (review finding F22 asked for a preview). **Apply re-runs the plan and
aborts if the cover set changed since the preview.** F's single `preorder_apply_party_size` is
**withdrawn** because it hides the preview.

Being in the transaction is what stops any reader observing covers that do not sum to party size.

Owner decision O3: growth is settled by a **payment link**, never an automatic further charge. The
pre-order side does not wait for payment: the new covers exist and are chased immediately. **A guest whose
payment link is unpaid must still be able to tell us what they want to eat.**

#### 7.6.8 Staff HTTP routes

All use `requireBohTableBookingPermission`, which performs the permission check **and returns the
service-role client**. VERIFIED: its parameter type is `'view' | 'edit' | 'manage'` and nothing else, so
**no route here may ask for an `export` action**. All responses set
`Cache-Control: no-store, private, must-revalidate`. All mutations write `booking_audit` and
`logAuditEvent`.

```
GET  /api/boh/table-bookings/preorder-day?date=YYYY-MM-DD
       Auth: view.  400 on an invalid calendar date: reuse the isIsoDate helper in
       booking-sheets/route.ts, which rejects 2026-02-31 rather than coercing it.
       Returns the S2 read model: date, day_fingerprint, generated_at, summary, course_summary,
       totals[], bookings[] with covers[] using the canonical vocabulary.

GET  /api/boh/table-bookings/[id]/preorder-v2
       Auth: view.  404 when the booking does not exist.
       200 with order_state "not_required", fulfilment_state null and no order_id in all three
       cases: no period, guest answered no, period does not require a pre-order.
       Named preorder-v2 because /preorder exists and its GET returns a live 410 contract.

PUT  /api/boh/table-bookings/[id]/preorder-v2/covers
       Auth: edit.  If-Match: <revision>.  Same FOR UPDATE lock as the guest path.
       Body carries the same cover shape as 7.6.5 plus "entry_channel":
       "phone" | "in_person" | "correction", which goes to the audit log, not to a column (R4).

POST /api/boh/table-bookings/[id]/preorder-v2/sign-off
       Auth: manage.  Body: { "revision": 7, "note": "required when incomplete" }
POST /api/boh/table-bookings/[id]/preorder-v2/lock          Auth: manage
POST /api/boh/table-bookings/[id]/preorder-v2/unlock        Auth: manage
       Body: { "reason": "required, 3 to 200 chars" }
POST /api/boh/table-bookings/preorder-day/sign-off
       Auth: manage.  Body: { "date": "…", "expected_complete_count": 8 }
       409 PREORDER_COUNT_CHANGED when the current count differs.

GET  /api/boh/table-bookings/preorder-print?date=…&doc=prep|plating|both
       Auth: view.  application/pdf.  404 on an empty day.  422 above the cap.
       Side effect: writes printed_at, printed_fingerprint, printed_by on every order in the run.

GET  /api/boh/table-bookings/preorder-export?date=…&shape=covers|totals
       Auth: view.  text/csv.  Side effect: NONE (R5).

GET  /api/boh/table-bookings/preorder-backfill?period=…&mode=dry_run
POST /api/boh/table-bookings/preorder-backfill
       Auth: manage.  Idempotency-Key required on the POST.
       Contract, eligibility and the fingerprint gate are Part 3 §9.3. Named under /api/boh/ rather
       than as a top-level route so it inherits requireBohTableBookingPermission like every other
       staff route in this feature. It writes NO change to any table_bookings row.

GET  /api/foh/bookings/[id]/preorder            PHASE 2
       Auth: requireFohPermission('view'), the FOH helper, not the BOH one.
       Reduced shape: order_state, cover count, has_allergy boolean, needs_kitchen_call boolean,
       covers with dish names. Phone numbers are never included.
```

`table_label` in every response must come from the **extracted** `src/lib/table-bookings/tableLabel.ts`
(§5.2 trap 2), not a second copy.

#### 7.6.9 Staff server actions

In `src/app/actions/preorders.ts`, not HTTP, for anything driven from a server component. Each one:
`checkUserPermission`, validate, mutate inside a database function, bump `revision`, `logAuditEvent`,
`revalidatePath`.

`setCoverSelection`, `setCoverDetails`, `signOffOrder`, `lockOrder`, `unlockOrder`,
`withdrawBookingPeriodMenuItem`, `addPreorderToBooking` (§4), `resendBookerLink`.
Phase 2 adds `addStaffContact` and `reassignCover`.

`withdrawBookingPeriodMenuItem` is the one that can generate a message storm (review finding F07). Its
contract: **a dry run first**, returning the count of affected covers, bookings and **distinct contacts**,
then a second call with `confirmed: true` echoing the same counts. If the counts have moved, it refuses.
Above `preorder_withdrawal_confirm_threshold` (a settings key, default 10 distinct contacts) the manager
must type the count to confirm.

---

## 8. Access matrix

Columns are the roles from §5.3. This is the **operational** matrix. It does not decide legal question L7,
and if the lawyer narrows the allergy row, this is the table that changes and nothing else.

| Data | FOH-only user | `table_bookings.view` | `.edit` | `.manage` |
|---|---|---|---|---|
| Order exists, and is complete or not | Phase 2 (S8) | Yes | Yes | Yes |
| Dish choices per cover | Phase 2 | Yes | Yes | Yes |
| Cover guest names | Phase 2 | Yes | Yes | Yes |
| `dietary_codes` | Phase 2, as a flag | Yes | Yes | Yes |
| `dietary_note` free text | Phase 2, as a flag with a tap to reveal | Yes | Yes | Yes |
| `needs_kitchen_call` | Phase 2, as a badge | Yes | Yes | Yes |
| Contact phone numbers | **No** | Yes | Yes | Yes |
| Enter or change choices | No | No | Yes | Yes |
| Sign off, lock, unlock | No | No | No | Yes |
| Print and CSV export | No | Yes | Yes | Yes |
| Resend a booker link | No | No | Yes | Yes |
| Backfill dry run and commit | No | No | No | Yes |
| Subject access search, export and erasure (Part 3 §6) | No | No | No | Yes |
| Set or clear a retention legal hold (Part 3 §5.3) | No | No | No | Yes |

Two verified constraints this table respects:

1. `requireBohTableBookingPermission` already returns 403 to FOH-only users on every `/api/boh/*` route,
   so the FOH row must be served from `/api/foh/*` or not at all.
2. **There is no `export` action for `table_bookings` in the database.** Print and export gate on `view`,
   exactly as the existing booking-sheets route does. **Do not add a new permission row for this.**

Guest access: a token holder sees only their own contact's covers, and that is enforced in the query
(§7.6.4). In Phase 1 that is the whole order, because the booker owns every cover.

---

## 9. Acceptance criteria

Written so a third-party developer can tick them off without asking a question. Every one is testable.

**AC-C, creation**

1. A booking in a period with `requires_preorder = true` and `answer = true` commits with exactly one
   order row, one booker contact and `party_size` cover rows, in one transaction.
2. A booking in the same period with `answer = false` commits with **no** order row, and the API reports
   `preorder.required: false` with no `order_id`.
3. Calling `preorder_create_order` twice for one booking produces one order, one booker contact and
   `party_size` covers.
4. A booking still commits when the `preorder_module_enabled` settings row is missing, when the period was
   archived between resolve and insert, and when the customer has no phone number. No pre-order rows are
   created and one `preorder_alerts` row is raised.
5. With `preorder_module_enabled = false`, creating a seasonal booking produces no order row and no error.
6. Turning `preorder_module_enabled` on, then running the lock cron, creates order rows for every eligible
   future-dated booking that was missed (G3), and raises one `covers_mismatch` alert per repair.
7. Confirming a deposit on a seasonal booking with no order row raises a `critical` `covers_mismatch`
   alert and **does not** fail the payment.
8. The Part 3 §9 reconciliation query returns zero rows after step 6.

**AC-T, tokens**

9. A token whose `contact_id` belongs to a different order is refused by the composite foreign key.
10. Issuing a new link revokes the previous one in the same transaction; the partial unique index proves
    at most one live token per contact.
11. An unknown hash, an expired token and a revoked token render byte-identical pages with the same status
    code.
12. After `cutoff_at` the token still resolves and the page renders read-only. `order_locked` never
    appears as a `revoked_reason`.
13. `GET /g/{token}/preorder` returns `Cache-Control: no-store, no-cache, must-revalidate, private` and
    `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet`.
14. `GET /g/{token}/preorder/data` returns `Cache-Control: no-store`, **no `ETag`** and **no
    `Access-Control-Allow-Origin`**.
15. A raw token appears in no log line, no `audit_logs` row, no `preorder_alerts.detail` and no stored
    message body. The stored body contains the literal `[link]`.
16. 201 requests from one IP with 201 different invalid tokens in 15 minutes: the 201st is rate limited
    before the token lookup.
17. A POST with an `Origin` header that is not the AMS origin is rejected.

**AC-G, the booker journey**

18. A cover that declines dessert saves a row with `choice = 'none'` and `menu_item_id IS NULL`.
19. Submitting `main: {"choice":"none"}` returns `422 PREORDER_MAIN_REQUIRED`, and the same attempt
    direct to the database is refused by `bps_main_must_be_item_ck`.
20. A cover with `starter: none`, `main: item`, `dessert: none` is `complete`. A cover with `main: item`
    and no starter row is `partial`, **not** complete.
21. Two covers in one party with different course counts both save, and both report the correct
    `cover_state`.
22. A partial save with two of six covers answered succeeds and returns `order_state: "incomplete"`.
23. Saving with a stale `If-Match` returns `409 PREORDER_REVISION_CONFLICT` with the current order in the
    body and `changed_covers` populated.
24. A cover id belonging to another contact returns `PREORDER_NOT_FOUND` and writes a security log line
    naming the token id.
25. A save after `cutoff_at` returns `PREORDER_ORDER_LOCKED` and redirects with `?status=locked`. The
    page still shows the order.
26. Re-choosing after a dish withdrawal clears `invalidated_at`, and the cover leaves `blocked`.
27. The form submits and saves with JavaScript disabled.
28. A `dietary_note` of 201 characters is refused by the database CHECK, not only by the UI.

**AC-S, staff on behalf**

29. A user with `view` but not `edit` sees no `Enter choices for this booking` button and receives 403
    from the API.
30. Every selection written by staff carries `decided_by_kind = 'staff'` and a non-null
    `decided_by_user_id`, and the audit row carries the `entry_channel`.
31. Saving on behalf of a contact cancels that contact's pending chase rows with
    `cancel_reason = 'completed'`, so no SMS goes to someone the pub just spoke to.
32. Staff entry after `locked_at` succeeds and raises the late-change flag on S1 and S2.
33. Staff entry at `served` or `void` returns `409 PREORDER_ORDER_CLOSED`.
34. Two staff sessions saving the same cover: the second gets 409 with the current order.
35. The Outstanding tab finds a booking by a phone number typed as `07700 900123`, `+447700900123` and
    `447700900123`.

**AC-F, fulfilment**

36. A booking with no period shows no seasonal card, and the legacy Sunday card renders unchanged when
    `table_booking_items` exist.
37. A seasonal booking with zero covers submitted shows `No choices submitted yet. 8 covers outstanding.`
    plus the last chase point sent.
38. A declined course renders an en dash with the accessible name "no dessert chosen"; an unanswered
    course renders `Not answered` in the warning colour. The two are never the same pixel.
39. The S1 state chip matches `fulfilment_state` exactly and never shows a derived word such as "Ready".
40. For each of the three courses on the day, `chosen + declined + not answered` equals the number of live
    cover rows. That equals `covers expected` **only because one cover row is created per head at booking
    creation**. If any shortfall exists the screen shows both numbers and names the gap, because a silent
    gap between party size and cover rows is under-catering nobody can see.
41. A dish chosen by covers across two bookings is one totals row with `total = 2`.
42. Two selections whose snapshotted `item_name` differ appear as two rows, even when they point at the
    same `menu_item_id`.
43. Tab 2 ordering is `booking_time`, table label, reference, cover ordinal, and is stable across reloads
    and identical to the printed plating list.
44. Selecting week or month disables tabs 1 and 2 with `Prep totals are per service day. Pick a day.`
45. A booking with `status` in `cancelled` or `no_show` never appears on any tab.
46. A booking inside a seasonal period whose guest answered no never appears on any tab, is never counted
    in `covers expected`, and is never chased.
47. A non-seasonal booking's A4 sheet is **byte-identical** to the pre-change output, proven by a snapshot
    test, not by inspection.
48. A booking-level allergy note and a cover-level allergy note both appear on the sheet, each labelled
    `BOOKING` and `COVER n`.
49. `NOT ANSWERED` prints in bold uppercase for every unanswered course.
50. Every sheet footer carries the generation timestamp and a six-character fingerprint.
51. Printing the day sets `printed_at`, `printed_fingerprint` and `printed_by` on every order in the run,
    and clears `Changed since print` for **all** of them.
52. A CSV export at either shape changes **no** flag and writes **none** of the three print columns.
53. A guest name starting with `=` is exported prefixed with a single quote.
54. `shape=totals` contains no allergy column and no guest name.
55. The audit row for an export contains the date and the row count and no personal data.
56. The fingerprint is stable across reordered input, changes on a dish change, **returns to its original
    value when the change is reverted**, is unaffected by a menu item rename, and changes when the
    booking-level allergy note changes.
57. Signing off an incomplete order without a note is refused, naming the incomplete covers. With a note it
    succeeds and prints `Signed off incomplete: <reason>` on the sheet.
58. After sign-off, changing any cover shows `Changed since sign-off` within one page load and the chip
    still reads `Checked`.
59. The lock cron moves an order to `locked` on the first run after `cutoff_at`; running it twice produces
    one state change and one audit row.
60. An unlock requires a reason of 3 to 200 characters and writes an audit row; late-change flags survive.
61. A cancelled booking's order reaches `fulfilment_state = 'void'` and `status = 'cancelled'` **by the
    trigger**, and can no longer be signed off or locked.
62. An FOH-only user receives 403 from every `/api/boh/table-bookings/preorder*` route.
63. A `view`-only user receives 403 from sign-off and 200 from print.
64. `lock_at` and `cutoff_at` are correct across a British Summer Time boundary and at
    `preorder_cutoff_days = 0`. **The suite runs under `TZ=UTC` as well as `TZ=Europe/London`**, because a
    London laptop hides exactly this class of bug and it has bitten this repo before.
65. With `preorder_module_enabled = false`: the kitchen route 404s, the nav item is hidden, S1's card is
    hidden, the print and CSV routes 404, and the guest page 404s without confirming the token exists.

**AC-M, manual, before release, not optional**

66. **Print a real Christmas Saturday on real A4 and hand it to the chef.** Every layout problem in this
    class of feature is found on paper, not on screen. A named kitchen representative signs that the
    output is usable. **This is the F01 acceptance gate and it is not a developer sign-off.**

---

## 10. What Part 2 leaves open

Nothing is listed twice. Every item below resolves in the consolidated register at the end of the
document.

| Reference | What it decides for Part 2 |
|---|---|
| `OB1` | The phase cut line. Phase 1 surfaces are S1 to S6; S7 to S9 wait |
| `OB2` | The website one-course conflict (Part 1 §6.4). It decides whether the guest form's "no starter" option is even coherent with published copy. **AMS Phase 1 proceeds meanwhile** |
| `OB4` | Finding F08, the charging model. Until it is answered `prices_are_indicative` stays true and **the website must not total item prices** (§7.6.1) |
| `OD2` | Hard cutoff for the guest (§3.3) |
| `OD9` | Sides, drinks and "other" excluded from per-cover selection (§5.5) |
| `OD12` | A guest link is reusable until expiry (§6.3). Note this differs from the existing single-use feedback token |
| `OD13`, `OD14` | Who signs off, and whether an incomplete sign-off is allowed with a typed reason (§5.10) |
| `OD15` | Staff may add a pre-order to a booking taken without one (§4) |
| `OD20` | No separate "who may edit food choices" permission: reuse `table_bookings.edit` (§7.3) |
| `L2` | Whether `dietary_note` free text is collected through a web form. If not, the note box comes out of §3.2 item 4 and **nothing else changes** |
| `L7` | Who may read cover-level allergy free text. **Only the allergy row of §8 changes** |
| `F09` | What the booker may see about other contacts. Phase 2 only; §7.6.3 fails closed to counts until it is answered |
| `U10` | The website production API key's current scope. It **must not** hold `write:preorders` before Phase 2 ships |
| `U13`, `U14` | Peak covers on the busiest Saturday, and whether the kitchen has a screen. They set the print cap and the priority of S2 against S3 |
| `U20` | Vercel request-log retention, which bounds the token-in-URL exposure (§6.8) |

One fact this part asserts as ASSUMED rather than measured: puppeteer headroom with a food block on every
page. **Measure it against a worst-case day before release** (§5.11).


---

## Part 3: chase, privacy, retention, refunds, delivery and testing

Verification labels are the ones defined in Part 1 §1.2. Phase tags are on every table, cron, endpoint and
rule. **Phase 1 is booker-only.** Every rule that exists only because a third party submits choices is in
the Phase 2 appendix (§13), marked as such.

### 1. What is in this part, and the three things to read first

1. **§2 to §3, the chase ladder and the outbox.** Booker only. One outbox, one lease, one reconciler.
2. **§5, the retention schedule.** Every canonical table has a named rule. No table is absent.
3. **§7 to §8, activation and backfill.** Nothing ships hot: the master switch is false at deploy.

The refund workstream (§6) is **not** Christmas work. It is in this file so it is specified once, not
because it blocks the season. §6.1 states plainly which committed decision record is now stale.

---

## 2. The booker chase ladder, Phase 1

### 2.1 Scope

One contact per order, `is_booker = true`. No number belonging to anyone but the booker is stored, and no
message goes to anyone but the booker and the manager. Everything in §2 and §3 is Phase 1 work: the
machinery that stops the feature losing messages is not made simpler by having one contact instead of
five.

E's outbox mechanics, leases, reconciliation, retry schedule, provider mapping and DST reasoning are
adopted. Ten corrections to E are in Part 3 §2 and are applied throughout this part without further
comment, except where a developer would otherwise copy the wrong thing.

### 2.2 The anchor, computed in one place

```
S_local := booking_date || ' ' || booking_time          -- a London wall-clock string
S_utc   := the instant that wall clock names in Europe/London
```

**VERIFIED:** `table_bookings.booking_date` is `date` and `booking_time` is `time without time zone`
(SECTION-CLAIMED at `20260420000011_table_booking_runtime.sql:5-6`; there is no stored UTC start instant).
**VERIFIED:** `src/lib/dateUtils.ts` exists and is the project's London-aware date module.

In SQL, inside the scheduling function and nowhere else:

```sql
-- timezone(tz, naive_timestamp) reads the naive value AS London wall clock and returns timestamptz.
s_utc := timezone('Europe/London', (b.booking_date + b.booking_time));
```

**Never compute `S_utc` in application code and pass it in.** One anchor, derived once.

Any implementation that stores a fixed UTC hour, or adds `interval '7 days'` to a `timestamptz`, gets the
DST cases in §2.9 wrong. Subtract days from the `date`, then convert.

### 2.3 The five instants

`SEND_HOUR_LOCAL = 10`. The cutoff hour is `booking_periods.preorder_cutoff_hour_local`, the canonical default of 12.

| Point | `chase_point` | `message_class` | Instant | Channels |
|---|---|---|---|---|
| Invitation | `T0` | `chase` | The moment the contact row commits, clamped forward out of quiet hours (§2.6) | SMS and email |
| First chase | `C1` | `chase` | 10:00 London on `anchor_date - chase_offsets_days[1]` | SMS |
| Second chase | `C2` | `chase` | 10:00 London on `anchor_date - chase_offsets_days[2]` | SMS and email |
| Final chase | `CUT` | `chase` | 10:00 London on the cutoff date | SMS and email |
| **Cutoff** | n/a | n/a | **`booking_preorder_orders.cutoff_at`, 12:00 London** | The guest link goes read-only |
| Escalation | `ESC` | `escalation` | `cutoff_at + 5 minutes`, clamped to `S_utc - 30 minutes` | Email to `MANAGER_EMAIL` only |

`anchor_date` is `booking_date` when `chase_anchor = 'booking'`, and the cutoff date when
`chase_anchor = 'cutoff'`.

**`ESC` is not a chase.** It consumes no contact's budget, it is one row per booking not per contact, and
it carries `contact_id IS NULL`.

**VERIFIED:** `MANAGER_EMAIL=manager@the-anchor.pub` exists at `.env.example:144`, and
`PRIVATE_BOOKINGS_MANAGER_EMAIL` at `:50` is a separate address for a different feature. Read
`MANAGER_EMAIL`. Do not hardcode the address and do not reuse the private-bookings one.

**Why 10:00 and 12:00.** SMS quiet hours are 21:00 to 09:00 London (SECTION-CLAIMED,
`src/lib/sms/quiet-hours.ts:3-4`), so 10:00 leaves an hour of margin for a slow queue. UK DST transitions
happen at 01:00 and 02:00 local, so a 10:00 or 12:00 wall clock is never ambiguous and never non-existent.

### 2.4 Configuration, not constants

```sql
ALTER TABLE public.booking_periods
  ADD COLUMN chase_offsets_days integer[] NOT NULL DEFAULT '{7,4}',
  ADD COLUMN chase_anchor text NOT NULL DEFAULT 'booking'
    CHECK (chase_anchor IN ('booking','cutoff'));

ALTER TABLE public.booking_periods
  ADD CONSTRAINT booking_periods_chase_offsets_ck CHECK (
    array_length(chase_offsets_days, 1) BETWEEN 0 AND 2
    AND NOT EXISTS (SELECT 1 FROM unnest(chase_offsets_days) v WHERE v < 0 OR v > 120));
```

**The column defaults stay `'booking'` and `{7,4}`, and the Christmas 2026 period row is set to
`chase_anchor = 'cutoff'`, `chase_offsets_days = '{7,3}'` in M3.** This is an assembly decision, stated
because Part 3 §2.3 gives the DDL defaults and `OD3` gives the canonical default for the season,
and a developer reading both would not know which to write. Reason: the column default must be the safe
one for a period nobody has configured, and the Christmas row is a deliberate seed.

**Why it matters (trap T1, SECTION-CLAIMED and real).** `preorder_cutoff_days` defaults to 7. With
`chase_anchor = 'booking'` and offsets `{7,4}`, the "7 days before" point **is** the cutoff and the
"4 days before" point falls after it, so the four-rung ladder collapses to two rungs. With
`chase_anchor = 'cutoff'` and `{7,3}` on a 7-day cutoff, the ladder is:

| Point | Days before service | Worked example, booking Fri 2026-12-11 19:00 |
|---|---|---|
| `C1` | 14 | 2026-11-27 10:00 London = `2026-11-27T10:00Z` |
| `C2` | 10 | 2026-12-01 10:00 London = `2026-12-01T10:00Z` |
| `CUT` | 7 | 2026-12-04 10:00 London = `2026-12-04T10:00Z` |
| **cutoff_at** | 7 | **2026-12-04 12:00 London = `2026-12-04T12:00Z`** |
| `ESC` | 7 | 2026-12-04 12:05 London = `2026-12-04T12:05Z` |

The clamp `least(cutoff_at, S_utc - interval '2 hours')` does not bite here:
`S_utc - 2h = 2026-12-11T17:00Z` is later. The Christmas window (10 November to 20 December 2026) is
entirely GMT, so London equals UTC throughout it.

Acceptance criterion: **a test asserts exactly four occasions on the Christmas 2026 configuration, and
exactly two on the column defaults.** The second test exists to make the T1 collapse visible in CI rather
than in December.

### 2.5 Elimination rules, in order

Steps 1 to 4 run at schedule time. Step 5 runs at schedule time **and again at claim time**.

| # | Rule | `cancel_reason` |
|---|---|---|
| 1 | Compute `C1`, `C2` and `CUT` as instants | n/a |
| 2 | Drop any candidate whose instant is `>= cutoff_at`, except `CUT` itself | `after_cutoff` |
| 3 | De-duplicate by instant. Rank `CUT > C2 > C1`, keep the highest | `duplicate_instant` |
| 4 | Drop any survivor whose instant is `<= now()` at schedule time. **Past points are never back-filled and never invented** | `skipped_past` |
| 5 | Cancel any SMS point whose instant, in London local time, is before 09:00 or at or after 21:00. Email rows are exempt: there is no quiet-hours gate on email | `quiet_window` |
| 6 | Cancel any point that would be the contact's fifth occasion | `skipped_cap` |

**Eliminated points are still written down.** A dropped candidate is inserted with `status = 'cancelled'`
and its reason, never silently skipped. The row set is the ledger, so staff can see the point existed and
why it did not fire. This is why the unique indexes are scoped to live rows: a cancelled row must never
block a later legitimate re-arm.

Rules fire in order and a row carries **one** reason, the first that matched. A candidate that is both
after the cutoff and in the past records `after_cutoff`.

### 2.6 Quiet hours belong to the outbox, never to `sendSMS`

This is the single most consequential implementation rule in §2, and it is derived from three verified
behaviours of the existing library:

| Fact | Status | Consequence |
|---|---|---|
| `sendSMS`'s quiet-hours deferral uses Twilio scheduling only when `TWILIO_MESSAGING_SERVICE_SID` is set and the delay is at least 15 minutes; otherwise it enqueues a job that **requires a resolved `customerId`** | SECTION-CLAIMED, `src/lib/twilio.ts:281-283, 440-466` | With no customer id the send **fails outright** with `{success:false, error:'Failed to schedule message for delivery'}` and **no `code`** |
| When the job-queue deferral succeeds, `sendSMS` returns `{success:true, sid:null, status:'scheduled', deferred:true}` and **releases** its idempotency claim | SECTION-CLAIMED, `src/lib/twilio.ts:508-522` | A deferred send has no provider id and no dedup protection at the moment it returns |
| Quiet hours are 21:00 to 09:00 Europe/London | SECTION-CLAIMED, `src/lib/sms/quiet-hours.ts:3-4` | |

**Rule: no SMS outbox row may ever have a `due_at` inside 21:00 to 09:00 London.**

| Point | Behaviour |
|---|---|
| `T0` SMS | `due_at := now()` when London local time is 09:00 to 20:59, otherwise the **next 09:05 London**. 09:05 rather than 09:00 so a few seconds of clock skew cannot land the worker inside the window the library reads. |
| `T0` email | `due_at := now()`, any hour. Email has no quiet-hours gate. |
| `C1`, `C2` | 10:00. Always inside the window, no clamp needed. |
| `CUT` | 10:00 unless the `S_utc - 2h` clamp bites. If the clamped instant falls outside 09:00 to 20:59, **cancel** with `quiet_window`. Do not defer: `CUT` has a hard deadline and a late `CUT` is worthless. `ESC` still fires. |
| `notice` rows | Clamped forward like `T0`, never cancelled. A withdrawn dish must be told. |
| `ESC`, `ALERT` | Email. No gate. |

At claim time, an SMS row whose current London hour is outside the window is returned to `pending` with
`next_attempt_at` at the next 09:05 London if it is `T0` or a `notice`, and cancelled with `quiet_window`
if it is `C1`, `C2` or `CUT`. **Neither consumes an attempt.**

If a `deferred: true` result is ever observed, it is a defect. §3.6 says what to do with it.

### 2.7 Booked at or after the cutoff

> When `now() >= cutoff_at` at the moment the contact is created, the contact receives the `T0`
> invitation immediately (quiet-hours clamped) and **no** scheduled chase point at all. In the same
> transaction a booking-level `ESC` row is queued at
> `escalate_at := greatest(now(), least(now() + interval '2 hours', S_utc - interval '30 minutes'))`.
> The `ESC` row is cancelled at claim time if the order has since become complete.

The two-hour grace stops a booker who fills the form in straight away generating a phone call to their own
table. The `S_utc - 30 minutes` clamp means a booking made 40 minutes before service still produces a
manager alert while there is time to act on it.

### 2.8 Reschedules

Any change to `booking_date`, `booking_time` or party size triggers a full recompute **in the same
transaction as the change**, holding the order-row lock from Part 1 §11.3.

| Existing row status | On recompute |
|---|---|
| `accepted`, `delivered`, `failed`, `dead_letter` | Untouched. History. Still counts against the cap. |
| `sending` | Untouched. The reconciler owns it. Record `recompute_pending` and re-run the scheduler after the row settles. |
| `pending`, new instant in the future | `due_at` updated **in place**. Same row, same idempotency key, no occasion consumed. |
| `pending`, new instant in the past | Cancelled, `skipped_past`. |
| `cancelled` | Left alone. A replacement row for the same point may now be created, because the unique indexes cover live rows only. |
| A point that did not exist, or exists only as a `cancelled` row, and is now in the future | Created, **only if** `occasions_consumed < 4`. Otherwise created as `cancelled` with `skipped_cap`, so the decision is visible. |

O2 is settled, so a recompute can never change `booking_period_id`, and therefore never changes
`preorder_cutoff_days` or `chase_offsets_days` mid-flight. Any code path that would change
`booking_period_id` on a booking with an order must raise, not recompute. Part 1 §11.4's date guard and the
`ON UPDATE RESTRICT` composite key enforce that twice over.

### 2.9 The DST truth table

Every instant below is SECTION-CLAIMED: E computed them by running `fromZonedTime(value, 'Europe/London')`
from `date-fns-tz`, the library the project already uses. **The developer must reproduce the whole table
by feeding the London wall-clock column through that one function, as a test.** BST ran from
**2026-03-29 01:00 UTC** to **2026-10-25 01:00 UTC**.

Cases F and G use `chase_anchor = 'booking'` with `{7,4}`, because that configuration is what puts a chase
on a transition day.

| Case | Booking local start | `cutoff_days` | Point | London wall clock | Instant (UTC) | Note |
|---|---|---|---|---|---|---|
| F | Thu 2026-04-02 19:00 | 3 | C1 | 2026-03-26 10:00 | `2026-03-26T10:00Z` | GMT, offset +0 |
| F | | | C2 | 2026-03-29 10:00 | `2026-03-29T09:00Z` | **DST day.** Clocks forward at 01:00 UTC |
| F | | | CUT | 2026-03-30 10:00 | `2026-03-30T09:00Z` | BST, offset +1 |
| F | | | cutoff_at | 2026-03-30 12:00 | `2026-03-30T11:00Z` | |
| F | | | ESC | 2026-03-30 12:05 | `2026-03-30T11:05Z` | |
| G | Wed 2026-10-28 13:00 | 3 | C1 | 2026-10-21 10:00 | `2026-10-21T09:00Z` | BST |
| G | | | C2 | 2026-10-24 10:00 | `2026-10-24T09:00Z` | BST |
| G | | | CUT | 2026-10-25 10:00 | `2026-10-25T10:00Z` | **DST day.** Clocks back at 01:00 UTC, 10:00 is after that |
| G | | | cutoff_at | 2026-10-25 12:00 | `2026-10-25T12:00Z` | |
| G | | | ESC | 2026-10-25 12:05 | `2026-10-25T12:05Z` | |

**The London hour never moves. The UTC instant shifts by an hour across the transition.** Case F goes
10:00Z then 09:00Z; case G goes 09:00Z then 10:00Z. That is the whole test.

Three further cases, on the Christmas configuration (`chase_anchor='cutoff'`, `{7,3}`, cutoff 7 days):

| Case | Situation | Outcome |
|---|---|---|
| H | Contact created 2026-12-09 14:20Z for a booking on 2026-12-11 19:00, cutoff already past | `T0` sends immediately. `C1`, `C2`, `CUT` all written `cancelled` with `skipped_past`. `ESC` at `2026-12-09T16:20Z`. §2.7 |
| I | Case A booking moved from 2026-12-11 to 2026-12-18 at 2026-12-09 16:00Z | Old `ESC` cancelled with `rescheduled`. New `CUT` at 2026-12-11 10:00 London. Still under the cap because only `T0` was consumed |
| J | Booking moved from 2026-12-11 to 2026-12-16 at 2026-12-14 11:00Z, after the old cutoff | Old sent rows are history. New `CUT` is `skipped_past`. §2.7 applies to the recomputed schedule: `ESC` at `now + 2h` = `2026-12-14T13:00Z`, clamped by `S_utc - 30m` |

### 2.10 The cap: four occasions, not four transmissions

> **Four means four chase occasions per contact.** The occasions are `T0`, `C1`, `C2` and `CUT`. A contact
> is never scheduled for a fifth. Within one occasion a contact receives at most one transmission per
> channel it is enrolled on. Retries of a failed transmission do not consume an occasion. `ESC` is a
> manager alert and sits outside the cap. `notice` rows sit outside the cap.

`occasions_consumed` counts **distinct** `chase_point` values in terminal sent states (`accepted`,
`delivered`, `failed`, `dead_letter`), excluding `ESC`. A `cancelled` row costs nothing, so a re-armed
point after a cancelled one never charges a contact twice. This is surfaced on
`v_booking_preorder_contact_status` (Part 1 §10.12).

Channel enrolment, Phase 1:

| Point | Booker SMS | Booker email | Manager |
|---|---|---|---|
| `T0` | Yes | Yes, with the status summary | No |
| `C1` | Yes | **No** | No |
| `C2` | Yes | Yes, naming how many covers are outstanding | No |
| `CUT` | Yes | Yes, naming how many covers are outstanding | No |
| `ESC` | No | No | Yes |

**A booker who does nothing therefore receives seven items across four occasions:** four SMS and three
emails. That is the honest number and it is `OD4`. Under the Christmas configuration
with a full ladder, that is the real figure; under the column defaults it is two occasions and four items.

**An amendment does not restore the budget.** A contact who has already had four messages does not get
four more because the booker changed the party size. They get exactly one notice.

**Consequence of the canonical completeness rule, stated because E was written against a different one.**
Under Part 1 §6, a cover is complete only when every course in `course_set` has a live selection row.
A booker who picks mains for everyone and never answers about starters stays `partial` and stays in the
chase queue to the cutoff. More contacts stay incomplete for longer, so more chase rows are produced. The
four-occasion cap is what bounds that, and it is now doing real work rather than being decorative.

### 2.11 Withdrawn menu items: F07 now has an owner

**Owner: the messaging component.** B handed this to the chase section and the chase section never
mentioned withdrawal. It is specified here.

The database hook is `preorder_invalidate_selections_for_item(uuid, text, jsonb)`, which has a preview
mode. The messaging half:

| Question | Answer |
|---|---|
| Who approves a mass re-chase? | The manager doing the withdrawal, in the same screen. The preview returns affected orders, covers and **distinct contacts** before anything is written |
| Above what size is explicit confirmation required? | `preorder_withdrawal_confirm_threshold`, a new settings key, **default 10 distinct contacts**. Above it, the manager types the count to confirm. It is a judgement about text messages, not a technical limit, so it is a setting |
| What goes out? | **One `notice` row per affected contact**, `notice_kind = 'item_withdrawn'`, SMS plus email for the booker. Not a chase |
| Does it consume the cap? | **No.** Rate limited to one notice per contact per hour, so withdrawing three dishes at once sends one message |
| When? | Due immediately, **clamped forward** out of quiet hours, never cancelled with `quiet_window` |
| After the cutoff? | No guest notice. One `menu_item_withdrawn` alert, severity `warning`, and the manager rings. The kitchen list has already been produced |
| Cover state | `completed_at` is cleared. `first_completed_at` is **not** touched, so a prompt replier is not punished in a later shrink because the pub took their dish away |
| Exit from `blocked` | Any successful write to a selection row sets `invalidated_at = NULL, invalidated_reason = NULL`, whoever the actor is. Without this the cover is permanently `blocked`, permanently short of complete, and permanently in the chase queue with nothing the guest can do. This is not optional tidying |

Withdrawal takes order locks in **ascending `order_id` order**, which is what stops two concurrent
withdrawals deadlocking.

### 2.12 Amendment notices

All of this happens inside the party-size change transaction, holding the order lock, and bumps
`booking_preorder_orders.revision`.

| Step | Action |
|---|---|
| 1 | New covers are created against the booker's contact |
| 2 | `revision` increments. Affected covers have `completed_at` cleared; `first_completed_at` is untouched |
| 3 | `contact_state` recomputes per Part 1 §6 to `partial` or `unstarted`. **There is no `pending` status** |
| 4 | Every `pending` outbox row for that contact whose `order_revision` is behind is **rebuilt in place**: same row, same `due_at`, new `order_revision`, fresh body. Not cancelled and reinserted |
| 5 | **One** notice is queued, `message_class = 'notice'`, `notice_kind = 'amendment'`, due immediately, quiet-hours clamped |
| 6 | The ladder is re-armed only for points still in the future and not yet consumed: `remaining = {C1,C2,CUT} minus consumed minus past`. If empty, no further chase |
| 7 | A `preorder_alerts` row is raised if the change happened after the cutoff |

Growth after the cutoff: no chase re-arm at all, one amendment notice to the booker, and an immediate
manager escalation, because the kitchen list has already gone out. Growth after `S_utc`: no pre-order
messaging of any kind, manager escalation only.

Shrink: if the contact becomes complete, cancel every `pending` row with `completed`. If it remains
incomplete, leave the schedule alone and rebuild stale-revision rows in place. If a cover with submitted
selections is dropped, one notice naming **how many** covers were dropped, never which dish or which
person.

### 2.13 Message content rules

| Rule | Reason |
|---|---|
| **No dietary content in any message body, ever** | Bodies live in the outbox for 60 days and possibly in Twilio for longer (U2) |
| **No other guest's name or number in a message to the booker** | §4.4 access matrix |
| The token appears once, in the link. The **stored** body substitutes `[link]` | Keeps a bearer credential out of the message log and out of every export |
| Every SMS names the pub, the booker's first name, the booking date and why we are texting | Nobody receives an unexplained text |
| "Reply STOP to opt out" from Phase 2 onward | Makes the opt-out path discoverable. Not needed in Phase 1, where the only recipient is a customer already covered by the existing opt-out machinery |
| The serious-allergy line (§4.3) appears in the `T0` email and the confirmation, not in a chase SMS | Segment cost |

**Count the sent message, not the template.** The link is composed at send time, so the segment check
belongs in the compose step with a representative link substituted, using `countSmsSegments` from
`src/lib/sms/gsm7.ts`. **VERIFIED:** that module exports `countSmsSegments`, `isGsm7`,
`GSM7_SINGLE_SEGMENT_LIMIT = 160`, `GSM7_MULTIPART_SEGMENT_LIMIT = 153`, `UCS2_SINGLE_SEGMENT_LIMIT = 70`.
Never use `.length` and never hardcode 160. One curly apostrophe switches the encoding to UCS-2, drops the
limit to 70 and roughly doubles the cost.

Draft `T0` SMS, for owner approval:

> The Anchor: your Christmas table on Fri 12 Dec is booked. We need everyone's food choices by Fri 4 Dec
> so the kitchen can order. Choose here: [link]. Questions? 01753 682707.

**VERIFIED:** the pub's number 01753 682707 appears in AMS at `src/lib/table-bookings/periods.ts` (inside
`PERIOD_UNAVAILABLE_MESSAGES.menu_not_ready`) and in many website files, as a repeated string literal
rather than one shared constant. Introduce one exported constant, use it for the new journey, and leave
the existing literals alone. Replacing them all is a separate commit.

---

## 3. The durable outbox

One table, `booking_preorder_outbox` (Part 1 §10.8), for chases, notices, manager escalations and alert
digests. Two outboxes would mean two lease mechanisms, two reconcilers, two retention rules and two ways
to lose a message.

### 3.1 The state machine

| From | To | Trigger | Guard |
|---|---|---|---|
| (none) | `pending` | Scheduler inserts | Business key not already live |
| `pending` | `sending` | Worker claims | `due_at <= now()` and `coalesce(next_attempt_at, due_at) <= now()` and §3.2's gates pass |
| `pending` | `cancelled` | Contact complete, booking cancelled, opted out, unreachable, quiet window, kill switch, reschedule to the past, no permission, suppressed | Re-checked at claim time, not only at schedule time |
| `sending` | `accepted` | Provider accepted | `provider_message_id` recorded **where the provider gives one** |
| `sending` | `accepted`, `delivery_unknown = true` | `sendSMS` returned `{success:true, suppressed:true, suppressionReason:'duplicate'}` | Our own 14-day dedup claimed the `stage`. The expected outcome of a crash replay. Log at warn |
| `sending` | `accepted`, `delivery_unknown = true` | `sendSMS` returned `{success:true, deferred:true}` | Should be unreachable (§2.6). Record it **and raise an engineering alert**: a quiet-hours clamp was missed |
| `sending` | `pending` | Transient failure, attempts remain | `attempt_count < max_attempts`, `next_attempt_at` from §3.4 |
| `sending` | `pending` | Quiet-window re-check failed at claim on `T0` or a `notice` | `next_attempt_at` = next 09:05 London. **Attempt not consumed** |
| `pending` | `cancelled` | `due_at < now() - interval '2 hours'` at claim time | `skipped_past` |
| `sending` | `failed` | Hard provider rejection, or attempts exhausted | Terminal |
| `sending` | `dead_letter` | Lease expired and the reconciler cannot determine the outcome, three times | Terminal, needs a human |
| `accepted` | `delivered` | Delivery webhook confirms | Twilio `delivered`, or Resend `email.delivered` |
| `accepted` | `failed` | Delivery webhook reports terminal failure | Twilio `undelivered`/`failed`/`canceled`, or Resend `email.bounced`/`email.complained` |
| `accepted` | `accepted`, `delivery_unknown = true` | No delivery event after 6 hours | Matches the existing 6-hour rule in `src/lib/sms-status.ts` (SECTION-CLAIMED) |

**There is deliberately no `undelivered` status.** F's diagram showed one; the canonical CHECK does not.
A delivery failure after provider acceptance is `failed`.

`failed` and `dead_letter` are different on purpose. `failed` means the outcome is **known and bad** and
the business rules in §3.5 have already acted on it. `dead_letter` means the outcome is **unknown** and no
automatic action is safe. Only `dead_letter` needs a human, and those rows get their own staff view.

**Terminal-good on Graph.** **VERIFIED:** `.env.example:53-54` sets `EMAIL_PROVIDER=graph` with a comment
to keep it there until the Resend domain is verified. `sendEmail`'s `idempotencyKey` is forwarded only to
Resend (SECTION-CLAIMED, `src/lib/email/emailService.ts:186-187`), and Graph's `/sendMail` returns no
body, so `provider_message_id` is NULL on Graph. **Do not write a NOT NULL guard on
`provider_message_id`, and do not build alerting that treats a lingering `accepted` email row as a fault
while the provider is Graph.**

### 3.2 The claim, and the two gates

```sql
UPDATE public.booking_preorder_outbox o
   SET status           = 'sending',
       lease_token      = $1,                       -- fresh uuid per worker invocation
       lease_expires_at = now() + interval '10 minutes',
       attempt_count    = attempt_count + 1,
       updated_at       = now()
 WHERE o.id     = $2
   AND o.status = 'pending'
   AND coalesce(o.next_attempt_at, o.due_at) <= now()
   -- Gate 1: permission. Written so it is correct in BOTH phases with no Phase 2 change:
   --         the booker is always covered, because they gave us their own number.
   AND (o.contact_id IS NULL OR public.preorder_contact_is_covered(o.contact_id))
   -- Gate 2: suppression. Phase 2 only in effect, Phase 1 the subquery is always empty.
   AND NOT EXISTS (
     SELECT 1 FROM public.preorder_sms_suppression s
     JOIN public.booking_preorder_contacts c ON c.id = o.contact_id
     WHERE o.channel = 'sms' AND s.phone_hmac = public.preorder_phone_hmac(c.phone_e164))
RETURNING *;
```

**Phase 1 ships Gate 1 only.** `preorder_sms_suppression` and `preorder_phone_hmac(text)` are both Phase 2
objects (Part 1 §9, §12.4), so the Gate 2 clause **does not parse in Phase 1 and must not be written**. It
is added by the Phase 2 migration in the same change that creates the table, the function and the secret.
Gate 1 is written now in its final form and needs no Phase 2 change, because
`preorder_contact_is_covered` already returns true for the booker.

Zero rows means another worker won, or a gate refused. Skip it and move on.

**A function is not a constraint.** Add a `BEFORE UPDATE` trigger on the outbox that refuses a transition
to `sending` for an uncovered contact. That is about ten lines and it turns a convention into a guarantee.

An uncovered contact goes to `cancelled` with `no_permission`. A suppressed number goes to `cancelled`
with `suppressed`. **`blocked_no_permission` is not a status and must not be invented.**

`preorder_contact_is_covered` is `SECURITY INVOKER`, not `SECURITY DEFINER`. The only caller is the claim
step, which already runs as `service_role`. A definer-rights function reachable by `anon` would be a free
oracle for "is this contact id real and permitted", and it buys nothing.

**Kill switch, checked per row at claim time, not only at start.** `preorder_module_enabled` and
`preorder_chases_enabled` are read inside the claim loop for each row. This is the rule everybody misses:
checking once at the top of the cron leaves a window where a flip mid-run still sends.

### 3.3 Why a crash cannot lose a message

The invariant is that **the durable row always exists before any provider call**, and the idempotency key
is derived from that row's id, so replaying is safe.

| Crash point | Row left behind | Recovery |
|---|---|---|
| After the insert, before any claim | `pending` | Next worker run claims it |
| After the claim, before the provider call | `sending`, lease expires in 10 min | Reconciler finds no settled provider record carrying our `stage`. Returns to `pending`, increments `lease_recoveries` |
| After the provider call, before the response is read | `sending`, lease expired | Reconciler finds the `messages` row by `stage` and promotes to `accepted` with the real sid. No duplicate SMS, because a retry would hit `sendSMS`'s own 14-day dedup on the same `stage` |
| After the response, before the status write | Same | Idempotent |

Two caveats that change the implementation, both SECTION-CLAIMED:

1. **Graph has no provider-side dedup.** For email rows the reconciler lookup is the only thing between a
   crash and a duplicate email. **Email recovery is lookup-first and never blind-retries:** if an
   `email_messages` row with our `stage` exists in any status other than `failed`, promote it, do not
   re-send. An SMS row may safely be re-sent because `sendSMS` suppresses it.
2. **A hard Twilio failure also writes a `messages` row**, with `status = 'failed'` and a synthetic
   `local-fail-<ts>-<rand>` sid carrying the same metadata (`src/lib/twilio.ts:738-756`). A naive "is there
   a `messages` row with this `stage`" lookup would promote a failure to `accepted`. The predicates in
   §3.7 exclude it explicitly.

Phase 2 note: a guest with no `customers` row gets no `messages` row at all
(`src/lib/sms/logging.ts:52-58` skips the insert when there is no `customerId`), so the reconciler can
never find a provider record for a guest SMS. That is safe but costs one extra worker cycle per crash.
Phase 2 must add a lookup that does not depend on `messages`. Phase 1 is unaffected: the booker always has
a `customers` row.

### 3.4 Idempotency keys, and the trap that would silently kill three of four messages

| Level | Key | Mechanism |
|---|---|---|
| Row | `idempotency_key = 'preorder:' \|\| outbox.id` | The table's own `UNIQUE` |
| SMS | `metadata.template_key = 'preorder_chase'`, **`metadata.stage = outbox.id::text`**, `metadata.table_booking_id` | `sendSMS` derives its internal dedup key from `{template_key, identity, context}` and `stage` is a recognised context key. TTL 14 days |
| Email | `sendEmail({ idempotencyKey: 'preorder:' \|\| outbox.id, tableBookingId, commType: 'preorder_chase', metadata: { stage: outbox.id } })` | Accepted by the signature, forwarded only to Resend. Pass it anyway so protection appears the day `EMAIL_PROVIDER` flips |

**Trap T2, and it is the regression test that protects the whole feature.** Two `sendSMS` calls with the
same `template_key` and the same `table_booking_id` inside 14 days are treated as the same message and the
second is dropped as a duplicate. Every chase point for one booking fits inside that window. So
**`metadata.stage` set to the outbox row id is mandatory on every pre-order SMS**. Without it a booker
gets the `T0` invitation and nothing else, and nothing in the logs would look like an error.

Acceptance criterion: schedule `T0`, `C1`, `C2` and `CUT` for one booking, run the worker four times,
assert four distinct provider calls. Then delete `metadata.stage` and assert the test fails.

Mandatory options on every pre-order `sendSMS` call:

```ts
await sendSMS(contact.phoneE164, body, {
  createCustomerIfMissing: false,   // default is TRUE; guest numbers must never enter `customers`
  customerId: bookerCustomerId,     // Phase 1: always the booker, who is already a customer
  allowTransactionalOverride: true, // service message about a booking, not marketing
  metadata: { template_key: 'preorder_chase', stage: outboxRow.id, table_booking_id: bookingId },
})
```

`createCustomerIfMissing: false` is not optional even in Phase 1, where it changes nothing. It is set now
so Phase 2 cannot forget it. Enforce it with a wrapper `sendPreorderSms()` in
`src/lib/preorder/messaging.ts`, a unit test asserting the flag, and an ESLint `no-restricted-imports`
rule forbidding a direct `sendSMS` import inside `src/lib/preorder/**`. The repo already uses that
mechanism to block the admin Supabase client inside `src/components/**`, so it is a copy, not an
invention.

**`allowTransactionalOverride: true` must not be used to defeat an opt-out.** SECTION-CLAIMED,
`src/lib/twilio.ts:196-207`: the override returns `allowed` **before** the `sms_opt_in` and `sms_status`
checks. The rule:

> Before a chase SMS is claimed, the worker reads the recipient's consent state and cancels the row with
> `opted_out` if it is blocked. For the booker that means `customers.sms_status = 'opted_out'` or
> `customers.sms_opt_in = false`. Only after that check passes is `allowTransactionalOverride: true` used,
> and its only job is to stop a marketing-grade opt-in flag blocking a service message about a booking the
> person is actually attending.

Whether a soft marketing opt-out should block a food-choice chase is `OD21`. A hard
`opted_out` status is always honoured, on every channel, forever.

### 3.5 SMS outcome mapping

Error codes are the ones already mapped in `src/lib/sms-status.ts` (SECTION-CLAIMED). Returned `code`
values are the ones `sendSMS` actually returns.

| Outcome | Class | Outbox result | Effect on the contact |
|---|---|---|---|
| Twilio `delivered` | success | `delivered` | none |
| Twilio `sent`, no delivery event after 6h | unknown | `accepted`, `delivery_unknown = true` | none. Treat as sent |
| 21211 invalid format | hard | `failed`, no retry | `reachability = 'unreachable'` immediately |
| 21614 invalid mobile | hard | `failed`, no retry | `unreachable` immediately |
| 30005 unknown destination | hard | `failed`, no retry | `unreachable` immediately |
| 30006 landline or unreachable carrier | hard | `failed`, no retry | `unreachable` immediately |
| 21610 recipient opted out | consent | `failed`, no retry | `opted_out`. Never message on any channel again for any booking |
| 21408 region permission denied | hard, ours | `failed`, no retry | `unreachable` **plus an immediate manager alert.** This is our fault |
| 30007 filtered by carrier | soft, our content | one retry, then `failed` | `unreachable` after **two separate points** both end in 30007, plus a content alert |
| 30003 device off or out of coverage | soft | full retry schedule, then `failed` | `unreachable` only after **two separate chase points** |
| 30004 blocked by carrier | soft | one retry, then `failed` | as 30003 |
| 30008 unknown carrier error | soft | full retry schedule | as 30003 |
| 30034 carrier temporarily unavailable | transient | full retry schedule | none |
| 21611 queued but cannot send | transient, ours | full retry schedule | none |
| `recipient_hourly_limit` (default 3/hour) | our guard | `next_attempt_at = now() + 65 min`, **attempt not consumed** | none |
| `recipient_daily_limit` (default 8/day) | our guard | `next_attempt_at` = 09:05 London tomorrow, attempt not consumed | none |
| `global_rate_limit` (default 120/hour) | our guard | `next_attempt_at = now() + 10 min`, attempt not consumed | none |
| `sms_suspended` | operator kill switch | stays `pending`, `next_attempt_at = now() + 30 min`, attempt not consumed. Alert once if still blocked after 4 hours | none |
| `customer_lookup_failed`, `customer_phone_mismatch` | hard, ours | `failed`, no retry | `unreachable` plus a manager alert |
| `idempotency_conflict` | hard, ours | `failed`, no retry, **plus an engineering alert** | none. It means the same `stage` was reused with a different body, which the frozen-body rule makes impossible. A bug, not a delivery problem |
| `{success:true, suppressed:true, suppressionReason:'duplicate'}` | success by dedup | `accepted`, `delivery_unknown = true`, no sid | none. The expected crash-replay result. Log at warn so a spike is visible |
| `{success:true, deferred:true}` | should be unreachable | `accepted`, `delivery_unknown = true`, **plus an engineering alert** | none. A quiet-hours clamp was missed |
| `{success:false, error:'This number is not eligible…'}`, **no `code`** | consent | `failed`, no retry | `opted_out`. Match on the message, or pre-check consent as §3.4 requires |
| `{success:false, error:'Failed to schedule message for delivery'}`, **no `code`** | should be unreachable | `pending`, `next_attempt_at` = next 09:05 London, attempt not consumed, **plus an engineering alert** | none. §2.6 says this must never be scheduled |
| Any other `{success:false}` | soft | full retry schedule | none until exhausted, then as 30003 |

**Why "two separate points" for the soft codes.** A phone switched off on a Tuesday morning is not an
unreachable person. Requiring two failed points across days is a cheap, strong signal. Hard codes escalate
immediately because the number is provably wrong and waiting fixes nothing.

Two verified `sendSMS` behaviours the mapping depends on: SMS safety limits default to 3 per recipient per
hour, 8 per recipient per day, 120 globally per hour (SECTION-CLAIMED, `src/lib/sms/safety.ts:79-81`);
production values are UNKNOWN and must be read from Vercel before the thresholds above are trusted.

### 3.6 Email outcome mapping

| Outcome | Class | Outbox result | Effect |
|---|---|---|---|
| Graph send returns success | accepted, terminal-good | `accepted` | none. No delivery signal exists on Graph |
| Resend `email.delivered` | success | `delivered` | none |
| Resend `email.bounced` | hard | `failed`, no retry | Email channel unreachable. Chasing continues on SMS only |
| Resend `email.complained` | consent | `failed`, no retry | Email channel suppressed. The existing `email_suppressions` table handles it |
| `sendEmail` returns "Recipient email address is suppressed" | hard | `failed`, no retry | Do not retry: the suppression is deliberate |
| Transport or provider error | transient | full retry schedule | none |

### 3.7 Retry schedule and the reconciler

`max_attempts = 3`, per transmission not per occasion.

| Attempt | Fires at |
|---|---|
| 1 | `due_at` |
| 2 | first failure + 5 minutes |
| 3 | second failure + 30 minutes |
| (none) | third failure moves the row to `failed` |

Three overrides:

- **Retries never outlive their point.** If `now() > cutoff_at + interval '2 hours'`, cancel with
  `after_cutoff`. A chase arriving after the kitchen list has gone out is worse than no chase.
- **No send, retry or otherwise, more than 2 hours after `due_at`.** Checked at claim time on every row,
  first attempt included. Cancel with `skipped_past`. **Without this, clearing a kill switch that has been
  on for a week fires a week of chases in one worker run.** Two of the switches leave rows sitting in
  `pending`, so this guard is not optional.
- **Rate-limit, quiet-window and kill-switch deferrals do not consume an attempt.** They set
  `next_attempt_at` and decrement `attempt_count` back.

**Reconciler** `/api/cron/preorder-reconcile`, every 15 minutes, guarded by `authorizeCronRequest`. Five
passes, in order:

1. **Recover expired leases.** `status = 'sending' AND lease_expires_at < now()`. For each, look for a
   settled provider record with exactly these predicates:

```sql
-- SMS. The status and sid filters are load-bearing: a hard failure ALSO writes a messages row,
-- with the same metadata and a synthetic 'local-fail-…' sid. Promoting one of those to 'accepted'
-- would report a failed send as delivered.
SELECT id, message_sid FROM public.messages
 WHERE metadata ->> 'stage' = $1
   AND direction = 'outbound'
   AND status <> 'failed'
   AND message_sid NOT LIKE 'local-fail-%'
 ORDER BY created_at DESC LIMIT 1;

-- Email.
SELECT id, resend_message_id FROM public.email_messages
 WHERE metadata ->> 'stage' = $1
   AND direction = 'outbound'
   AND status NOT IN ('failed','suppressed')
 ORDER BY created_at DESC LIMIT 1;
```

   Found: promote to `accepted`, set `message_row_id`, set `provider_message_id` where the provider gave
   one. Found but **failed**: apply §3.5 to its `error_code` rather than treating the outcome as unknown.
   Nothing found: return to `pending`, `next_attempt_at = now()`, `lease_recoveries + 1`. At
   `lease_recoveries >= 3`, move to `dead_letter` and raise an alert.

2. **Flag unknown deliveries.** `status = 'accepted' AND channel = 'sms' AND accepted_at < now() -
   interval '6 hours' AND delivered_at IS NULL` becomes `delivery_unknown = true`. Do not apply to email
   while `EMAIL_PROVIDER = graph`.
3. **Alert on queue age.** Any `pending` row with `due_at < now() - interval '60 minutes'`. One alert per
   day, deduplicated, not one per row.
4. **Cancel stale work.** Any `pending` row whose contact is complete, opted out or unreachable, or whose
   booking is cancelled. Any `pending` row more than 2 hours past `due_at`, with `skipped_past`.
5. **Refresh stale bodies.** Any `pending` row whose `order_revision` is behind the order's current
   `revision` is **rebuilt in place**: new body, new `order_revision`, same row, same `due_at`. Never
   cancelled and reinserted. Cancel-and-reinsert on the same business key is what created the index
   conflict the live-row-only unique indexes exist to avoid.

**Two indexes are required on existing tables**, because the reconciler looks up a provider record by our
`stage` value and no such index exists today (SECTION-CLAIMED). Without them every reconciler run
sequentially scans `messages`, one of the largest tables in the database:

```sql
CREATE INDEX IF NOT EXISTS messages_metadata_stage_idx
  ON public.messages ((metadata ->> 'stage')) WHERE metadata ->> 'stage' IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_messages_metadata_stage_idx
  ON public.email_messages ((metadata ->> 'stage')) WHERE metadata ->> 'stage' IS NOT NULL;
```

The production row count of `public.messages` is **UNKNOWN**. If it is large, both must be created
`CONCURRENTLY` in their own migration file, following Part 1 §13's M0 pattern.

### 3.8 Bodies are composed at claim time

The worker fills `recipient`, `body`, `subject` and `body_html` immediately before the provider call,
reading the contact's current state. They are NULL while the row is `pending`. This is what makes "rebuild
in place" cheap, and it means a chase scheduled six weeks ago cannot go out quoting six-week-old numbers.

**Once written, the body is frozen for the life of that row**, so every retry sends identical text, which
is what keeps `sendSMS`'s request-hash check from returning `idempotency_conflict`.

### 3.9 Manual recovery: three staff controls

All on the booking detail screen, all audit-logged.

1. **Correct the number.** Editing `phone_e164` clears `unreachable`, resets the soft-failure counter, and
   re-arms every point still in the future by inserting a fresh row per point. `failed` and `dead_letter`
   rows are terminal and left alone: they are the evidence. Re-arming works because the unique indexes
   cover live rows only. It does **not** restore consumed occasions and does not re-send a past point.
2. **Resend now.** Creates a `notice` row due immediately. Outside the cap, rate limited to once per
   contact per hour so a frustrated manager cannot spam a guest.
3. **Retry a dead letter.** This must create a **new row**, not reopen the old one. The old row stays
   `dead_letter` for the record. Reopening the same row would not work: `stage` is the row id, and
   `sendSMS` would suppress the send as a 14-day duplicate, so the button would appear to work and nothing
   would go out. Only offer the button once the reconciler has confirmed no provider record exists.

Acceptance criterion: retry a `dead_letter` row and assert a **new** outbox row with a new id is created
**and** that a real provider call was made. A test that only asserts "the button returned success" would
pass while the send was silently suppressed.

### 3.10 Manager escalation and the digest

`ESC` fires at `cutoff_at + 5 minutes`. It is one email per booking, to `MANAGER_EMAIL`, telling the
manager the booking reference, the date, the party size, how many covers are still incomplete, and a deep
link into AMS. **It never carries a phone number, a guest name, a dish choice or any dietary content.**
§5.5 is the full rule and it is enforced by test.

Other escalations, all `message_class = 'escalation'` or `'notice'` and all outside the cap:

| Situation | Who | When |
|---|---|---|
| The booker becomes unreachable on both SMS and email | Manager | Immediately, `now + 15 minutes`. There is nobody left to chase, so waiting for the cutoff wastes the remaining days |
| Booking made at or after the cutoff | Manager | `now + 2 hours`, clamped (§2.7) |
| Party grows after the cutoff | Manager | Immediately, `now + 15 minutes` |
| Any row reaches `dead_letter` | Manager | Batched into the 15-minute digest, once per booking per day |
| An SMS suspension persists for 4 hours | Manager | Once, then not again until it clears |

---

## 4. Privacy: the dietary and allergy position

### 4.1 The position, stated correctly

The v1 spec said allergy free text is "health-adjacent" and that recording it as "a requirement, never a
reason" changes how it should be treated. **That reasoning is wrong and is withdrawn.** How a controller
labels a field does not change its data class. If a field can reveal information about someone's health it
is capable of being special-category data under Article 9 of the UK GDPR, and processing it needs both an
Article 6 lawful basis and a separate Article 9 condition.

**Neither this document nor the developer is qualified to decide which Article 9 condition applies.** What
the design can do is reduce how much is held, how identifiable it is, how long it is kept and who can see
it. That is what §4.2 to §4.5 do.

**The problem is not new to this feature.** SECTION-CLAIMED and important: `table_bookings` already has
`dietary_requirements TEXT[]`, `allergies TEXT[]` and `special_requirements TEXT`, accepted by the public
API today. This feature increases the volume and moves it per person. The legal work is overdue, not
optional.

**VERIFIED by C on 2026-08-04:** the live privacy policy (`app/privacy-policy/page.tsx`, 201 lines)
contains no occurrence of "allergy", "allergies", "dietary", "health", "special category", "Article 9" or
"retention". The notice does not describe what the pub already does. Updating it is a blocking task (L5)
and it applies to today's practice, not only to this feature.

### 4.2 The legal decisions, named and not answered

| # | Decision | Who decides | Blocks |
|---|---|---|---|
| **L1** | The documented **Article 6** lawful basis for pre-order data, including third-party names | Owner with a data protection adviser or solicitor | Schema approval |
| **L2** | Whether the structured dietary list and the capped note are special-category data here, and if so which **Article 9 condition** applies. Explicit consent is the obvious candidate but carries its own conditions: freely given, specific, informed, withdrawable, and not a precondition of the booking | Adviser or solicitor. **Not the developer, not this document** | Any collection of dietary data through the new journey |
| **L3** | Whether a **DPIA** is required. Third-party data obtained without contacting the subject first, plus possible health data, plus automated chasing, is a plausible trigger. The ICO screening checklist is the right instrument | Same as L2 | Build start. Cheap early, expensive to retrofit |
| **L4** | Whether an **Article 14** notice is owed to guests whose numbers the booker supplied, and whether a link to a short notice in the first SMS satisfies it | Same as L2 | The wording of the first guest SMS. **Phase 2 only** |
| **L5** | **Privacy notice update** covering per-cover dietary data, the retention periods in §5, and the SAR route in §7 | Owner, drafted with adviser input | Go-live, both phases |
| **L6** | **Food-safety retention need.** Does the pub need to show what it was told about an allergy after the meal, for an EHO query or an insurance claim? This sets the dietary row in §5.2 | Owner with their food-safety adviser and insurer | The retention schedule |
| **L7** | Who may see cover-level allergy free text. The current design says every staff user with `table_bookings` view, on a detail view only | Owner with adviser input | The §4.4 matrix |
| **L8** | Whether the pre-existing booking-level `table_bookings.allergies` and `dietary_requirements` join the controlled list | Same as L2 | Nothing in this feature. Raise it in the same conversation |

**Recommended sequencing: book one session covering L1, L2, L3 and L6 together. They are one
conversation.** L5 follows from them. L4 is Phase 2 and can wait.

**The schema works either way, so this does not block the October date.** If L2 comes back as "free text
must not be collected through a web form", ship Phase 1 with `dietary_note` present, never written and
never displayed. No schema change, no migration, no delay. If it comes back as "explicit consent
required", the field becomes genuinely optional and skippable with its own tick and its own withdrawal
route, and the booking completes without it. That is a small change if planned and a large one if
retrofitted.

### 4.3 What is collected, and what deliberately is not

Part 1 §10.4.1 settles the field. One name, one shape, one picklist:

| Field | Type | Cap |
|---|---|---|
| `booking_preorder_covers.dietary_codes` | `text[]`, closed enum, 10 codes | n/a |
| `booking_preorder_covers.dietary_note` | `text` | **200 characters**, enforced by CHECK |
| `booking_preorder_covers.needs_kitchen_call` | `boolean` | n/a |

Picklist, closed in the database so a manager cannot add "diabetic" or "coeliac disease" and silently
change the data class of the column: `vegetarian`, `vegan`, `gluten_free`, `dairy_free`, `nut_free`,
`shellfish_free`, `halal`, `no_pork`, `no_alcohol`, `other`. Changing the list is a migration and goes
through review.

The wording deliberately describes **the food**, not the person. "No nuts" is a kitchen instruction. "Nut
allergy" is a statement about somebody's health.

**Never collected:**

| Not collected | Why |
|---|---|
| A named medical condition field | Straightforwardly health data with no operational benefit over "no gluten" |
| Severity, epi-pen status, medication | We are a pub, not a clinic. Knowing this changes nothing we can safely do |
| Any note longer than 200 characters | Length invites a medical history. **The cap is a data-minimisation control, not a UI preference** |
| Dietary data on the booker's summary of other covers | §4.4 |
| Dietary data in any SMS or email body | §2.13, §5.5 |
| Dietary data in any `audit_logs` payload | Audit rows are permanently undeletable |

**The serious-allergy route.** `other`, or any non-empty note, sets `needs_kitchen_call = true`. That flag:

1. Shows the guest an immediate on-screen confirmation: "Thanks. Please call us on 01753 682707 before the
   day so we can go through this properly."
2. Adds the booking to the manager digest as "pre-order needs a call", with the booking reference and a
   deep link, **not** the note text and **not** a phone number.
3. Shows on the kitchen sheet as a highlighted line.

A free-text box on a website is a bad channel for a life-threatening allergy: nobody reads it back, nobody
confirms it, and the guest reasonably believes it has been actioned. Directing serious cases to a phone
call is safer for the guest and reduces what we store. **Recommendation: put the same sentence in the
confirmation email and the `T0` SMS.** It costs nothing and it is the single highest-value line in the
whole journey. `OD8`.

**Kitchen merge rule, non-negotiable.** Every kitchen output shows **both** levels, labelled:

```
Allergies
  BOOKING (applies to the table): nut allergy on the table, please keep separate boards
  COVER 3, Dave: coeliac
```

Never silently concatenate. Showing only the new per-cover fields would make a real allergy typed into the
existing booking-level field disappear from the sheet the chef reads. That is a food-safety regression
introduced by a feature.

### 4.4 Field-level access, Phase 1

Legend: **F** full, **M** masked, **A** aggregate or count only, **N** none.

**Scope, and it matters.** This governs the **pre-order tables only**. SECTION-CLAIMED: the booking detail
screen already shows `booking.customer.mobile_number` in full as a `tel:` link to anyone with
`table_bookings` view. FOH and BOH already see the booker's number, and this design does not take that
away. Masking it in the pre-order panel while it sits unmasked two inches higher on the same page would be
theatre.

| Field | Booker | FOH | BOH | Manager |
|---|:--:|:--:|:--:|:--:|
| Booking reference, date, time, party size | F | F | F | F |
| Period name and menu | F | F | F | F |
| The booker's own number (already on the booking record) | M | **F, unchanged from today** | **F, unchanged from today** | F |
| Cover `guest_name` | F (they typed it) | F | F | F |
| Cover dish selections | F | F | F | F |
| Cover `dietary_codes` | F | F | F | F |
| Cover `dietary_note` free text | F | **F, detail view only** | **F, detail view and kitchen sheet** | F |
| `needs_kitchen_call` | **A** ("1 guest needs a call from us") | F | F | F |
| Per-cover completion status | F | F | F | F |
| Dish totals for a service | N | A | **F** | F |
| Chase and message history | **A** ("last reminded 2 days ago") | N | N | F |
| Retention hold controls | N | N | N | F |

**Why FOH sees dietary free text on a detail view but not a list view.** The iPad sits on the bar and is
visible to customers. A list of tonight's bookings with "no nuts, no dairy, coeliac partner" down the side
is a data leak in the room. On an individual booking, opened deliberately, it is a service need. This is a
real control, cheaply implemented.

**Why the booker gets a count for `needs_kitchen_call`.** Telling the booker "Sarah needs a call from us"
tells them Sarah has an allergy. "One of your guests needs a call from us, we will handle it" gets the same
outcome with none of the disclosure.

**Enforcement, in three places.** There is no field-masking primitive today, so this is new work.

1. **Query layer.** Projection functions in one file, `src/lib/preorder/projections.ts`:
   `projectForBooker(orderId)` and `projectForStaff(orderId, role)`, plus `projectForGuest(contactId)` in
   Phase 2. Nothing else may select from the pre-order tables for a read that reaches a UI. Enforced with
   the same ESLint `no-restricted-imports` mechanism the repo already uses to block the admin Supabase
   client inside `src/components/**`: a `files` glob over the pre-order route and component directories,
   restricting the Supabase client imports.
2. **Route layer.** Booker routes resolve identity from the token only. Staff routes use the existing
   `requireFohPermission`, `requireBohTableBookingPermission` and
   `requireModulePermission('table_bookings','manage')`.
3. **Tests.** One test per **N** and **M** cell, asserting the field is **absent from the serialised
   response**, not merely hidden in the UI.

---

## 5. Retention, under the O5 split

### 5.1 The rule and the numbers

Owner answer O5, refined and binding: **keep dish and cover-count data 2 years for planning, delete
personal data far sooner, because the stated planning purpose needs no personal data at all.**

The owner asked for 2 years "for future ordering and capacity planning". That purpose is fully served by
**dish counts and cover counts**. It needs no name, no phone number, no dietary note and no link to a
booking. Keeping the personal data for two years buys the owner nothing and costs a two-year window in
which a leak, a subject access request or a mistake is possible.

**One set of numbers, cited by everybody.** Four sections quoted four different figures; these are the
considered ones and they win.

| Class | Deleted at | Overrules |
|---|---|---|
| Direct identifiers: phone numbers, display names, guest names, outbox recipients and bodies | **D + 60 days** | G's "90 days", E's "90 days", F's "on the order of 90 days" |
| Dietary codes, dietary notes, free-text staff and guest notes | **D + 90 days**, pending L6. If L6 says there is no food-safety need, **cut to D + 14** | |
| Operational rows with no personal content, once cleared | D + 90 days, row deleted | |
| Anonymous aggregates | **2 years**, exactly as the owner asked | |
| Permission evidence (Phase 2) | D + 6 years, retained | |
| Suppression list (Phase 2) | **Never** | |

**`D` is `booking_date`, the date of the meal, not the date the row was created.** All cutoffs run at
04:15 Europe/London in one new cron, `/api/cron/preorder-retention`. **VERIFIED:**
`src/app/api/cron/communications-retention/route.ts` exists and is scheduled in `vercel.json` (line 149);
follow that route's shape, including `authorizeCronRequest` and `reportCronFailure`.

**VERIFIED:** the existing communications retention is 24 months
(`COMMUNICATION_RETENTION_MONTHS = 24` at `src/services/gdpr.ts:7`, applied by
`GdprService.runCommunicationRetentionCleanup` at `:542`). That is longer than this schedule. The mismatch
does not matter because of the hard rule that no dietary content ever enters a message body.

### 5.2 Every table the feature creates

**No table is absent.** Twelve canonical tables plus the existing tables this feature touches.

| Table | Phase | Personal fields | At D+60 | At D+90 | Longer | Note |
|---|---|---|---|---|---|---|
| `booking_preorder_orders` | 1 | `checked_note`, `unlocked_reason` (staff free text; a manager could type a guest's name or condition into either) | | Both set to NULL | Row deleted at D+90 with the rest | **A explicitly refused to close this gap and C did not know these fields existed.** Now closed |
| `booking_preorder_contacts` | 1 | `phone_e164`, `display_name` | Phone to NULL, `phone_cleared_at` set; name to `'Guest ' \|\| substring(id::text,1,4)` | Row deleted | | The stub satisfies the 1 to 80 character CHECK. NULL is safe against the partial phone index |
| `booking_preorder_covers` | 1 | `guest_name`; `dietary_codes`, `dietary_note`, `needs_kitchen_call` | `guest_name` to NULL | Dietary fields to NULL, `'{}'` and false, then row deleted | | |
| `booking_preorder_selections` | 1 | `item_note` (free text, may name a person or a condition) | | `item_note` to NULL, then row deleted **after** the aggregate is written and verified | | Dish, course and choice are the planning data and are extracted first |
| `booking_preorder_amendments` | 1 | **`planned_drops` jsonb contains `guest_name` and the dish list for every dropped cover** | Rewrite the jsonb, stripping `guest_name` and `dishes`, keeping `cover_id`, `ordinal`, `state`, `first_completed_at` | Row deleted | | **B's erasure table omitted this entirely.** Without it an erased guest's name survives inside a JSON blob |
| `booking_preorder_tokens` | 1 | none (a hash) | | | **D + 7 days, row deleted** | A token is useless once the meal has happened. Delete rather than expire |
| `booking_preorder_outbox` | 1 | `recipient`, `body`, `subject`, `body_html`, `last_error` | All five: recipient, subject and html to NULL, `body` to `'[removed after pre-order retention period]'`, `last_error` to NULL | | `status`, `cancel_reason`, `provider`, `provider_message_id`, `idempotency_key` and timestamps kept **2 years** to reconcile SMS spend | **Check `idempotency_key` construction first.** If it includes a phone number, change the construction, do not extend the retention. Twilio error text sometimes echoes the destination, which is why `last_error` is on this list |
| `preorder_alerts` | 1 | `detail` jsonb (forbidden to hold PII, but nothing enforced it) | | `detail` reduced to counts and ids | Row deleted at **D + 2 years**; alerts with no `table_booking_id` deleted 2 years after `first_seen_at` | Plus the §5.4 acceptance test that scans for PII |
| `booking_period_demand_stats` | 1 | none | | | **2 years**, then deleted | The owner's stated purpose, served without personal data |
| `booking_preorder_permission_evidence` | 2 | `wording_text`, `actor_*`, `booking_reference`, `phone_hmac` | | | **D + 6 years**, retained | The record that we were entitled to contact people. It must outlive a complaint. It contains no phone number |
| `preorder_sms_suppression` | 2 | none (a hash) | | | **Never deleted** | The instruction must outlive the booking |
| `booking_amendments` | Separate workstream | `staff_message`, `failure_reason` (free text shown to staff) | | Both to NULL | Money fields kept per the finance retention rule that workstream sets | **D gave this no retention rule.** It has one now |

**Deleted from the design, and therefore needing no rule:** `preorder_backfill_runs` (which would have
held `customer_name` with no schedule at all), `booking_preorder_print_runs`,
`booking_preorder_print_run_items`, `booking_preorder_permission_covers`,
`booking_period_course_mix_stats`, and G's separate alert outbox. **Consolidation removed six retention
problems by removing six tables.**

**Existing tables touched:**

| Table | Rule | Note |
|---|---|---|
| `messages.body`, `email_messages.body_text/html` | 24 months, existing cron, unchanged | Longer than this schedule. Safe because no dietary content ever enters a body |
| `webhook_logs` | 24 months, existing cron | Confirm U1: whether Twilio status callbacks for a send with no customer id land here at all |
| `audit_logs` | **Permanent. Cannot be deleted** (delete and update are both blocked by triggers, SECTION-CLAIMED) | **Hard rule: no phone numbers, no names, no dietary content, no wording text in any payload. UUIDs and counts only** |
| `table_bookings.allergies`, `.dietary_requirements`, `.special_requirements` | **Unchanged by this work** | Bringing them into a schedule is a separate change. Raise with L8 |
| `customer_consents` | Existing cron, unchanged | The booker's consent lives here under the existing model |

**Why the aggregate exists and what it does not promise.** `booking_period_demand_stats` bands party size
and counts bookings, because "1 booking, party of 17, on 12 December, ordered the beef" is
re-identifiable by anyone who can see the diary. **Known weakness, stated rather than hidden:** on a quiet
service a band can hold a single booking and `covers_count` can be 1. That row is re-identifiable in
principle. It holds no name, number or note, so the residual risk is low. If the owner wants it removed,
suppress any row with `bookings_count = 1` into an `other` bucket. **Recommendation: do not suppress in
version one**, but the aggregate is therefore **not certified anonymous** and nobody should later assume
it is.

### 5.3 Order of operations, enforced

1. **D + 1:** the aggregate job writes `booking_period_demand_stats` for **both** metrics (`dish` and
   `course_shape`). Idempotent on `bpds_key_uq`, which is why `service_slot` is `NOT NULL` with a
   sentinel: a nullable column in a UNIQUE key does not deduplicate in PostgreSQL, so the idempotency
   promise would silently fail.
2. **D + 7:** delete token rows.
3. **D + 60:** clear the direct identifiers in §5.2.
4. **D + 90:** clear the dietary and free-text fields, rewrite `planned_drops`, then delete selections,
   covers, contacts and orders.
   **Guard: refuse step 4 for a service date unless `booking_period_demand_stats` holds rows for that date
   for both metrics.** Otherwise a failed aggregate silently destroys the data the owner asked to keep.
5. Every step skips rows on legal hold, writes counts to the cron result, and calls `logAuditEvent` with
   **counts only**.

**Legal hold.** `booking_preorder_contacts.retention_hold_until` and `retention_hold_reason`, set by a
manager for a complaint, an insurance claim or an EHO query. Every step skips held rows. Surfaced on the
booking detail so nobody wonders why old data is still there.

**The retention cron is the one component that does NOT check `preorder_module_enabled`.** This is
deliberate, not an oversight: turning the feature off must not stop deletion of data already collected.
Write that into the route as a comment so nobody "fixes" it.

### 5.4 Erasure is not retention

Both exist and they are different operations. **Label them and keep both.**

| | Erasure (a request) | Retention (a schedule) |
|---|---|---|
| Trigger | A person asks | The clock |
| Effect | Clears fields, **keeps the row**. `phone_e164` becomes `'erased-' \|\| id`, `orders.erased_at` is stamped | **Deletes the row** |
| Why | An erasure must leave a visible trace so a subject access request can honestly say it happened | The whole purpose is that nothing is left |

**The retention job must treat the `erased-%` sentinel as "already erased" and skip the D+60 phone step
for that row.** The canonical `bpc_phone_ck` CHECK permits the sentinel; B's original CHECK would have
rejected its own erasure value, which is a real bug caught in assembly.

Erasure clears exactly this list and nothing else:

| Table.field | On erasure |
|---|---|
| `booking_preorder_contacts.phone_e164` | `'erased-' \|\| id`. **Not NULL:** NULL is what retention leaves behind and the two must stay distinguishable |
| `booking_preorder_contacts.display_name` | `'[erased under GDPR request]'`, matching the existing idiom in `src/services/gdpr.ts` |
| `booking_preorder_contacts.reachability` | `'removed'`. Chasing stops permanently. **There is no `erased` value**: the CHECK allows only `ok`, `unreachable`, `opted_out`, `removed` |
| `booking_preorder_covers.guest_name`, `.dietary_codes`, `.dietary_note` | NULL, `'{}'`, NULL, for covers under that contact only |
| `booking_preorder_selections.item_note` | NULL |
| `booking_preorder_amendments.planned_drops` | Rewritten, stripping `guest_name` and `dishes` |
| `booking_preorder_outbox.recipient`, `body`, `subject`, `body_html`, `last_error` | Redacted, for that contact's rows only |
| `booking_preorder_tokens` | Deleted. All links invalid immediately |
| `booking_preorder_orders.erased_at` | Stamped |
| Selections: dish, course, choice, counts, timestamps | **Retained**, severed from the person. They are then a dish count |
| `booking_period_demand_stats` | Untouched. It contains no personal data |
| Permission evidence (Phase 2) | **Retained.** `revoked_at` and `revoked_reason = 'erasure_request'` set on **that contact's rows only**. `phone_hmac` kept: it is what answers "was my number ever covered" and it cannot be reversed without the secret |

**Acceptance tests for the audit rule.** Two scans, both required:

- No `audit_logs.additional_info` or `old_values` payload written by any pre-order code path contains a
  phone number, a name, a dietary code, a note or wording text.
- No `preorder_alerts.detail` payload contains any of the above.

Both must scan actual rows produced by the test suite, not template fixtures.

### 5.5 Outside the database

| Location | Rule | Status |
|---|---|---|
| Manager digest and escalation emails | No guest phone numbers, names, dish choices or dietary content. Booking reference, counts, booker's first name, correlation id and a deep link into AMS. Apply `redactPii()` as a **second** line of defence after building the body from the allowed-field list | **VERIFIED:** `src/lib/cron/alerting.ts` exports `escapeHtml`, `redactPii` and `reportCronFailure`. Design rule, testable |
| Twilio bodies and console logs | **U2.** If Twilio retains bodies beyond 60 days, enable console redaction or document the gap | UNKNOWN |
| Microsoft 365 mailbox on `manager@the-anchor.pub` | **U3.** Retention and deleted-item recovery | UNKNOWN |
| Supabase backups and PITR | **U4. This bounds every deletion promise in §5.** SAR responses must say "deleted from live systems within X days and from backups within Y", never a bare "deleted" | UNKNOWN |
| Vercel function logs | No token, no phone number and no dietary text at any level. Log contact ids and booking ids | Design rule, testable |

---

## 6. Subject access and erasure

### 6.1 The verified gap in the existing service

**VERIFIED:** `GdprService.exportUserData(targetUserId, currentUserId)` is at `src/services/gdpr.ts:272`
and `GdprService.deleteUserData(userId)` at `:402`. Both are keyed on a `profiles.id`, then find
`customers` by matching email (SECTION-CLAIMED for the email-matching detail).

**A pre-order guest has no profile, no email and by design no customer row. The existing service cannot
find them at all.** Not partially. Not at all. Building this feature without fixing that ships a system
where a lawful request cannot be answered.

### 6.2 Who the data subject is

**There are up to two kinds of subject per contact**, and in Phase 1 up to `party_size + 1` per booking.

| Subject | Identified by | Their data |
|---|---|---|
| Contact holder (Phase 1: always the booker) | `phone_e164` | The number, the display name, chase and message history |
| Named cover | `booking_preorder_covers.guest_name` plus the contact and booking | That cover's name, dish selections, dietary codes and note |
| Unnamed cover | Not identifiable on its own | Selections only. Not personal data once severed from the contact |

**Rule: a phone number identifies the contact holder, not every cover.** A request from the contact holder
returns their own data plus the **existence** of the covers they ordered for. It returns another named
person's dietary note only if that person is plainly the same individual, or if they ask themselves.

**One honest limitation.** A cover whose person never gave us their own number is only findable through
the contact who did. That is real, and it is the consequence of the pub genuinely not holding that
person's contact details, which is the privacy-preserving outcome.

### 6.3 Identity verification

Verification is the step most often skipped and it is the one that causes harm, because it is what stops
one person harvesting another's data.

| Requester | Verification | Rationale |
|---|---|---|
| Contact holder, by phone | Manager sends a 6-digit code by SMS to the **stored** number and the requester reads it back | Proves control of the number the data is filed under. Reuses the existing SMS path |
| Contact holder, by email | Not possible. We hold no email for a non-booker contact | Ask them to make the request from the number |
| Named cover who is not a contact | **Manual, manager judgement.** Booking reference, the date, and something only that person would know, such as which dish they chose | There is no shared secret. Honest about the limit rather than pretending otherwise |
| Booker | Existing customer verification. They are a customer | Unchanged |
| Anyone claiming to act for another | Refuse without written authority. Escalate to the owner | Standard |

Every attempt, successful or not, is audit-logged with the request id and the outcome. **No phone number
in the audit payload.**

### 6.4 Search

New admin screen at `/settings/gdpr/preorder`, gated on `table_bookings:manage`.

**There is no `booking_preorder_contacts.table_booking_id` and no `booking_preorder_covers.table_booking_id`.**
Every search goes through `booking_preorder_orders`. Earlier drafts joined columns that do not exist.

```sql
-- 1. By phone. Uses generatePhoneVariants so a request quoting "07911 123456" matches "+447911123456".
SELECT c.id, o.table_booking_id, c.display_name, c.reachability, c.phone_cleared_at,
       b.booking_date, b.booking_reference
FROM   public.booking_preorder_contacts c
JOIN   public.booking_preorder_orders   o ON o.id = c.order_id
JOIN   public.table_bookings            b ON b.id = o.table_booking_id
WHERE  c.phone_e164 = ANY ($1::text[]);

-- 2. By name, for a named cover with no number of their own.
SELECT v.id, v.contact_id, v.guest_name, b.booking_date, b.booking_reference
FROM   public.booking_preorder_covers   v
JOIN   public.booking_preorder_contacts c ON c.id = v.contact_id
JOIN   public.booking_preorder_orders   o ON o.id = c.order_id
JOIN   public.table_bookings            b ON b.id = o.table_booking_id
WHERE  v.guest_name ILIKE '%' || $1 || '%'
  AND  b.booking_date BETWEEN $2 AND $3;

-- 3. PHASE 2 ONLY. The one that still works after the rows are gone: "was my number ever covered
--    by a permission confirmation". Note this reads the MERGED evidence table. The two-table
--    design (evidence plus a separate _covers child) was consolidated in the canon, so any query
--    joining booking_preorder_permission_covers is against a table that does not exist.
SELECT pe.booking_reference, pe.booking_date, pe.wording_version, pe.captured_at,
       pe.revoked_at, pe.revoked_reason
FROM   public.booking_preorder_permission_evidence pe
WHERE  pe.phone_hmac = $1;    -- HMAC computed from the requester's number at query time
```

The name search is a plain `ILIKE` with a bound parameter, so `%` and `_` typed by a requester act as
wildcards. That is acceptable on a manager-only screen and is not an injection risk, but the screen should
say "partial names match" so nobody reads a wildcard result as a data leak.

**The retention interaction, stated plainly.** After D+60 the phone number is gone, so search 1 stops
working. After D+90 the contact, cover and selection rows are gone entirely. That is not a bug, it is the
schedule doing its job, and the response should say so: "we no longer hold any pre-order data for bookings
before [date]". Search 3 survives to D+6 years and answers the permission question without our holding the
number.

### 6.5 Export and erasure API

Two new methods on `GdprService`, keyed on phone rather than profile:

```
GdprService.exportPreorderDataByPhone(phoneE164, requestedByUserId)
GdprService.erasePreorderDataByPhone(phoneE164, requestedByUserId, options)
```

Export returns JSON in the same shape the existing service uses, so a combined response can be assembled
when the requester is also a customer:

```json
{
  "subject": { "phone": "+447911123456", "matchedContacts": 2 },
  "contacts": [{
    "bookingReference": "TB-2026-004821",
    "bookingDate": "2026-12-12",
    "displayName": "Dave",
    "coversOrderedFor": 4,
    "reachability": "ok",
    "phoneClearedAt": null,
    "covers": [
      { "ordinal": 1, "guestName": "Dave", "courseShape": "starter_main",
        "selections": [{ "course": "starter", "itemName": "…" }],
        "dietaryCodes": ["gluten_free"], "dietaryNote": "…" }
    ],
    "messagesSent": [{ "sentAt": "…", "channel": "sms", "chasePoint": "C1", "status": "delivered" }]
  }],
  "notHeld": ["email address", "marketing preferences", "payment details"]
}
```

`courseShape` is derived at export time from the cover's selection rows, using the same classification as
the aggregate. It is included because "I only ordered two courses" is a plausible thing to want confirmed,
and because the data model deliberately has no stored course count.

`notHeld` is included because telling somebody what you do **not** have is often more reassuring than the
list of what you do.

**Erasure before the meal.** The cover reverts to unassigned, the booker is told "one of your guests has
asked us not to contact them, please order for them or ask them directly", and the manager digest flags
it. **We do not tell the booker who, and we do not tell them why.**

**Response ownership.** The owner is the controller. The manager runs the search and prepares the export.
The owner signs it off before it leaves. The statutory deadline is one month; set a calendar reminder at
21 days.

**Acceptance criteria**

- [ ] `exportPreorderDataByPhone` finds a contact from `07911 123456`, `+447911123456` and
      `447911123456`, using `generatePhoneVariants`. **Do not write this test against `07700 900417`:**
      that Ofcom drama range fails `isValid()` in the installed `libphonenumber-js`, so the validator would
      have rejected it at entry and no contact would exist to find.
- [ ] Erasure writes the `erased-<id>` sentinel (not NULL), stamps `orders.erased_at`, retains the
      selections severed from the person, deletes the tokens and sets `reachability = 'removed'`.
- [ ] A retention-cleared contact (`phone_e164 IS NULL`, `phone_cleared_at` set) and an erased contact
      (sentinel value) are distinguishable in one query. The retention job skips the phone step for an
      already-erased row.
- [ ] A request for a date whose data has been deleted returns an explicit "no longer held" response, not
      an empty one.
- [ ] Verification failure is audit-logged with no phone number in the payload.

---

## 7. The refund and growth workstream: SEPARATE, not Christmas

### 7.1 The decision, and the stale record

**Owner decision D2, given 2026-08-04: the owner was asked whether seasonal amendments should stay a
manual correction and answered NO. The automatic refund gets built.**

> **`tasks/seasonal-amendment-deposit-decision-2026-08-03.md` (commit `dac862b7`) records the opposite
> decision, that shrinking a party stays a manual correction for the first season. That record is STALE
> and is superseded by the owner's answer of 2026-08-04. `G-delivery.md` §G.13.4 treats the stale record
> as current and is wrong on that point.**

**VERIFIED by me on 2026-08-04**, so nobody has to take this on trust:

- The file exists at `tasks/seasonal-amendment-deposit-decision-2026-08-03.md`. Its line 4 reads
  "Status: **decided on the standing recommendation, pending owner confirmation.** No code changed." Its
  line 8 reads "**Shrinking a party stays a manual correction for the first season.**"
- The live code still behaves that way. `src/lib/table-bookings/staff-deposit-transitions.ts` at
  `if (input.booking.booking_period_id)` returns `state: 'manual_review'`, leaves the deposit exactly as
  it stands, and returns "The party size changed on a {period} booking, so the deposit has been left as it
  is. Check whether it still needs adjusting and handle it manually."

**Required action, in the same change that builds the refund:** amend the decision record with a
superseded-by line naming the 2026-08-04 answer, or delete it. A stale committed decision record is worse
than none, because the next developer will find it and build to it.

### 7.2 But it is not Phase 1

Two questions were being conflated:

| Question | Answer |
|---|---|
| Should the automatic refund exist? | **Yes.** Owner, 2026-08-04 |
| Must it ship for Christmas 2026? | **No** |

It is about **deposits, not pre-orders**. It couples to neither the cover model nor the chase ladder. It
ships on its own schedule, with its own table (`booking_amendments`), its own tests and its own switch
(`preorder_auto_refund_enabled`, created now, defaulting false, gating nothing until the code lands).

The one link it needs is already declared so it is not invented twice:
`booking_preorder_amendments.booking_amendment_id` is nullable in the Phase 1 schema and is set by this
workstream. **Direction ruling:** the pre-order amendment is the parent concept (a party change) and the
money saga is the consequence, so the pointer lives on the pre-order row.
`payment_refunds.booking_amendment_id` continues to point at `booking_amendments`, which is correct: a
refund is a money fact.

**Two amendment tables is deliberate.** One holds the cover-drop plan, the other holds money. Different
lifecycles (a cover plan applies in one transaction; a refund saga can sit in `manual_review` for days),
different retention, different owners.

**Until this workstream ships**, a seasonal party-size change keeps the existing `manual_review`
behaviour and raises one `preorder_alerts` row of type `amendment_manual_review`, severity `warning`, so
the over-collection is on a list rather than in one person's memory. Do **not** reuse `refund_failed` for
it: that type is `critical` and means a refund half happened.

### 7.3 What money means here

**Only one thing is ever charged for a seasonal table booking: the deposit.** Pre-order dish prices are
informational display only. They are never summed, never charged, never part of the deposit, never on a
payment page.

This is not an assumption. The refund policy sentence stored on every seasonal booking ends with these
exact words (SECTION-CLAIMED, `20260803000100_seasonal_booking_periods.sql:465-468`):

> "The deposit comes off the bill on the day."

| Claim | Status |
|---|---|
| The deposit is computed from party size and a period rate, never from dishes (`deposit_basis` is `per_head` or `per_booking` only) | SECTION-CLAIMED |
| `booking_period_menu_items.price_gbp` is **nullable** | SECTION-CLAIMED |
| Nothing in AMS sums menu item prices into any charge | SECTION-CLAIMED, by absence of any `SUM` over `price_gbp` |

**Naming consequence, and it belongs in Phase 1 even though the refund does not.** The selection snapshot
column must not read as an amount owed. Part 1 §10.5 names it `item_price_gbp`; add the comment:

```sql
COMMENT ON COLUMN public.booking_preorder_selections.item_price_gbp IS
  'What booking_period_menu_items.price_gbp read when the guest chose this dish. Display and dispute '
  'evidence only. NEVER charged, never summed into a total, never affects the deposit. The only money '
  'taken before service is the deposit on table_bookings.';
```

Acceptance criteria that follow:

1. No guest-facing screen, email or SMS shows a pre-order **total**.
2. The kitchen sheet may show per-dish prices. It must not show a party total that could be mistaken for a
   bill.
3. Changing a dish price in Settings does not change any existing selection row, does not re-price a
   deposit, and does not trigger a chase or an alert. Only a change to `is_active` or `course` does.
4. **Supplements are not supported in either phase.** A supplement on a fillet steak is a new
   deposit-affecting concept and separate work. Say no now rather than half-build it.

### 7.4 The arithmetic

Five named quantities, all GBP, all `numeric` rounded to 2 places, all derived, all frozen onto the
amendment row at reservation so the number staff were shown is the number that was acted on.

| Name | Definition |
|---|---|
| `target_total_deposit` | What this booking should have collected in total, at the new party size, under **its own frozen terms** |
| `gross_captured` | `COALESCE(table_bookings.deposit_amount_locked, 0)` |
| `completed_refunds` | Money already returned and confirmed, **across both ledgers** |
| `reserved_pending_refunds` | Money promised back but not yet confirmed |
| `remaining_refundable` | `MAX(0, gross_captured - completed_refunds - reserved_pending_refunds)` |

```
net_held      = gross_captured - completed_refunds - reserved_pending_refunds
refund_target = MAX(0, net_held - target_total_deposit)
topup_target  = MAX(0, target_total_deposit - net_held)
```

At most one output is ever positive. `refund_target <= remaining_refundable` holds by construction; adding
a clamp would hide a bug rather than prevent one.

**Why this survives repeated shrinks.** `net_held` is recomputed from the ledgers on every amendment. A
booking that shrank 20 to 12 (refunded) and then shrinks 12 to 8 sees the first refund inside
`completed_refunds`, so the second refund is only the further difference. There is no running total to
drift and no "previously refunded" field to forget.

**`target_total_deposit` reads only the booking's own snapshot columns**, never `booking_periods`:

```sql
CASE
  WHEN b.deposit_rule = 'period' AND b.deposit_basis = 'per_head'
    THEN ROUND(p_new_party_size::numeric * b.deposit_rate, 2)
  WHEN b.deposit_rule = 'period' AND b.deposit_basis = 'per_booking'
    THEN ROUND(b.deposit_rate, 2)
  WHEN b.deposit_rule = 'group'
    THEN ROUND(p_new_party_size::numeric * b.deposit_rate, 2)
  ELSE NULL      -- 'manual', 'waived', 'none' or NULL. Never guessed.
END AS target_total_deposit
```

**The rule is never re-selected. This is the single most important line in §7.** At booking time the
larger of the seasonal and the large-group deposit wins, and only the winner's basis and rate are
snapshotted. Shrinking from twelve to eight may look as though it crosses back under the ten-guest group
threshold, but the losing rule's rate was never recorded, so "which rule applies now" is unanswerable from
the booking and guessable only by reading `booking_periods`, which a manager may have edited since.

A NULL result means "no automatic re-price": `skip_reason = 'unpriceable_rule'`, state `manual_review`.

Required behaviour tests:

- `deposit_rule='group'`, rate 10.00, shrunk 12 to 8: `target_total_deposit = 80.00`. It does **not**
  become 0 because the party is now under ten.
- `deposit_rule='period'`, `per_head`, rate 25.00, shrunk 12 to 8: 200.00.
- `deposit_rule='period'`, `per_booking'`, rate 50.00, shrunk 20 to 6: 50.00 and `refund_target = 0`.
- `deposit_rule='waived'` never reaches the refund path. It goes to `manual_review`.
- Rounding done in SQL `numeric`, not JavaScript floats. Test at £8.33 per head across 3, 7 and 13 covers.

### 7.5 The over-refund waiting in two ledgers

**This is a defect the developer review did not find, and it is a P0 that exists in production today,
independent of this feature.**

Table-booking deposits are captured by **two different providers** and their refunds are recorded in **two
disjoint places**. Neither knows about the other.

| | Capture writes | Refund writes |
|---|---|---|
| **Stripe** | a `payments` row (`charge_type='table_deposit'`, `stripe_payment_intent_id`) plus `deposit_amount_locked` | `payments.status` to `refunded`/`partially_refunded`, `payments.refund_amount` |
| **PayPal** | `table_bookings.paypal_deposit_capture_id` plus `deposit_amount_locked`. **No `payments` row at all** | a `payment_refunds` row |

All SECTION-CLAIMED with line references in `D-payments.md` §2.3. Two live consequences:

1. **Over-refund.** A Stripe-paid booking refunded through `refundTableBookingDeposit` has £0 in
   `payment_refunds`. `reserve_refund_balance` sums only `payment_refunds`, so it believes the whole
   `deposit_amount_locked` is still refundable and would authorise a second, full refund. Nothing blocks
   that today.
2. **Silent no-refund.** `refundTableBookingDeposit` only looks for `stripe_payment_intent_id`. A
   **PayPal-paid** booking cancelled through FOH or BOH returns `{ refunded: false, reason: 'no_deposit' }`
   and no money goes back, with the guest told nothing.

**Consequence 2 is an existing production bug and is out of scope here, but it must be raised as its own
ticket, because a seasonal Christmas cancellation will hit it.**

The arithmetic must read **both** ledgers. One view, used by every consumer:

```sql
CREATE OR REPLACE VIEW public.table_booking_refund_position AS
SELECT
  b.id AS table_booking_id,
  COALESCE(b.deposit_amount_locked, 0)::numeric(10,2) AS gross_captured,
  (COALESCE(pr.completed,0) + COALESCE(sp.completed,0))::numeric(10,2) AS completed_refunds,
  COALESCE(pr.pending, 0)::numeric(10,2)                               AS reserved_pending_refunds,
  GREATEST(0, COALESCE(b.deposit_amount_locked,0)
              - COALESCE(pr.completed,0) - COALESCE(sp.completed,0)
              - COALESCE(pr.pending,0))::numeric(10,2)                 AS remaining_refundable
FROM public.table_bookings b
LEFT JOIN LATERAL (
  SELECT SUM(amount) FILTER (WHERE status = 'completed') AS completed,
         SUM(amount) FILTER (WHERE status = 'pending')   AS pending
  FROM public.payment_refunds r
  WHERE r.source_type = 'table_booking' AND r.source_id = b.id
) pr ON TRUE
LEFT JOIN LATERAL (
  SELECT SUM(COALESCE(p.refund_amount, 0)) AS completed
  FROM public.payments p
  WHERE p.table_booking_id = b.id
    AND p.charge_type = 'table_deposit'
    AND p.status IN ('refunded','partially_refunded')
) sp ON TRUE;
```

**`deposit_amount_locked` is `gross_captured`. `deposit_amount` is not.** `deposit_amount_locked` is
documented immutable once set. `deposit_amount` is the **operational amount owed** and is actively
rewritten by the live party-size code. The review's suspicion that "`deposit_amount` is both a snapshot
and a mutable operational amount" is correct, and this is the resolution.

Stripe contributes nothing to `reserved_pending_refunds`, because the Stripe path writes the refund only
after Stripe returns success. One residual gap: if the Stripe call succeeds and the local update fails,
the function logs a critical audit event (`table_booking.refund_stripe_success_db_failed`) and throws,
leaving money returned and no row. That refund is invisible to this view until someone reconciles it.
§7.11 alerts on that audit event, which closes a real hole that predates this feature.

**Manual cash refunds need no extra work.** `processManualRefund` reserves through the same RPC and sets
the row to `completed`, so it lands in `payment_refunds` and `completed_refunds` already counts it.
**Runbook rule: if you hand money back over the bar, record it as a manual refund in AMS at the time.** An
unrecorded cash refund is the one thing that makes the arithmetic wrong, and no code can detect it.

**Chargebacks are not modelled anywhere.** SECTION-CLAIMED by absence: the only dispute concept in the
codebase is `private_bookings.has_open_dispute`, a manual tick. Recommendation: when the pub loses a
chargeback, staff record it as a manual refund with `refund_method='other'` and a reason beginning
`chargeback:`. That puts the money into `completed_refunds` so the saga stops trying to refund money that
has already left. It is a bookkeeping convention, not a technical constraint: owner and accountant
decision, `OW2`.

### 7.6 The reservation must be idempotent on the amendment

```sql
ALTER TABLE public.payment_refunds
  ADD COLUMN IF NOT EXISTS booking_amendment_id uuid
    REFERENCES public.booking_amendments(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS payment_refunds_one_live_per_amendment_idx
  ON public.payment_refunds (booking_amendment_id)
  WHERE booking_amendment_id IS NOT NULL AND status IN ('pending','completed');
```

Migration order inside one file: create `booking_amendments`, then this column, then the function.

```sql
CREATE OR REPLACE FUNCTION public.reserve_table_booking_refund(
  p_table_booking_id uuid,
  p_amount           numeric(10,2),
  p_reason           text,
  p_amendment_id     uuid,
  p_initiated_by     uuid DEFAULT NULL          -- NULL for a system actor
) RETURNS TABLE(refund_id uuid, remaining numeric(10,2))
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pos      public.table_booking_refund_position%ROWTYPE;
  v_capture  text;
  v_existing public.payment_refunds%ROWTYPE;
  v_new_id   uuid;
BEGIN
  -- SAME lock key as reserve_refund_balance, so the two paths contend rather than race.
  PERFORM pg_advisory_xact_lock(hashtext('table_booking:' || p_table_booking_id::text));

  -- Idempotency, checked INSIDE the lock so two workers cannot both miss it. A retry after a
  -- crash must get the SAME row and the SAME paypal_request_id, never a second reservation.
  SELECT * INTO v_existing FROM public.payment_refunds
   WHERE booking_amendment_id = p_amendment_id AND status IN ('pending','completed') LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT v_existing.id, NULL::numeric(10,2);
    RETURN;
  END IF;

  SELECT * INTO v_pos FROM public.table_booking_refund_position
   WHERE table_booking_id = p_table_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Table booking % not found', p_table_booking_id USING ERRCODE = '22023';
  END IF;

  IF p_amount > v_pos.remaining_refundable THEN
    RAISE EXCEPTION 'Amount %.2f exceeds refundable balance %.2f',
      p_amount, v_pos.remaining_refundable;
  END IF;

  SELECT paypal_deposit_capture_id INTO v_capture
    FROM public.table_bookings WHERE id = p_table_booking_id;
  IF v_capture IS NULL THEN
    RAISE EXCEPTION 'Booking % has no PayPal capture to refund. See spec 7.8.',
      p_table_booking_id USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payment_refunds (
    source_type, source_id, paypal_capture_id, paypal_request_id,
    refund_method, amount, original_amount, reason, status,
    initiated_by, initiated_by_type, booking_amendment_id)
  VALUES (
    'table_booking', p_table_booking_id, v_capture, gen_random_uuid(),
    'paypal', p_amount, v_pos.gross_captured, p_reason, 'pending',
    p_initiated_by, CASE WHEN p_initiated_by IS NULL THEN 'system' ELSE 'staff' END,
    p_amendment_id)
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT v_new_id, (v_pos.remaining_refundable - p_amount)::numeric(10,2);
END;
$$;
```

A NULL `remaining` means "this reservation already existed, nothing was recomputed". **The caller must
treat that as success, not as an error.**

**Why the amendment id is not decoration.** Without it, a durable worker retrying after a crash would
reserve twice. On a **partial** refund the second reservation still fits under the ceiling, so two rows
with two different `paypal_request_id` values would each reach PayPal and the guest would be paid twice.
It is the idempotency key, and it needs a column and a unique index, not a convention.

Two schema facts that make the system actor legal, both SECTION-CLAIMED:
`payment_refunds.initiated_by` is nullable, and `initiated_by_type` already accepts `'system'`. The
existing `reserve_refund_balance` hardcodes `'staff'`, which is why a new wrapper is needed rather than a
new argument on the old one. **Do not add a second reservation mechanism.**

### 7.7 The saga

A provider call cannot join a Postgres transaction. Both failure directions are real: provider fails after
the database succeeded (the guest holds a smaller table and is owed money), or the provider succeeds and
the database fails (money has gone back and the booking still says twenty).

The live code already chose an order. SECTION-CLAIMED: the FOH party-size route saves the party size
first, then runs the deposit transition, and if the deposit part throws it returns **200 with a warning**,
not an error. **Keep that order.** The operational fact must be right for service, because the kitchen and
the table plan depend on it.

> **The compensating action for a failed refund is not "undo the party size". It is "raise a visible,
> assigned task naming the exact amount owed."** The saga's compensation is human, and it must be
> impossible to miss.

`booking_amendments` states: `reserved`, `applied`, `settling`, `settled`, `manual_review`, `superseded`.
**There is deliberately no `failed`.** Every failure route ends at `manual_review`, because a failure with
money involved always needs a person. A value nothing ever writes is a trap for the next developer.

Two indexes carry the concurrency guarantees:

```sql
-- Only one amendment in flight per booking. A second attempt gets a unique violation, which the
-- route maps to 409 "Someone else is changing this booking. Refresh and try again."
CREATE UNIQUE INDEX booking_amendments_one_in_flight_idx
  ON public.booking_amendments (table_booking_id)
  WHERE state IN ('reserved','applied','settling');

-- Drives the durable worker sweep and the alert digest. 'applied' is in the list because an
-- amendment whose request died before the money step started is exactly what the sweep must find.
CREATE INDEX booking_amendments_open_money_idx
  ON public.booking_amendments (state, created_at)
  WHERE state IN ('applied','settling','manual_review');
```

`manual_review` is deliberately **not** in the in-flight list. A booking can sit there for days while a
manager chases a refund by hand, and staff must still be able to change the party size meanwhile. That is
safe because §7.4 recomputes from the ledgers every time: money that has not gone back is still inside
`net_held`.

**Ordering, precisely:**

```
1. BEGIN
2.   pg_advisory_xact_lock(hashtext('table_booking:' || booking_id))
3.   SELECT the booking FOR UPDATE, plus table_booking_refund_position
4.   Compute the five quantities and both targets
5.   Apply the transition matrix (§7.9). Any 'refuse': ROLLBACK, 409, no row written.
6.   INSERT booking_amendments (state='reserved')     -- the unique index blocks a concurrent second
7.   UPDATE table_bookings SET
        party_size / booking_date = the new value,
        deposit_amount            = target_total_deposit, or left alone when it is NULL,
        -- deposit_amount_locked is NEVER written here. Only a capture webhook writes it.
      plus the pre-order cover work, in the same transaction
8.   UPDATE booking_amendments SET state='applied', applied_at=now()
9. COMMIT
--- the database transaction ends here. Everything below is outside it. ---
10. Choose the provider (§7.8). Stripe or ambiguous: state='manual_review', stop.
11. If refund_target > 0 and not skipped:
      reserve_table_booking_refund(..., p_amendment_id)   -- own short transaction, same lock key
      store payment_refund_id, set state='settling'       -- same transaction as the reserve
      call PayPal with the reserved row's paypal_request_id as the idempotency key
12. If topup_target > 0: issue the payment link (§7.10), set state='settling'
13. Otherwise: state='settled'
```

Step 7 sits inside the same transaction as step 6 deliberately: the pre-order cover changes and the
party-size change must not be able to disagree, and both are pure database work. Step 7 writes
`deposit_amount` and not `deposit_amount_locked`, because leaving `deposit_amount` stale after a shrink
would make every staff screen quote the old party's deposit on an unpaid booking.

**Retry safety: never mint a new idempotency key on retry.** A retry reuses the existing `pending`
`payment_refunds` row and its stored `paypal_request_id`, enforced by the amendment-scoped unique index
and the early return in §7.6, not by convention, because a durable worker retries without a human
deciding to.

**What runs step 11 if the request dies:** a durable worker, not the HTTP request.

| Picked up when | Because |
|---|---|
| `state='applied'`, a target is positive, `skip_reason IS NULL`, older than 60 seconds | The request died before the money step started |
| `state='settling'`, `payment_refund_id IS NULL`, older than 60 seconds | The reservation ran but the amendment write did not. The early return makes re-running safe |
| `state='settling'` with a `pending` `payment_refunds` row older than 6 hours | PayPal has it, the webhook has not arrived |

A worker crash between steps therefore costs a delay, never a lost refund and never a double one.

**Skip reasons, and where each one lands:**

| `skip_reason` | State | Why |
|---|---|---|
| `inside_refund_cutoff` | `settled` | The terms were kept. Nothing is owed |
| `never_refundable` | `settled` | Same |
| `nothing_captured` | `settled` | The amendment simply reduces what is owed on an unpaid booking |
| `no_change` | `settled` | |
| `unpriceable_rule` | `manual_review` | The deposit was set by hand |
| `provider_window_expired` | `manual_review` | Money is owed and automation cannot return it |
| `stripe_capture_not_automated` | `manual_review` | Same |

**Why four of the seven settle rather than queue.** `manual_review` means "money may be owed and a person
must act". The first four are the opposite. Queueing them would put every inside-cutoff Christmas shrink
into the manual queue, which is most of them in the last fortnight, and a queue that is mostly noise stops
being read. The skip reason is still recorded and still shown in the staff panel, so nothing is hidden.

### 7.8 Which provider, and the 180-day window

**Which provider a given seasonal booking will use is UNKNOWN from the repo. Both paths are live off the
same guest token today.** The saga must read it off the booking, never assume it.

| Booking state, checked before any money call | Behaviour |
|---|---|
| `paypal_deposit_capture_id IS NOT NULL` | PayPal. Refund automatically |
| `paypal_deposit_capture_id IS NULL` and a succeeded `table_deposit` `payments` row with a `stripe_payment_intent_id` exists | **No automatic refund.** `skip_reason='stripe_capture_not_automated'`, `manual_review` |
| Neither | `skip_reason='nothing_captured'`, `settled` |
| **Both** | Ambiguous. `manual_review` **and an immediate alert.** Two captures on one booking is a data problem, not a refund to guess at |

**Why Stripe is not automated, stated plainly rather than hidden.** The one Stripe refund function that
exists refunds a **cancellation tier**, not an arbitrary amendment difference, and its idempotency key is
`tbl-refund-${payment.id}-${tier}`, which has no room for a second, different refund on the same payment.
Reusing it for a shrink would either refund the wrong amount or silently collide with a later
cancellation refund.

**Developer action before this workstream is scoped, and it is one query:** count the table bookings in
the last 12 months with a succeeded Stripe `table_deposit` payment and no PayPal capture id. Near zero
means `manual_review` is the right answer. A material number means a correct partial Stripe refund path
joins the scope. **Do not guess this.** Register item `U18`.

**The expired-capture fallback, checked before calling PayPal, in this order:**

| Condition | Result |
|---|---|
| `deposit_amount_locked IS NULL` | `nothing_captured`, `settled` |
| Stripe, or both providers appear | `stripe_capture_not_automated`, `manual_review` |
| `card_capture_completed_at` older than 180 days | `provider_window_expired`, `manual_review` |
| **`card_capture_completed_at IS NULL` on a booking that has a PayPal capture id** | Treat as expired: `provider_window_expired`, `manual_review`. The existing `isCaptureExpired` returns **false** for a null date, which would let an arbitrarily old capture through. **The saga must not inherit that** |
| PayPal rejects for any reason | `manual_review`, `failure_reason` = the provider message |

Two corrections to how the review framed the 180 days, both material:

1. **The clock runs from the capture, not from the booking date.** A deposit captured on 15 May 2026 and
   amended on 20 November 2026 is 189 days old and would be refused. That is realistic for Christmas, so
   the manual fallback is required, not optional.
2. **The 180 days is our own hardcoded constant, not a verified PayPal account limit.** What the live
   merchant contract permits is **UNKNOWN**. Confirm it. If the real window is shorter, our check passes
   and PayPal rejects, which lands in `manual_review` and is handled. If it is longer, we refuse refunds we
   could have made.

**The system refund service follows the pattern that already exists.** SECTION-CLAIMED:
`refundTableBookingDeposit` performs a real refund with no authenticated user, called from three staff
routes that do their own route-level permission check first. So **authority is proven at the route and the
money function trusts its caller**:

```ts
// src/lib/table-bookings/amendment-refund.ts
export async function settleAmendmentRefund(input: {
  amendmentId: string
  // No userId. Authority was proven by whoever created the amendment, and is recorded on it.
}): Promise<SettleResult>
```

The audit row carries `user_id: null`, `initiated_by_type: 'system'`, plus the amendment id and
correlation id, so "who did this" is answerable as "the amendment that staff member X requested at time
T". **Do not grant a service account a Supabase auth user to satisfy `getAuthenticatedUser`. That creates
a login that can refund money, which is worse than the problem.**

### 7.9 The conflict nobody spotted: the seasonal promise blocks the shrink refund

**This is a P0 and it is an owner decision (`OW1`).**

There is already an enforced promise on every seasonal booking, and inside its window it says no refund at
all. SECTION-CLAIMED: `enforceSeasonalRefundPolicy` is applied to both `processPayPalRefund` and
`processManualRefund`, reads `deposit_refund_cutoff_days` off the booking, refuses the refund unless the
caller supplies `overrideRefundPolicy: true` plus a written reason, and **fails closed** if the snapshot
cannot be read.

The stored promise reads, word for word:

> "Full refund up to %s days before the booking date. Inside %s days the deposit is not refunded, though
> a manager may waive that. The deposit comes off the bill on the day."

So an automatic shrink refund seven days before Christmas dinner on a 14-day-cutoff period would be
refused by the existing guard.

**Recommendation: apply the same cutoff to a shrink. Inside the window, no automatic refund.** In one
line: a shrink is a partial cancellation, and if it is exempt then anyone can book twenty, pay, shrink to
six the day before and recover seventy per cent, which defeats the cutoff entirely.

| When the shrink happens | Automatic refund | Staff see |
|---|---|---|
| `days_before >= deposit_refund_cutoff_days` | Yes, `refund_target` | "£X refunded automatically" |
| `days_before < deposit_refund_cutoff_days` | **No**, `skip_reason='inside_refund_cutoff'`, `settled` | The §7.11 sentence |
| `deposit_refund_cutoff_days = 0` | **No**, never refundable | Same, never-refundable wording |
| `deposit_refund_cutoff_days IS NULL` (non-seasonal) | Yes | Unchanged behaviour |

**The system never sets `overrideRefundPolicy`. Only a named human does**, and the existing code already
records who and why.

If the owner rejects the recommendation, that is implementable, but it must be a deliberate carve-out for
`initiated_by_type='system'` **and** the guest-facing refund sentence must be rewritten to say so. **Do
not let a system override sneak in without the published wording changing, or the pub is enforcing terms
it does not publish.**

**Period transitions.** Owner answer O2 refuses a move out of the period, enforced by the composite
`ON UPDATE RESTRICT` plus one date guard. D's proposed second trigger
(`table_bookings_period_date_guard` / `assert_accepted_period_booking_stays_in_period`) is **not built**;
Part 1 §11.4 is the single guard. The full transition matrix is in `D-payments.md` §6.3 and is adopted
unchanged, with these outcomes: moving out of the period, to a different period, or changing the seasonal
answer are all **refused**, cancel and rebook. Moving within the same period is **allowed** and recomputes
the chase points. A date moving into a live period is **allowed but never auto-accepted**: a guest who
booked an ordinary table on 3 November and moved to 20 November has not agreed to a Christmas menu, has
not been quoted a deposit and has not been told a refund policy. Auto-accepting would create a debt they
never agreed to.

One check the create path never needed: a party-size amendment must read `min_party_size` and
`max_party_size` from `booking_periods` **by the booking's own `booking_period_id`**, not by date. **If
the period row cannot be read at all, skip the check and allow the amendment.** Refusing would freeze
every past seasonal booking the moment its period row became unreadable, which is worse than letting a
party of two through in January. This is the one place the design deliberately reads live period config,
and it is safe because it is a capacity rule, not a money rule: it can never change what the guest is
charged.

### 7.10 Party growth: the payment link (O3)

O3 is binding: **a payment link, never an automatic further charge.** Taking more money from a saved
method without fresh authorisation is a different consent question from refunding.

**The trap in naive reuse.** SECTION-CLAIMED: the existing payment page prices itself with
`getCanonicalDeposit`, which returns `deposit_amount_locked` **first**. On a booking that has captured
£200 and needs £100 more, the link would quote **£200**. It would also be blocked earlier, because the
preview refuses unless the booking is `pending_payment`, and a paid booking is neither.

**Do not widen `getCanonicalDeposit`.** It is load-bearing for capture, cancellation and the deposit
timeout cron.

| Element | Decision |
|---|---|
| Route | `/g/<token>/table-topup`, new. **No middleware change needed:** `'/g'` is already a public prefix |
| Token | `guest_tokens` with a new `action_type = 'topup'`. `customer_id` is `NOT NULL` there and the booker is a real customer, so it is satisfied. **This is not the pre-order token:** under O1 those live in their own table, precisely so `guest_tokens` never has to accept a row with no customer |
| Token migration | `guest_tokens_action_type_check` is a closed list. Adding `'topup'` needs a migration that drops and recreates it with the full current list plus the new value. **This migration belongs to this workstream and must not creep into the pre-order migrations**, which touch `guest_tokens` not at all |
| Amount | `booking_amendments.topup_target`. Never recomputed on the page. If the amendment is no longer `settling`, the page refuses |
| Expiry | The lesser of 48 hours and the booking's start time, stored on `payment_link_expires_at` |
| On capture | The webhook **adds** the captured amount to `deposit_amount_locked` and sets the amendment `settled`. `deposit_amount_locked` becomes a running captured total. **Update its column comment**, because today it says otherwise |
| The second capture id | The top-up capture **must not overwrite** `paypal_deposit_capture_id`. That column names the capture a refund is issued against, and PayPal will not refund more against a capture than it took. Overwriting a £300 capture id with a £50 top-up id would cap every later refund at £50 with a rejection that looks like a fault. Store it separately, keyed to the amendment |
| Refunds after a top-up | A booking with two captures can owe back more than either holds. Refund **per capture**: the original first, then the top-up, and send any shortfall to `manual_review`. §7.6's wrapper handles one capture and must be widened as part of this |
| Booking status | **Stays `confirmed`.** Do not move a paid booking back to `pending_payment` |
| Table held? | **Yes.** The larger party is the recorded fact from the moment the amendment applies |
| Unpaid at expiry | `manual_review`. The party size is **not** rolled back automatically. Staff ring the guest, then either shrink back (a new amendment) or waive with a recorded reason |
| Reminders | One, 24 hours after issue, SMS and email to the booker. **Counted separately from the pre-order four-occasion cap** |

**Repeated grow and shrink needs no special cases**, because `net_held` is always recomputed. Make this
exact sequence a test. It is the cheapest possible proof that no running total has drifted.

| Step | `gross_captured` | `completed_refunds` | `net_held` | `target` | Action |
|---|---|---|---|---|---|
| Book 12 at £25/head, paid | 300.00 | 0 | 300.00 | 300.00 | none |
| Shrink to 8 | 300.00 | 0 | 300.00 | 200.00 | refund £100 |
| Refund completes | 300.00 | 100.00 | 200.00 | 200.00 | none |
| Grow to 10 | 300.00 | 100.00 | 200.00 | 250.00 | top-up link £50 |
| Top-up captured | 350.00 | 100.00 | 250.00 | 250.00 | none |
| Shrink to 6 | 350.00 | 100.00 | 250.00 | 150.00 | refund £100 |

### 7.11 What people are told

**The guest is told only about money that actually moved.**

| Event | Guest gets | Channel |
|---|---|---|
| Refund `COMPLETED` | "We have refunded £X to the card you paid with. It usually shows within 5 working days." | SMS, plus email |
| Refund `PENDING` at PayPal | **Nothing yet.** A "pending" message invites a phone call about money they cannot see | none |
| Pending resolves to completed | The completed message | as above |
| Pending resolves to failed | **Nothing automatic.** `manual_review`, and a person calls | none |
| Skipped, inside the cutoff | "Your booking is now for N guests. As set out when you booked, the deposit is not refunded this close to the date, and it still comes off your bill on the day." | SMS and email |
| Skipped, nothing captured | "Your booking is now for N guests. The deposit due is £Y." | SMS |
| Top-up needed | "Your booking is now for N guests. £X more deposit is due: {link}" | SMS and email |
| `manual_review` for any reason | **Nothing automatic.** A person calls | none |

**Never send a guest an automated message about a refund that failed.** It creates an expectation and
tells them nothing they can act on. Reuse the existing `sendRefundNotification`; do not write a second one.

**Staff sentences go in the code as constants and in the tests as assertions, so they cannot drift.** Each
names the amount, says the party size **was** saved, and gives a next action.

| State | Sentence |
|---|---|
| `settled`, no money | "Party size saved. The deposit is unchanged at £{amount}." |
| `settling`, refund | "Party size saved. We are refunding £{amount}. It will show as completed here shortly." |
| `settled`, refunded | "Party size saved. £{amount} refunded on {date}." |
| `settling`, pending at PayPal | "£{amount} refund started. PayPal has not confirmed it yet, so do not refund again." |
| `settling`, top-up | "Party size saved. A payment link for £{amount} has been sent to {name}. It expires {when}." |
| `settled`, inside cutoff | "Party size saved. Under the terms this guest was given, the deposit is not refundable within {n} days of the booking. A manager can still refund it from the booking page and must give a reason." |
| `manual_review`, window expired | "Party size saved. £{amount} is owed back but the payment is more than 180 days old, so it cannot be refunded through PayPal. Refund it by hand and record it here." |
| `manual_review`, Stripe capture | "Party size saved. £{amount} is owed back, but this deposit was taken by card through Stripe, which we do not refund automatically. Refund it from Stripe and record it here as a manual refund." |
| `manual_review`, provider refused | "Party size saved. PayPal refused the £{amount} refund: {reason}. Refund it by hand and record it here." |
| `manual_review`, unpriceable rule | "Party size saved. This booking's deposit was set by hand, so it has been left as it is. Check whether it still needs adjusting." |
| `manual_review`, arithmetic mismatch | "Party size saved. The refund could not be worked out because the payments on this booking do not add up. A manager needs to look before any money moves." |
| Provider succeeded, local write failed | "£{amount} was refunded at PayPal but our record may not have saved. Refresh this page and check the refund history before refunding again." |

**Staff view.** An **Amendments** panel on the booking detail, newest first: when, who, what changed, the
five quantities, the outcome, and a link to the `payment_refunds` row. This is what stops a second staff
member repeating a refund that already worked.

**Alerts. Fifteen minutes is not fast enough for all of them.**

| Condition | Route | Why |
|---|---|---|
| Amendment in `manual_review` | 15-minute digest | A person will act today, not this minute |
| Top-up link expired unpaid | 15-minute digest | Not urgent |
| Refund `settling` for more than 6 hours | 15-minute digest | PayPal pending can legitimately take hours |
| **Provider succeeded, local write failed** | **Immediate, its own email** | Money has left and our records disagree. Every minute is a minute somebody might refund again |
| **`reserve_table_booking_refund` raised "exceeds refundable balance"** | **Immediate** | Either a real over-refund or a ledger bug. Both need looking at now |
| **One booking with both a PayPal capture id and a succeeded Stripe deposit** | **Immediate** | The guest may have paid twice |
| **A `table_booking.refund_stripe_success_db_failed` audit event** | **Immediate** | Stripe returned the money and our record did not save. **Pre-dates this feature and is invisible today.** One line of the digest query closes a real hole |

**UNKNOWN, and an owner action:** whether the live PayPal account is subscribed to
`PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.REFUND.PENDING` and `PAYMENT.REFUND.FAILED` for the table-bookings
webhook. The handler exists; the subscription is dashboard configuration. **Confirm before go-live.** If
it is not subscribed, every pending refund stalls in `settling` until the 6-hour sweep.

### 7.12 Tests for this workstream

Unit, pure:

1. `target_total_deposit` for each `deposit_rule` and `deposit_basis`, including the group-rule shrink from
   12 to 8 staying at £80.
2. Rounding at £8.33 per head across 3, 7 and 13 covers, in `numeric` not float.
3. Both targets across the full grow-shrink table in §7.10.
4. `refund_target = 0` when `net_held <= target_total_deposit`.
5. `refund_target` never exceeds `remaining_refundable`, property-tested over random ledgers.

Database:

6. Two concurrent amendments on one booking: exactly one succeeds, the other gets a unique violation.
7. `reserve_table_booking_refund` and `reserve_refund_balance` serialise on the shared advisory lock.
8. **A Stripe refund recorded in `payments` reduces `remaining_refundable`. This test fails today, and
   proving that first is the point.**
9. A manual cash refund reduces the next `refund_target`.
10. **Calling `reserve_table_booking_refund` twice with the same `p_amendment_id` returns the same
    `refund_id` and creates exactly one `payment_refunds` row**, for a partial amount that would otherwise
    fit under the ceiling twice. Without the idempotency this test refunds the guest twice.
11. An amendment with `requested_by_type='guest'` and `requested_by IS NULL` saves.
12. Step 7 writes `deposit_amount = target_total_deposit` and leaves `deposit_amount_locked` untouched.
13. A booking whose only capture is Stripe produces `stripe_capture_not_automated`, `manual_review`, and
    **never calls PayPal**.

Provider sandbox:

14. One test per state transition: `COMPLETED`, `PENDING` then webhook `COMPLETED`, `PENDING` then webhook
    `FAILED`, outright rejection.
15. Retry after a simulated worker crash between reservation and the PayPal call sends the **same**
    `PayPal-Request-Id` and results in exactly one refund.
16. A capture dated 181 days ago, and a capture with a NULL `card_capture_completed_at`, both produce
    `provider_window_expired` and never call PayPal.
17. Provider 2xx with the local update forced to fail leaves the row `completed` or `pending`, never
    `failed`, and raises the immediate alert.

End to end:

18. Christmas booking, 12 covers, £25 per head, PayPal, shrunk to 8 twenty days out on a 14-day cutoff:
    £100 refunded, guest messaged, panel shows it.
19. The same booking shrunk 7 days out: no refund, `inside_refund_cutoff`, state `settled` **not**
    `manual_review`, both the guest and the staff sentences match word for word.
20. The same booking shrunk twice: £100 then £50, never £150 total.
21. A date move from 15 December to 15 January: refused, exact sentence, no money moves.

---

## 8. Activation and readiness

### 8.1 The problem, restated precisely

SECTION-CLAIMED and verified in `src/lib/table-bookings/periods.ts`: a period is offerable when it is not
archived, is active, covers the date, and, when `requiresPreorder` is true, has `menuReady` true.
`menuReady` is derived from active rows in `booking_period_menu_items`. **So today, inserting the first
active menu row into a live period is what makes the seasonal journey purchasable.** That is a content
action performed in Settings by a manager. It must not be the switch that turns on a distributed feature
spanning two repos, seven crons, an SMS provider and a payment path.

### 8.2 Four switches, one master

Part 1 §12.3 is the contract. Restated here because activation is this part's responsibility.

| Key | Default | Gates | Phase |
|---|---|---|---|
| `preorder_module_enabled` | `false` | **Master.** When false the other three are ignored and treated as false | 1 |
| `preorder_collection_enabled` | `false` | Whether choices may be saved by anyone, guest or staff | 1 |
| `preorder_chases_enabled` | `false` | Whether any outbound message is queued **or sent** | 1 |
| `preorder_auto_refund_enabled` | `false` | Whether an amendment refund is issued automatically. Gates nothing until the §7 workstream lands. Create the key now so the switch exists before the code | Separate |

Implementation rules, every one mandatory:

1. Every switch is read **server-side**. No client is trusted for any of them.
2. `preorder_module_enabled` is the master, so a manager cannot half-arm the feature by flipping one.
3. Each switch **fails closed** on read error. Note this explicitly in the code comment, because the
   existing `booking_period_deposits_enabled` deliberately fails **open** and the next reader will
   otherwise "fix" the inconsistency.
4. Switching `preorder_chases_enabled` off must stop **pending** rows sending, not just stop new ones
   being created. **Implement as a check at claim time, per row.** This is the rule everybody misses.
5. Every flip is audit-logged with the actor.
6. When `preorder_module_enabled` is false but a period has `requires_preorder = true` and a published
   menu, the period is **still offerable**: guests can book the seasonal meal, they are simply not asked
   for choices yet. **This is what lets the menu be published on schedule in October without the
   pre-order journey being ready.** Staff see a banner naming the reason.
7. Read through the existing `public.get_setting_bool(key, default)`. Register the four keys in
   `table_booking_settings_keys('preorders')` and insert one `settings_revisions` row for the section,
   matching migration `20260803000100`.
8. **Who may flip them:** `checkUserPermission('settings','manage')`, which already gates the whole
   table-bookings settings screen. **Do not invent a `preorders` RBAC module for four booleans.**

**Withdrawn mechanisms, so nobody builds them:** `SUSPEND_PREORDER_SMS` and `PREORDER_OUTBOX_ENABLED` are
env vars and an env var needs a deploy to flip. Both are replaced by `preorder_chases_enabled`. The
pre-existing `SUSPEND_ALL_SMS` and `SUSPEND_EVENT_SMS` stay as they are; note that pre-order chases carry
`table_booking_id`, so `SUSPEND_EVENT_SMS` blocks them too. **That is documented behaviour, not a bug**,
and it is why the dedicated switch exists.

**Where each component checks:** Part 1 §12.3.1 has the mandatory per-component table. A component with no
check is a bug. The **one deliberate exception is the retention cron**, which checks nothing: turning the
feature off must not stop deletion of data already collected.

### 8.3 The preflight checklist

Activation means setting `preorder_module_enabled` to true. It is gated by a checklist that a **named
person** signs. Every line is a yes or no with evidence attached, not a judgement.

| # | Check | Evidence required |
|---|---|---|
| 1 | AMS production is running the release named in the manifest | `vercel ls` shows the production alias on the manifest SHA. **A push is not a deploy** |
| 2 | Website production is running the release named in the manifest | Same |
| 3 | Every migration in the manifest is applied to production | `list_migrations` includes each version |
| 4 | Generated types regenerated and committed | `src/types/database.generated.ts` contains the new tables. **It is known to go stale in this repo**, so this is inherited work, not work this feature causes |
| 5 | Every pre-order cron is scheduled in `vercel.json` | **`vercel.json` is the source of truth. Creating a route directory is not scheduling a cron.** Precedent: `src/app/api/cron/sunday-preorder/` exists and is absent from `vercel.json`, correctly, because it is a retired stub |
| **5b** | **The website UI flag that selects the live booking journey has a known production value** | **The most easily missed check.** `SELECT value FROM public.system_settings WHERE key = 'website_ui_flags';` Write the value into the manifest. See §10.3 |
| 6 | Each cron has run at least once in production and persisted a result | A `cron_run_results` row via `persistCronRunResult`. **VERIFIED:** `src/lib/cron-run-results.ts` exports `persistCronRunResult` and `recoverCronRunLock` |
| 7 | A test SMS and a test email delivered end to end in production to a staff number | Provider message id recorded |
| 8 | `CRON_ALERT_EMAIL` is set and a test alert arrived | **VERIFIED:** `.env.example:108` sets `CRON_ALERT_EMAIL=manager@the-anchor.pub` |
| 9 | **The kitchen output has been printed, shown to the kitchen, and they have said it is usable** | Named person, date. **This is the acceptance gate and it is not a developer sign-off** |
| 10 | Staff entry and correction demonstrated on a real booking in production | |
| 11 | The privacy notice names pre-order data, including dietary text | The wording is legal's (L5), not the developer's |
| 12 | The backfill dry run has been produced, reviewed and reconciled, and the §9.4 query returns zero rows | |
| 13 | Deployment rollback has been rehearsed against the previous release, with the elapsed time recorded | |
| 14 | Menu content complete: every course the owner intends, every price, every allergen field | Content, not code |
| 15 | The period's `preorder_cutoff_days`, `preorder_cutoff_hour_local`, `chase_anchor`, `chase_offsets_days`, `min_party_size`, `max_party_size` and `min_notice_hours` reviewed against the current menu | Seeded values: cutoff 7 days, min party 6, max party 20, min notice 24 hours. `OB5` |

### 8.4 Activation order

```
1. preorder_module_enabled     -> true    (nothing user-visible changes)
2. preorder_collection_enabled -> true    (the booker is now asked; watch for 24 hours)
3. Backfill dry run, reconcile, then commit the call list
4. preorder_chases_enabled     -> true    (reminders start)
5. preorder_auto_refund_enabled-> LEAVE FALSE until the §7 workstream ships
```

**Each step reverses in one click, with no deploy.** That is the whole point of §8.2.

### 8.5 Contingency

**If Phase 1 is not green by 20 October 2026, do not activate.** The fallback is: publish the menu,
activate the period so the deposit and the seasonal question work, and take pre-orders on paper as the pub
does today, leaving `preorder_module_enabled = false`.

**The fallback is not free of deploys**, and this correction matters. Only the AMS half is on `main`. The
guest-facing seasonal question lives on the website branch `work/outstanding-book-table-2026-08-03`, which
is **not merged** (§10.1). So the fallback needs:

1. The website branch merged and deployed, with the production alias verified.
2. The Christmas period's `is_active` flipped from its seeded `false` to `true`.
3. At least one active row in `booking_period_menu_items`, or the period is not bookable at all.

Do those three and a guest can book and pay a per-head deposit for a Christmas table with no pre-order
system in existence. **Prove that path works well before 20 October rather than discovering the merge is
missing on the day. Decide on 20 October, not on 9 November.**

---

## 9. Backfill of bookings that already exist

### 9.1 What the numbers say

Verified in production on 2026-08-04 by G, against project `tfcasgxopxegwrabvwat`:

```sql
-- Re-run this on the morning of activation.
SELECT count(*)                                                   AS in_window,
       count(*) FILTER (WHERE party_size >= 6)                    AS meets_seasonal_minimum,
       count(*) FILTER (WHERE booking_period_id IS NOT NULL)      AS already_seasonal,
       coalesce(sum(party_size) FILTER (WHERE party_size >= 6),0) AS covers_at_risk
FROM public.table_bookings
WHERE booking_date BETWEEN '2026-11-10' AND '2026-12-20'
  AND status IN ('confirmed','pending_payment');
```

Result on 2026-08-04: `in_window = 1`, `meets_seasonal_minimum = 0`, `already_seasonal = 0`,
`covers_at_risk = 0`. Zero bookings anywhere carry `booking_period_id` or `booking_type = 'christmas'`.

**The population is empty today and will not stay empty.** The period runs from 10 November, the menu is
expected in October, and the 2026 run rate is 56 to 104 bookings a month, of which 2 to 13 are party 6 or
more.

### 9.2 The constraint that decides the whole design

The Christmas 2026 period is seeded `is_active = false` (SECTION-CLAIMED, `20260803000100` line 1099).
While it is inactive, the periods endpoint never mentions it, the guest is never asked the seasonal
question, no seasonal deposit is quoted, and `booking_period_id` is never stamped.

**Therefore every booking now sitting in the Christmas window was taken on normal terms.** Those guests
did not agree to a set menu, did not accept a pre-order obligation and did not pay a per-head deposit.

It follows that the backfill **must not convert them**. Retro-stamping `booking_period_id` onto a booking
whose guest was never asked would rewrite the commercial terms of a booking already taken, which is
exactly what the deposit-snapshot design exists to prevent and exactly why O2 refuses a silent move.

**The backfill produces a call list, not a conversion.** A manager rings each guest, asks whether they
want the festive menu, and if so cancels and rebooks, or amends through the normal staff path so the terms
and deposit are set deliberately.

### 9.3 The job

An AMS server action plus a staff route, **not a cron**. Managers run it deliberately.

**Eligibility.** All of these must hold:

| # | Rule |
|---|---|
| B1 | `booking_date` falls within the period's `starts_on` to `ends_on` inclusive |
| B2 | `status IN ('confirmed','pending_payment')` |
| B3 | `booking_period_id IS NULL` (already-seasonal bookings are reconciliation items, not candidates) |
| B4 | `party_size` between the period's `min_party_size` and `max_party_size` |
| B5 | The booking has a food element, not drinks only |
| B6 | `booking_date >= today` |

Bookings failing **B4 only** are reported separately as "below the seasonal minimum", because that is a
policy question the owner may want to revisit, not a data problem.

**Modes.**

```
GET  /api/boh/table-bookings/preorder-backfill?period=christmas-2026&mode=dry_run
       -> report only, writes no booking
POST /api/boh/table-bookings/preorder-backfill
       { period, mode: 'commit', approved_by, candidate_fingerprint }
```

Both sit under `/api/boh/` and use `requireBohTableBookingPermission('manage')`, like every other staff
route in this feature, rather than inventing a third route shape. The POST takes `Idempotency-Key`.
Registered in Part 2 §7.3 and §7.6.8.

**There is no `preorder_backfill_runs` table.** G's design stored `customer_name` in a table with no
retention rule at all; consolidating it away removed a personal-data store nobody had scheduled for
deletion. Instead:

- `dry_run` writes **one `preorder_alerts` row**, type `backfill_candidates`, severity `info`, holding
  **counts and a candidate-set fingerprint only, no names**.
- The call list itself is **generated live as a CSV** from the deterministic eligibility query when a
  manager opens it. It is never stored.
- `commit` refuses unless it is given a fingerprint from a report generated in the **last 24 hours** whose
  candidate set still matches. If a booking has been created, cancelled or amended since, the commit
  **fails** and asks for a fresh dry run. **That is the manager-approval gate.**
- `commit` writes **no change to any booking**. It creates the call-list tasks and the manager alert.
  **Say that in the UI in one sentence, because "commit" implies more than it does.**
- Idempotency: running commit twice produces the same call list, not two.

**The CSV columns:** `booking_reference`, `booking_date`, `booking_time`, `party_size`, `customer_name`
(the booker only, since no other names exist at this stage), `deposit_status`, `days_until_service`,
`outcome` (`to_call`, `called_accepted`, `called_declined`, `unreachable`, `no_action`). Totals at the
top: candidates, covers, of which inside the cutoff, of which under the minimum, of which already
seasonal.

**First-message timing.** **No automatic message is ever sent to a backfilled booking.** A guest who booked
in August on normal terms must not receive an unexplained text in October about a menu they never chose.
The first contact is a phone call from a person. This also settles the review's question about whether
existing booker data may be used for the first service message: it may not, because it is not the same
service.

### 9.4 The reconciliation query, corrected

**`booking_preorder_covers` has `contact_id`, `order_id` and `booking_period_id`. It deliberately has no
`table_booking_id`.** G's reconciliation query, G's dashboard counter and G's `covers_mismatch` critical
alert all join on that non-existent column, and G.9.4 creates an index on it. **All four are corrected
here.** The join goes through the order.

```sql
-- Any booking that thinks it is seasonal but whose live covers do not sum to the party size.
-- This ONE query is the preflight check, the dashboard counter and the covers_mismatch alert.
-- Reuse it, do not rewrite it in three places.
SELECT tb.id, tb.booking_reference, tb.party_size, count(c.id) AS cover_rows
FROM public.table_bookings tb
JOIN public.booking_preorder_orders o ON o.table_booking_id = tb.id
LEFT JOIN public.booking_preorder_covers c
       ON c.order_id = o.id AND c.dropped_at IS NULL
WHERE tb.booking_period_id IS NOT NULL
  AND tb.status IN ('confirmed','pending_payment')
  AND tb.booking_date >= current_date
GROUP BY tb.id, tb.booking_reference, tb.party_size
HAVING count(c.id) <> tb.party_size;
```

```sql
-- WITHDRAWN. This column does not exist and this index must NOT be created:
-- CREATE INDEX ON public.booking_preorder_covers (table_booking_id);
```

**It must return zero rows before activation** (preflight check 12).

**Acceptance criteria**

- [ ] A dry run changes no row in `table_bookings` and no row in any `booking_preorder_*` table except one
      `preorder_alerts` row.
- [ ] `commit` twice produces one call list.
- [ ] Creating a booking between the dry run and the commit causes the commit to refuse.
- [ ] **Zero bookings have `booking_period_id` changed by the backfill**, asserted directly.
- [ ] The alert row's `detail` contains counts and a fingerprint and **no customer name**.
- [ ] The reconciliation query, run against deliberately broken fixture data, finds it.

---

## 10. Release manifest, rollback and deployment

### 10.1 The two repos are not in the same state

**VERIFIED by G on 2026-08-04 with `git rev-parse` and `git worktree list` in both trees:**

| Repo | Branch | Head | `origin/main` | Merged? |
|---|---|---|---|---|
| AMS | `main` | `63525547` | `63525547` | **Yes** |
| Website | `work/outstanding-book-table-2026-08-03` | `14aa6be7` | `a3552b57` | **No.** `git merge-base --is-ancestor` returns false |

**The practical consequence, and it is why this table exists: AMS can already price and record a seasonal
booking, and the website cannot yet ask the question.** Until the website branch is merged and deployed,
the only way a guest reaches a seasonal booking is through a member of staff on the FOH screen. Anything
in any spec that assumes the guest-facing seasonal question is live is wrong today.

**Merged is still not deployed.** AMS auto-deploys `main`, but auto-deploy has been observed to miss a
push in this workspace. The production deployment state of both repos is **UNVERIFIED**: no `vercel ls`
was run. Preflight checks 1 and 2 exist precisely to close that gap and must be evidenced, not assumed.

AMS also has five worktrees on five different heads. **Read the branch of the worktree you are in before
believing any statement about what is merged.**

### 10.2 Manifest format

One file per release, `tasks/releases/<date>-<name>.md`, committed to the repo it releases. One row per
delivered item.

| Field | Meaning |
|---|---|
| `item` | What was delivered |
| `repo` | Which repo owns it |
| `sha` | The exact commit |
| `branch_or_pr` | Where it came from |
| `migrations` | Migration versions included, or `none` |
| `depends_on` | Items that must ship first |
| `env` | `local`, `preview`, `production` |
| `deployment_id` | The platform deployment |
| `previous_deployment_id` | **The rollback target** |
| `verified_by` | Person and date |
| `verification_evidence` | What was actually observed, for example "Booked a party of 8 on 2026-11-14, saw the Christmas question, deposit quoted £80" |

Add a dated superseding header to each of these so the documents stop disagreeing:

- `OJ-The-Anchor.pub/tasks/book-table-outstanding-work-2026-08-03.md`
- `OJ-The-Anchor.pub/tasks/book-table-analytics-thresholds-2026-08-03.md` §Part 1 (§10.4)
- `OJ-The-Anchor.pub/tasks/christmas-2026-build-plan.md` (its §0 is owner-confirmed 2026-07-21 and
  contradicts O4; see `OB2`)
- `OJ-AnchorManagementTools/tasks/seasonal-amendment-deposit-decision-2026-08-03.md` (**stale**, §7.1)

Also note: `christmas-2026-build-plan.md` uses "Phase A" and "Phase B" for a different cut from this
spec's Phase 1 and Phase 2. **Two live documents using the word "phase" for different cuts will be
misread. Rename one or supersede the other before build.**

### 10.3 Deployment order and rollback

```
1. M0, M1, M2, M3. Database only, no behaviour change, everything gated off.
2. AMS application code. Inert, because preorder_module_enabled is false.
3. Website code. Ships dark, because AMS is not returning the `preorder` block yet.
4. Cron schedules added to vercel.json.
5. Regenerate src/types/database.generated.ts in its own commit; check the diff for unrelated drift.
6. Preflight (§8.3).
7. Flip the switches in the §8.4 order.
```

**Rollback is a settings flip plus a redeploy of the previous commit. No `DROP TABLE` is ever needed to
recover**, because the tables and triggers are inert while the master flag is false. That is the property
that makes this deployable in September ahead of an October menu.

**Say the limit plainly rather than pretending rollback is free: once orders exist, dropping the tables
means data loss and is not a real option.**

Five rollback rules that stay regardless of anything else:

1. **Deployment rollback stays.** Record the previous production deployment id and SHA in the manifest.
2. **Rehearse it once, before activation.** Roll production back, load `/book-table`, complete a booking,
   roll forward. Record the elapsed time in the runbook. **An untested rollback is a hope.**
3. **Database compatibility window.** Every migration is additive and the previous release must run
   unchanged against the new schema: new tables, new nullable columns, new settings keys. No column drops,
   no constraint tightening on existing columns, **no changes to `guest_tokens` at all in Phase 1**. Keep
   the window open for at least 14 days after activation before any tightening migration.
4. **Forward fix is the default.** Rollback is for a regression breaking bookings right now. Anything else
   is fixed forward, because rolling back after guests have submitted pre-orders means the previous
   release cannot read them.
5. **After activation, rollback alone is not enough.** If the release is rolled back, the four switches
   must also be set false, or a rolled-back build keeps the crons running against half-present code. Put
   this in the runbook as a paragraph, not as tribal knowledge.

#### 10.3.1 Adjacent website workstream: retiring the four-step booking flow

**Scope note, stated plainly because two parts of this document could otherwise be read as disagreeing.**
Part 1 §2 puts "retiring the existing booking flow" **out of scope for the seasonal pre-order feature, and
that stands**. Nothing in §10.3.1 or §10.4 is pre-order build work, no pre-order acceptance criterion
depends on it, and Phase 1 ships whether or not it happens.

It is written down here for one reason: it is an **adjacent website workstream that wants the same release
window**, weeks before the pub's busiest trading period, and the risk it carries is a risk to the seasonal
season even though it is not part of the seasonal feature. Treat this subsection as a warning to the
release manager, not as a requirement on the pre-order developer.

**It depends on one production value nobody has read.** VERIFIED: the website chooses its booking journey
from a runtime flag `booking_options_step1`, held in AMS as one `system_settings` row keyed
`website_ui_flags`, and **no migration or seed creates that row**; every flag defaults OFF in every failure
mode.

- **Flag is `true` in production.** Guests already use the two-screen journey. Deleting the four-step path
  removes an unused branch. Low risk.
- **Row missing, or the flag is not `true`.** Guests are still on the four-step journey. Deletion then
  ships a new booking journey to every visitor at once, with no exposure event, no comparison and no flag
  to put it back, weeks before the pub's busiest trading period.

**If the second case is true, turn the flag on first, watch the §11.3 absolute watches for two full
weekends, and only then delete.** Turning a flag on is reversible in 60 seconds. A deletion is not.

**The deletion sequence is non-negotiable**, because VERIFIED by G:
`tests/unit/ManagementTableBookingForm.test.tsx` contains roughly 100 tests and none of them mentions
`twoScreenFlow`. Every one exercises the path being deleted.

```
0. Read the production value of booking_options_step1. If not `true`, turn it on and watch for
   two full weekends before going further.
1. Write two-screen equivalents for the idempotency-key, London-timezone, busyness, funnel-sequence,
   stale-alternatives, food-check-notice, purpose-derivation and phone-privacy behaviours.
2. Prove them green on the current code, with the old tests still present.
3. Delete the old tests and the old path in one commit.
4. Prove the suite green again.
5. Deploy. Verify the production alias moved to the new SHA.
```

### 10.4 The analytics waiver, recorded

**Same scope note as §10.3.1: this concerns the adjacent four-step retirement, not the seasonal pre-order
feature.** It is recorded here because the waiver is a decision the owner has to make in the same window.

Two live documents disagree. `book-table-analytics-thresholds-2026-08-03.md` §Part 1 sets a go/no-go gate
for retiring the four-step flow: 400 assigned sessions per arm, at least two full weekends per arm, a
non-inferiority bound above minus 2 percentage points, and two payment guardrails. It also states that the
required exposure event, `booking_flow_assigned`, **is not built**. So the owner's deletion decision does
not merely overrule the threshold, it makes it unmeasurable.

**Resolution: the owner's deletion decision supersedes §Part 1 of that document. This is a deliberate
waiver, made with knowledge of what is being given up.** Record it in three places so the documents stop
disagreeing: in this spec, as a dated note at the top of §Part 1, and in the PR that performs the
deletion. **Part 2 of that document, the operational watches, is not waived.**

**What the waiver costs, stated plainly.** The pub will not know whether the two-screen flow converts
better, worse or the same. If bookings fall after the change, nobody will be able to say whether the flow
caused it or Christmas did. The payment guardrail in particular, "more people press Confirm but fewer
actually pay", will not be detected by comparison. **How much this costs depends on the flag value in
§10.3, and nobody has checked. Read the flag before putting the question to the owner** (`OA1`).

### 10.5 The runbook

A one-page `docs/runbooks/seasonal-preorders.md`, written **before** activation, not after the first
incident, covering: how to switch each kill switch off and what each one stops; how to roll back a
deployment and how long it takes; how to find a booking's covers; how to re-send a booker's link; how to
correct a cover by hand; how to record a cash refund; the `PREORDER_PHONE_HMAC_SECRET` non-rotation rule
(Phase 2); and who to ring.

---

## 11. Observability

### 11.1 Correlation

One `correlation_id`, a uuid, created when a booking first gets an order row. Carried on every outbox row,
every job payload, every log line, every audit entry and every alert. **One value answers "what happened
to this booking" across two repos and seven asynchronous crons.**

Rules: never shown to a guest, never put in a URL, never used as a token. It contains no personal data, so
it is safe in logs.

### 11.2 The health page

`/preorders/health` in AMS, staff-only. Each counter is one query.

| Counter | Healthy | Alert |
|---|---|---|
| Eligible seasonal bookings in the window | any | |
| **Bookings whose live cover count does not equal party size** (§9.4) | **0** | any non-zero, **immediately**. This is the invariant |
| Orders complete, as a percentage of eligible | rising | below 60 per cent at 3 days before service |
| Orders incomplete inside the cutoff | small | any, listed for the manager |
| Oldest pending outbox row, age in minutes | under 15 | above 30 |
| Outbox rows in `failed` or `dead_letter` | 0 | any |
| Rows in `sending` with an expired lease | 0 | above 10 at once |
| `accepted` SMS with `delivery_unknown` | low | above 20 per cent of a day's sends |
| Chase messages sent today | under budget | above the daily budget |
| Transmissions per booking | under 12 | above 12, which means the cap logic has broken |
| Last successful run of each cron | under 2 hours ago | above 4 hours |
| Retention cleanup: rows due versus rows cleared | equal | any gap |
| Amendments in `manual_review`, unresolved | 0 | any older than 48 hours |
| Last successful alert digest send | recent | see §11.4 |

### 11.3 The compensating absolute watches

Because the controlled comparison is waived (§10.4), the absolute watches become the only safety net, so
they must be **built, not merely specified**. Copy the thresholds document's Part 2 watch definitions into
implementation tickets and tests, **pinned to website SHA `14aa6be705dad14d876c8e843fb07621f3f291b6`**
rather than linking to a file that can change. Add one new watch:

> **Completion-rate floor.** Completed bookings per week, and the ratio of `pending_payment` bookings never
> captured, both on a rolling 7-day window. Alert if completions fall more than 30 per cent below the
> trailing 4-week mean, or if the never-captured ratio rises more than 5 percentage points. **These are
> crude. Crude is what is left after the controlled comparison is waived.**

### 11.4 Alerts

Alerts are **rows in `preorder_alerts`**, not ad-hoc emails. That is what makes them deduplicable,
resolvable and monitorable. `alert_key` is deterministic, for example `incomplete_at_cutoff:<booking_id>`.
Re-raising an open alert increments `occurrence_count` and updates `last_seen_at`; it does not send a
second email.

| Rule | Value |
|---|---|
| `info` and `warning` | Batched every 15 minutes into one digest |
| `critical` | **Immediate.** Severity is per row, not per type. Only two situations ever carry it: `refund_failed`, and a `covers_mismatch` that was **not** repaired (Part 2 §2.5 G2). **A `covers_mismatch` raised by the G3 repair sweep carries `warning` and is digested**, or the activation sweep would send one immediate email per repaired booking. Money and data integrity do not wait; a gap that has already closed itself does |
| Repeat suppression | An open alert re-notifies at most once every 24 hours until acknowledged |
| Digest cap | 50 items per email. Above that, a summary with counts and a link, not a list |
| Auto-resolve | An alert whose condition no longer holds is set `resolved` by the next sweep, and the next digest says so in one line. **Staff should see problems close, not just open** |
| Send path | Through `booking_preorder_outbox` with `message_class = 'alert'`. **One outbox, not two** |

Note the distinction, because it is easy to conflate: `refund_failed` means a refund was attempted and did
not complete, and it cannot fire until the §7 workstream ships. `amendment_manual_review` is the interim
alert, it is a `warning`, and it goes in the digest. An over-collection somebody needs to look at is not an
emergency; a refund that half happened is.

**Monitoring the monitor.** Three controls, because the alerting system must be able to fail loudly:

1. A daily 08:00 heartbeat email, one line: "seasonal pre-orders: N bookings, M incomplete, alerting
   healthy". **Silence is then a signal.**
2. If any alert row sits `pending` for over 30 minutes, `reportCronFailure` fires through the independent
   `CRON_ALERT_EMAIL` path. **VERIFIED:** that path exists in `src/lib/cron/alerting.ts`.
3. `/preorders/health` shows the last successful digest send.

### 11.5 PII in manager emails

`manager@the-anchor.pub` is a shared mailbox. **Assume more than one person reads it and that it is
retained by the provider for a long time** (U3).

| Field | In the email? |
|---|---|
| Booking reference, date, time, party size | Yes |
| Number of covers still incomplete | Yes |
| Booker's first name | Yes |
| **Booker's phone number** | **No.** Link to the booking in AMS |
| **Guest names** | **No** |
| **Allergy or dietary free text** | **No, never, under any circumstance** |
| **Dish choices** | **No.** They are in AMS |
| Correlation id | Yes |
| A deep link to the booking in AMS | Yes. **This is the mechanism that replaces all of the above** |

This resolves C's own internal contradiction: C.3.3 said the digest carries "the booking reference and the
booker's number", C.5.3 and G.11.4 said no phone numbers at all. **No phone number in the digest, ever.
The digest links into AMS.**

Every alert email says **what to do**, not only what broke: "Party of 8 on 14 November is missing 3 mains.
Open the booking to see who and to ring them." The person to ring is behind the login, which is where the
access control lives.

Apply `redactPii()` as a **second** line of defence after building the body from the allowed-field list.
Belt and braces, because the failure mode is a shared mailbox full of guests' health information.

### 11.6 Telemetry privacy and reuse

**No phone number, guest name, dietary text or token in any log line, metric label, dashboard or CSV
filename.** Log the booking id and the correlation id. Anything more, a human looks up in AMS with their
own permissions.

Reuse, do not rebuild: `persistCronRunResult` and `recoverCronRunLock` (**VERIFIED** in
`src/lib/cron-run-results.ts`); `reportCronFailure` for a cron that throws; `src/lib/logger.ts` for
structured logs (**note: `no-console` is an ESLint error in this repo and only `console.warn` and
`console.error` are permitted**); `logAuditEvent()` on every mutation.

### 11.7 Capacity and cost budgets

Volume, from real numbers. Verified 2026 run rate: 56 to 104 table bookings a month, of which 2 to 13 are
party 6 or more. The Christmas window is 41 days.

| Scenario | Seasonal bookings | Covers | Basis |
|---|---|---|---|
| Low | 15 | 130 | Current party-6+ run rate over 41 days |
| **Planning** | **60** | **520** | Current rate times 4. **ASSUMED multiplier**: the pub has no prior seasonal data in this system |
| High | 200 | 1,800 | Every seasonal booking at seat capacity |

Size to the planning row; check the high row does not break anything.

| Budget | Target |
|---|---|
| Pre-order form, first contentful paint on 4G mobile | under 2.5 seconds |
| Pre-order form, party of 20 at 3 courses (60 pickers) | interactive under 1 second after data loads, no input lag above 100 ms |
| Save one cover | under 500 ms at p95 |
| Kitchen service-day view, 40 bookings | under 2 seconds server render |
| Any cron, one run | under 30 seconds, always under the route's `maxDuration` |
| Chase scheduler batch | 200 bookings per run, paginated and resumable, so a slow provider cannot time out a run and lose the tail |
| Outbox drain | oldest pending row under 15 minutes |
| Manager digest | at most 50 items per email |

**Phase 1 SMS volume is bounded and small:** one recipient per booking and at most four chase occasions,
so at most **4 SMS and 3 emails** per booking, which is the seven items counted in §2.10. `C1` is SMS only,
which is why the email figure is 3 and not 4. At the planning volume of 60 bookings that is at most 240 SMS
across the whole window, well inside the 120-per-hour global limit.

**Phase 2 is where the cost risk lives:** a party of 20 could be 20 contacts times 4 messages, 80 SMS for
one booking. Controls in §13.

Run `EXPLAIN ANALYZE` on the service-day query, the chase sweep and the §9.4 reconciliation against a
production-sized copy before release, **and paste the plans into the PR. That is the acceptance evidence,
not a promise.**

---

## 12. Testing and accessibility

### 12.1 What exists to test with

Verified:

| | AMS | Website |
|---|---|---|
| Unit and component runner | Vitest 4 (`vitest.config.ts`) | Jest 29 |
| Accessibility tooling | **none** (**VERIFIED:** no axe package in `package.json`) | **none** |
| End-to-end tooling | **none** | `playwright` 1.60 is a devDependency with **no config, no `e2e` directory and no script** |
| Cross-repo contract test | **One, and it is the pattern to copy** | The same one |

**The cross-repo contract problem is already solved and only needs extending.** VERIFIED by G:
`src/app/api/table-bookings/__tests__/table-availability-contract-hash.test.ts` in AMS and
`tests/unit/tableAvailabilityContractHash.test.ts` in the website, added 2026-08-03. The repos do not
build together, so each pins a **digest** of the shared fixture. Editing the fixture fails that repo's own
tests, and bumping the digest is the prompt to copy the file across. **The pre-order contract uses this
same mechanism, not a new invention.**

So the honest position: no working end-to-end harness in either repo and no accessibility tooling
anywhere, but the contract problem is solved. **Two of the review's recommendations therefore carry setup
cost before they carry test cost. Budget for it.**

### 12.2 Requirement-to-test matrix, Phase 1

`V` = Vitest, `J` = Jest, `DB` = pgTAP or a SQL assertion in a migration test, `E2E` = Playwright,
`M` = manual with recorded evidence.

| # | Requirement | Level | Assertion |
|---|---|---|---|
| T01 | A cover always has a main | DB | `choice = 'none'` on `course = 'main'` is rejected by `bps_main_must_be_item_ck` |
| T02 | Starter and dessert are optional per cover | V | A cover with a live row for every course in `course_set` is complete; one missing course is `partial` |
| T03 | Covers in one party may differ | V | Party of 3, one 1-course, one 2-course, one 3-course, all complete |
| T04 | "Declined" is distinguishable from "not answered" | V + DB | An explicit `choice='none'` row is complete; an absent row is `partial`. **This is the O4 acceptance test** |
| T05 | Covers sum to party size | DB | A direct insert of a fourth cover on a party of 3 is rejected by the deferred constraint trigger, not by application code |
| T06 | Party grows | V + DB | Covers added, order becomes incomplete, `completed_at` cleared, `first_completed_at` untouched, one notice, zero extra chase occasions |
| T07 | Party shrinks | V + DB | Deterministic order, tombstone written, `dropped_at` set, no partial meal dropped ahead of an untouched one |
| T08 | Menu item withdrawn | V + DB | Affected covers become `blocked`, one notice per distinct contact, cap not consumed, `first_completed_at` untouched |
| T09 | Re-picking exits `blocked` | V | Any successful selection write clears `invalidated_at` and `invalidated_reason` |
| T10 | Menu item renamed | V | The snapshotted `item_name` on existing selections does not change |
| T11 | **Chase timing truth table** | V | Every row of §2.9, asserting the exact UTC instant. **Run under `TZ=UTC` as well as `TZ=Europe/London`**, because the manager-alert UTC bug in this codebase was invisible on a London laptop |
| T12 | DST | V | Cases F and G must fail if anyone replaces the date arithmetic with `interval '7 days'` on a `timestamptz` |
| T13 | **The dedup trap** | V | Schedule `T0`, `C1`, `C2`, `CUT`, run the worker four times, assert four distinct provider calls. Then delete `metadata.stage` and **assert the test fails** |
| T14 | Default-configuration reality | V | With `chase_anchor='booking'`, `{7,4}` and a 7-day cutoff, exactly **two** occasions. With the Christmas configuration, exactly **four** |
| T15 | Cron idempotency | V | Scheduler twice and worker twice over one window: one transmission per business key |
| T16 | **Crash recovery** | V | Kill between claim and send: the row returns to `pending` and eventually sends exactly once. Kill between send and status write: the reconciler promotes to `accepted` and does **not** send again |
| T17 | **The failure-row trap** | V | Make a send fail hard so a `local-fail-…` `messages` row is written, expire the lease, run the reconciler. Assert the row does **not** become `accepted` and that §3.5 was applied to the recorded error code |
| T18 | Quiet hours | V | Create a contact at 22:30 London: the `T0` SMS row has `due_at` at 09:05 next morning, `sendSMS` was **not** called at 22:30, and no `deferred:true` result was produced. Repeat at 08:59:58. A `CUT` clamped to 08:00 is cancelled `quiet_window`, not deferred |
| T19 | Cap | V | A contact that never completes receives exactly four occasions on any configuration of `chase_offsets_days` and `preorder_cutoff_days` from 0 to 20 |
| T20 | Re-arming after cancellation | V | Cancel a `CUT` with `quiet_window`, correct the number, re-arm. The insert succeeds (a direct test of the live-row-only unique indexes) and `occasions_consumed` does not increase |
| T21 | Backlog release | V | Queue 50 rows, hold `preorder_chases_enabled` false for a simulated week, turn it on: every row more than 2 hours past `due_at` is cancelled `skipped_past` and nothing sends |
| T22 | Dead-letter retry | V | A **new** outbox row with a new id is created and a real provider call is made. A test asserting only "the button returned success" would pass while the send was silently suppressed |
| T23 | Provider failure injection | V | Timeout, 5xx, and accepted-then-failed delivery. The outbox retries with backoff, never double-sends on a business key, and reaches `dead_letter` rather than looping |
| T24 | Failure mapping | V | One case per row of §3.5, asserting the outbox state, the attempt count and `reachability`. Include a sustained outage and a delivery webhook arriving 8 hours late, after `delivery_unknown` was set, correctly clearing it |
| T25 | SMS safety limits | V | A rate-limit deferral sets `next_attempt_at` and **does not consume an attempt** |
| T26 | Kill switches | V | Each of the three Phase 1 switches off, assert the specific thing stops and nothing else does. Assert **read failure fails closed**. Assert `preorder_chases_enabled` flipped mid-run stops rows already claimed for that run |
| T27 | Master switch overrides | V | `preorder_module_enabled = false` with the other three true does nothing anywhere |
| T28 | **Retention cron is exempt** | V | With `preorder_module_enabled = false`, the retention cron still runs and still deletes |
| T29 | Concurrency | V + DB | Two concurrent submits on different covers both succeed. Two on the same cover produce one success and one 409 carrying the diff. A staff edit racing a booker submit produces the same |
| T30 | RLS and grants | DB | All twelve tables service-role only. **No new `preorder_*` function is executable by `anon` or `authenticated`.** Verified hazard: on this project a new public function is granted EXECUTE to those roles by default and `REVOKE FROM PUBLIC` does not remove it |
| T31 | Redacted tombstone | DB | Hard delete a booking with an order. Assert `old_values -> 'covers'` is not null **and** the payload contains no `guest_name` key |
| T32 | Cancellation | V | Chases stop, tokens are revoked, rows survive for audit |
| T33 | Hard cutoff | V + E2E | After `cutoff_at` the token resolves, the page renders read-only, and a submit is refused |
| T34 | Backfill | V + DB | Every acceptance criterion listed at the end of §9.4 |
| T35 | Reconciliation returns zero | DB | The §9.4 query, run against deliberately broken fixture data, finds it |
| T36 | Retention schedule | V | D+7 tokens gone; D+60 identifiers gone and selections surviving; D+90 dietary gone and operational rows deleted; aggregates surviving. **Step 4 refuses for a service date with no aggregate rows for both metrics** |
| T37 | Aggregate idempotency | V | Running the aggregate twice for one service date produces the same row count. **This is the test that catches a nullable `service_slot` slipping back in** |
| T38 | Legal hold | V | A row with `retention_hold_until` in the future is skipped by every step |
| T39 | Erasure versus retention | V | The `erased-%` sentinel and a NULL phone are distinguishable, and the retention job skips the phone step for an erased row |
| T40 | Subject access | V | Given a number in three formats, the export returns every linked cover, name and note, plus `notHeld` |
| T41 | **No PII in audit payloads or alert details** | V | A scan over rows actually produced by the suite, not over template fixtures |
| T42 | **No PII in the manager digest** | V | The digest fixture contains no guest phone number, guest name, dish choice or dietary content |
| T43 | Access matrix | V | One test per **N** and **M** cell of §4.4, asserting absence from the **serialised response** |
| T44 | Kitchen totals | V | Dish counts equal the sum of live selections, across mixed course counts |
| T45 | **Kitchen print and export** | M | Print one A4 page, show it to the kitchen, record their sign-off. **Not a developer sign-off** |
| T46 | Allergy merge | V | The kitchen output shows **both** the booking-level `table_bookings.allergies` and the cover-level `dietary_note`, labelled and never concatenated |
| T47 | Segment counting | V | Every guest-facing SMS is checked with `countSmsSegments` **with a representative link substituted**, never on the raw template and never with `.length` |
| T48 | Full journey, booker | E2E | Book a party of 8, mixed course counts, submit, verify in AMS |
| T49 | Full journey, staff | E2E | Staff create a Christmas booking on FOH, enter all covers, print the kitchen sheet |
| T50 | Worst-case party | V + E2E | 20 covers, 3 courses each |
| T51 | Accessibility | M + axe | §12.4 |
| T52 | Deployment rollback | M | §10.3 rule 2 |
| T53 | API contract, AMS side | V | Request and response schema for every endpoint, including error codes |
| T54 | API contract, website side | J | The website's fixture matches the AMS schema |
| T55 | **Cross-repo contract digest** | V + J | Extend the existing pinned-digest pattern. Assert each repo fails when its own copy of the fixture is edited |
| T56 | Website SSOT drift guard | J | Whatever `OB2` decides, `SSOT.json`, `docs/SSOT.md`, `ssot-drift-guard.test.ts` and the four `christmas-parties-*` test files move together **in the same change** |

Phase 2 adds: token entropy and revocation, STOP handling and idempotency, permission-evidence versioning
and per-person revocation, per-contact visibility, the Irish-mobile metadata trap, unreachable escalation,
and the shared-number subject-access case. The full list is in §13.

### 12.3 Environments

There is no staging environment in this workspace as far as could be verified. That is a real gap for
provider-integration tests. Two options:

- (a) Stand up a Supabase branch plus a Vercel preview with sandbox PayPal and a test Twilio number. Costs
  a day or two of setup plus the risk of a preview environment that drifts.
- (b) Test providers against sandbox credentials from a local run, and do the end-to-end verification on
  production during a quiet period, using a real staff phone number and a booking that is then cancelled.

**Recommended: (b). The pub is one site. A staging environment nobody uses daily will lie.**

**UAT:** two hours, on production, with the owner and one kitchen member present. Script: three bookings of
different sizes, one taken by phone and entered by staff, one on the website, one amended after
submission. Print the kitchen sheet for the service day. **The exit criterion is the kitchen saying they
can cook from it.** Sign-off is the owner's, recorded in the manifest.

### 12.4 Accessibility: WCAG 2.2 level AA

**Target: WCAG 2.2 level AA**, for the booker's pre-order form and the staff entry screens in Phase 1, and
for the delegated guest's own token page when Phase 2 adds it. **The booker's token page is Phase 1 and is
in scope from day one**: it is the same page, reached by the same route. That is the correct target for a UK hospitality business under the Equality Act 2010
and the level the government uses for public services. **ASSUMED:** no accessibility target was previously
set for either repo; none was found.

The repeated-picker pattern is the hard part. These are the criteria this specific form will fail without
deliberate work.

| Criterion | Requirement here |
|---|---|
| 1.3.1 Info and Relationships | Each cover is a `<fieldset>` with a `<legend>` naming it, for example "Guest 3 of 8". Each course is a nested group. **Never rely on visual position to say which picker belongs to which person** |
| 2.4.6 Headings and Labels | Every radio and select has a unique accessible name including the cover: "Main course, guest 3", not eight controls all called "Main course" |
| 3.3.1 Error Identification | An error summary at the top of the form, each problem a link to the field |
| 3.3.2 Labels or Instructions | **The mandatory-main rule is stated before the guest starts, not discovered on submit** |
| 3.3.3 Error Suggestion | "Choose a main for guest 3" beats "Invalid" |
| 3.3.7 Redundant Entry (2.2) | Do not ask for the party size or the booker's details again when the booking already has them |
| 3.3.8 Accessible Authentication (2.2) | The link the booker follows must not require them to remember or retype anything. **No copied codes** |
| 4.1.3 Status Messages | "3 of 8 guests still need a main" announced via `aria-live="polite"` when it changes, **without moving focus** |
| 2.5.8 Target Size (2.2) | Minimum 24 by 24 CSS pixels. **The pub's own FOH standard is 44 pixels for the iPad, and the staff screens must meet 44, not 24** |
| 2.4.11 Focus Not Obscured (2.2) | A sticky "covers remaining" bar must not cover the focused control. **This is the most likely real failure** |
| 1.4.3 and 1.4.11 Contrast | Selected and unselected states must differ by more than colour saturation alone |
| 2.1.1 Keyboard, 2.4.3 Focus Order | Tab order runs cover by cover, course by course. Adding or removing a cover moves focus deliberately and announces what happened |
| 1.4.10 Reflow | Usable at 320 CSS pixels wide with no horizontal scrolling. **Most bookers are on a phone** |
| 1.4.12 Text Spacing | No clipping when line height is increased to 1.5 |

**How it is tested:**

1. **Automated.** Add `@axe-core/playwright` for end-to-end runs and `axe-core` assertions in component
   tests. **Neither repo has any axe package today**, so this is new setup. Automated scanning catches
   roughly a third of issues: **a floor, not a pass.**
2. **Manual keyboard.** Complete a party of 8 using only the keyboard. No mouse, no touch.
3. **Manual screen reader.** VoiceOver on iOS Safari and NVDA on Windows Chrome. Record a short screen
   capture of each as evidence.
4. **Zoom.** 400 per cent browser zoom, 320 pixel viewport.

Supported browsers and assistive technologies are the owner's to state. **ASSUMED** in their absence:
current Safari and Chrome on iOS, Chrome and Safari on desktop, VoiceOver and NVDA.

### 12.5 Guest and staff error states

Every state names what happened, what the guest should do, and gives the pub's number and the booking
reference. Focus moves to the error region and it is announced.

| State | Guest sees | Recovery | Focus |
|---|---|---|---|
| AMS unreachable while loading the menu | "We cannot load the festive menu right now. Your table is booked and safe. Try again in a few minutes or ring us on 01753 682707." | Retry. The booking is unaffected | Error heading |
| Save fails on one cover | "Guest 3's choices did not save. Everything else is saved." | Retry that cover only. **Never lose the rest of the form** | The failing fieldset |
| Link expired | "This link has expired. Ring us on 01753 682707 and we will take your choices." | No data shown | Page heading |
| Booking cancelled | "This booking has been cancelled." Nothing else | No data shown | Page heading |
| Dish withdrawn since they chose | "The kitchen has had to change the menu. Guest 3's main is no longer available, please choose again." | Only the affected cover becomes incomplete | That cover |
| **Submitted after the cutoff** | **"We are sorry, choices closed at midday on {date} so the kitchen could order. Please ring us on 01753 682707 and we will see what we can do."** Read-only view of what was ordered | **Refused. The cutoff is HARD** | Page heading |
| Validation: a main is missing | Error summary at the top listing each guest missing a main, each a link to that fieldset | | Error summary |
| Offline mid-form | "You are offline. Your choices are saved on this device and will send when you reconnect." | Local draft, resend on reconnect. **ASSUMED implementable. Confirm before promising it in copy** | Status region |
| Two people editing at once | "Someone else changed guest 3's main to the turkey while you were here. Which do you want to keep?" | Show both, ask. **Never silently overwrite** | The conflict |
| Guest needs help | The phone number and opening hours in the footer of every screen | | |

**The hard-cutoff row corrects G.12.2**, which wrote guest copy for a soft cutoff ("Accepted and flagged
to staff"). Part 1 §10.2.3 is binding: the cutoff is hard, because the kitchen buys food against these
numbers and a guest needing a late change should reach a person.

**Staff copy matters as much and is usually forgotten:** what a manager sees when collection is switched
off, when the menu is not published, when an order is inside the cutoff and incomplete, and when a
backfill candidate is waiting to be rung. Each is one sentence naming the cause and the fix.

**Copy that must be written before build, and blocks it:**

| Slot | Who writes it |
|---|---|
| The seasonal question and blurb (`booking_periods.guest_question`, `guest_blurb`) | Owner. Note the seeded question reads as yes or no while the design asks for a **selection** of the seasonal menu. Confirm or change it |
| Pre-order intro, including the mandatory-main rule in one sentence | Owner, developer drafts |
| **The dietary and allergy field label and helper text** | **Legal must approve this one.** It sets the expectation the pub is accepting |
| Cutoff explanation ("We need your choices by 12 noon on 4 December so the kitchen can order") | Owner |
| Confirmation after submit, including the serious-allergy line | Developer drafts, owner approves |

---

## 13. Phase 2 appendix: the third-party machinery

**Nothing in this section is Phase 1 work. It is written down now so Phase 2 is a flag and a migration,
not a redesign.** Every column it needs already exists, nullable, in the Phase 1 schema.

**Why the line is here.** Nearly every P0 privacy and messaging risk in the developer review exists **only
because somebody other than the booker submits choices**. Third-party phone numbers create the STOP
defect, the `createCustomerIfMissing` trap, the quiet-hours failure, the Article 14 question, the
permission-evidence machinery, the suppression list and most of the token threat model. Remove that one
thing and the risk register collapses. Phase 1 still delivers the actual business need: **per-cover food
choices the kitchen can cook from.**

**What Phase 1 costs the owner, stated plainly.** The booker types in everyone's choices. For a party of
twelve that is twelve names and up to thirty-six dish picks on one form. That is the whole cost. It is
real, and it is smaller than the cost of getting third-party consent wrong at Christmas.

### 13.1 Four verified production defects that Phase 1 does not trigger

All four are SECTION-CLAIMED with line references in `C-privacy.md` §C.1 and must be re-read before Phase 2
starts. **Each of them breaks the naive delegated design.**

| # | Defect | Consequence for Phase 2 |
|---|---|---|
| **D-1** | Inbound STOP handling **requires an existing `customers` row**. If `findCustomerByPhone` returns nothing, the message is filed as an `unmatched_communications` row and the handler **returns without honouring the opt-out** (`src/app/api/webhooks/twilio/route.ts`, the `if (!customer)` early return) | **A pre-order guest who is not a customer can text STOP and we will keep texting them. This is a P0 and a straightforward regulatory problem.** §13.3 |
| **D-2** | `sendSMS` **creates a `customers` row by default** for an unknown number | Without `createCustomerIfMissing: false`, every guest number the booker supplies silently becomes a marketing-capable customer. **This defeats the entire design.** §3.4 already sets the flag |
| **D-3** | `messages.customer_id` is `NOT NULL`, and `recordOutboundMessage` skips the insert entirely when there is no `customerId` | A guest SMS **cannot be logged in `messages`**. The delivery record is `booking_preorder_outbox` and nothing else. **Do not build a second log table**; an earlier draft proposed `booking_preorder_message_log`, which must not exist |
| **D-4** | With no resolved customer id, `sendSMS` **fails the send outright** during quiet hours when Twilio scheduling is unavailable | For guests that branch is not an edge case, it is **every** guest. §2.6 already removes the dependence by making the outbox own quiet hours |

One more, and it would have broken Ireland on day one: `src/lib/phone/index.ts` imports from
`'libphonenumber-js'`, the **min** metadata bundle, where `getType()` returns `undefined` for every Irish
number. A `getType()` rule written against that import **rejects every Irish mobile**. The pre-order
validator must import from `libphonenumber-js/max`, server-side only. **Do not change the import in the
shared library:** that would swap the metadata bundle under every existing caller and grow the client
bundle.

### 13.2 Phone validation

Reuse `formatPhoneForStorage` from `src/lib/phone/index.ts`. **Do not write a second normaliser.** But it
validates with `isPossible()`, which checks length only, so a landline, a premium-rate number and a
mistyped-but-right-length mobile all pass. Wrap it in `src/lib/preorder/phone.ts`. Rules, in this order:

| # | Rule | Guest-facing message |
|---|---|---|
| 1 | Normalise. **It throws on unreadable input, it does not return a result**, so wrap it in try/catch | "We could not read that as a phone number. Please check it." |
| 2 | Calling code must be UK (44) or Ireland (353). **Check this before the type check**, so an unsupported country gets the country message rather than a confusing "not a mobile" | "We can only text UK and Irish mobiles. Please order for this person yourself." |
| 3 | Must pass `parsed.isValid()`, not just `isPossible()` | "That does not look like a UK mobile number. Please check it." |
| 4 | `getType()` must be `MOBILE` or `FIXED_LINE_OR_MOBILE`, using the `/max` import | "We can only text mobile numbers. Please give a mobile, or choose to order for this person yourself." |
| 5 | Must not equal the booker's number | "That is your own number. You already have a link." |
| 6 | Must not duplicate another contact on the same booking | "You have already added that number." |

Rules 5 and 6 have a database backstop in the partial unique index `bpc_phone_uk`. **Keep both: the index
prevents the race, the friendly message prevents the support call.**

**The correction flow matters as much as the validation.** A booker who realises a number was wrong must
be able to fix it from their own link, and staff from the booking detail. Both trigger a fresh permission
confirmation and reset that contact's ladder. **Without a correction flow, a single typo means a guest is
never asked and the manager gets an escalation they cannot resolve.**

**Recommendation: UK and Ireland only for the first season.** Adding countries later is one line to a set.
International SMS also carries a materially higher per-message cost.

### 13.3 Inbound STOP

Fix in `src/app/api/webhooks/twilio/route.ts`, **before** the `if (!customer)` early return:

```
1. Normalise the inbound number (catch the throw: an unparseable From is not worth 500ing a
   Twilio webhook over).
2. Test the body against the EXISTING stopKeywords list. Same list, same matching.
   Do not create a second keyword list.
3. If it is a stop keyword AND no customer was found:
     a. Insert the suppression row FIRST, keyed on the HMAC of the normalised number.
        This step must not depend on finding a contact: if b to f fail, the person is still
        suppressed. The ordering is deliberate.
     b. Look up booking_preorder_contacts by phone_e164 across generatePhoneVariants.
     c. For every match whose booking_date is today or later, set reachability = 'opted_out'.
     d. Revoke ONLY that contact's permission evidence rows (revoked_reason = 'guest_stop').
        Do NOT revoke rows covering other people in the same batch.
     e. Delete that contact's booking_preorder_tokens rows.
     f. Cancel that contact's pending outbox rows (cancel_reason = 'opted_out') and escalate
        those covers to the booker.
     g. Record the inbound reply.
4. Then continue to the existing unmatched-communication path, so nothing is lost.
```

**Step 3 must be idempotent.** Twilio retries webhooks, and a guest who texts STOP twice is common.
Suppression is an upsert on the primary key; revocation and cancellation are conditional on the current
value, so a replay is a no-op.

**What STOP actually stops:**

| Scope | In scope? |
|---|---|
| Pre-order chases for that booking | Yes |
| Pre-order chases for any future booking on that number | Yes, via the suppression list |
| The pub's marketing SMS | Not applicable. They were never on it |
| Table booking confirmations, if they later book themselves | **No.** A booking they make themselves is a separate relationship with its own consent |

That last row is the only genuinely debatable one. It is defensible because a person who books a table and
gives us their own number has done something quite different from being volunteered by a friend. **Write
it into the privacy notice so it is not a surprise.**

**Opt back in:** only by the guest asking a member of staff, recorded as `source = 'staff'` with a note.
**There is no self-service opt-back-in, because the only way to offer one is to text them, which is the
thing they asked us to stop.**

**Rotation warning for the runbook.** Suppression and permission evidence are both keyed on
`PREORDER_PHONE_HMAC_SECRET`. **Rotating it orphans every suppression row and every `phone_hmac`, and
people who opted out would silently become contactable again. Treat the secret as non-rotatable in normal
operation.** If it must ever be rotated, the migration has to re-hash from live numbers first, which only
works for numbers not yet cleared by the retention schedule.

The secret is HMAC-SHA256, **not** plain SHA-256: the E.164 UK mobile space is small enough to brute force
a plain hash in seconds. No existing pepper was found, so add `PREORDER_PHONE_HMAC_SECRET` to
`.env.example` and Vercel **before** the Phase 2 migration, following the pattern in
`src/lib/portal/calendar-token.ts`.

### 13.4 Permission evidence

D10 says the booker must confirm they have permission before we message anyone whose number they supplied.
**A boolean is not evidence: it does not record what was agreed, in what words, covering whom.**

`customer_consents` is the right shape but cannot be reused, because its `customer_id` is `NOT NULL` and
the subjects here are not customers.

The canonical table is `booking_preorder_permission_evidence`, **one row per covered person**, with
`batch_id` grouping the rows written by one confirmation. C's two-table split was consolidated: at pub
volume, repeating the batch header per person is cheaper than a second table, and it makes revocation
naturally per-person, which was C's whole reason for splitting.

**Rows are append only. A correction is a new batch. Withdrawal sets `revoked_at` on the affected rows only
and never touches other people in the same batch.** Revoking a whole batch would mean one guest texting
STOP silences the whole table.

`booking_preorder_contacts.permission_evidence_id` is a **convenience pointer to the most recent covering
row, not the authority.** The authority is the table, because a contact can be covered, revoked and
re-covered over time and one column cannot express that history.

**When a fresh confirmation is required:**

| Event | Fresh? | Behaviour |
|---|---|---|
| Booker adds contacts at booking time | Yes, one batch, one row per contact | Blocks submit **server-side**, not only client-side |
| Booker adds a contact later, via their link | Yes, one row for the new contact only | Blocks the add |
| **Booker changes an existing contact's phone number** | **Yes.** The old evidence covered a different number | The old row is revoked with reason `phone_changed`, so the send gate returns false and the outbox cancels with `no_permission` until a new row exists. **Do not set `reachability = 'opted_out'` for this**: that value means the person asked us to stop, and conflating the two makes a typo look like a withdrawal of consent |
| Booker corrects a **name** only | No | The number is unchanged |
| Staff add a contact from a phone call | Yes, `capture_method = 'staff_recorded_verbal'`, `actor_user_id` set | Staff tick a screen affirming the booker confirmed it verbally. The wording is stored too |
| Party grows and new covers go to the booker's own contact | No | No new third party |
| `wording_version` changes | **No retrospective effect.** Old rows keep their old wording | **Never re-consent existing contacts on a copy change** |
| Booker declines the tick | The journey continues **without** additional contacts. The booker orders for everyone | **The booking is never blocked** |

Every one is audit-logged with `resource_type: 'preorder_permission'`, recording **contact ids and the
evidence row id only. No phone numbers, no names, no wording text**, because audit rows are permanently
undeletable.

**A Phase 1 evidence row is still written**, in reduced form: `wording_key =
'preorder_booker_orders_for_others'`, `phone_hmac = NULL`, one row for the booker's own contact. That is
why `phone_hmac` is nullable, and it is why the claim gate in §3.2 needs no Phase 2 change: the booker is
always covered.

**The Article 9 question is still live in Phase 1.** Anyone reading the phase cut as "Phase 1 has no
privacy work" has misread it: in Phase 1 the booker is entering dietary information **about other
people**, which is still third-party data and still potentially special category.

### 13.5 The guest chase ladder and its cost controls

Same points, same outbox, same cap, extended to every contact. Guests are SMS only; the booker keeps SMS
and email; the manager keeps email.

**Cost is the real Phase 2 risk.** A party of 20 could be 20 contacts times 4 occasions, so 80 SMS for one
booking. Five controls:

1. Cap additional contacts at the party size.
2. **Warn the booker in the UI that each person will be texted.**
3. A per-booking message counter, alerting above 25.
4. A daily seasonal-SMS budget in settings, defaulting to 150, that **pauses and alerts rather than
   overspending silently**.
5. Watch the GSM-7 segment count with `countSmsSegments` (§2.13).

**Guest escalation to the booker:** when a guest contact becomes `unreachable` or replies STOP, the booker
is told at the next scheduled chase point, or, if that is more than 48 hours away or does not exist, by a
`notice` row at `now + 15 minutes`, **batched so five bad numbers produce one notice**. Their covers are
reassigned to the booker. The notice names the contact and a count, **never a dish or a cover name**.

**Draft first-contact guest SMS, for owner approval:**

> The Anchor: Dave has booked a Christmas meal for your table on Fri 12 Dec and asked us to get your food
> choices. Pick yours here: [link]. Any questions, call 01753 682707. Reply STOP to opt out.

That template is 194 characters; with a real short link it is around 218, so two GSM-7 segments either
way. **Count the sent message with a representative link substituted, not the raw template.**

**Phase 2 also needs a provider lookup that does not depend on `messages`** (defect D-3): query Twilio for
messages to that number since `accepted_at`, or record the sid in the outbox row before the response is
discarded. Without it, every lease recovery on a guest send returns the row to `pending`, which is safe but
costs a worker cycle every time.

### 13.6 Booker visibility in Phase 2

| Field | Booker sees |
|---|---|
| Another contact's display name | Full. They typed it |
| Another contact's phone number | **Masked** (`•••••• 417`), so a shoulder-surfer at the table cannot read it off the screen |
| Another cover's dish selections | **None** |
| Another cover's `guest_name` | **None**. The guest may have entered different people |
| Another cover's dietary codes or note | **None** |
| `needs_kitchen_call` | **A count only:** "1 guest needs a call from us". Naming Sarah tells the booker Sarah has an allergy |
| Per-contact completion | Name plus "3 of 4 done" |

**May the booker edit another contact's submitted choices? No, not while that contact is reachable.** The
booker may reassign a **cover** to a different contact (which moves the unsubmitted slot, not the
submitted content), and may take over a cover whose contact is `unreachable` or `opted_out`. **Taking over
clears that cover's existing selections and dietary data rather than exposing them.**

---

## 14. The consolidated register of open decisions, legal questions, unknown facts and roles

**This is the only list.** Parts 1 and 2 point here rather than repeating anything, so a decision cannot be
answered in one place and left open in another. Reference codes are stable and are used throughout the
document: `OB` blocking owner decision, `OD` owner decision with a default already applied, `OW` owner
decision for the separate refund workstream, `OA` owner decision for the adjacent website workstream, `OR`
roles, `L` legal, `U` fact to confirm.

### 14.1 Blocking owner decisions, before any code

Numbered so they can be answered "OB1 yes, OB2 the second option". Each carries a recommendation, which is
what happens by default where it is safe to proceed.

| # | Question | Recommendation | Where it bites |
|---|---|---|---|
| **OB1** | **Do you confirm the Phase 1 cut line: booker-only for Christmas 2026, delegated guest contacts afterwards, and the deposit refund as a separate workstream?** | **Yes.** It removes the STOP defect, the customer-creation trap and the whole third-party messaging surface from the first Christmas, and it still delivers per-cover food choices the kitchen can cook from. The cost is that the booker types everyone's choices: for a party of twelve, twelve names and up to thirty-six dish picks on one form | Part 1 §5, Part 2 §0.1, Part 3 §13 |
| **OB2** | **Does a one-course guest pre-order at all?** Owner answer O4 says every cover picks a main. Published website copy says one course is pre-book only with **no** pre-order, and that statement is **enforced by a passing test**, not merely written down. The website also models courses as a party-level tier while O4 models them per cover: those are different commercial products | **O4 wins.** It is the later decision (2026-08-04 against 2026-07-21) and it is what the kitchen needs. **This changes how the Christmas offer is sold, so it cannot be a developer decision.** If confirmed, the eleven files enumerated in Part 1 §6.4 change in one commit. **Do not start the website work until this is settled.** AMS Phase 1 proceeds meanwhile, because AMS is per-cover in every reading | Part 1 §6.4, Part 3 §12.2 T56 |
| **OB3** | **Do you accept the retention split:** dish and cover counts kept 2 years as you asked, but phone numbers, names and dietary notes deleted at 60 to 90 days? | **Yes.** Your stated planning purpose is fully served by the counts. Holding the personal data for two years adds risk and buys nothing | §5.1, §5.2 |
| **OB4** | **Finding F08: what does a food price mean to a guest?** The menu carries prices and the pre-order shows dishes | **No money is taken at pre-order time.** Prices are shown for information only, `item_price_gbp` is a snapshot for the kitchen and margin reporting, and the deposit rules are unchanged. Until this is confirmed, `prices_are_indicative` stays true and **the website must not total item prices** | Part 1 §10.5, Part 2 §7.6.1, §7.3 |
| **OB5** | **Confirm `min_party_size = 6`, `min_notice_hours = 24`, `preorder_cutoff_days = 7`** for Christmas 2026 | **Confirm only.** 6 and 24 are already owner-confirmed from July. Tell us only if you have changed your mind, because it changes the backfill scope and every volume number | §8.3 check 15, §9.3 |
| **OB6** | **Amend or delete `tasks/seasonal-amendment-deposit-decision-2026-08-03.md`**, which now records a superseded decision | **Add a superseded-by line naming your 2026-08-04 answer.** A stale committed decision record is worse than none, because the next developer will find it and build to it | Part 1 §4.1, §7.1 |

### 14.2 Owner decisions with a default already applied

Answered so work is not blocked. **Each is reversible: a settings change or a one-line edit, not a
rebuild.** Tell us only where you disagree.

| # | Question | Default applied | Where |
|---|---|---|---|
| **OD1** | The cutoff hour | **12:00 noon London**, held in a settings column so changing it is a settings edit and not a deploy. Existing orders keep the `cutoff_at` they were created with | Part 1 §10.2.2, §2.3 |
| **OD2** | Hard or soft cutoff for the guest | **Hard.** The kitchen buys food against these numbers, and a guest needing a late change should reach a person. The link still resolves and renders read-only | Part 1 §10.2.3, Part 2 §3.3, §12.5 |
| **OD3** | Chase cadence when a 7-day cutoff collapses the ladder | `chase_anchor = 'cutoff'` with `{7,3}` on the Christmas row, so chases land 14 and 10 days before service and the kitchen keeps its 7 days. **Column defaults stay `'booking'` and `{7,4}`**, which is the safe value for an unconfigured period | Part 1 §12.2, §2.4 |
| **OD4** | Does "four messages" mean occasions or transmissions? | **Four occasions.** A booker who ignores everything receives seven items across four occasions: four SMS and three emails. That is the honest number | §2.10 |
| **OD5** | Should the booker be told every time a guest changes a choice? | **No.** A family of six would generate a stream of texts about nothing, at our cost | §2.12, Part 2 §3.6 |
| **OD6** | Withdrawal confirmation threshold | **10 distinct contacts**, a settings key `preorder_withdrawal_confirm_threshold`, because it is a judgement about text messages and not a technical limit | §2.11, Part 2 §7.6.9 |
| **OD7** | The dietary picklist | **The ten codes in §4.3**, closed in the database so a manager cannot silently change the data class of the column | Part 1 §10.4.1, §4.3 |
| **OD8** | Add the "call us if it is serious" line to the confirmation email and SMS as well as the web page? | **Yes.** It is the single highest-value safety line in the journey and costs nothing | §4.3, §2.13 |
| **OD9** | Sides, drinks or "other" per cover | **No. Starter, main and dessert only**, even though the menu table permits the other three course values | Part 1 §10.5, Part 2 §5.5 |
| **OD10** | Live bookings when a course is added to the menu later | **Leave them alone.** Re-baselining is a deliberate, previewed, confirmed action through `preorder_rebaseline_course_set` | Part 1 §14.2 C6, §12.4 |
| **OD11** | May the booker see another contact's choices? | **Counts only**, never a name, number, dish or note. Phase 2 question; in Phase 1 the booker owns every cover | §13.6, Part 2 §7.6.3 |
| **OD12** | May a guest link be reused until expiry? | **Yes, reusable.** A single-use timestamp would be wrong for a link a booker returns to. Note this differs from the existing single-use feedback token | Part 1 §10.7, Part 2 §6.3 |
| **OD13** | Who signs a pre-order off? | **The duty manager, meaning anyone with `table_bookings.manage`.** Not the kitchen: their job is to cook what is signed off | Part 2 §5.10 |
| **OD14** | May a manager sign off an incomplete order? | **Yes, with a typed reason**, stored in `checked_note` and printed on the sheet. Refusing outright pushes staff into pretending | Part 2 §5.10 |
| **OD15** | May staff add a pre-order to a booking taken without one? | **Yes, Phase 1**, as a small staff action that records the food side, shows a deposit warning and changes no money | Part 1 §10.2.1, Part 2 §4 |
| **OD16** | A nightly job to close orders never marked served? | **Not in Phase 1.** `served` is therefore not a trustworthy "service happened" signal and nothing may depend on it | Part 2 §2.7 |
| **OD17** | May the booker choose who is removed in a shrink? | **No in Phase 1.** The deterministic rank order stands. Staff can drop a specific cover as `staff_removed` and then shrink | Part 1 §10.6 |
| **OD18** | Table grants: RPC-only, or full service-role DML? | **Follow the established project pattern, full DML to `service_role`.** The deferred triggers still hold the invariants at commit | Part 1 §11.6 |
| **OD19** | Suppress single-booking aggregate rows? | **No in version one.** The aggregate is therefore **not certified anonymous** and nobody should later assume it is | Part 1 §10.10, §5.2 |
| **OD20** | A separate "who may edit food choices" permission? | **No. Reuse `table_bookings.edit`.** Anyone who can change a party size can already do more damage, and a new permission row means a grant migration | Part 2 §7.3 |
| **OD21** | Does a soft marketing opt-out block a food-choice chase? | **No.** Treat it as a service message about the guest's own booking. **A hard `opted_out` status always wins, on every channel, forever** | §3.4 |
| **OD22** | Who owns `manager@the-anchor.pub`, who else reads it, and what is its retention? | **Assume several readers and indefinite retention**, which is what §11.5 already designs for | §11.5, `U3` |
| **OD23** | UK and Irish mobiles only for guest numbers? | **Yes.** Phase 2 only. International SMS also carries a materially higher per-message cost | §13.2 |

### 14.3 Owner decisions for the separate refund workstream

**Not Christmas work.** These become live only when the §7 workstream starts.

| # | Question | Recommendation | Where |
|---|---|---|---|
| **OW1** | **Does the seasonal "no refund inside N days" promise also block an automatic shrink refund?** | **Yes, block it.** Otherwise anyone can book twenty, pay, shrink to six the day before and recover most of the deposit, which defeats the published cutoff entirely. A manager can still override with a recorded reason. **If you reject this, the guest-facing refund sentence must be rewritten to say so**, or the pub is enforcing terms it does not publish | §7.9 |
| **OW2** | Record a lost chargeback as a manual refund row? | **Yes.** It is the only way the arithmetic can see the money has gone. **Confirm with the accountant** | §7.5 |
| **OW3** | Who owns the manual-refund queue when PayPal refuses, and what do we promise the guest? | **Manager mailbox, target next working day, tell the guest five working days**, so the promise is beatable. Whichever you pick must appear in the guest-facing copy | §7.11 |

### 14.4 Owner decision for the adjacent website workstream

| # | Question | Recommendation | Where |
|---|---|---|---|
| **OA1** | Was the analytics gate for retiring the four-step booking flow knowingly waived, or only the UI rollback? | **Full waiver, with the compensating absolute watches built rather than merely specified.** **Read the production value of `booking_options_step1` (`U8`) before answering**, because it decides whether you are giving up a measurement of a change guests have already lived through, or the only safety net on a journey no real guest has seen | §10.3.1, §10.4, §11.3 |

### 14.5 Legal decisions: not the owner's alone and not a developer's at all

**Ask L1, L2, L3 and L6 in one conversation, before schema approval. The schema works either way, so this
does not block the October date.**

| # | Decision | Who decides | Blocks |
|---|---|---|---|
| **L1** | The documented **Article 6** lawful basis for pre-order data, including third-party names | Owner with a data protection adviser or solicitor | Privacy notice wording, schema approval |
| **L2** | Whether the structured dietary list and the capped note are special-category data here and, if so, which **Article 9 condition** applies. Explicit consent is the obvious candidate but carries its own conditions: freely given, specific, informed, withdrawable, and not a precondition of the booking | Adviser or solicitor. **Not the developer, not this document** | Whether `dietary_note` free text is collected through a web form at all. **Nothing structural: the field ships either way with no migration** |
| **L3** | Whether a **DPIA** is required. Third-party data obtained without contacting the subject first, plus possible health data, plus automated chasing, is a plausible trigger. The ICO screening checklist is the right instrument | Same as L2 | Release sign-off. Cheap early, expensive to retrofit |
| **L4** | Whether an **Article 14** notice is owed to guests whose numbers the booker supplied, and whether a link to a short notice in the first SMS satisfies it | Same as L2 | The wording of the first guest SMS. **Phase 2 only** |
| **L5** | **Privacy notice update** covering per-cover dietary data, the retention periods in §5 and the subject-access route in §6. **VERIFIED: the live notice contains no occurrence of "allergy", "allergies", "dietary", "health", "special category", "Article 9" or "retention".** This gap applies to what the pub **already does today**, not only to this feature | Owner, drafted with adviser input | Go-live, both phases |
| **L6** | **Food-safety retention need.** Does the pub need to show what it was told about an allergy after the meal, for an EHO query or an insurance claim? | Owner with their food-safety adviser and insurer | The dietary row of §5.1: **90 days if yes, cut to 14 if no** |
| **L7** | Who may see cover-level allergy free text. The current design says every staff user with `table_bookings` view, on a detail view only | Owner with adviser input | Only the allergy rows of §4.4 and Part 2 §8 change |
| **L8** | Whether the pre-existing booking-level `table_bookings.allergies` and `dietary_requirements` join the controlled list | Same as L2 | Nothing in this feature. Raise it in the same conversation |

### 14.6 Facts a developer must confirm before build

**Not decisions.** Consolidated because they were scattered across six drafts.

| # | Fact | Gates |
|---|---|---|
| U1 | Whether Twilio delivery status callbacks for a send with no customer id land in `webhook_logs` (they carry `to_number`, and if they do they are covered by the existing 24-month cron) | The retention claim in §5.2 |
| U2 | Twilio inbound STOP support in production, and the account's message-body retention | §5.5, §13.3 |
| U3 | Microsoft 365 mailbox retention and deleted-item recovery on `manager@the-anchor.pub` | §11.5, `OD22` |
| **U4** | **The Supabase plan's PITR window and backup retention. This bounds every deletion promise in §5** | Every subject-access response must say "deleted from live systems within X days and from backups within Y", never a bare "deleted" |
| U5 | The production value of `EMAIL_PROVIDER` (`.env.example` says `graph`, which was read, not the Vercel environment) | Whether the email delivery states in §3.6 are reachable at all |
| U6 | Production SMS safety limits, and whether `TWILIO_MESSAGING_SERVICE_SID` is set | The deferral thresholds in §3.5 |
| U7 | The production row count of `public.messages` | Whether the reconciler's `metadata ->> 'stage'` index must be created `CONCURRENTLY` in its own migration |
| **U8** | **The production value of the `website_ui_flags` row, key `booking_options_step1`** | How big the four-step deletion is and how much the analytics waiver costs (`OA1`). **The most easily missed check** |
| U9 | The production deployment state of both repos (`vercel ls`, not merge state) | Preflight checks 1 and 2 |
| U10 | The website production API key's current permission scope. It **must not** hold `write:preorders` before Phase 2 ships | Part 2 §7.3 |
| U11 | `table_bookings` and `booking_period_menu_items` row counts | Whether M0 and M1's constraints are safe to run inline (Part 1 §13) |
| U12 | Whether the target PostgreSQL version accepts a `WHEN` clause on a `CONSTRAINT TRIGGER` | Part 1 §11.2. If not, drop the `WHEN` and put the early return in the function body |
| U13 | Peak seasonal bookings and covers on the busiest service day | The print cap and the capacity budgets in Part 1 §5.6 |
| U14 | Whether the kitchen has any screen, or paper is the only output | The relative priority of surface S2 against S3 |
| U15 | Whether the existing `manual_review` path raises anything a manager actually sees today | Whether the interim alert in §7.2 is new work or a rename |
| U19 | Whether `pgcrypto` is installed in production (deliberately avoided: `md5` for fingerprints, Node for tokens) | Nothing, if the avoidance holds. Confirm anyway |
| U20 | Vercel request-log retention | Part 2 §6.8, which bounds the token-in-URL exposure |

**For the §7 refund workstream only:**

| # | Fact | Gates |
|---|---|---|
| U16 | The live PayPal merchant refund window (**the 180 days is our own hardcoded constant, not a confirmed limit**) and whether the account is subscribed to `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.REFUND.PENDING` and `PAYMENT.REFUND.FAILED` | Whether refunds stall in `settling` until the 6-hour sweep |
| U17 | The permission actually granted to `refund` in production (it was **seeded to super_admin only**) | Who can run a manual refund |
| **U18** | **How many table deposits in the last 12 months were captured by Stripe rather than PayPal** | Whether an automatic partial-Stripe-refund path joins the workstream. **Near zero means `manual_review` is right and the scope is smaller. Do not guess this** |

### 14.7 Roles a specification cannot fill

| # | Item | Note |
|---|---|---|
| **OR1** | Name the six delivery roles: product owner, developer, privacy owner (likely external), payment owner, operational approver, and a **named kitchen representative** | **Cannot come from a spec.** The kitchen representative signs that the printed output is usable. That is the F01 acceptance gate and preflight check 9, and it is **not** a developer sign-off |

### 14.8 Two things this document deliberately does not close

1. **The final marketing wording** for the guest-facing copy slots in §12.5. The slots, the versioning and
   the error states are specified and testable. The words are the owner's, and the dietary field's helper
   text is legal's (`L2`).
2. **Effort estimates.** Finding F42 asked for them. They are not given, because effort belongs to the
   third-party developer who will do the work. The developer should return estimates against the Phase 1
   line in Part 1 §5.2.
