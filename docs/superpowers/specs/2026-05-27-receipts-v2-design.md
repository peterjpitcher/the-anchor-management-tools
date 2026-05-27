# Receipts v2 - Production Design

**Date:** 2026-05-27
**Status:** Updated from codebase and live Supabase review
**Scope:** Rule governance, canonical receipt vendors, learning signals, duplicate detection, and diagnostic reporting for the existing `/receipts` subsystem.

OCR is explicitly out of scope for Receipts v2. Uploaded receipt files remain supporting evidence for the accountant; the system does not extract vendor, date, VAT, or amount from the documents.

---

## 1. Decisions

1. **No OCR in v2.** Do not add OCR tables, prompts, settings, extraction jobs, mismatch UI, or OCR success criteria.
2. **PayPal BACS rows are EPOS/card settlement deposits.** The current PayPal-to-Zettle rule is conceptually valid but badly named. It should become an income-settlement rule such as `Zettle EPOS card deposits via PayPal BACS`.
3. **AI never closes receipt status by confidence alone.** `auto_completed` means trusted system completion only. AI may classify vendor/category when not locked, but it must not move a transaction to a terminal status.
4. **Receipt vendors are separate from invoice vendors.** `receipt_vendors` is the canonical model for receipt classification and aliases; it may optionally link to `invoice_vendors`.
5. **Rule governance is super-admin gated.** Suggested-rule approval, priority edits, physical rule deletion, and dangerous backfills require super admin.
6. **Duplicate handling is review-based.** Do not add a `voided` status. Candidate duplicates are reviewed as same/different/ignored without changing transaction status.

---

## 2. Current System Truth

### Stack

- Next.js `^15.5.14`, App Router, React `^19.1.0`, TypeScript, Tailwind v4.
- Supabase Postgres/Auth/Storage; service-role access is kept in server actions/services.
- Receipt actions live in `src/app/actions/receipts.ts` and delegate to `src/services/receipts/*`.
- Long-running work uses the existing `jobs` table and `src/lib/unified-job-queue.ts`.
- Receipt attachment uploads use signed Supabase Storage and are capped at 50 MB.

### Live Supabase Snapshot, 2026-05-27

| Metric | Value |
|---|---:|
| `receipt_transactions` | 2,939 |
| `pending` | 110 |
| `completed` | 542 |
| `auto_completed` | 0 |
| `no_receipt_required` | 2,263 |
| `cant_find` | 24 |
| Active receipt rules | 106 |
| Active rules ending at `pending` | 75 |
| Active rules ending at `no_receipt_required` | 31 |
| Active rules using amount constraints | 0 |
| Assigned vendors from rules | 2,526 |
| Assigned vendors from AI | 372 |
| Manual vendor assignments | 4 |
| Receipt file rows | 325 files on 312 transactions |
| Distinct vendor labels | 72 raw, 69 normalized |

### Existing Receipt Routes

- `/receipts`
- `/receipts/bulk`
- `/receipts/monthly`
- `/receipts/vendors`
- `/receipts/pnl`
- `/receipts/missing-expense`

Upgrade these routes before adding new navigation.

---

## 3. Target Architecture

### New Tables

| Table | Purpose |
|---|---|
| `receipt_vendors` | Canonical receipt vendor/supplier entity. |
| `receipt_vendor_aliases` | Normalized aliases from bank descriptions, manual edits, rules, AI, and migration. |
| `receipt_classification_signals` | Enriched audit/event stream for rule, AI, human, migration, and system signals. |
| `receipt_rule_suggestions` | Governed draft-rule inbox from repeated human corrections and AI keyword evidence. |
| `receipt_rule_conflicts` | Queue-backed conflict warnings for overlapping active rules. |
| `receipt_duplicate_reviews` | Human decisions for duplicate transaction/file candidates. |
| `receipt_anomalies` | Persisted informational/diagnostic reporting flags. |

Keep `receipt_transaction_logs` during transition and write both logs and signals.

### Existing Table Changes

| Table | Columns |
|---|---|
| `receipt_rules` | `priority`, `kind`, `vendor_id`, `reviewed_at`, `reviewed_by`, `deactivated_at`, `deactivated_by` |
| `receipt_transactions` | `vendor_id`, `auto_completed_reason` |
| `receipt_files` | `content_hash`, `hash_verified_at` |

All existing rules default to `priority=1000`, preserving current behavior unless a super admin deliberately changes priority.

---

## 4. Rule Engine and Governance

Current behavior already uses specificity selection in `src/lib/receipts/rule-matching.ts`; it is not pure first-match-wins. v2 changes the tie-break order to:

1. `priority ASC`
2. matched description length `DESC`
3. transaction type specificity
4. direction specificity
5. amount constraint count
6. `created_at ASC`

Requirements:

- Add unit tests for `getRuleMatch()` and selection ordering.
- Order DB rule loads by `priority ASC, created_at ASC`.
- Keep manual vendor/category classifications locked from rule and AI overwrites.
- Replace default hard delete with soft deactivate.
- Add super-admin-only physical delete for exceptional cleanup.
- Surface conflict warnings in the existing embedded `ReceiptRules` panel.

Rule cleanup:

- Soft-deactivate exact duplicate Amazon/Tesco rules after equivalent shadow comparison.
- Rename inbound PayPal/Zettle rule to `Zettle EPOS card deposits via PayPal BACS`.
- Mark PayPal/Zettle rule `kind='income_settlement'`, direction `in`, vendor `Zettle`, status `no_receipt_required`.
- Rename HMRC `sdds` rule to `HMRC SDDS`, preserving direct-debit matching.
- Mark payroll rules `kind='payroll'`.
- Remove unreliable default `Entertainment` from generic retailer rules where usage varies.

---

## 5. Canonical Vendors

`receipt_vendors` is intentionally separate from `invoice_vendors`.

Migration:

- Seed one `receipt_vendors` row per normalized current receipt `vendor_name`, plus rule target vendors needed for FK backfill.
- Seed `receipt_vendor_aliases` from every raw label.
- Backfill `receipt_transactions.vendor_id` and `receipt_rules.vendor_id`.
- Keep `vendor_name` and `set_vendor_name` as denormalized compatibility fields.
- Update monthly/vendor/P&L reporting to prefer canonical vendor IDs, falling back to rule vendor text and then transaction vendor text.

Do not make `receipt_transactions.vendor_id` non-null until aliases are reviewed.

---

## 6. Signals and Suggestions

`receipt_classification_signals` is the durable learning/audit stream.

Sources:

- `rule`
- `ai`
- `human`
- `migration`
- `system`

Backfill existing `receipt_transaction_logs` into signals. New rule, AI, manual, upload, and suggestion operations should continue writing legacy logs where needed while also writing signals.

`receipt_rule_suggestions`:

- created by a queue-backed `suggest_receipt_rules` job;
- based on repeated human corrections and AI keyword evidence;
- never auto-promoted;
- approval creates a rule only after super-admin review;
- approval records signals against evidence transactions.

---

## 7. Duplicate Detection

File duplicate detection:

- Add `receipt_files.content_hash`.
- Add `hash_verified_at` so trusted server-computed hashes are distinct from any future preflight hash.
- Use duplicate reviews instead of blocking all repeated hashes automatically.

Transaction duplicate detection:

- Add `CREATE EXTENSION IF NOT EXISTS pg_trgm;`.
- Add a materialized duplicate-candidate view comparing date proximity, amount tolerance, and description similarity.
- Add queue job `refresh_receipt_duplicate_candidates`.
- Store decisions in `receipt_duplicate_reviews`.
- Do not add a `voided` status.

---

## 8. Diagnostics

Upgrade existing pages:

- `/receipts/monthly`: missing-receipt liability, category variance, status coverage, monthly commentary later.
- `/receipts/vendors`: canonical vendor review state, alias review, unconfirmed vendors, watched vendor movements.
- `/receipts/pnl`: links to source transactions, unconfirmed vendor/category totals, informational concentration notes.

Greene King concentration should be informational by default. The live snapshot shows Greene King at roughly 46.6% of outgoing spend, which is expected for this venue context and not inherently critical.

---

## 9. Rollout

Recommended sequence:

1. Spec update.
2. Rule guardrails.
3. Rule engine ordering and governance.
4. Rule cleanup.
5. Canonical vendors.
6. Signals and suggestions.
7. Duplicate detection.
8. Diagnostics.

Each phase should be additive unless explicitly doing data cleanup, and every cleanup should be reversible through soft deactivation or documented rollback SQL.

---

## 10. Test Plan

- Unit tests for `getRuleMatch()` and priority/specificity ordering.
- Shadow-mode comparison across all current receipt transactions before priority changes are used.
- Manual classifications stay locked from rule/AI overwrite.
- Soft-deactivated rules no longer apply.
- Physical rule delete is super-admin-only.
- Canonical vendor fallback preserves monthly/vendor/P&L totals.
- Rule suggestion approval creates the expected active/disabled rule and records signals.
- Duplicate candidates can be marked same/different/ignored without changing transaction status.
- Run `npm run lint`.
- Run targeted Vitest tests.
- Run migration dry-run.
- Smoke test `/receipts`, `/receipts/bulk`, `/receipts/monthly`, `/receipts/vendors`, and `/receipts/pnl`.

---

## 11. Evidence

Primary code references:

- `src/lib/receipts/rule-matching.ts`
- `src/lib/receipts/ai-classification.ts`
- `src/lib/unified-job-queue.ts`
- `src/app/actions/receipts.ts`
- `src/services/receipts/receiptMutations.ts`
- `src/services/receipts/receiptQueries.ts`
- `src/app/(authenticated)/receipts/_components/ui/ReceiptRules.tsx`
- `src/types/database.ts`
- `src/types/database.generated.ts`
- `supabase/migrations`

Live database evidence was gathered on 2026-05-27 using the local service-role Supabase client.
