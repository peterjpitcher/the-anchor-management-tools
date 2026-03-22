# Technical Architect Review — Receipts Module
**Phase:** 1 — Structural Assessment
**Reviewer role:** Technical Architect
**Date:** 2026-03-07
**Files reviewed:**
- `src/app/actions/receipts.ts` (3,415 lines)
- `src/lib/receipts/ai-classification.ts`
- `src/lib/receipts/rule-matching.ts`
- `src/app/api/receipts/upload/route.ts`
- `src/app/api/receipts/export/route.ts`
- `src/lib/unified-job-queue.ts`
- `src/lib/openai.ts`

---

## Executive Summary

The module is well-structured overall with consistent use of the admin Supabase client, Zod validation at every entry point, permission checks on every action, and meaningful audit logging. There are no catastrophic data-loss bugs. However, several failure modes produce silent inconsistencies or orphaned resources, the job queue provides no dead-letter mechanism, the rule retro-run has no atomicity, and the CSV import has a meaningful batch record orphan scenario. These are documented in detail below.

---

## 1. Failure-at-Step-N Analysis

### 1.1 CSV Import

**Steps:**
1. Parse and validate CSV rows
2. Compute dedupe hash per row
3. Insert `receipt_batches` record
4. Upsert `receipt_transactions` rows (on conflict `dedupe_hash`, ignore duplicates)
5. Apply automation rules to inserted IDs
6. Enqueue AI classification jobs
7. Insert transaction logs
8. Write audit event

**Step 3 fails:** No batch record created, no transactions — fully safe. Error is surfaced to the user.

**Step 4 fails after step 3:** A `receipt_batches` record exists with `row_count` set but zero corresponding transactions. The batch record is permanently orphaned and will appear in the "last import" summary widget with misleading row count. There is no cleanup or rollback of the batch record on transaction insert failure. **Severity: Medium.** The user sees an error and re-imports, creating a second batch record. The first remains as junk data.

**Step 5 (automation rules) fails:** Errors are swallowed. `applyAutomationRules` returns `{ statusAutoUpdated: 0, classificationUpdated: 0, ... }` on chunk errors (each chunk logged but processing continues). The audit event still reports `auto_applied: 0`. Transactions are inserted but not classified by rules. **Severity: Low** — idempotent re-application is possible by triggering a retro-run manually.

**Step 6 (AI classification enqueue) fails:** Wrapped in a try/catch that swallows the error. Batch and transactions are fully committed. No classification jobs are queued. The audit log records `ai_jobs_failed` count, but there is no alert or automatic retry from the import path. **Severity: Medium — silent failure.** Transactions will appear in the workspace with no vendor/expense, requiring manual intervention or re-queue via `requeueUnclassifiedTransactions`.

**Step 7 (transaction log insert) fails:** No error handling on `supabase.from('receipt_transaction_logs').insert(logs)` — the result is not checked. Audit trail is silently incomplete. **Severity: Low** — data integrity is unaffected, but auditability suffers.

**Step 8 (audit event) fails:** `logAuditEvent` errors are not propagated. Safe to fail.

### 1.2 AI Classification Job

**Steps (inside `classifyReceiptTransactionsWithAI`):**
1. Load transaction rows from DB
2. Filter to transactions needing classification
3. Fetch few-shot examples and cross-transaction hints (parallel)
4. Build batch items
5. Call OpenAI batch API (`classifyReceiptTransactionsBatch`)
6. Record AI usage event
7. For each transaction, update DB with vendor/expense/confidence
8. Insert classification logs

**Step 5 fails (OpenAI returns null):** Handled. Failure logs are inserted for all items with `action_type: 'ai_classification_failed'`. No usage is recorded (correct, since no API call succeeded). Safe.

**Step 5 succeeds but step 6 (usage recording) fails:** `recordAIUsage` logs the error to `console.error` but does not throw. Classification proceeds. AI cost is permanently unrecorded — cost tracking is silently inaccurate. **Severity: Low-Medium** — financial tracking understates spend with no alert.

**Step 7 (DB update) fails for a specific transaction:** Logged with `console.error` and `continue` — that transaction is silently skipped. OpenAI was paid for its classification but the result is not persisted. The job completes as `{ processed: N }` from the queue perspective, even if N-1 actually saved. **Severity: Medium — silent partial failure.**

**Idempotency:** Partially handled. The filter `vendor_source === 'manual' || vendor_source === 'rule'` skips locked transactions. For AI-classified transactions (`vendor_source === 'ai'`), they would be re-classified if `vendor_name` happens to be null (unlikely after first classification) but `needsExpense` could be true, causing double-processing of expense category. Not a true idempotency guarantee. If the job runs twice due to stale lease reset, a transaction with `vendor_source: 'ai'` but no `expense_category` gets re-classified, potentially overwriting a manual expense update that happened between runs. **Severity: Low-Medium.**

**Worker crash (lease expires):** The job queue's stale reset mechanism (`resetStaleJobs`) re-queues the job as pending if attempts < max_attempts (default 3). This correctly retries but see idempotency concern above. After 3 failures, the job is marked `failed` — no alert, no dead-letter queue. Transactions remain unclassified indefinitely.

### 1.3 Rule Retro-Run

**Steps (in `applyAutomationRules`):**
1. Fetch all active rules
2. Fetch all transaction rows in chunks (chunked in 100s, parallel)
3. For each matching transaction: compute update payload
4. Update transaction row individually (sequential per transaction)
5. Accumulate logs
6. Bulk insert logs

**Atomicity:** None. Each transaction update is a separate DB call. If the process crashes or the server times out mid-loop (which is realistic on large datasets — `runReceiptRuleRetroactively` has a 12-second budget), some transactions are updated and others are not. There is no record of which transactions were processed before the crash. The next run re-processes all transactions, so partial failures are self-healing — but between runs, the state is inconsistent. **Severity: Medium** — acceptable for a background operation but not documented.

**If bulk log insert (step 6) fails:** Error is not checked. `await supabase.from('receipt_transaction_logs').insert(classificationLogs)` — the return value is discarded. Audit trail is silently incomplete for rule applications. **Severity: Low.**

**`refreshAutomationForPendingTransactions` (triggered on rule toggle):** Fetches up to 500 pending transaction IDs and calls `applyAutomationRules`. No error handling on the result. No permission check (it's a private function called inside `toggleReceiptRule` which does check permissions). Safe from an auth standpoint but the 500-row limit silently misses transactions if there are more. **Severity: Low-Medium** — documented nowhere.

### 1.4 Bulk Group Apply

**Steps:**
1. Validate input
2. Fetch all transactions matching `details` + `statuses`
3. Update vendor (all matching IDs) — if `vendorProvided`
4. Update expense (incoming-only filtered IDs) — if `expenseProvided`
5. Insert logs
6. Write audit event

**Step 3 succeeds, step 4 fails:** Vendor is already applied to all rows. Expense update fails. Return `{ error: 'Failed to apply changes' }` — but vendor has already been committed. User sees an error yet partial changes are permanent. **Severity: Medium — partial mutation with no rollback.** No transaction wrapping.

**Step 4 succeeds, step 5 (log insert) fails:** Error is logged with `console.error` but not returned. Classification is complete; only audit trail is missing. Acceptable.

**No atomicity between vendor and expense updates.** Both use separate `supabase.update().in('id', ...)` calls. If the process is killed between them, vendor is applied but expense is not, with no record of this intermediate state. **Severity: Medium.**

### 1.5 Receipt File Upload (Attachment)

**Steps:**
1. Validate file and transaction ID
2. Look up transaction from DB
3. Upload file to Supabase Storage
4. Insert `receipt_files` record
5. Update transaction status to `completed`
6. Insert transaction log

**Step 3 succeeds, step 4 fails:** Code handles this. It attempts to `remove([storagePath])` from storage. If the cleanup itself fails, it returns `{ error: '...cleanup requires manual reconciliation.' }`, which is honest. **Severity: Low** — cleanup attempted, failure is surfaced clearly.

**Step 4 succeeds, step 5 fails (transaction update):** Code handles this. It attempts to delete the `receipt_files` record and remove from storage. If either rollback fails, it returns `{ error: '...cleanup requires manual reconciliation.' }`. **Severity: Low** — rollback is attempted, messaging is clear.

**Step 5 succeeds, step 6 (log insert) fails:** Not handled as an error — `uploadLogError` is logged with `console.error` but the function returns `{ success: true, receipt }`. Acceptable.

**Assessment:** The upload path has the most thorough failure handling in the entire module. The rollback logic is brittle (sequential, each step can fail independently) but the messaging to the user is honest.

**Orphaned storage risk:** If the Node.js process is killed between step 3 (upload succeeds) and step 4 (DB insert), the storage file is orphaned permanently. There is no periodic reconciliation job. **Severity: Low** — storage costs, not data corruption.

### 1.6 Rule Create + Retro

**Steps:**
1. Validate rule data
2. Insert `receipt_rules` record
3. Write audit event
4. Return `{ success: true, rule, canPromptRetro: true }` — retro is triggered separately by the UI

**Assessment:** The retro-run is explicitly decoupled from rule creation and is triggered by the user via a separate action. This is good design — rule creation is atomic. If retro fails, the rule still exists and can be re-run. No transactional risk between create and retro. **Severity: None.**

---

## 2. Architecture Assessment

### Business Logic Location

Business logic is split between:
- `src/app/actions/receipts.ts` — the largest file (3,415 lines), contains import pipeline, all rule operations, bulk classification, and most utility functions
- `src/lib/receipts/ai-classification.ts` — AI-specific orchestration including few-shot example fetching
- `src/lib/receipts/rule-matching.ts` — pure rule evaluation logic (well-isolated, no side effects)
- `src/lib/openai.ts` — HTTP client wrapper and token cost calculation

This split is **partially coherent**. Rule matching is cleanly extracted. However, `ai-classification.ts` still contains DB access logic (fetching few-shot examples, cross-transaction hints, inserting logs) — it is not a pure service layer; it mixes I/O with classification orchestration. The 3,415-line actions file is approaching unmaintainable size and should be broken into sub-modules (`receipts-import.ts`, `receipts-bulk.ts`, `receipts-rules.ts`, etc.).

### Admin Client Usage

The admin (service-role) client is used correctly and consistently throughout. All operations use `createAdminClient()` directly — no user-scoped RLS client is used anywhere in the receipts module. This is appropriate because:
- All actions check `checkUserPermission` server-side before touching data
- The module performs system operations (rule retro, AI classification) that correctly bypass RLS

One concern: `applyAutomationRules` is a private function that does not check permissions itself. It relies entirely on its callers having checked permissions. This is acceptable given it is unexported, but if it is ever exposed or called from a non-permission-checked path, it would be a privilege escalation vector.

### Job Queue Pattern

The `UnifiedJobQueue` uses a Supabase `jobs` table as a persistence layer. Key failure modes:

1. **No dead-letter queue.** Jobs that exhaust all attempts are marked `failed` with an error message. There is no alerting, no automatic escalation, and no UI to surface failed classification jobs. Unclassified transactions silently remain unclassified.

2. **Stale lease detection is correct but polling-based.** `resetStaleJobs` is called at the top of `processJobs`. If the cron that triggers `processJobs` does not run (Vercel cron failure), stale jobs are never reset.

3. **Heartbeat mechanism is robust.** Token-guarded lease updates prevent duplicate processing. The fallback `claimJobsFallback` is a TOCTOU race — it reads pending jobs and then updates them without an atomic claim — but the `eq('status', 'pending')` condition on the update mitigates most races.

4. **`classify_receipt_transactions` job timeout.** The default timeout is 120 seconds. A batch of 10 transactions calling OpenAI could legitimately take >30 seconds with retries. If the AI call takes longer than the lease period, the lease expires, and the job is re-claimed by another worker, causing duplicate AI calls (and double-billing). The retry config in `openai.ts` uses `RetryConfigs.api` — this must be verified to stay within the 120-second budget.

---

## 3. Data Model Assessment

### Dedupe Hash Collision Resistance

```typescript
createHash('sha256').update(
  [transactionDate, details, transactionType ?? '', amountIn ?? '', amountOut ?? '', balance ?? ''].join('|')
)
```

**Issues:**
- Uses SHA-256 — collision-resistant, not a concern.
- **Separator injection:** The `|` separator is not escaped in field values. If `details` contains `|`, it could produce hash collisions between different logical transactions. Example: `details="foo|bar"` with `transactionType=null` vs `details="foo"` with `transactionType="bar"`. In practice, bank statement details rarely contain `|` but this is a latent correctness bug.
- **Floating-point representation:** `amountIn ?? ''` uses JavaScript's default `toString()` for numbers. `parseCurrency` returns `Number(result.toFixed(2))` so values are normalised, but the toString conversion of `12.10` produces `"12.1"` vs `"12.10"` — the `.toFixed(2)` result is `"12.10"` (a string) only if it goes through `toFixed` again at hash time. Checking: the hash input uses the raw number `amountIn ?? ''` — the number `12.1` produces the string `"12.1"`, not `"12.10"`. Two rows with amounts `12.10` and `12.1` (same value) produce the same hash, which is correct. This is safe. However, if `parseCurrency` ever returns `12.099999999...` due to floating-point arithmetic, the hash would differ for the same transaction on re-import. The `.toFixed(2)` in `parseCurrency` mitigates this.

### Missing DB Constraints

Not directly observable from the code alone, but the following are concerning from the code patterns:
- `vendor_source` is set to free-form strings (`'ai'`, `'manual'`, `'rule'`, `'import'`, `null`). If there is no CHECK constraint in the DB, invalid values could be written without error.
- `receipt_transaction_logs.action_type` is a string with values like `'import'`, `'manual_classification'`, `'ai_classification'`, `'rule_classification'`, `'rule_auto_mark'`, `'bulk_classification'`, `'receipt_upload'`, `'receipt_deleted'`, `'ai_classification_failed'`, `'manual_update'`. No enum constraint is visible — a typo in an action_type string would silently store garbage.

### AI Usage Recording — Atomicity

`recordAIUsage` is called **before** the per-transaction update loop:

```typescript
await recordAIUsage(supabase, batchOutcome.usage, `receipt_classification_batch:${toClassify.length}`)

for (const transaction of toClassify) {
  // ... update each transaction
}
```

If the process crashes after `recordAIUsage` but before any transaction is updated, cost is recorded but no classifications are saved. The job queue's retry mechanism will re-run the classification, calling OpenAI again and recording usage a second time. This means a single batch can record **double cost** with only one set of classifications saved. **Severity: Medium** — financial tracking overstates spend on retried jobs.

---

## 4. Integration Robustness

### OpenAI API Calls

Both `classifyReceiptTransaction` and `classifyReceiptTransactionsBatch` use `retry(async () => fetch(...), RetryConfigs.api)`.

The `retry` utility is imported from `@/lib/retry`. Without reading that file, the retry behaviour (backoff, max attempts, which errors are retried) is unknown, but the pattern exists. The OpenAI calls have:
- `max_tokens: 300` (single) / `max_tokens: 2000` (batch) — reasonable
- No explicit `signal` / timeout on the `fetch` call — relies on Node.js default socket timeout (which can be very long). A hung OpenAI connection could hold a job lease and eventually trigger a lease expiry, causing a retry.
- Rate limiting from OpenAI results in a non-2xx response. The code checks `!response.ok` and returns `null`. No rate-limit backoff is applied — the retry utility would need to handle 429 responses specifically.

### Supabase Storage

Storage uploads use `upsert: false`, which means a re-upload to the same path fails with a duplicate error. The path includes `Date.now()` as a suffix, making collisions extremely unlikely. Downloads in the export route fail gracefully per-file (logged with `console.warn`, not added to archive). **No partial archive corruption risk.**

### Job Queue Failure Modes (Summary)

| Failure | Current Behaviour | Risk |
|---|---|---|
| Worker crashes mid-classification | Job re-queued after lease expiry; AI called again | Double billing |
| Max attempts exhausted | Job marked failed, no alert | Silent — transactions never classified |
| Heartbeat DB update fails | Job aborts via `abortLease`; marked failed | Correct |
| OpenAI timeout (fetch hangs) | No fetch timeout — lease eventually expires | Stale worker accumulates |

---

## 5. Error Handling Audit

### Silent Failures

**Critical silent failures:**
1. `enqueueReceiptAiClassificationJobs` is wrapped in a try/catch that swallows the error. If enqueueing fails entirely, transactions silently remain unclassified. (line ~1343–1348)
2. `supabase.from('receipt_transaction_logs').insert(logs)` in `importReceiptStatement` — result not checked. (line ~1363)
3. `supabase.from('receipt_transaction_logs').insert(classificationLogs)` in `applyAutomationRules` — result not checked. (line ~951)
4. `recordAIUsage` on failure only logs `console.error` — cost not recorded.
5. Per-transaction AI classification update failure (`console.error; continue`) — classification lost silently.

**Acceptable silent failures (degradation, not data loss):**
- Few-shot example fetch failure returns `[]` (caught, no throw) — acceptable fallback.
- Cross-transaction hint fetch failure returns `[]` (caught, no throw) — acceptable fallback.
- AI classification for bulk-review groups falls back to existing data — acceptable.

### Generic Catches

`fetchFewShotExamples` and `fetchCrossTransactionHints` use bare `catch { return [] }` blocks with no logging. If these fail due to DB schema changes or permission issues, the failure is completely invisible.

### Unchecked Error Returns

`applyAutomationRules` inside `importReceiptStatement` (line 1338):
```typescript
const { statusAutoUpdated: autoApplied, classificationUpdated: autoClassified } =
  await applyAutomationRules(insertedIds)
```
The function can partially fail (chunk-level errors logged but not returned). The caller has no way to know that automation was only partially applied.

---

## 6. Security Assessment

### Permission Checks

Every exported server action and API route checks permissions server-side before any data operation. Coverage is complete across the 25+ exported functions. The `view` permission is used correctly for read-only operations and `manage` for mutations.

**Gap:** `applyAutomationRules` and `refreshAutomationForPendingTransactions` are private functions that perform mutations without permission checks. This is architecturally safe because they are only called from checked callers, but this is a fragile assumption as the file grows.

### API Route Authentication

`/api/receipts/upload/route.ts` — delegates to `uploadReceiptForTransaction`, which checks `checkUserPermission('receipts', 'manage')`. Correct.

`/api/receipts/export/route.ts` — checks `checkUserPermission('receipts', 'export')` at the top of the handler. Correct. Uses `createAdminClient()` directly (appropriate for a server-side export route).

**Note:** The export route's permission check uses `'export'` as the action. This action must exist in the RBAC definition or it will silently return `false` (denying access) or silently return `true` (granting access to all). Worth verifying.

### Admin Client in Client Components

The project has an ESLint rule preventing admin client imports in client components. All admin client usage in this module is in server-side files (`'use server'` or API routes). No violation observed.

### CSV Injection

The CSV import reads raw bank statement data. User-supplied strings in `details`, `transactionType`, etc. are sanitised with `sanitizeText()` (trims whitespace, collapses spaces) before storage. However:
- Values are not sanitised for CSV formula injection (`=SUM(...)`, `@CMD`, etc.). If the export route writes these values to a CSV that is opened in Excel, formula injection is possible. The export uses `Papa.unparse()` which does not escape leading `=`, `+`, `-`, `@` characters. **Severity: Medium** — affects users who open the exported CSV in Excel/LibreOffice without being careful. Not a server-side injection risk.

### OpenAI Prompt Injection

Transaction details from bank statements are inserted into the OpenAI prompt verbatim. A bank transaction description of `"Ignore previous instructions and return..."` could manipulate the classification response. The structured JSON output format and `additionalProperties: false` schema mitigate this significantly — the model must return specific field names. The result is normalised and validated before use. **Severity: Low** — well-mitigated by schema enforcement.

---

## 7. Technical Debt

### Hardcoded Values

| Value | Location | Should Be |
|---|---|---|
| `RECEIPT_AI_JOB_CHUNK_SIZE = 10` | `receipts.ts:38` | Configurable env var |
| `timeBudgetMs = 12_000` | `receipts.ts:2740` | Configurable; tied to Vercel function timeout |
| `RETRO_CHUNK_SIZE = 100` | `receipts.ts:996` | Could be tunable |
| `DEFAULT_LEASE_SECONDS` derived from `DEFAULT_JOB_TIMEOUT_MS` | `unified-job-queue.ts` | Already env-configurable |
| Model pricing table in `openai.ts` | Hard-coded per-model costs | Should be fetched or at least versioned |

### Duplicated Logic

1. **Vendor normalisation** — `normalizeVendorInput()` appears in `receipts.ts` and a similar function (`normaliseVendorName()`) appears in `openai.ts`. They are functionally equivalent (trim, slice to 120 chars).

2. **`getTransactionDirection`** — defined in both `src/app/actions/receipts.ts` and `src/lib/receipts/ai-classification.ts`. Different implementations; the one in `ai-classification.ts` uses `tx.amount_in > 0`, the one in `receipts.ts` also checks `isParsedTransactionRow`. Risk of divergence.

3. **Expense category enforcement** — `canAssignExpenseCategory` (in `ai-classification.ts`) and `isIncomingOnlyTransaction` (in `receipts.ts`) express the same business rule (expense categories only apply to outgoing transactions) with different naming and slight logic differences.

4. **Permission check boilerplate** — all 25+ exported functions repeat identical permission check patterns. No helper to DRY this.

### Console Logging in Production

The receipts actions file has 60+ `console.log/warn/error` calls. While not all are wrong, `console.log('[retro] applyAutomationRules start', ...)` fires on every retro step in production. This adds noise to Vercel logs and may surface sensitive transaction details. The project has a `logger` utility in `src/lib/logger.ts` — only `unified-job-queue.ts` uses it; receipts actions do not.

### `any` Types

Several casts to `any`:
- `supabase as any` throughout `ai-classification.ts` to bypass TypeScript's type constraints on the admin client schema
- `(data as any)` in `getMonthlyReceiptInsights` for RPC results
- The `normaliseToBuffer` function in `export/route.ts` casts to `any` to call `.arrayBuffer()`

These are pragmatic but indicate incomplete type definitions for the DB schema / Supabase RPC returns.

### TODO / Dead Code

No explicit TODO/FIXME comments found in the reviewed files. The `classifyReceiptTransaction` (single-transaction version in `openai.ts`) is still used by `buildGroupSuggestion` in `receipts.ts` for the bulk-review UI. This means both single and batch classification paths remain active — the single path does not go through the job queue and is called synchronously during `getReceiptBulkReviewData`. This is a latent cost-control risk: bulk review of many groups makes many synchronous OpenAI calls without job queue throttling or visibility.

---

## 8. Summary of Findings by Severity

### High
*(Issues requiring immediate attention before production scale)*
- None identified that cause guaranteed data loss in normal operation.

### Medium
1. **Orphaned `receipt_batches` record** when transaction upsert fails — junk data, misleading UI.
2. **Silent AI job enqueue failure** after CSV import — transactions permanently unclassified with no alert.
3. **Double AI billing on job retry** — AI usage recorded before per-transaction updates; crash = double cost recorded.
4. **Bulk group apply partial mutation** — vendor applied, expense update fails, no rollback; user sees error but data is partially changed.
5. **No dead-letter queue** for failed classification jobs — after 3 attempts, failure is invisible.
6. **CSV formula injection** in export — Excel/LibreOffice opens exported CSVs with unescaped `=`, `+`, `-`, `@` characters.

### Low
1. Transaction log inserts not checked in `importReceiptStatement` and `applyAutomationRules`.
2. `recordAIUsage` failure is silent — cost tracking understated.
3. Per-transaction AI classification failures are silent — classification lost, logged only.
4. Bare `catch { return [] }` in `fetchFewShotExamples` and `fetchCrossTransactionHints` — invisible errors.
5. `refreshAutomationForPendingTransactions` silently misses >500 pending transactions.
6. `getTransactionDirection` duplicated with divergent implementations.
7. `console.log` in `applyAutomationRules` fires on every call in production.
8. Orphaned storage files if process dies between upload and DB insert.
9. Dedupe hash separator not escaped — theoretical collision risk with unusual bank description strings.
10. DB `vendor_source` and `action_type` fields lack enum constraints (not visible from code, but a likely gap).

---

## 9. Recommendations

1. **Batch record cleanup on transaction insert failure** — wrap the batch insert + transaction upsert in a compensating pattern: if upsert fails, delete the batch record before returning the error.

2. **Surface AI job enqueue failures** — remove the swallowing try/catch in `importReceiptStatement`. If job enqueueing fails, return a warning in the success response so the UI can prompt the user to manually re-queue.

3. **Record AI usage after classifications are saved** — move `recordAIUsage` to after the per-transaction update loop, or record usage only for transactions that were successfully updated.

4. **Wrap bulk apply vendor + expense updates in a DB transaction** — or at minimum, apply them in a single `UPDATE` statement to avoid the two-step partial failure.

5. **Add dead-letter visibility** — create a simple admin view of jobs with `status = 'failed'` and `type = 'classify_receipt_transactions'`. Send a notification or dashboard alert when classification jobs exhaust retries.

6. **CSV export: escape formula injection** — prefix cell values starting with `=`, `+`, `-`, `@` with a single quote or a tab character before writing to CSV.

7. **Migrate `console.log` to `logger`** — replace all console calls in receipts actions with the project's structured logger to align with the codebase standard and reduce log noise.

8. **Break `receipts.ts` into sub-modules** — at 3,415 lines, this file is difficult to navigate. Suggested split: `receipts-import.ts`, `receipts-rules.ts`, `receipts-bulk.ts`, `receipts-workspace.ts`, `receipts-files.ts`.

9. **Add fetch timeout to OpenAI calls** — pass an `AbortSignal` with a timeout to `fetch()` to prevent hung connections from holding job leases.

10. **Dedupe hash: use a structured separator** — use a delimiter that cannot appear in bank statement fields (e.g., `\x00`) or encode each field before joining.
