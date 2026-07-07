# Spec — High-chair requests & outside-table bookings (v2, verified)

**Date:** 2026-07-07
**Status:** Discovery + adversarial review + 8-agent code verification complete. Decisions locked. No code yet.
**Repos:** `OJ-AnchorManagementTools` (AMS: DB, RPCs, API, staff UI, comms) **and** `OJ-The-Anchor.pub` (public booking flow). Two independent Vercel deploys (website is manual).
**Complexity:** 5 / XL. Delivered as ordered workstreams, not one PR.

> v2 supersedes v1. It incorporates an adversarial review and a code-verification pass that read every cited line in both repos. Key corrections vs v1: (a) there are **two** booking-create paths, not one, and the second is not transactional; (b) the atomic guarantee is reworked around a shared SQL primitive under a **single global** advisory lock; (c) chairs **never block** a booking (grant-what's-available); (d) the cap is a **hard ceiling for everyone, no override**; (e) both fields appear **everywhere** incl. reports/rota/analytics; (f) settings use the `{"value": N}` wrapper; (g) the DB `CHECK` is a loose sanity bound, not the business cap.

---

## 1. Goal

Let a customer on the-anchor.pub (a) request **1–2 high chairs** and (b) tick **"outside table"**. The venue owns **two** high chairs, so no more than two may be reserved across any overlapping seating window. An outside booking is recorded **without holding an indoor table**. Both signals are visible to FOH/BOH staff and flow through comms, reports and analytics.

### Success criteria
- Requesting a high chair grants `min(requested, available)` for the overlapping window, **atomically** and **never oversold** — proven safe across *all* create/edit paths and under concurrency.
- A booking is **never blocked** because of high chairs. The server grants what's free and reports `high_chairs_granted`; the UI/comms tell the customer if it couldn't reserve all requested.
- The **hard ceiling of 2 applies to everyone** — website, FOH staff, management override, and out-of-hours walk-ins. There is **no override**.
- An outside booking holds **no** `booking_table_assignments` row, is never `no_table`-blocked, but **still counts toward kitchen pacing** if it's a food booking.
- FOH shows outside bookings in a dedicated **Outside lane**; both signals appear on FOH/BOH/detail/customer-history and in daily summary, rota info and analytics.
- No customer- or staff-facing copy tells an outside booker their "table is held".

### Out of scope (v1)
- Converting an existing indoor booking ↔ outside from any UI (move-table onto/off the Outside lane). Guarded off; fast-follow.
- Editing high-chair/outside on the guest self-service page `/g/[token]/table-manage` — **display only** in v1.

---

## 2. Decisions (locked with owner, 2026-07-07)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Outside capacity | **Unlimited, staff-managed.** Never blocked; holds no indoor table. |
| D2 | Outside vs kitchen pacing | **Outside food covers still count** toward kitchen pacing. |
| D3 | High-chair cap firmness | **Hard ceiling of 2, guaranteed, for everyone. No override, no bypass flag.** |
| D4 | FOH display of outside | **Dedicated "Outside" lane** + "Outside" badge. |
| D5 | Over-cap behaviour | **Never block.** Grant `min(requested, available)` atomically; return `high_chairs_granted`; tell the customer if `< requested`. |
| D6 | Coverage scope | **Everywhere** — booking screens, comms, customer history, daily summary, rota info, analytics. |
| D7 | Website fail mode | Chair picker **stays enabled** if the remaining-count read fails; the server is the authoritative gate. |

### Assumptions (revised; owner can flip)
- **A1 — Storage:** two new columns on `table_bookings`: `high_chair_count integer NOT NULL DEFAULT 0` (**this stores the GRANTED count**, not requested) and `is_outside_seating boolean NOT NULL DEFAULT false`.
- **A2 — Inventory configurable:** `system_settings` key `high_chair_inventory` stored as `'{"value": 2}'::jsonb` (house-style wrapper), read as `COALESCE((value->>'value')::int, 2)`. Admin/DB-editable in v1; a settings-UI field is optional (see §12, open question O2).
- **A3 — Overlap definition:** high-chair usage counts by **true `start_datetime`/`end_datetime` span overlap** (`existing.start < new.end AND existing.end > new.start`), matching the table-assignment overlap predicate — **not** the pacing centred-window model.
- **A4 — Shared pool:** the two chairs are one venue-wide pool shared across indoor and outside bookings.
- **A5 — Count eligibility:** reuse `shouldCountBooking` (`src/lib/table-bookings/load.ts:212`) — exclude `cancelled`/`no_show`, `left_at IS NOT NULL`, and expired unpaid holds; a live `pending_payment` hold within its window **does** hold its chair.
- **A6 — No blocked reason for chairs:** the RPC returns `high_chairs_granted` on the success payload. `mapTableBookingBlockedReason` is **untouched** (verified: no change needed).
- **A7 — Deposits unchanged:** £10pp / 10+ deposit rule is party-size based; chairs are free; outside 10+ still take a deposit.
- **A8 — No override (replaces v1 A8):** there is no staff/manager path that exceeds 2. Removed entirely.
- **A9 — Always on:** both features ship enabled; no feature flag.
- **A10 — Single global chair lock:** the atomic grant uses **one constant** advisory-lock key (not date-keyed), so a booking overlapping midnight can't slip a date-keyed lock. Contention is negligible (2 chairs venue-wide); bookings requesting 0 chairs skip the lock.

---

## 3. Data model (migration)

New migration in `supabase/migrations/` (prod applied via Supabase MCP `apply_migration`, apply-time timestamp — not `db push`).

```sql
ALTER TABLE public.table_bookings
  ADD COLUMN high_chair_count   integer NOT NULL DEFAULT 0
    CHECK (high_chair_count >= 0 AND high_chair_count <= 20),   -- loose sanity bound, NOT the business cap
  ADD COLUMN is_outside_seating boolean NOT NULL DEFAULT false;

INSERT INTO public.system_settings (key, value, description)
VALUES ('high_chair_inventory', '{"value": 2}'::jsonb,
        'High-chair inventory: total high chairs the venue owns (hard cap across overlapping windows).')
ON CONFLICT (key) DO NOTHING;
```

- The `CHECK` is a loose guard (≤ 20), deliberately **decoupled** from the "2" so raising `high_chair_inventory` later never trips it. The real cap is enforced by the reservation primitive (§4).
- Additive, backwards-compatible (defaults) — AMS can ship before the website sends the fields.
- After apply: regenerate `src/types/database.generated.ts`; update the manual `table_bookings` row types/mappers in `src/types/database.ts` (this project maps fields by hand).

---

## 4. Booking creation — the atomic core

### 4a. Two shared SQL primitives (single source of truth for the cap)

```sql
-- pure read: chairs already granted in an overlapping window, per A3 + A5 eligibility
CREATE FUNCTION count_high_chairs_in_window(p_start timestamptz, p_end timestamptz, p_exclude uuid)
RETURNS integer ...   -- SUM(high_chair_count) over table_bookings tb where
                      --   tb.start_datetime < p_end AND tb.end_datetime > p_start
                      --   AND (p_exclude IS NULL OR tb.id <> p_exclude)
                      --   AND <shouldCountBooking predicate: not cancelled/no_show, left_at null,
                      --        exclude expired unpaid holds>

-- atomic grant: lock -> count others -> clamp -> persist on the row -> return granted
CREATE FUNCTION reserve_high_chairs(p_booking_id uuid, p_requested int,
                                    p_start timestamptz, p_end timestamptz)
RETURNS integer ...   -- PERFORM pg_advisory_xact_lock(hashtext('high_chair_reservation'));  -- ONE global key (A10)
                      -- v_inv := COALESCE((value->>'value')::int,2) FROM system_settings 'high_chair_inventory';
                      -- v_granted := GREATEST(0, LEAST(p_requested, v_inv - count_high_chairs_in_window(p_start,p_end,p_booking_id)));
                      -- UPDATE table_bookings SET high_chair_count = v_granted WHERE id = p_booking_id;
                      -- RETURN v_granted;
```

- `count_high_chairs_in_window` is the **only** place the overlap+eligibility rule lives — every caller (create RPC, raw override, move RPC, availability read-out) uses it, so definitions can't drift.
- `reserve_high_chairs` is the **only** atomic grant primitive; it is safe even for the non-transactional JS path (§4c) because the lock+count+update happen in a single function invocation.
- Grant clamps to `>= 0`; a request of 2 with 1 free grants 1; with 0 free grants 0. Never raises, never blocks.

### 4b. Create path #1 — the RPC `create_table_booking_v05`
Canonical body: `supabase/migrations/20260726000001_kitchen_pacing_gate_v06.sql` (function is 11-arg, named `_v05`). New migration:

- **DROP the prior signature, then `CREATE OR REPLACE`** with two appended params `p_high_chair_count integer DEFAULT 0`, `p_outside_seating boolean DEFAULT false`, and **re-`GRANT EXECUTE ... TO service_role`**. (Drop-then-create avoids the overload ambiguity this project already hit in `20260509000007`. Callers bind by name, so defaulted params keep existing callers valid.)
- **Outside branch:** wrap the allocator (lines 317–429, incl. the `no_table` guard at 427) **and** the `booking_table_assignments` INSERT (576–589) in `IF NOT p_outside_seating THEN …`. So an outside booking selects no table, can never return `no_table`, and holds no assignment row. The kitchen-pacing gate (431–494) **still runs** (it counts `booking_purpose='food'` regardless of table), satisfying D2.
- **Chairs:** the chair grant sits **outside** the `IF NOT COALESCE(p_bypass_pacing,false)` guard (line 435) so no bypass/walk-in path skips it. Because the RPC is one transaction, it acquires the global lock, computes `granted = LEAST(p_high_chair_count, GREATEST(0, inventory - count_high_chairs_in_window(start,end,NULL)))`, and **inserts the booking row with `high_chair_count = granted`** (persist `is_outside_seating` too). Only acquire the lock when `p_high_chair_count > 0`.
- **Return JSON** (637–658) gains `high_chairs_granted`, `high_chair_count` (= granted), `is_outside_seating`.

### 4c. Create path #2 — the raw override (NOT transactional — must be made safe)
`createManualWalkInBookingOverride` (`src/app/api/foh/bookings/route.ts:183`) bypasses the RPC entirely for (a) `management_override===true` (super_admin, :751) and (b) walk-in hours-bypass fallback when the RPC returns a hours/cut-off block (:1104–1149). It does its **own** JS table allocation (`computeAvailableCombos`, :223) and multiple `supabase.from().insert()` calls (`table_bookings` :491, `booking_table_assignments` :528) — these are **separate requests, not one DB transaction**, so an advisory xact lock cannot span them.

Required changes:
- **Outside:** when `is_outside_seating`, skip `computeAvailableCombos()` and the `no_table` return (:480–485) and the `booking_table_assignments` insert (:528); still insert the `table_bookings` row.
- **Chairs (atomicity):** insert the `table_bookings` row with `high_chair_count = 0`, then call `reserve_high_chairs(bookingId, requested, start, end)` via RPC and use its return as the granted value. Because `reserve_high_chairs` locks+counts+updates in one call, this is safe despite the surrounding multi-statement flow. **Do not** count-then-insert in JS.
- Surface `high_chairs_granted`/`is_outside_seating` on the override's result object (:532–549).

### 4d. Result type + response plumbing
- Extend `TableBookingRpcResult` (`src/lib/table-bookings/bookings.ts:33-52`) with `high_chairs_granted?: number`, `high_chair_count?: number`, `is_outside_seating?: boolean`.
- Extend the FOH response shape `FohCreateBookingResponseData` (route.ts:680–705) and JSON response (route.ts:1438–1456).
- Extend the public `TableBookingResponseData` (`src/app/api/table-bookings/route.ts:69-91`) + response builder (:531–547).
- Add both to analytics metadata `table_booking_created` (route.ts:1370–1378) — the **granted** count, not requested.
- **Dedup fix** (route.ts:948–958): add `party_size`, `booking_purpose`, and (once columns exist) `high_chair_count`, `is_outside_seating` to the 60-second dedup SELECT + equality check; return the existing row only when **all** fingerprint fields match, else fall through to create. Otherwise two near-simultaneous requests differing only in chairs/outside collapse to the first.

### 4e. Callers pass the two params
- **Public:** `src/app/api/table-bookings/route.ts:230` (currently 8 named params) — add `p_high_chair_count`, `p_outside_seating`; extend the create Zod schema (:46); add both to the idempotency hash input (:175). **Do not** route chairs through the post-insert `UPDATE` at :294–300 — the RPC is the atomic grant.
- **FOH:** `src/app/api/foh/bookings/route.ts:1056` — add the two params to `CreateFohTableBookingSchema` (:25–38) and to the RPC call. **No override flag** (D3/A8).

---

## 5. Move / edit / amend paths (where overselling & mis-holding actually happen)

All of these were missing guards. Every one must (i) load `high_chair_count, is_outside_seating`, (ii) re-check the chair cap on any **time-window** change, and (iii) never assign a table to an outside booking.

| Path | File / line | Change |
|------|-------------|--------|
| **FOH time move** (swimlane drag) | `src/app/api/foh/bookings/[id]/time/route.ts:130` → `move_table_booking_time_v05` (`supabase/migrations/20260627000001_move_table_booking_time_v05.sql`) | Extend the RPC to call `reserve_high_chairs(id, existing.high_chair_count, new_start, new_end)` for the **new** window (excludes self) under the global lock and re-persist the (re-)granted count. Never block; clamp. This is the primary production "move to another time" action the review omitted. |
| **BOH date/time edit** | `src/app/api/boh/table-bookings/[id]/route.ts:82` | Add the two columns to the SELECT; when date/time/duration change, re-check via the same `reserve_high_chairs` re-grant for the new window (prefer routing through `move_table_booking_time_v05` so the logic is centralised). Assert the assignment-window UPDATE is a safe no-op for outside (no rows). |
| **Guest self-service edit** (public, token-gated) | `src/lib/table-bookings/manage-booking.ts:672` (+ preview select :392, `maybeMoveTableForPartySizeIncrease` insert branch :220–233); entry `src/app/g/[token]/table-manage/action/route.ts:35` | Load `is_outside_seating` in the preview; if outside, **skip all table allocation** (update `party_size`/`committed_party_size` only, never insert an assignment). Guard the insert branch against outside. This is a customer-reachable path, so the mis-hold is exploitable, not theoretical. |
| **FOH move-table** | `src/app/api/foh/bookings/[id]/move-table/route.ts:36` | If `booking.is_outside_seating`, POST returns 409 ("outside bookings hold no table; convert to indoor first"); GET availability returns empty tables (hide the action). |
| **BOH move-table** | `src/app/api/boh/table-bookings/[id]/move-table/route.ts:36` | Same guard as FOH. |
| **Shared move engine** | `src/lib/table-bookings/move-table.ts` (`getMoveTableAvailability:81`, `moveBookingAssignmentToTables:411` → `move_table_booking_assignments_v05`, `supabase/migrations/20260725010000_move_table_booking_assignments_rpc.sql`) | Last line of defence: the RPC returns `blocked` if the target booking `is_outside_seating`. One change covers both FOH+BOH surfaces. |
| **FOH loader** | `src/lib/foh/bookings.ts:66` `getTableBookingForFoh` (+ `TableBookingForFoh` type) | Add `high_chair_count, is_outside_seating` — the single change that lets every move/guard consumer see the flag. |
| **Party-size w/ event seats** | `src/lib/events/staff-seat-updates.ts` `updateTableBookingPartySizeWithLinkedEventSeats` | Party size is independent of chairs (A7). Confirm it leaves `high_chair_count` untouched (does not reset it). No chair logic added. |

---

## 6. Availability — exposing `high_chairs_remaining`

- Endpoint `src/app/api/table-bookings/load/route.ts:124` currently serves a **public/SWR-cached** response and fails **closed** on query error (throws → 500). The pacing figure may stay cached, but **`high_chairs_remaining` must be served fresh** (a 2-unit physical resource can't come from a 90s-stale copy): set `Cache-Control: no-store` on any response carrying the chair figure, or compute it via a small uncached recompute.
- Compute per candidate slot using `count_high_chairs_in_window` (span logic + A5) — **not** the pacing time-bucket model. `src/lib/table-bookings/kitchen-pacing.ts` (`buildKitchenAvailabilitySlots:137`) is the read-only mirror; add the chair figure here or in the route.
- This figure is **advisory only** (bounds the picker); the RPC's atomic grant is the real guard, so a stale/missing value can never oversell — consistent with D7 (fail-open picker).

---

## 7. Comms — every message a booking triggers

`src/lib/table-bookings/bookings.ts`. All must render the **server-granted** count, never requested. Types first: extend `TableBookingRpcResult` (33–52) and `TableBookingNotificationRow` (99–112); add the two columns to each function's SELECT.

| Message | Line | Change |
|---------|------|--------|
| Customer confirmation SMS + email | 848–871 | Add `High chair reserved ×N` (only when granted > 0) and an `Outside seating` line. **Outside-safe wording:** switch "your table … is confirmed" / "secure your table" to booking/outside wording when `is_outside_seating`. |
| Post-deposit SMS | 1005–1056 (select :1011) | Add columns to select; append chair line; replace "your table … is locked in" with outside-safe copy for outside bookings. |
| Manager new-booking email | 355–450 (select :371) | Add `High chairs: N` (when > 0) and `Seating: Outside` rows (`details` 431–447). Staff-facing — informational. |
| Deposit-request SMS/email | subj 301, intro 305/332, SMS 851 | Outside-safe wording + granted-chair line for outside bookings. |
| Sunday pre-order SMS, cancellation SMS | — | No copy change. Optionally add both fields to SMS/email `metadata` payloads for comms logs (low priority, structured-not-notes). |

**Misleading "table held" copy — full list to make conditional on `is_outside_seating`:** the nine strings in `bookings.ts` (above), plus the guest-facing `src/app/g/[token]/table-payment/TablePaymentClient.tsx:73` ("Your table is still reserved") and `src/app/g/[token]/table-manage/page.tsx:164` ("Table: Unassigned" → show "Outside"). Keep tone subtle/calm (no bold warning blocks) per house style. Use "weather permitting" consistently with the site checkbox copy.

Also drop the free-text "highchairs" hint at `src/app/g/[token]/table-manage/page.tsx:202` once the structured field exists (else it invites a bad free-text workaround).

---

## 8. Staff UI — display everywhere

Types first: `src/app/(authenticated)/table-bookings/foh/types.ts` — `FohBooking` (:1) + `FohLane` (:32) gain `high_chair_count?`, `is_outside_seating?`; `FohScheduleResponse.data` (:54–61) gains the Outside lane. Shared badge helper lives with `src/lib/table-bookings/ui.ts` so FOH/BOH/detail render identically (use the `@/ds` `Badge` primitive — `tone="info"` Outside, `tone="neutral"` chair).

| Surface | File / line | Change |
|---------|-------------|--------|
| FOH schedule API | `src/app/api/foh/schedule/route.ts:732` (+ selects :195/196, mappers 687–711 / 741–769) | Add both columns to the richest `attempts[]` select (graceful-degradation tolerant). Split `is_outside_seating` rows out of `unassigned_bookings` into a virtual **Outside lane** `{ table_id:'__outside__', table_name:'Outside', bookings:[…] }` appended to `lanes`; genuinely-untabled **indoor** bookings stay in `unassigned`. Default the flags on synthetic private/communal/standing blocks. Outside-lane rows need non-null `start/end_datetime` (they carry them, :766–767). |
| FOH timeline | `FohTimeline.tsx:181` (+ drag guard :320, droppable :338) | Render the Outside lane as an extra `LaneRow`; make its blocks **non-draggable** and the lane **non-droppable** (extend the `isEventOnlyBlock` precedent) so indoor blocks can't be dropped onto Outside (convert-to-indoor is v2). Add `High chair ×N` / `Outside` badges on the block body (351–358). |
| FOH unassigned strip | `FohUnassignedBookings.tsx:29-41` | Must no longer show outside rows (now in the Outside lane); add chair badge where relevant. |
| FOH client counter | `FohScheduleClient.tsx:111-124, 340-347` | Cover/booking dedupe counter must account for the Outside lane (avoid double-counting). |
| FOH detail modal | `FohBookingDetailModal.tsx` | `High chair ×N` / `Outside` badges. |
| BOH list | `BohBookingsClient.tsx:906` (type :48–99) + API `src/app/api/boh/table-bookings/route.ts` (select ~207–245, mapper :495, search blob :500–511) | Tables cell shows **"Outside"** (not "Unassigned") when `is_outside_seating`; add a `High chair ×N` badge; optionally add both to search. |
| Booking detail | `BookingDetailClient.tsx:841` + page select | Header/Tables/Capacity tiles show "Outside" instead of "-"; add `Seating: Indoor/Outside` and `High chairs: N` to the `<dl>`. |
| Customer history | `src/app/(authenticated)/customers/[id]/page.tsx:348` (select :350, mapper 426–438, timeline 695–714) | Add both columns; surface "Outside" / "High chair ×N" in the per-booking summary. |
| Manual types | `src/types/database.ts` + `database.generated.ts` | Add the two columns (regenerate + hand-map). |

---

## 9. Aggregate surfaces (D6 — include everywhere)

| Surface | File / line | Change |
|---------|-------------|--------|
| Daily summary | `src/app/actions/daily-summary.ts:40` (select :42, block 72–78) | Add both columns; extend the table-bookings block with e.g. total high chairs reserved + count of outside covers. |
| Rota day info | `src/lib/…/rota-day-info.ts` (select :49, `RotaDayInfo` type 7–13, aggregation 94–98) | Add fields (`highChairs`, `outsideCovers`); update **all** `RotaDayInfo` consumers. |
| Customer analytics | `customers/[id]/page.tsx` (per-purpose grouping :891) | Optionally split seating in the grouping. |

---

## 10. Website — the-anchor.pub public flow

Repo `OJ-The-Anchor.pub` (separate manual deploy). Live form is `components/features/TableBooking/ManagementTableBookingForm.tsx` (hand-rolled `useState`, no zod). Dead legacy pair `TableBookingForm.tsx` / `TableBookingWithTracking.tsx` — do **not** wire.

| Concern | File / line | Change |
|---------|-------------|--------|
| Form fields | `ManagementTableBookingForm.tsx` details step (~2282) | High-chair stepper `0–2` (bound to `high_chairs_remaining` when present; **stays enabled** if absent per D7) + "I'd like an outside table (weather permitting)" checkbox. Add `highChairCount`/`isOutsideSeating` state. |
| Submit payload | :1587 (before key computed :1611) | Add `high_chair_count` (when > 0) and `is_outside_seating` (when true) — **before** the client Idempotency-Key so it varies with them. Never gate submit on availability. |
| Availability normaliser | :245 + local `AvailabilitySlot` 109–116 | Parse `high_chairs_remaining` (defensive number parse). |
| Result type / confirmation | `ManagementTableBookingResult` 74–100; confirmation :1811 | Add `high_chairs_granted?`, `high_chair_count?` (requested), `is_outside_seating?`. On confirmed, if `granted < requested` show a calm inline "we couldn't reserve a high chair for this time" note; show an outside/patio indicator. Confirmed branch already tolerates null table (:1821). |
| Payment copy | :2426, :2431 ("your table is held") | Conditional on `is_outside_seating` → "Your booking is held…". |
| PayPal summary | :2455 | Append chair/outside descriptors (deposit amount unaffected). |
| Proxy payload | `app/api/table-bookings/route.ts:24` `ManagementTableBookingPayload` + `normaliseIncomingPayload` | Add `high_chair_count?: number`, `is_outside_seating?: boolean`; parse + forward (structured, not merged into notes). |
| Proxy fallback idempotency | :445–454 | Add both to the fallback fingerprint (browser header usually wins, but header-less callers need it). |
| Availability types | `lib/api/bookings.ts:7` | `TableAvailabilitySlot.high_chairs_remaining?`; `TableBookingRequest.high_chair_count?/is_outside_seating?`; `TableBookingResponse.high_chairs_granted?/is_outside_seating?`. |
| Availability proxy | `app/api/table-bookings/availability/route.ts` (+ `lib/table-booking-service-windows`) | Pass `high_chairs_remaining` through per slot. |
| **AI-agent booking path** | `app/api/booking/agent/route.ts` + `lib/api/client.ts` `toManagementTableBookingPayload:210` | Read + forward both fields, else the agent path silently ignores the features. `client.ts` response mapping (~:61/:262) must preserve `high_chairs_granted`/`is_outside_seating`. |
| Create alias | `app/api/table-bookings/create/route.ts` | Pure re-export of `route.ts` POST — inherits the fix, no separate change. |

---

## 11. Edge cases & concurrency

- **Two paths, one lock.** All three creators (public RPC, FOH RPC, raw override) and the move re-checks funnel chair grants through `reserve_high_chairs` under a **single global** advisory lock (A10), so concurrent bookings and the midnight-overlap case can't oversell. Bookings with 0 chairs skip the lock.
- **Non-transactional raw path** made safe by inserting `high_chair_count=0` then calling the atomic `reserve_high_chairs` (§4c).
- **Move into a full window** re-grants `min(existing, available)` — a booking is never silently left holding chairs it can no longer have.
- **Hold expiry** frees a chair automatically (A5). Cancellation/no-show/left free it immediately.
- **Outside on the grid** → Outside lane, non-draggable/non-droppable; move-table 409s; guest party-size edit skips table work.
- **Outside still paces** (D2) — counts via `booking_purpose='food'`; ensure no new filter keyed on table assignment excludes outside rows; keep the SQL gate and the JS mirror (`kitchen-pacing.ts`) in agreement.
- **Event-linked bookings** carry `high_chair_count=0`; party-size/event-seat mutations must not reset it.
- **Chair count vs party size:** clamped to `0–2` only; **not** tied to party size (a baby may not be in the headcount).
- **RLS:** new columns inherit `table_bookings` RLS; website uses the service-role RPC as today.

---

## 12. Settings shape & optional UI

- Store `high_chair_inventory` as `'{"value": 2}'::jsonb`; read `COALESCE((value->>'value')::int, 2)` in SQL and `coerceInt(byKey.get('high_chair_inventory')) ?? 2` in JS (both already unwrap `{value}`). A bare scalar would read as NULL under the house pattern and silently fall back.
- There is **no** generic settings lister — each key is surfaced via a typed helper + API route in `src/app/(authenticated)/settings/table-bookings/TableSetupManager.tsx`. v1 treats inventory as **admin/DB-only** (A2). If a UI field is wanted, add a getter/saver (mirroring `saveKitchenPacingSettings`), a route, and a `TableSetupManager` field — see open question **O2**.

---

## 13. Rollout / deploy order (each step independently safe)

1. **Migration** — columns + `high_chair_inventory` setting; regenerate types; update manual mappers. Applied via Supabase MCP, verified.
2. **SQL primitives + RPCs** — `count_high_chairs_in_window`, `reserve_high_chairs`; extend `create_table_booking_v05` (drop+recreate, re-grant), `move_table_booking_time_v05`, `move_table_booking_assignments_v05`. **Smoke-test each with real `select …`** (lesson: "applied" ≠ "runs"; cast computed columns): indoor+chairs, outside (no assignment row, no `no_table`), chairs-full → grant 0, move into full window, concurrent oversell prevented, move-table onto outside → blocked.
3. **AMS API + availability + comms + edit-path guards** — public & FOH create, raw override, dedup, all move/edit paths, `no-store` chair figure. Backwards-compatible (defaults).
4. **AMS staff UI + aggregates** — Outside lane, badges, BOH, detail, customer history, daily summary, rota info.
5. **Website** — form, proxy, availability, agent path, copy; then owner's **manual production deploy** of the-anchor.pub.

AMS auto-deploys `main`; verify each push landed (Ready + prod alias moved). Website is a manual deploy — a push is not a deploy.

---

## 14. Testing

Business logic + real SQL smoke tests. Mock external services; no real APIs (workspace rule). **Must cover the edit paths — that's where overselling is most likely.**

- **`reserve_high_chairs` / RPC:** 0/1/2 requested; third in an overlapping window → grants 0 (never blocks); non-overlapping windows both granted; concurrent transactions can't exceed 2; midnight-overlap serialised by the global lock; inventory read from `{value}` setting (and default 2 when missing).
- **Outside:** create outside → no `booking_table_assignments` row, never `no_table`; outside food booking counts toward pacing.
- **Both create paths:** RPC path and `createManualWalkInBookingOverride` (management override + walk-in hours-bypass) both enforce the cap and both honour outside.
- **Dedup:** two requests differing only in chairs/outside are **not** collapsed.
- **Edit/move:** FOH time move re-checks chairs; BOH date/time edit re-checks; guest self-service party-size edit does **not** assign a table to an outside booking; FOH & BOH move-table 409 on outside; move-table RPC rejects assigning a table to outside.
- **Availability:** `high_chairs_remaining` served `no-store`; fail-open (picker stays enabled on read failure).
- **Comms:** no "table held" wording for outside; granted (not requested) count in every message.
- **Website:** picker clamps to remaining when present, stays enabled when absent; idempotency key varies with the fields; agent path forwards them; partial-grant note renders.

---

## 15. Open questions (honest list)

- **O1 — Weather handling.** D1 chose unlimited/staff-managed (no seasonal toggle). Confirm the only weather treatment is the "weather permitting" copy + staff phoning to cancel if needed — i.e. no admin on/off switch for outside. *(Recommendation: yes, copy-only for v1.)*
- **O2 — Settings UI for `high_chair_inventory`.** Admin/DB-only (A2), or add a `TableSetupManager` field now? *(Recommendation: DB-only for v1; add the field only if you expect the count to change.)*
- **O3 — Guest self-service editing of the two fields.** v1 is display-only on `/g/[token]/table-manage`. Confirm customers can't change high-chair/outside after booking without contacting the venue. *(Recommendation: display-only for v1.)*
- **O4 — Convert indoor ↔ outside.** Out of scope v1 (move-table onto/off the Outside lane is blocked). Confirm that's acceptable, or schedule as the immediate fast-follow.
- **O5 — Analytics granularity.** D6 includes both fields in analytics/daily-summary/rota. Confirm whether you want per-service breakdowns (e.g. outside covers by day) or just the raw fields carried through for now.
