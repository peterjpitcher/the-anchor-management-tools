# Receipts Module — QA Specialist Report
## Phase 1 | Static Code Trace
**Date:** 2026-03-07
**Method:** Full static trace of all business logic paths. No live execution.
**Scope:** CSV import, AI classification, rule system, transaction management, filtering, file attachments, exports, permissions, partial failure paths.

---

## Executive Summary

| Metric | Count |
|--------|-------|
| Total tests | 145 |
| Pass | 124 |
| Fail | 21 |
| Pass rate | 85.5% |

| Severity | Count |
|----------|-------|
| HIGH | 8 |
| MEDIUM | 7 |
| LOW | 6 |

The core happy paths are well-implemented. Permissions, filtering, sorting, rule matching logic, AI classification flow, and export structure all pass. The module's primary weakness is **partial failure handling**: nearly every multi-step mutation (import, upload, delete, bulk apply, retro-run) has at least one state where a failure mid-sequence leaves the database in an inconsistent or unrecoverable condition without alerting the operator. This is the highest-priority area for remediation.

---

## Defect Log

### DEF-QA-001
**ID:** DEF-QA-001
**Severity:** HIGH
**Test:** T004 — CSV import: no file size limit enforced on CSV uploads
**Summary:** The `fileSchema` used for CSV bank statement imports does not check file size. Only the `receiptFileSchema` (used for receipt attachments) enforces the 15 MB limit. A user can upload an arbitrarily large CSV.

**Expected:** CSV files over 15 MB rejected with an appropriate error message, consistent with the documented 15 MB limit.

**Actual:** `fileSchema` (lines 369–373) only checks `file.size > 0` (non-empty) and MIME type/extension. No upper bound. A 500 MB CSV would be accepted and passed to `Buffer.from(await receiptFile.arrayBuffer())` and `Papa.parse`, potentially causing memory exhaustion or a timeout.

**Business Impact:** A malformed or very large CSV could cause server-side OOM errors, affecting all users on the deployment until the request times out.

**Root Cause:** Two separate schemas defined (`fileSchema` for CSV, `receiptFileSchema` for receipts). The size limit was added to `receiptFileSchema` but not to `fileSchema`.

**Affected File:** `src/app/actions/receipts.ts` — `fileSchema` (line 369).

---

### DEF-QA-002
**ID:** DEF-QA-002
**Severity:** HIGH
**Test:** T018, T131 — CSV import: orphaned batch record on transaction insert failure
**Summary:** When `importReceiptStatement` inserts the batch record into `receipt_batches` and then the transaction upsert fails, the batch record is left in the database with no associated transactions and no rollback.

**Expected:** If transactions cannot be inserted, the batch record should either be deleted (compensating transaction) or clearly marked as failed so operators can distinguish successful imports from failed ones.

**Actual:** Code flow (lines 1282–1334):
1. Batch inserted into `receipt_batches` (line 1282).
2. If `batchError` -> return error (batch not yet created, safe).
3. Transactions upserted (line 1322).
4. If `insertError` -> `return { error: '...' }` — **batch record already exists with no children**.

The audit log (`logAuditEvent`) is not reached. The orphaned batch record will appear in the "Last import" summary widget with `row_count > 0` but zero actual transactions.

**Business Impact:** Staff sees a "last import" that appears successful but has no data. They may not re-import, leading to missing transaction history.

**Root Cause:** No compensating delete or status field on `receipt_batches` to indicate failure. No database transaction (Supabase/PostgreSQL transactions are not used here).

**Affected File:** `src/app/actions/receipts.ts` — `importReceiptStatement` (lines 1282–1334).

---

### DEF-QA-003
**ID:** DEF-QA-003
**Severity:** HIGH
**Test:** T079 — Bulk apply: vendor update committed before expense update; no rollback on expense failure
**Summary:** `applyReceiptGroupClassification` performs vendor and expense updates as two separate database calls with no wrapping transaction. If vendor succeeds and expense fails, vendor changes are permanently committed.

**Expected:** Either both vendor and expense updates succeed, or neither is applied (atomicity). Caller receives a clear error in either case.

**Actual:** Lines 2503–2548:
- Vendor update: `supabase.from('receipt_transactions').update(vendorPayload).in('id', allIds)` — committed.
- On `vendorUpdateError` -> return error (correct, expense never attempted).
- If vendor succeeds, expense attempted: `supabase.from('receipt_transactions').update(expensePayload).in('id', expenseEligibleIds)`.
- On `expenseUpdateError` -> return error — **but vendor is already committed**.

A user who requested both vendor and expense bulk-apply will receive an error but the vendor will be updated. Re-running will re-apply expense (which is idempotent), but the user experience is incorrect and potentially confusing.

**Business Impact:** Partial classification state; misleading error messaging. Low data corruption risk but high UX confusion risk.

**Root Cause:** No database transaction wrapping the two-step update. Supabase JS client does not natively support transactions without RPC.

**Affected File:** `src/app/actions/receipts.ts` — `applyReceiptGroupClassification` (lines 2503–2548).

---

### DEF-QA-004
**ID:** DEF-QA-004
**Severity:** HIGH
**Test:** T133 — Retro-run: permanently partial updates on step-level failure
**Summary:** `applyAutomationRules` processes each transaction individually with a loop and individual `.update()` calls. If a database error occurs for transaction #N, transactions 1 through N-1 are already committed. There is no rollback, no resumption tracking, and the function returns a partial `AutomationResult` with no indication of which transactions were updated.

**Expected:** Either all transactions in the retro batch succeed or the caller is informed of exactly which were updated so the run can be resumed or reversed.

**Actual:** Lines 778–947: `for (const transaction of transactions)` loop; each iteration calls `supabase.from('receipt_transactions').update(...)`. On error: `console.warn(...); continue`. The returned totals (`statusAutoUpdated`, `classificationUpdated`) reflect only the successfully processed transactions, but there is no list of failed transaction IDs.

**Business Impact:** A partial retro-run leaves some transactions classified by the rule and others not. The next retro-run would re-process unclassified transactions, but already-classified ones may be skipped (idempotency logic prevents re-application if already matching). This can produce inconsistent classification states across transactions with identical bank descriptions.

**Root Cause:** Individual per-transaction DB updates in a loop with no batch operation or transaction wrapper.

**Affected File:** `src/app/actions/receipts.ts` — `applyAutomationRules` (lines 778–947).

---

### DEF-QA-005
**ID:** DEF-QA-005
**Severity:** HIGH
**Test:** T136 — File delete: DB delete + storage remove + DB rollback can all fail, leaving inconsistent state
**Summary:** `deleteReceiptFile` deletes the `receipt_files` DB record first, then attempts to remove the file from storage. If storage removal fails, it attempts to re-insert the DB record as a rollback. If that re-insert also fails, both the DB record and the storage file are in an unknown state.

**Expected:** A clear, auditable failure state. Operator can determine whether the file exists in storage and/or DB.

**Actual:** Lines 1830–1855:
1. `supabase.from('receipt_files').delete().eq('id', fileId)` — DB record deleted.
2. `supabase.storage.from(RECEIPT_BUCKET).remove([receipt.storage_path])` — if fails:
3. `supabase.from('receipt_files').insert({ id: receipt.id, ... })` — rollback re-insert.
4. If re-insert also fails: `console.error(...)` — no further recovery.

After this failure, the DB record does not exist but the storage file does (orphaned storage file). The error message returned is "Failed to remove stored receipt file." — does not mention the orphan.

**Business Impact:** Orphaned storage files incur cost and cannot be cleaned up without manual intervention. Operators have no audit trail pointing to the orphaned file.

**Root Cause:** Delete-then-cleanup ordering with inadequate rollback. Storage and DB are not atomically linked.

**Affected File:** `src/app/actions/receipts.ts` — `deleteReceiptFile` (lines 1830–1855).

---

### DEF-QA-006
**ID:** DEF-QA-006
**Severity:** HIGH
**Test:** T139 — Delete file: remaining-files check fails; transaction stuck in `completed` with no files
**Summary:** After successfully deleting the receipt file from DB and storage, `deleteReceiptFile` checks for remaining files. If this check itself fails, the function returns an error but does NOT reset the transaction status. The transaction remains in `completed` state with zero receipt files attached.

**Expected:** If the remaining-files check fails, either retry or reset the transaction to `pending` conservatively.

**Actual:** Lines 1876–1884:
```
if (remainingError) {
  console.error('Failed to check for remaining receipts:', remainingError)
  return { error: 'Receipt was removed, but failed to verify remaining receipt files.' }
}
```
File is deleted from both storage and DB at this point. Transaction status not updated. No status reset.

**Business Impact:** A transaction in `completed` state with zero receipts will appear in the completed list but has no supporting document. It will pass export without a receipt attached. This creates an audit compliance risk.

**Root Cause:** Missing fallback: on query failure, should conservatively revert transaction to `pending`.

**Affected File:** `src/app/actions/receipts.ts` — `deleteReceiptFile` (lines 1876–1884).

---

### DEF-QA-007
**ID:** DEF-QA-007
**Severity:** HIGH
**Test:** T142 — Import: `applyAutomationRules` not wrapped in try/catch
**Summary:** In `importReceiptStatement`, the call to `applyAutomationRules(insertedIds)` at line 1337 is not wrapped in a try/catch. An unexpected exception from that function (e.g., a database connection error) would propagate, causing the server action to throw. At this point, the batch record AND transactions are already committed.

**Expected:** Automation errors during import should be non-fatal. Import should succeed and return a result indicating automation was skipped.

**Actual:** Line 1337: `const { statusAutoUpdated, classificationUpdated } = await applyAutomationRules(insertedIds)` — no try/catch. Contrast with AI job enqueueing at line 1343, which IS wrapped in try/catch.

**Business Impact:** If automation throws during import, the caller receives a 500 error. The user believes the import failed and may retry, creating duplicate data attempts. The actual batch + transactions are in the database.

**Root Cause:** Inconsistent error handling: AI job enqueueing is guarded; automation application is not.

**Affected File:** `src/app/actions/receipts.ts` — `importReceiptStatement` (line 1337).

---

### DEF-QA-008
**ID:** DEF-QA-008
**Severity:** MEDIUM
**Test:** T012 — Negative `Out` amount not rejected
**Summary:** `parseCurrency` accepts negative numbers. A bank export with a negative `Out` amount (e.g., a credit reversal shown as `-50.00` in the Out column) would be stored as a negative `amount_out`. The direction detection logic (`getTransactionDirection`) returns `'out'` for any transaction where `amount_in` is not positive, regardless of sign of `amount_out`. This negative amount would then be treated as an outgoing transaction with a negative value, potentially distorting P&L figures.

**Expected:** Negative amounts should either be rejected, treated as their absolute value, or interpreted as the opposite direction.

**Actual:** `parseCurrency` (line 514): `Number.parseFloat(cleaned)` — accepts negatives. No guard.

**Business Impact:** Negative expense amounts in P&L exports. Incorrect totals in the monthly summary and vendor trends.

**Root Cause:** No validation of sign at parse time or at insert.

**Affected File:** `src/app/actions/receipts.ts` — `parseCurrency` (line 514), `parseCsv` (lines 462–488).

---

### DEF-QA-009
**ID:** DEF-QA-009
**Severity:** MEDIUM
**Test:** T024 — AI batch: individual transaction missing from result map generates no failure log
**Summary:** When `classifyReceiptTransactionsBatch` returns successfully but a specific transaction's result is absent from the result map (e.g., the API truncated the response), the code silently continues with `if (!classificationResult) { continue }` — no `ai_classification_failed` log is written for that transaction.

**Expected:** A failure log should be written for any transaction that was submitted for classification but received no result.

**Actual:** `ai-classification.ts` lines 242–244: `if (!classificationResult) { continue }`. No log. Contrast with the complete batch failure path (line 213), which does write failure logs.

**Business Impact:** Silently unclassified transactions with no audit trail. Operators cannot distinguish "not yet classified" from "classification was attempted and failed". Re-queuing logic targets `vendor_name IS NULL AND vendor_source IS NULL`, so these transactions WOULD be re-queued — but the missing log obscures what happened.

**Root Cause:** Incomplete parity between whole-batch failure logging and per-transaction failure logging.

**Affected File:** `src/lib/receipts/ai-classification.ts` — `classifyReceiptTransactionsWithAI` (lines 242–244).

---

### DEF-QA-010
**ID:** DEF-QA-010
**Severity:** MEDIUM
**Test:** T049 — Rule `matchDescription` uses OR logic across comma-separated keywords; AND may be expected
**Summary:** The `match_description` field accepts a comma-separated list of keywords. The rule system treats these as OR conditions: any single keyword matching the transaction details is sufficient to match. Rule authors may reasonably expect AND semantics (all keywords must appear).

**Expected (by rule author):** A rule with `match_description = "paypal,transfer"` would match only transactions containing both "paypal" AND "transfer".

**Actual:** `getRuleMatch` lines 88–108: loops over needles, any match increments `matchedNeedleLength`. OR logic. The UI chip preview in `ReceiptRules.tsx` renders each token separately with no indication that they are OR conditions.

**Business Impact:** Rules match more transactions than intended. A rule meant to catch "PAYPAL TRANSFER" could accidentally match any transaction mentioning either "paypal" or "transfer" separately.

**Root Cause:** Design decision not communicated to users. No documentation in UI, no warning in rule preview.

**Affected File:** `src/lib/receipts/rule-matching.ts` — `getRuleMatch` (lines 88–108). `src/app/(authenticated)/receipts/_components/ui/ReceiptRules.tsx` — `MatchDescriptionTokenPreview`.

---

### DEF-QA-011
**ID:** DEF-QA-011
**Severity:** MEDIUM
**Test:** T106 — No file type restriction on receipt attachments
**Summary:** `receiptFileSchema` validates file size and non-empty, but does not restrict MIME type or file extension. Any file type can be uploaded as a receipt.

**Expected:** At minimum, restrict to common document/image types: PDF, PNG, JPG, JPEG, GIF, WEBP, HEIC.

**Actual:** `receiptFileSchema` (lines 375–380): only `file.size > 0` and `file.size <= MAX_RECEIPT_UPLOAD_SIZE`. No type check.

**Business Impact:** Executables, scripts, or other arbitrary files can be stored in the receipts bucket. Low direct security risk (files are stored in Supabase Storage with signed URLs), but increases storage abuse surface and violates least-privilege.

**Root Cause:** Omission in schema definition.

**Affected File:** `src/app/actions/receipts.ts` — `receiptFileSchema` (lines 375–380).

---

### DEF-QA-012
**ID:** DEF-QA-012
**Severity:** MEDIUM
**Test:** T137 — Retro-run time budget exceeded: `finalizeReceiptRuleRetroRun` not called
**Summary:** `runReceiptRuleRetroactively` has a 12-second time budget. When exceeded, it returns a partial result (`done: false`) without calling `finalizeReceiptRuleRetroRun`. This means no audit log is written for the partial run, and `revalidatePath` calls do not fire.

**Expected:** Even on time-budget exit, an audit log should be written indicating a partial run completed, and cache should be revalidated.

**Actual:** Lines 2808–2831: time-budget branch returns directly without `finalizeReceiptRuleRetroRun`. The audit log and `revalidatePath` calls inside `finalizeReceiptRuleRetroRun` are skipped.

**Business Impact:** Cache may show stale data after a partial retro-run. No audit record of the partial run. Operator has no way to know a retro-run was partially executed.

**Root Cause:** `finalizeReceiptRuleRetroRun` only called on `step.done === true`, not on time-budget exit.

**Affected File:** `src/app/actions/receipts.ts` — `runReceiptRuleRetroactively` (lines 2808–2831).

---

### DEF-QA-013
**ID:** DEF-QA-013
**Severity:** MEDIUM
**Test:** T132 — AI classification: per-transaction DB failure generates no failure log entry
**Summary:** When `classifyReceiptTransactionsWithAI` successfully calls OpenAI but a DB update fails for a specific transaction, the code logs to `console.error` and `continue`s. No `ai_classification_failed` log entry is written to `receipt_transaction_logs` for that transaction.

**Expected:** A `ai_classification_failed` log entry should be written for any transaction where classification was attempted but DB persistence failed.

**Actual:** `ai-classification.ts` lines 287–294: `if (updateError) { console.error(...); continue }`. No log insert.

**Business Impact:** Silently lost classification. Transaction appears unclassified with no indication of attempted classification. Re-queue will retry, which is idempotent, but the missing log obscures the failure history.

**Root Cause:** Same gap as DEF-QA-009 — failure logging only covers the full-batch failure path, not per-record persistence failures.

**Affected File:** `src/lib/receipts/ai-classification.ts` — `classifyReceiptTransactionsWithAI` (lines 287–294).

---

### DEF-QA-014
**ID:** DEF-QA-014
**Severity:** MEDIUM
**Test:** T142 — `applyAutomationRules` called without try/catch in `importReceiptStatement`
**Summary:** (See DEF-QA-007 for full detail — this entry covers the medium-severity cascading aspect.)
If `applyAutomationRules` throws, the caller sees a 500 error despite the import being committed. The user cannot distinguish "import failed" from "import succeeded but automation failed".

**Affected File:** `src/app/actions/receipts.ts` — line 1337.

---

### DEF-QA-015
**ID:** DEF-QA-015
**Severity:** LOW
**Test:** T048 — Rule preview limited to first 2000 transactions; not random or representative
**Summary:** `previewReceiptRule` fetches up to 2000 transactions with `.limit(2000)` but no ordering guarantee (beyond Supabase's default). For datasets with >2000 transactions, the preview will undercount matches from newer transactions. The UI labels this "sample of up to 2000 transactions", which is informative, but the default ordering (likely insert order) may make the sample unrepresentative.

**Expected:** Preview should use a representative sample (e.g., most recent 2000 by date) or clearly state the limitation.

**Actual:** `.limit(2000)` with no `.order()`. Default ordering by primary key / insert order.

**Business Impact:** Preview undercounts matches for rules targeting recent transaction patterns.

**Affected File:** `src/app/actions/receipts.ts` — `previewReceiptRule` (line 3307).

---

### DEF-QA-016
**ID:** DEF-QA-016
**Severity:** LOW
**Test:** T138 — AI classification: log insert failure is silently lost
**Summary:** After successfully updating transaction DB records in the AI classification path, `receipt_transaction_logs` insert is called without error handling. If the insert fails, logs are lost with no notification.

**Expected:** Log insert failure should at minimum emit a `console.error`.

**Actual:** `ai-classification.ts` lines 313–315: `await client.from('receipt_transaction_logs').insert(logs)` — no `const { error }` capture, no error handling.

**Affected File:** `src/lib/receipts/ai-classification.ts` — lines 313–315.

---

### DEF-QA-017
**ID:** DEF-QA-017
**Severity:** LOW
**Test:** T140 — `markReceiptTransaction`: transaction-log insert failure silently lost
**Summary:** `markReceiptTransaction` calls `supabase.from('receipt_transaction_logs').insert(...)` but does not capture or check the error. A log insertion failure is silently swallowed.

**Expected:** Log failure should be captured and at minimum logged to `console.error`.

**Actual:** `receipts.ts` line 1470: `await supabase.from('receipt_transaction_logs').insert({...})` — no `const { error }` capture.

**Affected File:** `src/app/actions/receipts.ts` — `markReceiptTransaction` (line 1470).

---

### DEF-QA-018
**ID:** DEF-QA-018
**Severity:** LOW
**Test:** T141 — `refreshAutomationForPendingTransactions`: DB query failure silently ignored
**Summary:** `refreshAutomationForPendingTransactions` queries for pending transaction IDs. The `error` from the Supabase query is not destructured. If the query fails, `data` is `undefined`, `ids` is `[]`, and the function returns silently with no log.

**Expected:** Query failure should be logged.

**Actual:** `receipts.ts` line 2724: `const { data } = await supabase.from('receipt_transactions').select('id').eq(...)` — `error` is not captured.

**Affected File:** `src/app/actions/receipts.ts` — `refreshAutomationForPendingTransactions` (line 2724).

---

### DEF-QA-019
**ID:** DEF-QA-019
**Severity:** LOW
**Test:** T144 — Bulk classification: log insert failure silently swallowed
**Summary:** `applyReceiptGroupClassification` calls `supabase.from('receipt_transaction_logs').insert(logs)` and captures `logError`, but only logs it with `console.error`. The error is not returned to the caller, meaning the operation appears successful even if logging failed. This is low severity as the classification itself succeeded, but the audit trail is incomplete.

**Expected:** Same as DEF-QA-017.

**Actual:** `receipts.ts` lines 2580–2583: `const { error: logError } = ...; if (logError) { console.error(...) }`. Classification returns success regardless.

**Affected File:** `src/app/actions/receipts.ts` — `applyReceiptGroupClassification` (lines 2580–2583).

---

### DEF-QA-020
**ID:** DEF-QA-020
**Severity:** LOW
**Test:** T135 — File upload: orphaned storage file on DB-insert failure + cleanup failure
**Summary:** When receipt file storage upload succeeds but DB insert fails, cleanup is attempted. If cleanup also fails, the error message informs the caller: "Uploaded file cleanup requires manual reconciliation." However, no structured log entry, alert, or record is written that would allow operators to locate and clean up the orphaned file.

**Expected:** Write a structured log (e.g., to an `orphaned_storage_files` table or a `storage_cleanup_required` audit event) including `storagePath`.

**Actual:** `console.error('Failed to cleanup receipt storage after metadata insert error:', cleanupStorageError)` only. No persistent record.

**Affected File:** `src/app/actions/receipts.ts` — `uploadReceiptForTransaction` (lines 1719–1722).

---

### DEF-QA-021
**ID:** DEF-QA-021
**Severity:** LOW
**Test:** T136 — Orphaned storage file on double-failure in `deleteReceiptFile`
**Summary:** Companion to DEF-QA-005. If DB delete succeeds, storage remove fails, AND the DB re-insert rollback also fails, there is no structured record of the orphaned storage file.

**Expected:** Write an audit event or log entry identifying the orphaned `storage_path`.

**Actual:** `console.error('Failed to rollback receipt file record after storage delete failure:', rollbackError)` only.

**Affected File:** `src/app/actions/receipts.ts` — `deleteReceiptFile` (lines 1851–1853).

---

## Partial Failure Analysis (Highest Priority)

This section aggregates all partial-failure defects. These represent the most operationally risky class of bugs — they leave the database in states that are hard or impossible to automatically recover from.

### Failure Mode Matrix

| Operation | Step 1 | Step 2 | Step 3 | Failure Point | State After Failure | Recoverable? |
|-----------|--------|--------|--------|---------------|---------------------|--------------|
| CSV Import | Insert batch | Insert transactions | Apply rules | After Step 1, before Step 2 | Orphaned batch, 0 transactions | Manual batch delete |
| CSV Import | Insert batch | Insert transactions | Apply rules | After Step 2, inside Step 3 | Batch + transactions exist; automation partially applied | Re-run retro rule |
| File Upload | Storage upload | DB insert | Update tx status | After Step 1, Step 2 fails, cleanup also fails | Orphaned storage file | Manual storage cleanup |
| File Upload | Storage upload | DB insert | Update tx status | After Step 2, Step 3 fails, rollback fails | DB record exists, storage file exists, tx still old status | Manual DB delete + retry |
| File Delete | DB delete | Storage remove | Reset tx status | After Step 1, Step 2 fails, rollback fails | No DB record, storage file exists | Manual storage cleanup |
| File Delete | DB delete | Storage remove | Remaining check | After Step 2 succeeds, Step 3 fails | File deleted, tx stuck in `completed` with 0 files | Manual tx status reset |
| Bulk Apply | Vendor update | Expense update | Log insert | After Step 1, before Step 2 | Vendor applied, expense not | Re-run (idempotent) |
| Retro-run | Process chunk N | Time budget | Finalize | Time budget exceeded | Chunks 1..N committed, no audit log | Re-run (idempotent) |

### Recommended Remediation Priority Order

1. **DEF-QA-006** (T139): File delete leaves completed transaction with zero files. Compliance risk. Add conservative status reset on remaining-files query failure.
2. **DEF-QA-002** (T018/T131): Orphaned batch record on transaction insert failure. Add compensating delete or `status` field on batch.
3. **DEF-QA-001** (T004): No size limit on CSV uploads. Add `file.size <= MAX_RECEIPT_UPLOAD_SIZE` to `fileSchema`.
4. **DEF-QA-007** (T142): `applyAutomationRules` not wrapped in try/catch inside `importReceiptStatement`. Wrap it.
5. **DEF-QA-005** (T136): Orphaned storage file on double-failure in delete. Add structured audit record.
6. **DEF-QA-003** (T079): Bulk apply partial commit. Consider RPC for atomic update or accept partial with clear messaging.
7. **DEF-QA-004** (T133): Retro-run partial commit. Inherent to per-record loop; document and add restart-from-offset UI.
8. **DEF-QA-012** (T137): Time-budget exit skips finalize. Call finalize (or a partial-finalize) on budget exit.
9. **DEF-QA-009** (T024): Missing per-transaction failure log in AI batch. Add failure log on missing result.
10. **DEF-QA-013** (T132): Missing per-transaction failure log on DB update error in AI classification. Add failure log.
11. **DEF-QA-010** (T049): OR semantics for comma-separated keywords not communicated in UI. Add tooltip/label.
12. **DEF-QA-011** (T106): No file type restriction on receipt uploads. Add MIME type/extension allow-list.
13. **DEF-QA-008** (T012): Negative amounts not rejected. Add sign validation in `parseCurrency` or `parseCsv`.
14. **DEF-QA-014** (T142): Duplicate of DEF-QA-007 (medium aspect). Resolved by same fix.
15. **DEF-QA-015 through DEF-QA-021**: Low severity logging/observability gaps. Address as a single sweep.

---

## Coverage Gaps

The following areas were not fully testable through static trace and require runtime or integration testing:

1. **Supabase RLS enforcement on `receipt_transactions`**: All server-side actions use the admin client (service role), which bypasses RLS. RLS correctness for user-scoped access cannot be verified from this code review — requires database schema inspection.

2. **`amount_total` computed column**: Sort by `amount_total` is used in queries but this is a DB-level computed column. Its definition was not verified in this review. If it is missing or incorrectly defined, sorting will silently fall back to default order.

3. **`get_receipt_detail_groups` RPC correctness**: The bulk review page relies on this RPC for grouping. The RPC's SQL was not reviewed. `fuzzy_grouping` logic is entirely in the DB.

4. **Job queue (`jobQueue.enqueue`)**: AI classification jobs are enqueued via `jobQueue`. The job processor and retry logic were not reviewed. It is unknown whether failed jobs are retried, how many times, and whether failures are surfaced.

5. **`count_receipt_statuses` RPC**: The summary widget counts are derived from this RPC. Its correctness was not verified.

6. **`getReceiptSignedUrl` signed URL expiry**: URLs are valid for 5 minutes (`60 * 5`). If the user's browser tab is open for longer, clicking a receipt link will produce a 403. No expiry warning in UI.

7. **Concurrent imports**: No idempotency guard at the batch level. Two simultaneous imports of the same CSV would both insert batch records; only the upsert dedupe on `dedupe_hash` prevents duplicate transactions. Two orphaned batches (if one fails) or two legitimate batch records (if both succeed) could confuse the "last import" summary.

---

## Patterns Observed

**Positive patterns:**
- Permission checks consistently placed at the top of every server action before any data access.
- Audit logging (`logAuditEvent`) present on all significant mutations.
- Direction-specific guards prevent expense categories being applied to incoming transactions.
- AI classification correctly skips manually and rule-classified transactions.
- File upload has a well-structured rollback sequence (storage -> DB insert -> tx update).
- CSV dedupe via `dedupe_hash` is robust (SHA-256 of 6 fields).
- Rule priority tie-breaking is deterministic and documented by code.

**Negative patterns:**
- **Log insert results ignored**: Six instances across the codebase where `receipt_transaction_logs.insert()` result is not checked. This is a systemic pattern, not one-off oversights.
- **No DB transactions**: All multi-step mutations are sequences of individual DB calls. PostgreSQL transactions are not used, making partial failure the norm rather than the exception.
- **console.error as the sole failure indicator**: Several failure branches only emit `console.error` with no DB record, no audit event, and no operator notification. Failures are only visible in server logs which may not be monitored.
- **Inconsistent error wrapping**: AI job enqueueing in `importReceiptStatement` is wrapped in try/catch; `applyAutomationRules` is not. The pattern is applied selectively.
- **Silent continues in classification loop**: Both the rule application and AI classification loops use `continue` on per-record errors, making it impossible to distinguish "not yet attempted" from "attempted and failed" without examining `receipt_transaction_logs`.
