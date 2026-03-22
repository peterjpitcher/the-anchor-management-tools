# LOW Findings Validation

Validated against actual source code on 2026-03-22.

---

## LOW-001: Calendar notes fetched with 730-day horizon (up to 1000 rows)

**Verdict: CONFIRMED**

- `dashboard-data.ts` line 296: `const calendarNotesHorizonIso = getLocalIsoDateDaysAhead(730)` -- 730-day lookahead confirmed.
- Line 689: `.range(0, 999)` -- fetches up to 1000 rows confirmed.
- Line 682: The query does use a scoped `select(...)` with named columns (not `select('*')`), so only the column selection is fine. The concern is purely the large horizon and row limit.

---

## LOW-002: Dashboard cashing-up section makes 4 sequential rounds instead of 2

**Verdict: PARTIALLY CONFIRMED**

The cashing-up block (lines 446-539) has these sequential await rounds:

1. **Round 1** (line 449): `await supabase.from('sites').select('id')...` -- fetch site.
2. **Round 2** (line 457): `await supabase.from('cashup_sessions')...` -- fetch this week's sessions.
3. **Round 3** (lines 493-504): `await Promise.all([lastWeekRes, lastYearRes])` -- two queries parallelised into one round.
4. **Round 4** (line 515): `await supabase.from('cashup_targets')...` -- fetch targets.

That is **4 sequential network rounds** (with round 3 internally parallel). The finding of "4 sequential rounds instead of 2" is confirmed. Rounds 3 and 4 could theoretically be combined into a single `Promise.all`, reducing to 3 rounds. The site fetch (round 1) could also potentially be cached or parallelised with permissions.

---

## LOW-003: Rota shifts fetched with select('*')

**Verdict: CONFIRMED**

`src/app/actions/rota.ts` line 139: `.select('*')` is used to fetch rota shifts. The result is cast as `RotaShift[]` on line 146 but all columns are fetched from the database.

---

## LOW-004: select('*') used in 30+ service queries

**Verdict: CONFIRMED (higher than reported)**

Grep found **64 total occurrences** of `select('*')` across **12 files** in `src/services/`. The finding said "30+" which is conservative -- the actual count is 64 instances. Top offenders: `employees.ts` (19), `private-bookings.ts` (11), `business-hours.ts` (10).

---

## LOW-005: Financials service sequential deletes in loop

**Verdict: CONFIRMED**

`src/services/financials.ts` lines 76-86: The `deleteFinancialRowsByPair` function iterates over `pairs` with a `for...of` loop, issuing one `await supabase.from(table).delete()` per pair sequentially. These could be parallelised with `Promise.all` or batched into a single query using `.in()` if the schema supports it.

---

## LOW-006: Receipt pagination in sequential loop

**Verdict: CONFIRMED**

`src/services/financials.ts` lines 95-103: The `fetchReceiptExpenseRows` function uses a `for` loop (`for (let from = 0; ; from += RECEIPT_PAGE_SIZE)`) that awaits each page sequentially. Each iteration issues a new Supabase query. This is a standard sequential pagination pattern -- the loop cannot easily be parallelised since the total count is unknown upfront, but it does create N sequential network calls.

---

## LOW-007: Dashboard cache TTL only 60s for all metrics

**Verdict: CONFIRMED**

`dashboard-data.ts` line 1261: `{ revalidate: 60, tags: ['dashboard', \`dashboard-user-${resolvedUserId}\`] }`. The `unstable_cache` wrapper uses a 60-second revalidation for the entire dashboard snapshot, meaning all metrics (including slow-changing ones like calendar notes, employee data) are re-fetched every 60 seconds.

---

## LOW-008: date-fns barrel imports in 20+ files

**Verdict: CONFIRMED**

Grep found **35 files** importing `from 'date-fns'` across `src/`. All are barrel imports (importing from the package root rather than specific submodules like `date-fns/format`). Modern bundlers with tree-shaking (which Next.js uses) mitigate the bundle-size impact, but the barrel imports can still slow down TypeScript type-checking and IDE performance.

---

## LOW-009: Hardcoded hex colours in calendar/rota print

**Verdict: CONFIRMED**

- `UpcomingScheduleCalendar.tsx`: 12+ hardcoded hex values including `#ef4444`, `#6366f1`, `#f59e0b`, `#64748b`, `#0EA5E9`, `#3b82f6`, `#111827`, etc.
- `rota/print/page.tsx`: 30+ hardcoded hex values throughout inline styles including `#d1d5db`, `#dcfce7`, `#166534`, `#dbeafe`, `#ffedd5`, `#fee2e2`, `#fef9c3`, `#374151`, `#6b7280`, `#9ca3af`, `#e5e7eb`, etc.

The print page is somewhat defensible since it uses inline styles for print rendering (Tailwind classes may not work reliably in print contexts), but the calendar component has no such excuse.

---

## LOW-010: console.log in services

**Verdict: CONFIRMED**

- `src/services/sms-queue.ts`: 2 `console.log` statements (lines 165, 234) -- logging trigger type approval and successful sends.
- `src/services/customer-labels.ts`: 2 `console.log` statements (lines 7, 15) -- logging backfill operations.
- `src/services/employees.ts`: 1 `console.log` statement (line 559) -- logging orphaned file removal.

Total: 5 `console.log` statements across these 3 service files. These should use a structured logger or `console.info`/`console.warn` at minimum, or be removed entirely for production.

---

## LOW-011: Loading.tsx missing in 8+ route directories

**Verdict: CONFIRMED**

Found 10 `loading.tsx` files under `(authenticated)/`:
- `invoices/`, `employees/`, `rota/`, `customers/`, `table-bookings/`, `private-bookings/`, `events/`, `events/[id]/`, `performers/`, `dashboard/`

There are 22 top-level directories under `(authenticated)/`. Directories **missing** `loading.tsx`:
- `cashing-up`
- `menu-management`
- `messages`
- `oj-projects`
- `parking`
- `profile`
- `quotes`
- `receipts`
- `roles`
- `settings`
- `short-links`
- `unauthorized`
- `users`

That is **13 directories** without a `loading.tsx` (though some like `unauthorized` and `profile` may not need one). The finding of "8+" is conservative -- the actual count of missing loading states is 13.

---

## LOW-012: Various any types in GDPR service, private bookings, employee invite

**Verdict: CONFIRMED**

- `src/services/gdpr.ts` lines 6-11: The `ExportData` interface uses `any` for all 6 properties (`profile: any`, `customers: any[]`, `bookings: any[]`, `messages: any[]`, `employees: any[]`, `auditLogs: any[]`).
- `src/app/actions/employeeInvite.ts` line 33: `export async function inviteEmployee(prevState: any, formData: FormData)` -- the `prevState` parameter is typed as `any`.

---

## LOW-013: Inconsistent permission check patterns (3 different styles)

**Verdict: CONFIRMED**

Three distinct patterns observed:

1. **Direct boolean check** (`invoices.ts` line 300): `const hasPermission = await checkUserPermission('invoices', 'view'); if (!hasPermission) { return { error: '...' } }`

2. **Boolean with user ID** (`customers.ts` line 195): `const canManage = await checkUserPermission('customers', 'manage', user.id)` -- passes `user.id` as third argument, requiring a separate auth call first.

3. **Wrapper function returning auth+client** (`event-categories.ts` lines 130-140): `requireEventsManagePermission()` is a custom wrapper that combines auth lookup, permission check, and admin client creation into a single call, returning either `{ error }` or `{ user, admin }`.

These are 3 genuinely different patterns for the same concern.

---

## LOW-014: Low test coverage -- 21 test files for ~600 source files

**Verdict: CONFIRMED**

Found exactly **21 `.test.ts` files** and **0 `.test.tsx` files** in `src/`. For a project described as ~600 files, this represents roughly 3.5% file-level test coverage. The tests focus on utilities (`dateUtils`, `invoiceCalculations`, `phone`, `sms safety`), API routes (PayPal, FOH bookings), and a few services (`event-marketing`, `private-bookings`). Large areas like most server actions, services, and all UI components have zero test files.

---

## Summary

| Finding | Verdict |
|---------|---------|
| LOW-001 | CONFIRMED |
| LOW-002 | PARTIALLY CONFIRMED (4 rounds confirmed, "instead of 2" is aspirational) |
| LOW-003 | CONFIRMED |
| LOW-004 | CONFIRMED (64 occurrences, higher than reported 30+) |
| LOW-005 | CONFIRMED |
| LOW-006 | CONFIRMED |
| LOW-007 | CONFIRMED |
| LOW-008 | CONFIRMED (35 files, higher than reported 20+) |
| LOW-009 | CONFIRMED |
| LOW-010 | CONFIRMED |
| LOW-011 | CONFIRMED (13 missing, higher than reported 8+) |
| LOW-012 | CONFIRMED |
| LOW-013 | CONFIRMED |
| LOW-014 | CONFIRMED |

**Overall: 13 CONFIRMED, 1 PARTIALLY CONFIRMED, 0 DISPUTED**
