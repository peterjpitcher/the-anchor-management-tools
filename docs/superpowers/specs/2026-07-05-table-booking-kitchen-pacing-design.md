# Table-booking kitchen pacing — design

- **Date:** 2026-07-05
- **Status:** Approved (design signed off; user authorised proceeding straight to plan + implementation)
- **Author:** Claude (brainstorming session with Peter Pitcher)
- **Area:** `/table-bookings` — booking acceptance, settings, public availability API

---

## 1. Problem

Almost all table bookings land in the first minutes after booking opens. The kitchen is overwhelmed at peak (slow food, bad reviews), then sits idle the rest of the service. Nothing in the system spreads demand across the service window.

Walk-ins consume the same kitchen capacity but arrive unbooked and cannot be controlled in advance — they can only be measured after the fact and buffered against.

## 2. Goal & non-goals

**Goal:** cap how many *food* covers can *arrive* in any short rolling window, so bookings are spread across the service instead of stacking on the opening slot — protecting kitchen throughput while reserving headroom for walk-ins.

**Non-goals:**
- Not a dining-room seat/concurrency cap (physical table fit already handles that).
- Not a per-dish/roast prep model (Sunday pre-orders were retired 2026-07-01; not revived here).
- Not changing deposit policy, auth, or RBAC.
- Not building the customer picker UI (that lives in the separate `the-anchor.pub` repo; this spec defines the API contract it consumes).

## 3. Decisions (locked)

| Decision | Choice |
|---|---|
| What the cap protects | **Kitchen throughput** — food covers only (`food` + `sunday_lunch`); drinks-only excluded |
| How covers are counted over time | **Rolling window** — max N food covers arriving in any W-minute span |
| Enforcement | **Hard block online**, FOH/manager override; walk-ins bypass but still consume the budget |
| Where the customer sees fullness | **Grey out full slots in the picker** (before submit) — the-anchor.pub consumes an extended availability API |

**Default numbers (tunable in settings):** à la carte pace **25** covers / 30 min · Sunday lunch pace **20** / 30 min · walk-in reserve **6** / 30 min · window **30 min**. Ships behind an `enabled` flag defaulting to a generous/off posture so no live booking is rejected until the venue dials it in.

## 4. Current state (verified in discovery, 2026-07-05)

There is **no demand pacing today**. The only limiter is physical table fit over a time window.

- Every booking path — public website (`POST /api/table-bookings`), FOH/walk-ins (`POST /api/foh/bookings`), external API — funnels through one Postgres function, `create_table_booking_v05`. Its live body is in `supabase/migrations/20260719000000_exclude_communal_tables_from_booking_allocator.sql`.
- The RPC checks, in order: party-size ≤ 20 → past-time → business/special hours open window → kitchen window (food/Sunday) → a hardcoded 30-minute pre-close cut-off (`p_bypass_cutoff` lets staff skip it) → duration lookup → **allocate smallest single bookable table, else recursive joined-table combo, else block `no_table`** → deposit gate (party ≥ 10 & not waived → `pending_payment` + hold, else `confirmed`). **There is no covers ceiling anywhere.**
- The thing called "pacing" today (`src/lib/table-bookings/load.ts`, `buildBookingLoad`) is **display-only**: it sums covers by arrival time over a rolling window and labels a slot *busy* (≥30) / *filling* (≥20) for the website badge. It never blocks. Thresholds are edited via `GET/PATCH /api/settings/table-bookings/pacing` and `src/app/(authenticated)/settings/table-bookings/TableSetupManager.tsx` (whose own copy states it "does not block bookings").
- Booking duration is a per-purpose constant in `system_settings` (`table_booking_duration_food/drinks/sunday_lunch_minutes` = 120/90/120) — the only existing time-spreading mechanism, and it does not stop simultaneous arrivals.
- The customer picker lives in `the-anchor.pub` (a **manual** deploy). `/table-booking` in AMS is a bare redirect (`src/app/table-booking/page.tsx`). AMS is the API backend; the website builds its own time picker and may show the advisory badge from `GET /api/table-bookings/load`. A customer only learns a time is unbookable at submit, as a `no_table` error.
- **Concurrency is currently unguarded at the allocate→insert seam.** An earlier lineage held a `pg_advisory_xact_lock`, but it was dropped when the function moved to its 10-param form and never restored — so the seam is a live TOCTOU race today. The `booking_table_assignments` integrity trigger still runs at insert. The pacing work must **re-add** an advisory lock (keyed on the booking date) so the covers count + insert are atomic.
- **Dead capacity infra exists and is wired to nothing:** `check_and_reserve_capacity` + populated `service_slots` (flat cap 50), `check_table_availability` (fixed 50), `booking_time_slots.max_covers` (types only). We do **not** reuse these — they are fixed-clock-slot, floor-seat models that fight the rolling-window kitchen-throughput design. They are noted only to avoid a future maintainer mistaking them for the live path.
- Walk-ins are real bookings created at arrival via `useFohCreateBooking` "walk_in" mode / `POST /api/foh/bookings`: synthetic `+447000…` customer, deposit/dedup/SMS skipped, auto-seated, and they deliberately bypass the gates (`p_bypass_cutoff=true`, falling through to `createManualWalkInBookingOverride`). Their covers **do** show up in `buildBookingLoad`.

## 5. Design

### 5.1 Capacity model

- **Pool counted:** all *kitchen* covers — bookings whose `booking_type` is `food` or `sunday_lunch`. Drinks-only bookings are never counted and never capped.
- **Rule:** for a requested arrival time `T` and party size `P`, the booking is allowed only if
  `(kitchen covers already arriving within the rolling window around T) + P ≤ online_ceiling`.
  "Within the rolling window" reuses the same arrival-time windowing as `buildBookingLoad` (`window_minutes`, default 30). Exact window edges (inclusive/exclusive) are pinned in the implementation plan to match `buildBookingLoad` so the picker and the gate agree.
- **Ceiling:** `online_ceiling = kitchen_pace − walk_in_reserve` (both per window). The *value* is chosen per service: **Sunday-lunch service uses the Sunday numbers; every other service uses the regular numbers.** A single pool of kitchen covers, a service-dependent ceiling — the kitchen doesn't care about the label, only total covers.
- **Counting rules:**
  - Count `committed_party_size ?? party_size`, mirroring `buildBookingLoad`.
  - Exclude `cancelled`, `no_show`, `left`, and expired holds; **include** `pending_payment` deposit holds until they expire (real intent).
  - A joined-table combination counts its party **once** (by covers, not by tables).
  - Walk-in covers count once they exist (they consume the shared budget for later online bookings — see 5.5).

### 5.2 Enforcement

- The covers check is added **inside `create_table_booking_v05`**, after a table is allocated and before the insert, under an advisory lock keyed on the booking date (**re-added in this work** — the current function holds none) so two simultaneous requests for the same date cannot both pass the cap (no oversell).
- On exceed, the RPC returns a new structured block reason **`slot_full`**, in the same shape as today's `no_table` / `cut_off`. Existing callers already treat an unrecognised failure reason as a failed booking, so this is backwards-compatible; friendly copy is added where the reason surfaces.
- **Idempotency-safe:** the public `POST` uses `Idempotency-Key`; the idempotency layer replays the prior result without re-entering the RPC, so a cover is never double-counted.
- **Override:** a new parameter `p_bypass_pacing boolean default false` is added to the RPC (via `DROP` + `CREATE` in one migration; all callers use named args, so the defaulted param is safe). The public path never sets it. The FOH/BOH staff path sets it by role. Walk-ins bypass by nature but their covers still count against subsequent online bookings.

### 5.3 Configuration (manager UI)

Promote the existing pacing settings from cosmetic labels to real caps. Stored in `system_settings` (matching the current pattern), read by the RPC and the load endpoint:

| Key | Meaning | Default |
|---|---|---|
| `table_booking_pacing_enabled` | Master on/off for the hard cap | `false` (ship safe) |
| `table_booking_pacing_window_minutes` | Rolling window length | `30` |
| `table_booking_kitchen_pace_covers` | Regular pace / window | `25` |
| `table_booking_kitchen_pace_covers_sunday` | Sunday-lunch pace / window | `20` |
| `table_booking_walk_in_reserve_covers` | Regular walk-in reserve / window | `6` |
| `table_booking_walk_in_reserve_covers_sunday` | Sunday walk-in reserve / window | `6` |

- **Per-date overrides:** additive nullable columns on `special_hours` (`pacing_kitchen_pace_covers`, `pacing_walk_in_reserve_covers`); when null the base value applies. Lets the venue raise/lower the cap for known busy/quiet dates (bank holidays), reusing the existing per-date override surface. Backwards-safe (nullable, additive).
- **Existing busy/filling labels** stay as a display layer, unchanged; they can later be derived from the same ceiling but are out of scope here.
- **RBAC:** all config gated by `settings:manage` (unchanged).

### 5.4 Customer-facing availability

- Extend `GET /api/table-bookings/load` (already API-key-authed, already returns per-time covers + thresholds) to add, per arrival slot: `remainingCovers` and a `full` boolean computed against the ceiling for that service/date. Additive fields only — backwards-compatible.
- `the-anchor.pub` consumes these to **grey out / hide full slots** so demand self-redistributes *before* submit. This is the real fix for "everyone books 12:00".
- **Backwards-safe rollout:** AMS ships the gate first; the hard block at submit protects the kitchen even before the website renders greyed slots. Website greying is the UX layer added second. AMS auto-deploys `main`; the website is a **manual** deploy — a coordination item, not a code dependency.

### 5.5 Walk-ins

- Cannot be paced (arrive unbooked, bypass gates). Handled purely as **reserved headroom**: `walk_in_reserve` is subtracted from `kitchen_pace` to form the online ceiling.
- Their covers *do* reduce live remaining capacity once they arrive (already visible to `buildBookingLoad`), so later online bookings in that window see less room — correct behaviour.
- **Measurement to tune the buffer:** a lightweight report of actual walk-in covers per service/day versus the reserve (walk-ins are identifiable by the synthetic `+447000…` customer / booking source), so the venue adjusts the reserve with evidence rather than guesswork.

### 5.6 Staff visibility

- An "arrivals load / approaching cap / at cap" read-out per window on the FOH/BOH views (reusing `buildBookingLoad`), so staff see the pacing customers are held to.
- An override prompt in the shared create hook (`useFohCreateBooking`): when a staff booking would exceed the cap, show "this window is at kitchen pace — override?" gated by role, which sets `p_bypass_pacing`.

## 6. Rollout (each phase independently deployable)

1. **Phase 1 — core gate (AMS).** Migration: new `system_settings` keys + nullable `special_hours` override columns. Redefine `create_table_booking_v05` with the pacing gate and `p_bypass_pacing`. Settings API + UI to configure. Ships with `enabled=false` (or generous) so nothing is rejected until switched on. Full test coverage. *This alone protects the kitchen at submit.*
2. **Phase 2 — visibility & UX (AMS).** Extend `GET /api/table-bookings/load` with `remainingCovers`/`full`. Staff covers-per-window read-out + FOH/BOH override prompt.
3. **Phase 3 — picker (the-anchor.pub, separate repo, manual deploy).** Consume the extended load endpoint to grey out full slots. Coordinated with the venue's website deploy.

## 7. Data & interface changes

- **DB:** additive `system_settings` rows (see 5.3); additive nullable `special_hours` columns; `create_table_booking_v05` redefined (DROP + CREATE) with one new defaulted param. No table drops, no destructive changes. Applied to prod via Supabase MCP `apply_migration` per the prod migration workflow.
- **RPC contract:** new block reason `slot_full`; new param `p_bypass_pacing`. Both backwards-compatible for existing named-arg callers.
- **HTTP:** `GET /api/table-bookings/load` gains additive response fields; settings PATCH gains the new keys. `POST /api/table-bookings` and `POST /api/foh/bookings` behaviour unchanged except they may now receive `slot_full`.
- **Types:** update the manual snake_case→camelCase mappings for the new settings/response fields (no `fromDb` helper in this project).

## 8. Error handling

- `slot_full` returned as a clean, structured failure (never a thrown 500). Public callers surface friendly copy ("that time's fully booked — please pick another"); the website greys the slot pre-submit.
- If the pacing settings are missing/malformed, treat as **disabled** (fail open — never block a booking on a config error). Log a `console.warn`.
- Overrides and blocks are audit-logged via `logAuditEvent()`.

## 9. Testing

- **RPC (DB-level):** cap blocks the (N+1)th cover in a window; combos count once; drinks excluded; `cancelled`/`no_show`/`left`/expired holds excluded; `pending_payment` holds included; Sunday vs regular ceilings; `p_bypass_pacing` bypasses; two parallel inserts cannot both pass (concurrency); disabled flag = no gate; missing config fails open.
- **Endpoint:** `load` returns correct `remainingCovers`/`full` per slot and matches the gate's windowing exactly.
- **Idempotency:** a key replay does not double-count a cover.
- **Settings:** PATCH validates and persists the new keys; RBAC enforced.
- Mock Supabase/Twilio/etc. per project testing conventions; happy path + at least one error/edge case per unit.

## 10. Constraints respected

- App in production; every phase independently deployable and backwards-compatible.
- Two repos: AMS is authoritative; the website only renders availability and is a manual deploy.
- Existing patterns preserved: server actions, manual field mapping, audit logging, RLS on, single-RPC choke point, advisory-lock concurrency.
- Deposits, auth, and RBAC unchanged.

## 11. Follow-ups / out of scope

- Deriving the busy/filling labels from the new ceiling (cosmetic unification).
- Reviving Sunday pre-orders for dish-level prep planning (separate policy call).
- Using deposits as an additional peak-demand lever.
- À-la-carte food on a Sunday sharing the kitchen with roasts is counted in the same pool with the Sunday ceiling for that date — acceptable; revisit only if it proves too tight.
