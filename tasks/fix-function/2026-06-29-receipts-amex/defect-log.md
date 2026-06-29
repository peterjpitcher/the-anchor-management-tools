# Fix-Function Defect Log — /receipts (Amex Import)

19 distinct defects after de-duplication (2 merges from 21 verified findings). Ordered by severity, then confidence.

---

## FF-001 — vendor_source='import' is NOT locked against rule/AI override

- **Type:** Bug
- **Severity:** High
- **Confidence:** High
- **File:line:** `src/services/receipts/receiptMutations.ts:329` (also `src/lib/receipts/ai-classification.ts:169, 188, 248`)
- **Evidence:** `const vendorLocked = !overrideManual && transaction.vendor_source === 'manual'` — only `'manual'` is locked. Rows with `vendor_source='import'` (set in `parseAmexCsv` lines 572, 582) can be overridden by rules and AI. `ai-classification.ts:169` also only locks `'manual'`/`'rule'`.
- **Impact:** Amex fees/payments imported with `vendor_name='American Express'` and `expense_category='Bank Charges/Credit Card Commission'` can be overwritten by automation rules or AI, reclassifying `no_receipt_required` rows as if unclassified — defeating import-time classification.
- **Root cause:** Lock check omits the `'import'` vendor source.
- **Recommended fix:** Add `'import'` to the vendor_source lock in all four locations.
  - `receiptMutations.ts:329`: `const vendorLocked = !overrideManual && (transaction.vendor_source === 'manual' || transaction.vendor_source === 'import')`
  - `ai-classification.ts:169, 188, 248`: `const vendorLocked = transaction.vendor_source === 'manual' || transaction.vendor_source === 'rule' || transaction.vendor_source === 'import'`
- **Approval bucket:** Safe fix

## FF-002 — createAmexTransactionHash omits description; collisions on identical same-day amounts (amplified by empty externalReference)

- **Type:** Data risk
- **Severity:** High
- **Confidence:** High
- **File:line:** `src/services/receipts/receiptHelpers.ts:365-384` (collision amplifier at line 647)
- **Evidence:** Hash uses `[amex, transactionDate, signedAmount, cardAccount, rawCardMember, externalReference]`. Two different merchants, same day, same amount, same cardholder, missing reference produce an identical hash (collision confirmed in testing). `details` is available at `parseAmexCsv` line 630 but never passed to the hash. Line 647 sets `externalReference` to `null` when Reference is empty/quotes-only, which removes the only distinguishing component and amplifies the collision rate.
- **Impact:** Dedup silently drops one of two legitimate different purchases. Empty-reference rows (common in Amex CSVs) make this routine, not rare.
- **Root cause:** Hash excludes the merchant description; the externalReference component it relies on is frequently null.
- **Recommended fix:** Add `details` to the hash. (a) Add `details: string` to the function input signature (lines 365-371). (b) Append `input.details` to the `hash.update([...])` array (lines 373-381). (c) Pass `details` at the call site (lines 658-664). `details` is guaranteed non-empty at the call site (line 631 continues on empty), is deterministically sanitized, and is raw/stable from the CSV. Optionally log a warning when `externalReference` is null and a dedup match is triggered, to surface residual collision risk. Do NOT auto-apply a schema migration to regenerate existing hashes or change the upsert conflict strategy without explicit review.
- **Approval bucket:** Risky approval *(verifier flagged the externalReference-amplification analysis as not safe to auto-apply because the robust fix touches dedup strategy / existing-hash migration; the code-only `details` addition is the safe minimal step but the overall item carries migration/rollback risk)*

## FF-003 — Log insert failure after transaction insert is not rolled back

- **Type:** Bug
- **Severity:** High
- **Confidence:** Medium
- **File:line:** `src/services/receipts/receiptMutations.ts:776-780`
- **Evidence:** Transactions are inserted (lines 710-729), jobs enqueued (lines 737-762), then import logs inserted (line 776). If the log insert fails the function still returns success (lines 782-790).
- **Impact:** Entire batches imported with no `receipt_transaction_logs` audit trail; user sees success. Orphaned transactions with no recorded origin.
- **Root cause:** Log insert error is logged but not propagated.
- **Recommended fix:** After the `importLogError` console.error at lines 776-779, return an error instead of continuing:
  ```typescript
  if (importLogError) {
    console.error('Failed to record import transaction logs', importLogError)
    return { error: 'Failed to record import audit logs. Transactions were inserted but audit trail was not created. Please contact support.' }
  }
  ```
- **Approval bucket:** Safe fix

## FF-004 — Regex /\bFEE\b/ matches legitimate merchant descriptions containing "FEE"

- **Type:** UX gap
- **Severity:** High
- **Confidence:** High
- **File:line:** `src/services/receipts/receiptHelpers.ts:563`
- **Evidence:** `classifyAmexRow` line 563 checks `/\bFEE\b/.test(upper)`, matching RESORT FEE, BOOKING FEE, DELIVERY FEE, SERVICE FEE — legitimate hotel/travel/restaurant charges — marking them `no_receipt_required` under Bank Charges/Credit Card Commission.
- **Impact:** Real merchant fees are miscategorized and hidden from the receipt-chasing workflow.
- **Root cause:** Pattern too broad; Amex's own fees are specific keywords (MEMBERSHIP FEE, LATE PAYMENT FEE, INTEREST CHARGE), not any word-boundary "FEE".
- **Recommended fix:** Remove line 563. `isFee` becomes:
  ```typescript
  const isFee =
    upper.includes('INTEREST CHARGE') ||
    upper.includes('MEMBERSHIP FEE') ||
    upper.includes('LATE PAYMENT FEE')
  ```
- **Approval bucket:** Safe fix

## FF-005 — parseSignedAmount returns 0 for sub-penny amounts that round to zero

- **Type:** Bug
- **Severity:** High
- **Confidence:** High
- **File:line:** `src/services/receipts/receiptHelpers.ts:282-289`
- **Evidence:** `parseSignedAmount('0.001')` returns 0, not null. The `result === 0` check (line 287) runs before `.toFixed(2)` rounding; `0.001` passes, then rounds to `'0.00'` → 0 on return.
- **Impact:** Sub-penny amounts silently round to zero-amount transactions with `amountIn=null, amountOut=null`.
- **Root cause:** Zero-rejection check operates on the pre-rounded value.
- **Recommended fix:** Move the zero-check to after rounding (lines 287-289):
  ```typescript
  if (!Number.isFinite(result) || result === 0) return null
  const rounded = Number(result.toFixed(2))
  return rounded === 0 ? null : rounded
  ```
- **Approval bucket:** Safe fix

## FF-006 — CardMember filter applied independently of sourceType, orphans cardMember on Bank filter

- **Type:** Data risk
- **Severity:** High
- **Confidence:** High
- **File:line:** `src/services/receipts/receiptQueries.ts:291-297`
- **Evidence:** `sourceType` filter (291-293) and `cardMember` filter (295-297) are separate `.eq()` calls. With `sourceType='bank'` and `cardMember='John'`, the query becomes `.eq('source_type','bank').eq('card_member','John')`; `card_member` is always NULL for bank rows, so the result is empty. No validation prevents this.
- **Impact:** Silent empty result on an invalid filter combination; no error shown.
- **Root cause:** `cardMember` predicate not gated by `sourceType==='amex'`.
- **Recommended fix:** Guard at the page layer (page.tsx ~line 56, after `sourceType` is resolved): `const cardMember = sourceType === 'amex' && typeof resolvedParams?.cardMember === 'string' ? resolvedParams.cardMember : undefined`. Defense-in-depth at `receiptQueries.ts:295`: `if (filters.cardMember && filters.sourceType === 'amex') { baseQuery = baseQuery.eq('card_member', filters.cardMember) }`.
- **Approval bucket:** Risky approval *(verifier bucketed as Risky approval — touches query/data-filtering contract across two entry points)*

## FF-007 — CardMember filter persists when sourceType changes to bank/all

- **Type:** UX gap
- **Severity:** High
- **Confidence:** High
- **File:line:** `src/app/(authenticated)/receipts/_components/ui/ReceiptFilters.tsx:150-151`
- **Evidence:** `handleSourceChange()` does not clear `cardMember` when `sourceType` changes. User can hold a `cardMember` value while selecting `sourceType='bank'`; card members exist only on Amex rows (`receiptQueries.ts:332` `.eq('source_type','amex')`).
- **Impact:** On reload the persisted `cardMember` is applied to Bank rows (all NULL), silently returning 0 results with no explanation.
- **Root cause:** Source change does not reset the dependent cardMember filter.
- **Recommended fix:** In `handleSourceChange()`, clear `cardMember` when switching away from amex:
  ```typescript
  const newSourceType = event.target.value as LocalFilters['sourceType']
  const shouldClearCardMember = newSourceType !== 'amex'
  applyFilters({ ...localFilters, sourceType: newSourceType, cardMember: shouldClearCardMember ? '' : localFilters.cardMember })
  ```
- **Approval bucket:** Risky approval *(verifier bucketed as Risky approval)*

## FF-008 — Bank CSV header validation rejects valid edge-case column names

- **Type:** UX gap
- **Severity:** High
- **Confidence:** Medium
- **File:line:** `src/services/receipts/receiptHelpers.ts:195-202`
- **Evidence:** Validation requires exact `'Details'` and (`'In'` OR `'Out'`). Banks using `Debit`/`Credit` or `Amount Out`/`Amount In` (or different casing) fail with a generic rejection message. Pre-existing, not introduced by the Amex work, but brittle.
- **Impact:** Users with differently-named bank statement columns hit a confusing rejection. No data loss.
- **Root cause:** Strict exact-match header assumption.
- **Recommended fix:** Use case-insensitive, alias-aware matching at lines 195-202 (lowercase fields; accept `details`; accept `in`/`out`/`debit`/`credit`/`amount in`/`amount out`); store which column name was found and use the mapped names when reading rows (lines 208, 214-215). Expands acceptance only; existing logic handles null/undefined gracefully.
- **Approval bucket:** Out of scope *(verifier bucketed as Out of scope — pre-existing bank-parsing concern outside the Amex import focus)*

## FF-009 — Batch returned for re-imported file is from the prior import, not the current request

- **Type:** UX gap
- **Severity:** Medium
- **Confidence:** High
- **File:line:** `src/services/receipts/receiptMutations.ts:647-656`
- **Evidence:** On `source_hash` match (lines 641-645) the early return at line 654 returns `batch: existingBatch` — the previous import's batch, not the current upload.
- **Impact:** Re-uploading an identical file shows batch ID/metadata referencing a prior import; misleading "successfully imported" UI.
- **Root cause:** Early return surfaces the existing batch instead of signalling "no new batch created".
- **Recommended fix:** Change line 654 to `batch: null` (update the return type at lines 615-624 to allow `batch?: ... | null`). No downstream logic depends on the batch in the duplicate path (no inserts, no AI jobs, no automation); the warning already communicates the duplicate.
- **Approval bucket:** Risky approval *(verifier bucketed as Risky approval — return-contract / consumer change)*

## FF-010 — CardMember select shown for sourceType=bank; appears enabled but does nothing

- **Type:** UX gap
- **Severity:** Medium
- **Confidence:** High
- **File:line:** `src/app/(authenticated)/receipts/_components/ui/ReceiptFilters.tsx:190-192`
- **Evidence:** Visibility gated only by `availableCardMembers.length > 0` (line 190); that list is always from the Amex-only query (`receiptQueries.ts:332`). With `sourceType='bank'` active, the select renders and looks active but filters nothing.
- **Impact:** False affordance — selecting a cardholder while viewing Bank results silently no-ops.
- **Root cause:** Visibility not gated on `sourceType==='amex'`.
- **Recommended fix:** Line 190: `{availableCardMembers.length > 0 && localFilters.sourceType === 'amex' && (`.
- **Approval bucket:** Risky approval *(verifier bucketed as Risky approval)*

## FF-011 — availableCardMembers query lacks explicit limit; type signature hides incompleteness

- **Type:** Data risk
- **Severity:** Medium
- **Confidence:** High
- **File:line:** `src/services/receipts/receiptQueries.ts:329-333` (type at `src/services/receipts/types.ts:156`)
- **Evidence:** `cardMembersQuery` has no `.limit()`, unlike `vendorQuery` (line 317, `.limit(2000)`). PostgREST caps at 1000 rows by default, silently dropping cardholders beyond the first 1000. The type `availableCardMembers: string[]` (types.ts:156) gives consumers no completeness signal.
- **Impact:** On large datasets the cardholder filter dropdown is silently incomplete; no error surfaced.
- **Root cause:** Missing explicit limit on an unbounded query.
- **Recommended fix:** Add `.limit(2000)` to the `cardMembersQuery` chain (after line 333), matching `vendorQuery`.
- **Approval bucket:** Safe fix

## FF-012 — availableCardMembers de-duplication done in JavaScript instead of the database

- **Type:** Performance
- **Severity:** Medium
- **Confidence:** High
- **File:line:** `src/services/receipts/receiptQueries.ts:329-455`
- **Evidence:** The query fetches the raw `card_member` column for ALL Amex rows (329-333), then de-dupes in JS via `new Set(...)` (449-455). For 100k Amex rows / 50 cardholders, it fetches and de-dupes 100k rows in memory on every workspace load. The migration (lines 29-31) already created an index on `(card_member) WHERE source_type='amex'`.
- **Impact:** Unnecessary bandwidth, memory, and latency on page load.
- **Root cause:** Distinct done client-side rather than DB-side despite an available filtered index.
- **Recommended fix:** Use DB-level distinct: `.select('card_member', { distinct: true })` on the query (329-333), then simplify lines 449-455 to map/filter/sort without the `Set`. *(Note: combine with FF-011's `.limit(2000)`.)*
- **Approval bucket:** Safe fix

## FF-013 — AI job enqueue partial failure doesn't prevent import logs from recording success

- **Type:** Maintainability
- **Severity:** Medium
- **Confidence:** High
- **File:line:** `src/services/receipts/receiptMutations.ts:751-780`
- **Evidence:** Lines 751-762 enqueue AI jobs in a try-catch that only logs and sets a warning. A mid-way throw leaves some chunks enqueued and some lost; lines 764-780 then always record import logs with no queued-vs-failed distinction.
- **Impact:** Logs claim success while some transactions never get AI classification; jobs silently lost.
- **Root cause:** No per-transaction tracking of AI-job enqueue success; warning treated as a note, not a status.
- **Recommended fix:** Track and surface AI-job status: return `aiJobsQueued`/`aiJobsFailed` counts from `performImportReceiptStatement`, and/or include them in the transaction log note (e.g. `note: 'Imported via file.csv [AI jobs: ' + aiJobsQueued + '/' + insertedIds.length + ']'`). Observability-only; do NOT change behaviour to fail the whole import on AI-job failure.
- **Approval bucket:** Safe fix

## FF-014 — Batch cleanup may leave orphaned records if the delete fails

- **Type:** Maintainability
- **Severity:** Medium
- **Confidence:** High
- **File:line:** `src/services/receipts/receiptMutations.ts:720-727`
- **Evidence:** On transaction-insert failure, the orphaned batch (created line 661) is deleted (721-727); if that delete fails (725) the error is logged but the function returns "Failed to store the transactions" without telling the user a batch record remains.
- **Impact:** Orphaned batch records (`source_hash` set, no transactions) accumulate over repeated failed imports.
- **Root cause:** Batch-delete failure not surfaced.
- **Recommended fix:** When `batchDeleteError` is set (725-727), return an explicit error:
  ```typescript
  return { error: 'Failed to store transactions. Batch cleanup also failed — please contact support and reference the import attempt for manual resolution.' }
  ```
  Longer term, add a periodic job to purge empty batches.
- **Approval bucket:** Safe fix

## FF-015 — PAYMENT RECEIVED match uses includes() instead of startsWith()

- **Type:** UX gap
- **Severity:** Low
- **Confidence:** Medium
- **File:line:** `src/services/receipts/receiptHelpers.ts:558`
- **Evidence:** Line 558 uses `upper.includes('PAYMENT RECEIVED')` while CREDIT FOR uses `startsWith()`. A merchant like `XYZ PAYMENT RECEIVED SERVICES` would be misclassified (low real-world risk; Amex puts these at the start).
- **Impact:** Very low; defensive consistency.
- **Root cause:** Inconsistent matching style.
- **Recommended fix:** Line 558: `const isPayment = upper.startsWith('PAYMENT RECEIVED') || upper.startsWith('CREDIT FOR')`.
- **Approval bucket:** Safe fix

## FF-016 — ReceiptUpload sourceType toggle does not clear the selected file

- **Type:** UX gap
- **Severity:** Low
- **Confidence:** Medium
- **File:line:** `src/app/(authenticated)/receipts/_components/ui/ReceiptUpload.tsx:20-79`
- **Evidence:** The sourceType Select (line 74) has no handler resetting `statementFile`. Upload a Bank CSV, switch to Amex, click Upload → the Bank file is parsed as Amex (`parseAmexCsv` column mismatch), with an ambiguous error.
- **Impact:** User can submit a Bank CSV as Amex; confusing parse errors.
- **Root cause:** File state not reset on format change.
- **Recommended fix:** Line 74: `onChange={(event) => { setSourceType(event.target.value as 'bank' | 'amex'); setStatementFile(null); }}`.
- **Approval bucket:** Risky approval *(verifier bucketed as Risky approval)*

## FF-017 — Null source_hash not prevented by schema; legacy batches break dedup

- **Type:** Bug
- **Severity:** Low
- **Confidence:** High
- **File:line:** `src/services/receipts/receiptMutations.ts:660-669`
- **Evidence:** Batch insert (line 661) does not enforce `source_hash NOT NULL`. The duplicate check (line 644) `.eq('source_hash', sourceHash).maybeSingle()` returns nothing for NULL hashes; multiple NULL source_hashes are indistinguishable.
- **Impact:** Duplicate detection cannot work for legacy/NULL batches.
- **Root cause:** No NOT NULL constraint on `source_hash`.
- **Recommended fix:** New migration adding `NOT NULL` (or CHECK `source_hash IS NOT NULL`) on `receipt_batches.source_hash`. First verify/ backfill existing NULLs (`SELECT COUNT(*) ... WHERE source_hash IS NULL`; if any, `UPDATE ... SET source_hash = 'legacy-' || id::TEXT WHERE source_hash IS NULL`).
- **Approval bucket:** Risky approval *(schema migration with backfill — verifier bucket "Risky approval")*

## FF-018 — Missing test coverage: source_type defaults and dedup view source segregation

- **Type:** Missing test
- **Severity:** Low
- **Confidence:** High
- **File:line:** `src/services/receipts/receiptMutations.ts:678-680`; `supabase/migrations/20260714000001_receipt_duplicate_source_aware.sql:10-35`; `supabase/migrations/20260714000000_receipts_amex_source.sql:4-16`
- **Evidence:** Implementation is correct: bank rows default `source_type='bank'` (`?? 'bank'`, line 680); Amex rows set `'amex'` in `parseAmexCsv`; the dedup view recreation (migration `...000001` lines 10-35) faithfully matches the original plus the added `AND t1.source_type = t2.source_type` (line 22); `source_type` column is `NOT NULL DEFAULT 'bank'` with a CHECK constraint (migration `...000000` lines 4-16). No regressions — only test coverage is absent.
- **Impact:** None to runtime; risk of silent future regression without tests.
- **Root cause:** No tests asserting persisted `source_type` values or cross-source dedup exclusion.
- **Recommended fix:** Add tests that (a) bank imports persist `source_type='bank'` and Amex imports persist `'amex'` (mock the Supabase client and capture the upserted batch + transaction payloads), and (b) one bank + one amex row with identical date/amount/details yield zero rows from `receipt_duplicate_candidates` after `refresh_receipt_duplicate_candidates()`. Test-only.
- **Approval bucket:** Safe fix

## FF-019 — merchantHint in prompt text but not in JSON schema (working as designed)

- **Type:** Observability
- **Severity:** Low
- **Confidence:** High
- **File:line:** `src/lib/openai.ts:389`
- **Evidence:** Line 389 adds `merchant_hint: ${item.merchantHint}` to the user prompt's `itemsSection` (input only), ~1-2 tokens/transaction; `max_tokens` unchanged (line 457). The batch response schema (lines 412-424) intentionally excludes it, so parsing is unaffected.
- **Impact:** None — minimal token overhead, no schema/parse change.
- **Root cause:** N/A — intentional design (input-only context).
- **Recommended fix:** No code change needed. Optionally add a clarifying comment near line 412 noting input-only context fields are not part of the response schema.
- **Approval bucket:** Safe fix

---

## Recommended safe-fix batch (suggested apply order)

Order: data-correctness first, then logic/classification, then performance/observability, then tests/docs.

1. **FF-005** — parseSignedAmount zero-check after rounding (`receiptHelpers.ts`)
2. **FF-004** — remove broad `/\bFEE\b/` regex (`receiptHelpers.ts`)
3. **FF-015** — PAYMENT RECEIVED `startsWith()` (`receiptHelpers.ts`)
4. **FF-001** — lock `vendor_source='import'` in all 4 sites (`receiptMutations.ts`, `ai-classification.ts`)
5. **FF-003** — propagate import-log insert failure (`receiptMutations.ts`)
6. **FF-014** — surface batch-cleanup failure (`receiptMutations.ts`)
7. **FF-013** — surface AI-job enqueue status (`receiptMutations.ts`)
8. **FF-011** — add `.limit(2000)` to cardMembers query (`receiptQueries.ts`)
9. **FF-012** — DB-side distinct for cardMembers (`receiptQueries.ts`) — apply together with FF-011
10. **FF-018** — add source_type / dedup-view tests (test files only)
11. **FF-019** — optional clarifying comment (`openai.ts`)

## Risky / needs approval

- **FF-002** — hash `details` addition + collision handling — code-only `details` add is low risk, but the robust remedy touches dedup strategy / existing-hash regeneration (migration + rollback risk).
- **FF-006** — gate cardMember query on `sourceType==='amex'` across page + query layers (data-filtering contract).
- **FF-007** — clear cardMember on source change in `ReceiptFilters.tsx` (filter-state contract).
- **FF-009** — return `batch: null` for re-imported file; return-type/consumer change.
- **FF-010** — gate cardMember select visibility on `sourceType==='amex'`.
- **FF-016** — clear selected file on sourceType toggle in `ReceiptUpload.tsx`.
- **FF-017** — `source_hash NOT NULL` schema migration with NULL backfill (DB migration, rollback risk).

## Out of scope

- **FF-008** — flexible bank CSV header aliasing — pre-existing bank-parsing concern outside the Amex import focus.
