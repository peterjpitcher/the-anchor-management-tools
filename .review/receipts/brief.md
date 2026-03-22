# Review Brief — /receipts Section

## Target
`src/app/(authenticated)/receipts/` and all supporting code:
- `src/app/actions/receipts.ts` (very large — primary business logic)
- `src/lib/receipts/ai-classification.ts`
- `src/lib/receipts/rule-matching.ts`
- `src/app/api/receipts/upload/route.ts`
- `src/app/api/receipts/export/route.ts`
- `src/app/api/receipts/pnl/export/route.ts`

## Known Problems
None explicitly reported. This is a proactive full audit.

## Business Rules (from CLAUDE.md and codebase context)

### Domain Purpose
This module processes bank statement CSV imports, classifies transactions (expense category + vendor name), tracks whether physical receipts have been attached, and provides management reporting.

### Classification Pipeline
1. Transactions imported from CSV (bank statements)
2. Rule-based auto-classification runs first (matching on transaction details string)
3. AI classification (OpenAI) runs via job queue for unclassified transactions
4. Staff manually review and complete classification in the Bulk Review workspace

### Transaction Statuses
- `pending` — imported, needs attention
- `completed` — receipt uploaded and reviewed
- `auto_completed` — auto-classified by a rule (no_receipt_required + classified)
- `no_receipt_required` — marked as not needing a physical receipt
- `cant_find` — receipt cannot be located

### Classification Sources
- `vendor_source` / `expense_category_source` can be: `ai`, `rule`, `manual`
- AI classifications carry `ai_confidence` (SMALLINT) and `ai_suggested_keywords`

### CSV Import Rules
- Dedupe hash prevents duplicate import of same transaction
- Bank CSV format: Date, Details, Transaction Type, In, Out, Balance
- Max upload size: 15 MB (enforced in server action)

### AI Classification Rules
- Batch classification: single OpenAI API call for all unclassified transactions
- AI usage logged to DB (model, tokens, cost)
- Failure must log `ai_classification_failed` event
- Re-queue operation: requeueUnclassifiedTransactions() targets vendor_name IS NULL AND vendor_source IS NULL

### Rule System Rules
- Rules match on `details` string (transaction description) and optionally `matchDescription`
- Rules have direction: `in` | `out` | `both`
- Rules can set: status, vendor_name, expense_category
- Rules are applied at import time and via retro-run
- Rule preview must show overlap count with other rules

### Financial Reporting
- P&L view groups by expense category and vendor
- Monthly insights show income/outgoing trends
- Vendor summary shows trend per vendor across months

### Permissions
- Module: `receipts`, actions: `view`, `export`
- Admin client (service role) used for data operations
- Auth checked at page level

## File Inventory (Tiers)

### Tier 1 — Critical Path
- `src/app/actions/receipts.ts` — ALL server actions (upload, classify, rules, bulk review, export, reporting)
- `src/lib/receipts/ai-classification.ts` — OpenAI batch classification + usage recording
- `src/lib/receipts/rule-matching.ts` — rule evaluation logic
- `src/app/api/receipts/upload/route.ts` — CSV file upload API route
- `src/app/(authenticated)/receipts/page.tsx` — main workspace page (server component)
- `src/app/(authenticated)/receipts/_components/ReceiptsClient.tsx` — main workspace client

### Tier 2 — Supporting
- `src/app/(authenticated)/receipts/_components/ReceiptBulkReviewClient.tsx`
- `src/app/(authenticated)/receipts/_components/ui/ReceiptRules.tsx`
- `src/app/(authenticated)/receipts/_components/ui/ReceiptStats.tsx`
- `src/app/(authenticated)/receipts/_components/ui/ReceiptUpload.tsx`
- `src/app/(authenticated)/receipts/_components/ui/ReceiptFilters.tsx`
- `src/app/(authenticated)/receipts/_components/ui/ReceiptTableRow.tsx`
- `src/app/(authenticated)/receipts/_components/ui/ReceiptList.tsx`
- `src/app/(authenticated)/receipts/_components/ui/ReceiptExport.tsx`
- `src/app/(authenticated)/receipts/_components/ui/ReceiptReclassify.tsx`
- `src/app/(authenticated)/receipts/_components/ui/ReceiptMobileCard.tsx`
- `src/app/(authenticated)/receipts/_components/PnlClient.tsx`
- `src/app/api/receipts/export/route.ts`
- `src/app/api/receipts/pnl/export/route.ts`
- `src/app/(authenticated)/receipts/bulk/page.tsx`
- `src/app/(authenticated)/receipts/pnl/page.tsx`
- `src/app/(authenticated)/receipts/monthly/page.tsx`
- `src/app/(authenticated)/receipts/monthly/MonthlyCharts.tsx`
- `src/app/(authenticated)/receipts/vendors/page.tsx`
- `src/app/(authenticated)/receipts/vendors/_components/VendorSummaryGrid.tsx`
- `src/app/(authenticated)/receipts/missing-expense/page.tsx`
- `src/app/(authenticated)/receipts/utils.ts`
- `src/app/(authenticated)/receipts/receiptsNavItems.ts`

### Tier 3 — Peripheral (scan only)
- DB migrations: `supabase/migrations/*receipt*`
- Type definitions: `src/types/database.ts` (receipt-related types)

## Multi-Step Operations to Analyse (Partial Failure Priority)

1. **CSV Import**: parse → validate → dedupe → insert batch → insert transactions → trigger classification queue
2. **AI Classification Job**: dequeue → call OpenAI batch API → parse response → update transactions → record AI usage → log failures
3. **Rule Application (Retro)**: fetch rules → fetch transactions → evaluate matches → bulk update transactions → log
4. **Bulk Group Apply**: fetch group → validate → update all matching transactions → optionally create rule
5. **File Upload (receipt attachment)**: upload to Supabase storage → update transaction record → revalidate
6. **Rule Create + Retro Run**: validate → insert rule → run retro on existing transactions

## Priority Focus Areas
1. AI classification job — partial failure handling (what if OpenAI call succeeds but DB update fails?)
2. CSV import dedupe reliability — can duplicate transactions slip through?
3. Rule retro-run atomicity — what if retro run fails partway through?
4. Export correctness — financial exports must match what's displayed
5. Permissions — are all API routes and server actions properly auth-guarded?
6. Bulk apply — what if bulk update fails mid-way on 500 transactions?
