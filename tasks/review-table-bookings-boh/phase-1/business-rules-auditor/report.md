# Business Rules Auditor Report — BOH Table Bookings Filter Fix
**Date:** 2026-03-15
**Scope:** `src/app/(authenticated)/table-bookings/boh/`, `src/app/api/boh/table-bookings/`, `src/app/api/cron/table-booking-deposit-timeout/`

---

## 1. Rules Inventory

| # | Rule | Source | Code Location | Verdict |
|---|------|--------|---------------|---------|
| R1 | Staff can see cancelled bookings when they explicitly select "Cancelled" filter | CLAUDE.md / brief | `BohBookingsClient.tsx` + `route.ts` | **FAIL — see Finding 1** |
| R2 | Default "All statuses" view hides cancelled bookings | Brief | `route.ts` L529-531 | **PARTIAL FAIL — see Finding 1** |
| R3 | Auto-cancellation fires only when deposit is genuinely unpaid (not when waived) | CLAUDE.md domain rules | `cron/table-booking-deposit-timeout/route.ts` | **FAIL — see Finding 2** |
| R4 | £10/person deposit for parties of 7 or more | CLAUDE.md | Not visible in cron | **UNVERIFIED — cron doesn't check party size** |
| R5 | `deposit_waived = true` is treated as deposit-paid everywhere | Brief | All deposit-enforcement paths | **FAIL — cron ignores it** |
| R6 | Venue-hosted events exempt from deposit rules | CLAUDE.md | Cron query | **UNVERIFIED — cron does not filter by `event_id`** |

---

## 2. Findings

### Finding 1 (CONFIRMED DEFECT) — Client never sends `status` param to API; client-side filter runs on data that already excludes cancelled bookings

**Severity:** High — user-visible, causes functional breakage

**What the business expects:** When a staff member selects "Cancelled" in the filter dropdown, they should see cancelled bookings.

**What happens instead:**

1. **Client build of `searchParams`** (`BohBookingsClient.tsx` L392-398):
   ```ts
   const searchParams = new URLSearchParams({
     date: focusDate,
     view          // ← only `date` and `view` are sent; `status` is NEVER included
   })
   ```

2. **API reads `status` param** (`route.ts` L271):
   ```ts
   const statusFilterRaw = request.nextUrl.searchParams.get('status')  // always null
   ```
   Because `statusFilterRaw` is always `null`:
   - `parsedStatusFilters` is `null`
   - `showingCancelledExplicitly` is `false`

3. **API's post-fetch filter** (`route.ts` L523-531) then runs the **else branch** and silently removes every cancelled booking from the response payload.

4. **Client-side `filteredBookings`** (`BohBookingsClient.tsx` L520-523) then tries to filter by `statusFilter === 'cancelled'`, but the data handed to it already has zero cancelled rows.

**Root cause:** `loadBookings()` reconstructs `searchParams` from `{date, view}` only. The `statusFilter` state variable is never included. The API was written to support a `status` query param and has full server-side filtering logic — but the client never calls it.

**Impact:** Cancelled bookings are invisible to staff regardless of what filter they select.

---

### Finding 2 (CONFIRMED DEFECT — root cause of Jason Loveridge mis-cancellation) — Auto-cancellation cron does not check `deposit_waived` before cancelling

**Severity:** Critical — causes incorrect data mutation; wrong bookings cancelled; customer received incorrect SMS

**File:** `src/app/api/cron/table-booking-deposit-timeout/route.ts`

**DB query that selects cancellation candidates:**
```ts
await supabase
  .from('table_bookings')
  .select('id, customer_id, booking_reference, booking_date, booking_time')
  .eq('status', 'pending_payment')
  .lte('booking_date', cutoffDate.toISOString().split('T')[0])
```

**Missing filter:** `.eq('deposit_waived', false)` or `.is('deposit_waived', null)` — there is NO check on `deposit_waived`.

**What happens:** Any booking with `status = 'pending_payment'` AND `booking_date` within the next 24 hours is cancelled, regardless of whether `deposit_waived = true`. The `deposit_waived` column is **not even selected** in the query — the cron has no awareness of it.

**Jason Loveridge TB-8BAA3C8F — timeline reconstruction:**
- Created: 2026-03-13 13:01 with `status: pending_payment`, `deposit_waived: true`
- `sunday_preorder_completed_at`: 2026-03-14 18:35 (pre-order done 24 minutes before cancellation)
- Cancelled: 2026-03-14 ~19:00 by `system` with reason `deposit_not_paid_within_24h`

The cron ran at or around 19:00 on 2026-03-14, found the booking in `pending_payment` status, checked the 24-hour time window (booking was within 24h of its date), and cancelled it. It never checked `deposit_waived = true`.

**Why was `payment_status` still `pending`?** When `deposit_waived = true`, no payment is required — the status is never updated to `paid` because there is no payment to collect. The cron interprets `pending_payment` status alone as "deposit not paid" without reading the waiver flag. This is the fundamental logic error.

---

### Finding 3 (RISK) — Cron also does not check `event_id` / venue-hosted event exemption

**Severity:** Medium — possible additional incorrect cancellations

CLAUDE.md states: "Events hosted by the venue itself are exceptions to deposit rules." The cron query does not filter out bookings with `event_id IS NOT NULL` or check any venue-event flag. Bookings linked to venue-hosted events with `status = pending_payment` are equally at risk of incorrect auto-cancellation.

---

### Finding 4 (RISK) — Double-layer filtering creates false redundancy and masks the bug

**Severity:** Low (architectural)

The API has server-side status filtering (L523-531). The client has a second client-side filter (L520-523). Both use the same logic. Because the server strips cancelled before sending, the client filter on `statusFilter === 'cancelled'` appears to "work" (returns empty) without throwing any error. This makes the bug silent and hard to notice without explicit testing.

---

## 3. Value Audit

| Value | Location | Expected | Actual | Verdict |
|---|---|---|---|---|
| 24-hour deposit timeout window | `cron/table-booking-deposit-timeout/route.ts` | 24h | `24 * 60 * 60 * 1000` ✓ | PASS |
| 25-hour fetch window (over-fetch buffer) | Same | ~25h | `25 * 60 * 60 * 1000` ✓ | PASS |
| Cancellation reason string | Same | `deposit_not_paid_within_24h` | `'deposit_not_paid_within_24h'` ✓ | PASS |
| `cancelled_by` value for system | Same | `'system'` | `'system'` ✓ | PASS |
| Default status filter | `BohBookingsClient.tsx` L379 | `'all'` | `'all'` ✓ | PASS |
| `deposit_waived` guard | `cron/table-booking-deposit-timeout/route.ts` | Present | **MISSING** | **FAIL** |

---

## 4. Customer/Admin-Facing Language Audit

| Text | Location | Accurate? |
|---|---|---|
| SMS: "Your booking on {date} has been cancelled." (sent for deposit timeout) | `src/lib/table-bookings/bookings.ts` L1191 | **MISLEADING** when `deposit_waived = true` — customer receives a cancellation SMS for a booking that had no deposit requirement |
| "No bookings match the selected filters." | `BohBookingsClient.tsx` L797 | **MISLEADING** — shown when status=cancelled selected, but actually no cancelled bookings are in the dataset; message implies filter worked but found nothing, hiding the bug |
| Filter label "All statuses" | `BohBookingsClient.tsx` L101 | **INACCURATE** — this view excludes cancelled; it should be "Active bookings" or similar |

---

## 5. Policy Drift Findings

| ID | Finding | Type |
|----|---------|------|
| PD-1 | `deposit_waived` column exists in DB and is set by staff, but cron cancellation path is entirely unaware of it — the feature was added after the cron was written and the cron was never updated | Missing enforcement |
| PD-2 | Client `loadBookings()` was never updated to pass `statusFilter` to the API when the server-side filter was added — two halves of the feature were built independently and never wired together | Stale logic / integration gap |
| PD-3 | `STATUS_OPTIONS` in client includes `{ value: 'all', label: 'All statuses' }` but the API treats `null` status param (all) as "hide cancelled" — the option label is a lie | Contradiction |
| PD-4 | Cron does not select or check `deposit_waived`, `event_id`, or `party_size` — three separate exemption conditions from CLAUDE.md domain rules are all unimplemented | Missing enforcement (multiple) |

---

## 6. Defects Requiring Immediate Fix

### Fix 1 — BohBookingsClient: pass `statusFilter` to API (wires client filter to server)

In `loadBookings()`, add `status` to `searchParams` when `statusFilter !== 'all'`:

```ts
const searchParams = new URLSearchParams({ date: focusDate, view })
if (statusFilter !== 'all') {
  searchParams.set('status', statusFilter)
}
```

Also add `statusFilter` to the `useCallback` dependency array.

### Fix 2 — Deposit timeout cron: exclude `deposit_waived = true` bookings

Add `.eq('deposit_waived', false)` (or `.or('deposit_waived.is.null,deposit_waived.eq.false')` if null is semantically "not waived") to the Supabase query:

```ts
await supabase
  .from('table_bookings')
  .select('id, customer_id, booking_reference, booking_date, booking_time, deposit_waived')
  .eq('status', 'pending_payment')
  .eq('deposit_waived', false)           // ← ADD THIS
  .lte('booking_date', cutoffDate.toISOString().split('T')[0])
```

### Fix 3 (recommended) — Deposit timeout cron: also exclude venue-event bookings

Add `.is('event_id', null)` per CLAUDE.md domain rule.

---

## 7. Impacted Bookings Assessment

Any booking satisfying all of:
- `status = 'pending_payment'`
- `booking_date` was within 24h of a cron run
- `deposit_waived = true`

...will have been incorrectly cancelled. Jason Loveridge's booking is a confirmed case. Additional bookings with the same characteristics may exist in historical data. A DB query to find them:

```sql
SELECT id, booking_reference, booking_date, cancelled_at, cancelled_by, cancellation_reason
FROM table_bookings
WHERE deposit_waived = true
  AND cancelled_by = 'system'
  AND cancellation_reason = 'deposit_not_paid_within_24h';
```
