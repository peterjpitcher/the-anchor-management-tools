# Execution plan — Multiple ticket options per event (strict, single release)

Spec: `tasks/event-ticket-options-spec.md` (v3.1). Strategy: **Option S** — DB-enforced
seat-sum invariant + every booking/seat writer maintains `booking_items`, shipped together.

**Final decisions (2026-07-02):**
1. A ticket type with `price > 0` ⇒ the event is **not free** (must be `prepaid` or `cash_only`);
   on a free event all types are £0. Admin validation enforces this.
2. **Staff manual bookings support the multi-type picker too** (admin + website both).
3. Communal/mixed events stay single-price (no ticket types).
4. Do everything: build → verify → apply migration to prod → deploy.
5. Finish all changes, then **build, commit, merge to main, push** (both repos). Website is a
   manual deploy — push then deploy.

**DESIGN SHIFT (2026-07-02) — trigger-driven default line, resolves the deploy-ordering trap:**
Instead of editing all ~10 payment RPCs, add `sync_booking_default_item_v01(booking_id)` + an
`AFTER INSERT OR UPDATE OF seats` trigger on `bookings` that auto-maintains a single mirror
default-type line for every non-reminder single-type booking. Result:
- Existing RPCs (v05/v06, seat edits, waitlist, communal, walk-in) are **untouched** — the
  trigger keeps their bookings consistent automatically.
- The migration is **backward-compatible on its own**: already-deployed code keeps working and
  its bookings get mirror lines → **no coordinated apply+deploy needed**; the migration can ship
  and apply independently of the app changes.
- The charge path keeps computing from the event price for single-type bookings (unchanged);
  only multi-type (flag ON) sums line items.
- Multi-type create = new `create_event_booking_v07` (sets a `ams.skip_default_item` guard,
  inserts real per-line items + names). Dormant until the flag is ON.
- Enforcement (deferred seat-sum triggers) added AFTER backfill so data is already consistent.

**Ground rules**
- Build in verifiable increments (lint → typecheck → test → build after each chunk); **ship as
  one release** so no booking path is left without `booking_items`.
- **Do not apply the migration to prod** until reviewed + explicitly approved. Prod apply is via
  Supabase MCP `apply_migration`.
- Two repos: **AMS** (`OJ-AnchorManagementTools`, auto-deploys `main`) and **SITE**
  (`OJ-The-Anchor.pub`, manual deploy). AMS ships first; flag stays OFF until SITE is live.

---

## Stage 0 — RPC internals discovery (DONE 2026-07-02)
- [x] 0.1 Mapped all writers (findings below).
- [x] 0.2 `bookings.attendee_names` written by a **direct `.update()` after** the create RPC in
      `src/app/api/event-bookings/route.ts:167` (normalised via `src/lib/events/attendee-names.ts`);
      **not** via RPC. → items+names must move into the create transaction.
- [x] 0.3 Successful payment status = **`'succeeded'`** (set by `confirm_event_payment_v05` /
      `confirm_event_paypal_payment_v01`). Backfill prepaid = `charge_type='prepaid_event' AND
      amount>0` (catches the 2 now-refunded rows too).
- [x] 0.4 Reminder-only bookings carry `seats>=1` → **exempt** from items (spec §4.3).

### Stage 0 findings — exact edit points
- **Create (core):** `create_event_booking_v05` (`…/20260611000000_communal_event_seating.sql:587`)
  INSERTs the booking (locks `events FOR UPDATE`, uses `get_event_capacity_snapshot_v05`).
  `create_event_booking_v06` (`…/20260616000002_event_ticket_paypal_payments.sql:111`) is a thin
  wrapper (hold minutes); the website API calls **v06**.
- **DECISION — new `create_event_booking_v07`:** accepts `p_ticket_selections jsonb`
  (`[{ticket_type_id, quantity, attendee_names[]}]`), does booking + `booking_items` + aggregate
  `attendee_names` **in one transaction** under the events lock. The API route calls v07 and
  **drops the separate attendee_names `.update()`**. v05 is modified to also insert a single
  default-type item so all its other callers satisfy the trigger.
- **Seat edits:** `update_event_booking_seats_v05` (guest, `…/20260421000002…:604`),
  `_staff_v05` (`…/20260611000000…:908`) — single-type: scale the one item; multi-type: block.
- **Seat increase (two-phase):** `apply_event_seat_increase_payment_v05`
  (`…/20260421000002…:922`) records a payment; the actual `bookings.seats` bump happens at
  payment confirmation — **TRACE the exact seat-bump point and adjust the item there.**
- **Waitlist:** `accept_waitlist_offer_v05` (`…/20260421000002…:1276`) own INSERT → add item.
- **Communal:** `reallocate_event_communal_booking_v01` (`…/20260611000000…:864`, `:1034`)
  updates seats → adjust item; `allocate_event_communal_seats_v01` and
  `convert_…_to_communal_v01` don't change `seats` → no item change.
- **Walk-in:** `register_guest_transaction`
  (`…/20260421000004_fix_register_guest_transaction…:6`) INSERTs seats=1 → add default item.
- **Capacity:** `get_event_capacity_snapshot_v05` (`…/20260611000000…:405`) returns
  confirmed/held/waitlist/seated/standing remaining — leave as-is; add per-type function.
  `is_active_event_booking_for_capacity_v01` (`…:57`): active = `confirmed` OR
  (`pending_payment` AND hold not expired) — reuse.

### PROGRESS (turn 1)
- [x] Migration (3 files): tables/RLS/capacity fn, sync-trigger + v07, backfill + enforcement.
      Trigger-driven; backward-compatible; self-checking. Discount gated to prepaid. NOT applied.
- [x] `src/lib/events/ticket-types.ts` — flag (`EVENT_TICKET_TYPES_ENABLED`), types, price/charge helpers.
- [x] `src/app/actions/eventTicketTypes.ts` — CRUD (flag-gated, RBAC, audit, dedicated-cap validation).
- [x] `npx tsc --noEmit` → 0 errors (whole repo).
- [~] Website layer — background agent building (booking form, price displays, JSON-LD).

### PROGRESS (turn 2 — AMS app code, flag OFF, NOT committed)
- [x] Event serializer exposes `ticket_types` (flag-gated, omitted when off): `src/app/api/events/[id]/route.ts`
      + new fetch helper `src/lib/events/ticket-type-queries.ts` (loadEventTicketTypeDTOs).
- [x] Booking API accepts `ticket_selections`, flag-off rejection of multi/non-default, per-line
      attendee-name validation for paid events, routes to v07: `src/app/api/event-bookings/route.ts`.
      Pure decision helper `decideTicketSelectionHandling` (unit-tested).
- [x] Service v06/v07 branch + skip separate attendee_names update on v07: `src/services/event-bookings.ts`.
- [x] Charge path sums booking_items for multi-type bookings (else legacy event-price):
      `src/lib/events/event-payments.ts` (both PayPal previews). PayPal create/capture logic untouched.
- [x] Admin editor: `src/app/(authenticated)/events/[id]/EventTicketTypesCard.tsx` (list/add/edit/
      activate/deactivate/remove) wired into EventDetailClient tab (hidden for communal/mixed); flag +
      initial types passed from page.tsx.
- [x] Tests: `src/lib/events/ticket-types.test.ts` (sell-price discount-once/prepaid-only/floor,
      charge sum, flag-off decision) + `src/services/__tests__/event-bookings-ticket-selections.test.ts`
      (v06 vs v07 routing). 72 event tests pass.
- [x] Verify: `npx tsc --noEmit` clean, `npm run lint` 0 warnings, `npm run build` succeeds.
- [ ] SKIPPED (item 5, lower priority): per-type breakdown blocks in confirmation email/SMS, door-list
      PDF, and staff booking detail. NOTE: attendee names already flow end-to-end (v07 writes the flat
      bookings.attendee_names aggregate; email + door-list already render it). Only the per-type
      price/name grouped breakdown UI is outstanding.
- [ ] Not done (out of task scope): commit/merge/push, apply migration, deploy.

## Stage 1 — Migration: schema + invariants (additive, no behaviour change yet)
- [ ] 1.1 `event_ticket_types` + `booking_items` (with `attendee_names text[]`), indexes,
      `UNIQUE(booking_id,ticket_type_id)`, both FKs `ON DELETE CASCADE`.
- [ ] 1.2 RLS/grants: `booking_items` → **bookings** module; `event_ticket_types` read →
      events, write → events:edit|manage; REVOKE/GRANT explicitly.
- [ ] 1.3 Deferred seat-sum constraint triggers on **both** tables (strict; tolerate
      reminder-only `seats` 0/null).
- [ ] 1.4 `get_event_ticket_type_capacity_v01(event_id)` (new; leave snapshot v05 untouched).

## Stage 2 — Migration: writers maintain booking_items (the big-bang core)
- [ ] 2.1 Creation: `create_event_booking_v0x` — accept ticket selections + per-line names,
      snapshot `unit_price`, insert items under the existing `events FOR UPDATE` lock; enforce
      event ceiling + dedicated-type caps; set `bookings.attendee_names` aggregate.
- [ ] 2.2 Seat edits: `update_event_booking_seats_v05` / `_staff_v05` — single-type scale the
      one line; multi-type **block** (spec §8.7.3).
- [ ] 2.3 `apply_event_seat_increase_payment_v05` — adjust the line item + price snapshot.
- [ ] 2.4 `accept_waitlist_offer_v05` — create the item(s) when the booking materialises.
- [ ] 2.5 Communal: `allocate/reallocate/convert…` — maintain the single default-type item.
- [ ] 2.6 Walk-in: `register_guest_transaction` / check-in insert — default-type item, qty 1.

## Stage 3 — Migration: backfill + self-checks
- [ ] 3.1 Default `Standard` type per event (`base_price = coalesce(price_per_seat,price,0)`).
- [ ] 3.2 Line items per existing booking: prepaid → from `payments.amount/seats` (reconcile
      remainder); free/cash → `resolveEventPriceAmount(event)` best-effort.
- [ ] 3.3 Self-checks (fail loudly): `Σ(quantity)=seats` all bookings; `Σ(unit_price×qty)=
      payments.amount` for prepaid.

## Stage 4 — AMS app code
- [ ] 4.1 Types: `EventTicketType`, `BookingItem`; regen generated types.
- [ ] 4.2 `pricing.ts` (base→unit, sum helper), `event-payments.ts` (charge from items;
      preview breakdown), `services/event-bookings.ts`.
- [ ] 4.3 Booking API `route.ts`: `ticket_selections[{ticket_type_id,quantity,attendee_names}]`
      + legacy `seats` mapping + **flag gate at the charge boundary**.
- [ ] 4.4 PayPal create/capture from items.
- [ ] 4.5 Event GET serializer: expose `ticket_types` (flag-gated).
- [ ] 4.6 `eventTicketTypes.ts` CRUD (flag-gated) + admin editor in `EventDetailClient.tsx`
      (hidden for communal/mixed); hard oversubscription validation.
- [ ] 4.7 Emails/SMS breakdown + per-type names (`event-ticket-emails.ts`).
- [ ] 4.8 Staff detail breakdown; door-list PDF `booking-sheets/route.ts`;
      `EventListView` "from £X"; manage-booking page breakdown + refund default from
      `payments.amount`.
- [ ] 4.9 Feature-flag wiring (`EVENT_TICKET_TYPES_ENABLED`; reuse existing pattern).

## Stage 5 — SITE
- [ ] 5.1 `Event` type + pricing helpers (`event-pricing.ts`, `event-booking-experience.ts`).
- [ ] 5.2 Price displays: event page, whats-on card, RelatedEvents, OG image, category
      landings; JSON-LD per-type Offers.
- [ ] 5.3 Booking form: per-type steppers + per-type name inputs; summary/PayPal/confirmation
      breakdown; submit `ticket_selections`.
- [ ] 5.4 Proxy passthrough.

## Stage 6 — Verify & release
- [ ] 6.1 AMS: lint, typecheck, tests (incl. new: pricing, seat-writers, concurrency, flag-off,
      migration self-checks), build.
- [ ] 6.2 SITE: lint, typecheck, tests, build.
- [ ] 6.3 Migration: dry-run / apply on a **branch DB**; confirm self-checks pass; review SQL.
- [ ] 6.4 Ship AMS (flag OFF) → deploy SITE (manual) → flip `EVENT_TICKET_TYPES_ENABLED` ON,
      pilot on one event.

---

## Risks / watch-items
- Big-bang touches ~10 mature payment RPCs — highest-risk area; each needs its own test.
- `bookings.attendee_names` write path (Stage 0.2) must be found before wiring per-line names.
- Communal/mixed modes: keep single default type; do not break seated/standing allocation.
- Prod apply gated on approval; keep the release revertible per spec §13 (flag OFF pre-launch).
