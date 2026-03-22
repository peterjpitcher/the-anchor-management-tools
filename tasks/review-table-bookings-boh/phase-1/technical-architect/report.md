# Technical Architect Report — BOH Table Bookings Filter Fix

**Date**: 2026-03-15
**Files reviewed**: `src/app/api/boh/table-bookings/route.ts`, `src/app/(authenticated)/table-bookings/boh/BohBookingsClient.tsx`, `src/app/api/cron/table-booking-deposit-timeout/route.ts`

---

## Architecture Assessment

The BOH table bookings system uses a two-fetch pattern: the primary period and a previous-period comparison are both fetched in parallel on every `loadBookings` call. The design intent was hybrid filtering — server pre-filters, client refines. In practice this creates an irreconcilable split because the server doesn't know the client's current filter state.

The architecture has three layers that should communicate but don't:

1. **Server** (`route.ts`): Reads `?date`, `?view`, `?status`, `?q` from query params. But only `date` and `view` are ever sent by the client.
2. **Client state** (`BohBookingsClient.tsx` lines 378–379): Owns `statusFilter` and `searchTerm` as React state, but neither is ever forwarded to the API.
3. **Client filter** (lines 516–550): `useMemo` over the already-truncated `bookings` array; `statusFilter` and `searchTerm` are deps of this memo but not of `loadBookings`.

The result is that the server's `?status` and `?q` code paths are unreachable dead code under the current client implementation.

---

## Failure-at-Step-N Analysis (Auto-Cancellation Cron)

The `table-booking-deposit-timeout` cron (`src/app/api/cron/table-booking-deposit-timeout/route.ts`) executes these steps:

| Step | Action | If this step fails after prior steps committed |
|------|--------|----------------------------------------------|
| 1 | Fetch `pending_payment` bookings within 25h window | No state changed. Safe to retry. |
| 2 | For each booking: `UPDATE table_bookings SET status='cancelled'` with `.eq('status','pending_payment')` optimistic lock | Update is idempotent due to the guard. If it errors, loop continues to next booking. The specific booking is skipped silently (only console.error logged). **No SMS is sent.** No audit event is written. The booking stays `pending_payment`. |
| 3 | Send cancellation SMS via `sendTableBookingCancelledSmsIfAllowed` | SMS fails silently (caught, console.error). The booking is already cancelled in DB — the customer never receives notification. Counter is still incremented. |

**Critical failure mode**: Step 2 fails but does not halt the loop, and no fallback or retry queue exists. Bookings can be silently skipped.

### `deposit_waived` Bug (Secondary Bug Confirmed)

The Supabase query at Step 1 selects on `.eq('status', 'pending_payment')` only. It does **not** select `deposit_waived` and does not filter on it. The in-memory loop also performs no `deposit_waived` check before issuing the cancellation.

**Consequence**: Any booking with `deposit_waived: true` that also has `status: 'pending_payment'` will be auto-cancelled with `cancellation_reason: 'deposit_not_paid_within_24h'`. This is logically incorrect — if the deposit was waived, the 24h payment window does not apply.

**Can it be reversed?** Only by a staff member manually setting status back to `confirmed` or equivalent. There is no automated rollback. The `cancelled_at`, `cancelled_by: 'system'`, and `cancellation_reason` fields would need to be cleared. The SMS (if it sent) cannot be recalled.

---

## Data Model Assessment

The `table_bookings` table has `deposit_waived` (boolean) and `status` as separate fields. The cron query should join or filter on both. The current query:

```sql
SELECT id, customer_id, booking_reference, booking_date, booking_time
FROM table_bookings
WHERE status = 'pending_payment'
  AND booking_date <= <cutoff>
```

Missing clause: `AND (deposit_waived IS NULL OR deposit_waived = false)`

The SELECT also omits `deposit_waived` from the fetched columns, so even a runtime check in the loop body is impossible without a schema change to the query.

---

## Bug 1: Server-Side Cancelled-Stripping

**Root cause**: `statusFilterRaw` is always `null` because the client never appends `?status=` to the URL. The filter branch `else if (!showingCancelledExplicitly)` therefore always executes, silently stripping all cancelled bookings before they reach the client. The client-side `statusFilter === 'cancelled'` then operates on a pre-filtered array that contains zero cancelled bookings.

**Evidence** (route.ts lines 460–480 approximately, confirmed by search results):
```typescript
const showingCancelledExplicitly = parsedStatusFilters !== null && parsedStatusFilters.has('cancelled')
// showingCancelledExplicitly is always false because parsedStatusFilters is always null
```

**Evidence** (BohBookingsClient.tsx lines 392–395):
```typescript
const searchParams = new URLSearchParams({
  date: focusDate,
  view
  // statusFilter and searchTerm are never included
})
```

---

## Bug 2: Dead Code — Server-Side Search (`?q=`)

The API reads `searchQuery` from `?q=` and filters `_search_blob` against it. The client never sends `?q=`. The client duplicates search logic in `filteredBookings` useMemo (lines 528–548). The server-side search code path is unreachable under any normal client usage.

---

## Correct Fix: Recommended Approach

**Option A — Remove server-side cancelled-stripping, keep all filtering client-side**

- Remove the `else if (!showingCancelledExplicitly)` block from route.ts
- The API returns all bookings (including cancelled) for the date range
- The existing client-side `filteredBookings` useMemo handles status and search filtering correctly
- The `loadBookings` dependency array `[focusDate, view]` remains correct — filter changes don't trigger re-fetches, they re-run the memo
- The dead `?status` and `?q` server code can be removed entirely as clean-up

**Option B — Move all filtering to the server**

- Client adds `statusFilter` and `searchTerm` to `URLSearchParams`
- `loadBookings` dependency array must include `statusFilter` and `searchTerm`
- Every filter change triggers a full server round-trip + re-fetch of previous period
- The previous-period comparison fetch would also need status/search params forwarded (or excluded — ambiguous)
- More complex; introduces latency on every keypress for search

**Recommendation: Option A.** It is the minimal-impact fix. The server-side filtering code in the API was written speculatively — it functions correctly but is never called. Removing the cancelled-stripping one-liner (5 lines) resolves the bug without touching the client. The search and status client-side logic is already correct. Option B would require changes to `loadBookings`, its dependency array, the previous-period comparison logic, and the API, introducing risk in exchange for no user-visible benefit.

---

## Error Handling Audit

| Location | Finding | Severity |
|---|---|---|
| Cron loop — DB update failure | Silent `console.error`, loop continues, no audit event | High |
| Cron loop — SMS failure | Silent `console.error`, counted as success | Medium |
| `loadBookings` — fetch error | Sets error state, clears bookings. Adequate. | OK |
| `loadBookings` — previous period fetch | `.catch(() => null)` swallows errors; previous period is blanked. Acceptable for comparison data. | Low |
| Route — assignments query failure | `logger.warn` then continues without assignment data. Safe. | OK |

---

## Technical Debt

1. **Dead server-side `?q=` search code** in route.ts — should be removed when Option A is applied.
2. **Dead server-side `?status=` filter code** in route.ts — same.
3. **Cron missing audit logging** — no `logAuditEvent()` calls despite mutating booking records.
4. **Cron missing `deposit_waived` guard** — confirmed bug.
5. **`booking_time` timezone assumption** in cron: `new Date(\`${booking_date}T${booking_time}\`)` creates a local-time Date. If the Vercel runtime is UTC (it is), this parses as UTC, not London time. Bookings at e.g. 11pm London time would be off by 1h in winter / 0h in summer. Low risk but worth noting.
6. **`_search_blob` exposed in API response shape then removed** (`_ignoredSortKey`, `_ignoredSearchBlob`) — this is clean; the pattern is fine but unusual.

---

## Summary Answers to Key Questions

1. **Correct fix**: Option A — remove the server-side cancelled-stripping block. 5-line change in route.ts. No client changes needed.
2. **Server-side `?q=` reachable?** No. Safe to remove as dead code.
3. **`loadBookings` dependency array**: `[focusDate, view]` is correct for Option A. Status/search filter changes should not trigger re-fetches — the useMemo handles them.
4. **Auto-cancellation with `deposit_waived=true`**: This is an active bug. Reversal requires manual staff intervention. Fix: add `.eq('deposit_waived', false)` (or `.or('deposit_waived.is.null,deposit_waived.eq.false')`) to the Supabase query, and add `deposit_waived` to the SELECT columns to enable a runtime guard as defence-in-depth.
