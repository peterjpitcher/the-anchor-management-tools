# Disposition: the two 2026-07-28 reviews

Reviews: `table-prioritisation-codex-review-report-2026-07-28.md` (14 findings, branch)
and `table-prioritisation-website-spec-codex-review-2026-07-28.md` (29 findings, website spec).

**Verdict: both are right, and I am accepting essentially all of it.**

The previous two reviews each contained false positives I had to rebut. **I sampled seven findings from
these two and reproduced every one.** I have not found a single thing to push back on. That changes how I
am treating them: not as claims to adjudicate, but as a work list.

---

## Verified myself, not taken on trust

| Finding | Claim | Result |
|---------|-------|--------|
| **F1** (P0) | A manager saving `hold_release_lead_hours = 24.5` is accepted, then every allocation call fails | **Confirmed.** Save returns `ok:true`; the next picker call dies on `invalid input syntax for type integer: "24.5"`. One allowed action stops all bookings |
| **F4** (P1) | A walk-in-held table is wrongly removed from joined combinations | **Confirmed.** Online party of 7, Dining Room privately blocked, Low 4a held: **zero candidates**. My own spec promised the opposite |
| **F7** (P1) | A cancelled event booking still blocks a table | **Confirmed.** Returns `table_communal` for a cancelled event allocation |
| **CR-01** (P0) | The live form has no food/drinks control and derives purpose from the slot | **Confirmed.** `deriveSubmitPurpose()` infers it from `kitchen_open` **after** availability |
| **CR-14** (P1) | AMS create hard-codes a party maximum of 20 | **Confirmed.** `route.ts:56` is `z.number().int().min(1).max(20)`, so a staff booking of 40 is rejected at the route before reaching the RPC |
| **CR-19** (P1) | The website client returns `501 NOT_SUPPORTED` for lookup and cancel | **Confirmed**, `lib/api/client.ts:1180,1194`. Journeys 4 and 5 of my test spec could never have passed |
| **CR-27** (P2) | My claim that unset AMS CORS defaults to `*` is wrong | **Confirmed, and I was wrong.** `src/lib/api/auth.ts:136` sets `DEFAULT_CORS_ALLOWED_ORIGIN = 'https://www.the-anchor.pub'`. My note came from a March 2026 memory that the code has since outgrown |

## The three that matter most

**F1 is the worst thing on the branch.** A manager typing a decimal into a settings box takes the whole
booking system down until someone repairs the row by hand. It is a two-line fix and it should never have
got past me, because I wrote both the validator and the unguarded cast.

**CR-01 breaks the central premise of the website work.** The customer never chooses food or drinks. The
system infers it from whether the kitchen is open at the slot they picked. That inference happens *after*
availability, and the whole point of the new design is that food and drinks now go to opposite ends of the
pub. You cannot compute availability without knowing purpose, so the form needs a real choice on the
first step. That is a product decision, not just a code change.

**F8 is the subtlest.** I changed the liveness rule in the picker and the event allocator, but the
production integrity triggers still use the old one. So the picker can select a table the trigger will
then reject, and the booking fails instead of trying the next table. That is the same class of defect as
the private-booking bug this whole project exists to fix, reintroduced by me at a different layer.

## What I disagree with, and it is small

Nothing material. Two notes rather than objections:

- **F14** (rejected reason rows are incomplete) is correct but is partly by design: excluding capacity and
  minimum party size from `scored.reason` is what makes combinations work at all, which is a bug the
  reviewer's own F4/F6 analysis depends on. The fix is to report those reasons for *singles* without
  reintroducing them as combination filters, exactly as suggested.
- **CR-07** calls my production journey suite unsafe. It is, and the criticism is fair: I specified
  something that fills the bar, takes the last table and exercises live deposits against real inventory.
  A "future quiet date" is still sellable. Accepting the split into deterministic staging plus one bounded
  production smoke.

---

## Fix order

Ordered by whether it can hurt a customer, not by review order.

**Blocking, and purely mechanical (no decisions needed):**

1. **F1** typed settings validation, integer keys reject non-integers, guarded reads with coded defaults.
   Also `reserve < pace`, partial turn-time updates merged against stored values, and the `IMMUTABLE`
   validator corrected to `STABLE`.
2. **F9** reject outside-capacity decreases in the generic settings RPC until the re-cost workflow exists.
3. **F7** join communal allocations to `bookings` and apply `is_active_event_booking_for_capacity_v01`.
4. **F2** `table_is_held` takes the full window, with overnight and DST handling.
5. **F3** the event allocator honours maintenance blocks.
6. **F4** split eligibility into `valid_for_single` and `valid_for_combination`.
7. **F6** replace the recursive pruning with complete canonical subset enumeration, then a connectivity
   check. At ten tables that is 1,023 subsets, so the simpler complete algorithm wins on both correctness
   and clarity.
8. **F5** drop the eight-table cap; derive it from the valid table count.
9. **F10** promote an exact preferred combination, not just preferred singles.
10. **F12, F13** real fingerprint and floor preflights that abort, with the v01 fingerprint captured.
11. **F14** reason rows for rejected singles.
12. **F8** a migration bringing both integrity triggers onto the shared liveness predicate. This is the
    one with production blast radius, so it goes last in the SQL batch and gets its own review.

**Blocking, but needs a decision from you:**

13. **CR-01** food or drinks as an explicit first-step choice.
14. **CR-11** are high chairs a hard requirement or a preference the customer can accept a shortfall on.
15. **CR-12** is "outside" a strict area or a preference, and is the unheated claim right for all five.
16. **CR-19** is self-service cancellation in scope at all, given it currently returns 501.
17. **CR-18** who is meant to verify the Turnstile token, and who is allowed to call the agent endpoint.

**Blocking before any activation, but not before coding:**

18. **CR-04** freeze one normative schema. The two specs already disagree on `contract_version`,
    `calculation_state` and the outside field name.
19. **CR-07** rebuild the journey suite as deterministic staging plus a bounded production smoke.
20. **CR-05** the compatibility matrix, so availability and create can never run on different allocators.
21. **F/backtest** rerun against the final priorities and commit the fixture. The current backtest was run
    before the food order was reversed, so its headline numbers do not describe the branch as it stands.

**Corrections to my own documents:**

22. CORS: default is `https://www.the-anchor.pub`, not `*`. Fix the spec and the stale memory note.
23. Website spec header, `BookingConfirmation` rows and open question 1 are stale post-deletion.
24. Task G5 already voided; `app/api/business/hours/route.ts` is a proxy, not a slot builder.

---

## Activation gate

Adopting the reviewer's gate unchanged. Nothing turns on until every P0 and P1 is closed, the harness
installs the real integrity triggers, selection-then-insert is proven for every liveness state, the
backtest is rerun reproducibly against final priorities, and two concurrent transactions provably cannot
take the last table.

## The honest summary

The core design survives both reviews. Nobody has argued the two opposed house orders are wrong, and the
ranking model is sound. What is wrong is completeness: the picker does not agree with the enforcement
triggers, the settings gate lets a manager break everything, held tables leak out of combinations, and the
evidence I produced was optimistic. That is a fixable list, but it is a real one, and the branch is
further from done than it looked yesterday.
