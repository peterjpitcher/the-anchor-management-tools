# BOH Table Bookings — Defect Report
Generated: 2026-03-15

---

## DEF-001 — Cancelled bookings invisible in BOH regardless of status filter

**Severity:** High
**Type:** Logic bug — missing parameter propagation
**Status:** Open
**Affects:** `BohBookingsClient.tsx` + `route.ts` (combined failure)

### Description
Staff cannot view cancelled bookings in the BOH view. Selecting "Cancelled" from the status filter dropdown returns zero results.

### Root Cause
Two-layer architecture mismatch:

1. **Client** (`BohBookingsClient.tsx` lines 392–395): `loadBookings` builds `searchParams` with only `{ date, view }`. The `statusFilter` React state is never appended to the fetch URL. The API never receives `?status=`.

2. **API** (`route.ts` lines ~344–450): When `statusFilterRaw` is `null`, `parsedStatusFilters` is `null` and `showingCancelledExplicitly` is `false`. The filter block's `else if (!showingCancelledExplicitly)` branch then strips all bookings where `status === 'cancelled'` before returning.

3. **Client-side filter** (`BohBookingsClient.tsx` lines 516–550): `filteredBookings` useMemo correctly filters the received `bookings` array by `statusFilter`. However, since cancelled bookings were stripped by the API, the array never contains them. The client-side filter is logically correct but operates on incomplete data.

### Code Evidence
```
// BohBookingsClient.tsx ~392
const searchParams = new URLSearchParams({
  date: focusDate,
  view           // ← status is never added here
})

// route.ts ~filter block
} else if (!showingCancelledExplicitly) {
  if ((booking.status || '').toLowerCase() === 'cancelled') {
    return false  // ← always executes when status param absent
  }
}
```

### Impact
- All cancelled bookings are invisible to BOH staff.
- TB-8BAA3C8F (incorrectly auto-cancelled, see DEF-002) cannot be found or investigated via BOH UI.
- "Cancelled" filter option in the UI is non-functional; appears to work (UI updates) but always shows 0 results.

### Fix
Fetch all bookings including cancelled on initial load (omit `?status=` param but change API default to include cancelled, OR pass `?status=confirmed,pending_payment,cancelled,no_show,...` explicitly). Apply status filtering client-side only. The API's `showingCancelledExplicitly` guard logic is only needed if server-side filtering is desired — for BOH, full client-side filtering is cleaner.

**Alternatively (lighter fix):** Append `status=cancelled` to `searchParams` when `statusFilter === 'cancelled'` and refetch on filter change. The API will then correctly return cancelled-only results.

---

## DEF-002 — Auto-cancellation fires on deposit_waived = true (data loss)

**Severity:** Critical
**Type:** Missing guard — business rule not implemented
**Status:** Open — real booking TB-8BAA3C8F affected
**Affects:** `src/app/api/cron/table-booking-deposit-timeout/route.ts`

### Description
The deposit-timeout cron job cancelled booking TB-8BAA3C8F (Jason Loveridge, 2026-03-15 17:00, party 8) with reason `deposit_not_paid_within_24h`. The booking had `deposit_waived = true`, meaning no deposit was required. The system should not have cancelled it.

### Root Cause
The cron selects only: `id, customer_id, booking_reference, booking_date, booking_time`. It does NOT select or check `deposit_waived`. Every booking in `pending_payment` status within 24h of its booking time is cancelled unconditionally.

### Code Evidence
```typescript
// table-booking-deposit-timeout/route.ts
const { data: candidates, error } = await supabase
  .from('table_bookings')
  .select('id, customer_id, booking_reference, booking_date, booking_time')
  //       ↑ deposit_waived NOT selected, NOT checked
  .eq('status', 'pending_payment')
  .lte('booking_date', cutoffDate.toISOString().split('T')[0])

// Then for each candidate:
const { error: updateErr } = await supabase
  .from('table_bookings')
  .update({ status: 'cancelled', ... cancellation_reason: 'deposit_not_paid_within_24h' })
  .eq('id', booking.id)
  .eq('status', 'pending_payment')
  // ↑ No .eq('deposit_waived', false) guard
```

### Timeline (TB-8BAA3C8F)
- 2026-03-13 13:01 — Booking created with `deposit_waived = true`
- 2026-03-14 18:35 — Pre-order completed (`sunday_preorder_completed_at` set)
- 2026-03-14 19:00 — Cron fires (hourly, `0 * * * *`); booking within 24h window; no waiver check; booking cancelled
- 2026-03-15 17:00 — Booking time (party of 8 now has no reservation)

### Additional Guards Missing (same cron)
1. `sunday_preorder_completed_at IS NOT NULL` — completion of pre-order is a strong signal the customer is engaged; cancellation after pre-order was completed is especially damaging
2. `is_venue_event = true` (if applicable) — venue-hosted events should be exempt
3. `booking_time IS NULL` — `new Date('DATE Tnull')` produces Invalid Date; the 24h comparison evaluates as `NaN > N` = `false`, so the booking proceeds to cancellation (should be skipped or logged)

### Impact
- Real customer booking cancelled incorrectly. Customer received cancellation SMS.
- Party of 8 on 2026-03-15 17:00 has no confirmed table reservation.
- Pre-order data is preserved (it's a timestamp on the booking row) but the booking is cancelled, so the pre-order is moot.
- Customer trust damage; potential loss of revenue (£10 × 8 = £80 deposit that was waived but booking now lost).

### Immediate Action Required
Restore TB-8BAA3C8F manually:
```sql
UPDATE table_bookings
SET status = 'confirmed',
    cancelled_at = NULL,
    cancelled_by = NULL,
    cancellation_reason = NULL,
    updated_at = NOW()
WHERE booking_reference = 'TB-8BAA3C8F';
```
Then contact the customer to confirm the booking is reinstated.

### Fix
Add guards to the DB query and/or the per-booking check:
```typescript
.select('id, customer_id, booking_reference, booking_date, booking_time, deposit_waived, sunday_preorder_completed_at')
// ...
for (const booking of candidates ?? []) {
  if (booking.deposit_waived === true) continue  // ← ADD
  if (booking.sunday_preorder_completed_at) continue  // ← ADD
  // existing 24h window check...
}
```

Or add to the DB query as additional filters:
```typescript
.eq('deposit_waived', false)
.is('sunday_preorder_completed_at', null)
```

---

## DEF-003 — "All statuses" filter loses cancelled bookings (design gap)

**Severity:** Medium
**Type:** Design gap — "all" sentinel not handled
**Status:** Open
**Affects:** `BohBookingsClient.tsx` + `route.ts`

### Description
When `statusFilter = 'all'`, the client sends no status param. The API default strips cancelled. So "All statuses" silently excludes cancelled — which may be the intended default for the daily operations view, but is potentially confusing.

If the decision is that "All statuses" should include cancelled, the API default must change. If cancelled should only appear when explicitly selected, that is fine — but the "Cancelled" filter (DEF-001) must work.

### Note
DEF-003 is a product decision dependent on DEF-001 being resolved first. If DEF-001 is fixed by fetching all data client-side (recommended), DEF-003 resolves automatically.

---

## DEF-004 — Passing `?status=all` to API returns zero bookings

**Severity:** Low (current code never sends this, but risk if refactored naively)
**Type:** API contract gap
**Status:** Risk item
**Affects:** `route.ts`

### Description
`parsedStatusFilters = new Set(['all'])`. No booking has `status = 'all'` or `visual_status = 'all'`. API returns 0 results.

### Fix
In `loadBookings`, never append `status=all` to the URL. Use absence of the `?status=` param to mean "all (minus cancelled)" or "all (including cancelled)" depending on the agreed default.

---

## Coverage Assessment

| Area | Tested | Missing Coverage |
|---|---|---|
| API filter logic (server-side) | TC005–TC008 | Edge case: `status=all` passed |
| Client fetch URL construction | TC001–TC004, TC009 | Status param propagation not covered by any existing test |
| Auto-cancel deposit_waived guard | TC010–TC017 | No tests exist for cron logic; entire cron is untested |
| Pre-order completion guard | TC011 | No tests |
| Venue event exemption | TC017 | No tests |
| Null booking_time handling | TC016 | No tests |
| Data recovery (TC014) | TC014 | No automated path; manual only |
| State consistency | TC020–TC023 | No tests |

**Overall test coverage for this feature area: 0% automated.** No test files found for the BOH route, the BOH client, or the deposit-timeout cron. All defects were identified by static code analysis only.

---

## Priority Order for Fix

1. **Immediate** (data integrity): Restore TB-8BAA3C8F manually (SQL above)
2. **Critical** (prevents future data loss): Fix DEF-002 — add `deposit_waived` and `sunday_preorder_completed_at` guards to cron
3. **High** (broken feature): Fix DEF-001 — make cancelled filter work in BOH view
4. **Medium** (design clarity): Resolve DEF-003 — define and document what "All statuses" means
5. **Low** (defensive): Address DEF-004 as part of DEF-001 fix
