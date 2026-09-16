# 1,000-Row Cap Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the implement-plan skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop eleven production reads from silently returning only the first 1,000 rows, and make a staff data export contain the person's full audit history.

**Architecture:** Supabase's REST API returns at most 1,000 rows per request and says nothing when it cuts a result short. Every fix follows one of two shapes: read the whole set through one shared paging helper that orders by a unique tiebreak and throws rather than truncating, or stop asking for all the rows and let the database aggregate. No fix raises a `.limit()`, because a limit above 1,000 is silently reduced to 1,000.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Supabase (supabase-js 2.101), Vitest (jsdom, `TZ=Europe/London`), Tailwind v4.

**Spec:** This plan is self-contained. The findings below were verified on 15 September 2026 against the code at commit `33a1b550` and against live production counts (project `tfcasgxopxegwrabvwat`). None of the audited files changed between `33a1b550` and `f65d0a82`, the commit this plan starts from.

## Audit findings this plan fixes

Row counts are live figures from 15 September 2026. Re-run each count before you start a task: they move daily.

| # | Where | Reads | Live size | Effect today |
|---|---|---|---|---|
| 1 | `src/lib/analytics/engagement-scoring.ts:176-193` | customers, bookings, table_bookings | 1,000 of 1,535 event bookings seen by the last run | 264 of 452 customers have undercounted scores, 15 have a wrong last booking date, labels rebuilt from partial data |
| 2 | `src/services/receipts/receiptQueries.ts:1552` | receipt_transactions | 1,000 of 3,387 rows (GBP 1,505,309 outgoing) | /receipts/missing-expense totals show about 30% of the backlog |
| 3 | `src/services/receipts/receiptMutations.ts:1987` and `:2000` | receipt_transactions | 5,127 qualify, 2,000 queued per click | Re-classify never reaches most of the backlog, and repeats rows |
| 4 | `src/services/receipts/receiptQueries.ts:976` | rpc `get_receipt_vendor_monthly_totals(48)` | 1,556 rows | 92 of 247 vendors missing from the movements panel on every load |
| 5 | `src/services/receipts/receiptQueries.ts:237-317` | receipt_transactions | 8,202 rows, pages of 5,000 | With "outstanding only" off, rows 1,001 to 5,000 are unreachable |
| 6 | `src/services/cashing-up.service.ts:175` and `:181` | cashup_payment_breakdowns, cashup_sales_breakdowns | 1,044 and 1,035 rows in the default window | Payment Mix understated on every load; Sales Mix can lose days |
| 7 | `src/services/gdpr.ts:571` | audit_logs | 3 staff over 1,000 rows, largest 3,083 | A staff data export silently omits older history |
| 8 | `src/app/actions/auditLogs.ts:57` | audit_logs | 8,644 rows with a user, 26 distinct users | The User filter lists 11 of 26 staff |
| 9 | `src/app/(authenticated)/rota/hours/page.tsx:131-144` and `src/app/api/rota/hours/pdf/route.ts:546-559` | timeclock_sessions, leave_days | 1,398 sessions; a 15-month range returns 1,025 | Long ranges silently lose the newest hours from totals, chart and PDF |
| 10 | `src/services/receipts/receiptQueries.ts:1653-1657`, `src/services/receipts/receiptGovernance.ts:195-199` | receipt_transactions | newest 1,000 of 8,202 | Rule preview and conflict warnings cover about 12% of history |
| 11 | `src/services/receipts/receiptQueries.ts:319-323` | receipt_transactions | 61 of 254 vendor names reachable | Vendor suggestions miss most names |

Close to the cap, fixed in Tasks 13 and 14: win-back audience (997 of a 1,000 ceiling), short-link analytics (363 in 90 days, 702 over the 366-day maximum), events list link clicks (817 for the busiest 25 events), vendor trends (604) and vendor history (647), first-visit review check (658), hours page leave days (693).

## Global Constraints

- Never fix a cap by raising a limit. `.limit(5000)` and `.range(0, 4999)` both return 1,000 rows.
- Every paging loop orders by a column plus a unique tiebreak (`id` unless stated), uses a page size of 1,000 or less, and stops when a page returns fewer rows than it asked for.
- A paged read that reaches its safety cap throws. Silent truncation is the bug being fixed; do not replace it with a silent cap.
- Child rows embedded in a select (`select('*, receipt_files(*)')`) are not capped. Only top level rows are. Do not page embeds.
- `{ count: 'exact' }` returns the true total even when `data` is capped. Use `count` for totals, never `data.length`.
- No new migration is applied without the prod-migrate skill and the owner's explicit go-ahead, every time. Task 12 is the only migration in this plan.
- Tests are Vitest, live under `tests/` mirroring `src/`, and run in `Europe/London`. Build assertions from `src/lib/dateUtils.ts`, never from host-local dates.
- Gates before every commit: `npm run lint` (zero warnings), `npx tsc --noEmit`, `npm test`. Run `nvm use` first: the shell default is Node 26 and this repo needs Node 20.
- British English in all user-facing copy. Never use an em dash (U+2014) anywhere, including commit messages.
- Branch `fix/row-cap-paging` off `main`. One commit per task, conventional commits. Do not push, merge or deploy without being asked.

---

## File Structure

**Created**
- `src/lib/supabase/paged-read.ts` - the single paging helper every fix uses.
- `tests/lib/supabase/paged-read.test.ts` - its tests.
- `src/lib/rota/hours-report-data.ts` - one loader for the hours page and its PDF, which today run duplicate queries.
- `tests/lib/rota/hours-report-data.test.ts`
- `tests/guards/row-cap.test.ts` - regression guard that fails the suite when new code asks for more than 1,000 rows in one request.
- `supabase/migrations/<timestamp>_audit_log_users_function.sql` - Task 12 only, applied separately.

**Modified**
- `src/lib/analytics/engagement-scoring.ts:174-193`
- `src/services/receipts/receiptQueries.ts` (`:237-330`, `:971-1016`, `:1549-1596`, `:1648-1658`)
- `src/services/receipts/receiptMutations.ts:1983-2038`
- `src/services/receipts/receiptGovernance.ts:188-200`
- `src/services/receipts/types.ts:506`
- `src/services/cashing-up.service.ts:174-195`
- `src/services/gdpr.ts:571-578`
- `src/app/actions/auditLogs.ts:47-83`
- `src/app/(authenticated)/rota/hours/page.tsx:125-170`
- `src/app/api/rota/hours/pdf/route.ts:540-590`
- `src/app/actions/customers.ts:651-668`
- `src/lib/sms/review-once.ts:99-128`
- `src/services/events.ts:1054-1070`
- `src/services/marketing-campaigns.ts:1160-1170`
- `src/app/actions/receipts.ts:1116-1134`

---

### Task 1: The shared paged read helper

**Files:**
- Create: `src/lib/supabase/paged-read.ts`
- Test: `tests/lib/supabase/paged-read.test.ts`

**Interfaces:**
- Produces: `fetchAllRows<T>(runPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, options?: { pageSize?: number; maxRows?: number; label?: string }): Promise<T[]>`. Every later task calls this.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/supabase/paged-read.test.ts
import { describe, it, expect, vi } from 'vitest'
import { fetchAllRows } from '@/lib/supabase/paged-read'

const page = (rows: number) => ({ data: Array.from({ length: rows }, (_, i) => ({ i })), error: null })

describe('fetchAllRows', () => {
  it('follows every page until a short page ends it', async () => {
    const runPage = vi.fn()
      .mockResolvedValueOnce(page(1000))
      .mockResolvedValueOnce(page(1000))
      .mockResolvedValueOnce(page(156))
    const rows = await fetchAllRows(runPage)
    expect(rows).toHaveLength(2156)
    expect(runPage).toHaveBeenNthCalledWith(1, 0, 999)
    expect(runPage).toHaveBeenNthCalledWith(2, 1000, 1999)
    expect(runPage).toHaveBeenNthCalledWith(3, 2000, 2999)
  })

  it('never asks for more than 1000 rows in one request', async () => {
    const runPage = vi.fn().mockResolvedValue(page(3))
    await fetchAllRows(runPage, { pageSize: 5000 })
    expect(runPage).toHaveBeenCalledWith(0, 999)
  })

  it('throws instead of returning a truncated result at the safety cap', async () => {
    const runPage = vi.fn().mockResolvedValue(page(1000))
    await expect(fetchAllRows(runPage, { maxRows: 2000, label: 'receipts' }))
      .rejects.toThrow(/receipts.*2000 row cap/)
  })

  it('throws the underlying error', async () => {
    const runPage = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(fetchAllRows(runPage, { label: 'scores' })).rejects.toThrow(/scores.*boom/)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- tests/lib/supabase/paged-read.test.ts`
Expected: FAIL, cannot resolve `@/lib/supabase/paged-read`.

- [ ] **Step 3: Write the helper**

```ts
// src/lib/supabase/paged-read.ts
// Supabase returns at most 1,000 rows per request and gives no error when it
// cuts a result short, so every "read them all" path pages through the set and
// fails loudly rather than quietly handing back a partial answer.
const MAX_ROWS_PER_REQUEST = 1000

export type PagedReadResult<T> = { data: T[] | null; error: { message: string } | null }

export type PagedReadOptions = {
  /** Rows per request. Clamped to 1,000, the server's own ceiling. */
  pageSize?: number
  /** Safety cap. Reaching it throws, because a silent stop is the bug we are fixing. */
  maxRows?: number
  /** Included in thrown errors so logs name the caller. */
  label?: string
}

export async function fetchAllRows<T>(
  runPage: (from: number, to: number) => PromiseLike<PagedReadResult<T>>,
  options: PagedReadOptions = {},
): Promise<T[]> {
  const label = options.label ?? 'paged read'
  const pageSize = Math.min(Math.max(Math.floor(options.pageSize ?? MAX_ROWS_PER_REQUEST), 1), MAX_ROWS_PER_REQUEST)
  const maxRows = Math.max(Math.floor(options.maxRows ?? 100_000), pageSize)
  const rows: T[] = []

  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await runPage(from, from + pageSize - 1)
    if (error) throw new Error(`${label} failed: ${error.message}`)
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < pageSize) return rows
  }

  throw new Error(`${label} stopped at the ${maxRows} row cap, so the result would have been incomplete`)
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- tests/lib/supabase/paged-read.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase/paged-read.ts tests/lib/supabase/paged-read.test.ts
git commit -m "feat: add a paged read helper that fails rather than truncating"
```

---

### Task 2: Nightly scores read every booking

**Files:**
- Modify: `src/lib/analytics/engagement-scoring.ts:174-193`
- Test: `tests/lib/analytics/engagement-scoring-paging.test.ts`

**Interfaces:**
- Consumes: `fetchAllRows` from Task 1.

- [ ] **Step 1: Write the failing test**

Mock a client whose `customers` read returns 1,000 rows on the first page and 153 on the second, and assert the job scores 1,153 customers. Follow the mocking style in `tests/services/cashing-up.service.test.ts`.

```ts
// tests/lib/analytics/engagement-scoring-paging.test.ts
import { describe, it, expect } from 'vitest'
import { recalculateEngagementScoresAndLabels } from '@/lib/analytics/engagement-scoring'
import { makePagingClient } from './helpers/paging-client'

describe('recalculateEngagementScoresAndLabels', () => {
  it('reads every customer and booking, not the first 1,000', async () => {
    const client = makePagingClient({
      customers: 1153,
      bookings: 1538,
      table_bookings: 850,
      private_bookings: 0,
      waitlist_entries: 0,
    })
    const summary = await recalculateEngagementScoresAndLabels(client)
    expect(summary.processed_customers).toBe(1153)
    expect(client.rangesFor('bookings')).toEqual([[0, 999], [1000, 1999]])
  })
})
```

Write `tests/lib/analytics/helpers/paging-client.ts` in the same step: a fake client whose `.from(table).select(...)` chain records `.range()` calls and returns the requested number of synthetic rows, capped at 1,000 per page, so the test fails today (the current code never calls `.range()`).

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- tests/lib/analytics/engagement-scoring-paging.test.ts`
Expected: FAIL, `rangesFor('bookings')` is `[]` and `processed_customers` is 1,000.

- [ ] **Step 3: Page all five reads**

Replace the `Promise.all` block at `:174-193`. Each read keeps its existing columns and filters and gains an order plus paging:

```ts
  const [customerRows, eventBookingRows, tableBookingRows, privateBookingRows, waitlistRows] = await Promise.all([
    fetchAllRows<{ id: string }>((from, to) =>
      supabase.from('customers').select('id').order('id').range(from, to), { label: 'engagement scoring customers' }),
    fetchAllRows<EventBookingRow>((from, to) =>
      supabase
        .from('bookings')
        .select('customer_id, created_at, event:events(event_type, category:event_categories(name))')
        .not('customer_id', 'is', null)
        .order('id')
        .range(from, to), { label: 'engagement scoring event bookings' }),
    fetchAllRows<TableBookingRow>((from, to) =>
      supabase.from('table_bookings').select('customer_id, created_at')
        .not('customer_id', 'is', null).order('id').range(from, to), { label: 'engagement scoring table bookings' }),
    fetchAllRows<PrivateBookingRow>((from, to) =>
      supabase.from('private_bookings').select('customer_id, created_at, status')
        .not('customer_id', 'is', null).order('id').range(from, to), { label: 'engagement scoring private bookings' }),
    fetchAllRows<WaitlistRow>((from, to) =>
      supabase.from('waitlist_entries')
        .select('customer_id, event:events(event_type, category:event_categories(name))')
        .not('customer_id', 'is', null).order('id').range(from, to), { label: 'engagement scoring waitlist' }),
  ])
```

Move the row type aliases (`EventBookingRow` and friends, currently inline at `:213`, `:233`, `:249`, `:268`) above this block so the generics can name them, and delete the old `errors` collection at `:195-204`: `fetchAllRows` throws on the first error, which the cron already reports.

- [ ] **Step 4: Run the tests**

Run: `npm test -- tests/lib/analytics`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/engagement-scoring.ts tests/lib/analytics
git commit -m "fix: score customers from every booking, not the first 1,000"
```

- [ ] **Step 6: Confirm against production after deploy**

After the next 03:00 run, this must return 0:

```sql
with actual as (select customer_id, count(*) n from bookings where customer_id is not null group by customer_id)
select count(*) from actual a join customer_scores cs on cs.customer_id = a.customer_id
where coalesce((cs.booking_breakdown->>'event')::int, 0) < a.n;
```

It returned 264 on 15 September 2026.

---

### Task 3: Missing-expense summary counts every transaction

**Files:**
- Modify: `src/services/receipts/receiptQueries.ts:1549-1596` (`queryReceiptMissingExpenseSummary`)
- Test: `tests/services/receipts/missing-expense-summary.test.ts`

- [ ] **Step 1: Write the failing test**

Assert that a client returning 1,000 then 1,000 then 1,387 rows produces `transactionCount` totalling 3,387 across the returned vendors, and that the reads ask for `[0,999]`, `[1000,1999]`, `[2000,2999]`, `[3000,3999]`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- tests/services/receipts/missing-expense-summary.test.ts`
Expected: FAIL, total is 1,000 and only one request is made.

- [ ] **Step 3: Replace the limit with paging**

```ts
  const data = await fetchAllRows<MissingExpenseRow>((from, to) =>
    supabase
      .from('receipt_transactions')
      .select('vendor_name, amount_out, amount_in, transaction_date')
      .is('expense_category', null)
      .not('amount_out', 'is', null)
      .order('id')
      .range(from, to),
    { label: 'receipts missing expense summary' },
  )
```

Delete the `.limit(5000)` call and the `if (error)` block that follows it at `:1559-1562`; keep the grouping loop below unchanged.

- [ ] **Step 4: Run the tests**

Run: `npm test -- tests/services/receipts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/receipts/receiptQueries.ts tests/services/receipts/missing-expense-summary.test.ts
git commit -m "fix: count every uncategorised transaction on the missing expense page"
```

---

### Task 4: Re-classify queues the whole backlog

**Files:**
- Modify: `src/services/receipts/receiptMutations.ts:1983-2038` (`performRequeueUnclassifiedTransactions`)
- Test: `tests/services/receipts/requeue-unclassified.test.ts`

- [ ] **Step 1: Write the failing test**

Assert that with 4,929 vendor-missing and 3,387 expense-missing rows (overlapping to 5,127 unique ids), `queued` is 5,127 and both reads page.

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- tests/services/receipts/requeue-unclassified.test.ts`
Expected: FAIL, `queued` is at most 2,000.

- [ ] **Step 3: Page both reads**

Replace both `.limit(5000)` reads with `fetchAllRows`, each ordered by `id`, keeping their filters exactly as they are today (`vendor_name`/`vendor_source` null on the first; `expense_category`/`expense_category_source` null with `amount_out > 0` on the second). Keep the de-duplication loop at `:2014-2022` as it is.

- [ ] **Step 4: Run the tests**

Run: `npm test -- tests/services/receipts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/receipts/receiptMutations.ts tests/services/receipts/requeue-unclassified.test.ts
git commit -m "fix: re-classify every unclassified transaction, not the first 2,000"
```

---

### Task 5: Vendor movements panel reads every vendor month

**Files:**
- Modify: `src/services/receipts/receiptQueries.ts:971-1016` (`queryReceiptVendorMonthlyMovementSources`)
- Test: `tests/services/receipts/vendor-monthly-movement.test.ts`

The database function `get_receipt_vendor_monthly_totals` returns one row per vendor per month, ordered by vendor label then month, with no limit: 1,556 rows for the 48-month range the page asks for. The cap applies to function results too.

- [ ] **Step 1: Prove `.range()` pages an rpc call**

Nothing in `src/` pages an rpc today, so confirm the mechanism before building on it. With the dev server running against production credentials is not acceptable; instead run a read-only script against the service role key in `.env.local`:

```bash
nvm use && npx tsx -e "
import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
for (const [from, to] of [[0, 999], [1000, 1999]]) {
  const { data, error } = await db.rpc('get_receipt_vendor_monthly_totals', { range_months: 48 }).range(from, to);
  console.log(from, to, error?.message ?? data?.length);
}"
```

Expected: `0 999 1000` then `1000 1999 556`. If the second call returns 1,000 again or errors, stop and use the fallback in Step 3b instead.

- [ ] **Step 2: Write the failing test**

Assert `queryReceiptVendorMonthlyMovementSources('36m')` groups 1,556 rows and that the rpc is called with `range(0, 999)` then `range(1000, 1999)`.

- [ ] **Step 3a: Page the rpc (if Step 1 passed)**

```ts
  const rows = await fetchAllRows<VendorMonthlyTotalRow>((from, to) =>
    supabase.rpc('get_receipt_vendor_monthly_totals', { range_months: rangeMonths }).range(from, to),
    { label: 'receipt vendor monthly totals' },
  )
  return { sources: groupVendorMonthlyTotals(rows) }
```

Keep the existing `isMissingVendorMonthlyTotalsRpcError` fallback path below it, and change its own paged scan at `:993-1013` to use `fetchAllRows` with `.order('id')` added, since it pages `receipt_transactions` with no unique tiebreak today.

- [ ] **Step 3b: Fallback (only if Step 1 failed)**

Call the function once per 12-month window (`range_months: 12`, 24, 36, 48) and merge the windows by vendor and month, discarding duplicates. Each window is under 700 rows today. Record in the commit message that rpc paging was unavailable.

- [ ] **Step 4: Run the tests**

Run: `npm test -- tests/services/receipts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/receipts/receiptQueries.ts tests/services/receipts/vendor-monthly-movement.test.ts
git commit -m "fix: show every vendor in the receipts movement panel"
```

- [ ] **Step 6: Confirm against production**

`select count(*) from public.get_receipt_vendor_monthly_totals(48);` returned 1,556 on 15 September 2026, and `/receipts/vendors` must now show all 247 vendors, including names after "OpenAI".

---

### Task 6: Receipts list pages honestly

**Files:**
- Modify: `src/services/receipts/types.ts:506`, `src/services/receipts/receiptQueries.ts:237-241`
- Test: `tests/services/receipts/workspace-pagination.test.ts`

Today `MAX_MONTH_PAGE_SIZE` is 5,000, so the list asks for 5,000 rows, receives 1,000, and the pager computes pages from 5,000. Rows 1,001 to 5,000 are unreachable.

- [ ] **Step 1: Write the failing test**

Assert that with 8,202 matching rows and grouping on, the query asks for `range(0, 999)`, the returned `pagination.pageSize` is 1,000, and page 2 asks for `range(1000, 1999)`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- tests/services/receipts/workspace-pagination.test.ts`
Expected: FAIL, `pageSize` is 5,000 and page 2 starts at 5,000.

- [ ] **Step 3: Cap the page size at the server ceiling**

```ts
// src/services/receipts/types.ts
// The REST API returns at most 1,000 rows per request, so a larger page size
// silently drops the rest and breaks the pager's arithmetic.
export const MAX_MONTH_PAGE_SIZE = 1000
```

In `receiptQueries.ts:240-241`, stop forcing the month view to page 1: `const page = Math.max(filters.page ?? 1, 1)` and `const offset = (page - 1) * pageSize` for both views, so a month with more than 1,000 rows can be paged through.

- [ ] **Step 4: Check the client still pages**

Read `src/app/(authenticated)/receipts/_components/ReceiptsClient.tsx:153-156`. `totalPages` comes from `pagination.total / pagination.pageSize`, so it now reports 9 pages for 8,202 rows. Confirm the month filter keeps its page in the URL; if it does not, add `page` to the month filter link in `ReceiptFilters`.

- [ ] **Step 5: Run the tests and commit**

```bash
npm test -- tests/services/receipts
git add src/services/receipts/types.ts src/services/receipts/receiptQueries.ts tests/services/receipts/workspace-pagination.test.ts
git commit -m "fix: page the receipts list in 1,000 row pages so every row is reachable"
```

---

### Task 7: Rule preview and conflict checks cover all history

**Files:**
- Modify: `src/services/receipts/receiptQueries.ts:1648-1658`, `src/services/receipts/receiptGovernance.ts:188-200`
- Test: `tests/services/receipts/rule-preview-scope.test.ts`

- [ ] **Step 1: Write the failing test**

Assert the preview reads every transaction (four pages for 3,500 rows in the fake) and that its reported `totalMatching` counts matches from all pages.

- [ ] **Step 2: Run it and watch it fail**

Expected: FAIL, one request, 1,000 rows.

- [ ] **Step 3: Page both reads**

Replace `.order('transaction_date', { ascending: false }).limit(2000)` in both files with a paged read ordered by `transaction_date` descending plus `id` descending as the tiebreak, using `fetchAllRows` with `{ maxRows: 20000, label: 'receipt rule preview' }` and `'receipt rule conflicts'`.

- [ ] **Step 4: Update the on-screen wording**

`src/app/(authenticated)/receipts/_components/ReceiptRules.tsx:107` tells staff the preview uses a "sample of up to 2000 transactions". Read the current sentence and replace it with one that matches the new behaviour: the preview now covers every transaction.

- [ ] **Step 5: Run the tests and commit**

```bash
npm test -- tests/services/receipts
git add src/services/receipts/receiptQueries.ts src/services/receipts/receiptGovernance.ts "src/app/(authenticated)/receipts/_components/ReceiptRules.tsx" tests/services/receipts/rule-preview-scope.test.ts
git commit -m "fix: preview and conflict checks read every transaction"
```

---

### Task 8: Vendor suggestions stop relying on a capped scan

**Files:**
- Modify: `src/services/receipts/receiptQueries.ts:319-323`
- Test: `tests/services/receipts/vendor-options.test.ts`

The scan reads 1,000 transaction rows sorted A to Z, which today holds 61 of 254 vendor names. The canonical list (`receipt_vendors`, 260 rows) and the current page already supply names.

- [ ] **Step 1: Write the failing test**

Assert `knownVendors` contains a vendor that sorts late in the alphabet and exists in `receipt_vendors`, and that the transactions scan is no longer issued.

- [ ] **Step 2: Run it and watch it fail**

Expected: FAIL, the capped scan is still called.

- [ ] **Step 3: Delete the scan and build options from the canonical sources**

Remove the `vendorQuery` at `:319-323` and its entry in the `Promise.all` destructuring at `:337-346`. Build `knownVendors` from `canonicalVendorRecords`, the vendor names on the current page of transactions, and `set_vendor_name` values on active rules. Keep the returned shape identical.

- [ ] **Step 4: Run the tests and commit**

```bash
npm test -- tests/services/receipts
git add src/services/receipts/receiptQueries.ts tests/services/receipts/vendor-options.test.ts
git commit -m "fix: build vendor suggestions from the vendor list rather than a capped scan"
```

---

### Task 9: Cash-up Insights adds up every breakdown row

**Files:**
- Modify: `src/services/cashing-up.service.ts:174-195`
- Test: `tests/services/cashing-up-insights-paging.test.ts`

- [ ] **Step 1: Write the failing test**

Assert that with 1,044 payment rows the Payment Mix total equals the sum of all 1,044, and that both breakdown reads page. Existing patterns are in `tests/services/cashing-up.service.test.ts`.

- [ ] **Step 2: Run it and watch it fail**

Expected: FAIL, the total covers 1,000 rows.

- [ ] **Step 3: Page both breakdown reads**

Wrap the `cashup_payment_breakdowns` and `cashup_sales_breakdowns` reads in `fetchAllRows`, keeping their existing `cashup_sessions!inner` joins and date filters, and adding `.order('id')`. Leave the `pnl_sales_imports` read as it is: one row per date, at most 366.

- [ ] **Step 4: Run the tests and commit**

```bash
npm test -- tests/services/cashing-up-insights-paging.test.ts tests/services/cashing-up.service.test.ts
git add src/services/cashing-up.service.ts tests/services/cashing-up-insights-paging.test.ts
git commit -m "fix: build the cash-up payment and sales mix from every breakdown row"
```

- [ ] **Step 5: Note for the owner, not for this change**

The payment mix read has no `voided_at` filter while the sessions read above it excludes voided sessions, so voided takings count towards the mix. That is a separate defect. Record it in the handover, do not fix it here.

---

### Task 10: A staff data export contains the full audit history

**Files:**
- Modify: `src/services/gdpr.ts:571-578`
- Test: `tests/services/gdpr-export-audit-history.test.ts`

The owner confirmed on 16 September 2026 that the export must be complete.

- [ ] **Step 1: Write the failing test**

Assert an export for a user with 3,083 audit rows contains 3,083 entries, newest first.

- [ ] **Step 2: Run it and watch it fail**

Expected: FAIL, 1,000 entries.

- [ ] **Step 3: Page the read**

```ts
    exportData.auditLogs = await fetchAllRows<AuditLogRow>((from, to) =>
      adminClient
        .from('audit_logs')
        .select('*')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
      { label: 'gdpr export audit logs' },
    )
```

- [ ] **Step 4: Run the tests and commit**

```bash
npm test -- tests/services/gdpr-export-audit-history.test.ts
git add src/services/gdpr.ts tests/services/gdpr-export-audit-history.test.ts
git commit -m "fix: export a person's full audit history, not the newest 1,000 rows"
```

---

### Task 11: Hours page and its PDF share one loader

**Files:**
- Create: `src/lib/rota/hours-report-data.ts`, `tests/lib/rota/hours-report-data.test.ts`
- Modify: `src/app/(authenticated)/rota/hours/page.tsx:125-170`, `src/app/api/rota/hours/pdf/route.ts:540-590`

Both files run the same five queries. Fixing one and not the other would leave the screen and the PDF disagreeing, so extract the loader first.

**Interfaces:**
- Produces: `loadHoursReportData(supabase: SupabaseClient, params: { fromDate: string; toDate: string; today: string }): Promise<{ employees: EmployeeRow[]; sessions: SessionRow[]; leaveDays: LeaveDayRow[]; sickShifts: SickShiftRow[]; plannedShifts: PlannedShiftRow[] }>`

- [ ] **Step 1: Write the failing test**

Assert that a 15-month range returns all 1,025 sessions and that the sessions read pages `[0,999]` then `[1000,1999]`.

- [ ] **Step 2: Run it and watch it fail**

Expected: FAIL, module does not exist.

- [ ] **Step 3: Write the loader**

Move the five queries from `page.tsx:125-164` into the new module unchanged except that `timeclock_sessions` and `leave_days` are wrapped in `fetchAllRows` with `.order('id')` added after their existing orders. Export the five row types from the same module.

- [ ] **Step 4: Use it in both callers**

In `page.tsx`, replace the `Promise.all` with `const { employees, sessions, leaveDays, sickShifts, plannedShifts } = await loadHoursReportData(supabase, { fromDate, toDate, today })` and delete the now duplicated type aliases at `:61-91`, importing them instead. Do the same in `route.ts:540-590`, keeping its `throw` on error behaviour (the loader throws).

- [ ] **Step 5: Run the tests and commit**

```bash
npm test -- tests/lib/rota
git add src/lib/rota/hours-report-data.ts tests/lib/rota/hours-report-data.test.ts "src/app/(authenticated)/rota/hours/page.tsx" src/app/api/rota/hours/pdf/route.ts
git commit -m "fix: read every clocked session on the hours report and its PDF"
```

- [ ] **Step 6: Confirm against production**

Open `/rota/hours?from=2025-01-01&to=<today>`. Before this change the figures stopped at 29 April 2026. The totals must now include September 2026, and the PDF must match the screen.

---

### Task 12: Audit log user filter (needs a migration, owner go-ahead required)

**Files:**
- Create: `supabase/migrations/<timestamp>_audit_log_users_function.sql`
- Modify: `src/app/actions/auditLogs.ts:47-83`
- Test: `tests/actions/audit-log-users.test.ts`

Reading all 8,644 rows to build a 26-name dropdown is the wrong shape, and the table grows by about 4,100 a month. A `distinct` belongs in the database.

- [ ] **Step 1: Draft the migration**

```sql
create or replace function public.get_audit_log_users()
returns table (user_id uuid, user_email text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (al.user_id) al.user_id, al.user_email
  from public.audit_logs al
  where al.user_id is not null
  order by al.user_id, al.created_at desc;
$$;

revoke all on function public.get_audit_log_users() from public;
grant execute on function public.get_audit_log_users() to authenticated;
grant execute on function public.get_audit_log_users() to service_role;
```

The action calls it with the admin client, so `service_role` needs the grant as well as `authenticated`. Anon gets nothing: new objects fail closed in this project, and the website never reads audit logs.

- [ ] **Step 2: Validate it without persisting anything**

Wrap the migration in `begin; <migration>; select * from public.get_audit_log_users() limit 5; rollback;` through the Supabase MCP, and confirm no function is left behind afterwards.

- [ ] **Step 3: Stop. Ask the owner before applying**

Applying goes through the prod-migrate skill and needs the owner's explicit go-ahead, every time. Do not run `db push` on the strength of this plan.

- [ ] **Step 4: Switch the action to the function**

```ts
    const { data, error } = await supabase.rpc('get_audit_log_users')
```

Keep the permission check, keep the returned `AuditLogUser[]` shape, and delete the de-duplication loop at `:68-76`, which the function now does. The dropdown must list all 26 users.

- [ ] **Step 5: Run the tests and commit**

```bash
npm test -- tests/actions/audit-log-users.test.ts
git add supabase/migrations src/app/actions/auditLogs.ts tests/actions/audit-log-users.test.ts
git commit -m "fix: list every staff member in the audit log user filter"
```

---

### Task 13: The audience reads that decide who gets messaged

**Files:**
- Modify: `src/app/actions/customers.ts:651-668`, `src/lib/sms/review-once.ts:99-128`
- Test: `tests/actions/win-back-audience.test.ts`, `tests/lib/sms/review-once-history.test.ts`

Win-back reads `customer_scores` (997 rows at its 1-month setting, 3 short of the ceiling) and the first-visit check reads a customer's whole booking history (658 rows at worst today). Both decide what a customer receives, so they are fixed before the display-only ones.

- [ ] **Step 1: Write the failing tests**

Win-back: with 1,153 score rows matching, the preview count and the send list cover all of them. Review check: with 1,200 bookings across the 50 candidates, a regular with an older booking is not treated as a first visit.

- [ ] **Step 2: Run them and watch them fail**

Expected: FAIL on both, at 1,000 rows.

- [ ] **Step 3: Page both reads**

Win-back: wrap the `customer_scores` read in `fetchAllRows`, keeping the `customers!inner` embed and the `.or(...)` filter, ordered by `customer_id`. Review check: wrap each of the four `.in('customer_id', customerIds)` reads in `fetchAllRows` ordered by `id`, keeping the id lists as they are (50 customers, about 2 KB of URL).

- [ ] **Step 4: Run the tests and commit**

```bash
npm test -- tests/actions/win-back-audience.test.ts tests/lib/sms/review-once-history.test.ts
git add src/app/actions/customers.ts src/lib/sms/review-once.ts tests/actions/win-back-audience.test.ts tests/lib/sms/review-once-history.test.ts
git commit -m "fix: build the win-back audience and first-visit check from every row"
```

---

### Task 14: The display reads that are close to the cap

**Files:**
- Modify: `src/services/events.ts:1054-1070`, `src/services/receipts/receiptQueries.ts:1024-1069` and `:1075-1090`, `src/app/(authenticated)/rota/hours/page.tsx` (leave days, already paged in Task 11)
- Test: `tests/services/events-link-clicks.test.ts`, `tests/services/receipts/vendor-drawer-paging.test.ts`

- [ ] **Step 1: Write the failing tests**

Events: 1,303 link rows across a page of events are all counted. Vendor drawer: a vendor with 1,400 transactions shows all of them.

- [ ] **Step 2: Run them and watch them fail**

Expected: FAIL at 1,000 rows.

- [ ] **Step 3: Page the reads**

- `events.ts:1057`: wrap the `short_links` read in `fetchAllRows` ordered by `id`, keeping the `.or(orFilter)` built at `:1056`.
- `receiptQueries.ts:1029`: page the `get_receipt_vendor_transactions` rpc with `.range()` (the same mechanism proved in Task 5), and page its fallback scan at `:1046-1066` with an `.order('id')` tiebreak.
- `receiptQueries.ts:1077`: page the `get_receipt_vendor_trends` rpc the same way.

Short-link analytics (`src/services/short-links.ts:925`) needs the same treatment, but its function returns one array-carrying row per link and the repo's generated types disagree with the deployed signature (7 columns against 12). Read the live definition with `pg_get_functiondef` before touching it, and if the signatures differ, stop and report rather than guessing.

- [ ] **Step 4: Run the tests and commit**

```bash
npm test -- tests/services
git add src/services/events.ts src/services/receipts/receiptQueries.ts tests/services/events-link-clicks.test.ts tests/services/receipts/vendor-drawer-paging.test.ts
git commit -m "fix: page the link click, vendor history and vendor trend reads"
```

---

### Task 15: Paging that repeats or skips rows

**Files:**
- Modify: `src/services/marketing-campaigns.ts:1160-1170` and `:203-210`, `src/app/actions/receipts.ts:1116-1134`
- Test: `tests/services/marketing-recipients-order.test.ts`

These are not the row cap. They were found during the audit and share a cause: paging by offset with no unique order.

- [ ] **Step 1: Write the failing test**

All 253 recipients of one campaign share a single `created_at`, so assert that paging 50 at a time returns 253 distinct recipients with no repeats.

- [ ] **Step 2: Run it and watch it fail**

Expected: FAIL, repeats appear across pages.

- [ ] **Step 3: Add unique tiebreaks and stop offset-paging a shrinking set**

- `listRecipients` at `:1166`: add `.order('id', { ascending: true })` after the `created_at` order.
- `fetchSummaries` at `:203-209`: add `.order('id')` inside the paged read.
- `runReceiptRuleRetroactivelyStep` at `:1116-1125`: for the `pending` scope, stop advancing `offset`. Each call applies the rule and removes rows from the pending set, so always read from offset 0 and stop when a page yields no further matches. Keep the `all` scope as offset paging but add `.order('id')` as a tiebreak so the ordering is total.

- [ ] **Step 4: Run the tests and commit**

```bash
npm test -- tests/services/marketing-recipients-order.test.ts tests/actions/receipts.actions.test.ts
git add src/services/marketing-campaigns.ts src/app/actions/receipts.ts tests/services/marketing-recipients-order.test.ts
git commit -m "fix: page recipients and retro rule runs without repeating or skipping rows"
```

---

### Task 16: A guard so this cannot come back

**Files:**
- Create: `tests/guards/row-cap.test.ts`

- [ ] **Step 1: Write the guard**

Walk `src/**/*.{ts,tsx}` and fail on two patterns: a `.limit(n)` whose literal `n` is above 1,000, and a `.range(a, b)` whose literal span is above 1,000. Allow a line to opt out with a trailing `// row-cap-ok: <reason>` comment, and print the file, line and offending text so the failure explains itself.

- [ ] **Step 2: Run it against the tree**

Run: `npm test -- tests/guards/row-cap.test.ts`
Expected: PASS once Tasks 2 to 15 have landed. If it fails, the remaining hits are either a task not yet done or a genuinely new one: fix rather than allowlist.

- [ ] **Step 3: Commit**

```bash
git add tests/guards/row-cap.test.ts
git commit -m "test: fail the suite when a query asks for more than 1,000 rows"
```

---

### Task 17 (optional cleanup): One helper instead of twelve

**Files:** `src/app/actions/checklists-review.ts:38`, `checklists-spotcheck.ts:103`, `checklists-insights.ts:93`, `src/app/api/cron/maintenance-weekly-snapshot/route.ts:102`, `src/lib/email/marketing/attribution.ts:41`, `src/lib/analytics/table-booking-reports.ts:233`, `src/lib/analytics/private-booking-growth.ts:47`, `src/lib/analytics/customer-insights.ts:261`, `src/services/customer-labels.ts:34`, `src/services/marketing-campaigns.ts:73`, `src/services/gdpr.ts:170`, `src/services/marketing-contacts.ts:88`

Twelve copies of the same loop exist, and the analytics ones page without any order, so their pages can overlap. Replace each with the Task 1 helper, adding a unique tiebreak to every call site, one file per commit, running `npm test` between each. Mechanical, no behaviour change beyond the added ordering.

---

## Verification before handover

- [ ] `nvm use && npm run lint` (zero warnings)
- [ ] `npx tsc --noEmit`
- [ ] `npm test` and `npm run test:utc` both green
- [ ] `NODE_OPTIONS="--max-old-space-size=8192" npm run build` from a clean `.next`
- [ ] Re-run the production counts in Tasks 2, 5 and 11 and record the before and after figures in the pull request
- [ ] Confirm the counterpart website repo needs nothing: it holds no Supabase client and reads this app's API, so these fixes reach it without a change there
