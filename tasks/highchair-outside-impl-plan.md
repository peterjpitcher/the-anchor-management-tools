# High-chair & Outside-table — Implementation Plan

> **For agentic workers:** Execute with `implement-plan`. Tasks are grouped into dependency-ordered **Waves**. Within a wave, tasks are parallel-safe (disjoint files). Between waves there is a hard barrier. Steps use `- [ ]` checkboxes. Spec (the authoritative change-map): [highchair-outside-booking-spec.md](highchair-outside-booking-spec.md) — every task cites its spec section; read it for exact file:line targets.

**Goal:** Add high-chair requests (hard cap of 2, granted atomically, never oversold, never blocking) and outside-table bookings (no indoor table held, still paces) end-to-end across AMS and the-anchor.pub, surfaced everywhere.

**Architecture:** One migration adds two columns + a settings row + two shared SQL primitives (`count_high_chairs_in_window`, `reserve_high_chairs`) and extends the three lifecycle RPCs. Every create/edit path funnels chair grants through `reserve_high_chairs` under a **single global** advisory lock. Outside = a boolean that skips table allocation but keeps kitchen pacing. All read/display/comms/analytics surfaces carry the two fields.

**Tech Stack:** Supabase Postgres (PL/pgSQL), Next.js 15 App Router, TypeScript, Vitest. Two repos: AMS `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools`, website `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub`.

**Isolation:** AMS work happens on branch `feat/highchair-outside-booking` (created off `main`; premium-rate WIP stays uncommitted and is never staged). Website work on branch `feat/highchair-outside-booking` in that repo. **Held for owner:** applying the migration to prod, committing/merging to `main`, and the website production deploy.

---

## Shared contracts (all tasks MUST match these exactly)

### SQL — new columns
```sql
-- table_bookings gains:
high_chair_count   integer NOT NULL DEFAULT 0   -- stores the GRANTED count (not requested)
is_outside_seating boolean NOT NULL DEFAULT false
-- CHECK (high_chair_count >= 0 AND high_chair_count <= 20)  -- loose sanity bound, NOT the cap
-- system_settings row: key='high_chair_inventory', value='{"value": 2}'::jsonb
```

### SQL — shared primitives (single source of truth for the cap)
```sql
-- pure read: chairs granted in an overlapping window, per span-overlap + shouldCountBooking eligibility
CREATE OR REPLACE FUNCTION public.count_high_chairs_in_window(
  p_start timestamptz, p_end timestamptz, p_exclude uuid)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(tb.high_chair_count), 0)::integer
  FROM public.table_bookings tb
  WHERE tb.high_chair_count > 0
    AND tb.start_datetime < p_end
    AND tb.end_datetime   > p_start
    AND (p_exclude IS NULL OR tb.id <> p_exclude)
    AND tb.status NOT IN ('cancelled','no_show')
    AND tb.left_at IS NULL
    AND NOT (                       -- exclude expired unpaid holds (mirror shouldCountBooking)
      tb.status IN ('pending_payment','pending_card_capture')
      AND tb.hold_expires_at IS NOT NULL
      AND tb.hold_expires_at < now()
      AND COALESCE(tb.payment_status,'') <> 'completed'
    );
$$;

-- atomic grant: global lock -> count others -> clamp -> persist -> return granted. NEVER blocks.
CREATE OR REPLACE FUNCTION public.reserve_high_chairs(
  p_booking_id uuid, p_requested integer, p_start timestamptz, p_end timestamptz)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_inv integer; v_used integer; v_granted integer;
BEGIN
  IF COALESCE(p_requested,0) <= 0 THEN RETURN 0; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('high_chair_reservation'));      -- ONE global key
  SELECT COALESCE((value->>'value')::int, 2) INTO v_inv
    FROM public.system_settings WHERE key = 'high_chair_inventory';
  v_inv := COALESCE(v_inv, 2);
  v_used := public.count_high_chairs_in_window(p_start, p_end, p_booking_id);
  v_granted := GREATEST(0, LEAST(p_requested, v_inv - v_used));
  UPDATE public.table_bookings SET high_chair_count = v_granted WHERE id = p_booking_id;
  RETURN v_granted;
END;
$$;
-- GRANT EXECUTE ON FUNCTION ... TO service_role;  (both funcs)
```

### RPC signature additions (append; drop old sig first, then recreate, then re-GRANT)
- `create_table_booking_v05(...existing 11 args..., p_high_chair_count integer DEFAULT 0, p_outside_seating boolean DEFAULT false)`
- `move_table_booking_time_v05(...)` — re-grants chairs for the new window.
- `move_table_booking_assignments_v05(...)` — returns blocked when target booking `is_outside_seating`.

### RPC result JSON — new keys on success payload
`high_chairs_granted` (int), `high_chair_count` (int, = granted), `is_outside_seating` (bool). **No** `high_chair_unavailable` reason — chairs never block.

### TypeScript — type additions (exact field names)
```ts
// src/lib/table-bookings/bookings.ts  TableBookingRpcResult
high_chairs_granted?: number
high_chair_count?: number
is_outside_seating?: boolean
// src/lib/foh/bookings.ts  TableBookingForFoh   -> high_chair_count?: number; is_outside_seating?: boolean
// src/app/(authenticated)/table-bookings/foh/types.ts  FohBooking + FohLane -> same two optionals
// website lib/api/bookings.ts:
//   TableAvailabilitySlot.high_chairs_remaining?: number
//   TableBookingRequest.high_chair_count?: number; is_outside_seating?: boolean
//   TableBookingResponse.high_chairs_granted?: number; is_outside_seating?: boolean
```

### Request field names (public API + proxy + form)
- Public/AMS API create body: `high_chair_count?: number` (0–2), `outside_seating?: boolean`.
- RPC params: `p_high_chair_count`, `p_is_outside_seating`.
- Website form state: `highChairCount`, `isOutsideSeating`; submit payload keys `high_chair_count`, `is_outside_seating`.

---

## File structure map

**AMS — SQL:** one new migration `supabase/migrations/<ts>_highchair_outside.sql` (columns, settings, 2 primitives, 3 RPC redefs, grants).
**AMS — API/logic:** `api/table-bookings/route.ts`, `api/foh/bookings/route.ts`, `api/foh/bookings/[id]/time/route.ts`, `api/boh/table-bookings/[id]/route.ts`, `api/foh/bookings/[id]/move-table/route.ts`, `api/boh/table-bookings/[id]/move-table/route.ts`, `lib/table-bookings/move-table.ts`, `lib/foh/bookings.ts`, `lib/table-bookings/manage-booking.ts`, `api/table-bookings/load/route.ts`, `lib/table-bookings/kitchen-pacing.ts`, `lib/table-bookings/bookings.ts`.
**AMS — display:** `api/foh/schedule/route.ts`, `foh/types.ts`, `foh/components/FohTimeline.tsx`, `FohUnassignedBookings.tsx`, `FohScheduleClient.tsx`, `FohBookingDetailModal.tsx`, `boh/BohBookingsClient.tsx`, `api/boh/table-bookings/route.ts`, `table-bookings/[id]/BookingDetailClient.tsx` (+ page), `customers/[id]/page.tsx`, `actions/daily-summary.ts`, `rota-day-info.ts`, `g/[token]/table-manage/page.tsx`, `g/[token]/table-payment/TablePaymentClient.tsx`, `lib/table-bookings/ui.ts`, `types/database.ts` (+ generated).
**Website:** `app/api/table-bookings/route.ts`, `app/api/table-bookings/availability/route.ts`, `lib/api/bookings.ts`, `lib/api/client.ts`, `app/api/booking/agent/route.ts`, `components/features/TableBooking/ManagementTableBookingForm.tsx`, `lib/table-booking-service-windows*`.

---

## WAVE 0 — DB foundation (sequential; everything depends on it)

### Task 0.1: Migration — columns, settings, primitives, RPC extensions
**Files:** Create `supabase/migrations/<timestamp>_highchair_outside.sql` (timestamp per prod-migration workflow; do NOT `db push`).
Read for context: `supabase/migrations/20260726000001_kitchen_pacing_gate_v06.sql` (create RPC), `20260627000001_move_table_booking_time_v05.sql`, `20260725010000_move_table_booking_assignments_rpc.sql`, `src/lib/table-bookings/load.ts:212` (`shouldCountBooking`).

- [ ] **Step 1:** Write the ALTER TABLE (two columns + CHECK) and the `high_chair_inventory` INSERT, exactly per Shared contracts.
- [ ] **Step 2:** Add `count_high_chairs_in_window` and `reserve_high_chairs` exactly per Shared contracts; `GRANT EXECUTE` both to `service_role`.
- [ ] **Step 3:** Redefine `create_table_booking_v05`: `DROP FUNCTION` the current 11-arg signature, then `CREATE OR REPLACE` with the two appended params; re-`GRANT`. Inside: (a) wrap allocator lines 317–429 (incl. `no_table` guard) + assignment INSERT 576–589 in `IF NOT p_outside_seating THEN … END IF;`; (b) after the row is built, when `p_high_chair_count > 0` acquire `pg_advisory_xact_lock(hashtext('high_chair_reservation'))`, set the row's `high_chair_count := GREATEST(0, LEAST(p_high_chair_count, inventory - count_high_chairs_in_window(v_start, v_end, NULL)))` **outside** the `IF NOT p_bypass_pacing` guard; (c) persist `is_outside_seating := p_outside_seating`; (d) add `high_chairs_granted`, `high_chair_count`, `is_outside_seating` to the return `jsonb_build_object` (637–658). Keep pacing gate (431–494) running for outside food.
- [ ] **Step 4:** Extend `move_table_booking_time_v05`: after re-windowing start/end, `PERFORM public.reserve_high_chairs(p_booking_id, existing.high_chair_count, new_start, new_end);` (re-grants/clamps for the new window). Never block.
- [ ] **Step 5:** Guard `move_table_booking_assignments_v05`: if the target booking `is_outside_seating`, RETURN a blocked result (`{state:'blocked', reason:'outside_no_table'}` shape consistent with the function's existing return) before assigning.
- [ ] **Step 6:** Static review only (no local DB). Verify: drop precedes create for every redefined function; every computed integer is cast (`::integer`) in `RETURNS`/`jsonb`; grants re-applied. **Runtime smoke-test is a HELD step** (owner-gated prod apply) — see Verification.
- [ ] **Step 7:** Commit (stage ONLY the migration file): `git add supabase/migrations/<ts>_highchair_outside.sql && git commit -m "feat(db): high-chair cap + outside-seating columns, primitives, RPC extensions"`

### Task 0.2: Types — generated + manual mappers
**Files:** Modify `src/types/database.ts`, `src/types/database.generated.ts`; `src/lib/table-bookings/bookings.ts` (`TableBookingRpcResult`), `src/lib/foh/bookings.ts` (`TableBookingForFoh`), `src/app/(authenticated)/table-bookings/foh/types.ts` (`FohBooking`, `FohLane`).

- [ ] **Step 1:** Add `high_chair_count: number` and `is_outside_seating: boolean` to the `table_bookings` Row types (generated + any manual row type). Since regeneration needs the prod schema (held), hand-edit the generated `table_bookings` Row/Insert/Update to include both columns now; note in the commit that a full regen follows the prod apply.
- [ ] **Step 2:** Add the optional fields to `TableBookingRpcResult`, `TableBookingForFoh`, `FohBooking`, `FohLane` per Shared contracts.
- [ ] **Step 3:** `npx tsc --noEmit` — expect clean (fields are additive/optional).
- [ ] **Step 4:** Commit: `git commit -m "feat(types): high-chair/outside on booking + FOH + RPC-result types"`

---

## WAVE 1 — AMS backend (parallel-safe; depends on W0)

### Task 1.1: Public create route
**Files:** `src/app/api/table-bookings/route.ts` (schema ~46, idempotency hash ~175, RPC call ~230, response type 69–91, builder 531–547). Spec §4e, §4d, §10-contract.
- [ ] Add `high_chair_count: z.coerce.number().int().min(0).max(2).optional()` and `outside_seating: z.boolean().optional()` to the create schema.
- [ ] Add `high_chair_count` and `outside_seating` (normalised to number/bool/null) to the object hashed at :175 so the idempotency key varies.
- [ ] Pass `p_high_chair_count` / `p_is_outside_seating` in the RPC call at :230. Do NOT write chairs via the post-insert UPDATE (:294–300) — RPC is the grant.
- [ ] Add `high_chairs_granted` + `is_outside_seating` to `TableBookingResponseData` and populate from the RPC jsonb.
- [ ] Verify: `npx tsc --noEmit`. Commit.

### Task 1.2: FOH create route (incl. non-transactional raw override) + dedup + analytics
**Files:** `src/app/api/foh/bookings/route.ts` (schema 25–38, dedup 948–958, override `createManualWalkInBookingOverride`:183 incl. inserts 491/528 & result 532–549, RPC call 1056, analytics 1370–1378). Spec §4c, §4d.
- [ ] Add `high_chair_count` (0–2) + `outside_seating` to `CreateFohTableBookingSchema`; pass `p_high_chair_count`/`p_is_outside_seating` at :1056. **No override flag** (D3).
- [ ] In `createManualWalkInBookingOverride`: when `outside_seating`, skip `computeAvailableCombos()`/`no_table` return (480–485) and the `booking_table_assignments` insert (:528); still insert the `table_bookings` row. Insert the row with `high_chair_count: 0`, then call `reserve_high_chairs(bookingId, requested, start, end)` via `.rpc()` and use its return; surface `high_chairs_granted`/`is_outside_seating` on the result (532–549).
- [ ] Extend the dedup SELECT+equality (948–958) with `party_size`, `booking_purpose`, `high_chair_count`, `is_outside_seating`; only return the existing row when ALL match.
- [ ] Add `high_chairs_granted` (granted) + `is_outside_seating` to the `table_booking_created` analytics metadata (1370–1378).
- [ ] Verify: `npx tsc --noEmit`. Commit.

### Task 1.3: Edit / move guards
**Files:** `src/app/api/foh/bookings/[id]/time/route.ts`, `src/app/api/boh/table-bookings/[id]/route.ts:82`, `src/lib/table-bookings/manage-booking.ts` (:392, :672, `maybeMoveTableForPartySizeIncrease` 220–233), `src/app/api/foh/bookings/[id]/move-table/route.ts:36`, `src/app/api/boh/table-bookings/[id]/move-table/route.ts:36`, `src/lib/table-bookings/move-table.ts:81`, `src/lib/foh/bookings.ts:66`. Spec §5.
- [ ] `getTableBookingForFoh` (`lib/foh/bookings.ts:66`): add `high_chair_count, is_outside_seating` to the SELECT.
- [ ] FOH time route: relies on `move_table_booking_time_v05` (now re-grants chairs — W0.1 Step 4). No extra chair code needed here beyond passing through; confirm it loads/returns the granted count.
- [ ] BOH edit (`[id]/route.ts:82`): add the two columns to the SELECT; when date/time/duration change, route the re-window through `move_table_booking_time_v05` (or call `reserve_high_chairs` for the new window). Assert assignment-window UPDATE is a no-op for outside (no rows).
- [ ] Guest self-service (`manage-booking.ts`): load `is_outside_seating` in `getTableManagePreviewByRawToken` SELECT (:392); in `updateTableBookingByRawToken`, if outside, skip `maybeMoveTableForPartySizeIncrease` entirely (update party only); guard its INSERT branch (220–233) against outside.
- [ ] Both move-table routes: if `booking.is_outside_seating`, POST → 409 (`outside_no_table`); GET availability → empty tables. Add the defence in `move-table.ts`/the assignments RPC (last line via W0.1 Step 5).
- [ ] Verify: `npx tsc --noEmit`. Commit.

### Task 1.4: Availability read-out (`high_chairs_remaining`, no-store)
**Files:** `src/app/api/table-bookings/load/route.ts:124`, `src/lib/table-bookings/kitchen-pacing.ts` (`buildKitchenAvailabilitySlots:137`). Spec §6.
- [ ] Compute per-slot `high_chairs_remaining = max(0, inventory - count_high_chairs_in_window(slotStart, slotEnd, null))` using span logic (a small server query per request, or a batched query per day). Read inventory via `coerceInt(byKey.get('high_chair_inventory')) ?? 2`.
- [ ] Set `Cache-Control: no-store` on responses that include the chair figure (or expose it only via a fresh path). Keep existing fail-closed behaviour.
- [ ] Verify: `npx tsc --noEmit`. Commit.

### Task 1.5: Comms
**Files:** `src/lib/table-bookings/bookings.ts` (confirmation 848–871, post-deposit 1005–1056 select :1011, manager 355–450 select :371, deposit-request 301/305/332/851, types 33–52 & 99–112), `src/app/g/[token]/table-payment/TablePaymentClient.tsx:73`, `src/app/g/[token]/table-manage/page.tsx:164,202`. Spec §7.
- [ ] Add `high_chair_count, is_outside_seating` to every relevant SELECT and to `TableBookingNotificationRow`.
- [ ] Confirmation SMS/email + post-deposit SMS + deposit-request: add `High chair reserved ×N` (granted>0) and `Outside seating` lines; branch table→booking/outside wording when `is_outside_seating`. Manager email: add `High chairs: N` + `Seating: Outside` rows.
- [ ] Make `TablePaymentClient.tsx:73` and `table-manage:164` conditional on `is_outside_seating` (show "Outside" not "table"/"Unassigned"); remove the free-text "highchairs" hint at `table-manage:202`.
- [ ] Verify: `npx tsc --noEmit`. Commit.

---

## WAVE 2 — AMS display + aggregates (parallel-safe; depends on W0/W1 types)

### Task 2.1: FOH schedule API — Outside lane split
**Files:** `src/app/api/foh/schedule/route.ts` (selects 195/196, mappers 687–711 & 741–769, :732). Spec §8.
- [ ] Add both columns to the richest `attempts[]` select. Split `is_outside_seating` rows out of `unassigned_bookings` into a virtual lane `{ table_id:'__outside__', table_name:'Outside', bookings:[…] }` appended to `lanes`; keep untabled indoor bookings in `unassigned`. Default flags on synthetic blocks. Ensure Outside rows carry `start/end_datetime`.
- [ ] Verify: `npx tsc --noEmit`. Commit.

### Task 2.2: FOH timeline + strip + client + detail modal + badge helper
**Files:** `FohTimeline.tsx:181/320/338/351`, `FohUnassignedBookings.tsx:29`, `FohScheduleClient.tsx:111/340`, `FohBookingDetailModal.tsx`, `src/lib/table-bookings/ui.ts` (shared badge helper). Spec §8.
- [ ] Render the Outside `LaneRow`; make its blocks non-draggable + lane non-droppable (extend `isEventOnlyBlock` precedent). Add `High chair ×N`/`Outside` badges on the block + detail modal via a shared helper using `@/ds` `Badge`.
- [ ] Ensure the cover/booking counter (`FohScheduleClient` 111–124) accounts for the Outside lane (no double count); unassigned strip no longer shows outside rows.
- [ ] Verify: `npx tsc --noEmit`; if a dev server is up, smoke via preview. Commit.

### Task 2.3: BOH list + API
**Files:** `src/app/api/boh/table-bookings/route.ts` (select ~207–245, mapper :495, search 500–511), `boh/BohBookingsClient.tsx:906` (type 48–99). Spec §8.
- [ ] Add both columns to select + `BohBooking` type + mapper. Tables cell shows "Outside" (not "Unassigned") when outside; add `High chair ×N` badge; optionally add to search blob.
- [ ] Verify: `npx tsc --noEmit`. Commit.

### Task 2.4: Booking detail page
**Files:** `src/app/(authenticated)/table-bookings/[id]/page.tsx` (select), `BookingDetailClient.tsx:841`. Spec §8.
- [ ] Add both columns to the select + type. Header/Tables/Capacity tiles show "Outside" instead of "-"; add `Seating: Indoor/Outside` and `High chairs: N` to the `<dl>`.
- [ ] Verify: `npx tsc --noEmit`. Commit.

### Task 2.5: Customer history + daily summary + rota + analytics
**Files:** `src/app/(authenticated)/customers/[id]/page.tsx` (select :350, mapper 426–438, timeline 695–714), `src/app/actions/daily-summary.ts` (select :42, block 72–78), `src/lib/…/rota-day-info.ts` (select :49, type 7–13, agg 94–98 + consumers). Spec §8, §9.
- [ ] Add both columns to each select; surface "Outside"/"High chair ×N" in customer timeline; add totals (high chairs reserved, outside covers) to daily summary + rota info; update all `RotaDayInfo` consumers.
- [ ] Confirm `src/lib/events/staff-seat-updates.ts` leaves `high_chair_count` untouched (no change, just verify).
- [ ] Verify: `npx tsc --noEmit`. Commit.

---

## WAVE 3 — Website (repo OJ-The-Anchor.pub; depends on AMS API contract from W1)

### Task 3.1: Proxy payload + fallback idempotency
**Files:** `app/api/table-bookings/route.ts` (`ManagementTableBookingPayload` :24, `normaliseIncomingPayload`, fallback key 445–454). Spec §10.
- [ ] Add `high_chair_count?: number` + `is_outside_seating?: boolean` to the payload type + normaliser (parse + forward, structured not merged into notes). Add both to the fallback fingerprint (447–454).
- [ ] Verify: `npx tsc --noEmit`. Commit.

### Task 3.2: Availability types + normaliser + proxy
**Files:** `lib/api/bookings.ts:7`, `app/api/table-bookings/availability/route.ts` (+ `lib/table-booking-service-windows`), form normaliser `ManagementTableBookingForm.tsx:245` (local `AvailabilitySlot` 109–116). Spec §10.
- [ ] Add `high_chairs_remaining?` to slot types + request/response fields; pass through the availability proxy; parse in the form normaliser. On missing value, leave the picker enabled (D7).
- [ ] Verify: `npx tsc --noEmit`. Commit.

### Task 3.3: Form fields + submit + confirmation + copy
**Files:** `components/features/TableBooking/ManagementTableBookingForm.tsx` (details ~2282, submit 1587, key 1611, result type 74–100, confirmation 1811, payment copy 2426/2431, PayPal 2455). Spec §10.
- [ ] Add `highChairCount` (0–2 stepper, bound to remaining when present, else enabled) + `isOutsideSeating` checkbox ("outside table, weather permitting").
- [ ] Add both to the submit payload BEFORE the idempotency key (1611). Never gate submit on availability.
- [ ] Extend result type with `high_chairs_granted?/high_chair_count?/is_outside_seating?`; confirmation shows granted-of-requested + a calm note if `granted<requested`, and an outside indicator. Make payment copy (2426/2431) conditional; append chair/outside to PayPal summary (2455).
- [ ] Verify: `npx tsc --noEmit`; if dev server up, preview the flow. Commit.

### Task 3.4: AI-agent path + client mapping
**Files:** `app/api/booking/agent/route.ts`, `lib/api/client.ts` (`toManagementTableBookingPayload:210`, response mapping ~61/262). Spec §10.
- [ ] Read + forward `high_chair_count`/`is_outside_seating` in the agent route and `toManagementTableBookingPayload`; preserve `high_chairs_granted`/`is_outside_seating` in the response mapping.
- [ ] Verify: `npx tsc --noEmit`. Commit.

---

## WAVE 4 — Tests

### Task 4.1: AMS Vitest — logic + guards
**Files:** Create `src/lib/table-bookings/highchair-outside.test.ts` (+ any co-located tests). Spec §14. Mock Supabase per project convention.
- [ ] Tests: chair grant clamps 0/1/2 and third-in-overlap → 0 (never throws); non-overlapping both granted; dedup not fooled by chair/outside diff; outside create → no assignment + not `no_table`; move into full window re-grants min; move-table on outside → 409; comms render granted (not requested) + outside-safe copy; availability `no-store`.
- [ ] Note: SQL-level concurrency/atomicity is asserted by the prod smoke-test (held), since there's no local DB; the Vitest layer covers the TS wiring + eligibility predicate parity with `shouldCountBooking`.
- [ ] Run `npm test`; commit.

---

## Verification (per repo, before any deploy)

- [ ] AMS: `npm run lint` (zero warnings) → `npx tsc --noEmit` → `npm test` → `npm run build`.
- [ ] Website: `npm run lint` → `npx tsc --noEmit` → `npm run build`.
- [ ] `codex-qa-review` adversarial pass over the AMS diff and the website diff.
- [ ] **After parallel agents:** `git status` + `git diff` every modified file; confirm no stray edits and that premium-rate WIP files are untouched/unstaged (lesson: a strayed agent once gutted an unrelated file).

## HELD for owner go-ahead (do NOT do autonomously)
- [ ] Apply the migration to prod via Supabase MCP `apply_migration`; then **smoke-test each function with real `select`** (indoor+chairs, outside no-assignment, chairs-full→0, move-into-full, move-table-on-outside→blocked); regenerate `database.generated.ts` from prod.
- [ ] Merge `feat/highchair-outside-booking` → `main` in AMS (auto-deploys); verify deploy Ready + prod alias moved.
- [ ] Merge + **manual production deploy** of the-anchor.pub; verify live.

## Open questions (proceeding on the recommended defaults unless owner objects)
O1 weather = copy-only; O2 inventory UI = DB-only; O3 guest edit = display-only; O4 convert indoor↔outside = out of scope v1; O5 analytics = raw fields only. (Spec §15.)
