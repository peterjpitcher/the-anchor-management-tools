# Amex statement import for /receipts — design

**Date:** 2026-06-29
**Status:** Approved (design) — review feedback incorporated; pending final spec review
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
- No change to auth, RBAC, the AI/rules engines, or invoice reconciliation logic.
- No change to the existing bank-statement import path's output for a given bank CSV
  (the only deliberate behaviour change shared with the bank path is the new
  duplicate-file guard in §4, which is an improvement).
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
- **Service**: `performImportReceiptStatement(userId, userEmail, receiptFile, buffer)` in
  `src/services/receipts/receiptMutations.ts`.
- **Helpers** (`src/services/receipts/receiptHelpers.ts`): `parseCsv()` expects bank
  headers `Date, Details, Transaction Type, In, Out, Balance` but **does not validate
  them** — it simply skips rows it can't read; `normaliseDate()` already parses
  `DD/MM/YYYY` and ISO; `parseCurrency()` **rejects negatives** by design (line ~265);
  `createTransactionHash()` is a 6-field SHA-256 hash that includes `Balance`.
- **DB**: `receipt_transactions` (with `dedupe_hash` UNIQUE, `batch_id` FK), plus
  `receipt_batches`, `receipt_files`, `receipt_rules`, `receipt_transaction_logs`, and v2
  vendor/governance tables (incl. `receipt_duplicate_reviews`). **No card/source columns
  exist today.** RLS is service-role-only on all receipt tables.
- **Dedup**: SHA-256 of all 6 bank fields → `dedupe_hash` (UNIQUE), upsert with
  `ignoreDuplicates: true`. `receipt_batches.source_hash` (SHA-256 of the file buffer) is
  **stored but not enforced** — there is no unique index and no pre-check, so re-importing
  the same file creates a **new batch row** even though 0 transactions insert. (This spec
  fixes that; see §4.)
- **Post-import** (the import currently runs ALL of these — none may be dropped):
  1. `applyAutomationRules(insertedIds)` (rules engine),
  2. `enqueueReceiptAiClassificationJobs(insertedIds, batchId)` (async AI),
  3. `enqueueReceiptSystemJob('reconcile_receipt_invoice_payments', batchId, {transaction_ids})`,
  4. `enqueueReceiptSystemJob('refresh_receipt_duplicate_candidates', batchId)`,
  5. inserts `receipt_transaction_logs` with `action_type: 'import'` and a **hard-coded
     `new_status: 'pending'`**.
  Classification source recorded as `import` / `rule` / `ai` / `manual`.

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

New migration `supabase/migrations/20260714000000_receipts_amex_source.sql` (latest
existing is `20260713000000_…`; confirm no collision at build time).

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

If the duplicate-candidate detection is implemented as a SQL function/RPC (see "Affected
downstream paths"), make it `source_type`-aware **in this same migration** so it doesn't
flag a bank row and an Amex row of the same date/amount as duplicates.

Existing rows backfill to `bank` via the column default. **No drops, no destructive
changes** — therefore no PL/pgSQL function audit is required (per workspace Supabase
rules, that audit is only mandatory for `DROP COLUMN`/`DROP TABLE`).

### 2. Types & validation

- `src/types/database.ts` — add the six fields to `ReceiptTransaction`, add
  `source_type` to `ReceiptBatch`, add `ReceiptSourceType = 'bank' | 'amex'`.
- `src/types/database.generated.ts` — regenerate (or hand-edit to match) Row/Insert/Update.
- `src/lib/validation.ts` — `receiptSourceTypeSchema = z.enum(['bank','amex'])`.
- `src/services/receipts/types.ts` — add `AmexCsvRow` and extend `ParsedTransactionRow`
  with optional `sourceType`, `cardMember` (display), `rawCardMember` (hash),
  `cardAccount`, `merchantCategory`, `merchantTown`, `externalReference`, plus optional
  pre-resolved `status` / `receiptRequired` / `expenseCategory` / `expenseCategorySource`
  / `vendorName` / `vendorSource` for non-purchase rows. Defaults keep the bank path
  identical (`sourceType: 'bank'`, no card fields, pending/true).

### 3. Parser (`receiptHelpers.ts`)

- `parseSignedAmount(value): number | null` — strips commas/£, parses a signed float,
  returns `null` for empty/zero/invalid (keeps the sign). **`parseCurrency()` is left
  untouched** so the bank path keeps rejecting negatives.
- `parseAmexCsv(buffer): ParsedTransactionRow[]`:
  - PapaParse with `header: true` (handles quoted multi-line address fields, as the bank
    parser already relies on).
  - **Header validation**: require the Amex columns (`Card Member`, `Amount`); throw a
    clear error if they're absent (e.g. a bank CSV uploaded under the Amex toggle).
  - `details = sanitizeText(Description || 'Appears On Your Statement As')`; skip rows
    with no date or no usable amount.
  - Sign split: `amount > 0 → amountOut = amount, amountIn = null`;
    `amount < 0 → amountIn = abs(amount), amountOut = null`.
  - Strip the wrapping single quotes from `Reference` → `externalReference`; reduce
    `Account #` to its digits → `cardAccount`; store `Card Member` title-cased for display
    (`cardMember`) **and** keep the raw trimmed value (`rawCardMember`) for hashing.
  - Non-purchase classification (deterministic, Amex-scoped). Each non-purchase row is
    written with `vendor_name = 'American Express'`, `vendor_source = 'import'` and (where
    a category applies) `expense_category_source = 'import'`, so they group cleanly and
    never read as "unclassified":
    - description matches `PAYMENT RECEIVED` or starts with `CREDIT FOR` → `status =
      no_receipt_required`, `receiptRequired = false`, **no** expense category (a balance
      payment/credit is not spend).
    - description matches `INTEREST CHARGE` / `MEMBERSHIP FEE` / `LATE PAYMENT FEE`
      (and a generic trailing `… FEE`) → `status = no_receipt_required`,
      `receiptRequired = false`, `expenseCategory = 'Bank Charges/Credit Card Commission'`,
      `expenseCategorySource = 'import'`.
    - any other negative amount (merchant refund) → `status = no_receipt_required`,
      `receiptRequired = false` (credits are not purchases to chase).
    - otherwise (positive spend) → `status = pending`, `receiptRequired = true`, vendor and
      expense left null for the rules + AI pass.
- `createAmexTransactionHash(input)` — SHA-256 of **raw, stable** fields only:
  `['amex', transactionDate, signedAmountString, cardAccount, rawCardMember,
  externalReference].join('|')`. The `'amex'` prefix guarantees no collision with bank
  hashes. It deliberately **excludes** display-normalised values (`details`, the
  title-cased `cardMember`) so future formatting changes can never alter a row's dedup
  identity. `external_reference` is the strongest component; the others guard the rare row
  with no reference.

### 4. Import service (`receiptMutations.ts`)

`performImportReceiptStatement(userId, userEmail, receiptFile, buffer, sourceType)`:

- **New param** `sourceType: ReceiptSourceType` (default `'bank'`).
- Branches: `sourceType === 'amex'` → `parseAmexCsv(buffer)`, else `parseCsv(buffer)`.
- **Duplicate-file guard (fixes today's gap):** compute `source_hash` from the buffer and
  query `receipt_batches` for an existing row with that hash **before** creating a batch.
  If found, return `{ success: true, inserted: 0, skipped: rows.length, warning: 'This
  file has already been imported.' }` and create **no** second batch. Applies to both bank
  and Amex (an improvement, not a regression).
- `receipt_batches` insert records `source_type` alongside existing `original_filename`,
  `source_hash`, `row_count`, `uploaded_by`.
- The `receipt_transactions` upsert `payload` gains `source_type`, `card_member`,
  `card_account`, `merchant_category`, `merchant_town`, `external_reference`, and replaces
  the **hard-coded** `status: 'pending'` / `receipt_required: true` / `vendor_*` /
  `expense_*` with **per-row** values from the parsed row (falling back to `pending` /
  `true` / nulls when absent, so the bank path is byte-for-byte unchanged).
- **Import logs:** the existing `receipt_transaction_logs` insert hard-codes
  `new_status: 'pending'`. Change it to use each inserted row's actual status (the upsert
  already `.select('id, status')`), so Amex fee/payment rows log `no_receipt_required`.
- **Preserve the entire post-insert pipeline** on `insertedIds`, in order:
  `applyAutomationRules` → `enqueueReceiptAiClassificationJobs(insertedIds, batchId)` →
  `enqueueReceiptSystemJob('reconcile_receipt_invoice_payments', batchId, {transaction_ids})`
  → `enqueueReceiptSystemJob('refresh_receipt_duplicate_candidates', batchId)`. Rules + AI
  already target pending/unclassified rows, so they naturally no-op on terminal
  non-purchase rows — verify, but no extra filtering needed.
- Returns the existing shape `{ success, inserted, skipped, autoApplied, autoClassified,
  batch, warning }`.

### 5. Server action (`src/app/actions/receipts.ts`)

- `importReceiptStatement(formData)` reads `formData.get('sourceType')`, validates with
  `receiptSourceTypeSchema` (default `bank` for backwards compatibility), and passes it to
  `performImportReceiptStatement(...)`. Audit `additional_info` gains `source_type`. RBAC
  unchanged.
- `ReceiptWorkspaceFilters` (in `src/services/receipts/types.ts`) gains
  `sourceType?: 'bank' | 'amex' | 'all'` and `cardMember?: string`.

### 6. Queries (`receiptQueries.ts`)

- The workspace select is `'*, receipt_files(*), receipt_rules!…'`, so `*` already returns
  the new columns once the migration lands — **no select change needed**, but the
  workspace row / `ReceiptWorkspaceData` types must include the six new fields.
- Apply the new filters in the same block as `status`/`direction`/`search`:
  - `if (filters.sourceType && filters.sourceType !== 'all') baseQuery = baseQuery.eq('source_type', filters.sourceType)`
  - `if (filters.cardMember) baseQuery = baseQuery.eq('card_member', filters.cardMember)`
- **Data contract:** add `availableCardMembers: string[]` to `ReceiptWorkspaceData`
  (mirroring the existing `availableMonths`), populated from a distinct query of
  `card_member` where `source_type = 'amex'`. Thread it `getReceiptWorkspaceData` →
  `ReceiptsClient` → `ReceiptFilters` exactly like `availableMonths`.

### 7. UI

- **`ui/ReceiptUpload.tsx`** — a Bank/Amex toggle implemented with the `@/ds` `Select`
  (two options, default `bank`) above the file input; appended to the `FormData` as
  `sourceType`. Copy/labels update ("Upload statement" / accept bank or Amex CSV).
  Validation message reflects the selected format.
- **`ui/ReceiptTableRow.tsx` / `ui/ReceiptMobileCard.tsx`** — a source badge: neutral
  **Bank** pill vs a distinct-tone **Amex** pill with a card icon (Tailwind utility
  classes consistent with the existing `ClassificationBadge`, no raw hex beyond that
  established pattern). For Amex rows, show the cardholder name (and merchant town if
  present) near the details.
- **`ui/ReceiptFilters.tsx`** — extend `ReceiptFiltersProps` with `sourceType` +
  `cardMember` in `filters` and a new `availableCardMembers: string[]` prop. Render a
  **Source** filter (All / Bank / Amex), always shown, and a **Cardholder** filter
  (All / each card member) shown only when `availableCardMembers.length > 0`. Wired
  through URL params (`source`, `cardMember`) in `page.tsx` like existing filters.
- **`page.tsx`** — parse `source` and `cardMember` search params into `filters` and pass
  `availableCardMembers` from the workspace data into `ReceiptsClient`.

### 8. Export

Quarterly/CSV export (`ui/ReceiptExport.tsx` + its action/lib) gains **Source** and
**Cardholder** columns so the accountant can see which charges are card vs bank, and
continues to include Amex rows in totals. No change to the PDF pack layout beyond the
added column/label.

## Data flow

```
Upload (Bank|Amex toggle + CSV)
  └─> importReceiptStatement(formData: statement, sourceType)        [action, RBAC + audit]
        └─> performImportReceiptStatement(userId,email,file,buffer,sourceType)  [service]
              ├─ sourceType=amex → parseAmexCsv  → ParsedTransactionRow[] (+source meta, +pre-resolved status)
              ├─ sourceType=bank → parseCsv       → ParsedTransactionRow[]
              ├─ source_hash pre-check → if file already imported, return inserted:0 (NO dup batch)
              ├─ insert receipt_batches (source_type, filename, source_hash, row_count)
              ├─ upsert receipt_transactions (onConflict dedupe_hash, ignoreDuplicates; per-row status/source/card)
              ├─ insert receipt_transaction_logs (new_status = each row's REAL status)
              ├─ applyAutomationRules(insertedIds)
              ├─ enqueueReceiptAiClassificationJobs(insertedIds, batchId)
              ├─ enqueueReceiptSystemJob('reconcile_receipt_invoice_payments', batchId, {transaction_ids})
              └─ enqueueReceiptSystemJob('refresh_receipt_duplicate_candidates', batchId)
  └─> list + filters distinguish source/cardholder; export includes source columns
```

## Error handling

- **Header validation on both paths** so the Bank/Amex toggle is reliable: `parseAmexCsv`
  requires the Amex columns (`Card Member`, `Amount`) and throws a clear error if a bank
  CSV is uploaded under the Amex toggle; `parseCsv` (bank) currently just skips
  unrecognised rows, so add a matching header check that throws when the bank columns
  (`Details` plus `In`/`Out`) are absent (i.e. an Amex CSV uploaded under the Bank
  toggle). Both surface via the existing `{ error }` return and a toast.
- Malformed/zero amounts and undated rows are skipped (same posture as bank import).
- Re-importing the same file → 0 transactions inserted (row-level `dedupe_hash`) **and**
  no duplicate batch row, thanks to the new `source_hash` pre-check in §4.
- Negative bank amounts still rejected by `parseCurrency` (no regression).

## Affected downstream paths (must not regress)

Adding a second transaction source touches several existing behaviours. Each is addressed
so a literal implementation doesn't silently break them:

- **Import system jobs** — the import must keep enqueuing
  `reconcile_receipt_invoice_payments` and `refresh_receipt_duplicate_candidates` (§4).
  These run for Amex rows too; invoice reconciliation is effectively a no-op for Amex
  merchant strings (no `INV-` patterns) and needs no special skip.
- **Import transaction logs** — `new_status` must reflect each row's real initial status,
  not the hard-coded `'pending'` (§4), or Amex fee/payment rows log the wrong state.
- **Duplicate-candidate detection** (`refresh_receipt_duplicate_candidates` /
  `receipt_duplicate_reviews`) currently compares date/amount/details across **all**
  receipts. It must become `source_type`-aware so a bank charge and an Amex charge that
  share a date and amount are not flagged as duplicates of each other. Locate the function
  / RPC / query that builds candidates and update it (preferably in the §1 migration if it
  is SQL) to require matching `source_type`.
- **P&L / Shadow P&L** (`receipts/pnl`) — Amex **purchases** are real expenses and should
  appear. But the **bank** statement also shows the lump-sum payment to American Express;
  if P&L counts both the bank→Amex payment and the itemised Amex purchases, spend is
  double-counted. Mitigation: ensure any **bank** line whose details match
  `AMERICAN EXPRESS` / `AMEX` is treated as a balance payment (`no_receipt_required`,
  excluded from expense totals), and confirm the P&L aggregation keys off expense
  categories / classified spend rather than raw outflow. **OPEN — confirm with user:**
  whether bank Amex-payment lines are imported here today; if the bank account is not in
  this dataset, no double-count is possible and no change is needed.
- **Export** (`receipts/export`) — quarterly pack/CSV gains `Source` + `Cardholder`
  columns (§8) and keeps Amex rows in totals.
- **AI classification context** — when building the batch input for
  `classify_receipt_transactions` (`src/lib/receipts/ai-classification.ts`), pass the Amex
  `merchant_category` (and `merchant_town`) as additional hints for Amex rows to improve
  vendor/category accuracy. Additive and optional; bank rows unaffected.

## Testing

New/updated Vitest specs (mock Supabase; pure helpers tested directly):
- `parseSignedAmount`: positive/negative/zero/comma/£/blank.
- `parseAmexCsv`: header detection (throws on bank CSV), signed-amount split into in/out,
  `DD/MM/YYYY` parsing, Reference unquoting, account normalisation, non-purchase
  classification (payment, interest, membership fee, late fee, credit-for, refund) incl.
  the `vendor_name='American Express'` + `expense_category_source='import'` fields,
  dedup-hash stability/idempotency (same row twice → same hash; bank vs Amex same
  date+amount → different hash; hash unchanged when only display casing differs).
- Bank-path header validation: `parseCsv` (or its new guard) throws on an Amex CSV.
- Import behaviour (mocked DB): per-row `new_status` in logs for a fee row =
  `no_receipt_required`; `source_hash` pre-check returns `inserted: 0` with no second
  batch on a repeat import; the four post-insert jobs are all invoked.
- Regression: `parseCsv` (bank) output unchanged; `parseCurrency` still rejects negatives.
- Run against the three real sample CSVs to confirm row counts and classifications.

Minimum bar: happy path + ≥1 error/edge case per new function (meets project testing
rules).

## Files touched

| File | Change |
|------|--------|
| `supabase/migrations/20260714000000_receipts_amex_source.sql` | new — additive columns + indexes; source-aware duplicate-candidate fn if it is SQL |
| `src/types/database.ts` | new fields + `ReceiptSourceType` |
| `src/types/database.generated.ts` | regenerate row/insert/update |
| `src/lib/validation.ts` | `receiptSourceTypeSchema` |
| `src/services/receipts/types.ts` | `AmexCsvRow`, extend `ParsedTransactionRow`, extend `ReceiptWorkspaceFilters`, `availableCardMembers` on `ReceiptWorkspaceData` |
| `src/services/receipts/receiptHelpers.ts` | `parseSignedAmount`, `parseAmexCsv`, `createAmexTransactionHash`, bank header guard |
| `src/services/receipts/receiptMutations.ts` | `sourceType` param, branch parser, source_hash guard, per-row status/source/card columns, per-row log status, preserve all jobs |
| `src/services/receipts/receiptQueries.ts` | source/cardMember filters, `availableCardMembers`, source-aware duplicate candidates if built here |
| `src/lib/receipts/ai-classification.ts` | pass `merchant_category`/`merchant_town` as AI hints for Amex rows |
| `src/app/actions/receipts.ts` | `sourceType` param, filters, audit info |
| `src/app/(authenticated)/receipts/page.tsx` | parse `source` + `cardMember` params; pass `availableCardMembers` |
| `src/app/(authenticated)/receipts/_components/ReceiptsClient.tsx` | thread `availableCardMembers`, source/cardMember filter state |
| `src/app/(authenticated)/receipts/_components/ui/ReceiptUpload.tsx` | Bank/Amex toggle |
| `src/app/(authenticated)/receipts/_components/ui/ReceiptTableRow.tsx` | source badge + cardholder |
| `src/app/(authenticated)/receipts/_components/ui/ReceiptMobileCard.tsx` | source badge + cardholder |
| `src/app/(authenticated)/receipts/_components/ui/ReceiptFilters.tsx` | Source + Cardholder filters |
| `src/app/(authenticated)/receipts/_components/ui/ReceiptExport.tsx` (+ export lib/action) | Source/Cardholder columns |
| `src/app/(authenticated)/receipts/pnl/*` (+ its query) | source-aware; avoid Amex double-count |
| `src/services/receipts/__tests__/…` (or `tests/lib/…`) | new unit tests |

## Assumptions / defaults (not separately confirmed)

- `source_type` lives on the transaction (denormalised for filtering/display) and is also
  recorded on the batch.
- Amex `Category` is stored as a hint only and is **not** mapped into the HMRC expense
  taxonomy; AI/rules still drive `expense_category` for purchases.
- Amex rows flow through the **same** full post-import pipeline as bank rows.
- Invoice reconciliation (`INV-*` matching) is left running unchanged; effectively a no-op
  for Amex strings, so no special skip.
- One `receipt_batches` row per uploaded file; statement period is not separately stored
  (derivable from transaction dates).
- Address / Postcode / Country / Extended Details are not persisted.
- The duplicate-file guard (`source_hash` pre-check) is applied to **both** bank and Amex
  imports.

## Rollback

Pure additive migration. Rollback = drop the six `receipt_transactions` columns and the
`receipt_batches.source_type` column (no data loss for existing bank rows), and revert any
`source_type` predicate added to the duplicate-candidate function. Application code changes
are independently revertable; with the columns present but UI reverted, existing bank flows
are unaffected.

## Complexity

Score **4 (L)** — ~18 files, schema change (additive) plus a touched SQL function, new
parser + UI, and several downstream paths to keep correct. Independently deployable:
migration first, then service/action, then UI. No breaking changes to the existing bank
flow (other than the duplicate-file guard, which is a safe improvement).
