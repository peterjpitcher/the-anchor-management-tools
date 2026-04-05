# Performance Review: Mileage, Expenses, MGD Modules

**Date:** 2026-04-05
**Reviewer:** Performance Specialist (Claude)
**Scale:** ~200 mileage trips/year, ~600 expenses/year, ~25 MGD collections/year

---

## Summary

The implementation is generally well-structured for the stated scale. Most queries are efficient and the export pipeline uses streaming with bounded concurrency -- good practice. I identified 10 findings: 2 medium severity, 6 low, and 2 informational. None are critical blockers at current scale, but several would become problems with growth or affect export latency today.

**Findings by severity:**
- Medium: 2
- Low: 6
- Info: 2

---

## Findings

### PERF-001: getDestinations fetches ALL trip legs to count references

**File:** `src/app/actions/mileage.ts:143-160`
**Severity:** Medium
**Category:** Over-fetching / N+1 avoidance gone wrong
**Impact:** Fetches every row from `mileage_trip_legs` (all columns: `from_destination_id`, `to_destination_id`) and counts in JS. At 200 trips x ~4 legs = 800 rows this is acceptable, but it transfers unnecessary data and does work the DB should do.

**Description:**
The query fetches all leg rows just to count how many reference each destination. This should be a `GROUP BY` or aggregate query. Additionally, the distance cache query on line 165-168 fetches ALL distances rather than filtering to pairs involving the home base.

**Fix:**
Replace the leg-count query with a DB-side aggregate. For the distance cache, filter server-side:
```sql
-- Leg counts: use an RPC or two separate count queries grouped by destination
-- Distance cache: add .or(`from_destination_id.eq.${homeBase.id},to_destination_id.eq.${homeBase.id}`)
```

---

### PERF-002: getExpenseFiles generates signed URLs sequentially via Promise.all on individual calls

**File:** `src/app/actions/expenses.ts:668-685`
**Severity:** Medium
**Category:** Sequential network calls
**Impact:** Each signed URL is a separate Supabase storage API call. With 10 files per expense (the maximum), this is 10 serial-ish HTTP round trips. `Promise.all` helps but each is still a separate request.

**Description:**
Supabase storage supports `createSignedUrls` (plural) which takes an array of paths and returns all signed URLs in a single request. The current implementation creates individual signed URLs in a `Promise.all` loop.

**Fix:**
```typescript
const paths = files.map(f => f.storage_path)
const { data: signedUrls } = await supabase.storage
  .from(EXPENSE_RECEIPTS_BUCKET)
  .createSignedUrls(paths, 3600)
```
Then map the results back to the file objects.

---

### PERF-003: cacheDistances upserts sequentially in a loop

**File:** `src/app/actions/mileage.ts:882-904`
**Severity:** Low
**Category:** Sequential DB writes
**Impact:** A trip with 4 legs makes 4 sequential upsert calls. At ~3-5 legs per trip this adds ~100-200ms of latency to trip creation.

**Description:**
The `cacheDistances` function loops over legs and awaits each upsert individually. These could be batched into a single upsert call since Supabase supports bulk upsert.

**Fix:**
```typescript
const upsertRows = legs.map(leg => {
  const [canonFrom, canonTo] = canonicalPair(leg.fromDestinationId, leg.toDestinationId)
  return {
    from_destination_id: canonFrom,
    to_destination_id: canonTo,
    miles: leg.miles,
    last_used_at: new Date().toISOString(),
  }
})
await db.from('mileage_destination_distances')
  .upsert(upsertRows, { onConflict: 'from_destination_id,to_destination_id' })
```

---

### PERF-004: MGD page has a waterfall -- getCollections awaits after getReturns/getCurrentReturn

**File:** `src/app/(authenticated)/mgd/page.tsx:41-54`
**Severity:** Low
**Category:** Request waterfall
**Impact:** The `getCollections` call on line 47 happens sequentially after `getCurrentReturn` resolves, adding one extra round trip (~50-100ms). At 25 collections/year the data is tiny, but the latency is avoidable.

**Description:**
The page first `Promise.all`s `getCurrentReturn` + `getReturns`, then conditionally calls `getCollections`. Since `getCollections` needs the return's period dates, it cannot be fully parallelised. However, `getCurrentMgdQuarter()` is a pure function -- the period dates could be computed client-side and all three queries fired in parallel.

**Fix:**
Import `getCurrentMgdQuarter` in the page, compute `periodStart`/`periodEnd` directly, and fire all three queries in a single `Promise.all`:
```typescript
const { periodStart, periodEnd } = getCurrentMgdQuarter()
const [currentReturnResult, returnsResult, collectionsResult] = await Promise.all([
  getCurrentReturn(),
  getReturns(),
  getCollections(periodStart, periodEnd),
])
```

---

### PERF-005: Mileage page fetches all trips without date filter on initial load

**File:** `src/app/(authenticated)/mileage/page.tsx:19-23`
**Severity:** Low
**Category:** Over-fetching
**Impact:** `getTrips()` with no filter returns ALL trips ever recorded. At 200/year this is fine for 1-2 years, but after 5+ years (1000+ trips with embedded legs), the payload grows linearly. Trips include full `legs` arrays which adds to serialisation cost.

**Description:**
The page calls `getTrips()` without any date filter, loading all historical trips. For a dashboard-style page, only the current tax year or quarter is typically needed.

**Fix:**
Default to current tax year or calendar year filter:
```typescript
const { start } = getTaxYearBounds(getTodayIsoDate())
const tripsResult = await getTrips({ dateFrom: start })
```

---

### PERF-006: Expenses page fetches all expenses without date filter on initial load

**File:** `src/app/(authenticated)/expenses/page.tsx:16-19`
**Severity:** Low
**Category:** Over-fetching
**Impact:** Same issue as PERF-005 but for expenses at 600/year. After 3 years, initial load transfers 1800+ expense records.

**Description:**
`getExpenses()` is called with no filters, loading all historical expenses.

**Fix:**
Default to current quarter or tax year:
```typescript
const expensesResult = await getExpenses({ dateFrom: qStartStr, dateTo: qEndStr })
```

---

### PERF-007: Duplicate permission + auth check in mileage/expenses helpers

**File:** `src/app/actions/mileage.ts:90-103`, `src/app/actions/expenses.ts:82-95`
**Severity:** Low
**Category:** Redundant work
**Impact:** Each server action calls `checkUserPermission` (which internally calls `getUser()`) and then separately calls `getCurrentUser()` (which also calls `getUser()`). This is 2 auth round trips per action instead of 1.

**Description:**
`requireMileagePermission` and `requireExpensePermission` both call `checkUserPermission` (line 94/86) then `getCurrentUser` (line 98/90). Both functions internally resolve the current user via Supabase auth. This results in two `supabase.auth.getUser()` calls per server action invocation.

**Fix:**
Resolve the user once, then check permission with the known user ID:
```typescript
async function requireMileagePermission(action: 'view' | 'manage') {
  const { user_id, user_email } = await getCurrentUser()
  if (!user_id) throw new Error('Unauthorized')
  const canAccess = await checkUserPermission('mileage', action, user_id)
  if (!canAccess) throw new Error('Insufficient permissions')
  return { userId: user_id, userEmail: user_email ?? '' }
}
```
Note: this requires `checkUserPermission` to accept an optional `userId` parameter (the MGD module already passes `user.id` on line 60 of `mgd.ts`, confirming this signature exists).

---

### PERF-008: Export route fetches expense IDs separately then files -- could be a single join

**File:** `src/app/api/receipts/export/route.ts:172-173`
**Severity:** Low
**Category:** Unnecessary query
**Impact:** Two sequential queries (getExpenseIdsForQuarter then appendExpenseImages) where a single query with a join would suffice. Minor at ~150 expenses/quarter.

**Description:**
`getExpenseIdsForQuarter` fetches expense IDs, then `appendExpenseImages` uses those IDs to fetch files with a `.in()` filter. The intermediate ID-fetch query could be eliminated by querying `expense_files` directly with a date-range join on the parent `expenses` table.

**Fix:**
In `appendExpenseImages`, accept `startDate`/`endDate` instead of `expenseIds[]` and query:
```typescript
.from('expense_files')
.select('..., expense:expenses!inner(expense_date, company_ref, amount)')
.gte('expense.expense_date', startDate)
.lte('expense.expense_date', endDate)
```
This eliminates one query and avoids the `.in()` array size limit concern.

---

### PERF-009: Duplicate normaliseToBuffer and runWithConcurrency implementations

**File:** `src/app/api/receipts/export/route.ts:355-391`, `src/lib/receipts/export/expense-images.ts:184-207`
**Severity:** Info
**Category:** Code duplication
**Impact:** No runtime performance impact, but maintenance burden. If a bug is found in one, the other may be missed.

**Description:**
`normaliseToBuffer` and `runWithConcurrency` are copy-pasted between the export route and the expense-images module. These should be shared utilities.

**Fix:**
Extract both functions into a shared module (e.g., `src/lib/receipts/export/stream-helpers.ts`) and import from both locations.

---

### PERF-010: Export ZIP compression level set to 1 -- appropriate trade-off

**File:** `src/app/api/receipts/export/route.ts:83`
**Severity:** Info
**Category:** Configuration observation
**Impact:** None -- this is actually good. Level 1 (fastest) is the right choice for an export containing mostly already-compressed images and PDFs. Higher compression would waste CPU for negligible size reduction.

**Description:**
`archiver('zip', { zlib: { level: 1 } })` uses minimal compression. For an archive of JPEGs, PNGs, and PDFs (all already compressed formats), this is the optimal setting. No change recommended.

**Fix:** None required. This is a positive observation.

---

## Not Flagged (Reviewed and Acceptable)

The following patterns were reviewed and found to be appropriate for the stated scale:

1. **No pagination on queries** -- At 200 trips, 600 expenses, 25 MGD collections per year, full result sets are small enough to load at once. Pagination would add complexity without meaningful benefit until volumes grow 5-10x.

2. **`select('*')` on some queries** -- Used in mutations where the full row is needed for audit logging. Acceptable.

3. **Mileage trip legs batch query** (`getTrips` lines 221-225) -- Uses `.in('trip_id', tripIds)` to fetch all legs for all trips in one query, then groups in JS. This is the correct pattern (avoids N+1).

4. **Export streaming architecture** -- The archive pipes to a PassThrough which becomes the response stream. This is proper streaming -- the full ZIP is never buffered in memory.

5. **Concurrency-bounded image downloads** (DOWNLOAD_CONCURRENCY=4, EXPENSE_IMAGE_CONCURRENCY=8) -- Appropriate limits that prevent overwhelming Supabase storage while maintaining throughput.

6. **HMRC rate calculation** (`hmrcRates.ts`) -- Pure functions with O(1) complexity. No performance concerns.

7. **Server Components fetch data, pass to Client Components** -- All three pages correctly use this pattern, avoiding client-side waterfalls.
