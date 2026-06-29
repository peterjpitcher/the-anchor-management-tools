# Amex statement import for /receipts — design

**Date:** 2026-06-29
**Status:** Approved (design) — pending spec review
**Author:** Peter Pitcher (with Claude)

## Goal

Extend the `/receipts` section so it can import American Express statement CSVs in
addition to the existing bank-statement CSVs, and make the UI clearly distinguish a
**bank** transaction from a **credit-card (Amex)** transaction so staff know where to
look when reconciling a charge. Capture the additional useful metadata Amex provides
(cardholder, card account, merchant category, merchant town, reference).

## Non-goals

- No API integration with American Express — CSV upload only.
- No new payment-method types beyond `bank` and `amex` (the model allows more later,
  but we only build these two).
- No change to auth, RBAC, the AI/rules engines, invoice reconciliation logic, or the
  existing bank-statement import path.
- No change to the expense-category taxonomy.

## Decisions (from brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Do Amex purchase lines need a receipt? | **Yes** — each purchase imported as `pending` / `receipt_required = true`, exactly like bank spend. |
| 2 | Capture which cardholder made the charge? | **Yes** — store and display `Card Member` + account; allow filtering by cardholder. |
| 3 | Non-purchase rows (payments, interest, fees)? | **Import & auto-handle** — credits/payments → `no_receipt_required`; fees/interest → `no_receipt_required` + `Bank Charges/Credit Card Commission`. |
| 4 | How to choose bank vs Amex on upload? | **Explicit Bank/Amex toggle** next to the file picker (not auto-detect). |

## Current state (discovery summary)

- **UI**: `receipts/page.tsx` → `ReceiptsClient` → upload card `ui/ReceiptUpload.tsx`
  (single `.csv` file input) and list `ui/ReceiptList.tsx` →
  `ui/ReceiptTableRow.tsx` (desktop) / `ui/ReceiptMobileCard.tsx` (mobile);
  filters in `ui/ReceiptFilters.tsx`. The live client is `ReceiptsClient` (verified —
  no dead-duplicate trap on the page itself).
- **Action**: `importReceiptStatement(formData)` in `src/app/actions/receipts.ts`
  (RBAC `receipts.manage`, audit logged).
- **Service**: `performImportReceiptStatement()` in
  `src/services/receipts/receiptMutations.ts`.
- **Helpers** (`src/services/receipts/receiptHelpers.ts`): `parseCsv()` expects exact
  bank headers `Date, Details, Transaction Type, In, Out, Balance`; `normaliseDate()`
  already parses `DD/MM/YYYY` and ISO; `parseCurrency()` **rejects negatives** by design
  (line ~265); `createTransactionHash()` is a 6-field SHA-256 hash that includes
  `Balance`.
- **DB**: `receipt_transactions` (with `dedupe_hash` UNIQUE, `batch_id` FK), plus
  `receipt_batches`, `receipt_files`, `receipt_rules`, `receipt_transaction_logs`, and v2
  vendor/governance tables. **No card/source columns exist today.** RLS is
  service-role-only on all receipt tables.
- **Dedup**: SHA-256 of all 6 bank fields → `dedupe_hash` (UNIQUE), upsert with
  `ignoreDuplicates: true`; batch-level `source_hash` on `receipt_batches`.
- **Post-import**: rules engine (`applyAutomationRules`) then async AI classification
  (`enqueueReceiptAiClassificationJobs`), classification source recorded as `import` /
  `rule` / `ai` / `manual`.

## The Amex CSV format

Header (13 columns):
`Date, Description, Card Member, Account #, Amount, Extended Details,
Appears On Your Statement As, Address, Town/City, Postcode, Country, Reference, Category`

| Field | Notes |
|-------|-------|
| `Date` | `DD/MM/YYYY` — reuse `normaliseDate()`. |
| `Description` | Primary merchant/description string → `details`. |
| `Card Member` | Cardholder, e.g. `MR P PITCHER`. Multiple per account. |
| `Account #` | Card identifier, e.g. `-71001`, `-71019`. |
| `Amount` | **Single signed value**: positive = spend, negative = payment/credit. |
| `Appears On Your Statement As` | Sometimes a cleaner merchant name; fallback for `details`. |
| `Town/City` | → `merchant_town`. |
| `Reference` | Wrapped in single quotes in the file, e.g. `'AT2610...'`. Strong dedup key → `external_reference`. |
| `Category` | Amex's own taxonomy (e.g. `General Purchases-Groceries`) → `merchant_category` (hint only; not mapped to HMRC categories). |
| Address / Postcode / Country / Extended Details | Not stored (low value); may be folded into AI context only if trivially available. |

Special (non-purchase) rows observed across the three sample files:
`MEMBERSHIP FEE`, `INTEREST CHARGE`, `LATE PAYMENT FEE`, `CREDIT FOR INTEREST CHARGE`,
`CREDIT FOR LATE PAYMENT CHARGE`, `PAYMENT RECEIVED - THANK YOU`.

## Design

### 1. Database migration (additive only)

New migration `supabase/migrations/<timestamp>_receipts_amex_source.sql`:

On `receipt_transactions`:
- `source_type TEXT NOT NULL DEFAULT 'bank'` with `CHECK (source_type IN ('bank','amex'))`.
- `card_member TEXT NULL`
- `card_account TEXT NULL`
- `merchant_category TEXT NULL`
- `merchant_town TEXT NULL`
- `external_reference TEXT NULL`
- Index: `idx_receipt_transactions_source_type (source_type)`; partial index on
  `card_member` where `source_type = 'amex'` for the cardholder filter.

On `receipt_batches`:
- `source_type TEXT NOT NULL DEFAULT 'bank'` with the same CHECK.

Existing rows backfill to `bank` via the column default. **No drops, no destructive
changes** — therefore no PL/pgSQL function audit is required (per workspace Supabase
rules, that audit is only mandatory for `DROP COLUMN`/`DROP TABLE`). Confirm timestamp
does not collide with existing migrations.

### 2. Types & validation

- `src/types/database.ts` — add the six fields to `ReceiptTransaction`, add
  `source_type` to `ReceiptBatch`, add `ReceiptSourceType = 'bank' | 'amex'`.
- `src/types/database.generated.ts` — regenerate (or hand-edit to match) Row/Insert/Update.
- `src/lib/validation.ts` — `receiptSourceTypeSchema = z.enum(['bank','amex'])`.
- `src/services/receipts/types.ts` — add `AmexCsvRow` and extend `ParsedTransactionRow`
  with optional `sourceType`, `cardMember`, `cardAccount`, `merchantCategory`,
  `merchantTown`, `externalReference`, plus optional pre-resolved `status` /
  `receiptRequired` / `expenseCategory` for non-purchase rows.

### 3. Parser (`receiptHelpers.ts`)

- `parseSignedAmount(value): number | null` — strips commas/£, parses a signed float,
  returns `null` for empty/zero/invalid (keeps the sign). **`parseCurrency()` is left
  untouched** so the bank path keeps rejecting negatives.
- `parseAmexCsv(buffer): ParsedTransactionRow[]`:
  - PapaParse with `header: true` (handles quoted multi-line address fields, as the bank
    parser already relies on).
  - Validates Amex headers are present (e.g. requires `Card Member` and `Amount`); throws
    a clear error if a bank CSV is uploaded under the Amex toggle (and vice versa).
  - `details = sanitizeText(Description || 'Appears On Your Statement As')`; skip rows
    with no date or no usable amount.
  - Sign split: `amount > 0 → amountOut = amount, amountIn = null`;
    `amount < 0 → amountIn = abs(amount), amountOut = null`.
  - Strip the wrapping single quotes from `Reference`; normalise `Account #` to digits
    for `cardAccount`; title-case `Card Member` for display storage.
  - Non-purchase classification (deterministic, Amex-scoped):
    - description matches `PAYMENT RECEIVED` or starts with `CREDIT FOR` → `status =
      no_receipt_required`, `receiptRequired = false`.
    - description matches `INTEREST CHARGE` / `MEMBERSHIP FEE` / `LATE PAYMENT FEE`
      (and generic `… FEE`) → `status = no_receipt_required`, `receiptRequired = false`,
      `expenseCategory = 'Bank Charges/Credit Card Commission'`, source `import`.
    - any other negative amount (merchant refund) → `no_receipt_required` (credits are
      not purchases to chase).
    - otherwise (positive spend) → `status = pending`, `receiptRequired = true`.
- `createAmexTransactionHash(input)` — SHA-256 of
  `['amex', transactionDate, details, cardMember, cardAccount, signedAmount,
  externalReference].join('|')`. The `'amex'` prefix guarantees no collision with bank
  hashes. `Reference` makes it robust even if a cardholder buys the same item twice on a
  day.

### 4. Import service (`receiptMutations.ts`)

- `performImportReceiptStatement(file, sourceType)`:
  - branches: `sourceType === 'amex'` → `parseAmexCsv`, else `parseCsv`.
  - inserts the new columns (`source_type`, `card_member`, `card_account`,
    `merchant_category`, `merchant_town`, `external_reference`) plus any pre-resolved
    status/receipt_required/expense_category from non-purchase classification.
  - `receipt_batches` row records `source_type` and `original_filename`.
  - Post-insert: run `applyAutomationRules` + AI queue on the **purchase** rows only
    (non-purchase rows already terminal); same as today for bank rows.
  - Returns the existing shape `{ inserted, autoApplied, autoClassified }`.

### 5. Server action (`src/app/actions/receipts.ts`)

- `importReceiptStatement(formData)` reads `formData.get('sourceType')`, validates with
  `receiptSourceTypeSchema` (default `bank` for backwards compatibility), passes it
  through. Audit `additional_info` gains `sourceType`. RBAC unchanged.
- `ReceiptWorkspaceFilters` gains `sourceType?: 'bank' | 'amex'` and
  `cardMember?: string`.

### 6. Queries (`receiptQueries.ts`)

- Add the six columns to the workspace select and to the workspace row type.
- Apply `source_type` and `card_member` filters when present.
- Return the distinct list of Amex card members (for the cardholder filter dropdown).

### 7. UI

- **`ui/ReceiptUpload.tsx`** — a Bank/Amex toggle implemented with the `@/ds` `Select`
  (two options, default `bank`) above the file input; included in the `FormData` as
  `sourceType`. Copy/labels update ("Upload statement" / accept bank or Amex CSV).
  Validation message reflects the selected format.
- **`ui/ReceiptTableRow.tsx` / `ui/ReceiptMobileCard.tsx`** — a source badge: neutral
  **Bank** pill vs a distinct-tone **Amex** pill with a card icon (design tokens only, no
  hex). For Amex rows, show the cardholder name (and merchant town if present) near the
  details. Use existing `@/ds` badge/pill primitives.
- **`ui/ReceiptFilters.tsx`** — a **Source** filter (All / Bank / Amex), always shown,
  and a **Cardholder** filter (All / each card member) shown only when the distinct
  card-member list is non-empty (i.e. some Amex transactions exist). Wired through URL
  params in `page.tsx` like existing filters.
- **`page.tsx`** — parse `source` and `cardMember` search params into `filters`.

### 8. Export

Quarterly/CSV export (`ui/ReceiptExport.tsx` + its action/lib) gains **Source** and
**Cardholder** columns so the accountant can see which charges are card vs bank. No
change to the PDF pack layout beyond an added column/label.

## Data flow

```
Upload (Bank|Amex toggle + CSV)
  └─> importReceiptStatement(formData: statement, sourceType)   [action, RBAC + audit]
        └─> performImportReceiptStatement(file, sourceType)     [service]
              ├─ sourceType=amex → parseAmexCsv  → ParsedTransactionRow[] (+source meta, +pre-resolved status)
              ├─ sourceType=bank → parseCsv       → ParsedTransactionRow[]
              ├─ upsert receipt_transactions (onConflict dedupe_hash, ignoreDuplicates)
              ├─ insert receipt_batches (source_type, filename, row_count)
              ├─ applyAutomationRules(purchaseRows)
              └─ enqueueReceiptAiClassificationJobs(purchaseRows)
  └─> list + filters distinguish source/cardholder; export includes source columns
```

## Error handling

- Wrong CSV for the chosen toggle → parser throws a clear, user-facing error
  ("This doesn't look like an Amex statement — expected a 'Card Member' column").
- Malformed/zero amounts and undated rows are skipped (same posture as bank import).
- Re-importing the same Amex file → 0 inserted (dedup via `dedupe_hash`); batch
  `source_hash` also guards the whole file.
- Negative bank amounts still rejected (no regression).

## Testing

New/updated Vitest specs (mock Supabase; pure helpers tested directly):
- `parseSignedAmount`: positive/negative/zero/comma/£/blank.
- `parseAmexCsv`: header detection, signed-amount split into in/out, `DD/MM/YYYY`
  parsing, Reference unquoting, account normalisation, non-purchase classification
  (payment, interest, membership fee, late fee, credit-for, refund), dedup-hash
  stability and idempotency (same row twice → same hash; bank vs Amex same date+amount →
  different hash).
- Regression: `parseCsv` (bank) output unchanged; `parseCurrency` still rejects negatives.
- Run against the three real sample CSVs to confirm row counts and classifications.

Minimum bar: happy path + ≥1 error/edge case per new function (meets project testing
rules).

## Files touched

| File | Change |
|------|--------|
| `supabase/migrations/<ts>_receipts_amex_source.sql` | new — additive columns + indexes |
| `src/types/database.ts` | new fields + `ReceiptSourceType` |
| `src/types/database.generated.ts` | regenerate row/insert/update |
| `src/lib/validation.ts` | `receiptSourceTypeSchema` |
| `src/services/receipts/types.ts` | `AmexCsvRow`, extend `ParsedTransactionRow` |
| `src/services/receipts/receiptHelpers.ts` | `parseSignedAmount`, `parseAmexCsv`, `createAmexTransactionHash` |
| `src/services/receipts/receiptMutations.ts` | branch import on `sourceType`, insert new columns |
| `src/services/receipts/receiptQueries.ts` | select + filter new columns, distinct card members |
| `src/app/actions/receipts.ts` | `sourceType` param, filters, audit info |
| `src/app/(authenticated)/receipts/page.tsx` | parse `source` + `cardMember` params |
| `src/app/(authenticated)/receipts/_components/ui/ReceiptUpload.tsx` | Bank/Amex toggle |
| `src/app/(authenticated)/receipts/_components/ui/ReceiptTableRow.tsx` | source badge + cardholder |
| `src/app/(authenticated)/receipts/_components/ui/ReceiptMobileCard.tsx` | source badge + cardholder |
| `src/app/(authenticated)/receipts/_components/ui/ReceiptFilters.tsx` | Source + Cardholder filters |
| `src/app/(authenticated)/receipts/_components/ui/ReceiptExport.tsx` (+ export lib/action) | Source/Cardholder columns |
| `src/services/receipts/__tests__/…` | new unit tests |

## Assumptions / defaults (not separately confirmed)

- `source_type` lives on the transaction (denormalised for filtering/display) and is also
  recorded on the batch.
- Amex `Category` is stored as a hint only and is **not** mapped into the HMRC expense
  taxonomy; AI/rules still drive `expense_category` for purchases.
- Amex rows flow through the **same** rules + AI classification as bank rows (for
  consistency).
- Invoice reconciliation (`INV-*` matching) is left running unchanged; Amex merchant
  strings won't generally contain `INV-` patterns, so it is effectively a no-op for Amex
  and needs no special skip.
- One `receipt_batches` row per uploaded file (existing model reused); statement period is
  not separately stored (derivable from transaction dates).
- Address / Postcode / Country / Extended Details are not persisted.

## Rollback

Pure additive migration. Rollback = drop the six `receipt_transactions` columns and the
`receipt_batches.source_type` column (no data loss for existing bank rows). Application
code changes are independently revertable; with the columns present but UI reverted,
existing bank flows are unaffected.

## Complexity

Score **4 (L)** — 14+ files, schema change (additive), new parser + UI. Independently
deployable: migration first, then service/action, then UI. No breaking changes to the
existing bank flow.
