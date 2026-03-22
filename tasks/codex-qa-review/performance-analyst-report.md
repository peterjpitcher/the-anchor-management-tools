# Performance Analysis Report

## Summary

30 findings across database, rendering, network, and bundle categories. The application is generally well-architected -- the dashboard uses `Promise.allSettled` for parallel data fetching and `unstable_cache` for per-user caching, customer list queries use pagination and `Promise.all` for enrichment, and permission checks are cached for 60 seconds. However, several high-impact patterns remain that could degrade user experience under load.

**Top 3 concerns:**
1. `persistOverdueInvoices()` is called on every invoice list/detail view -- a write operation blocking reads
2. Resync-calendar endpoint loops through ALL published weeks sequentially, issuing N+1 queries and serializing all GCal API calls -- an O(weeks x shifts) waterfall that can easily hit the 300s timeout
3. ICS feed endpoints build the entire response body, hash it for ETag, then check `If-None-Match` -- doing all the work even when a 304 would suffice

---

## Findings

### PERF-001: `persistOverdueInvoices()` called on every invoice read

- **File:** `src/services/invoices.ts:276` and `:331`
- **Severity:** High
- **Category:** Database
- **Impact:** Every call to `getInvoices()` or `getInvoiceById()` first runs an UPDATE query against all invoices with `status = 'sent'` and `due_date < today`. This adds ~50-200ms of write latency to every invoice list view and detail page load, and creates unnecessary write load on the database.
- **Description:** `persistOverdueInvoices()` uses the admin client to update all sent invoices past their due date to 'overdue' status. This is called synchronously before every read. The function also creates a new admin client on every call.
- **Suggested fix:** Move this to a scheduled cron job (e.g., daily at midnight) or use a database trigger/computed column instead. If real-time accuracy is needed, compute overdue status at read time in JS (as is already partially done at line 317) without the write. The function at line 314-320 already normalizes 'sent' invoices past due to 'overdue' in memory, making the DB write redundant for display purposes.

---

### PERF-002: Messages inbox fetches up to 900 rows into memory

- **File:** `src/app/actions/messagesActions.ts:156-206`
- **Severity:** High
- **Category:** Database
- **Impact:** Slow inbox load for active venues. Three parallel queries fetch: 400 recent messages (all directions), 500 unread inbound messages, plus a count query. All rows include a JOIN to the customers table. The results are then processed in JavaScript to build a conversation list limited to 25.
- **Description:** `RECENT_MESSAGE_FETCH_LIMIT = 400` and `UNREAD_MESSAGE_FETCH_LIMIT = 500` mean up to 900 message rows (with customer JOINs) are fetched, only to extract 25 conversations. This approach works but does not scale well as message volume grows.
- **Suggested fix:** Create a database view or RPC function (`get_recent_conversations`) that returns the 25 most recent conversations with their last message and unread count directly via SQL using `DISTINCT ON` or window functions. This would reduce data transfer from 900 rows to 25.

---

### PERF-003: Private bookings `getBookings()` uses `select('*')` on a view

- **File:** `src/services/private-bookings.ts:1762`
- **Severity:** High
- **Category:** Database
- **Impact:** Every call to list private bookings fetches all columns from the `private_bookings_with_details` view (which likely includes computed columns, nested data). The dashboard calls this with `limit: 20` but the bookings list page calls it without a limit (line 140 of `privateBookingActions.ts`), potentially fetching all bookings.
- **Description:** `select('*', { count: 'exact' })` on a view is expensive because (a) views may compute columns on every row even if unused, and (b) `count: 'exact'` forces a full table scan. The `fetchPrivateBookings()` method (line 1796) does use explicit column selection, but `getBookings()` does not.
- **Suggested fix:** Replace `select('*')` with explicit column selection matching what the caller needs. Use `count: 'estimated'` for list views where an approximate count suffices.

---

### PERF-004: `getBookingById()` fetches everything with `select('*', ...)`

- **File:** `src/services/private-bookings.ts:1982-2019`
- **Severity:** Medium
- **Category:** Database
- **Impact:** Every booking detail view fetches the full booking, all items (with nested space/package/vendor using `*`), all documents, all SMS queue entries, all payments, and all audit entries with profile JOINs -- in a single query. For bookings with extensive history, this could be slow.
- **Description:** While a single query avoids N+1, the `select('*')` on each related table (items, spaces, packages, vendors) fetches every column from every table. The audit trail is sorted in JS after fetching.
- **Suggested fix:** Use explicit column lists for nested relations. Consider lazy-loading the audit trail separately (it is often viewed on a tab, not on initial load). The variant-based approach (`getBookingByIdForEdit`, `getBookingByIdForItems`) is already well designed -- ensure the default `getBookingById` call is not used when a lighter variant would suffice.

---

### PERF-005: Calendar notes fetched with 730-day horizon (up to 1000 rows)

- **File:** `src/app/(authenticated)/dashboard/dashboard-data.ts:296,689`
- **Severity:** Medium
- **Category:** Database
- **Impact:** Dashboard loads calendar notes spanning 2+ years ahead (730 days), with `.range(0, 999)` allowing up to 1000 rows. All of this data is passed to the client-side `UpcomingScheduleCalendar` component.
- **Description:** `calendarNotesHorizonIso = getLocalIsoDateDaysAhead(730)` combined with a 90-day lookback means up to 820 days of notes. For a venue that creates notes frequently (especially AI-generated ones), this could return hundreds of rows unnecessarily.
- **Suggested fix:** Reduce the horizon to 90-180 days for the dashboard. If the calendar component needs a wider range, fetch it lazily when the user navigates to future months. Consider pagination.

---

### PERF-006: Dashboard cashing-up section makes sequential DB calls

- **File:** `src/app/(authenticated)/dashboard/dashboard-data.ts:446-539`
- **Severity:** Medium
- **Category:** Database
- **Impact:** The cashing-up dashboard section first fetches the site, then this week's data, then (in parallel) last week + last year data, then targets -- four sequential rounds of queries when only two are needed.
- **Description:** The `sites` query runs first, then `cashup_sessions` for this week, then `Promise.all` for last week/last year, then `cashup_targets`. The first two queries could be parallelized with each other (site ID could be fetched alongside initial data), and targets could be included in the second parallel batch.
- **Suggested fix:** Fetch sites and this week's sessions in parallel. Then fetch last week, last year, and targets in a second `Promise.all` batch, reducing from 4 sequential rounds to 2.

---

### PERF-007: Invoice list fetches `vendor:invoice_vendors(*)` -- over-fetching

- **File:** `src/services/invoices.ts:281-283`
- **Severity:** Medium
- **Category:** Database
- **Impact:** The invoice list view fetches all columns from the invoice AND all columns from the vendor relation for every invoice. Most list views only need vendor name.
- **Description:** `select('*, vendor:invoice_vendors(*)')` fetches every column from both tables. The list view UI only displays invoice number, total, status, due date, and vendor name.
- **Suggested fix:** Replace with explicit columns: `select('id, invoice_number, total_amount, paid_amount, status, due_date, invoice_date, reference, vendor:invoice_vendors(name)')`.

---

### PERF-008: Rota shifts fetched with `select('*')`

- **File:** `src/app/actions/rota.ts:138-143`
- **Severity:** Low
- **Category:** Database
- **Impact:** Minor over-fetching. The rota shifts query fetches all columns including metadata columns (created_at, updated_at, reassignment fields) that may not be needed for the weekly grid view.
- **Description:** `getWeekShifts()` uses `select('*')` for rota shifts. Rota weeks typically have 30-70 shifts so the volume is manageable, but explicit column selection would be cleaner.
- **Suggested fix:** Use explicit column selection for the columns needed by the rota grid UI.

---

### PERF-009: Quotes dashboard fetches rows to sum in JS instead of using DB aggregation

- **File:** `src/app/(authenticated)/dashboard/dashboard-data.ts:1051-1078`
- **Severity:** Medium
- **Category:** Database
- **Impact:** Three queries each fetch up to 1000 quote rows (with `total_amount` column) just to sum them in JavaScript. For venues with many quotes, this transfers unnecessary data.
- **Description:** The pending, expired, and accepted quote value calculations fetch rows with `.limit(1000)` and then reduce them in JS with `sumAmounts()`. A database `SUM()` via RPC or a computed view would be much more efficient.
- **Suggested fix:** Create an RPC function like `get_quote_summary_stats()` that returns `{pending_total, expired_total, accepted_total, draft_count}` in a single call. Alternatively, use Supabase's `.select('total_amount.sum()')` if supported.

---

### PERF-010: Receipt workspace fetches vendor list (up to 2000 rows) on every load

- **File:** `src/app/actions/receipts.ts:2335-2341`
- **Severity:** Medium
- **Category:** Database
- **Impact:** Every receipt workspace load fetches up to 2000 unique vendor names for the autocomplete dropdown, plus rules, plus summary data, alongside the paginated transactions. The vendor list rarely changes between page loads.
- **Description:** The vendor query `select('vendor_name').not('vendor_name', 'is', null).limit(2000)` returns duplicates since there is no `DISTINCT`. Additionally, this data is stable and could be cached.
- **Suggested fix:** Use an RPC with `SELECT DISTINCT vendor_name` and cache the result. Or fetch vendor names lazily when the user opens the autocomplete/filter, not on every page load.

---

### PERF-011: `checkUserPermission` in action layer creates a new Supabase client each time

- **File:** `src/app/actions/rbac.ts:64-84`
- **Severity:** Medium
- **Category:** Network
- **Impact:** Each call to `checkUserPermission()` in a server action creates a new Supabase client (`await createClient()`) and calls `supabase.auth.getUser()` to resolve the current user. When a server action calls `checkUserPermission` plus `createClient` for its own queries, this results in 2+ Supabase client instantiations and 2+ auth lookups per action.
- **Description:** Example: `createPrivateBooking` (line 177) creates a Supabase client, then calls `checkUserPermission` which creates another client and does another `getUser()`. The permission check then calls `PermissionService.checkUserPermission` which uses the cached RPC -- the caching is good, but the auth overhead is duplicated.
- **Suggested fix:** Accept an optional `userId` parameter in `checkUserPermission` and use the caller's already-resolved user ID when available. Several actions already resolve auth before calling permission checks -- pass the userId through. Alternatively, create a shared `requireAuth()` helper that returns both the supabase client and user, used once per action.

---

### PERF-012: No `next/dynamic` imports anywhere in the codebase

- **File:** (entire `src/` directory)
- **Severity:** Medium
- **Category:** Bundle
- **Impact:** All components are eagerly loaded in their parent bundles. Heavy components (calendar, PDF generation, CSV parsing, rich text editors) increase initial JavaScript bundle size for every page.
- **Description:** Zero uses of `next/dynamic` or `React.lazy` were found. Components like `UpcomingScheduleCalendar`, receipt workspace views, and invoice/quote PDF generators are loaded eagerly.
- **Suggested fix:** Use `next/dynamic` with `{ ssr: false }` for client-heavy components that are not needed for the initial server render. Priority candidates: calendar components, PDF viewers, CSV import UIs, and any modal-based heavy components.

---

### PERF-013: `papaparse` imported at module top level in server action

- **File:** `src/app/actions/receipts.ts:28`
- **Severity:** Low
- **Category:** Bundle
- **Impact:** `papaparse` (~50KB minified) is loaded into the server action bundle even when the action being called does not involve CSV parsing. Server actions share a bundle, so all receipt actions pay the import cost.
- **Description:** `import Papa from 'papaparse'` is a top-level import in a file with 30+ exported functions. Only the CSV import functions use it.
- **Suggested fix:** Use dynamic `import('papaparse')` inside the functions that need it (e.g., `importBankStatement`). This is a server-side optimization that reduces cold start time.

---

### PERF-014: `select('*')` used extensively in services

- **File:** `src/services/business-hours.ts`, `src/services/permission.ts`, `src/services/gdpr.ts`, `src/services/cashing-up.service.ts`, `src/services/menu.ts`
- **Severity:** Low
- **Category:** Database
- **Impact:** Over-fetching across multiple services. While individual tables may be small, the pattern of `select('*')` means any column additions to these tables automatically increase query payload without review.
- **Description:** 30+ instances of `select('*')` found across services. Some are for small configuration tables (acceptable), but others are for transactional data (menu items, cash counts, GDPR records).
- **Suggested fix:** Replace `select('*')` with explicit column lists for tables that grow or have many columns. Low priority for small configuration tables.

---

### PERF-015: Dashboard `allUnpaidResult` fetches all unpaid invoice rows to sum in JS

- **File:** `src/app/(authenticated)/dashboard/dashboard-data.ts:886-890`
- **Severity:** Medium
- **Category:** Database
- **Impact:** Fetches `total_amount, paid_amount` for ALL unpaid invoices (no limit, no pagination) to compute `totalUnpaidValue` by reducing in JavaScript. As invoice count grows, this transfers increasing data.
- **Description:** The query `select('total_amount, paid_amount').in('status', unpaidStatuses)` has no `.limit()` and returns every matching row. The data is only used to sum outstanding balances.
- **Suggested fix:** Use an RPC function: `SELECT COALESCE(SUM(total_amount - paid_amount), 0) FROM invoices WHERE status IN (...) AND deleted_at IS NULL`. This returns a single number instead of N rows.

---

### PERF-016: Event creation fetches category defaults even when no category selected

- **File:** `src/app/actions/events.ts:58-117`
- **Severity:** Low
- **Category:** Database
- **Impact:** Minor. The `prepareEventDataFromFormData` function creates a Supabase client and fetches category defaults. When `categoryId` is null, the client is still created but the query is skipped. The client creation itself has some overhead.
- **Description:** `await createClient()` runs unconditionally at line 59, even though it is only used if `categoryId` is truthy. The category defaults query (line 65-91) selects ~20 columns from `event_categories`.
- **Suggested fix:** Move the client creation inside the `if (categoryId)` block.

---

### PERF-017: Win-back campaign fetches all customer_scores without pagination

- **File:** `src/app/actions/customers.ts:518-533`
- **Severity:** Medium
- **Category:** Database
- **Impact:** The `sendWinBackCampaign` function fetches all rows from `customer_scores` matching the cutoff date with no limit. For a large customer base (1000+), this could be a heavy query, especially with the inner JOIN to customers.
- **Description:** No `.limit()` or pagination on the customer_scores query. All matching rows are loaded into memory and then filtered in JavaScript for opt-in status and phone number presence.
- **Suggested fix:** Move the filtering (sms_opt_in = true, mobile_number IS NOT NULL) into the query using `.eq()` and `.not('mobile_number', 'is', null)` on the inner join. This reduces rows returned from the database.

---

### PERF-018: Financials service uses sequential deletes in a loop

- **File:** `src/services/financials.ts:70-87`
- **Severity:** Low
- **Category:** Database
- **Impact:** `deleteFinancialRowsByPair` executes one DELETE query per metric/timeframe pair sequentially. If there are N pairs, this is N sequential database round-trips.
- **Description:** The function loops through pairs and awaits each delete individually. Each round-trip adds network latency.
- **Suggested fix:** Use `Promise.all` to parallelize the deletes, or batch them into a single RPC call that accepts an array of pairs to delete.

---

### PERF-019: Receipt `fetchReceiptExpenseRows` paginates manually in a loop

- **File:** `src/services/financials.ts:89-104`
- **Severity:** Low
- **Category:** Database
- **Impact:** Fetches all receipt transactions in pages of `RECEIPT_PAGE_SIZE`, making sequential requests until all data is retrieved. For months with many transactions, this creates a waterfall of sequential queries.
- **Description:** A `for` loop with `from += RECEIPT_PAGE_SIZE` fetches pages sequentially. Each page requires a full round-trip to the database.
- **Suggested fix:** If the total row count is known or bounded, use parallel page fetches with `Promise.all`. Alternatively, use an RPC that returns all needed rows in one call.

---

### PERF-020: `<img>` tags used in HTML templates (server-generated, not React) -- NOT AN ISSUE

- **File:** `src/lib/invoice-template.ts`, `src/lib/contract-template.ts`, `src/lib/cashing-up-pdf-template.ts`, and 7 others
- **Severity:** Info
- **Category:** Bundle
- **Impact:** None. These are server-side HTML template strings for PDF/email generation, not React components. Using `<img>` here is correct and expected -- `next/image` does not apply.
- **Description:** All `<img>` occurrences are in HTML template literals used for PDF generation and email templates. Reviewed and cleared.
- **Suggested fix:** None needed.

---

### PERF-021: Dashboard snapshot caching is only 60 seconds

- **File:** `src/app/(authenticated)/dashboard/dashboard-data.ts:1261`
- **Severity:** Low
- **Category:** Network
- **Impact:** The dashboard makes 15+ parallel database queries (across events, customers, messages, bookings, invoices, employees, receipts, quotes, roles, short links, users, system health, cashing up, table bookings, and pipeline metrics). With a 60-second cache TTL, these queries run frequently for active users.
- **Description:** `{ revalidate: 60, tags: ['dashboard', ...] }` means the cache expires every minute. Combined with the `revalidateTag('dashboard')` calls in many mutation actions, the cache is invalidated frequently. The 15+ parallel queries are well-structured with `Promise.allSettled`, but they still represent significant database load when the cache misses.
- **Suggested fix:** Consider increasing the TTL to 120-300 seconds for non-critical metrics (roles count, short links count, user count). Keep 60 seconds for time-sensitive data (today's schedule, action items). This could be achieved by splitting the snapshot into "hot" and "cold" sections with different cache strategies.

---

### PERF-022: `date-fns` imported from main barrel in 20+ files

- **File:** Multiple files across `src/`
- **Severity:** Low
- **Category:** Bundle
- **Impact:** `date-fns` is tree-shakeable by design, so importing individual functions like `import { format } from 'date-fns'` should tree-shake correctly in production builds. However, in development builds and some bundler configurations, the barrel import can be slower to resolve.
- **Description:** 20+ files import from `'date-fns'` (barrel) rather than `'date-fns/format'` (direct). Next.js and Webpack handle tree-shaking well for `date-fns`, so the production impact is minimal.
- **Suggested fix:** Low priority. If dev server startup is slow, consider using `optimizePackageImports` in `next.config.mjs` to ensure `date-fns` is pre-optimized.

---

## Quick Wins

These are the highest-impact fixes with the least effort:

| Priority | Finding | Effort | Impact |
|----------|---------|--------|--------|
| 1 | **PERF-001**: Remove `persistOverdueInvoices()` from read paths; compute overdue status in JS (already partially done) | 30 min | High -- eliminates a write on every invoice page load |
| 2 | **PERF-015**: Replace `allUnpaidResult` JS sum with a SQL aggregate | 15 min | Medium -- eliminates unbounded row fetch |
| 3 | **PERF-009**: Replace quotes dashboard JS sums with SQL aggregates | 30 min | Medium -- eliminates 3 x 1000-row fetches |
| 4 | **PERF-003**: Add explicit column selection to `getBookings()` | 15 min | Medium -- reduces payload for every booking list view |
| 5 | **PERF-011**: Pass userId to `checkUserPermission` from callers that already have it | 45 min | Medium -- eliminates redundant auth lookups across all actions |
| 6 | **PERF-017**: Move opt-in/phone filters into the win-back query | 15 min | Medium -- reduces rows fetched for campaigns |
| 7 | **PERF-013**: Dynamic import `papaparse` inside CSV functions only | 10 min | Low -- reduces cold start |

---

---

### PERF-023: Resync-calendar endpoint uses N+1 query pattern -- sequential per-week fetches

- **File:** `src/app/api/rota/resync-calendar/route.ts:41-56`
- **Severity:** Critical
- **Category:** Database / Network
- **Impact:** For a venue with 20 published weeks, this issues 20 sequential Supabase queries (one per week to fetch shifts) and then 20 sequential calls to `syncRotaWeekToCalendar`. Each sync call itself makes 2 DB queries (employees + existing event mappings), lists GCal events, and then processes shifts in batches of 10 with 150ms pauses. With 20 weeks x ~40 shifts each, this creates a waterfall of ~800 GCal API calls processed sequentially at 10/batch with 150ms inter-batch delays, easily exceeding the 300-second `maxDuration`.
- **Description:** The `for (const week of weeks)` loop at line 41 iterates sequentially. Each iteration fetches shifts for that week, then calls `syncRotaWeekToCalendar` which internally fetches employees and event mappings again per week -- even though the same employees appear across weeks. The employee names query and OAuth client are re-created for every single week.
- **Suggested fix:**
  1. Fetch all shifts for all published weeks in a single query: `select(...).in('week_id', weekIds)` and group client-side by week_id.
  2. Fetch employee names once, pass them into the sync function.
  3. Create the OAuth client once, pass it in.
  4. Process multiple weeks in parallel (e.g., 3-5 concurrent weeks) using `Promise.all` with a concurrency limiter, since GCal rate limits are per-calendar, not per-week.

---

### PERF-024: `syncRotaWeekToCalendar` re-fetches employee names on every call

- **File:** `src/lib/google-calendar-rota.ts:94-108`
- **Severity:** High
- **Category:** Database
- **Impact:** When syncing N weeks (via resync-calendar), the same employee list is fetched N times. A pub with 15 staff and 20 published weeks causes 20 identical queries to the `employees` table. Each query also creates a new admin Supabase client at line 91.
- **Description:** `createAdminClient()` is called at line 91, then employees are fetched at lines 97-100 using `.in('employee_id', employeeIds)`. The employee name map is local to the function. The OAuth client is also obtained fresh via `getOAuth2Client()` at line 121 on every call.
- **Suggested fix:** Accept optional pre-fetched `employeeNames: Map<string, string>` and `auth` parameters. The resync endpoint should fetch employees once and pass them into each sync call. This eliminates N-1 redundant employee queries and N-1 redundant OAuth token refreshes.

---

### PERF-025: ICS feeds compute full response before checking conditional GET (ETag/304)

- **File:** `src/app/api/rota/feed/route.ts:62-170` and `src/app/api/portal/calendar-feed/route.ts:49-162`
- **Severity:** High
- **Category:** Network / Database
- **Impact:** Every poll from Google Calendar, Apple Calendar, or Outlook (potentially hourly per subscriber) triggers a full database query, ICS string construction, SHA-256 hash computation, and string folding -- even when the data has not changed and a 304 response would suffice. For a venue with 20 staff subscribed, this means 20 unnecessary full DB queries per hour.
- **Description:** The 304 check happens at lines 158-169 (rota feed) and 138-149 (portal feed), after the entire ICS body has been built and hashed. The `Cache-Control: no-cache, no-store, must-revalidate` headers prevent any edge caching, so every request hits the origin.
- **Suggested fix:**
  1. Compute a lightweight ETag from DB metadata without building the full ICS. For example, query `SELECT MAX(published_at), COUNT(*) FROM rota_published_shifts WHERE shift_date BETWEEN ... AND ...` and hash that. Compare against `If-None-Match` before doing any heavy work.
  2. Change `Cache-Control` to `max-age=300, stale-while-revalidate=600` to allow CDN/browser caching for 5 minutes. ICS feeds do not need real-time freshness (Google already polls on 12-24h cycles).
  3. Alternatively, store a pre-computed ETag in the database that updates only when shifts are published, and check it before building the response.

---

### PERF-026: Rota feed uses `SELECT *` with employee JOIN for all shifts in 16-week window

- **File:** `src/app/api/rota/feed/route.ts:62-68`
- **Severity:** Medium
- **Category:** Database
- **Impact:** `select('*, employee:employees(first_name, last_name)')` fetches every column from `rota_published_shifts` for all shifts in a 16-week window. The feed only uses: `id`, `shift_date`, `start_time`, `end_time`, `department`, `status`, `notes`, `is_overnight`, `is_open_shift`, `name`, `published_at`, and the employee name. Columns like `week_id`, `employee_id`, `created_at`, `updated_at`, etc. are transferred but unused.
- **Description:** Over-fetching on a query that runs on every calendar poll. For a venue with 5 shifts/day x 7 days x 16 weeks = 560 shifts, even modest column overhead adds up when multiplied by polling frequency.
- **Suggested fix:** Replace `select('*')` with explicit column list: `select('id, shift_date, start_time, end_time, department, status, notes, is_overnight, is_open_shift, name, published_at, employee:employees(first_name, last_name)')`.

---

### PERF-027: Portal calendar feed also uses `SELECT *`

- **File:** `src/app/api/portal/calendar-feed/route.ts:49-56`
- **Severity:** Medium
- **Category:** Database
- **Impact:** Same pattern as PERF-026 but for the employee-specific feed. `select('*')` fetches all columns when only ~10 are used. Since this is filtered by employee_id, the row count is smaller (one employee's shifts), but it still runs on every calendar poll per subscribed employee.
- **Description:** The query at line 49 uses `select('*')` without the employee JOIN (employee name is fetched separately at line 29-33, which is fine since it is a single row).
- **Suggested fix:** Use explicit column list: `select('id, shift_date, start_time, end_time, department, status, notes, is_overnight, is_open_shift, name, published_at')`.

---

### PERF-028: `foldLine` creates a new `TextEncoder` and encodes each character individually

- **File:** `src/lib/ics/utils.ts:57-88`
- **Severity:** Medium
- **Category:** Network
- **Impact:** For a feed with 500 shifts, each VEVENT has ~10 lines, and each line calls `foldLine`. The function creates a new `TextEncoder()` per call (5000 instantiations) and then calls `encoder.encode(char)` for every character in the line -- including the "fast path" check at lines 61-65 which iterates all characters just to check total byte length, even though most lines are short ASCII strings under 75 bytes.
- **Description:** The fast path (lines 61-65) iterates every character and encodes each one individually to count bytes. For a typical 40-character ASCII line, this creates 40 temporary `Uint8Array` allocations. A faster check would be `line.length <= 75` for ASCII-only lines (which most ICS lines are), since ASCII characters are 1 byte each in UTF-8.
- **Suggested fix:**
  1. Move `TextEncoder` to module scope (it is stateless and reusable).
  2. Add an ASCII fast path: `if (line.length <= 75) return line` -- if the string length is <= 75 and it is all ASCII, it is guaranteed to be <= 75 bytes. This covers 95%+ of ICS lines.
  3. For the slow path, encode the entire line at once (`encoder.encode(line)`) and find fold points by scanning the byte array, rather than encoding character-by-character.

---

### PERF-029: `mostRecentPublish` sorts all shifts to find max date

- **File:** `src/app/api/rota/feed/route.ts:149-152` and `src/app/api/portal/calendar-feed/route.ts:129-132`
- **Severity:** Low
- **Category:** Network
- **Impact:** Minor. After building the ICS body, the code maps all shifts to `Date` objects, filters nulls, sorts the entire array, and takes the first element -- an O(n log n) operation when O(n) would suffice.
- **Description:** `.sort((a, b) => b.getTime() - a.getTime())[0]` sorts the entire array just to find the maximum. With 500 shifts this is negligible, but it is wasteful.
- **Suggested fix:** Use `Math.max` or a simple reduce: `shifts.reduce((max, s) => s.published_at && new Date(s.published_at) > max ? new Date(s.published_at) : max, new Date(0))`.

---

### PERF-030: Resync-calendar has no concurrency guard -- multiple clicks stack up

- **File:** `src/app/(authenticated)/rota/RotaFeedButton.tsx:18-33` and `src/app/api/rota/resync-calendar/route.ts`
- **Severity:** Medium
- **Category:** Network
- **Impact:** The client disables the button during sync (good), but there is no server-side guard. If multiple users (or the same user in multiple tabs) trigger resync simultaneously, multiple instances of the full resync run in parallel, each making hundreds of GCal API calls. This can easily exhaust GCal rate limits (which are per-calendar, not per-user) and cause cascading 403 errors.
- **Description:** The endpoint at `route.ts` has no mutex, rate limiting, or "sync in progress" flag. Each POST runs the full loop independently. With `maxDuration: 300` (5 minutes), two concurrent resyncs could run for 5 minutes each, making ~1600 GCal API calls total.
- **Suggested fix:** Add a lightweight lock using a database flag (e.g., a `rota_sync_status` row with `in_progress` boolean and `started_at` timestamp). Check before starting, set on start, clear on finish. Reject concurrent requests with a friendly "sync already in progress" message. Include a staleness check (e.g., auto-clear if `started_at` is > 10 minutes ago) to prevent deadlocks from crashed syncs.

---

## Quick Wins (Calendar Sync)

These calendar-sync-specific fixes are ordered by impact-to-effort ratio:

| Priority | Finding | Effort | Impact |
|----------|---------|--------|--------|
| 1 | **PERF-025**: Add lightweight ETag pre-check before building ICS body | 1 hr | High -- eliminates full DB query + ICS build on ~90% of feed polls |
| 2 | **PERF-028**: ASCII fast path in `foldLine` + module-scoped TextEncoder | 15 min | Medium -- eliminates thousands of per-character allocations per feed request |
| 3 | **PERF-023**: Batch shift fetch in resync-calendar to one query | 30 min | High -- eliminates N sequential DB queries |
| 4 | **PERF-024**: Hoist employee name fetch and OAuth client out of per-week loop | 30 min | High -- eliminates N-1 redundant employee queries and auth refreshes |
| 5 | **PERF-026/027**: Replace `select('*')` with explicit columns in both feeds | 10 min | Medium -- reduces payload on every calendar poll |
| 6 | **PERF-030**: Add server-side concurrency guard for resync | 30 min | Medium -- prevents GCal rate limit exhaustion from concurrent syncs |
| 7 | **PERF-029**: Replace sort with reduce for max published_at | 5 min | Low -- trivial fix, marginal gain |

---

*Report updated: 2026-03-22 (calendar sync analysis added)*
*Analyst: Performance Specialist (Claude)*
