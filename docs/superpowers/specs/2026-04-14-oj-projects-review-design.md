# OJ Projects Review — Bug Fixes, Client Statement, Payment Receipts & Completeness

**Date:** 2026-04-14
**Status:** Revised (post-adversarial review)
**Complexity:** L (score 4) — multiple files, new features, migration, cross-cutting receipt change
**Review:** `tasks/codex-qa-review/2026-04-14-oj-projects-review-adversarial-review.md`

---

## Overview

End-to-end review and enhancement of the OJ Projects section. Four workstreams:

1. **Bug fixes** — data integrity issues affecting accuracy of balances and billing
2. **Client statement** — running account statement (PDF + email) showing invoices, payments, credits, and balance over a date range
3. **Partial payment receipts** — extend existing receipt flow to fire on partial payments (universal, not OJ Projects only)
4. **Completeness recommendations** — payment history on project detail, billing cron alerting, statement mode UI clarity, void/credit note support

### Design Decisions (confirmed by user)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Exclude draft invoices from statement opening balance | Drafts haven't been sent to client — including them confuses the recipient |
| D2 | Void guard is absolute — cannot void invoices with payments | Forces credit note path; cleaner audit trail; matches standard accounting |
| D3 | Credit notes always tied to an invoice (`invoice_id` required) | Avoids fourth data source in balance computation; cleaner audit trail |
| D4 | Billing alert email: `OJ_PROJECTS_BILLING_ALERT_EMAIL` env var, fallback to `PAYROLL_ACCOUNTANT_EMAIL` | Likely the right person; override available without code changes |
| D5 | Billing cron continues after vendor failure — try/catch per vendor, aggregate errors, single alert email | One vendor's failure shouldn't block others from being billed on time |

---

## Phase 1: Bug Fixes

### 1.1 — one_off DB constraint gap

**Problem:** `chk_oj_entries_time_fields` in `oj_entries` only validates `time` and `mileage` entry types. `one_off` entries can have spurious `miles` or `duration_minutes_rounded` values that pass DB validation silently.

**Fix:** New migration with strict ordering:

```sql
-- Step 1: Audit — count violating rows (log for visibility)
SELECT count(*) FROM oj_entries
WHERE entry_type = 'one_off'
  AND (miles IS NOT NULL OR duration_minutes_rounded IS NOT NULL
       OR hourly_rate_snapshot IS NOT NULL OR mileage_rate_snapshot IS NOT NULL);

-- Step 2: Data fix — null out spurious values BEFORE adding constraint
UPDATE oj_entries
SET miles = NULL,
    duration_minutes_rounded = NULL,
    hourly_rate_snapshot = NULL,
    mileage_rate_snapshot = NULL
WHERE entry_type = 'one_off'
  AND (miles IS NOT NULL OR duration_minutes_rounded IS NOT NULL
       OR hourly_rate_snapshot IS NOT NULL OR mileage_rate_snapshot IS NOT NULL);

-- Step 3: Add constraint (now safe — no violating rows)
ALTER TABLE oj_entries DROP CONSTRAINT IF EXISTS chk_oj_entries_time_fields;
ALTER TABLE oj_entries ADD CONSTRAINT chk_oj_entries_time_fields CHECK (
  (entry_type = 'time' AND duration_minutes_rounded IS NOT NULL AND hourly_rate_snapshot IS NOT NULL
   AND miles IS NULL AND mileage_rate_snapshot IS NULL AND amount_ex_vat_snapshot IS NULL)
  OR
  (entry_type = 'mileage' AND miles IS NOT NULL AND mileage_rate_snapshot IS NOT NULL
   AND duration_minutes_rounded IS NULL AND hourly_rate_snapshot IS NULL AND amount_ex_vat_snapshot IS NULL)
  OR
  (entry_type = 'one_off' AND amount_ex_vat_snapshot IS NOT NULL
   AND duration_minutes_rounded IS NULL AND miles IS NULL
   AND hourly_rate_snapshot IS NULL AND mileage_rate_snapshot IS NULL)
);
```

**Critical:** Data-fix UPDATE must execute BEFORE ALTER TABLE or migration fails on existing violating rows.

### 1.2 — Client balance excludes one-off charges

**Problem:** `src/app/actions/oj-projects/client-balance.ts` only sums unbilled `time` and `mileage` entries. Unbilled `one_off` entries with `amount_ex_vat_snapshot` are excluded from `unbilledTotal`.

**Fix:**
1. Add `amount_ex_vat_snapshot` to the `.select()` clause (lines 66-67 currently only select `entry_type, duration_minutes_rounded, miles, hourly_rate_ex_vat_snapshot, vat_rate_snapshot, mileage_rate_snapshot` — missing this column means the fix produces zero totals without it)
2. Add a third branch in the unbilled total loop for `one_off` entries that sums `amount_ex_vat_snapshot`
3. Update the UI breakdown on the Clients page if it itemises by type

### 1.3 — Missing OJRecurringChargeInstance TypeScript type

**Problem:** `oj_recurring_charge_instances` table has no corresponding TypeScript type. The billing cron uses `any` throughout.

**Fix:** Add `OJRecurringChargeInstance` interface to `src/types/oj-projects.ts` matching the DB schema:
```typescript
export interface OJRecurringChargeInstance {
  id: string;
  vendor_id: string;
  recurring_charge_id: string;
  period_yyyymm: string;
  period_start: Date;
  period_end: Date;
  description_snapshot: string;
  amount_ex_vat_snapshot: number;
  vat_rate_snapshot: number;
  sort_order_snapshot: number;
  status: OJEntryStatus;
  billing_run_id: string | null;
  invoice_id: string | null;
  billed_at: Date | null;
  paid_at: Date | null;
  created_at: Date;
}
```

Also fix `selected_entry_ids: any | null` (line 104 of `oj-projects.ts`) to `selected_entry_ids: string[] | null`.

Replace `any` usage in the billing cron with this type. Refactor-only — no runtime behaviour changes.

### 1.4 — Cap-mode splitting fails silently

**Problem:** Cap-mode billing splits time entries proportionally when hitting the monthly cap. The split logic requires `start_at`/`end_at` timestamps. Most UI-created entries don't have these, causing the split function to return `null` — the entry is silently skipped.

**Fix:** Add fallback splitting logic for entries without `start_at`/`end_at`:
- Split by monetary amount proportion rather than time range
- **Rounding strategy:** Banker's rounding to 2 decimal places. Remainder (positive or negative penny) applied to the last entry to ensure partial + remainder = original amount exactly
- **Zero-value entries:** Skip splitting, log a warning, pass through without consuming cap
- Create a partial entry with the amount that fits under the cap, and a remainder entry with the rest
- Log a warning when fallback is used (for visibility)
- Ensure both partial and remainder entries maintain referential integrity

### 1.5 — Duplicated deriveClientCode

**Problem:** `deriveClientCode()` is duplicated identically in `src/app/actions/oj-projects/projects.ts` and `src/app/api/cron/oj-projects-retainer-projects/route.ts`.

**Fix:** Extract to `src/lib/oj-projects/utils.ts`. Import from both locations. Single source of truth.

### 1.6 — HTML injection in PDF templates (from Codex Security review)

**Problem:** `src/lib/invoice-template-compact.ts` injects unescaped vendor data (name, contact_name, email, phone, vat_number, item.description) into HTML rendered by Puppeteer. The OJ timesheet template (`src/lib/oj-timesheet.ts`) already uses `escapeHtml()` — the invoice template does not.

**Fix:** Consolidate the duplicated `escapeHtml()` functions from `invoice-template-compact.ts` and `oj-timesheet.ts` into `src/lib/oj-projects/utils.ts` (or a shared HTML utility). Apply `escapeHtml()` to all user-supplied data in `invoice-template-compact.ts`. The new statement template must also use `escapeHtml()` throughout.

---

## Phase 2: Client Statement

### Data Model

No new tables. The statement is a read-time aggregation:

**Sources:**
- `invoices` — filtered using the **dual-filter pattern**: `.eq('vendor_id', vendorId).ilike('reference', 'OJ Projects %')` — matching the existing `client-balance.ts` pattern. Both filters are mandatory (not either/or).
- `invoice_payments` — all payments against those filtered invoices
- Credit notes tied to those invoices (Phase 4.4)

**Invoice status filtering:** Exclude `void`, `written_off`, and `draft` invoices from all calculations (per decision D1). This matches existing `client-balance.ts` patterns.

**Statement data is based exclusively on committed `invoices` and `invoice_payments`** — it is immune to the `billing_pending` intermediate state that entries pass through during active billing runs.

**Computed fields:**
- Opening balance: sum of all unpaid invoice amounts (status NOT IN `void`, `written_off`, `draft`) with `created_at < dateFrom`
- Transactions: chronological list of invoices (debits) and payments (credits) within the date range
- Running balance: opening balance + cumulative debits - cumulative credits
- Closing balance: final running balance value

### Three Balance Concepts

The system will have three different balance figures. They are legitimately different numbers and must be clearly labelled to avoid confusion:

| Balance | Scope | Includes Unbilled? | Label in UI |
|---------|-------|-------------------|-------------|
| Client balance page | Vendor-level total | Yes (time + mileage + one-off + recurring) | "Total Balance (including unbilled work)" |
| Statement | Invoiced amounts only | No | "Invoiced Balance" |
| Receipt | Single invoice outstanding | No | "Outstanding on this invoice" |

The statement PDF and email must include a note: *"This statement reflects invoiced amounts only. Unbilled work in progress is not included."*

### Server Action

**File:** `src/app/actions/oj-projects/client-statement.ts`

```typescript
export async function getClientStatement(
  vendorId: string,
  dateFrom: string,  // ISO date
  dateTo: string     // ISO date
): Promise<{
  vendor: { id: string; name: string; email: string | null };
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
- Header: business name/logo, "ACCOUNT STATEMENT", vendor name (escaped via `escapeHtml()`), date range
- Opening balance row
- Transaction table: Date | Description | Reference | Debit | Credit | Balance
- Closing balance row (highlighted)
- Note: "This statement reflects invoiced amounts only. Unbilled work in progress is not included."
- Footer: standard business footer with page numbers

**Pagination:** CSS `page-break-inside: avoid` on table rows, `thead { display: table-header-group }` for repeating headers, page numbers in footer via CSS `@page` counter.

**Styling:** Consistent with existing invoice PDF template (`src/lib/invoice-template-compact.ts`). All user-supplied data escaped via `escapeHtml()`.

### UI

**Location:** `src/app/(authenticated)/oj-projects/clients/page.tsx`

Per-vendor "Statement" button. Opens a modal with:
- Date range picker (default: last 3 months)
- Preview of statement data (table format)
- "Download PDF" button — generates and downloads via browser
- "Email to Client" button — **disabled when no billing email configured** (check via `resolveInvoiceRecipientsForVendor()` pattern — returns `{ to: null }` when no email)
- **Empty state:** If zero transactions in selected range, show "No transactions found for this period." PDF is still generatable (shows opening/closing balance only). Confirmation prompt before emailing an empty statement.

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
1. Calls `InvoiceService.recordPayment()` to persist the payment — returns the new payment record
2. Checks if status changed to `paid` (lines 743-748)
3. If yes, calls `sendRemittanceAdviceForPaidInvoice()` which:
   - Has an internal guard at line 129: `if (invoice.status !== 'paid') return { sent: false, skippedReason: 'invoice_not_paid' }`
   - Resolves the latest payment by sorting all payments (line 163) — does NOT receive the specific payment ID
   - Generates receipt PDF via `generateInvoicePDF()` with `documentKind: 'remittance_advice'`
   - Sends email with subject "Receipt: Invoice {number} (Paid)"
   - Attaches PDF named `receipt-{invoice_number}.pdf`
   - Returns `{ sent: false, skippedReason: 'no_recipient' }` when vendor has no email — preserve this pattern

### Schema Change Required

**Migration:** Add `payment_id` column to `invoice_email_logs` for reliable dedup:
```sql
ALTER TABLE invoice_email_logs ADD COLUMN payment_id uuid REFERENCES invoice_payments(id);
```

### Changes

**In `recordPayment()` (`src/app/actions/invoices.ts`):**

**TWO locations must be updated** (missing either causes silent failure):
1. **Caller condition** (lines 743-748): trigger on `partially_paid` OR `paid` (currently only `paid`)
2. **Internal guard** in `sendRemittanceAdviceForPaidInvoice()` (line 129): accept `partially_paid` OR `paid` (currently rejects anything except `paid`)

**Pass `paymentId` explicitly** from `recordPayment()` to the receipt sender. The current flow only passes `invoiceId`, and the sender picks "latest payment" by sorting — this breaks for backdated payments or rapid successive payments. The sender must receive and use the specific `paymentId` returned from `InvoiceService.recordPayment()`.

**Rename function** to `sendPaymentReceipt()` (more accurate for both cases).

**Adjust email subject line:**
- Full payment: `"Receipt: Invoice {number} (Paid in Full)"`
- Partial payment: `"Receipt: Invoice {number} (Payment Received — Balance: £{remaining})"`

**Receipt PDF:**
- The existing compact invoice template already has conditional rendering for `documentKind: 'remittance_advice'` and includes an "outstanding balance" field
- For partial payments, ensure `outstandingBalance` is populated with the remaining amount
- For full payments, show `outstandingBalance: 0` or "PAID IN FULL"
- No new template needed — just ensure the data is passed through correctly

**Dedup guard:** Use the new `payment_id` column on `invoice_email_logs`. Before sending, check:
```sql
SELECT 1 FROM invoice_email_logs
WHERE payment_id = $1 AND status = 'sent'
LIMIT 1;
```
If a row exists, skip sending. Use `INSERT ... ON CONFLICT` or `SELECT FOR UPDATE` for atomicity.

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

**Architecture:** Extract alerting to `src/lib/oj-projects/billing-alerts.ts` — do NOT add inline to the 3,434-line cron file. Reuse the existing safe alerting pattern from `src/lib/cron/alerting.ts` which already handles PII redaction.

**Per-vendor error isolation (decision D5):** Wrap each vendor's billing in try/catch. Continue processing remaining vendors. Aggregate all results.

**Alert email sent at end of billing run when any of these occur:**
- Hard failure: uncaught exception during vendor billing
- Soft failure: anomalous invoice (e.g., £0 invoice, negative amount)
- Skipped vendor: vendor has settings but no eligible entries
- Zero-vendor run: billing expected vendors but found none
- Email delivery failure: invoice generated but email send failed

**Email content:**
- **To:** `OJ_PROJECTS_BILLING_ALERT_EMAIL` env var, fallback to `PAYROLL_ACCOUNTANT_EMAIL`
- **Content:** Vendor name and failure type only — **no raw Supabase error messages or financial amounts** (sanitize via existing `src/lib/cron/alerting.ts` pattern)
- **Subject:** `OJ Projects Billing Alert — {date} — {N} issues`

Add `OJ_PROJECTS_BILLING_ALERT_EMAIL` to `.env.example`.

### 4.3 — Statement mode UI clarity

**Location:** `src/app/(authenticated)/oj-projects/clients/page.tsx`

Add explanatory text next to the `statement_mode` toggle:
- Tooltip or help text: "When enabled, monthly invoices show a running balance statement with opening balance, charges, and closing balance — rather than itemised time entries. Best for clients on a monthly retainer or cap arrangement."
- Visual indicator when statement mode is active (e.g. badge on the client card)

### 4.4 — Void/credit note support

**Scope:** This extends the existing invoices system, not just OJ Projects.

**Invoice void:**
- Add `voidInvoice(invoiceId, reason)` server action in `src/app/actions/invoices.ts`
- **Absolute guard (decision D2):** `if (invoice.paid_amount > 0) return { error: 'Cannot void an invoice with payments. Issue a credit note instead.' }` — no override available
- **Note:** Existing code at `invoices.ts:440` already blocks voiding OJ-linked invoices. The new void action must integrate with this existing guard and provide the safe reversal path.
- Sets status to `void`, records reason and timestamp
- Reverses the effect on linked `oj_entries` — sets them back to `unbilled` so they can be re-billed. **Must clear `billing_run_id` and `invoice_id`** to participate correctly in the billing-run lock protocol (`unbilled → billing_pending → billed` chain)
- Reverses linked `oj_recurring_charge_instances` similarly
- Voided invoices appear on the client statement timeline as: debit at creation date, credit at void date (net zero)
- **Permissions:** Requires BOTH `invoices` + `delete` AND `oj_projects` + `manage` (cross-module operation — reversing OJ entries requires OJ manage per RLS policy)

**Credit note:**
- New `credit_notes` table:
  ```sql
  CREATE TABLE credit_notes (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    credit_note_number text NOT NULL UNIQUE,  -- sequential reference e.g. CN-2026-001
    invoice_id uuid NOT NULL REFERENCES invoices(id),  -- always tied to an invoice (decision D3)
    vendor_id uuid NOT NULL REFERENCES invoice_vendors(id),
    amount_ex_vat numeric(12,2) NOT NULL,
    vat_rate numeric(5,2) NOT NULL DEFAULT 20,
    amount_inc_vat numeric(12,2) NOT NULL,
    reason text NOT NULL,
    status text NOT NULL DEFAULT 'issued' CHECK (status IN ('draft', 'issued', 'void')),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid NOT NULL REFERENCES auth.users(id)
  );
  ALTER TABLE credit_notes ENABLE ROW LEVEL SECURITY;
  ```
- Server action: `createCreditNote(invoiceId, amount, reason)` — `vendor_id` derived from the invoice
- Credit notes appear on the client statement as credit entries
- PDF generation using same compact template with `documentKind: 'credit_note'`
- Can be emailed to client
- `client-balance.ts` must be updated to subtract credit note amounts from vendor balance
- **Negative balances:** Permitted with a warning (credit note exceeds outstanding) — recommend displaying as "Credit balance: £X.XX"
- **Permissions:** Requires `invoices` + `create` (credit notes are invoice-adjacent documents)

---

## Out of Scope

- Changes to the billing cron's core logic (cap mode, statement mode algorithms)
- New billing modes or pricing models
- Client self-service portal
- Automated payment reconciliation (e.g. bank feed integration)
- Changes to the existing overdue invoice chasing system
- Vendor-scoped RLS (currently application-layer filtering — a separate initiative)

---

## File Impact Summary

| Area | Files | Type |
|------|-------|------|
| Migration | 1 new migration (constraint fix, `payment_id` on `invoice_email_logs`, `credit_notes` table) | New |
| Types | `src/types/oj-projects.ts` | Edit |
| Server actions | `client-balance.ts`, `client-statement.ts` (new), `projects.ts`, `invoices.ts` | Edit + New |
| Lib | `oj-statement.ts` (new), `oj-projects/utils.ts` (new), `oj-projects/billing-alerts.ts` (new) | New |
| Billing cron | `oj-projects-billing/route.ts` | Edit |
| Retainer cron | `oj-projects-retainer-projects/route.ts` | Edit |
| UI pages | `clients/page.tsx`, `projects/[id]/page.tsx`, invoice payment page | Edit |
| Templates | `invoice-template-compact.ts` (escape user data), `oj-timesheet.ts` (extract shared `escapeHtml`) | Edit |
| Config | `.env.example` (add `OJ_PROJECTS_BILLING_ALERT_EMAIL`) | Edit |

**Estimated complexity:** L (score 4) — will be broken into multiple PRs per phase.
