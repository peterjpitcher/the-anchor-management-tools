# Spec: Multiple Ticket Options per Event (v3)

**Status:** Draft for review — no code written yet. v3 folds in a 25-finding adversarial
review (all confirmed against real code).
**Author:** Claude (with Peter)
**Date:** 2026-07-02
**Complexity:** 5 (XL) — cross-repo, schema, payment path, feature-flagged rollout.

> File/line references are pointers from discovery — verify against `main` before editing.
> Repos: **AMS** = `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools`,
> **SITE** = `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub`.

---

## 0. Changelog

**v3.1 (decisions locked, building):** Q2 per-type capacity = yes; Q3 discount = applies to
all types; Q5 = cash & free events included; Q8 = per-type seat edits. **Q1 changed —
attendee names are now captured per ticket line** (`booking_items.attendee_names`), so we
always know which name holds which ticket type (§2 D3, §4.2, §6.3, §8.1, §10). Proceeding with
Phase 1 (AMS).

**v3 (post adversarial review):**
- **Price backfill fixed** — prepaid `unit_price` comes from the authoritative
  `payments.amount`, not the event's mutable price (§4.4, §5).
- **All `bookings.seats` writers enumerated** — website API, staff manual booking, seat-edit
  RPCs, walk-in check-in, transfers — each must maintain `booking_items` atomically (§8.7, §16).
- **FK on `ticket_type_id` is `ON DELETE CASCADE`** (not RESTRICT) so event/customer deletion
  still works; "no hard-delete of a referenced type" enforced in the app layer (§4.2, §9).
- **Symmetric seat-sum guard** on `bookings` (not "optional") so seat-amend paths can't
  desync (§4.3).
- **Flag made load-bearing at the charge boundary** — with the flag off the booking RPC
  rejects multi/non-default selections, and the type-CRUD actions are server-gated (§11, §13).
- **Capacity corrected** — a *new* per-type function (don't overload the SETOF snapshot);
  event remaining derived from the existing snapshot (incl. waitlist holds); oversubscription
  is a hard save-time validation (§6).
- **Creation path corrected** — it is already a single locking RPC; we extend it (§3, §6.3).
- **`seats:1` reclassified** — dead fallbacks, not SMS bugs; the real walk-in gap is a missing
  `booking_items` row (§8.3, §8.5).
- **6 missed display surfaces added** (§10, §16).

**v2:** price model, rollback wording, rollout gate, communal behaviour, capacity rules, data
integrity, downstream surfaces, expanded tests.

---

## 1. Goal & scope

Let one event sell **several ticket types** (Adult / Child / Concession, Early bird /
Standard / VIP, …), each with its own **name and base price**, optionally its own
**capacity**. A customer buys a **mixed basket in one booking and one payment**.

**In scope:** data model (ticket types + per-booking line items), server-side
pricing/capacity/concurrency, PayPal, admin UI, public booking form + price display, and
every downstream reader of a booking's seats/amount. Feature-flagged, backward-compatible.

**Out of scope (v1):** per-type attendee-name grouping (names stay flat — §12 Q1); per-type
waitlists; ticket types on **communal** seated/standing events (§7); discount codes beyond the
existing event-level online discount; per-type min/max rules (§12 Q6).

---

## 2. Decisions locked in

| # | Decision | Choice |
|---|----------|--------|
| D1 | Basket model | Mixed basket — one booking, many line items |
| D2 | Price integrity | Type = **base** (list) price; line `unit_price` = **final charged** snapshot; discount applied **once**, at creation. For prepaid bookings the snapshot is reconciled to `payments.amount`. |
| D3 | Attendee names | **Captured per ticket line** — we always know which name maps to which ticket type (stored on `booking_items`); `bookings.attendee_names` kept as the flat aggregate for back-compat |
| D4 | Per-type capacity | Optional (`null` = shared event pool); `events.capacity` is the hard ceiling |
| D5 | Backward compat | Default type per event + one line item per existing booking (backfill from `payments.amount` for prepaid) → single pricing path |
| D6 | Rollout | Feature flag is **load-bearing at the charge boundary**; multi-type impossible until the flag is on (§11) |
| D7 | Communal events | Uniform backfill but permanently single-type; seated/standing unchanged (§7) |
| D8 | `bookings.seats` | Denormalised total (= `Σ quantity`), enforced by triggers on **both** `booking_items` and `bookings` — so every seat-writer must keep items in sync (§4.3, §8.7) |

---

## 3. Current-state architecture (as discovered)

### AMS — source of truth
- **`events`** pricing/capacity: `capacity int`, `price numeric(10,2)`,
  `price_per_seat numeric(10,2)`, `price_currency varchar(3)`, `is_free bool`,
  `payment_mode (free|cash_only|prepaid)`, `booking_mode` (incl. communal/seated-standing),
  `online_discount_type ('fixed'|'percent')`, `online_discount_value numeric(10,2)`. All
  mutable post-booking via `updateEvent`→`normalizeEventPricingFields`
  (`src/app/actions/events.ts:~291-321`).
- **`bookings`**: `id, customer_id, event_id, seats int, status
  (pending_payment|confirmed|expired|cancelled), hold_expires_at, seating_preference,
  attendee_names jsonb, is_reminder_only`. **No stored per-seat price** — the only charge
  record is `payments.amount` (`charge_type='prepaid_event'`, `status='succeeded'`), set to the
  captured PayPal total in `src/lib/events/event-payments.ts`.
- **Creation is already a single locking RPC** — `create_event_booking_v0x` locks the
  `events` row `FOR UPDATE`, checks capacity, inserts the booking, and returns the snapshot.
  (So concurrency is already handled; we **extend** this RPC, we do not build a new lock.)
- **Amount:** `src/lib/events/event-payments.ts` — `resolveEventPriceAmount(event) × seats`.
- **Price resolution:** `src/lib/events/pricing.ts` → `resolveEventPriceAmount()`
  (base − event discount) — reads the event's **current mutable** fields.
- **PayPal (server-recomputed):**
  `src/app/api/external/event-bookings/[id]/paypal/{create,capture}-order/route.ts` →
  `create/captureEventPayPalOrderByBookingId()` via `getEventPaymentPreviewByBookingId()`.
- **Capacity:** RPC `get_event_capacity_snapshot_v05()` — returns event-level SETOF rows
  (incl. waitlist-hold accounting), consumed by ~6 callers. **No ticket-type dimension.**
- **Admin:** `src/app/(authenticated)/events/[id]/EventDetailClient.tsx`.
- **Types:** `src/types/database.ts`, `src/types/database.generated.ts`.

### SITE — thin proxy
- Event page `app/events/[id]/page.tsx`; listing `app/whats-on/page.tsx` +
  `_components/RegularEventCard.tsx`; related `components/events/RelatedEvents.tsx`; OG image
  `app/events/[id]/opengraph-image.tsx`; category landings e.g. `app/music-bingo/page.tsx`;
  JSON-LD `lib/structured-data/event-schema.ts`; shared label `lib/event-pricing.ts`
  (`getEventPriceLabel`).
- Booking form `components/features/EventBooking/ManagementEventBookingForm.tsx` (single `seats`).
- Proxy `app/api/event-bookings/route.ts` → AMS `/event-bookings` (`Bearer ANCHOR_API_KEY`).
- PayPal `app/api/event-bookings/paypal/{create,capture}-order/route.ts`,
  `components/features/EventBooking/PayPalEventPaymentSection.tsx`.
- **No on-website manage-booking page** — `manage_booking_url` links to AMS; guest self-cancel
  removed. All booking-detail/breakdown UI is on the AMS side.

**Invariant to preserve:** the website never sends a trusted price; AMS recomputes every
charge server-side; `payments.amount` is the authoritative captured charge.

---

## 4. Data model (AMS)

### 4.1 `event_ticket_types` — BASE prices
```sql
create table public.event_ticket_types (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references public.events(id) on delete cascade,
  name           text not null,
  description    text,
  base_price     numeric(10,2) not null default 0 check (base_price >= 0), -- LIST price, pre-discount
  capacity       integer check (capacity is null or capacity >= 0),        -- null = shared event pool
  sort_order     integer not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index event_ticket_types_event_idx on public.event_ticket_types(event_id, sort_order);
```
- `base_price` is the mutable **list price**; edits affect **future** bookings only. Currency
  stays event-level.
- **RLS/grants:** read gated by the **`events`** module; write by `events:edit|manage`. The
  **`booking_items`** table is bookings-scoped data — gate it by the **`bookings`** module
  (view/edit/delete), *not* events. The primary write path is the **admin/service-role
  client** (RLS-bypassing) for both website-proxy and cron inserts, so **correctness rests on
  the DB constraints (§4.2–4.3), not RLS.** No anon SELECT is required (the website reads types
  via the AMS API, served by the service client). REVOKE/GRANT explicitly per the workspace
  supabase rule.

### 4.2 `booking_items` — FINAL CHARGED snapshots
```sql
create table public.booking_items (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid not null references public.bookings(id) on delete cascade,
  ticket_type_id uuid not null references public.event_ticket_types(id) on delete cascade,
  quantity       integer not null check (quantity > 0),
  unit_price     numeric(10,2) not null check (unit_price >= 0), -- FINAL charged £/seat (post-discount)
  attendee_names text[] not null default '{}',                  -- names for THIS line's seats (see below)
  created_at     timestamptz not null default now(),
  unique (booking_id, ticket_type_id)
);
create index booking_items_booking_idx on public.booking_items(booking_id);
create index booking_items_type_idx on public.booking_items(ticket_type_id);
```
- **Both FKs are `ON DELETE CASCADE`.** RESTRICT on `ticket_type_id` would collide with the
  cascade when an **event** or **customer** is deleted (the cascade can try to remove the type
  while items still reference it) and block those deletions. Cascade avoids that; deleting an
  event removes its types, bookings and items cleanly.
- The **"cannot hard-delete a ticket type that has bookings"** rule is enforced in the **app
  layer** (§9): the UI only ever offers *Deactivate* for referenced types and never issues a
  direct `DELETE` on one. (Trade-off: no DB-level block on a direct delete; acceptable because
  all writes go through the gated server actions.)
- `unit_price` is immutable after creation; total charge = `Σ(quantity × unit_price)`.
- **`attendee_names` (per line, D3):** holds the names for that line's seats, so each name is
  tied to its ticket type. For paid events `length(attendee_names) = quantity` (validated in
  the booking RPC, not the DB, to tolerate reminder/legacy rows). `bookings.attendee_names`
  (jsonb) is kept as the **flat aggregate** — populated as the ordered concatenation of the
  lines (ordered by `sort_order`) — so existing readers (email, door list) keep working
  unchanged; the per-type grouping is an additive capability on top.

### 4.3 Seat-sum invariant — enforced on BOTH sides (deferred)
```sql
create or replace function public.check_booking_seat_sum(p_booking uuid) returns void
language plpgsql as $$
declare item_sum integer; seat_count integer; reminder boolean;
begin
  select seats, is_reminder_only into seat_count, reminder from public.bookings where id = p_booking;
  if seat_count is null then return; end if;                    -- booking gone (cascade) → skip
  if reminder then return; end if;                              -- reminder-only bookings are exempt (see below)
  select coalesce(sum(quantity),0) into item_sum from public.booking_items where booking_id = p_booking;
  if item_sum <> seat_count then
    raise exception 'booking_items sum (%) != bookings.seats (%) for booking %', item_sum, seat_count, p_booking;
  end if;
end $$;

-- fires when line items change
create constraint trigger booking_items_seat_sum
  after insert or update or delete on public.booking_items
  deferrable initially deferred for each row
  execute function public.trg_check_booking_items_sum();     -- calls check_booking_seat_sum(coalesce(new,old).booking_id)

-- fires when the booking's seat count changes / on insert
create constraint trigger bookings_seat_sum
  after insert or update of seats on public.bookings
  deferrable initially deferred for each row
  execute function public.trg_check_bookings_sum();          -- calls check_booking_seat_sum(new.id)
```
- **Deferred to COMMIT** so multi-row basket inserts and paired seat/item updates validate
  together, not mid-transaction.
- The **`bookings`-side guard is not optional** — it catches any seat-writer that forgets to
  update `booking_items`, and enforces invariant 1 (a booking with `seats>0` must have items).
- **Reminder-only bookings are EXEMPT** (`is_reminder_only=true`). Verified in prod: 1,143 of
  1,482 bookings are reminder-only and carry `seats>=1` — they are reminders, not ticket
  purchases, so they get **no `booking_items`** and the trigger skips them. This keeps the
  reminder-import path untouched (§8.7) and shrinks the migration.

### 4.4 Migration & backfill (D5) — charge-accurate
One additive migration (no `DROP`):
1. Create tables, indexes, RLS/grants, both triggers.
2. **Default type per event** (every event incl. communal): `name='Standard'`,
   `base_price = coalesce(events.price_per_seat, events.price, 0)` (raw list price),
   `capacity=null`, `sort_order=0`, `is_active=true`.
3. **Backfill line items (non-reminder bookings only — `is_reminder_only=false`) — source of
   `unit_price` depends on how the booking was charged:**
   - **Prepaid bookings** (has a `payments` row `charge_type='prepaid_event'`,
     `status='succeeded'`): `unit_price` derived from the **authoritative captured charge** —
     `payments.amount / seats`, rounded per line with the remainder reconciled onto the last
     line so `Σ(quantity × unit_price) = payments.amount` exactly.
   - **Free / cash_only bookings** (no prepaid capture): `unit_price =
     resolveEventPriceAmount(event)` best-effort; documented as an **approximate** list-price
     snapshot, *not* an authoritative charge (staff/refund UI must not present it as "charged"
     for these rows — §8.4).
   `quantity = seats`, pointing at the event's default type.
4. **Self-checks (fail loudly):** `Σ(quantity)=seats` for every **non-reminder** booking;
   **and** `Σ(unit_price×quantity)=payments.amount` for every **prepaid** booking.

> Apply to prod via Supabase MCP `apply_migration` (project workflow), not `db push`.

### 4.5 Type definitions
- `src/types/database.ts`: add `EventTicketType`, `BookingItem`; extend `EventBooking` with
  `items?: BookingItem[]`, `Event` with `ticketTypes?: EventTicketType[]`.
- Regenerate `src/types/database.generated.ts`.

---

## 5. Pricing model (AMS) — one discount, one source of truth

- **Base price** on the type; **charged price** computed once at creation:
  `resolveTicketTypeUnitPrice(type, event) = max(0, base_price − eventOnlineDiscount)`,
  snapshotted into `booking_items.unit_price`.
- **`payments.amount` remains the single authoritative charge** for prepaid bookings. For
  bookings created under the new model, `payments.amount = Σ(quantity × unit_price)` **by
  construction** (the PayPal order/capture amount is computed from the line items — §7). The
  backfill (§4.4) makes the same equality hold for historical prepaid rows.
- **Downstream sums line items, never re-applies a discount:**
  `resolveBookingChargeAmount(items) = Σ(quantity × unit_price)`; `event-payments.ts` computes
  the charge from this; `getEventPaymentPreviewByBookingId()` returns the per-line breakdown.
- **Refunds/reconciliation continue to read `payments.amount`** (§8.4/§8.5). Because
  `Σ(unit_price×qty)=payments.amount` for prepaid rows, the §8.2/§8.4 breakdown/refund-default
  agree with `payments.amount`. For free/cash_only rows there is no prepaid charge, so any
  line-item total shown there is explicitly best-effort, not authoritative.

---

## 6. Capacity & concurrency (AMS)

### 6.1 Accounting model (C1 — event cap is the hard ceiling)
- **Hard ceiling:** `Σ(consumed seats) ≤ events.capacity`, where "consumed" is taken from the
  **existing** `get_event_capacity_snapshot_v05()` (which already accounts for confirmed
  bookings, unexpired `pending_payment` holds, **and waitlist holds**). Do **not** re-derive
  this total independently — call the snapshot so per-type accounting can't drift from the
  event ceiling.
- **Dedicated type** (`capacity is not null`): additionally `qty(type) ≤ type.capacity`.
- **Shared type** (`capacity is null`): draws from event remaining.

### 6.2 Per-type availability — a NEW function (don't overload the snapshot)
`get_event_capacity_snapshot_v05()` is SETOF with ~6 callers — **leave its signature
unchanged.** Add a **new** `get_event_ticket_type_capacity_v01(event_id)` returning per active
type `{ ticket_type_id, capacity_mode: 'dedicated'|'shared', remaining }`:
- **dedicated:** `remaining = min(type.capacity − usedByType, eventRemaining)`
- **shared:** `remaining = eventRemaining`, `capacity_mode='shared'` (all shared types report
  the same shared figure; the UI shows one shared "X left" line across them).
`eventRemaining` comes from the existing snapshot.

### 6.3 Extend the existing creation RPC (no new lock needed)
The current `create_event_booking_v0x` RPC already locks `events FOR UPDATE`. Extend it, under
the same lock, to:
1. Validate each selection's `ticket_type_id` belongs to the event and is active; for paid
   events validate `length(attendee_names) = quantity` per selection.
2. Check capacity for the whole basket: event ceiling **and** each dedicated type's cap.
3. Insert the booking (`seats = Σ quantity`; `bookings.attendee_names` = ordered
   concatenation of each line's `attendee_names`), then one `booking_items` row per selection
   with `unit_price = resolveTicketTypeUnitPrice(type, event)` and its `attendee_names`.

Request shape (website → AMS `/event-bookings`): `ticket_selections: [{ ticket_type_id,
quantity, attendee_names: string[] }]`. Legacy `{ seats, attendee_names }` still accepted and
mapped to the single default type.
Also lock the event's dedicated-cap type rows (`… where event_id=$1 and capacity is not null
for update`) so two baskets can't both consume the last dedicated seat.

### 6.4 Oversubscription — hard validation
`Σ(dedicated capacities) ≤ events.capacity` is a **hard save-time validation** in the
ticket-type admin actions (not a soft warning), so per-type `remaining` can never sum above the
event remaining. The booking RPC additionally clamps the basket to `eventRemaining` as a
belt-and-braces guard. Test two dedicated types racing the ceiling.

---

## 7. Communal / seated-standing events (D7)

Communal events keep seated/standing and are **permanently single-type**.
- **Backfill:** still get one default type + line items (uniform data & pricing path).
- **Admin:** ticket-types editor hidden/disabled when `booking_mode` is communal; staff edit
  the single price as today.
- **Event API:** `ticket_types` contains exactly the one default type; the website ignores it
  for communal events.
- **Website:** branch on `booking_mode` — communal ⇒ existing seated/standing chooser
  (unchanged); standard ⇒ ticket-type flow.
- **Booking:** communal bookings still send `seating_preference`; they map to the single
  default type (`quantity = seats`). Type and seated/standing are **not** combined in v1.

---

## 8. Downstream surfaces — AMS

> `bookings.seats` stays correct, so **seats-only** readers (e.g. `src/lib/events/stats.ts:54`)
> need no change. Only breakdown/charge/seat-writer surfaces change. Tags: **[BREAKDOWN]**
> wants line items · **[CHARGE]** amount path · **[SEAT-WRITER]** mutates seats, must sync items.

### 8.1 Confirmation email + SMS — [BREAKDOWN]
`src/lib/email/event-ticket-emails.ts`: `loadEventTicketEmailContext()` (L103-140, select L105)
also load `booking_items` (incl. per-line `attendee_names`); `sendEventPaymentConfirmationEmail()`
(L242-295, attendee list L273) show a per-type breakdown block **with each type's attendee names
listed under it**; `sendEventPaymentConfirmationSms()` (L318-360) compact breakdown. (Note: this
SMS **reloads the real `seats` from the DB and ignores any passed-in seat arg** — see §8.5.)

### 8.2 Staff booking detail — [BREAKDOWN]
`EventDetailClient.tsx` (L1196 seats, L1206 `formatBookingPayment` def L138) show line items;
`getEventBookings()` (`src/app/actions/events.ts:661`) also fetch `booking_items`. Paid-amount
aggregation (L698-710) keeps summing `payments.amount` (authoritative); the line-item breakdown
is display and, for prepaid, equals `payments.amount` by construction.

### 8.3 Door list / check-in — [BREAKDOWN] + [SEAT-WRITER]
- **Door-list PDF:** `src/app/api/events/[id]/booking-sheets/route.ts` reads `seats` +
  `attendee_names` — fetch `booking_items`, render the per-type breakdown, and fix/remove the
  single `resolveEventPriceAmount` per-seat price line for multi-type bookings.
- **Walk-in check-in:** `src/app/actions/event-check-in.ts:319` creates a walk-in booking with
  `seats: 1` — that value is **correct**, but the insert must **also create a `booking_items`
  row** (default type, `quantity=1`, `unit_price` per the event) or the seat-sum trigger fires.
  ([SEAT-WRITER], not the "SMS bug" v2 described.)
- Kiosk `EventCheckInClient.tsx` / `src/services/events.ts` seat aggregation — seats-based, no
  change; per-type door counts are phase 3.

### 8.4 Cancel / refund — [BREAKDOWN]
`src/lib/events/manage-booking.ts` → `requestEventRefund()` (L232-280): amount is
**manager-entered** (`roundCurrencyAmount(input.amount)` L245), idempotency-guarded (L264-265).
Core plumbing unchanged. Changes: the AMS manage-booking page shows the per-type breakdown; the
refund UI **defaults/validates against `payments.amount`** (the authoritative charge) and, for
partials, may propose the removed lines' charge. For free/cash_only bookings do **not** present
the line-item total as an authoritative "charged" figure.

### 8.5 PayPal reconciliation — [CHARGE-safe]
- Webhook `src/app/api/webhooks/paypal/event-bookings/route.ts` (L43, L145) — amount from
  PayPal; no change.
- `src/lib/events/refund-reconciliation.ts` (reads stored `payments.amount` L82) — no amount
  change; the status email may include a breakdown.
- Cron `src/app/api/cron/event-paypal-reconciliation/route.ts:94 seats:1` — **not a bug**:
  `sendEventPaymentConfirmationSms` reloads the real `seats` and ignores this arg. Optional
  cosmetic cleanup only.

### 8.6 Capacity stats — no change
`src/lib/events/stats.ts:54` sums `booking.seats` — correct.

### 8.7 All `bookings.seats` writers — [SEAT-WRITER] (must maintain `booking_items`)
Every path that inserts a booking or mutates `seats` must keep `booking_items` in sync in the
same transaction, or the §4.3 triggers will reject it. Enumerated:
1. **Website/API create** — `create_event_booking_v0x` RPC (§6.3). ✅ handled by extension.
2. **Staff manual booking** — `createEventManualBooking` (`src/app/actions/events.ts`): insert
   a `booking_items` row (default type unless the UI offers a picker). Multi-type staff bookings
   are a §12 Q decision.
3. **Seat-count edits** — `update_event_booking_seats_v05` / `..._staff_v05` (guest manage +
   staff): for a **single-type** booking, scale the sole line's `quantity` (+ resnapshot if
   price policy requires); for a **multi-type** booking, **block** raw seat edits and require
   line-item edits instead (§12 Q8).
4. **Walk-in check-in** — §8.3.
5. **Transfers / re-book to another event** (if present in `events.ts`) — move/rebuild
   `booking_items` for the new event's default type.
Each of these is added to §16.

---

## 9. Admin UI (AMS)

`EventDetailClient.tsx` — **Ticket types** editor (standard events only; hidden for communal),
**flag-gated** (§11):
- Rows: `name`, `base_price`, `capacity` (blank = shared), `active`, drag `sort_order`.
- Validation: paid event needs ≥1 active type; name required; `base_price ≥ 0`; capacity ≥ 0
  or blank; **hard** rule `Σ(dedicated capacities) ≤ events.capacity` (§6.4).
- **Delete guard (app layer):** a type with `booking_items` → offer **Deactivate**
  (`is_active=false`); never issue a direct `DELETE`. Hard delete only when unreferenced.
- New server actions `src/app/actions/eventTicketTypes.ts`:
  `create/update/deactivate/delete/reorderEventTicketType`. Each: **server-side flag gate**
  (reject a 2nd active type while the flag is off), RBAC (`events`/`edit`|`manage`), Zod, audit
  via `logAuditEvent()`, `revalidatePath()`.
- With the flag off, the editor shows only the single default type's price (today's behaviour).

---

## 10. Website (SITE)

- `lib/api/events.ts` — add `ticketTypes` to `Event`.
- **`lib/event-pricing.ts` `getEventPriceLabel()`** (shared helper feeding ~5 surfaces) and
  `lib/event-booking-experience.ts` (`getEventTicketPrice`/`getEventUnitPrice`, L76-115) —
  accept `event.ticketTypes`; return "from £X" (lowest active type) when prices diverge.
- Price-display call sites to audit for "from £X": `app/events/[id]/page.tsx`
  (L337/L419/L430), `app/whats-on/page.tsx` (L258) + `_components/RegularEventCard.tsx`
  (L50-52), **`components/events/RelatedEvents.tsx`**, **`app/events/[id]/opengraph-image.tsx`**
  (OG social image), **category landings e.g. `app/music-bingo/page.tsx` `getEntryLabel`**.
- `lib/structured-data/event-schema.ts` (L82-88) — emit **multiple `Offer` objects** (one per
  type) when prices differ.
- `components/features/EventBooking/ManagementEventBookingForm.tsx`:
  - One type ⇒ today's single quantity box (no UX change).
  - Multiple ⇒ **quantity stepper per type** (capped at that type's `remaining`; shared types
    share one pool figure); total = Σ; **attendee-name inputs grouped under each ticket type**
    (one input per seat of that type, so each name is tied to its type); live breakdown + total;
    submit disabled at 0 / over-cap.
  - `bookingSummary` (~L777) and post-payment alert (L750-766) show the per-type breakdown +
    total. Submit `ticket_selections` where each selection carries its own `attendee_names`
    array (length = that line's quantity).
- `components/features/EventBooking/PayPalEventPaymentSection.tsx` (L127) — show the breakdown;
  `value` stays display-only.
- `app/api/event-bookings/route.ts` (proxy) — pass `ticket_selections` through.
- Conversion payload (capture-order route, `EventPaymentConversionPayload`) — optional per-type
  analytics; not required for correctness.

---

## 11. Rollout / feature flag (D6) — load-bearing

**Flag:** `EVENT_TICKET_TYPES_ENABLED` (reuse an existing settings/feature-flag pattern — grep
first; env var acceptable). It gates **three** things, all server-side:
1. **Admin CRUD** — the `eventTicketTypes.ts` actions reject creating a 2nd active/non-default
   type while off.
2. **Event API exposure** — the event GET returns only the single default type while off.
3. **Charge boundary (critical)** — the booking RPC, when off, **rejects any
   `ticket_selections` referencing more than one active type or a non-default type** (or ignores
   `ticket_selections` and forces the single default-type path). This closes the hole where a
   divergent-priced multi-type booking could be created before the flag is on.

**Sequence (each phase independently deployable; AMS auto-deploys, SITE is a manual deploy):**
1. **Phase 1 — AMS backend + admin, flag OFF.** Migration + backfill, types, extended
   creation/capacity RPCs + new per-type function, PayPal sums line items, breakdown surfaces,
   flag-gated admin. Every event has exactly one default type at the current price → behaviour
   identical to today. **Pre-flag, the single default type's price is kept equal to
   `events.price`** (staff still edit the event price; the default type mirrors it) so no
   divergence can exist (§13).
2. **Phase 2 — SITE.** Multi-type picker/breakdown/price display (renders multiple only when the
   API returns multiple — impossible until the flag is on). Manual deploy.
3. **Flip `EVENT_TICKET_TYPES_ENABLED` ON in prod** once the site is confirmed live; optionally
   pilot on one event.
4. **Phase 3 (optional):** per-type door counts/reporting, per-type attendee names, per-type
   waitlist, multi-type staff bookings.

---

## 12. Decisions & remaining assumptions

**Decided (2026-07-02):**
- **Q2 — per-type capacity: YES.** Each type can have its own cap (dedicated), with `null` =
  shared event pool. All of §6 (dedicated-cap logic, per-type locks, oversubscription rule)
  is IN scope.
- **Q3 — discount: applies to all types.** The existing event-level online discount comes off
  every type's `base_price` uniformly (as §5 already specifies).
- **Q5 — cash & free events included.** `cash_only` and `free` events may also have multiple
  types. Note: going forward every booking (incl. cash/free) stores a real per-line `unit_price`
  in `booking_items`, so only *historical* cash/free rows are best-effort in the backfill (§4.4).
- **Q8 — seat edits: per type.** Multi-type bookings **block** raw seat-count edits; staff edit
  the line items and the seat total follows. Single-type bookings scale the one line (§8.7.3).

- **Q1 — attendee names per ticket: YES.** Names are captured against their ticket line
  (`booking_items.attendee_names`), so we always know which name holds which ticket type. The
  flat `bookings.attendee_names` aggregate is kept for back-compat (§4.2).

**Still assumed (flag if wrong — low-risk defaults):**
- **Q4 (D7):** Communal seated/standing events stay single-type in v1.
- **Q6:** No per-type min/max rules (e.g. "Child requires ≥1 Adult").
- **Q7 — RESOLVED (verified in prod):** reminder-only bookings carry `seats>=1` and are
  **exempt** from the line-item model (no items; trigger skips them) — §4.3.

---

## 13. Migration risk & rollback (honest)

- **Risk:** Medium. Additive schema, no `DROP`, `bookings` columns untouched. Main risks:
  charge-accurate backfill (§4.4), extending the creation RPC, and covering **all** seat-writers
  (§8.7).
- **Load-bearing point:** from **Phase-1 deploy** the charge path reads `booking_items`, so the
  tables are load-bearing for every booking created after deploy.
- **Clean-rollback window:** Phases 1–2, **because the flag keeps every booking single-type at
  the event price** (the default type mirrors `events.price`, §11). A reverted codebase
  (charge = `seats × event price`) reconstructs the same amount → safe. This holds **only** if
  no booking diverged, which the load-bearing flag guarantees pre-flag.
- **Point of no return:** flipping `EVENT_TICKET_TYPES_ENABLED` ON and the first booking whose
  line items diverge from the default price. After that, **never drop the tables** (they hold
  the authoritative per-line charge); roll back by **disabling the flag** (stops new multi-type
  sales) and forward-fixing. A full code revert is not clean because reverted code cannot price
  existing multi-type bookings — unless a documented reconciliation script rewrites
  `events.price` from `booking_items` first.
- Refunds/reconciliation are unaffected either way (they read `payments.amount`).

---

## 14. Data-model invariants

1. A booking with `seats>0` has line items summing to `seats` (enforced by the deferred
   triggers on **both** tables; reminder-only `seats=0`/null tolerated).
2. One `booking_items` row per (booking, type) (`UNIQUE`).
3. `booking_items.unit_price` immutable after creation; type price edits affect **future**
   bookings only.
4. For prepaid bookings `Σ(unit_price×quantity) = payments.amount` (by construction for new
   bookings; reconciled by backfill for historical).
5. `Σ(consumed seats) ≤ events.capacity`; dedicated types additionally `qty ≤ type.capacity`;
   `Σ(dedicated caps) ≤ events.capacity` (hard validation).
6. Communal events have exactly one active type.
7. Event/customer deletion cascades cleanly (both FKs `ON DELETE CASCADE`); direct type
   deletion of a referenced type is prevented in the app layer, not the DB.

---

## 15. Test plan

**AMS (Vitest, mocked Supabase/PayPal)**
- Pricing: discount applied **once**, floors at 0; `resolveBookingChargeAmount` sums mixed
  baskets; editing a type's `base_price` does not change existing `unit_price`/historical charge.
- Creation: mixed basket inserts N items, `seats=Σ quantity`, both deferred triggers pass;
  mismatched sum → trigger raises at commit; duplicate (booking,type) → `UNIQUE` violation;
  **a `bookings` insert with no items → `bookings`-side guard raises**.
- **Seat-writers:** staff manual booking, `update_event_booking_seats_*_v05`, walk-in check-in,
  transfers each keep items in sync (or correctly block multi-type seat edits). Trigger fires
  if any forgets.
- **Concurrency:** two simultaneous bookings for the last event seat → exactly one succeeds
  (existing RPC lock); same for the last seat of a **dedicated** type; expired holds free
  capacity; two dedicated types racing the ceiling.
- **Capacity:** shared types report one shared figure; dedicated `remaining` never exceeds
  event remaining; oversubscription rejected at admin save; waitlist holds counted in the ceiling.
- **Stale payloads:** removed/deactivated `ticket_type_id` → rejected; type from another event
  → rejected; client price ignored; quantity > remaining → rejected.
- **Flag off:** booking RPC rejects >1/non-default `ticket_selections`; `eventTicketTypes`
  create-2nd-type action rejected; event GET returns one type.
- **Free / cash-only:** `free` books without payment; `cash_only` creates confirmed-unpaid with
  items and no PayPal; line-item total for these rows is not presented as authoritative charge.
- **PayPal:** create/capture amount = `Σ(quantity × unit_price)`; client amount ignored;
  capture re-validates against the order; type deactivated/re-priced between create and capture
  does **not** change the snapshotted amount.
- **Migration:** every event gets a default type; every booking gets items;
  `Σ(quantity)=seats` **and** `Σ(unit_price×qty)=payments.amount` for prepaid; down-migration
  valid only pre-flag; delete-cascade works (delete an event with bookings+items).
- **Communal:** cannot add >1 type; booking uses seated/standing; single default line item.

**SITE**
- Form renders single-box vs multi-type by type count; per-type stepper capped at `remaining`;
  shared types show one shared figure; submit disabled at 0 / over-cap.
- Payload carries correct `ticket_selections` and attendee-name count.
- Breakdown + total in form summary, PayPal review, confirmation; "from £X" on listing/detail/
  related/OG/category pages; JSON-LD emits per-type Offers.

---

## 16. Files likely touched (checklist)

**AMS**
- [ ] `supabase/migrations/<new>.sql` — tables, indexes, RLS/grants, seat-sum triggers (both),
  charge-accurate backfill + self-checks, `get_event_ticket_type_capacity_v01`, extend
  `create_event_booking_v0x`
- [ ] `src/types/database.ts`, `src/types/database.generated.ts`
- [ ] `src/lib/events/pricing.ts` (base→unit price, sum helper)
- [ ] `src/lib/events/event-payments.ts` (charge from line items; preview breakdown)
- [ ] `src/services/event-bookings.ts` (creation/capacity via RPCs)
- [ ] `src/app/api/event-bookings/route.ts` (schema, legacy mapping, flag gate)
- [ ] `src/app/api/external/event-bookings/[id]/paypal/{create,capture}-order/route.ts`
- [ ] event GET serializer (route the website calls) — expose `ticket_types` (flag-gated)
- [ ] `src/lib/email/event-ticket-emails.ts` (breakdown in email + SMS)
- [ ] `src/app/actions/events.ts` — `getEventBookings` (fetch items), **`createEventManualBooking`**,
  **seat-edit RPCs `update_event_booking_seats_*_v05`**, **transfers** ([SEAT-WRITER])
- [ ] `src/app/actions/event-check-in.ts` — walk-in insert also writes `booking_items`
- [ ] `src/app/api/events/[id]/booking-sheets/route.ts` — door-list PDF breakdown
- [ ] `src/app/(authenticated)/events/[id]/EventDetailClient.tsx` — detail breakdown + types editor
- [ ] `src/app/(authenticated)/events/EventListView.tsx` — `formatEventPriceSummary` "from £X"
- [ ] `src/app/actions/eventTicketTypes.ts` (new CRUD, flag-gated)
- [ ] `src/app/api/cron/event-paypal-reconciliation/route.ts` — optional `seats:1` cosmetic tidy
- [ ] AMS manage-booking page — breakdown; refund default from `payments.amount`
- [ ] feature-flag wiring (`EVENT_TICKET_TYPES_ENABLED`)

**SITE**
- [ ] `lib/api/events.ts`, `lib/event-booking-experience.ts`, **`lib/event-pricing.ts`**
- [ ] `app/events/[id]/page.tsx`, `app/whats-on/page.tsx`, `_components/RegularEventCard.tsx`,
  **`components/events/RelatedEvents.tsx`**, **`app/events/[id]/opengraph-image.tsx`**,
  **`app/music-bingo/page.tsx`** (+ sibling category landings)
- [ ] `lib/structured-data/event-schema.ts` (per-type Offers)
- [ ] `components/features/EventBooking/ManagementEventBookingForm.tsx`
- [ ] `components/features/EventBooking/PayPalEventPaymentSection.tsx`
- [ ] `app/api/event-bookings/route.ts` (proxy passthrough)

---

## 17. Ground-truth from the live DB (verified 2026-07-02) + enforcement decision

Verified against prod (`the-anchor-management-tools`, Postgres 15). Corrections to the body:

### 17.1 Schema corrections (spec body assumed a few things wrong)
- **No `events.price_currency` column.** Currency is GBP, carried on `payments.currency`
  (default `'GBP'`). `event_ticket_types` needs **no** currency column; the API returns `'GBP'`.
- **`bookings` uses `event_seating_type text` (default `'seated'`)**, *not* `seating_preference`.
  Also `events` has `seated_capacity` / `standing_capacity`. Update §3/§7/§8 wording.
- **`bookings.attendee_names` is `text[]`** (not jsonb) — good, matches
  `booking_items.attendee_names text[]`.
- **`booking_mode` has four values** in prod: `table` (130), `communal` (4), `mixed` (1),
  `general` (1). "Standard vs communal" is too binary — define per-mode behaviour (below).
- **`payments`** links via `event_booking_id`; `charge_type` values include `prepaid_event`,
  `table_deposit`, `refund`. Only **2 `prepaid_event`** payments exist (both since refunded);
  events are overwhelmingly `free` (105) / `cash_only` (29), `prepaid` (2). → the prepaid
  backfill is tiny and low-risk; the volume is in free/cash events.
- `event_ticket_types` / `booking_items` do **not** exist yet.

### 17.2 booking_mode behaviour (v1)
- `table`, `general` → **standard** paid/seated flow → **ticket types apply.**
- `communal`, `mixed` → seated/standing communal machinery (below) → **single default type
  only** in v1 (§7). (`mixed`/`general` are 1 event each — safe to treat conservatively.)

### 17.3 Every booking/seat/payment RPC that must be considered (the real inventory)
This is bigger than §8.7 assumed. Each path that creates a booking or changes `seats` must
keep `booking_items` consistent (or be explicitly tolerated — see 17.4):
- **Create:** `create_event_booking_v05(p_event_id,p_customer_id,p_seats,p_source,
  p_seating_preference)`, `create_event_booking_v06(...,p_payment_hold_minutes)`.
  *(Note: neither takes attendee_names or price — attendee_names is written on a separate
  path; confirm where before wiring per-line names.)*
- **Seat edits:** `update_event_booking_seats_v05(p_hashed_token,...)` (guest),
  `update_event_booking_seats_staff_v05(p_booking_id,...)` (staff),
  `apply_event_seat_increase_payment_v05(...)` (paid increase).
- **Waitlist:** `accept_waitlist_offer_v05(p_hashed_token,p_source)` (materialises a booking).
- **Communal:** `allocate_event_communal_seats_v01`, `reallocate_event_communal_booking_v01`,
  `convert_event_table_bookings_to_communal_v01`, trigger
  `enforce_event_communal_seat_allocation_v01`.
- **Payments (set `payments` rows, not seats):** `confirm_event_payment_v05`,
  `confirm_event_paypal_payment_v01`, `confirm_event_manual_payment_v01`.
- **Capacity:** `get_event_capacity_snapshot_v05(p_event_ids uuid[])` (array input, SETOF),
  `is_active_event_booking_for_capacity_v01(p_status,p_hold_expires_at)` — **this is the
  authoritative "counts toward capacity" definition** (use it; don't re-derive — resolves
  review finding #11).
- **Walk-in:** `register_guest_transaction(...)` and `event-check-in.ts` insert paths.

### 17.4 DECISION NEEDED — seat-sum invariant enforcement strategy
The §4.3 deferred trigger makes `booking_items` **mandatory for every booking immediately**,
so it forces a **big-bang**: all ~10 writers above must create/adjust items in the same
release or bookings break. Two options:

- **Option S (Strict, big-bang):** add the trigger + update every writer + backfill in one
  release. Clean invariant, but a large, higher-risk migration touching many mature RPCs.
- **Option T (Tolerant, incremental) — recommended:** the invariant is *conditional* — "**if a
  booking has ≥1 `booking_items` row, the sum must equal `seats`**"; bookings with zero items
  are allowed. Pricing falls back to the event price when a booking has no items. Cover the
  website/prepaid create path first; migrate the other writers in follow-up PRs, each removing
  one fallback. Safer, incremental, but keeps a temporary dual path (the earlier review's
  concern) until all writers are covered.

**DECIDED (2026-07-02): Option S — Strict, big-bang.** The DB-enforced seat-sum trigger goes
in, and **every** writer in 17.3 is updated to maintain `booking_items` in the **same
release**. Clean invariant, no dual path. Execution plan tracked in
`tasks/event-ticket-options-todo.md`; the migration is not applied to prod until reviewed and
approved.
```
