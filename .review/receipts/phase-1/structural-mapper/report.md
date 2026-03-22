# Receipts Section — Structural Map
**Role:** Structural Mapper | **Phase:** 1 | **Date:** 2026-03-07

---

## 1. File Inventory

| Path | Concern | Key Exports / Purpose | Flags |
|------|---------|----------------------|-------|
| `src/app/actions/receipts.ts` | All server actions (3415 lines) | `importReceiptStatement`, `markReceiptTransaction`, `updateReceiptClassification`, `uploadReceiptForTransaction`, `deleteReceiptFile`, `createReceiptRule`, `updateReceiptRule`, `toggleReceiptRule`, `deleteReceiptRule`, `runReceiptRuleRetroactivelyStep`, `runReceiptRuleRetroactively`, `finalizeReceiptRuleRetroRun`, `getReceiptWorkspaceData`, `getReceiptBulkReviewData`, `applyReceiptGroupClassification`, `createReceiptRuleFromGroup`, `getMonthlyReceiptSummary`, `getMonthlyReceiptInsights`, `getReceiptVendorSummary`, `getReceiptVendorMonthTransactions`, `getReceiptMissingExpenseSummary`, `requeueUnclassifiedTransactions`, `previewReceiptRule`, `getAIUsageBreakdown`, `getReceiptSignedUrl`; types: `ReceiptWorkspaceFilters`, `ReceiptWorkspaceData`, `ReceiptWorkspaceSummary`, `ReceiptBulkReviewData`, `ReceiptDetailGroup`, `ClassificationRuleSuggestion`, `AIUsageBreakdown`, `RulePreviewResult` | Very large; contains both data-read actions and mutations; internal helpers `applyAutomationRules`, `enqueueReceiptAiClassificationJobs`, `fetchSummary`, `refreshAutomationForPendingTransactions` are unexported; `any` casts for Supabase RPC calls |
| `src/lib/receipts/ai-classification.ts` | OpenAI classification orchestration | `classifyReceiptTransactionsWithAI`, `recordAIUsage` | Uses `(supabase as any)` throughout; no explicit return type on `classifyReceiptTransactionsWithAI`; `fetchFewShotExamples` and `fetchCrossTransactionHints` are unexported private helpers |
| `src/lib/receipts/rule-matching.ts` | Rule evaluation logic | `getRuleMatch`, `selectBestReceiptRule`; types: `ReceiptRuleMatchable`, `ReceiptTransactionMatchable` | Pure functions, no DB access; well-typed |
| `src/app/api/receipts/upload/route.ts` | Receipt file upload HTTP endpoint | POST handler | Thin wrapper — delegates entirely to `uploadReceiptForTransaction` server action; no auth check at API layer (relies on action) |
| `src/app/api/receipts/export/route.ts` | Quarterly CSV+ZIP export | GET handler | `runtime = 'nodejs'`, `maxDuration = 300`; uses `archiver` streaming; concurrent download with `DOWNLOAD_CONCURRENCY = 4`; auth check via `checkUserPermission('receipts','export')`; no audit log written on export |
| `src/app/api/receipts/pnl/export/route.ts` | P&L PDF export | GET handler | `runtime = 'nodejs'`, `maxDuration = 120`; uses `generatePDFFromHTML` + `FinancialService.getPlDashboardData`; writes audit log on success |
| `src/app/(authenticated)/receipts/page.tsx` | Workspace page (Server Component) | Default export | Checks `receipts/view` and `receipts/export`; resolves search params; falls back to first available month if current month has no data; passes data to `ReceiptsClient` |
| `src/app/(authenticated)/receipts/_components/ReceiptsClient.tsx` | Workspace client shell | Default export | Client Component; owns `transactions` and `summary` state; manages URL query updates; renders Stats, Upload, Export, Filters, List, Rules, Reclassify sub-components |
| `src/app/(authenticated)/receipts/_components/ReceiptBulkReviewClient.tsx` | Bulk classification client | Default export | Client Component; per-group draft state for vendor, expense, rule name, direction, status; calls `applyReceiptGroupClassification` and `createReceiptRuleFromGroup`; uses `useRetroRuleRunner` hook |
| `src/app/(authenticated)/receipts/_components/ui/ReceiptRules.tsx` | Rules panel | `ReceiptRules` | Client Component; toggle/create/update/delete/preview/retro-run; uses `useRetroRuleRunner` hook; `MatchDescriptionTokenPreview` inline token chip display |
| `src/app/(authenticated)/receipts/_components/ui/ReceiptStats.tsx` | Status summary cards | `ReceiptStats` | Server-renderable but marked client for toast access; displays 6 cards: OpenAI spend (with month/avg breakdown), Pending, Completed, Auto-matched, No receipt required, Can't find |
| `src/app/(authenticated)/receipts/_components/ui/ReceiptUpload.tsx` | CSV import UI | `ReceiptUpload` | Client Component; calls `importReceiptStatement` server action; shows last import metadata |
| `src/app/(authenticated)/receipts/_components/ui/ReceiptFilters.tsx` | Filter bar | `ReceiptFilters` | Client Component; URL-driven filters: status, direction, month tabs, search, outstanding-only, missing-vendor, missing-expense checkboxes |
| `src/app/(authenticated)/receipts/_components/ui/ReceiptTableRow.tsx` | Transaction row | `ReceiptTableRow` | Client Component; inline editing of vendor/expense; status buttons; file upload trigger; note editing; calls `markReceiptTransaction`, `updateReceiptClassification`, `deleteReceiptFile`, `getReceiptSignedUrl` |
| `src/app/(authenticated)/receipts/_components/ui/ReceiptList.tsx` | Transaction list wrapper | `ReceiptList` | Client Component; renders `ReceiptTableRow` (desktop) and `ReceiptMobileCard` (mobile); manages sort column headers; applies local filter-removal logic after status updates |
| `src/app/(authenticated)/receipts/_components/ui/ReceiptExport.tsx` | Export form | `ReceiptExport` | Client Component; year/quarter selects; constructs `/api/receipts/export?year=&quarter=` URL and redirects |
| `src/app/(authenticated)/receipts/_components/ui/ReceiptReclassify.tsx` | Requeue trigger | `ReceiptReclassify` | Client Component; calls `requeueUnclassifiedTransactions`; hidden if no `manage` permission |
| `src/app/(authenticated)/receipts/_components/ui/ReceiptMobileCard.tsx` | Mobile transaction card | default export | Client Component; functionally mirrors `ReceiptTableRow` with mobile-optimised layout |
| `src/app/(authenticated)/receipts/_components/PnlClient.tsx` | P&L dashboard client | default export | Client Component; editable target/actual grid; calls `savePlTargetsAction`, `savePlManualActualsAction`; download button hits `/api/receipts/pnl/export` |
| `src/app/(authenticated)/receipts/bulk/page.tsx` | Bulk review page (Server Component) | Default export | Checks `receipts/manage`; parses limit/statuses/onlyUnclassified/fuzzy from search params; loads `getReceiptBulkReviewData`; error boundary via Alert |
| `src/app/(authenticated)/receipts/pnl/page.tsx` | P&L page (Server Component) | Default export | Checks `receipts/view` and `receipts/export`; loads `getPlDashboardData`; `runtime = 'nodejs'` |
| `src/app/(authenticated)/receipts/monthly/page.tsx` | Monthly overview page (Server Component) | Default export | Checks `receipts/view`; loads `getMonthlyReceiptInsights(12)`; renders charts and insight feed; all computation inline in server component |
| `src/app/(authenticated)/receipts/monthly/MonthlyCharts.tsx` | Income/outgoing bar chart | `MonthlyCharts`, `StackedBreakdownChart` | Client Component; pure CSS bar chart, no charting library |
| `src/app/(authenticated)/receipts/vendors/page.tsx` | Vendor trends page (Server Component) | Default export | Checks `receipts/view`; loads `getReceiptVendorSummary(12)`; `runtime = 'nodejs'` |
| `src/app/(authenticated)/receipts/vendors/_components/VendorSummaryGrid.tsx` | Vendor grid with drill-down | default export | Client Component; calls `getReceiptVendorMonthTransactions` on month click |
| `src/app/(authenticated)/receipts/missing-expense/page.tsx` | Missing expense summary (Server Component) | Default export | Checks `receipts/view`; loads `getReceiptMissingExpenseSummary()`; `runtime = 'nodejs'`; static render |
| `src/app/(authenticated)/receipts/utils.ts` | Shared display helpers | `statusLabels`, `statusToneClasses`, `formatCurrency`, `formatDate`, `buildReceiptName` | No logic, pure display |
| `src/app/(authenticated)/receipts/receiptsNavItems.ts` | Navigation config | `getReceiptsNavItems` | 8 nav items: Workspace, Monthly overview, Vendor trends, P&L dashboard, Bulk classification, Needs vendor, Needs expense, Missing expense summary |
| `src/lib/openai.ts` | OpenAI API wrapper | `classifyReceiptTransaction` (single), `classifyReceiptTransactionsBatch`; types: `ClassificationUsage`, `BatchClassificationItem`, `BatchClassificationOutcome`, `FewShotExample`, `CrossTransactionHint` | Model pricing table for gpt-4o-mini, gpt-4o, gpt-4.1-mini; `retry` wrapper used; `extractContent` handles string/array content formats |
| `src/lib/unified-job-queue.ts` | Job queue singleton | `jobQueue` (UnifiedJobQueue instance), `Job`, `JobOptions`, `JobPayload`, `JobType` | `classify_receipt_transactions` is one of 9 supported job types; uses `claim_jobs` RPC with fallback; heartbeat/lease system; exponential backoff retry |
| `src/lib/supabase/admin.ts` | Service-role DB client | `createAdminClient` | Synchronous factory; bypasses RLS; used by all receipt server actions and job queue |
| `src/lib/validation.ts` (receipts portion) | Zod schemas | `receiptTransactionStatusSchema`, `receiptExpenseCategorySchema`, `receiptClassificationSourceSchema`, `receiptRuleDirectionSchema`, `receiptRuleSchema`, `receiptMarkSchema`, `receiptQuarterExportSchema`, `pnlExportSchema` | 24 expense category values hardcoded as enum |
| `src/types/database.ts` (receipts portion) | TypeScript types | `ReceiptBatch`, `ReceiptRule`, `ReceiptTransaction`, `ReceiptFile`, `ReceiptTransactionLog`, `AIUsageEvent`, `PLTarget`, `PLManualActual`, `ReceiptTransactionStatus`, `ReceiptClassificationSource`, `ReceiptExpenseCategory`, `ReceiptRuleDirection` | Manually maintained; not generated from DB schema |

---

## 2. Flow Maps

### 2.1 CSV Import Flow

1. User selects CSV file in `ReceiptUpload` component, submits form.
2. `importReceiptStatement(formData)` server action called.
3. Permission check: `checkUserPermission('receipts', 'manage')` — returns error if denied.
4. `fileSchema.safeParse(file)` — validates type is CSV, size > 0.
5. `parseCsv(buffer)` — PapaParse with header:true; per-row: normalise date (`normaliseDate`), sanitize details, parse `In`/`Out`/`Balance` currencies; skip rows with no amount or no date; compute `dedupeHash` via SHA-256 of `date|details|type|amountIn|amountOut|balance`.
6. If no rows parsed, return error.
7. Insert `receipt_batches` row: `original_filename`, `source_hash` (SHA-256 of raw buffer), `row_count`, `uploaded_by`.
8. If batch insert fails, return error (no cleanup needed).
9. Build transaction payload array with `status='pending'`, `receipt_required=true`, all classification fields null.
10. Upsert `receipt_transactions` with `onConflict: 'dedupe_hash', ignoreDuplicates: true` — returns only newly inserted rows.
11. If upsert errors, return error.
12. `applyAutomationRules(insertedIds)` — synchronous rule application on all inserted IDs (see Flow 2.3).
13. `enqueueReceiptAiClassificationJobs(insertedIds, batch.id)` — chunks IDs by `RECEIPT_AI_JOB_CHUNK_SIZE=10`; enqueues one `classify_receipt_transactions` job per chunk; failures logged but not surfaced to user.
14. Insert `receipt_transaction_logs` rows for all inserted IDs (`action_type: 'import'`).
15. `logAuditEvent` — records batch create with row/insert/skip counts.
16. `revalidatePath` for `/receipts`, `/receipts/vendors`, `/receipts/monthly`, `/receipts/pnl`; `revalidateTag('dashboard')`.
17. Return `{ success, inserted, skipped, autoApplied, autoClassified, batch }`.

**Missing:** No validation of column headers — silent failure if CSV has wrong columns (rows parsed but all amounts null → skipped at step 5). No rollback of batch record if transaction upsert fails at step 11.

---

### 2.2 AI Classification Job Flow

Triggered by: job queue processing a `classify_receipt_transactions` job.

1. `jobQueue.processJobs()` called (no explicit trigger shown — presumably a cron or background endpoint not visible in receipts files).
2. `claimJobs` RPC claims job with lease token; heartbeat set at `HEARTBEAT_MS` (default 30s).
3. `executeJob('classify_receipt_transactions', payload)` called.
4. `transactionIds` extracted from payload; empty array → return `{ skipped: true }`.
5. Dynamic import: `classifyReceiptTransactionsWithAI(supabase, transactionIds)`.
6. Inside `classifyReceiptTransactionsWithAI`:
   a. `getOpenAIConfig()` — if no API key, return early (silent skip, no log).
   b. Fetch all `receipt_transactions` by IDs.
   c. Filter to only those needing classification: `needsVendor` = vendor_source not manual/rule AND vendor_name null; `needsExpense` = expense_category_source not manual AND expense_category null AND amount_out > 0.
   d. If nothing to classify, return early.
   e. Parallel fetch: `fetchFewShotExamples` (recent `manual_classification` logs → transactions with vendor_name) and `fetchCrossTransactionHints` (existing transactions with same details, manual or rule source, deduped preferring manual).
   f. Build `BatchClassificationItem[]` array.
   g. `classifyReceiptTransactionsBatch(items, categories, fewShotExamples, crossTransactionHints)` — single OpenAI API call.
   h. If batch call returns null: insert `ai_classification_failed` log for every item; return.
   i. `recordAIUsage` — insert one row to `ai_usage_events` for the whole batch.
   j. For each transaction: extract result from map; if no result, skip (no log written for individual skip).
   k. Build `updatePayload` for vendor (if needsVendor and vendorName returned), expense (if needsExpense and expenseCategory returned), always write confidence/keywords if returned.
   l. If nothing to update, skip.
   m. `UPDATE receipt_transactions` — `.maybeSingle()` — if error or null result, `console.error` and continue (no recovery).
   n. Build log entry for successful changes.
7. Batch insert `receipt_transaction_logs`.
8. Job marked `completed` in `jobs` table; lease released.
9. On failure: exponential backoff retry up to `max_attempts` (default 3).

**Missing:** No log written when a specific transaction has a result but nothing needed updating (step j skip). No revalidation called after job completion. No notification or requeue if OpenAI key missing at step 6a. Stale job reset depends on `STALE_JOB_MINUTES` env var (default 30min).

---

### 2.3 Rule-Based Auto-Classification Flow

Internal function `applyAutomationRules(transactionIds, options)`:

1. Called with array of transaction IDs and options: `includeClosed`, `targetRuleId`, `overrideManual`, `allowClosedStatusUpdates`.
2. Fetch active rules from `receipt_rules` where `is_active=true`, ordered by `created_at ASC`.
3. If `targetRuleId` provided, also filter to that rule.
4. Fetch transactions in chunks of 100 (parallel `Promise.all`).
5. For each transaction:
   a. Skip if `!includeClosed && status !== 'pending'`.
   b. Compute direction (`in` if amount_in > 0, else `out`) and amountValue.
   c. `selectBestReceiptRule(activeRules, transaction, context)` — calls `getRuleMatch` for each rule, returns best by: longest needle match > has transaction type match > is direction-specific > most amount constraints.
   d. If no match: record in `unmatchedSamples` (up to 20).
   e. If match: compute `shouldUpdateVendor`, `shouldUpdateExpense`, `statusChanged`.
   f. Build `updatePayload`; skip if nothing to update.
   g. `UPDATE receipt_transactions` `.maybeSingle()` — on error: `console.warn`, continue.
   h. Push logs for status change (`rule_auto_mark`) and classification change (`rule_classification`).
6. Batch insert `receipt_transaction_logs`.
7. Return `AutomationResult` with counts.

**Missing:** No `revalidatePath` called from `applyAutomationRules` — caller must handle. Vendor update does not respect `vendor_source='ai'` (only blocks on `'manual'`). No audit log written (only transaction logs). `allowClosedStatusUpdates` path can overwrite manually-set statuses without confirmation.

---

### 2.4 Rule Retro-Run Flow

Entry points: `runReceiptRuleRetroactively` (single-call, 12s budget) or client-driven via `useRetroRuleRunner` hook calling `runReceiptRuleRetroactivelyStep` in a loop.

**`runReceiptRuleRetroactivelyStep` (paginated step):**

1. Permission check: `checkUserPermission('receipts', 'manage')`.
2. Fetch rule by ID from `receipt_rules`; return error if not found or inactive.
3. Query transaction IDs with pagination: `SELECT id ... ORDER BY transaction_date DESC`; if `scope='pending'`, filter `status='pending'`; use `RANGE(offset, offset+chunkSize-1)`.
4. Extract IDs; compute `total` from count.
5. If no IDs: return `{ done: true, ... }`.
6. `applyAutomationRules(ids, { includeClosed: scope==='all', targetRuleId, overrideManual: scope==='all', allowClosedStatusUpdates: scope==='all' })`.
7. Compute `nextOffset = offset + ids.length`; `done = nextOffset >= total`.
8. Return step result with counts.

**`runReceiptRuleRetroactively` (full loop with time budget):**

1. Loop calling `runReceiptRuleRetroactivelyStep` until `done` or 12s elapsed.
2. On `done`: call `finalizeReceiptRuleRetroRun` — writes audit log; revalidates all receipt paths and `dashboard` tag.
3. On time budget exceeded: return partial result with `done: false` and `nextOffset`.

**`finalizeReceiptRuleRetroRun`:**

1. Permission check.
2. `logAuditEvent` with scope, counts.
3. `revalidatePath` for all receipt views.

**Missing:** `runReceiptRuleRetroactively` (single-call variant) may time out before completing if dataset is large — partial results returned without audit log. Client-driven hook (`useRetroRuleRunner`) must call `finalizeReceiptRuleRetroRun` separately; no guarantee it is always called on abort. No deduplication guard preventing concurrent retro runs on same rule.

---

### 2.5 Bulk Group Review / Apply Flow

**Data Load:**

1. `getReceiptBulkReviewData(options)` — requires `receipts/manage`.
2. `bulkGroupQuerySchema.safeParse(options)`.
3. RPC `get_receipt_detail_groups(limit_groups, include_statuses, only_unclassified, use_fuzzy_grouping)` — groups transactions by details string (or normalized details if fuzzy).
4. For each group: `normalizeDetailGroupRow`, then `buildGroupSuggestion`.
5. `buildGroupSuggestion`: if existing vendor/expense in dominantVendor/dominantExpense and no AI needed, return `source:'existing'`; else call `classifyReceiptTransaction` (single-item call, not batch) for AI suggestion; record usage via `recordAIUsage`.
6. Return `ReceiptBulkReviewData` with groups and config.

**Apply Classification:**

1. `applyReceiptGroupClassification(input)` — requires `receipts/manage`.
2. `bulkGroupApplySchema.safeParse`.
3. Fetch matching transactions by exact `details` string and statuses.
4. If vendor provided: `UPDATE receipt_transactions` for all IDs setting `vendor_name`, `vendor_source='manual'`, clear `vendor_rule_id`.
5. If expense provided: filter to non-incoming-only IDs; `UPDATE receipt_transactions` setting `expense_category`, `expense_category_source='manual'`, clear `expense_rule_id`.
6. Insert `receipt_transaction_logs` with `action_type:'bulk_classification'`.
7. `logAuditEvent`.
8. `revalidatePath` for all receipt views.
9. Return `{ success, updated, skippedIncomingCount }`.

**Create Rule From Group:**

1. `createReceiptRuleFromGroup(input)` — delegates to `createReceiptRule` via FormData bridge.
2. `groupRuleInputSchema.safeParse`.
3. Normalise vendor/expense, build FormData, call `createReceiptRule`.
4. If success, `revalidatePath('/receipts/bulk')`.

**Missing:** `buildGroupSuggestion` makes one AI call per group sequentially in a loop — no batching. No status change in `applyReceiptGroupClassification` (only vendor/expense updated, not status). The two-step "apply then create rule" is not atomic; rule creation failure leaves classifications applied without a rule.

---

### 2.6 Receipt File Upload / Attachment Flow

1. `ReceiptTableRow` or `ReceiptMobileCard` renders hidden `<input type="file">`.
2. On file selection, form submitted to `/api/receipts/upload` (POST) with `transactionId` and `receipt` file.
3. Route handler delegates to `uploadReceiptForTransaction(formData)`.
4. Inside action:
   a. Permission check: `receipts/manage`.
   b. Validate `transactionId` and `receiptFileSchema` (size > 0, size <= 15MB).
   c. Parallel fetch: `receipt_transactions` (to get metadata) and `profiles` (for marked_by_name).
   d. Derive file extension; `composeReceiptFileArtifacts` — builds `friendlyName` and `storagePath` (`YYYY/date-description-amount.ext_timestamp`).
   e. `supabase.storage.from('receipts').upload(storagePath, buffer, { upsert: false })`.
   f. If storage upload fails: return error.
   g. Insert `receipt_files` row. If insert fails: attempt `storage.remove([storagePath])` cleanup; return error (with note if cleanup also fails).
   h. `UPDATE receipt_transactions` set `status='completed'`, `receipt_required=false`, `marked_method='receipt_upload'`. If update fails: rollback `receipt_files` delete + storage remove; return error.
   i. Insert `receipt_transaction_logs` with `action_type:'receipt_upload'`. Failure logged but not fatal.
   j. `logAuditEvent`.
   k. `revalidatePath('/receipts')`, `revalidateTag('dashboard')`.
   l. Return `{ success, receipt }`.

**Delete Receipt File:**

1. `deleteReceiptFile(fileId)` — requires `receipts/manage`.
2. Fetch `receipt_files` row; fetch associated transaction.
3. Delete `receipt_files` row. If fails, return error.
4. `storage.remove([receipt.storage_path])`. If fails: re-insert receipt_files record as rollback; return error.
5. Insert log with `action_type:'receipt_deleted'`, `new_status:'pending'` (hardcoded regardless of actual status).
6. Check remaining receipt_files for same transaction. If none: `UPDATE receipt_transactions` set `status='pending'`, `receipt_required=true`, clear all marked fields.
7. `logAuditEvent`.
8. `revalidatePath('/receipts')`.

**Missing:** Storage upload uses `upsert: false` — duplicate path collisions would error but the timestamp suffix makes them unlikely. No virus/content scanning. Log insertion failure at step 4i is silent. Delete flow: log writes `new_status:'pending'` even if transaction remains completed (other files exist).

---

### 2.7 Transaction Manual Update Flow

**Status update (`markReceiptTransaction`):**

1. Permission: `receipts/manage`.
2. `receiptMarkSchema.safeParse`.
3. Parallel fetch: existing transaction status + user profile.
4. `UPDATE receipt_transactions`: status, receipt_required, marked_by/email/name/at, `marked_method='manual'`, clear `rule_applied_id`.
5. Insert log `action_type:'manual_update'`.
6. `logAuditEvent`.
7. `revalidatePath`, `revalidateTag('dashboard')`.
8. Return `{ success, transaction }`.

**Classification update (`updateReceiptClassification`):**

1. Permission: `receipts/manage`.
2. Detect which fields are present (`hasVendorField`, `hasExpenseField`); return error if neither.
3. `classificationUpdateSchema.safeParse`.
4. Fetch existing transaction.
5. Guard: expense category cannot be set on incoming-only transactions.
6. Build update payload only for changed fields; skip if no change.
7. `UPDATE receipt_transactions`.
8. Insert log `action_type:'manual_classification'`.
9. `logAuditEvent`.
10. `buildRuleSuggestion` — produces `ClassificationRuleSuggestion` for UI to offer rule creation; uses AI-suggested keywords if present, else heuristic (first 3 tokens >= 4 chars from details).
11. `revalidatePath` for all receipt and sub-views.
12. Return `{ success, transaction, ruleSuggestion }`.

---

### 2.8 Export (CSV + ZIP) Flow

1. `ReceiptExport` constructs URL `/api/receipts/export?year=Y&quarter=Q`.
2. `window.location.href = url` — browser GET request.
3. Route handler: `checkUserPermission('receipts', 'export')`.
4. `receiptQuarterExportSchema.safeParse({ year, quarter })`.
5. Derive quarter date range (`deriveQuarterRange`).
6. `SELECT *, receipt_files(*) FROM receipt_transactions WHERE transaction_date BETWEEN start AND end ORDER BY transaction_date DESC`.
7. `buildSummaryCsv` — summary header block + data rows with columns: Date, Details, Transaction type, Vendor, Vendor source, Expense category, Expense category source, AI confidence, Amount in, Amount out, Status, Notes. UTF-8 BOM prepended.
8. Create `archiver('zip')` + `PassThrough` stream; pipe to `NextResponse`.
9. Async: append summary CSV to archive; iterate receipt files; for each file download from storage and append to archive. Downloads run with `DOWNLOAD_CONCURRENCY=4`.
10. Empty dataset: append `README.txt` placeholder.
11. `archive.finalize()`.
12. Stream response with `Content-Type: application/zip`.

**No audit log written for CSV/ZIP export.**

---

### 2.9 P&L Export Flow

1. `PnlClient` renders download button hitting `/api/receipts/pnl/export?timeframe=Xm`.
2. Route: `checkUserPermission('receipts', 'export')`.
3. `pnlExportSchema.safeParse({ timeframe })`.
4. `FinancialService.getPlDashboardData()` — fetches P&L data (separate service, not receipts actions).
5. `buildPnlReportViewModel(data, timeframe, now)`.
6. `generatePnlReportHTML(viewModel, { logoUrl })`.
7. `generatePDFFromHTML(html, pdfOptions)` — puppeteer or equivalent.
8. `logExportAudit` — writes audit event `operation_type:'export'`, `resource_type:'receipts'`.
9. Return `application/pdf` response.

---

### 2.10 Reporting / Analytics Data Load Flows

**Workspace (`getReceiptWorkspaceData`):**
1. Permission: `receipts/view`.
2. Resolve month range; compute page size (max 5000 for month-scoped, 100 otherwise); default sort: `amount_total DESC` (all-time) or `transaction_date DESC` (month-scoped).
3. Parallel: transactions query (with `receipt_files(*)` join and `receipt_rules!receipt_transactions_rule_applied_id_fkey(id,name)` join), all rules, `fetchSummary()`, vendor list (limit 2000), `get_receipt_monthly_summary` RPC.
4. `fetchSummary()`: parallel RPCs `count_receipt_statuses`, `get_openai_usage_total`, `get_ai_usage_breakdown`; last batch from `receipt_batches`.
5. Shape transactions, build `knownVendors` set (from vendor list + transactions + rule set_vendor_name fields).
6. Return `ReceiptWorkspaceData`.

**Monthly Insights (`getMonthlyReceiptInsights`):**
1. Permission: `receipts/view`.
2. Parallel RPCs: `get_receipt_monthly_summary`, `get_receipt_monthly_category_breakdown`, `get_receipt_monthly_income_breakdown`, `get_receipt_monthly_status_counts` — all with `limit_months`.
3. Join by `month_start`; sort descending; sort breakdowns by amount.

**Vendor Summary (`getReceiptVendorSummary`):**
1. Permission: `receipts/view`.
2. RPC `get_receipt_vendor_trends(month_window)`.
3. Group by vendor, compute recent/previous 3-month averages, change %; exclude Uncategorised; sort by totalOutgoing.

**Missing Expense Summary (`getReceiptMissingExpenseSummary`):**
1. Permission: `receipts/view`.
2. Direct query: `SELECT vendor_name, amount_out, amount_in, transaction_date FROM receipt_transactions WHERE expense_category IS NULL AND amount_out IS NOT NULL LIMIT 5000`.
3. Group by normalised vendor name in application code.

**Vendor Month Transactions (`getReceiptVendorMonthTransactions`):**
1. Permission: `receipts/view`.
2. Direct query filtered by `vendor_name =` and date range; limit 1000.

---

### 2.11 Rule Create / Edit / Delete Flow

**Create (`createReceiptRule`):**
1. Permission: `receipts/manage`.
2. Parse FormData fields; `receiptRuleSchema.safeParse`.
3. Guard: `set_expense_category` requires `match_direction = 'out'`.
4. `INSERT receipt_rules` with `created_by`, `updated_by`.
5. `logAuditEvent`.
6. `revalidatePath('/receipts')`, `revalidateTag('dashboard')`.
7. Return `{ success, rule, canPromptRetro: true }`.

**Update (`updateReceiptRule`):**
1. Same validation as create.
2. `UPDATE receipt_rules ... WHERE id = ruleId` `.maybeSingle()`.
3. `logAuditEvent`.
4. Revalidate; return `{ success, rule, canPromptRetro: true }`.

**Toggle (`toggleReceiptRule`):**
1. Permission check.
2. `UPDATE receipt_rules SET is_active = isActive`.
3. `logAuditEvent`.
4. If `isActive=true`: call `refreshAutomationForPendingTransactions()` — fetches up to 500 pending transaction IDs, runs `applyAutomationRules`.
5. Revalidate; return `{ success, rule }`.

**Delete (`deleteReceiptRule`):**
1. Permission check.
2. `DELETE FROM receipt_rules WHERE id = ruleId`.
3. `logAuditEvent`.
4. Revalidate; return `{ success }`.

**Preview (`previewReceiptRule`):**
1. Permission: `receipts/manage`.
2. Parse FormData.
3. Parallel: fetch all active rules + up to 2000 transactions.
4. For each transaction: run `getRuleMatch` against candidate rule; count matches, pending matches, status/vendor/expense changes; detect overlap with existing rules (up to 5 shown).
5. Return `RulePreviewResult`.

**Missing:** Delete does not update `receipt_transactions.rule_applied_id` or `vendor_rule_id`/`expense_rule_id` — orphaned rule IDs remain on transactions. No confirmation that deleting an active rule will affect future auto-classification.

---

### 2.12 Requeue Unclassified Transactions Flow

1. `ReceiptReclassify` button calls `requeueUnclassifiedTransactions()`.
2. Permission: `receipts/manage`.
3. `SELECT id, batch_id FROM receipt_transactions WHERE vendor_name IS NULL AND vendor_source IS NULL LIMIT 5000`.
4. If no rows: return `{ success, queued: 0 }`.
5. `enqueueReceiptAiClassificationJobs(ids, batchId)` — chunks by 10, enqueues jobs. Uses `batch_id` of first row (or 'requeue' if null).
6. Return `{ success, queued }`.

**Missing:** Does not check for existing pending jobs for same transactions — could create duplicate classification jobs. Does not filter by status (classifies all transactions with no vendor, regardless of status). Error from `enqueueReceiptAiClassificationJobs` caught and returned; individual chunk failures counted but not exposed to user.

---

## 3. Data Model Map

### Table: `receipt_batches`
| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | |
| uploaded_at | timestamptz | auto |
| uploaded_by | uuid FK → auth.users | nullable |
| original_filename | text | |
| source_hash | text | SHA-256 of raw file bytes; nullable |
| row_count | integer | count of parsed rows (includes dupes) |
| notes | text | nullable |
| created_at | timestamptz | |

CRUD: Create on import; Read for last-import display; no Update or Delete operations in codebase.

### Table: `receipt_transactions`
| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | |
| batch_id | uuid FK → receipt_batches | nullable (can exist without batch) |
| transaction_date | date | |
| details | text | raw bank statement description |
| transaction_type | text | nullable |
| amount_in | numeric(12,2) | nullable |
| amount_out | numeric(12,2) | nullable |
| amount_total | numeric(12,2) | GENERATED ALWAYS AS COALESCE(amount_out, amount_in) STORED |
| balance | numeric(12,2) | nullable |
| dedupe_hash | text UNIQUE | SHA-256 of date|details|type|amountIn|amountOut|balance |
| status | enum | 'pending','completed','auto_completed','no_receipt_required','cant_find' |
| receipt_required | boolean | |
| marked_by | uuid | nullable — user who last changed status |
| marked_by_email | text | nullable |
| marked_by_name | text | nullable |
| marked_at | timestamptz | nullable |
| marked_method | text | nullable — 'manual','rule','receipt_upload' |
| rule_applied_id | uuid FK → receipt_rules | nullable — last rule that changed status |
| vendor_name | text | nullable; max 120 chars |
| vendor_source | enum | nullable — 'ai','manual','rule','import' |
| vendor_rule_id | uuid FK → receipt_rules | nullable |
| vendor_updated_at | timestamptz | nullable |
| expense_category | enum (24 values) | nullable |
| expense_category_source | enum | nullable — 'ai','manual','rule','import' |
| expense_rule_id | uuid FK → receipt_rules | nullable |
| expense_updated_at | timestamptz | nullable |
| notes | text | nullable |
| ai_confidence | smallint | nullable — 0-100 |
| ai_suggested_keywords | text | nullable — comma-separated |
| created_at | timestamptz | |
| updated_at | timestamptz | |

CRUD: Create (import); Read (workspace, analytics); Update (status, classification, rule application); no Delete. Upsert on `dedupe_hash` with `ignoreDuplicates: true`.

Valid status state transitions:
- Import → `pending`
- `pending` → any (rule, manual, receipt upload)
- `completed` → `pending` (receipt deleted, last file removed)
- `no_receipt_required` / `auto_completed` / `cant_find` → `pending` (manual or retro rule with `allowClosedStatusUpdates`)

### Table: `receipt_rules`
| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | |
| name | text | max 120 |
| description | text | nullable; max 500 |
| match_description | text | nullable; comma-separated tokens; max 300 |
| match_transaction_type | text | nullable |
| match_direction | enum | 'in','out','both' |
| match_min_amount | numeric | nullable |
| match_max_amount | numeric | nullable |
| auto_status | enum (same as transaction status) | |
| is_active | boolean | |
| created_by | uuid | nullable |
| updated_by | uuid | nullable |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| set_vendor_name | text | nullable |
| set_expense_category | enum | nullable; only valid when match_direction = 'out' |

CRUD: Full CRUD via server actions. No soft delete — hard delete leaves orphaned FK references on transactions.

### Table: `receipt_files`
| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | |
| transaction_id | uuid FK → receipt_transactions | |
| storage_path | text | Supabase storage path in 'receipts' bucket |
| file_name | text | friendly display name |
| mime_type | text | nullable |
| file_size_bytes | integer | nullable |
| uploaded_by | uuid | nullable |
| uploaded_at | timestamptz | |

CRUD: Create (upload); Read (workspace display, export); Delete (with storage cleanup). No Update. Multiple files can exist per transaction.

### Table: `receipt_transaction_logs`
| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | |
| transaction_id | uuid FK → receipt_transactions | |
| previous_status | enum | nullable |
| new_status | enum | nullable |
| action_type | text | 'import','manual_update','manual_classification','rule_auto_mark','rule_classification','ai_classification','ai_classification_failed','receipt_upload','receipt_deleted','bulk_classification' |
| note | text | nullable |
| performed_by | uuid | nullable |
| rule_id | uuid | nullable |
| performed_at | timestamptz | |

CRUD: Insert only (append-only audit trail). No Read endpoint exposed in actions (used only internally for few-shot examples). No Update, no Delete.

### Table: `ai_usage_events`
| Field | Type | Notes |
|-------|------|-------|
| id | integer PK | |
| occurred_at | timestamptz | |
| context | text | nullable — e.g. `receipt_classification_batch:10` |
| model | text | |
| prompt_tokens | integer | |
| completion_tokens | integer | |
| total_tokens | integer | |
| cost | numeric | |

CRUD: Insert only (from `recordAIUsage`). Read via RPCs `get_openai_usage_total`, `get_ai_usage_breakdown`. No Update, no Delete.

### Table: `jobs`
| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | |
| type | text | one of SUPPORTED_JOB_TYPES |
| payload | jsonb | includes `transactionIds`, `batchId`, and optionally `unique_key` |
| status | enum | 'pending','processing','completed','failed','cancelled' |
| priority | integer | |
| attempts | integer | |
| max_attempts | integer | default 3 |
| scheduled_for | timestamptz | |
| started_at | timestamptz | nullable |
| completed_at | timestamptz | nullable |
| failed_at | timestamptz | nullable |
| error_message | text | nullable |
| result | jsonb | nullable |
| processing_token | uuid | nullable — lease guard |
| lease_expires_at | timestamptz | nullable |
| last_heartbeat_at | timestamptz | nullable |
| created_at | timestamptz | |
| updated_at | timestamptz | |

CRUD: Insert (enqueue); Update (claim, complete, fail, retry); Delete (cleanup after 30 days). Read via `getJob`, `getNextPendingJob`.

### Database Views / RPCs (receipts-specific)

| RPC / View | Parameters | Returns | Called From |
|------------|------------|---------|-------------|
| `count_receipt_statuses` | — | `{ pending, completed, auto_completed, no_receipt_required, cant_find }` | `fetchSummary` |
| `get_openai_usage_total` | — | numeric | `fetchSummary` |
| `get_ai_usage_breakdown` | — | `{ total_cost, this_month_cost, total_classifications, this_month_classifications, model_breakdown[] }` | `fetchSummary`, `getAIUsageBreakdown` |
| `get_receipt_monthly_summary` | `limit_months` | rows `{ month_start, total_income, total_outgoing, top_income, top_outgoing }` | `getMonthlyReceiptSummary`, `getMonthlyReceiptInsights`, `getReceiptWorkspaceData` |
| `get_receipt_monthly_category_breakdown` | `limit_months` | rows `{ month_start, category, total_outgoing }` | `getMonthlyReceiptInsights` |
| `get_receipt_monthly_income_breakdown` | `limit_months` | rows `{ month_start, source, total_income }` | `getMonthlyReceiptInsights` |
| `get_receipt_monthly_status_counts` | `limit_months` | rows `{ month_start, status, total }` | `getMonthlyReceiptInsights` |
| `get_receipt_vendor_trends` | `month_window` | rows `{ vendor_label, month_start, total_outgoing, total_income, transaction_count }` | `getReceiptVendorSummary` |
| `get_receipt_detail_groups` | `limit_groups, include_statuses, only_unclassified, use_fuzzy_grouping` | rows with transaction groups | `getReceiptBulkReviewData` |
| `normalize_receipt_details(TEXT)` | text | text | DB-internal (used by `get_receipt_detail_groups` fuzzy mode) |
| `claim_jobs` | `batch_size, job_types, lease_seconds` | Job[] | `claimJobs` in job queue |

---

## 4. External Dependency Map

### OpenAI

| Function | Called From | Mode | Model |
|----------|-------------|------|-------|
| `classifyReceiptTransactionsBatch` | `classifyReceiptTransactionsWithAI` | Batch (all IDs in one call) | Configurable via `getOpenAIConfig()` — defaults to gpt-4o-mini |
| `classifyReceiptTransaction` | `buildGroupSuggestion` (bulk review) | Single per group, sequential | Same config |

Config source: `src/lib/openai/config.ts` — reads `OPENAI_API_KEY` env var. If key absent, AI flows silently skip (no error raised to user). Cost tracking: model pricing table hardcoded in `src/lib/openai.ts` for gpt-4o-mini, gpt-4o, gpt-4.1-mini. Unknown model falls back to gpt-4o-mini pricing.

Retry: `retry` utility from `src/lib/retry.ts` wraps OpenAI calls (config `RetryConfigs` — specific values not read in this analysis).

### Supabase Storage

- Bucket: `receipts` (constant `RECEIPT_BUCKET`)
- Upload: `supabase.storage.from('receipts').upload(path, buffer, { upsert: false })`
- Download: `supabase.storage.from('receipts').download(path)` — used in export
- Signed URL: `createSignedUrl(path, 300)` (5 min TTL) — for viewing receipts
- Delete: `storage.remove([path])`
- No presigned upload URLs used — all uploads proxy through server action

### Supabase Database

- All receipt operations use `createAdminClient()` (service-role, bypasses RLS)
- No RLS policies relied upon for receipts — all access control is application-level via `checkUserPermission`

### Job Queue (internal)

- `jobQueue.enqueue('classify_receipt_transactions', { transactionIds, batchId })` — called from `importReceiptStatement` and `requeueUnclassifiedTransactions`
- Idempotency: if `options.unique` not set (receipt jobs do not set it), duplicate jobs for same transaction IDs can be enqueued
- Job processor trigger: not visible in receipts files — likely a cron or `processJobs` endpoint

### PDF Generation

- `generatePDFFromHTML` from `src/lib/pdf-generator.ts` — puppeteer-based, used only for P&L export

### FinancialService

- `FinancialService.getPlDashboardData()` from `src/services/financials.ts` — used in P&L export route; not part of receipts module proper

---

## 5. Missing Pieces Inventory

### Error Handling Gaps

1. **CSV import — no column header validation.** If uploaded CSV lacks expected columns (Date, Details, Transaction Type, In, Out, Balance), rows are silently skipped. No user-facing error distinguishes "wrong file format" from "empty statement."

2. **CSV import — batch insert fails, batch record remains.** If step 11 (transaction upsert) fails, the `receipt_batches` row inserted at step 7 is not rolled back — orphaned batch record with `row_count` but no transactions.

3. **AI classification job — no revalidation.** After job completes and updates transactions, no cache revalidation is triggered. Users must manually refresh to see AI-applied vendor/expense tags.

4. **AI classification job — silent skip on missing API key.** `classifyReceiptTransactionsWithAI` returns early without logging or enqueueing retry when `OPENAI_API_KEY` is absent. Jobs still marked `completed` in job table with `{ processed: N }` even though nothing was classified.

5. **AI classification — individual skip not logged.** When a batch result exists for a transaction but nothing needed updating (already classified), no log entry is written. Audit trail has gaps.

6. **Bulk group suggestions — sequential AI calls.** `buildGroupSuggestion` is called in a `for...of` loop (not `Promise.all`), making bulk review page load time O(groups × AI latency). Each call is a separate single-item classification, not batched.

7. **Rule delete — orphaned FK references.** Deleting a rule leaves `rule_applied_id`, `vendor_rule_id`, `expense_rule_id` on transactions pointing to non-existent rule IDs. These FKs are nullable so no DB error; but analytics/queries joining on these fields silently return null.

8. **Requeue — no deduplication.** `requeueUnclassifiedTransactions` can enqueue multiple jobs for the same transactions if called multiple times before jobs process. No `unique` key passed to `jobQueue.enqueue`.

9. **Receipt file delete log — hardcoded `new_status: 'pending'`.** The log entry always records `new_status: 'pending'` regardless of whether remaining files exist. If other files remain, the transaction stays completed but the log incorrectly implies it reverted.

10. **CSV/ZIP export — no audit log.** Quarterly bundle downloads are not recorded in the audit log. P&L export does log; CSV export does not.

11. **`toggleReceiptRule` (activate) — `refreshAutomationForPendingTransactions` is uncapped and synchronous.** Fetches up to 500 pending IDs and runs `applyAutomationRules` inline in the server action. For large datasets, this will timeout. No chunking, no job queue usage.

12. **`runReceiptRuleRetroactively` (single-call) — time budget abort without finalize.** If 12s budget exceeded, `finalizeReceiptRuleRetroRun` is NOT called, so no audit log is written and no cache revalidation occurs. The partial run is invisible in audit trail.

13. **`applyAutomationRules` — no audit log.** Only `receipt_transaction_logs` are written; no `audit_events` table entry. Rule-driven mass-classification is not in the audit log.

14. **`getReceiptMissingExpenseSummary` — in-application grouping on 5000 rows.** Loads up to 5000 raw transaction rows and groups in JavaScript. No RPC; no pagination. Could be slow or incorrect for large datasets.

15. **`buildGroupSuggestion` AI call — AI usage recorded per group but group ID is a hash of details string.** If the same details string appears in multiple separate calls, costs are recorded with same context hash. Not a functional bug but complicates cost attribution.

### Missing State Transitions

- No path from `completed` / `auto_completed` / `no_receipt_required` → `cant_find` via bulk classification (bulk apply does not change status, only vendor/expense).
- No path to mark a transaction `auto_completed` manually (only rules or upload trigger this status).

### Missing Audit Coverage

| Operation | `receipt_transaction_logs` | `audit_events` |
|-----------|---------------------------|----------------|
| Import | Yes (per transaction) | Yes (batch level) |
| Rule auto-classification | Yes | No |
| AI classification | Yes | No |
| Bulk classification | Yes | Yes |
| Manual status update | Yes | Yes |
| Manual classification | Yes | Yes |
| Receipt upload | Yes | Yes |
| Receipt delete | Yes | Yes |
| Rule create | — | Yes |
| Rule update | — | Yes |
| Rule delete | — | Yes |
| Rule toggle | — | Yes |
| Retro run finalize | — | Yes |
| Retro run step | No | No |
| CSV/ZIP export | No | No |
| P&L export | No | Yes |

### Missing Permission Checks

- `getReceiptSignedUrl` requires `receipts/view` — correctly gated.
- `getReceiptWorkspaceData` requires `receipts/view` — throws `Error` (not `{ error }`) on failure, which could surface as 500 to UI if uncaught.
- `getReceiptBulkReviewData` requires `receipts/manage` — throws on failure.
- `getMonthlyReceiptInsights`, `getReceiptVendorSummary`, `getReceiptMissingExpenseSummary` — all throw on permission failure; server page components do not wrap in try/catch — unhandled throws will show Next.js error page.

### Missing Input Validation

- `applyReceiptGroupClassification` uses exact `details` string match (`eq('details', ...)`) — no length validation on `details` input beyond `z.string().min(1)`.
- `previewReceiptRule` loads up to 2000 transactions for preview — no indication to user that preview is a sample, not all-time.
- Receipt file MIME type is stored but never validated for allowed types (any file accepted as long as <= 15MB).
