# OJ Projects Review — Bug Fixes, Client Statement, Payment Receipts & Completeness

**Date:** 2026-04-14
**Status:** Draft
**Complexity:** L (score 4) — multiple files, new features, migration, cross-cutting receipt change

---

## Overview

End-to-end review and enhancement of the OJ Projects section. Four workstreams:

1. **Bug fixes** — data integrity issues affecting accuracy of balances and billing
2. **Client statement** — running account statement (PDF + email) showing invoices, payments, credits, and balance over a date range
3. **Partial payment receipts** — extend existing receipt flow to fire on partial payments (universal, not OJ Projects only)
4. **Completeness recommendations** — payment history on project detail, billing cron alerting, statement mode UI clarity, void/credit note support

---

## Phase 1: Bug Fixes

### 1.1 — one_off DB constraint gap

**Problem:** `chk_oj_entries_time_fields` in `oj_entries` only validates `time` and `mileage` entry types. `one_off` entries can have spurious `miles` or `duration_minutes_rounded` values that pass DB validation silently.

**Fix:** New migration adding a third arm to the constraint:
```sql
-- When entry_type = 'one_off':
--   amount_ex_vat_snapshot must NOT be null
--   duration_minutes_rounded must be null
--   miles must be null
--   hourly_rate_snapshot must be null
--   mileage_rate_snapshot must be null
```

Also add a data-fix query to null out any existing spurious values on `one_off` entries.

### 1.2 — Client balance excludes one-off charges

**Problem:** `src/app/actions/oj-projects/client-balance.ts` only sums unbilled `time` and `mileage` entries. Unbilled `one_off` entries with `amount_ex_vat_snapshot` are excluded from `unbilledTotal`.

**Fix:** Add a third query (or extend existing) to sum `amount_ex_vat_snapshot` for unbilled `one_off` entries. Include in the `unbilledTotal` calculation. Update the UI breakdown on the Clients page if it itemises by type.

### 1.3 — Missing OJRecurringChargeInstance TypeScript type

**Problem:** `oj_recurring_charge_instances` table has no corresponding TypeScript type. The billing cron uses `any` throughout.

**Fix:** Add `OJRecurringChargeInstance` interface to `src/types/oj-projects.ts` matching the DB schema:
```typescript
export interface OJRecurringChargeInstance {
  id: string;
  recurring_charge_id: string;
  period_yyyymm: string;
  amount_ex_vat: number;
  vat_rate: number;
  status: OJEntryStatus;
  billing_run_id: string | null;
  invoice_id: string | null;
  created_at: Date;
  updated_at: Date;
}
```

Replace `any` usage in the billing cron with this type. This is a refactor-only change — no runtime behaviour changes.

### 1.4 — Cap-mode splitting fails silently

**Problem:** Cap-mode billing splits time entries proportionally when hitting the monthly cap. The split logic requires `start_at`/`end_at` timestamps. Most UI-created entries don't have these, causing the split function to return `null` — the entry is silently skipped.

**Fix:** Add fallback splitting logic for entries without `start_at`/`end_at`:
- Split by monetary amount proportion rather than time range
- Create a partial entry with the amount that fits under the cap, and a remainder entry with the rest
- Log a warning when fallback is used (for visibility)
- Ensure both partial and remainder entries maintain referential integrity

### 1.5 — Duplicated deriveClientCode

**Problem:** `deriveClientCode()` is duplicated identically in `src/app/actions/oj-projects/projects.ts` and `src/app/api/cron/oj-projects-retainer-projects/route.ts`.

**Fix:** Extract to `src/lib/oj-projects/utils.ts`. Import from both locations. Single source of truth.

---

## Phase 2: Client Statement

### Data Model

No new tables. The statement is a read-time aggregation:

**Sources:**
- `invoices` — filtered by vendor (via `reference ILIKE 'OJ Projects %'` or `vendor_id` join through `oj_entries`)
- `invoice_payments` — all payments against those invoices
- Future: credit notes (Phase 4.4)

**Computed fields:**
- Opening balance: sum of all unpaid invoice amounts with `created_at < dateFrom`
- Transactions: chronological list of invoices (debits) and payments (credits) within the date range
- Running balance: opening balance + cumulative debits - cumulative credits
- Closing balance: final running balance value

### Server Action

**File:** `src/app/actions/oj-projects/client-statement.ts`

```typescript
export async function getClientStatement(
  vendorId: string,
  dateFrom: string,  // ISO date
  dateTo: string     // ISO date
): Promise<{
  vendor: { id: string; name: string; email: string };
  period: { from: string; to: string };
  openingBalance: number;
  transactions: StatementTransaction[];
  closingBalance: number;
  error?: string;
}>

interface StatementTransaction {
  date: string;
  description: string;  // e.g. "Invoice OJ-2026-001" or "Payment received — Bank Transfer"
  reference: string;     // invoice number or payment reference
  debit: number | null;  // invoice amount (inc VAT)
  credit: number | null; // payment amount
  balance: number;       // running balance
}
```

**Permissions:** Requires `oj_projects` + `view` permission.

### PDF Generation

**File:** `src/lib/oj-statement.ts`

Uses `generatePDFFromHTML()` (same Puppeteer pipeline as invoices/timesheets).

**Layout:**
- Header: business name/logo, "ACCOUNT STATEMENT", vendor name, date range
- Opening balance row
- Transaction table: Date | Description | Reference | Debit | Credit | Balance
- Closing balance row (highlighted)
- Footer: standard business footer

**Styling:** Consistent with existing invoice PDF template (`src/lib/invoice-template-compact.ts`).

### UI

**Location:** `src/app/(authenticated)/oj-projects/clients/page.tsx`

Per-vendor "Statement" button. Opens a modal with:
- Date range picker (default: last 3 months)
- Preview of statement data (table format)
- "Download PDF" button — generates and downloads via browser
- "Email to Client" button — sends via Microsoft Graph

### Email

Uses `sendEmail()` from `src/lib/email/emailService.ts`.

- **To:** Vendor billing contact email (from `oj_vendor_billing_settings` or `invoice_vendors`)
- **Subject:** `Account Statement — {Vendor Name} — {Month Year} to {Month Year}`
- **Body:** Short cover note: "Please find attached your account statement for the period {from} to {to}. Current balance: £{closingBalance}."
- **Attachment:** Statement PDF (named `statement-{vendor-code}-{from}-{to}.pdf`)
- **Audit:** Log to `invoice_email_logs` with appropriate type

---

## Phase 3: Partial Payment Receipts (Universal)

### Current Flow

In `src/app/actions/invoices.ts`, `recordPayment()`:
1. Calls `InvoiceService.recordPayment()` to persist the payment
2. Checks if status changed to `paid`
3. If yes, calls `sendRemittanceAdviceForPaidInvoice()` which:
   - Generates receipt PDF via `generateInvoicePDF()` with `documentKind: 'remittance_advice'`
   - Sends email with subject "Receipt: Invoice {number} (Paid)"
   - Attaches PDF named `receipt-{invoice_number}.pdf`

### Changes

**In `recordPayment()` (`src/app/actions/invoices.ts`):**

Extend the condition that triggers `sendRemittanceAdviceForPaidInvoice()`:
- Current: fires only when new status is `paid`
- New: fires when new status is `paid` OR `partially_paid`

**Rename function** to `sendPaymentReceipt()` (more accurate for both cases).

**Adjust email subject line:**
- Full payment: `"Receipt: Invoice {number} (Paid in Full)"`
- Partial payment: `"Receipt: Invoice {number} (Payment Received — Balance: £{remaining})"`

**Receipt PDF:**
- The existing compact invoice template already has conditional rendering for `documentKind: 'remittance_advice'` and includes an "outstanding balance" field
- For partial payments, ensure `outstandingBalance` is populated with the remaining amount
- For full payments, show `outstandingBalance: 0` or "PAID IN FULL"
- No new template needed — just ensure the data is passed through correctly

**Guard:** Ensure we don't double-send if `recordPayment()` is called multiple times (use the existing `invoice_email_logs` table to check for recent sends against the same invoice + payment combination).

---

## Phase 4: Completeness Enhancements

### 4.1 — Payment history on project detail page

**Location:** `src/app/(authenticated)/oj-projects/projects/[id]/page.tsx`

Add a "Payments" tab or section showing:
- All invoices linked to this project (via `oj_entries.invoice_id` → `invoices`)
- Each invoice's payment status and payment history
- Total billed, total paid, total outstanding for this project

**Data:** New server action `getProjectPaymentHistory(projectId)` in `src/app/actions/oj-projects/projects.ts` that joins `oj_entries` → `invoices` → `invoice_payments`.

### 4.2 — Billing cron error alerting

**Location:** `src/app/api/cron/oj-projects-billing/route.ts`

At the end of each billing run:
- If any vendor billing failed (caught exceptions, partial failures), send an internal alert email
- Use `sendEmail()` to a configured admin address (new env var `OJ_PROJECTS_BILLING_ALERT_EMAIL`, fallback to existing admin email)
- Email contains: which vendors failed, error messages, which vendors succeeded
- Also fire on zero-vendor runs (sanity check — if billing expected vendors but found none)

### 4.3 — Statement mode UI clarity

**Location:** `src/app/(authenticated)/oj-projects/clients/page.tsx`

Add explanatory text next to the `statement_mode` toggle:
- Tooltip or help text: "When enabled, monthly invoices show a running balance statement with opening balance, charges, and closing balance — rather than itemised time entries. Best for clients on a monthly retainer or cap arrangement."
- Visual indicator when statement mode is active (e.g. badge on the client card)

### 4.4 — Void/credit note support

**Scope:** This extends the existing invoices system, not just OJ Projects.

**Invoice void:**
- Add `voidInvoice(invoiceId, reason)` server action in `src/app/actions/invoices.ts`
- Sets status to `void`, records reason and timestamp
- Reverses the effect on linked `oj_entries` — sets them back to `unbilled` so they can be re-billed
- Reverses linked `oj_recurring_charge_instances` similarly
- Voided invoices appear on the client statement as a credit entry (negative debit)
- Requires permission: `invoices` + `delete` (or a new `void` action)

**Credit note:**
- New `credit_notes` table: `id`, `invoice_id` (optional — can be standalone), `vendor_id`, `amount`, `reason`, `created_at`, `created_by`
- Server action: `createCreditNote(vendorId, amount, reason, invoiceId?)`
- Credit notes appear on the client statement as credit entries
- PDF generation using same compact template with `documentKind: 'credit_note'`
- Can be emailed to client

---

## Out of Scope

- Changes to the billing cron's core logic (cap mode, statement mode algorithms)
- New billing modes or pricing models
- Client self-service portal
- Automated payment reconciliation (e.g. bank feed integration)
- Changes to the existing overdue invoice chasing system

---

## File Impact Summary

| Area | Files | Type |
|------|-------|------|
| Migration | 1 new migration (constraint fix + credit_notes table) | New |
| Types | `src/types/oj-projects.ts` | Edit |
| Server actions | `client-balance.ts`, `client-statement.ts` (new), `projects.ts`, `invoices.ts` | Edit + New |
| Lib | `oj-statement.ts` (new), `oj-projects/utils.ts` (new), `microsoft-graph.ts` | New + Edit |
| Billing cron | `oj-projects-billing/route.ts` | Edit |
| Retainer cron | `oj-projects-retainer-projects/route.ts` | Edit |
| UI pages | `clients/page.tsx`, `projects/[id]/page.tsx`, invoice payment page | Edit |
| Templates | `invoice-template-compact.ts` | Edit |

**Estimated complexity:** L (score 4) — will be broken into multiple PRs per phase.
