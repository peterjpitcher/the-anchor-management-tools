# Receipts Module — QA Test Matrix
## Phase 1 | QA Specialist Review
**Date:** 2026-03-07
**Reviewer:** QA Specialist (automated trace)
**Source files traced:**
- `src/app/actions/receipts.ts`
- `src/lib/receipts/ai-classification.ts`
- `src/lib/receipts/rule-matching.ts`
- `src/app/api/receipts/upload/route.ts`
- `src/app/api/receipts/export/route.ts`
- `src/app/(authenticated)/receipts/page.tsx`
- `src/app/(authenticated)/receipts/_components/ReceiptsClient.tsx`
- `src/app/(authenticated)/receipts/_components/ReceiptBulkReviewClient.tsx`
- `src/app/(authenticated)/receipts/_components/ui/ReceiptRules.tsx`
- `src/app/(authenticated)/receipts/_components/ui/ReceiptTableRow.tsx`

---

## Category 1: CSV Import (T001–T020)

| ID | Scenario | Expected | Actual (traced) | Status | Priority |
|----|----------|----------|-----------------|--------|----------|
| T001 | Valid CSV with all columns imports correctly | Rows parsed, batch created, transactions inserted, automation applied, AI jobs queued | Implemented correctly via `importReceiptStatement`. Upsert with `onConflict: 'dedupe_hash'`. | PASS | — |
| T002 | Re-importing same CSV does not create duplicate transactions | Duplicate rows skipped; `inserted` count < `rows` count | `upsert` with `ignoreDuplicates: true` on `dedupe_hash`. Duplicates silently skipped. | PASS | — |
| T003 | CSV with file size exactly at 15 MB limit | File accepted | `receiptFileSchema` checks `file.size <= MAX_RECEIPT_UPLOAD_SIZE` (15 MB). Boundary value: accepted. | PASS | — |
| T004 | CSV with file size 15 MB + 1 byte | File rejected with user-friendly error | `fileSchema` has no size check for the CSV import path — only `receiptFileSchema` (for receipt attachments) has the size check. The CSV import `fileSchema` checks type/non-empty but NOT size. | FAIL | HIGH |
| T005 | CSV with wrong format (e.g. JSON file) | Rejected: "Only CSV bank statements are supported" | `fileSchema` checks `file.type === 'text/csv' || file.name.endsWith('.csv')`. Enforced. | PASS | — |
| T006 | CSV with missing required columns (no `Details` column) | Error or rows skipped gracefully | `parseCsv` reads `record.Details || ''`; missing column yields empty string, `sanitizeText('')` returns `''`, row is `continue`d. No crash; 0 valid rows -> `{ error: 'No valid transactions found in the CSV file.' }` | PASS | — |
| T007 | CSV with corrupt data (garbled bytes) | Parsed with warnings logged; valid rows imported | PapaParse's `skipEmptyLines: true` + header parsing handles corruption gracefully. Errors logged via `console.warn`. | PASS | — |
| T008 | Partial rows: mix of valid and invalid rows | Valid rows imported; invalid rows silently skipped | `parseCsv` iterates with `continue` for rows missing `details` or `transactionDate` or zero amounts. | PASS | — |
| T009 | Blank lines in CSV | Ignored | `skipEmptyLines: true` in PapaParse config. | PASS | — |
| T010 | Unicode characters in bank descriptions (e.g. café, Müller) | Unicode preserved in `details` field | `sanitizeText` only collapses whitespace; no ASCII-only filter. Unicode passes through. | PASS | — |
| T011 | Row with both `In` and `Out` amounts | Both stored; direction derived from `amount_in > 0` | `parseCurrency` parses both independently. Both stored on transaction record. | PASS | — |
| T012 | Row with negative `Out` amount (e.g. credit reversal) | Stored as-is or rejected | `parseCurrency` uses `Number.parseFloat`; negative values pass `Number.isFinite`. Negative out stored with no guard. Business impact unclear — may cause direction detection issues. | FAIL | MEDIUM |
| T013 | Row with zero amounts in both `In` and `Out` | Row skipped | `(amountIn == null || amountIn === 0) && (amountOut == null || amountOut === 0)` -> `continue`. | PASS | — |
| T014 | Date in DD/MM/YYYY format | Normalised to ISO YYYY-MM-DD | `normaliseDate` handles `parts.length === 3` with DD/MM/YYYY parsing. | PASS | — |
| T015 | Date already in ISO format (YYYY-MM-DD) | Accepted as-is | `/^\d{4}-\d{2}-\d{2}$/.test(trimmed)` -> returns `trimmed`. | PASS | — |
| T016 | Date in unrecognised format (e.g. MM-DD-YYYY) | Row skipped (date normalises to null) | `normaliseDate` returns `null` for non-matching formats; row is `continue`d. | PASS | — |
| T017 | CSV with amounts using commas (e.g. "1,234.56") | Commas stripped, parsed correctly | `parseCurrency` does `value.replace(/,/g, '')`. | PASS | — |
| T018 | Batch record created before transactions insert; transaction insert fails | Batch record orphaned in DB with 0 transactions | Batch inserted first (line 1282), then upsert. If upsert fails, batch record exists but has no children. No rollback of batch. | FAIL | HIGH |
| T019 | CSV where all rows are duplicates | `inserted: 0`, `skipped: N`, success returned | After upsert with `ignoreDuplicates`, `inserted` array is empty. `applyAutomationRules([])` is called with empty array — returns early. `enqueueReceiptAiClassificationJobs([])` also returns early. Returns `{ success: true, inserted: 0, skipped: N }`. | PASS | — |
| T020 | No permission to manage receipts | Error returned | `checkUserPermission('receipts', 'manage')` checked first. Returns `{ error: 'Insufficient permissions' }`. | PASS | — |

---

## Category 2: AI Classification (T021–T040)

| ID | Scenario | Expected | Actual (traced) | Status | Priority |
|----|----------|----------|-----------------|--------|----------|
| T021 | Unclassified transactions get AI-classified (batch) | All transactions classified in single OpenAI call | `classifyReceiptTransactionsBatch` called once per job chunk (10 transactions per job). Batch is correct within a job. | PASS | — |
| T022 | OpenAI API key not configured | Classification skipped silently | `if (!apiKey) { return }` — early return, no failure logged. Transactions remain unclassified. | PASS | — |
| T023 | OpenAI call fails entirely (`batchOutcome` is null) | All transactions in batch get `ai_classification_failed` log | `if (!batchOutcome)` block inserts failure logs for all `toClassify` items. | PASS | — |
| T024 | OpenAI returns result but individual transaction missing from result map | Transaction silently skipped (no failure log) | `if (!classificationResult) { continue }` — no failure log written for missing individual results. | FAIL | MEDIUM |
| T025 | AI returns vendor name for incoming transaction | Vendor stored with `vendor_source = 'ai'` | `needsVendor` check does not restrict to outgoing; incoming transactions can receive vendor. `vendor_source` set to `'ai'`. | PASS | — |
| T026 | AI returns expense category for incoming-only transaction | Expense category NOT stored (guarded by `canAssignExpenseCategory`) | `canAssignExpenseCategory` checks `amount_out > 0`. If only incoming, `needsExpense` is false. | PASS | — |
| T027 | Transaction already has `vendor_source = 'manual'` | Vendor not overwritten by AI | `vendorLocked = transaction.vendor_source === 'manual'` -> `needsVendor = false`. | PASS | — |
| T028 | Transaction already has `vendor_source = 'rule'` | Vendor not overwritten by AI | `vendorLocked = ... || transaction.vendor_source === 'rule'` -> `needsVendor = false`. | PASS | — |
| T029 | AI returns `confidence` and `suggestedRuleKeywords` | Both written to DB regardless of whether vendor/expense changed | `updatePayload.ai_confidence` and `updatePayload.ai_suggested_keywords` set if returned. But only persisted if `Object.keys(updatePayload).length > 0`. If only confidence returned with no other change, confidence IS written (it's in the payload). | PASS | — |
| T030 | AI usage recorded even when some transactions in batch fail | Usage recorded once before per-transaction processing | `recordAIUsage` called immediately after `batchOutcome` is confirmed non-null (line 231). Usage is recorded before the per-transaction loop. | PASS | — |
| T031 | Running AI classification twice on same already-classified transactions | Second run is a no-op | `toClassify` filter excludes transactions where `vendor_source === 'ai'` AND `vendor_name` is already set. Second run finds `toClassify` empty, returns early. | PASS | — |
| T032 | Re-queue targets: only `vendor_name IS NULL AND vendor_source IS NULL` | Only transactions meeting BOTH conditions re-queued | `requeueUnclassifiedTransactions` filters `.is('vendor_name', null).is('vendor_source', null)`. Correct — requires both to be null. | PASS | — |
| T033 | Re-queue with `vendor_name IS NULL` but `vendor_source = 'rule'` | Should NOT be re-queued | `.is('vendor_source', null)` excludes this row. Correct. | PASS | — |
| T034 | AI classification DB update fails for one transaction | Error logged, loop continues for other transactions | `if (updateError) { console.error(...); continue }` — correct. | PASS | — |
| T035 | `ai_classification_failed` log written to correct table | Written to `receipt_transaction_logs` | `client.from('receipt_transaction_logs').insert(...)` with `action_type: 'ai_classification_failed'`. | PASS | — |
| T036 | Batch chunking: 25 transactions enqueued as jobs | 3 jobs created (10 + 10 + 5 per `RECEIPT_AI_JOB_CHUNK_SIZE = 10`) | `chunkArray(transactionIds, 10)` creates correct chunks. Each chunk is one job. | PASS | — |
| T037 | Job queue enqueue failure for some chunks | Failure logged; other chunks still enqueued | `Promise.all` over chunks. Failure counted. `console.error` called. Import still succeeds. | PASS | — |
| T038 | AI classifies transaction already having `vendor_source = 'ai'` (idempotency) | Re-classifies if no `vendor_name` set; skips if vendor already set | `vendorLocked` only checks `manual` and `rule`. AI-sourced transactions with `vendor_name` still set: `needsVendor = !vendorLocked && !transaction.vendor_name` = `false` if vendor already present. Correct. | PASS | — |
| T039 | Few-shot examples fetch fails | Falls back to empty examples array | `fetchFewShotExamples` catches all errors and returns `[]`. | PASS | — |
| T040 | Cross-transaction hints fetch fails | Falls back to empty hints | `fetchCrossTransactionHints` catches all errors and returns `[]`. | PASS | — |

---

## Category 3: Rule System (T041–T060)

| ID | Scenario | Expected | Actual (traced) | Status | Priority |
|----|----------|----------|-----------------|--------|----------|
| T041 | Rule with `match_description` matches transaction details | Rule applied | `matchesNeedle` checks each comma-separated needle against lowercased details. | PASS | — |
| T042 | Direction `in` rule applied to outgoing transaction | Rule does NOT match | `rule.match_direction !== 'both' && rule.match_direction !== context.direction` -> `matched: false`. | PASS | — |
| T043 | Direction `out` rule applied to incoming transaction | Rule does NOT match | Same direction guard. Correct. | PASS | — |
| T044 | Direction `both` rule applied to any transaction | Always matches direction check | `rule.match_direction !== 'both'` is false for 'both', so direction check passes. | PASS | — |
| T045 | Retro-run: `scope = 'pending'` applies to pending transactions only | Only pending transactions updated | `idsQuery.eq('status', 'pending')` when `scope === 'pending'`. `includeClosed = false`. | PASS | — |
| T046 | Retro-run: `scope = 'all'` applies to all transactions | All transactions (not just pending) updated | `scope === 'all'` -> `includeClosed: true`, `overrideManual: true`, `allowClosedStatusUpdates: true`. | PASS | — |
| T047 | Rule preview overlap count is accurate | Overlap count matches transactions that both this rule and an existing rule match | Preview iterates all transactions (up to 2000). For each match, checks all existing active rules. Overlap count per existing rule is correct. | PASS | — |
| T048 | Rule preview limited to 2000 transactions | Preview based on first 2000 records | `supabase.from('receipt_transactions').select(...).limit(2000)`. No pagination — first 2000 only, not a representative sample for large datasets. | FAIL | LOW |
| T049 | Rule with `matchDescription` (comma-separated keywords): all needles must match OR any needle? | Any single needle is sufficient | `for (const needle of needles)` — if any needle matches, `matchedNeedleLength > 0`. OR logic, not AND. Documented by code, but may surprise rule authors expecting AND semantics. | FAIL | MEDIUM |
| T050 | Short token (<=3 chars, alphanumeric) uses word-boundary matching | Boundary regex used | `needleLower.length <= SHORT_TOKEN_LENGTH && ALPHANUMERIC_PATTERN.test(needleLower)` -> boundary regex. | PASS | — |
| T051 | Rule priority: two rules match — longer needle wins | Rule with longer matching needle selected | `isBetterMatch`: first comparison is `matchedNeedleLength`. Longer wins. | PASS | — |
| T052 | Rule priority: equal needle length — transaction type match wins | Rule with `hasTransactionTypeMatch` selected | Second comparison in `isBetterMatch`. Correct. | PASS | — |
| T053 | Rule priority: equal needle + tx type — direction-specific wins | Direction-specific rule (`in`/`out`) wins over `both` | Third comparison: `isDirectionSpecific`. Correct. | PASS | — |
| T054 | Rule priority: all equal — more amount constraints wins | Rule with more constraints selected | Fourth comparison: `amountConstraintCount`. Correct. | PASS | — |
| T055 | Rule priority: all equal across all criteria — first rule wins (tie) | First rule in list retained | `isBetterMatch` returns `false` on tie; `bestRule` is not replaced. First rule in iteration order wins. Iteration order is `created_at ASC`. Deterministic. | PASS | — |
| T056 | Rule applied at import: newly imported transactions auto-classified | Rules applied immediately post-import | `applyAutomationRules(insertedIds)` called after insert, before AI jobs. | PASS | — |
| T057 | Rule with `set_expense_category` applied to incoming-only transaction | Expense NOT applied | `shouldUpdateExpense` checks `direction === 'out'`. Incoming transaction -> direction = 'in' -> expense skipped. | PASS | — |
| T058 | Rule with `set_expense_category` on non-`out` direction fails validation | Error returned | `createReceiptRule`: `if (parsed.data.set_expense_category && parsed.data.match_direction !== 'out') { return { error: ... } }` | PASS | — |
| T059 | Inactive rule not applied during retro-run | Inactive rule skipped | `supabase.from('receipt_rules').select('*').eq('is_active', true)`. Also filtered by `activeRules = ruleList.filter(r => r.is_active)`. | PASS | — |
| T060 | Rule toggled active triggers automation refresh for pending transactions | Pending transactions re-evaluated | `toggleReceiptRule` calls `refreshAutomationForPendingTransactions()` when `isActive = true`. Fetches up to 500 pending. | PASS | — |

---

## Category 4: Transaction Management (T061–T080)

| ID | Scenario | Expected | Actual (traced) | Status | Priority |
|----|----------|----------|-----------------|--------|----------|
| T061 | Set status to `pending` | Status updated, `receipt_required = true` | `markReceiptTransaction`: `receipt_required: validation.data.status === 'pending'`. Correct. | PASS | — |
| T062 | Set status to `completed` | Status updated, `receipt_required = false` | Same logic above. | PASS | — |
| T063 | Set status to `auto_completed` | Status updated | `receiptMarkSchema` must accept `auto_completed`. Schema sourced from `receiptTransactionStatusSchema`. | PASS | — |
| T064 | Set status to `no_receipt_required` | Status updated | Same. | PASS | — |
| T065 | Set status to `cant_find` | Status updated | Same. | PASS | — |
| T066 | Manual override of AI classification (vendor) | `vendor_source` set to `'manual'`; AI won't overwrite next run | `updateReceiptClassification` sets `vendor_source = 'manual'` when `vendorName` provided. AI check: `vendorLocked = vendor_source === 'manual'` -> will skip. | PASS | — |
| T067 | Manual override of rule classification (vendor) | `vendor_source` set to `'manual'`; rule won't overwrite unless `overrideManual = true` | Same as T066. Retro-run with `scope='pending'` uses `overrideManual = false`. Rule guard: `vendorLocked = !overrideManual && vendor_source === 'manual'`. | PASS | — |
| T068 | Bulk apply updates all transactions with matching `details` | All matching transactions updated | `applyReceiptGroupClassification`: `eq('details', parsed.data.details)` + `.in('status', statuses)`. | PASS | — |
| T069 | Bulk apply with expense: incoming-only transactions skipped | Expense not applied to incoming-only | `incomingOnlyIds` set computed; expense update uses `expenseEligibleIds` excluding incoming-only. | PASS | — |
| T070 | Bulk apply vendor and expense in same call | Both applied in two separate DB updates | Vendor update first (`allIds`), then expense update (`expenseEligibleIds`). Separate `supabase.update()` calls. | PASS | — |
| T071 | Update vendor name: `vendor_source` set to `'manual'` | Correct | `updateReceiptClassification`: `vendor_source = vendorName ? 'manual' : null`. | PASS | — |
| T072 | Clear vendor name (set to null) | `vendor_source` also cleared to null | Same: `vendor_source = vendorName ? 'manual' : null`. If `vendorName` null, source is null. | PASS | — |
| T073 | Update expense category: `expense_category_source` set to `'manual'` | Correct | `expense_category_source = expenseCategory ? 'manual' : null`. | PASS | — |
| T074 | Set expense category on incoming-only transaction | Blocked with error | `isIncomingOnlyTransaction(transaction)` check. Returns error. | PASS | — |
| T075 | Upload receipt file sets transaction status to `completed` | Status auto-set to `completed` | `uploadReceiptForTransaction` updates status to `'completed'` after successful storage + DB insert. | PASS | — |
| T076 | Transaction not found when marking status | Error returned | `markReceiptTransaction`: `.single()` fetch, `if (existingError || !existing) { return { error: 'Transaction not found' } }`. | PASS | — |
| T077 | Classification unchanged (same vendor, same expense submitted) | No DB update, no log written | `if (!vendorChanged && !expenseChanged) { return { success: true, transaction, ruleSuggestion: null } }`. | PASS | — |
| T078 | Bulk apply with no matching transactions | Returns `updated: 0` | `if (!matchRows.length) { return { success: true, updated: 0, skippedIncomingCount: 0 } }`. | PASS | — |
| T079 | Bulk apply: vendor update fails mid-operation | Error returned; expense update NOT attempted | `if (vendorUpdateError) { return { error: 'Failed to apply changes' } }` before expense block. Partial vendor update may have occurred if `.in('id', allIds)` partially applied. No rollback. | FAIL | HIGH |
| T080 | No `receipts/manage` permission on classification update | Error returned | `checkUserPermission('receipts', 'manage')` checked first in all mutation actions. | PASS | — |

---

## Category 5: Filtering and Search (T081–T100)

| ID | Scenario | Expected | Actual (traced) | Status | Priority |
|----|----------|----------|-----------------|--------|----------|
| T081 | Filter by status `pending` | Only pending transactions returned | `.eq('status', 'pending')`. | PASS | — |
| T082 | Filter by status `completed` | Only completed transactions returned | `.eq('status', 'completed')`. | PASS | — |
| T083 | Filter by status `auto_completed` | Only auto_completed returned | Same. | PASS | — |
| T084 | Filter by status `no_receipt_required` | Only no_receipt_required returned | Same. | PASS | — |
| T085 | Filter by status `cant_find` | Only cant_find returned | Same. | PASS | — |
| T086 | Filter by direction `in` | Only transactions with non-null `amount_in` | `.not('amount_in', 'is', null)`. Note: transactions with BOTH in and out would appear in both `in` and `out` filters. Correct per spec. | PASS | — |
| T087 | Filter by direction `out` | Only transactions with non-null `amount_out` | `.not('amount_out', 'is', null)`. | PASS | — |
| T088 | Filter by month | Only transactions within that calendar month | `resolveMonthRange` builds start/end ISO strings; `gte` + `lt` applied. | PASS | — |
| T089 | Search by `details` text | Matching transactions returned | `details.ilike.%term%`. Case-insensitive. | PASS | — |
| T090 | `showOnlyOutstanding` filter | Only `pending` transactions shown | `OUTSTANDING_STATUSES = ['pending']`. Applied only when no explicit `status` filter. | PASS | — |
| T091 | `showOnlyOutstanding` with explicit status filter | `showOnlyOutstanding` ignored (status filter takes precedence) | `if (filters.showOnlyOutstanding && !filters.status)` — correct conditional. | PASS | — |
| T092 | `missingVendorOnly` filter | Transactions with null or empty vendor shown | `.or('vendor_name.is.null,vendor_name.eq.')`. Covers null AND empty string. | PASS | — |
| T093 | `missingExpenseOnly` filter | Outgoing transactions with null expense shown | `.is('expense_category', null).not('amount_out', 'is', null)`. | PASS | — |
| T094 | Combined filters: status + direction + month | All three applied as ANDs | Filters applied sequentially to same `baseQuery`. All are AND conditions. | PASS | — |
| T095 | `showOnlyOutstanding = true` (default) | By default the page shows outstanding (pending) only | `page.tsx` line 45: `showOnlyOutstanding = outstandingParam === '0' ? false : true`. Default is `true` unless `?outstanding=0`. | PASS | — |
| T096 | Pagination: page 1, default page size | Returns first 25 transactions | `DEFAULT_PAGE_SIZE = 25`. `offset = (page - 1) * pageSize = 0`. Range `[0, 24]`. | PASS | — |
| T097 | Pagination: page 2 | Returns transactions 26-50 | `offset = (2 - 1) * 25 = 25`. Range `[25, 49]`. | PASS | — |
| T098 | Pagination when month filter is active | Full month returned (up to 5000 records), no pagination | `isMonthScoped = true` -> `page = 1`, `offset = 0`, `pageSize = MAX_MONTH_PAGE_SIZE (5000)`. | PASS | — |
| T099 | Sort by `amount_total` (default for all-time view) | Sorted by computed total amount descending | `sortColumn = 'amount_total'`; `nullsFirst: false` to push nulls last. Requires DB computed column. | PASS | — |
| T100 | Sort by `transaction_date`, `details`, `amount_in`, `amount_out` | Each column sortable | All in `SORT_COLUMNS` set. Mapped to Supabase `.order()`. | PASS | — |

---

## Category 6: File Attachments (T101–T110)

| ID | Scenario | Expected | Actual (traced) | Status | Priority |
|----|----------|----------|-----------------|--------|----------|
| T101 | Upload receipt file: stored and linked to correct transaction | File in storage, record in `receipt_files`, transaction status -> `completed` | `uploadReceiptForTransaction`: storage upload -> DB insert -> transaction update. All three steps. | PASS | — |
| T102 | Multiple files uploaded to one transaction | All files linked, status remains `completed` | Each upload creates a new `receipt_files` row. Transaction re-updated to `completed` each time. | PASS | — |
| T103 | File size at exactly 15 MB | Accepted | `receiptFileSchema`: `file.size <= MAX_RECEIPT_UPLOAD_SIZE`. Exact boundary accepted. | PASS | — |
| T104 | File size exceeds 15 MB | Rejected: "File is too large" | `receiptFileSchema` refine check. Error message: "File is too large. Please keep receipts under 15MB." | PASS | — |
| T105 | Empty file uploaded | Rejected: "File is empty" | `receiptFileSchema` refine: `file.size > 0`. | PASS | — |
| T106 | No file type restriction on receipts | Any file type accepted | `receiptFileSchema` only checks size, not MIME type or extension. Any file type can be uploaded. Business risk: executables, etc. | FAIL | MEDIUM |
| T107 | Storage upload succeeds, DB insert fails | Cleanup attempted: storage file removed; error returned | `uploadReceiptForTransaction` lines 1716-1725: cleanup called on `recordError`. Cleanup failure is noted in error message. | PASS | — |
| T108 | DB insert succeeds, transaction status update fails | Rollback: DB record deleted, storage file removed; error returned | Lines 1748-1766: rollback removes `receipt_files` record and storage file. Rollback failure flagged in error message. | PASS | — |
| T109 | Delete receipt file: both storage and DB record removed | File removed from storage AND `receipt_files` table | `deleteReceiptFile`: DB delete first, then storage remove. If storage remove fails, DB record re-inserted (rollback). | PASS | — |
| T110 | Delete last receipt file: transaction reverted to `pending` | Transaction status reset to `pending` | After delete, checks remaining files. If none left, updates transaction to `pending` with `receipt_required = true`. | PASS | — |

---

## Category 7: Exports (T111–T120)

| ID | Scenario | Expected | Actual (traced) | Status | Priority |
|----|----------|----------|-----------------|--------|----------|
| T111 | CSV export contains all required columns | Date, Details, Transaction type, Vendor, Vendor source, Expense category, Expense category source, AI confidence, Amount in, Amount out, Status, Notes | `buildSummaryCsv` defines `headerRow` with all 12 columns. All present. | PASS | — |
| T112 | Vendor source shown as human-readable label | "AI", "Manual", "Rule", "Import" | `friendlySource()` maps `ai -> 'AI'`, `manual -> 'Manual'`, `rule -> 'Rule'`, `import -> 'Import'`. | PASS | — |
| T113 | AI confidence column present and populated | Numeric string or empty | `tx.ai_confidence != null ? String(tx.ai_confidence) : ''`. | PASS | — |
| T114 | Export permission enforced | `receipts/export` required | `checkUserPermission('receipts', 'export')` at start of `GET` handler. 403 returned if missing. | PASS | — |
| T115 | Export is per-quarter, not per current filter state | Quarter + year parameters | `receiptQuarterExportSchema` validates `year` and `quarter`. Date range derived via `deriveQuarterRange`. | PASS | — |
| T116 | Export does NOT respect current workspace filters | Quarter range is the only filter applied | Export route fetches all transactions in quarter regardless of status, direction, search. By design. | PASS | — |
| T117 | Export with no transactions in quarter | ZIP contains summary CSV + README.txt placeholder | `if (!rows.length)` -> `archive.append(placeholder, { name: 'README.txt' })`. | PASS | — |
| T118 | Export includes actual receipt files (zip download) | Receipt files included in zip archive | `downloadTasks` built from `transaction.receipt_files`. Run with concurrency 4. Files appended to archive. | PASS | — |
| T119 | Storage download failure for one receipt file | Warning logged; export continues without that file | `if (download.error || !download.data) { console.warn(...); return }`. Archive is not failed. | PASS | — |
| T120 | P&L export: totals match displayed figures | `Total in` and `Total out` sums correct | `totalAmount` sums `amount_in`/`amount_out` across all rows. Summary rows included before transaction rows in CSV. | PASS | — |

---

## Category 8: Permissions (T121–T130)

| ID | Scenario | Expected | Actual (traced) | Status | Priority |
|----|----------|----------|-----------------|--------|----------|
| T121 | User without `receipts/view` visits receipts page | Redirected to `/unauthorized` | `page.tsx`: `if (!canView) { redirect('/unauthorized') }`. | PASS | — |
| T122 | User without `receipts/export` visits receipts page | Page loads; export button hidden | `canExport` passed as prop to `ReceiptsClient`. Export UI conditionally rendered. | PASS | — |
| T123 | User without `receipts/export` calls export API directly | 403 returned | `checkUserPermission('receipts', 'export')` in `GET` handler. | PASS | — |
| T124 | User without `receipts/manage` calls `markReceiptTransaction` | Error: "Insufficient permissions" | `checkUserPermission('receipts', 'manage')` at top of action. | PASS | — |
| T125 | User without `receipts/manage` calls `updateReceiptClassification` | Error returned | Same. | PASS | — |
| T126 | User without `receipts/manage` calls `importReceiptStatement` | Error returned | Same. | PASS | — |
| T127 | User without `receipts/manage` calls `createReceiptRule` | Error returned | Same. | PASS | — |
| T128 | User without `receipts/manage` calls `deleteReceiptFile` | Error returned | Same. | PASS | — |
| T129 | `receipts/view` user can call read-only actions | `getReceiptWorkspaceData`, `getReceiptSignedUrl`, etc. succeed | These check `view` permission. Correct separation. | PASS | — |
| T130 | `receipts/manage` check is server-side (not UI-only) | Server action enforces permission independently | All mutations call `checkUserPermission` before any data operation. | PASS | — |

---

## Category 9: Partial Failure Paths (T131–T150)

| ID | Scenario | Expected | Actual (traced) | Status | Priority |
|----|----------|----------|-----------------|--------|----------|
| T131 | CSV import: batch record inserted, transaction upsert fails | Expected: batch rolled back or clearly flagged as empty. Actual: batch exists in DB with 0 transactions, no rollback. | Batch record is orphaned. No compensating delete. Audit log is not written (it comes after insert check). `insertedIds` is empty, so AI jobs and logs are skipped. Orphaned batch record remains. | FAIL | HIGH |
| T132 | AI job: OpenAI success, DB update fails for one transaction | Usage recorded; that transaction remains unclassified; other transactions updated | `recordAIUsage` is called before the per-transaction loop. If individual DB update fails, `console.error` + `continue`. No partial-failure log for that specific transaction. | FAIL | MEDIUM |
| T133 | Retro-run: 500 transactions to update, step-level DB failure at transaction #250 | Transactions 1-249 already updated; 251-500 not processed | `applyAutomationRules` processes transactions in a `for` loop with individual `.update()` calls. Failure for one transaction logs + `continue`. Transactions processed before the failure ARE committed. No rollback. Progress is permanently partial. | FAIL | HIGH |
| T134 | Bulk apply: vendor update succeeds, expense update fails | Expected: rollback or clearly partial. Actual: vendor updates committed, expense updates not applied. | No transaction wrapper. Vendor `update().in('id', allIds)` committed. If expense `update()` then fails, vendor changes persist with no expense. Error returned to caller but vendor changes are durable. | FAIL | HIGH |
| T135 | File upload: storage success, DB insert fails, cleanup storage call also fails | Orphaned file in storage | `uploadReceiptForTransaction` attempts `supabase.storage.from(RECEIPT_BUCKET).remove([storagePath])` on `recordError`. If cleanup fails, error message says "Uploaded file cleanup requires manual reconciliation." Orphan persists. | FAIL | MEDIUM |
| T136 | File delete: DB record deleted, storage remove fails, DB rollback insert fails | Both storage file AND DB record lost | `deleteReceiptFile`: if storage remove fails, attempts to re-insert DB record. If re-insert fails, `console.error` but no further recovery. File is orphaned in storage; DB record is gone. | FAIL | HIGH |
| T137 | retro-run `runReceiptRuleRetroactively`: time budget (12s) exceeded mid-run | Partial result returned with `done: false`, `nextOffset` provided | `if (Date.now() - start > timeBudgetMs)` -> returns partial result. Client (useRetroRuleRunner hook) is responsible for continuing. `finalizeReceiptRuleRetroRun` NOT called if time budget hit. | FAIL | MEDIUM |
| T138 | AI classification job: OpenAI succeeds, log insert (`receipt_transaction_logs`) fails | Classification persisted to DB; log entry missing | After `classifyReceiptTransactionsBatch`, individual transaction DB updates succeed, then `client.from('receipt_transaction_logs').insert(logs)` called. No error handling on log insert failure. Error silently lost. | FAIL | LOW |
| T139 | `deleteReceiptFile`: remaining-files check fails after delete | Error returned with inconsistent state (file deleted, status not reset) | `if (remainingError) { console.error(...); return { error: '...' } }`. Transaction status not reset despite file deletion. Transaction stuck in `completed` with no files. | FAIL | HIGH |
| T140 | `markReceiptTransaction`: transaction-log insert fails after status update | Status updated; log entry missing | `supabase.from('receipt_transaction_logs').insert(...)` called after successful update. No error check on log insert result. Error silently lost. | FAIL | LOW |
| T141 | `refreshAutomationForPendingTransactions` called on rule toggle: DB fetch fails | Silent failure; pending transactions not re-evaluated | `const { data } = await supabase.from(...)`. Error is destructured but not checked. `ids = data?.map(...) ?? []`. If fetch fails, `data` is undefined, `ids` is empty, function returns silently. | FAIL | LOW |
| T142 | Import: `applyAutomationRules` throws unexpectedly | Import function crashes; batch and transactions are committed but no automation applied | `applyAutomationRules` is called without try/catch in `importReceiptStatement`. An unexpected exception would propagate and cause a 500 error, even though batch + transactions were already written. | FAIL | MEDIUM |
| T143 | Import: `enqueueReceiptAiClassificationJobs` throws (caught by outer try/catch) | Error logged; import still succeeds | `try { ... } catch (error) { console.error(...) }` wraps the queue call. Import returns success even if AI jobs not queued. | PASS | — |
| T144 | Bulk classification: both vendor and expense updates succeed, log insert fails | Updates committed, log missing | `await supabase.from('receipt_transaction_logs').insert(logs)` — `logError` is checked and logged but not returned as error. Silent. | FAIL | LOW |
| T145 | Batch AI classification: `usage` is undefined (API returned no usage metadata) | `recordAIUsage` called with `undefined` usage | `recordAIUsage` checks `if (!usage) return` at top. No-op. Classification results still processed. | PASS | — |

---

## Test Summary by Category

| Category | Total | Pass | Fail |
|----------|-------|------|------|
| 1. CSV Import | 20 | 17 | 3 |
| 2. AI Classification | 20 | 19 | 1 |
| 3. Rule System | 20 | 18 | 2 |
| 4. Transaction Management | 20 | 18 | 2 |
| 5. Filtering and Search | 20 | 20 | 0 |
| 6. File Attachments | 10 | 9 | 1 |
| 7. Exports | 10 | 10 | 0 |
| 8. Permissions | 10 | 10 | 0 |
| 9. Partial Failure Paths | 15 | 3 | 12 |
| **Total** | **145** | **124** | **21** |
