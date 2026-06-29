# Review brief — American Express statement import for `/receipts`

**Branch:** `feat/receipts-amex-import` (16 commits ahead of `main`)
**Author:** Peter Pitcher (with Claude) · **Date:** 2026-06-29
**Spec:** `docs/superpowers/specs/2026-06-29-amex-receipts-import-design.md`
**Plan:** `docs/superpowers/plans/2026-06-29-amex-receipts-import.md`
**QA defect log:** `tasks/fix-function/2026-06-29-receipts-amex/defect-log.md`

---

## 1. What this does and why

The `/receipts` workspace could only import **bank-statement** CSVs. This adds **American Express statement CSV** import alongside it, and makes the UI clearly distinguish a **bank** transaction from a **credit-card (Amex)** transaction so staff know where to look when reconciling a charge. It also captures the extra metadata Amex provides (cardholder, card account, merchant category, merchant town, reference).

The whole existing bank pipeline is reused — import → dedupe → rules → AI classification → list → export. Amex is added as a second *format* plus a `source_type` carried on each transaction. No table fork, no auth change.

## 2. The Amex format (and how it differs from bank)

| Concern | Bank CSV (existing) | Amex CSV (new) |
|---|---|---|
| Amount | two positive columns `In`/`Out` | one **signed** `Amount` (positive = spend, negative = payment/credit) |
| Balance | present (part of dedup hash) | absent → Amex needs its own hash |
| Identity | n/a | `Card Member`, `Account #`, `Reference`, `Category`, `Town/City` |
| Special rows | n/a | membership/interest/late fees, `PAYMENT RECEIVED`, `CREDIT FOR…` |

**Classification at import (Amex only, deterministic):**
- Positive spend → `pending`, `receipt_required = true` (chase a VAT receipt, same as bank spend).
- Fees (`INTEREST CHARGE` / `MEMBERSHIP FEE` / `LATE PAYMENT FEE`) → `no_receipt_required`, expense `Bank Charges/Credit Card Commission`, vendor `American Express`, source `import`.
- Payments/credits (negative; `PAYMENT RECEIVED` / `CREDIT FOR…` / refunds) → `no_receipt_required`.
- Purchases keep vendor/expense null so the existing **rules + AI** still classify them.

Verified against three real statements: 38 rows → 30 pending, 4 fees → Bank Charges, 4 credits → `amount_in`; 0 hash collisions.

## 3. Data model — 3 migrations (NOT yet applied to the live DB)

1. `20260714000000_receipts_amex_source.sql` — **additive**: `source_type` (`bank`|`amex`, default `bank`, CHECK), `card_member`, `card_account`, `merchant_category`, `merchant_town`, `external_reference` on `receipt_transactions`; `source_type` on `receipt_batches`; 3 indexes. Existing rows backfill to `bank`.
2. `20260714000001_receipt_duplicate_source_aware.sql` — recreates the `receipt_duplicate_candidates` materialized view + its index/refresh function/grants, adding `AND t1.source_type = t2.source_type` so a bank and an Amex row of the same date/amount aren't flagged as duplicates. **Reviewer: confirm this view recreation is faithful to the original in `20260701000010_receipts_v2_foundations.sql`** (an independent review found it faithful — please double-check).
3. `20260714000002_receipt_batches_source_hash_not_null.sql` — backfills any NULL `source_hash` to `'legacy-' || id` then sets the column `NOT NULL`, so the new duplicate-**file** guard is reliable. **Touches existing data (backfill) — review before applying.**
4. `20260714000003_get_amex_card_members.sql` — adds a `service_role`-only `get_amex_card_members()` function returning the distinct cardholder list for the filter (additive).

> ⚠️ **Deploy sequencing:** the application code reads/writes the new columns, so **migrations 1–3 must be applied before (or together with) the code deploy**, or queries to the new columns will fail. `anchor-management-tools` auto-deploys `main`.

## 4. Key behaviour changes to scrutinise

- **Bank/Amex toggle on upload** (`ReceiptUpload.tsx`) — the user picks the format; both parsers now validate headers and reject the wrong file with a clear message.
- **Duplicate-file guard** (`receiptMutations.ts`) — re-importing the same file now returns `inserted: 0` with a warning and creates **no** batch. This applies to **both** bank and Amex (a behaviour change for bank: previously a re-import created an empty batch). Confirm this is desirable.
- **`source_type`/`card_member` filters + source badge** (workspace list, filters, mobile card) — cardholder filter is gated to Amex across page, UI, and query layers.
- **Export** (`/api/receipts/export`) — two appended columns: `Source`, `Cardholder`.
- **AI** — Amex rows pass `merchant_category`/`merchant_town` as a prompt hint (input only; response schema unchanged).
- **P&L** — no change needed: `financials.ts` aggregates by expense category, so a `no_receipt_required` bank→Amex payment is already excluded (no double-count). Please confirm.

## 5. QA pass (fix-function) already run

An adversarial multi-agent review surfaced **19 verified defects**; **14 safe/low-risk ones were fixed** in commit `487acf63` (e.g. locking `source='import'` against rule/AI override; adding merchant details to the Amex dedup hash; dropping an over-broad `\bFEE\b` rule that hid real "BOOKING FEE" purchases; rounding sub-penny amounts; gating the cardholder filter). FF-017 and FF-012 (cardholder list now via a DB function) were then implemented. **Deliberately not done:** FF-008 (flexible/aliased bank-CSV headers — YAGNI; the bank export uses fixed `Details`/`In`/`Out` headers, so the guard can't regress anything real) and the structural FF-002 dedup-strategy rethink (already mitigated by adding merchant details to the hash — 0 collisions on real data). Neither is a live defect.

## 6. Testing done

- `vitest run` — **467 files / 3034 tests pass** (45 new), no regressions.
- `eslint --max-warnings=0` — clean.
- `npm run build` — succeeds.
- Real-CSV smoke against the three actual statements — correct, stable, 0 collisions.

## 7. Suggested review order

1. `src/services/receipts/receiptHelpers.ts` — `parseAmexCsv`, `parseSignedAmount`, `createAmexTransactionHash`, `classifyAmexRow` (the core logic + edge cases).
2. `src/services/receipts/receiptMutations.ts` — `performImportReceiptStatement` (dup-file guard, per-row payload, per-row log status, the **four** preserved post-insert jobs).
3. The three migrations (esp. the view recreation + the `NOT NULL` backfill).
4. `receiptQueries.ts` (filters + `availableCardMembers`) and the UI (`ReceiptUpload`, `ReceiptFilters`, `ReceiptTableRow`, `ReceiptMobileCard`, `page.tsx`).
5. `src/app/api/receipts/export/route.ts`, `src/lib/receipts/ai-classification.ts`, `src/lib/openai.ts`.

**Highest-risk areas:** the duplicate-candidate view recreation (faithfulness), the dup-file guard behaviour change for bank, and the Amex dedup hash for empty-`Reference` rows.

## 8. Rollback

All schema changes are additive except the `source_hash` `NOT NULL` (migration 3). Code is independently revertable; with the columns present but the UI reverted, existing bank flows are unaffected. No customer-facing or payment behaviour is touched.
