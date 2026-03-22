# Consolidated Defect Log — Receipts Module
**Phase:** 1 consolidation
**Date:** 2026-03-07
**Method:** Cross-referenced findings from 4 agents (Structural Mapper, Business Rules Auditor, Technical Architect, QA Specialist)

---

## Confidence Notes

Defects found by 2+ agents are marked [CORROBORATED]. Defects found by 1 agent only are marked [SOLO] — these were independently verified by the orchestrator before inclusion.

---

## CRITICAL — Actively Harming or Compliance Risk

### DEF-001 — No file size limit on CSV upload schema [CORROBORATED]
- **Agents:** QA (DEF-QA-001), Technical Architect (5. Error Handling — swallowing catch)
- **Severity:** Critical
- **Summary:** `fileSchema` for CSV imports has no upper bound on `file.size`. Only `receiptFileSchema` (for receipt attachments) enforces 15 MB. A large CSV causes server OOM.
- **Code:** `receipts.ts:369` — `fileSchema` missing `file.size <= MAX_RECEIPT_UPLOAD_SIZE`
- **Business Impact:** A very large CSV file causes server-side OOM or timeout, potentially affecting all users on the deployment.
- **Fix:** Add `file.size <= MAX_RECEIPT_UPLOAD_SIZE` check to `fileSchema`.
- **Test cases:** T004

---

### DEF-002 — Orphaned `receipt_batches` record when transaction upsert fails [CORROBORATED]
- **Agents:** QA (DEF-QA-002 HIGH), Technical Architect (1.1 Medium)
- **Severity:** Critical
- **Summary:** In `importReceiptStatement`, the `receipt_batches` record is inserted before the transaction upsert. If the upsert fails, the batch record persists with the correct `row_count` but zero transactions. Staff sees a phantom "last import" with no data.
- **Code:** `receipts.ts:1282–1334` — no compensating delete on transaction insert failure
- **Business Impact:** Staff may believe an import succeeded when it did not, and skip re-importing, resulting in missing transaction history.
- **Fix:** After transaction upsert failure: delete the batch record before returning the error. Or add a `status` column to `receipt_batches` to distinguish `completed`/`failed`.
- **Test cases:** T018, T131

---

### DEF-003 — `applyAutomationRules` not wrapped in try/catch inside import [CORROBORATED]
- **Agents:** QA (DEF-QA-007 HIGH), Technical Architect (5. Error Handling)
- **Severity:** Critical
- **Summary:** In `importReceiptStatement`, `applyAutomationRules(insertedIds)` at line 1337 is bare — no try/catch. The AI enqueue call immediately below it IS wrapped. If automation throws (e.g. DB connection failure), the server action surfaces a 500, despite batch + transactions already being committed.
- **Code:** `receipts.ts:1337` — no try/catch vs `receipts.ts:1343` which has one
- **Business Impact:** User believes the import failed and may retry, creating a second batch. Data is actually committed. Double imports bypass dedupe if the user re-uploads.
- **Fix:** Wrap `applyAutomationRules(insertedIds)` in try/catch. On catch, log the error, set `autoApplied`/`autoClassified` to 0, and return success with a warning that automation was skipped.
- **Test cases:** T142

---

### DEF-004 — `deleteReceiptFile`: transaction stuck in `completed` with zero receipt files [CORROBORATED]
- **Agents:** QA (DEF-QA-006 HIGH), Technical Architect (1.5)
- **Severity:** Critical
- **Summary:** After `deleteReceiptFile` successfully removes the file from storage and DB, it queries for remaining files. If that query fails, it returns an error but does NOT reset the transaction to `pending`. The transaction stays `completed` with no supporting document.
- **Code:** `receipts.ts:1876–1884`
- **Business Impact:** A `completed` transaction with zero receipt files will pass export as complete — an audit compliance failure. Staff have no indication the document is missing.
- **Fix:** On remaining-files query failure, conservatively reset the transaction to `pending` before returning the error. "If we can't confirm files remain, act as if none do."
- **Test cases:** T139

---

### DEF-005 — `ReceiptStats`: "Auto-matched" label inconsistent with "Auto completed" everywhere else [SOLO]
- **Agents:** Business Rules Auditor (FAIL 10.2)
- **Severity:** Critical (policy drift — user-facing naming inconsistency breaks filter workflow)
- **Summary:** `ReceiptStats.tsx:83` renders the `auto_completed` stat card with `title="Auto-matched"`. Every other component, the filter dropdowns, the export CSV, and `utils.ts` call this status "Auto completed". A user seeing "Auto-matched: 47" and then trying to find those transactions via the status filter will not find a "Auto-matched" option.
- **Code:** `ReceiptStats.tsx:83`
- **Business Impact:** Confusing UX; breaks the stat card → filter workflow for staff.
- **Fix:** Change `title="Auto-matched"` to `title="Auto completed"` in `ReceiptStats.tsx`.
- **Test cases:** T093

---

### DEF-006 — `deleteReceiptFile` always logs `new_status: 'pending'` regardless of remaining files [SOLO]
- **Agents:** Business Rules Auditor (FAIL 10.7)
- **Severity:** Critical (inaccurate audit trail)
- **Summary:** `deleteReceiptFile` inserts a `receipt_transaction_logs` entry with `new_status: 'pending'` before checking whether other files remain. If the transaction has two receipts and one is deleted, the audit log records the transaction as having become `pending`, but it stays `completed`.
- **Code:** `receipts.ts:1860–1870`
- **Business Impact:** Audit log is wrong in the multi-file case. Accountants tracing history will see a status change that did not occur.
- **Fix:** Determine whether the transaction will actually change status (check remaining files first, or move the log insert to after the status decision). Only log `new_status: 'pending'` if the status actually changed.
- **Test cases:** T108

---

## STRUCTURAL — Fragile, Will Break Under Edge Cases

### DEF-007 — Bulk apply: vendor update committed before expense update; no rollback [CORROBORATED]
- **Agents:** QA (DEF-QA-003 HIGH), Technical Architect (1.4 Medium)
- **Severity:** High
- **Summary:** `applyReceiptGroupClassification` updates vendor and expense in two separate DB calls with no transaction wrapping. If vendor succeeds and expense fails, vendor is permanently committed. User sees an error but data is partially changed.
- **Code:** `receipts.ts:2503–2548`
- **Business Impact:** Inconsistent classification state; confusing error message ("Failed to apply changes" when half the changes are applied). Re-running resolves it but damages user trust.
- **Fix:** Either (a) use a single PostgreSQL `UPDATE ... SET vendor=..., expense=...` call via an RPC, or (b) apply both updates together as a single upsert. If a true DB transaction is not available via Supabase JS, use a custom RPC.
- **Test cases:** T079

---

### DEF-008 — Silent AI classification job enqueue failure after CSV import [SOLO]
- **Agents:** Technical Architect (1.1 Medium, 5 Critical Silent Failures #1)
- **Severity:** High
- **Summary:** `enqueueReceiptAiClassificationJobs` in `importReceiptStatement` is wrapped in a try/catch that swallows the error completely. If enqueue fails, the import reports success with `ai_jobs_failed` count in the audit log, but the UI gives no indication that classification will not happen. Transactions silently remain unclassified until someone manually triggers `requeueUnclassifiedTransactions`.
- **Code:** `receipts.ts:1343–1348` — catch block swallows without surfacing
- **Business Impact:** Staff expect auto-classification to happen after import. When it silently fails, they discover unclassified transactions much later.
- **Fix:** Surface the enqueue failure in the success response (e.g. `{ success: true, warning: 'AI classification could not be queued. Use the re-queue button to retry.' }`). The UI should toast this warning.
- **Test cases:** T132 (partial)

---

### DEF-009 — Double AI billing on job retry [SOLO]
- **Agents:** Technical Architect (3. Data Model, AI Usage Recording Atomicity)
- **Severity:** High
- **Summary:** In `classifyReceiptTransactionsWithAI`, `recordAIUsage` is called BEFORE the per-transaction update loop. If the process crashes after recording usage but before saving any classifications, the job is retried, OpenAI is called again, and usage is recorded a second time. Single batch = double cost in `ai_usage_events`.
- **Code:** `ai-classification.ts:194` — `recordAIUsage` precedes the update loop at line ~240
- **Business Impact:** Cost tracking overstates AI spend for any retried job. Cumulatively misleading if retries are frequent.
- **Fix:** Move `recordAIUsage` to AFTER the per-transaction update loop completes successfully. Or record usage per-transaction rather than per-batch.
- **Test cases:** T023

---

### DEF-010 — No dead-letter visibility for failed classification jobs [CORROBORATED]
- **Agents:** Technical Architect (1.2, 4), QA (Coverage Gap #4)
- **Severity:** High
- **Summary:** After 3 retry attempts, classification jobs are marked `failed` in the `jobs` table with no alert, no UI visibility, and no automatic recovery. Affected transactions remain permanently unclassified — indistinguishable from "not yet attempted" unless staff check the job table directly.
- **Code:** `unified-job-queue.ts` — no dead-letter alerting after max attempts
- **Business Impact:** Silent, permanent classification failures that staff cannot detect without monitoring the `jobs` table directly.
- **Fix:** Add a query in the receipts workspace summary that counts `jobs` records with `type = 'classify_receipt_transactions' AND status = 'failed'` and surfaces the count as a warning banner. Optionally send an alert email.
- **Test cases:** T024

---

### DEF-011 — CSV export: formula injection risk in Excel/LibreOffice [SOLO]
- **Agents:** Technical Architect (6. Security — Medium)
- **Severity:** High
- **Summary:** The CSV export route writes raw transaction `details` values without escaping leading `=`, `+`, `-`, `@` characters. When opened in Excel or LibreOffice, cells starting with these characters are interpreted as formulas. A bank transaction description of `=SUM(A1:A100)` would execute.
- **Code:** `export/route.ts` — `Papa.unparse()` called without CSV injection escaping
- **Business Impact:** Exported CSVs shared with accountants could execute unexpected formulas. Not a server-side risk but a real attack vector for externally-sourced bank statement data.
- **Fix:** Before passing values to `Papa.unparse`, escape any cell value that starts with `=`, `+`, `-`, or `@` by prefixing it with a tab character or single quote. Implement as a helper `escapeCsvCell(value: string): string`.
- **Test cases:** T113

---

### DEF-012 — File delete: orphaned storage file on double rollback failure [CORROBORATED]
- **Agents:** QA (DEF-QA-005 HIGH), Technical Architect (1.5 Low)
- **Severity:** High
- **Summary:** `deleteReceiptFile` deletes the DB record first, then removes from storage. If storage removal fails, it tries to re-insert the DB record. If the re-insert also fails, the DB record is gone but the storage file exists. No structured record of the orphaned path is written.
- **Code:** `receipts.ts:1830–1855`
- **Business Impact:** Orphaned storage files incur cost and cannot be cleaned up without inspecting raw storage logs. No audit trail pointing to the specific path.
- **Fix:** On double-failure, write an audit event (or a dedicated `storage_cleanup_required` log entry) containing the `storagePath`. This enables periodic cleanup tooling.
- **Test cases:** T136

---

### DEF-013 — Retro-run time budget exit skips `finalizeReceiptRuleRetroRun` [CORROBORATED]
- **Agents:** QA (DEF-QA-012 MEDIUM), Structural Mapper (Missing Pieces)
- **Severity:** Medium
- **Summary:** `runReceiptRuleRetroactively` returns early on time budget exhaustion without calling `finalizeReceiptRuleRetroRun`. This skips the audit log write and all `revalidatePath` calls. The workspace UI shows stale data after a partial retro-run with no indication it was incomplete.
- **Code:** `receipts.ts:2808–2831`
- **Business Impact:** Staff may not see newly classified transactions in the workspace until the next full page load. No audit record of partial run.
- **Fix:** Call a `partialFinalize` variant (or pass a `partial: true` flag to `finalizeReceiptRuleRetroRun`) on time-budget exit, writing an audit log indicating partial completion and calling `revalidatePath`.
- **Test cases:** T137

---

### DEF-014 — Per-transaction AI failure: no `ai_classification_failed` log [CORROBORATED]
- **Agents:** QA (DEF-QA-009 MEDIUM, DEF-QA-013 MEDIUM), Technical Architect (5 Silent Failures)
- **Severity:** Medium
- **Summary:** Two failure paths in AI classification emit `continue` with no log entry: (a) OpenAI returns a result but the specific transaction is absent from the response map; (b) DB update succeeds but then fails for a specific transaction. Both leave transactions silently unclassified with no `ai_classification_failed` entry in `receipt_transaction_logs`.
- **Code:** `ai-classification.ts:242–244` (missing result) and `ai-classification.ts:287–294` (DB update failure)
- **Business Impact:** Operators cannot distinguish "not yet classified" from "classification was attempted and failed". Re-queue will retry, but the failure history is invisible.
- **Fix:** In both branches, insert an `ai_classification_failed` log entry before `continue`. Mirror the pattern used for full-batch failures.
- **Test cases:** T024, T132

---

## ENHANCEMENT — Should Exist, Doesn't

### DEF-015 — Negative amounts not rejected during CSV parse [SOLO]
- **Agents:** QA (DEF-QA-008 MEDIUM)
- **Severity:** Medium
- **Summary:** `parseCurrency` accepts negative numbers. Bank statements with credit reversals shown as negative `Out` values store negative `amount_out`, distorting P&L and vendor totals.
- **Code:** `receipts.ts:514` — `Number.parseFloat(cleaned)` with no sign check
- **Fix:** Reject negative values in `parseCurrency` (return `null` and log a parse warning) or take absolute value with a comment.
- **Test cases:** T012

---

### DEF-016 — matchDescription OR semantics not communicated to users [SOLO]
- **Agents:** QA (DEF-QA-010 MEDIUM)
- **Severity:** Medium
- **Summary:** The `match_description` field accepts comma-separated keywords treated as OR conditions (any one match is sufficient). Rule authors may expect AND semantics. The UI renders each token as a chip with no label indicating the logic. A rule "paypal,transfer" matches any transaction mentioning either word alone.
- **Code:** `rule-matching.ts:88–108`, `ReceiptRules.tsx` — `MatchDescriptionTokenPreview`
- **Fix:** Add a tooltip or label to the keyword chips in `ReceiptRules.tsx` explaining "matches if ANY of these appear" and document in the rule creation modal.
- **Test cases:** T049

---

### DEF-017 — No file type restriction on receipt attachments [SOLO]
- **Agents:** QA (DEF-QA-011 MEDIUM)
- **Severity:** Medium
- **Summary:** `receiptFileSchema` validates size but not file type. Executables, scripts, or arbitrary files can be stored in the receipts bucket.
- **Code:** `receipts.ts:375–380` — `receiptFileSchema` missing MIME type check
- **Fix:** Add MIME type allowlist: `['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'application/pdf']`.
- **Test cases:** T106

---

### DEF-018 — Rule preview uses unordered limit; underrepresents recent transactions [SOLO]
- **Agents:** QA (DEF-QA-015 LOW)
- **Severity:** Low
- **Summary:** `previewReceiptRule` fetches up to 2000 transactions with no `.order()`. For datasets >2000 transactions, the preview samples from oldest (insert-order) transactions, potentially undercounting matches in recent data.
- **Code:** `receipts.ts:3307`
- **Fix:** Add `.order('transaction_date', { ascending: false })` before `.limit(2000)` so the sample is most-recent-first.
- **Test cases:** T048

---

### DEF-019 — Fuzzy grouping display vs exact-match apply mismatch [CORROBORATED]
- **Agents:** Business Rules Auditor (FLAG 8), QA (test T079 notes)
- **Severity:** Medium
- **Summary:** In bulk review, the "Fuzzy group similar transactions" toggle groups transactions by normalised description. But `applyReceiptGroupClassification` always matches on exact `details` string. A user sees 12 fuzzy-grouped transactions and applies vendor, but only 5 (the exact-match ones) are actually updated.
- **Code:** `receipts.ts:2474` (apply uses `.eq('details', parsed.data.details)`)
- **Business Impact:** Silent under-application in fuzzy mode. User assumes more transactions were classified than actually were.
- **Fix:** Either (a) when fuzzy grouping is active, the apply should also use the fuzzy normalisation in its WHERE clause, or (b) the UI should display a count of "will update X transactions (exact match)" when applying.
- **Test cases:** T079 (fuzzy variant)

---

### DEF-020 — Three direction-detection functions with no canonical version [CORROBORATED]
- **Agents:** Business Rules Auditor (FLAG 6), Technical Architect (Technical Debt #2)
- **Severity:** Low
- **Summary:** `getTransactionDirection` is defined in both `receipts.ts:607` and `ai-classification.ts:19` (identical but duplicated). A third, more sophisticated `deriveDirection` function exists at `receipts.ts:573` for bulk review group suggestions. No single canonical implementation.
- **Fix:** Extract to `src/lib/receipts/direction.ts` and import everywhere. Keep `deriveDirection` as the canonical (most sophisticated) version.

---

### DEF-021 — Re-queue misses vendor-set, expense-missing transactions [SOLO]
- **Agents:** Business Rules Auditor (FLAG 5)
- **Severity:** Low
- **Summary:** `requeueUnclassifiedTransactions` targets `vendor_name IS NULL AND vendor_source IS NULL`. Transactions where AI set the vendor but failed to set the expense category are excluded. These are silently left with missing expense classification.
- **Code:** `receipts.ts:3239–3243`
- **Fix:** Add a second query pass that targets `expense_category IS NULL AND expense_category_source IS NULL AND amount_out > 0` (outgoing transactions needing expense, regardless of vendor status).

---

### DEF-022 — `receipt_transaction_logs.insert()` results unchecked in 6 places [CORROBORATED]
- **Agents:** QA (DEF-QA-016/017/018/019 LOW), Technical Architect (1.1, 1.3)
- **Severity:** Low (systemic logging gap)
- **Summary:** Across the codebase, 6 `receipt_transaction_logs.insert(...)` calls do not capture or check the returned `error`. Log failures are silently swallowed.
- **Locations:** `receipts.ts:1363`, `receipts.ts:951`, `receipts.ts:1470`, `ai-classification.ts:313–315`, `receipts.ts:2580`, and `deleteReceiptFile` log call.
- **Fix:** Destructure `{ error: logError }` from each call and `console.error` on failure (or use a shared `safeInsertLog` helper).

---

### DEF-023 — `OUTSTANDING_STATUSES` excludes `cant_find` — policy intent unclear [SOLO]
- **Agents:** Business Rules Auditor (FLAG 10.1)
- **Severity:** Low (needs policy decision)
- **Summary:** `OUTSTANDING_STATUSES = ['pending']` means `cant_find` transactions are excluded from the "Show only outstanding" filter. If `cant_find` represents an unresolved state requiring follow-up, they should be in this list.
- **Code:** `receipts.ts:41`
- **Resolution needed:** Confirm with stakeholders whether `cant_find` is a terminal state or a state requiring ongoing attention.

---

### DEF-024 — Export status label abbreviation "No receipt req." inconsistency [SOLO]
- **Agents:** Business Rules Auditor (FLAG 9.7)
- **Severity:** Low
- **Summary:** The export CSV renders `no_receipt_required` as "No receipt req." — the only abbreviated form. Everywhere else the full label "No receipt required" is used.
- **Code:** `export/route.ts:248`
- **Fix:** Change to "No receipt required" to match all other label uses.

---

### DEF-025 — Signed URL expiry: no UI warning when link expires [SOLO]
- **Agents:** QA (Coverage Gap #6)
- **Severity:** Low
- **Summary:** Receipt file signed URLs are valid for 5 minutes (`60 * 5`). If a user's tab stays open longer, clicking a receipt link produces a 403 with no explanation.
- **Fix:** Show a "Links expire after 5 minutes — refresh the page if links stop working" note near receipt thumbnails, or implement a client-side URL refresh on click.

---

## EXTERNAL DEPENDENCY RISKS (Out of Scope — Separate Review)

- **EXT-001:** `amount_total` computed column: used for sorting but not verified in migrations. If missing/incorrect, sort silently falls back to default. Requires schema review.
- **EXT-002:** `get_receipt_detail_groups` RPC fuzzy-grouping SQL logic not reviewed. Correctness of fuzzy normalisation is unknown.
- **EXT-003:** `count_receipt_statuses` RPC: summary counts derived from this RPC; not verified.
- **EXT-004:** OpenAI API: no explicit fetch timeout; a hung connection holds a job lease and causes retry (double billing). Requires timeout addition to the OpenAI client.

---

## Cross-Agent Consistency Notes

| Finding | Agents Agree? | Note |
|---------|---------------|------|
| DEF-004 file delete compliance risk | Severity disagreement | QA: HIGH, TA: Low. QA is correct — compliance risk elevates this. |
| DEF-012 orphaned storage on delete | Severity disagreement | QA: HIGH, TA: Low. High is correct given no recovery path. |
| DEF-009 double AI billing | QA partial coverage only | QA described the scenario in partial failure matrix but didn't log it as a numbered defect. TA did. Both agree on the mechanism. |
