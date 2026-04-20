# Integration & Architecture Review: OJ Projects Review Spec

**Date:** 2026-04-14
**Reviewer:** Integration & Architecture Specialist
**Spec:** `docs/superpowers/specs/2026-04-14-oj-projects-review-design.md`

---

## Findings

### ARCH-001: Client Statement Invoice Filtering Uses Dual Strategy — Pick One

**Severity:** HIGH

**What the spec proposes:** Filter invoices by vendor via `reference ILIKE 'OJ Projects %'` OR `vendor_id` join through `oj_entries`.

**What the codebase actually does:** `client-balance.ts` (line 46-47) uses **both** strategies simultaneously:
```typescript
.eq('vendor_id', vendorId)
.ilike('reference', 'OJ Projects %')
```
Invoices have a direct `vendor_id` column (confirmed in `src/types/invoices.ts` line 24: `vendor_id: string`). The ILIKE filter is a **secondary guard** to isolate OJ Projects invoices from other invoices for the same vendor (since `invoice_vendors` is shared across the whole invoicing system).

**Architectural risk:** The spec's ambiguity ("or") could lead an implementer to use only `vendor_id` without the ILIKE guard, which would pull in non-OJ-Projects invoices for the same vendor. Conversely, relying on ILIKE alone is fragile if the reference format ever changes. The statement feature needs the same dual-filter approach that `client-balance.ts` already uses.

**Recommended fix:** Spec should explicitly mandate the dual-filter pattern: `.eq('vendor_id', vendorId).ilike('reference', 'OJ Projects %')`. Document this as a convention. Long-term, consider adding an `invoice_source` enum column (e.g., `'oj_projects' | 'manual' | 'recurring'`) for reliable filtering without string matching.

---

### ARCH-002: Statement Action Placement Creates Cross-Domain Coupling

**Severity:** MEDIUM

**What the spec proposes:** New `client-statement.ts` action in `src/app/actions/oj-projects/`.

**What the codebase actually does:** All 8 existing OJ Projects action files query OJ-specific tables (`oj_entries`, `oj_recurring_charge_instances`, `oj_vendor_billing_settings`). The `client-balance.ts` is the one exception that also queries `invoices` — but it is an OJ-Projects-specific view of invoices (dual-filtered as noted in ARCH-001). Invoice mutations (create, update, payment, delete) live in `src/app/actions/invoices.ts` and delegate to `src/services/invoices.ts`.

**Architectural risk:** The statement action is read-only and OJ-Projects-scoped. Placing it in oj-projects actions is consistent with how `client-balance.ts` works. However, the statement also needs `invoice_payments` data, which `client-balance.ts` does not currently query. This deepens the coupling between oj-projects actions and the invoices domain.

**Recommended fix:** Placement in `src/app/actions/oj-projects/` is acceptable given precedent. BUT: extract the invoice+payment fetching logic into a shared utility (e.g., `src/services/invoices.ts` method like `getInvoicesWithPaymentsForVendor(vendorId, options)`) so both `client-balance.ts` and `client-statement.ts` consume the same data source rather than writing separate queries.

---

### ARCH-003: PDF Generation Architecture is Sound But Spec Should Reference Correct Function

**Severity:** LOW

**What the spec proposes:** New `src/lib/oj-statement.ts` using `generatePDFFromHTML()`.

**What the codebase actually does:** Three PDF generation paths exist:
1. **`generateInvoicePDF()`** — takes `InvoiceWithDetails`, generates HTML via `generateCompactInvoiceHTML()`, renders via Puppeteer. Used for invoices and remittance advice.
2. **`generateQuotePDF()`** — same pattern for quotes.
3. **`generatePDFFromHTML()`** — generic: takes raw HTML string, renders via Puppeteer. Used by `oj-timesheet.ts`.

All three share the same browser management: `createPdfBrowser()` creates instances, `closePdfBrowser()` cleans up, and the `{ browser }` option allows sharing a browser across multiple PDFs.

**Architectural risk:** None significant. The `oj-timesheet.ts` file is the exact pattern the statement should follow: generate HTML string, call `generatePDFFromHTML()`. The browser instance is not globally cached — each call can create its own or accept a shared one.

**Recommended fix:** Spec is correct. The new `oj-statement.ts` should follow the `oj-timesheet.ts` pattern exactly: HTML template function + `generatePDFFromHTML()` call. Reuse the existing `escapeHtml()`, `formatCurrency()` helpers from a shared location rather than duplicating them (they are currently duplicated between `invoice-template-compact.ts` and `oj-timesheet.ts`).

---

### ARCH-004: Partial Payment Receipt Extension Has a Hard Guard That Must Be Relaxed

**Severity:** HIGH

**What the spec proposes:** Extend `sendRemittanceAdviceForPaidInvoice()` to fire on `partially_paid` status too.

**What the codebase actually does:** In `src/app/actions/invoices.ts`, the function `sendRemittanceAdviceForPaidInvoice()` has a **hard guard at line 129**:
```typescript
if (invoice.status !== 'paid') {
  return { sent: false, skippedReason: 'invoice_not_paid' }
}
```
And the caller in `recordPayment()` (lines 743-748) only triggers when:
```typescript
invoiceBeforePayment.status !== 'paid' && invoiceAfterPayment?.status === 'paid'
```

**Architectural risk:** Two guards need changing, not one. If only the caller condition is updated but the function's internal guard is not relaxed, partial payment receipts will silently fail with `skippedReason: 'invoice_not_paid'`. Additionally, the function name includes "PaidInvoice" which would be misleading after the change.

**Recommended fix:** The spec correctly identifies the rename to `sendPaymentReceipt()`. Implementation MUST update both:
1. The caller condition in `recordPayment()` to trigger on `partially_paid` OR `paid`
2. The internal guard in the function itself to accept `partially_paid` OR `paid`
3. The email subject/body conditionals as spec describes

This is not OJ-Projects-specific — it affects ALL invoices. The spec correctly labels this "Universal" but implementers should be warned about the double-guard.

---

### ARCH-005: Credit Notes Table — vendor_id FK is Consistent, But Watch the invoice_id Optionality

**Severity:** MEDIUM

**What the spec proposes:** New `credit_notes` table with `vendor_id` (required) and `invoice_id` (optional).

**What the codebase actually does:** Invoices already have `vendor_id` as a direct column (FK to `invoice_vendors`). The OJ entries and recurring charge instances also have `vendor_id`. So the proposed `vendor_id` on `credit_notes` is consistent with the existing pattern.

**Architectural risk:** The spec says `invoice_id` is optional ("can be standalone"). A standalone credit note not linked to any invoice creates a data integrity gap: when computing balances, the statement must separately query credit notes in addition to invoices and payments. The `client-balance.ts` currently only queries invoices and oj_entries/recurring instances. Adding credit notes means a fourth data source for balance computation.

**Recommended fix:** 
1. Ensure the balance computation in `client-balance.ts` is updated to subtract standalone credit notes
2. Ensure the statement action also includes credit notes as transactions
3. Consider whether standalone credit notes (no invoice_id) are truly needed or if they should always reference an invoice. If standalone is required, add a `vendor_id` + `created_at` index for efficient querying.

---

### ARCH-006: Billing Cron at 3,434 Lines — Alerting Should Be Extracted

**Severity:** HIGH

**What the spec proposes:** Add error alerting logic to `src/app/api/cron/oj-projects-billing/route.ts`.

**What the codebase actually does:** The billing cron is already **3,434 lines** — one of the largest files in the codebase.

**Architectural risk:** Adding alerting logic inline will push this past 3,500 lines. The file is already at severe maintenance risk. Every change increases the chance of unintended side effects. The alerting feature involves email composition, recipient resolution, and error aggregation — each of which has nothing to do with billing logic.

**Recommended fix:** Extract alerting into `src/lib/oj-projects/billing-alerts.ts`:
```typescript
export async function sendBillingRunAlertIfNeeded(results: BillingRunResult[]): Promise<void>
```
The cron file should call this single function at the end of its run. This also makes the alerting testable in isolation. Consider also extracting other logical sections of the billing cron (vendor processing, cap-mode logic, statement-mode logic) into separate modules as part of Phase 1.5 refactoring.

---

### ARCH-007: Divergent Balance Calculations — Three Consumers, One Source of Truth Needed

**Severity:** HIGH

**What the spec proposes:** Client statement computes opening/closing balance. Client balance page shows outstanding. Receipts show outstanding on invoices.

**What the codebase actually does:** 
- `client-balance.ts` computes `totalOutstanding` = unpaid invoice balance + unbilled entries + unbilled recurring charges
- The receipt email (line 174) computes: `outstandingBalance = Math.max(0, invoice.total_amount - invoice.paid_amount)` — this is per-invoice, not per-vendor
- The proposed statement would compute a third balance: opening balance based on unpaid invoices before date range

**Architectural risk:** Three different "balance" concepts that could diverge:
1. **Client balance page**: vendor-level total including unbilled work
2. **Statement**: vendor-level invoiced balance only (excludes unbilled work)
3. **Receipt**: single-invoice outstanding balance

These are legitimately different numbers, but the spec does not make this distinction clear. A user seeing a different "balance" on the statement vs. the client page will file a bug report.

**Recommended fix:**
1. Clearly define and document the three balance types in the spec
2. Extract common invoice balance calculation into a shared utility:
   ```typescript
   // src/lib/oj-projects/balance-utils.ts
   export function computeInvoiceBalance(invoices: InvoiceSummary[]): number
   export function computeUnbilledBalance(entries: Entry[], recurring: Instance[]): number
   ```
3. The statement should label its balance as "Invoiced Balance" not "Total Outstanding" to differentiate from the client balance page which includes unbilled work
4. Add a note on the statement: "This statement reflects invoiced amounts only. Unbilled work in progress is not included."

---

### ARCH-008: one_off Entry Bug Fix — client-balance.ts Also Missing from Select Columns

**Severity:** MEDIUM

**What the spec proposes:** Add `one_off` entry handling to unbilled total calculation.

**What the codebase actually does:** `client-balance.ts` line 66-67 selects only:
```
entry_type, duration_minutes_rounded, miles, hourly_rate_ex_vat_snapshot, vat_rate_snapshot, mileage_rate_snapshot
```
It does NOT select `amount_ex_vat_snapshot`, which is the field used for `one_off` entries' amounts.

**Architectural risk:** Even after adding the logic to sum `one_off` entries, the fix will silently produce zero totals unless `amount_ex_vat_snapshot` is added to the `.select()` clause.

**Recommended fix:** The select clause must be updated to include `amount_ex_vat_snapshot`:
```typescript
.select(
  'entry_type, duration_minutes_rounded, miles, hourly_rate_ex_vat_snapshot, vat_rate_snapshot, mileage_rate_snapshot, amount_ex_vat_snapshot'
)
```
Then add the loop branch for `one_off` entries.

---

### ARCH-009: Supabase Client Pattern — OJ Projects Actions Use Cookie Auth Consistently

**Severity:** LOW (informational)

**What the spec proposes:** New actions in oj-projects directory.

**What the codebase actually does:** All OJ Projects actions use `createClient()` (cookie-based auth) with `checkUserPermission()` gating. The `InvoiceService` also primarily uses `createClient()` except for `createInvoiceAsAdmin()` and `updateInvoice()` which use `createAdminClient()` for specific operations. The billing cron (a system operation) would use admin client.

**Architectural risk:** None if the new actions follow the established pattern. The statement action is user-initiated (requires auth), so cookie-based client is correct.

**Recommended fix:** New `client-statement.ts` should use `createClient()` + `checkUserPermission('oj_projects', 'view')` — identical pattern to `client-balance.ts`.

---

## Summary

| ID | Severity | Issue |
|----|----------|-------|
| ARCH-001 | HIGH | Dual-filter pattern for invoice isolation must be explicitly mandated |
| ARCH-002 | MEDIUM | Statement action placement is OK but needs shared data utility |
| ARCH-003 | LOW | PDF generation approach is correct, follows oj-timesheet pattern |
| ARCH-004 | HIGH | Partial payment receipts require updating TWO guards, not one |
| ARCH-005 | MEDIUM | Credit notes FK is consistent but adds 4th balance data source |
| ARCH-006 | HIGH | 3,434-line billing cron must not grow further — extract alerting |
| ARCH-007 | HIGH | Three divergent balance concepts need clear labeling and shared utils |
| ARCH-008 | MEDIUM | one_off fix will silently fail without select clause update |
| ARCH-009 | LOW | Supabase client pattern is established and consistent |

**Critical implementation risks:** ARCH-004 (double guard) and ARCH-008 (missing select column) are likely to produce silent failures if not addressed. ARCH-007 (divergent balances) will produce user confusion if not explicitly labeled.
