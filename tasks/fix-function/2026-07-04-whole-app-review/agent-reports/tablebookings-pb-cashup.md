# Deep review — Table bookings, Private bookings, Cashing up (HEAD 76655f69, 2026-07-04)

Method: read-only audit of the live code paths (verified which files routes actually import — no findings below sit on dead `*Client.tsx` copies). BOH admin detail uses `/api/boh/table-bookings/*`; FOH uses `/api/foh/bookings/*`; both share `src/lib/table-bookings/move-table.ts` and `src/lib/events/staff-seat-updates.ts`.

---

## 1. Table bookings

### TP-01 — Walk-in / management override allocator ignores communal-event tables — **Critical**
**Evidence:** `src/app/api/foh/bookings/route.ts:178–430` (`createManualWalkInBookingOverride` → `computeAvailableCombos`). The candidate filter checks only `booking_table_assignments` overlaps (~:260–300) and `is_table_blocked_by_private_booking_v05` (:300–321). `grep communal` in this file returns **zero matches** — there is no `event_communal_seat_allocations` exclusion. This path is used for both FOH walk-ins (:1031) and management-mode bookings (:722).
**Impact:** On a communal-event day (e.g. World Cup fixtures), the override happily selects a communal-held table. The DB trigger then raises `table_assignment_communal_overlap` (`supabase/migrations/20260611000000_communal_event_seating.sql:277`, SQLSTATE P0001). Because `isAssignmentConflictRpcError` (:651–660) matches only `23P01` / `table_assignment_overlap` / `table_assignment_private_blocked` — and `'table_assignment_communal_overlap'` does **not** contain the substring `'table_assignment_overlap'` — the code hits `throw assignmentError` (:515), which **bypasses the cleanup block** (:519–588). Result: an orphaned `table_bookings` row (status `confirmed`, `seated_at` set, no table assignment) plus a generic 500 to the FOH staff member. The orphan then counts against duplicate checks, SMS flows and reports.
**Recommendation:** Add the same communal exclusion used in `getMoveTableAvailability` to `computeAvailableCombos`; and make the assignment failure path go through cleanup (treat unknown errors as combo failure, not throw) so a booking row is never stranded.

### TP-02 — Conflict classifiers don't recognise the communal trigger error (3 duplicated copies) — **High**
**Evidence:** identical functions in `src/lib/table-bookings/move-table.ts:37–46`, `src/app/api/table-bookings/route.ts:92–100`, `src/app/api/foh/bookings/route.ts:651–660`; none matches `table_assignment_communal_overlap`.
**Impact:** Any race where a communal allocation lands between availability check and assignment write surfaces as a raw 500 instead of the friendly 409; in the walk-in path it feeds TP-01's orphan.
**Recommendation:** Add `|| message.includes('table_assignment_communal_overlap')` and consolidate into one exported helper.

### TP-03 — Multi-table move is not atomic — **Medium**
**Evidence:** `src/lib/table-bookings/move-table.ts` `moveBookingAssignmentToTables` (~:415–505): per-table loop of separate UPDATE/INSERT statements; stale assignments deleted only after all targets succeed; delete failure returns 500 *after* new rows are inserted.
**Impact:** A mid-loop failure on a 2–4-table combo leaves the booking holding old + partial new tables — over-blocking availability until a retry self-heals (if attempted). Walk-in combo insert is atomic; edit/move is the odd one out.
**Recommendation:** Wrap in an RPC (delete-stale + insert-targets in one transaction), mirroring the v05 allocator.

### TP-04 — Party-size grow: move commits before the size write, with no compensation — **Medium**
**Evidence:** server: `src/lib/events/staff-seat-updates.ts` — auto-move at :214, `party_size` update at :243–249; a failed update throws with the move already committed. Client: `BookingDetailClient.tsx:672–693` issues two separate HTTP calls (`/move-table`, then `/party-size`).
**Impact:** If the second step fails, the booking sits on the bigger table with the old party size; staff see only the party-size error.
**Recommendation:** Fold move+resize into one server operation (the BOH route already supports `autoMoveTable: true` — the client's separate move call is redundant); apply size first or compensate the move on failure.

### TP-05 — Post-update failures misreport success state — **Low**
**Evidence:** `src/app/api/boh/table-bookings/[id]/party-size/route.ts:87–105` — verification re-read returns 409 "was not saved" on a concurrent overwrite (TOCTOU false negative); `applyPartySizeDepositTransition` failure returns 500 even though the size (and possibly auto-move) saved.
**Recommendation:** Verify against the returned row from the update itself; report "size saved, deposit link failed" separately.

### TP-06 — Duplicate-booking guard: silent failure mode remains — **Low**
**Evidence:** `src/app/api/foh/bookings/route.ts:~888–946` — the 60s dedup pre-check is wrapped in `catch {}` with no logging (the original months-long dead-guard bug would be invisible again).
**Recommendation:** `logger.warn` in the catch.

### TP-07 — Availability checks fan out N+1 RPCs — **Low**
**Evidence:** `move-table.ts` and `foh/bookings/route.ts:300–321` call `is_table_blocked_by_private_booking_v05` once per table in `Promise.all` (~20–40 parallel RPCs per availability load).
**Recommendation:** Set-based variant of the RPC.

**Parity confirmed (no finding):** admin create and FOH create both use `create_table_booking_v05`, which excludes communal tables at both allocator steps (`20260719000000:307–346`). BOH and FOH move/party-size share one lib; move-picker communal "active" definition matches the DB trigger; party-size caps align at 20.

---

## 2. Private bookings

### TP-08 — Contract prints a £250 deposit "due" when no deposit is set — **Medium**
**Evidence:** `src/lib/contract-template.ts:76` `const depositAmount = booking.deposit_amount ?? 250`; :121 `depositStatus = deposit_paid_date ? 'paid …' : 'due'`; rendered at :375–378.
**Impact:** A booking with `deposit_amount` NULL — including venue-hosted events which are exempt from deposit rules — gets a signed contract demanding £250 "due". Customer-facing policy misstatement.
**Recommendation:** Render "No deposit required" (or omit the box) when `deposit_amount` is NULL/0; keep 250 only as a form default at creation.

### TP-09 — Waiver name-fallback is narrower than its stated intent — **Low**
**Evidence:** `src/lib/contract-template.ts:23,126–130` — fixed UUID + fallback `includes('bring your own')`, `item_type === 'catering'` only.
**Impact:** A re-seeded package renamed to e.g. "Self-catering" silently drops the page-5 annex — an uninsured self-catered event without the indemnity signature.
**Recommendation:** Broaden the fallback (`'bring your own'`, `'self-cater'`, `'byo'`) and/or log a warning when a catering item matches by name but not ID.

### TP-10 — Name propagation: parking bookings not synced on customer relink — **Low**
**Evidence:** `supabase/migrations/20260724000000_sync_customer_name_to_bookings.sql` — rename propagation covers `private_bookings` + `parking_bookings`, and relink sync fires for private bookings, but `parking_bookings` has no equivalent relink trigger.
**Impact:** Re-pointing a parking booking at a different customer leaves the old denormalised name (renames fine; relinks not). Otherwise coverage is complete.
**Recommendation:** Add the same BEFORE INSERT/UPDATE-OF-customer_id sync trigger to `parking_bookings`, or document the limitation.

### TP-11 — Contract version increment: race + best-effort divergence — **Low**
**Evidence:** `src/app/api/private-bookings/contract/route.ts` — read-then-write version increment; audit written with admin client but version update uses the RLS-scoped client, non-blocking on failure.
**Impact:** Concurrent generates mint the same version; RLS-blocked roles produce audit entries whose version never advances. Cosmetic.
**Recommendation:** `contract_version = contract_version + 1` server-side (or admin client).

### TP-12 — Legacy policy language: clean — **Info**
Repo-wide sweep for "credit card / card hold" finds nothing customer-facing except the intentional tombstone `src/app/g/[token]/card-capture/page.tsx` and its redirect stub — both correct for old SMS links. Contract null-safety is sound ("To be confirmed" fallbacks, HTML-escaped, try/catch in route).

---

## 3. Cashing up

### TP-13 — Webhook misconfiguration produces indefinite retries + unbounded log rows — **Medium**
**Evidence:** `src/app/api/webhooks/tabology/route.ts:96–104` — missing `TABOLOGY_WEBHOOK_SECRET` returns **500** and writes a `webhook_logs` row (full body + headers) on every delivery. Secret was never set in Vercel; `.env.example:74–77` still documents the endpoint as live "cash-up ingest".
**Impact:** If the webhook is registered in Tabology, every cash-up run triggers a retry storm for a feature that now does nothing anyway (TP-14).
**Recommendation:** Decide the endpoint's fate: unregister in Tabology (then delete the route), or set the secret so deliveries are acknowledged. Update `.env.example`.

### TP-14 — Webhook is a no-op stub carrying full ingest machinery + dead lib exports — **Low**
**Evidence:** `handleCashupRan` (`route.ts:210–233`) only writes an audit row `reason: 'cashup_prefill_disabled'`, yet each delivery runs the full idempotency cycle (3+ DB writes to dedupe a no-op). In `src/lib/webhooks/tabology.ts`, `deriveSessionDate`, `buildPaymentBreakdowns`, `mapCashupRanToDto` are referenced only by tests.
**Recommendation:** If prefill returns, strip the idempotency dance from the stub; if not, delete the mapping helpers + tests alongside the route.

### TP-15 — Manual cash-up flow: intact — **Info**
`src/app/actions/cashing-up.ts` mutations use the atomic session RPC, audit-log every mutation, and all five pages import their live `_components/*Client.tsx`. No webhook/prefill remnants leak into the UI. The 82197822 revert preserved never-clobber-signed-off semantics.

---

## Priority order
1. **TP-01** (walk-in communal gap + orphaned bookings) — with TP-02 as its 5-line enabler in the same fix.
2. **TP-08** (contract demanding £250 that isn't owed) — customer-facing policy error.
3. **TP-13** (Tabology webhook limbo) — operational decision, then trivial.
4. TP-03/TP-04 (move atomicity, move-before-size).
5. Remainder are hardening/hygiene.
