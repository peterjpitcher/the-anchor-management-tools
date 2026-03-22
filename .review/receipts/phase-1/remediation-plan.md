# Remediation Plan — Receipts Module
**Phase:** 1 → 2 transition
**Date:** 2026-03-07
**Status:** Awaiting user sign-off

---

## Scope Summary

25 defects identified. Grouped into 3 implementation batches by risk and dependency order.

| Group | Label | Defects | Rationale |
|-------|-------|---------|-----------|
| A | Critical safety + compliance | DEF-001–006 | Fix immediately; active risk to staff workflows and audit trail |
| B | Structural robustness | DEF-007–014 | Fix before next large data cycle; fragile under edge cases |
| C | Enhancements | DEF-015–025 | Address as a polish pass; low individual risk |

---

## Group A — Critical (6 fixes)

### A1: Add CSV file size limit to `fileSchema` (DEF-001)
**File:** `src/app/actions/receipts.ts:369`
**Change:** Add `file.size <= MAX_RECEIPT_UPLOAD_SIZE` condition to `fileSchema` (mirrors `receiptFileSchema`).
**Risk:** Low. Trivial guard addition.
**Test validation:** T004

### A2: Fix "Auto-matched" label in ReceiptStats (DEF-005)
**File:** `src/app/(authenticated)/receipts/_components/ui/ReceiptStats.tsx:83`
**Change:** Change `title="Auto-matched"` to `title="Auto completed"`.
**Risk:** Trivial.
**Test validation:** T093

### A3: Fix audit log in `deleteReceiptFile` (DEF-006)
**File:** `src/app/actions/receipts.ts:1860–1870`
**Change:** Move the `receipt_transaction_logs` insert to AFTER the remaining-files check, using the actual resulting status. If remaining files > 0, log `new_status: 'completed'`. If 0, log `new_status: 'pending'`.
**Risk:** Low. Audit log only — no change to actual transaction status logic.
**Test validation:** T108

### A4: Fix `deleteReceiptFile` — transaction stuck completed with no files (DEF-004)
**File:** `src/app/actions/receipts.ts:1876–1884`
**Change:** On `remainingError`, conservatively update the transaction to `pending` before returning the error. "If we cannot confirm files remain, treat as if none do."
**Risk:** Low-medium. One additional DB call on error path.
**Test validation:** T139

### A5: Wrap `applyAutomationRules` in try/catch inside import (DEF-003)
**File:** `src/app/actions/receipts.ts:1337`
**Change:** Wrap in try/catch. On catch, log the error to `console.error`, set `autoApplied`/`autoClassified` to 0, include a `warning` field in the returned success response.
**Risk:** Low. Changes error semantics only.
**Test validation:** T142

### A6: Compensating delete for orphaned batch record (DEF-002)
**File:** `src/app/actions/receipts.ts:1322–1334`
**Change:** After transaction upsert fails (`insertError`), attempt `supabase.from('receipt_batches').delete().eq('id', batch.id)` before returning the error. If the batch delete also fails, log it but still return the original error.
**Risk:** Low. Adds cleanup on an error path that currently does nothing.
**Test validation:** T018, T131

---

## Group B — Structural (8 fixes)

### B1: Surface AI enqueue failure in import response (DEF-008)
**File:** `src/app/actions/receipts.ts:1343–1348`
**Change:** In the catch block for `enqueueReceiptAiClassificationJobs`, instead of silently swallowing, include `warning: 'AI classification could not be queued — use the re-queue button to retry'` in the returned success result. Update the upload UI to display this warning as a toast.
**Dependency:** None. Independent of Group A.
**Test validation:** T132

### B2: Move `recordAIUsage` to after update loop (DEF-009)
**File:** `src/lib/receipts/ai-classification.ts`
**Change:** Move `await recordAIUsage(...)` to after the `for (const transaction of toClassify)` loop. Track how many transactions were actually updated and pass that count to usage recording.
**Risk:** Low-medium. Changes ordering; ensure no logic depends on usage being recorded first.
**Test validation:** T023

### B3: Fix per-transaction AI failure logging (DEF-014)
**File:** `src/lib/receipts/ai-classification.ts:242–244` and `287–294`
**Change:** In both `if (!classificationResult) { continue }` and `if (updateError) { console.error; continue }`, insert an `ai_classification_failed` log entry to `receipt_transaction_logs` before `continue`.
**Test validation:** T024, T132

### B4: Surface dead-letter classification failures in UI (DEF-010)
**File:** `src/app/actions/receipts.ts` — `getReceiptWorkspaceSummary` or a new helper
**Change:** Query `jobs` table for `type = 'classify_receipt_transactions' AND status = 'failed'`. Include count in workspace summary. Display as a warning banner in `ReceiptStats.tsx` when count > 0.
**Risk:** Low. Read-only query addition.
**Test validation:** T024

### B5: CSV export formula injection escaping (DEF-011)
**File:** `src/app/api/receipts/export/route.ts`
**Change:** Add `escapeCsvCell(value: string): string` helper that prefixes values starting with `=`, `+`, `-`, `@` with a tab character. Apply to all free-text columns (Details, Vendor, Notes) before `Papa.unparse`.
**Test validation:** T113

### B6: Fix bulk apply partial mutation — add RPC or merge update (DEF-007)
**File:** `src/app/actions/receipts.ts:2503–2548`
**Change:** If vendor and expense can be set simultaneously, merge into a single `UPDATE` call. If they have different row sets (expense skip for incoming), add compensating logic: if expense update fails after vendor commit, attempt to revert vendor update before returning error. Document in code that true atomicity requires a DB transaction (RPC).
**Risk:** Medium. Core bulk apply path.
**Test validation:** T079

### B7: Retro-run time budget: call finalize or partial-finalize on exit (DEF-013)
**File:** `src/app/actions/receipts.ts:2808–2831`
**Change:** On time-budget exit, call `finalizeReceiptRuleRetroRun(ruleId, { partial: true, processedCount: N })` — or inline the `revalidatePath` and a partial audit log entry directly. Ensures cache is refreshed and audit trail is written.
**Test validation:** T137

### B8: Orphaned storage file: write structured audit record (DEF-012)
**File:** `src/app/actions/receipts.ts:1830–1855`
**Change:** On double-failure (DB rollback fails after storage delete fails), write an `logAuditEvent` or `receipt_transaction_logs` entry containing `storage_path` so the orphan can be tracked. Include "orphaned_storage_file" as the `action_type`.
**Test validation:** T136

---

## Group C — Enhancements (11 fixes)

### C1: Negative amounts rejected in CSV parse (DEF-015)
`parseCurrency`: add `if (parsed < 0) return null`. Log parse warning.

### C2: matchDescription OR semantics documented in UI (DEF-016)
`ReceiptRules.tsx`: add tooltip "Matches if ANY of these words appear in the transaction description".

### C3: File type allowlist for receipt uploads (DEF-017)
`receiptFileSchema`: add MIME type check — PDF, PNG, JPG, JPEG, GIF, WEBP, HEIC.

### C4: Rule preview ordered by most-recent (DEF-018)
`previewReceiptRule`: add `.order('transaction_date', { ascending: false })` before `.limit(2000)`.

### C5: Fuzzy grouping apply: show exact match count or use fuzzy match (DEF-019)
`ReceiptBulkReviewClient.tsx` + `applyReceiptGroupClassification`: when fuzzy active, display "will update X transactions" count using exact match before applying.

### C6: Canonical direction function (DEF-020)
Extract `getTransactionDirection` to `src/lib/receipts/direction.ts`. Import in `receipts.ts` and `ai-classification.ts`. Use `deriveDirection` as the canonical version.

### C7: Re-queue also covers vendor-set, expense-missing (DEF-021)
`requeueUnclassifiedTransactions`: add second query for `expense_category IS NULL AND expense_category_source IS NULL AND amount_out IS NOT NULL AND amount_out > 0`.

### C8: Log insert results — systematic check (DEF-022)
Add `const { error: logError }` capture and `if (logError) console.error(...)` to all 6 unchecked `receipt_transaction_logs.insert()` calls. Consider a shared `safeInsertTransactionLog()` helper.

### C9: Clarify `OUTSTANDING_STATUSES` (DEF-023)
Policy decision needed: if `cant_find` is not terminal, add it. Add a code comment explaining the policy intent regardless.

### C10: Export label fix "No receipt required" (DEF-024)
`export/route.ts:248`: change "No receipt req." to "No receipt required".

### C11: Signed URL expiry UI note (DEF-025)
Add tooltip or small note near receipt file links: "Links are valid for 5 minutes. Refresh if a link stops working."

---

## Implementation Order (within each group)

Group A must complete before Group B work on the import/AI path (B1, B2 depend on A5 context).
Group B fixes are independent of each other except B4 which can be done anytime.
Group C is entirely independent and can be done in any order.

Recommended execution:
1. All Group A fixes (A2, A1, A3 first — trivial; A4, A5, A6 second — more careful)
2. Group B fixes B1–B5 (independent); B6 (bulk apply — review carefully)
3. Group C as a single sweep

---

## Definition of Done per Fix

Each fix is complete when:
- [ ] Code change implemented correctly
- [ ] Corresponding test case(s) from QA test matrix pass
- [ ] `npm run build` passes
- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes
- [ ] Commit message references defect ID (e.g. `fix: add CSV size limit to fileSchema (DEF-001)`)
