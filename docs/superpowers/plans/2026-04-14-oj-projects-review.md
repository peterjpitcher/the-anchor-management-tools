# OJ Projects Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 6 bugs, add client statement (PDF + email), extend payment receipts to partial payments, and add completeness features (payment history, billing alerts, statement mode clarity, void/credit notes)

**Architecture:** 4-phase approach — bug fixes first (data integrity), then client statement, payment receipts (universal), and completeness enhancements. Each phase produces independently deployable code.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase (PostgreSQL), Puppeteer (PDF), Microsoft Graph (email), Tailwind CSS

---

## Phase 1: Bug Fixes (Tasks 1-6)

### Task 1: Migration — one_off constraint + payment_id on invoice_email_logs + credit_notes table

**Files:**
- **Create:** `supabase/migrations/20260609000000_oj_projects_review.sql`

**Steps:**

- [ ] Create the migration file with the following SQL:

```sql
-- =============================================================================
-- Migration: 20260609000000_oj_projects_review.sql
-- Purpose: Fix one_off constraint gap, add payment_id to invoice_email_logs,
--          create credit_notes table
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PART 1: Fix one_off constraint on oj_entries
-- ---------------------------------------------------------------------------

-- Step 1: Audit — count violating rows (logged for visibility via RAISE NOTICE)
DO $$
DECLARE
  violation_count integer;
BEGIN
  SELECT count(*) INTO violation_count
  FROM oj_entries
  WHERE entry_type = 'one_off'
    AND (miles IS NOT NULL OR duration_minutes_rounded IS NOT NULL
         OR hourly_rate_snapshot IS NOT NULL OR mileage_rate_snapshot IS NOT NULL);
  RAISE NOTICE 'one_off constraint violations found: %', violation_count;
END $$;

-- Step 2: Data fix — null out spurious values BEFORE adding constraint
UPDATE oj_entries
SET miles = NULL,
    duration_minutes_rounded = NULL,
    hourly_rate_snapshot = NULL,
    mileage_rate_snapshot = NULL
WHERE entry_type = 'one_off'
  AND (miles IS NOT NULL OR duration_minutes_rounded IS NOT NULL
       OR hourly_rate_snapshot IS NOT NULL OR mileage_rate_snapshot IS NOT NULL);

-- Step 3: Drop old constraint and add comprehensive version
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

-- ---------------------------------------------------------------------------
-- PART 2: Add payment_id to invoice_email_logs for receipt dedup
-- ---------------------------------------------------------------------------

ALTER TABLE invoice_email_logs
  ADD COLUMN IF NOT EXISTS payment_id uuid REFERENCES invoice_payments(id);

CREATE INDEX IF NOT EXISTS idx_invoice_email_logs_payment_id
  ON invoice_email_logs(payment_id)
  WHERE payment_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- PART 3: Create credit_notes table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS credit_notes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  credit_note_number text NOT NULL UNIQUE,
  invoice_id uuid NOT NULL REFERENCES invoices(id),
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

CREATE POLICY "Authenticated users can read credit_notes"
  ON credit_notes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert credit_notes"
  ON credit_notes FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update credit_notes"
  ON credit_notes FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice_id ON credit_notes(invoice_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_vendor_id ON credit_notes(vendor_id);
```

- [ ] Verify migration numbering does not conflict: latest is `20260608000000`, this is `20260609000000`
- [ ] Test locally with `npx supabase db push --dry-run`

**Commit:** `fix: add one_off constraint, payment_id on email logs, and credit_notes table`

---

### Task 2: Fix client-balance.ts — add one_off support

**Files:**
- **Modify:** `src/app/actions/oj-projects/client-balance.ts`
- **Modify:** `src/types/oj-projects.ts` (ClientBalance type is defined in client-balance.ts, not oj-projects.ts)

**Steps:**

- [ ] In `src/app/actions/oj-projects/client-balance.ts`, add `amount_ex_vat_snapshot` to the select clause (line 67):

Old code (lines 66-67):
```typescript
    .select(
      'entry_type, duration_minutes_rounded, miles, hourly_rate_ex_vat_snapshot, vat_rate_snapshot, mileage_rate_snapshot'
    )
```

New code:
```typescript
    .select(
      'entry_type, duration_minutes_rounded, miles, hourly_rate_ex_vat_snapshot, vat_rate_snapshot, mileage_rate_snapshot, amount_ex_vat_snapshot'
    )
```

- [ ] Add `unbilledOneOffTotal` to the `ClientBalance` type (lines 22-30):

Old code:
```typescript
export type ClientBalance = {
  unpaidInvoiceBalance: number
  unbilledTimeTotal: number
  unbilledMileageTotal: number
  unbilledRecurringTotal: number
  unbilledTotal: number
  totalOutstanding: number
  invoices: ClientInvoiceSummary[]
}
```

New code:
```typescript
export type ClientBalance = {
  unpaidInvoiceBalance: number
  unbilledTimeTotal: number
  unbilledMileageTotal: number
  unbilledOneOffTotal: number
  unbilledRecurringTotal: number
  unbilledTotal: number
  totalOutstanding: number
  invoices: ClientInvoiceSummary[]
}
```

- [ ] Add the `one_off` branch in the unbilled total loop. Replace the loop (lines 75-87):

Old code:
```typescript
  let unbilledTimeTotal = 0
  let unbilledMileageTotal = 0
  for (const entry of entries || []) {
    if (entry.entry_type === 'time') {
      const mins = Number(entry.duration_minutes_rounded || 0)
      const rate = Number(entry.hourly_rate_ex_vat_snapshot || 75)
      unbilledTimeTotal = roundMoney(unbilledTimeTotal + (mins / 60) * rate)
    } else if (entry.entry_type === 'mileage') {
      const miles = Number(entry.miles || 0)
      const mileageRate = Number(entry.mileage_rate_snapshot || 0.42)
      unbilledMileageTotal = roundMoney(unbilledMileageTotal + miles * mileageRate)
    }
  }
```

New code:
```typescript
  let unbilledTimeTotal = 0
  let unbilledMileageTotal = 0
  let unbilledOneOffTotal = 0
  for (const entry of entries || []) {
    if (entry.entry_type === 'time') {
      const mins = Number(entry.duration_minutes_rounded || 0)
      const rate = Number(entry.hourly_rate_ex_vat_snapshot || 75)
      unbilledTimeTotal = roundMoney(unbilledTimeTotal + (mins / 60) * rate)
    } else if (entry.entry_type === 'mileage') {
      const miles = Number(entry.miles || 0)
      const mileageRate = Number(entry.mileage_rate_snapshot || 0.42)
      unbilledMileageTotal = roundMoney(unbilledMileageTotal + miles * mileageRate)
    } else if (entry.entry_type === 'one_off') {
      const amount = Number(entry.amount_ex_vat_snapshot || 0)
      unbilledOneOffTotal = roundMoney(unbilledOneOffTotal + amount)
    }
  }
```

- [ ] Update the unbilledTotal computation (line 105):

Old code:
```typescript
  const unbilledTotal = roundMoney(unbilledTimeTotal + unbilledMileageTotal + unbilledRecurringTotal)
```

New code:
```typescript
  const unbilledTotal = roundMoney(unbilledTimeTotal + unbilledMileageTotal + unbilledOneOffTotal + unbilledRecurringTotal)
```

- [ ] Add `unbilledOneOffTotal` to the return object (around line 122):

Old code:
```typescript
      unbilledTimeTotal,
      unbilledMileageTotal,
      unbilledRecurringTotal,
```

New code:
```typescript
      unbilledTimeTotal,
      unbilledMileageTotal,
      unbilledOneOffTotal,
      unbilledRecurringTotal,
```

- [ ] Search for all consumers of `ClientBalance` type and ensure they handle the new `unbilledOneOffTotal` field. Check the clients page UI for balance breakdown display.

**Verification:**
```bash
npx tsc --noEmit
npm run lint
```

**Commit:** `fix: include one_off entries in client balance computation`

---

### Task 3: Add OJRecurringChargeInstance type + fix selected_entry_ids type

**Files:**
- **Modify:** `src/types/oj-projects.ts`

**Steps:**

- [ ] Add `OJRecurringChargeInstance` interface after the `OJBillingRun` type (after line 111):

```typescript
export type OJRecurringChargeInstance = {
  id: string
  vendor_id: string
  recurring_charge_id: string
  period_yyyymm: string
  period_start: string
  period_end: string
  description_snapshot: string
  amount_ex_vat_snapshot: number
  vat_rate_snapshot: number
  sort_order_snapshot: number
  status: OJEntryStatus
  billing_run_id: string | null
  invoice_id: string | null
  billed_at: string | null
  paid_at: string | null
  created_at: string
}
```

- [ ] Fix `selected_entry_ids` type on line 104:

Old code:
```typescript
  selected_entry_ids: any | null
```

New code:
```typescript
  selected_entry_ids: string[] | null
```

**Verification:**
```bash
npx tsc --noEmit
```

**Commit:** `fix: add OJRecurringChargeInstance type and fix selected_entry_ids typing`

---

### Task 4: Cap-mode split fallback for entries without start_at/end_at

**Files:**
- **Modify:** `src/app/api/cron/oj-projects-billing/route.ts`

**Steps:**

The current `splitTimeEntryForCap` function (line 821) returns `null` when `start_at` or `end_at` is missing (line 846). This silently skips the entry. We need a fallback that splits by monetary proportion instead.

- [ ] Replace the early return on line 846 with a fallback path. Modify the `splitTimeEntryForCap` function:

Find this block (lines 844-856):
```typescript
  const startAtRaw = candidate.start_at ? new Date(candidate.start_at) : null
  const endAtRaw = candidate.end_at ? new Date(candidate.end_at) : null
  if (!startAtRaw || !endAtRaw || Number.isNaN(startAtRaw.getTime()) || Number.isNaN(endAtRaw.getTime())) return null

  const diffMinutes = Math.max(Math.round((endAtRaw.getTime() - startAtRaw.getTime()) / 60000), 0)
  if (diffMinutes <= 0) return null

  let rawBilled = Math.round(diffMinutes * (partial.minutes / totalMinutes))
  rawBilled = Math.max(rawBilled, 1)
  if (rawBilled >= diffMinutes) rawBilled = Math.max(diffMinutes - 1, 1)

  const rawRemaining = Math.max(diffMinutes - rawBilled, 0)
  if (rawRemaining <= 0) return null
```

Replace with:
```typescript
  const startAtRaw = candidate.start_at ? new Date(candidate.start_at) : null
  const endAtRaw = candidate.end_at ? new Date(candidate.end_at) : null
  const hasValidTimeRange = startAtRaw && endAtRaw
    && !Number.isNaN(startAtRaw.getTime())
    && !Number.isNaN(endAtRaw.getTime())
    && Math.round((endAtRaw.getTime() - startAtRaw.getTime()) / 60000) > 0

  // Fallback: split by monetary proportion when start_at/end_at are missing
  if (!hasValidTimeRange) {
    console.warn(
      `[billing-cron] Cap split fallback: time entry ${candidate.id} has no valid start_at/end_at — splitting by amount proportion`
    )

    const nowIso = new Date().toISOString()

    const partialEntry = {
      ...candidate,
      duration_minutes_rounded: partial.minutes,
      duration_minutes_raw: partial.minutes,
      start_at: null,
      end_at: null,
      updated_at: nowIso,
    }

    let remainderEntry = {
      ...candidate,
      duration_minutes_rounded: remainingMinutes,
      duration_minutes_raw: remainingMinutes,
      start_at: null,
      end_at: null,
      status: 'unbilled',
      billing_run_id: null,
      invoice_id: null,
      billed_at: null,
      paid_at: null,
      created_at: nowIso,
      updated_at: nowIso,
    }

    if (input.persist) {
      if (!input.supabase) throw new Error('Supabase client required for split persist')
      const { data: updatedRow, error: updateError } = await input.supabase
        .from('oj_entries')
        .update({
          duration_minutes_rounded: partial.minutes,
          duration_minutes_raw: partial.minutes,
          updated_at: nowIso,
        })
        .eq('id', candidate.id)
        .select('id')
        .maybeSingle()
      if (updateError) throw new Error(updateError.message)
      if (!updatedRow) throw new Error(`Time entry not found while splitting for cap (fallback): ${candidate.id}`)

      const { data: inserted, error: insertError } = await input.supabase
        .from('oj_entries')
        .insert(
          buildEntryInsertPayload(candidate, {
            duration_minutes_rounded: remainingMinutes,
            duration_minutes_raw: remainingMinutes,
            start_at: null,
            end_at: null,
            miles: null,
            created_at: nowIso,
            updated_at: nowIso,
          })
        )
        .select('*')
        .single()
      if (insertError) throw new Error(insertError.message)

      remainderEntry = { ...inserted, project: candidate.project, work_type: candidate.work_type }
    }

    input.skippedTimeEntries.splice(index, 1, remainderEntry)
    input.selectedTimeEntries.push(partialEntry)

    return { addedIncVat: partial.incVat }
  }

  const diffMinutes = Math.max(Math.round((endAtRaw!.getTime() - startAtRaw!.getTime()) / 60000), 0)

  let rawBilled = Math.round(diffMinutes * (partial.minutes / totalMinutes))
  rawBilled = Math.max(rawBilled, 1)
  if (rawBilled >= diffMinutes) rawBilled = Math.max(diffMinutes - 1, 1)

  const rawRemaining = Math.max(diffMinutes - rawBilled, 0)
  if (rawRemaining <= 0) return null
```

- [ ] Also add zero-value entry handling. Before the `const partial` call (before line 838), add:

```typescript
  // Zero-value entries: skip splitting, pass through without consuming cap
  if (totalMinutes <= 0) {
    console.warn(`[billing-cron] Cap split: skipping zero-value time entry ${candidate.id}`)
    return null
  }
```

Note: This is already handled by the existing check on line 834, so this step is just confirming correctness.

**Verification:**
```bash
npx tsc --noEmit
npm run lint
```

**Commit:** `fix: add fallback cap-mode split for time entries without start_at/end_at`

---

### Task 5: Extract deriveClientCode to shared utils

**Files:**
- **Create:** `src/lib/oj-projects/utils.ts`
- **Modify:** `src/app/actions/oj-projects/projects.ts`
- **Modify:** `src/app/api/cron/oj-projects-retainer-projects/route.ts`

**Steps:**

- [ ] Create `src/lib/oj-projects/utils.ts`:

```typescript
/**
 * Shared OJ Projects utilities.
 */

/**
 * Derives a short client code from a vendor name.
 * Used for project codes and references.
 *
 * Examples:
 *   "Orange Jelly Limited" -> "OJ"
 *   "Acme Corp" -> "AC"
 *   "The Star Pub" -> "SP"
 */
export function deriveClientCode(vendorName: string): string {
  const stopWords = new Set(['THE', 'LIMITED', 'LTD', 'CO', 'COMPANY', 'GROUP', 'SERVICES', 'SERVICE', 'AND'])
  const tokens = String(vendorName || '')
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/[^A-Za-z0-9]/g, ''))
    .filter(Boolean)
    .map((t) => t.toUpperCase())
    .filter((t) => !stopWords.has(t))

  if (tokens.length === 0) return 'CLIENT'

  const initials = tokens.slice(0, 3).map((t) => t[0]).join('')
  return initials || 'CLIENT'
}

/**
 * Rounds a monetary value to 2 decimal places using epsilon correction.
 * Prevents floating-point rounding errors (e.g. 0.1 + 0.2 = 0.30000000000000004).
 */
export function roundMoney(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100
}
```

- [ ] In `src/app/actions/oj-projects/projects.ts`, find the local `deriveClientCode` function and replace it with an import:

Add at top:
```typescript
import { deriveClientCode } from '@/lib/oj-projects/utils'
```

Remove the local `deriveClientCode` function definition (search for `function deriveClientCode`).

- [ ] In `src/app/api/cron/oj-projects-retainer-projects/route.ts`, find the local `deriveClientCode` function (line 12) and replace it with an import:

Add at top:
```typescript
import { deriveClientCode } from '@/lib/oj-projects/utils'
```

Remove the local `deriveClientCode` function definition (lines 12-26 approximately).

**Verification:**
```bash
npx tsc --noEmit
npm run lint
```

**Commit:** `refactor: extract deriveClientCode to shared oj-projects utils`

---

### Task 6: Consolidate escapeHtml — export from alerting.ts, import everywhere

**Files:**
- **Modify:** `src/lib/oj-timesheet.ts` (remove local escapeHtml, import from alerting.ts)
- **Modify:** `src/lib/invoice-template-compact.ts` (remove local escapeHtml, import from alerting.ts, apply to user data)

**Steps:**

- [ ] In `src/lib/oj-timesheet.ts`, replace the local `escapeHtml` function (lines 3-10) with an import:

Old code:
```typescript
import { generatePDFFromHTML } from '@/lib/pdf-generator'

function escapeHtml(value: string) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
```

New code:
```typescript
import { generatePDFFromHTML } from '@/lib/pdf-generator'
import { escapeHtml } from '@/lib/cron/alerting'
```

- [ ] In `src/lib/invoice-template-compact.ts`, replace the local `escapeHtml` (lines 33-39 inside `generateCompactInvoiceHTML`) with an import. Since the local one is defined inside the function body, we need to:

Add import at top of file:
```typescript
import { escapeHtml } from '@/lib/cron/alerting'
```

Remove the local `escapeHtml` constant inside `generateCompactInvoiceHTML` (lines 33-40):
```typescript
  // Helper functions
  const escapeHtml = (value: string) => {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')
  }
```

- [ ] In `src/lib/invoice-template-compact.ts`, audit all user-supplied data injected into the HTML and ensure `escapeHtml()` is applied. Key fields to escape:
  - `invoice.vendor?.name` 
  - `invoice.vendor?.contact_name`
  - `invoice.vendor?.email`
  - `invoice.vendor?.phone`
  - `invoice.vendor?.vat_number`
  - `invoice.vendor?.address`
  - `item.description` for each line item
  - `invoice.reference`
  - `invoice.notes`
  - `invoice.internal_notes`

Search for these in the template and wrap with `escapeHtml()` where not already escaped.

**Verification:**
```bash
npx tsc --noEmit
npm run lint
npm run build
```

**Commit:** `refactor: consolidate escapeHtml and apply HTML escaping to invoice template`

---

## Phase 2: Client Statement (Tasks 7-10)

### Task 7: Server action — getClientStatement

**Files:**
- **Create:** `src/app/actions/oj-projects/client-statement.ts`

**Steps:**

- [ ] Create the file with the following content:

```typescript
'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { roundMoney } from '@/lib/oj-projects/utils'
import { formatDateInLondon } from '@/lib/dateUtils'

export interface StatementTransaction {
  date: string
  description: string
  reference: string
  debit: number | null
  credit: number | null
  balance: number
}

export interface ClientStatementData {
  vendor: { id: string; name: string; email: string | null }
  period: { from: string; to: string }
  openingBalance: number
  transactions: StatementTransaction[]
  closingBalance: number
}

export async function getClientStatement(
  vendorId: string,
  dateFrom: string,
  dateTo: string
): Promise<{ statement?: ClientStatementData; error?: string }> {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) return { error: 'You do not have permission to view OJ Projects data' }

  if (!vendorId || !dateFrom || !dateTo) {
    return { error: 'Missing required parameters: vendorId, dateFrom, dateTo' }
  }

  if (dateFrom > dateTo) {
    return { error: 'Date range is invalid: dateFrom must be before dateTo' }
  }

  const supabase = await createClient()

  // Fetch vendor details
  const { data: vendor, error: vendorError } = await supabase
    .from('invoice_vendors')
    .select('id, name, email')
    .eq('id', vendorId)
    .single()

  if (vendorError || !vendor) {
    return { error: vendorError?.message || 'Vendor not found' }
  }

  // Fetch all OJ Projects invoices for this vendor (dual-filter pattern)
  // Exclude void, written_off, and draft invoices (per decision D1)
  const { data: allInvoices, error: invoicesError } = await supabase
    .from('invoices')
    .select('id, invoice_number, invoice_date, status, total_amount, paid_amount, created_at')
    .eq('vendor_id', vendorId)
    .is('deleted_at', null)
    .ilike('reference', 'OJ Projects %')
    .not('status', 'in', '("void","written_off","draft")')
    .order('invoice_date', { ascending: true })

  if (invoicesError) return { error: invoicesError.message }

  const invoices = allInvoices || []

  // Fetch all payments for these invoices
  const invoiceIds = invoices.map((inv) => inv.id)
  let allPayments: Array<{
    id: string
    invoice_id: string
    amount: number
    payment_date: string
    payment_method: string | null
    reference: string | null
    created_at: string
  }> = []

  if (invoiceIds.length > 0) {
    const { data: payments, error: paymentsError } = await supabase
      .from('invoice_payments')
      .select('id, invoice_id, amount, payment_date, payment_method, reference, created_at')
      .in('invoice_id', invoiceIds)
      .order('payment_date', { ascending: true })

    if (paymentsError) return { error: paymentsError.message }
    allPayments = payments || []
  }

  // Fetch credit notes for these invoices
  let allCreditNotes: Array<{
    id: string
    credit_note_number: string
    invoice_id: string
    amount_inc_vat: number
    created_at: string
    status: string
  }> = []

  if (invoiceIds.length > 0) {
    const { data: creditNotes, error: cnError } = await supabase
      .from('credit_notes')
      .select('id, credit_note_number, invoice_id, amount_inc_vat, created_at, status')
      .in('invoice_id', invoiceIds)
      .eq('status', 'issued')
      .order('created_at', { ascending: true })

    if (cnError) {
      // credit_notes table may not exist yet — gracefully handle
      console.warn('[client-statement] credit_notes query failed (table may not exist):', cnError.message)
    } else {
      allCreditNotes = creditNotes || []
    }
  }

  // Opening balance: sum of unpaid amounts on invoices created BEFORE dateFrom
  const openingBalance = roundMoney(
    invoices
      .filter((inv) => inv.invoice_date < dateFrom)
      .reduce((acc, inv) => {
        const total = Number(inv.total_amount || 0)
        // Subtract payments made before dateFrom for these invoices
        const paymentsBefore = allPayments
          .filter((p) => p.invoice_id === inv.id && p.payment_date < dateFrom)
          .reduce((sum, p) => sum + Number(p.amount || 0), 0)
        // Subtract credit notes created before dateFrom
        const creditsBefore = allCreditNotes
          .filter((cn) => cn.invoice_id === inv.id && cn.created_at.slice(0, 10) < dateFrom)
          .reduce((sum, cn) => sum + Number(cn.amount_inc_vat || 0), 0)
        return acc + Math.max(total - paymentsBefore - creditsBefore, 0)
      }, 0)
  )

  // Build transactions within the date range
  type RawTransaction = {
    date: string
    sortKey: string
    description: string
    reference: string
    debit: number | null
    credit: number | null
  }

  const rawTransactions: RawTransaction[] = []

  // Invoices (debits) within range
  for (const inv of invoices) {
    if (inv.invoice_date >= dateFrom && inv.invoice_date <= dateTo) {
      rawTransactions.push({
        date: inv.invoice_date,
        sortKey: `${inv.invoice_date}-A-${inv.created_at}`,
        description: `Invoice ${inv.invoice_number}`,
        reference: inv.invoice_number,
        debit: Number(inv.total_amount || 0),
        credit: null,
      })
    }
  }

  // Payments (credits) within range
  for (const payment of allPayments) {
    if (payment.payment_date >= dateFrom && payment.payment_date <= dateTo) {
      const inv = invoices.find((i) => i.id === payment.invoice_id)
      const methodLabel = payment.payment_method
        ? ` — ${payment.payment_method.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`
        : ''
      rawTransactions.push({
        date: payment.payment_date,
        sortKey: `${payment.payment_date}-B-${payment.created_at}`,
        description: `Payment received${methodLabel}`,
        reference: inv?.invoice_number || payment.reference || '',
        debit: null,
        credit: Number(payment.amount || 0),
      })
    }
  }

  // Credit notes within range
  for (const cn of allCreditNotes) {
    const cnDate = cn.created_at.slice(0, 10)
    if (cnDate >= dateFrom && cnDate <= dateTo) {
      rawTransactions.push({
        date: cnDate,
        sortKey: `${cnDate}-C-${cn.created_at}`,
        description: `Credit Note ${cn.credit_note_number}`,
        reference: cn.credit_note_number,
        debit: null,
        credit: Number(cn.amount_inc_vat || 0),
      })
    }
  }

  // Sort chronologically
  rawTransactions.sort((a, b) => a.sortKey.localeCompare(b.sortKey))

  // Compute running balance
  let runningBalance = openingBalance
  const transactions: StatementTransaction[] = rawTransactions.map((txn) => {
    if (txn.debit !== null) {
      runningBalance = roundMoney(runningBalance + txn.debit)
    }
    if (txn.credit !== null) {
      runningBalance = roundMoney(runningBalance - txn.credit)
    }
    return {
      date: txn.date,
      description: txn.description,
      reference: txn.reference,
      debit: txn.debit,
      credit: txn.credit,
      balance: runningBalance,
    }
  })

  const closingBalance = runningBalance

  return {
    statement: {
      vendor: { id: vendor.id, name: vendor.name, email: vendor.email || null },
      period: { from: dateFrom, to: dateTo },
      openingBalance,
      transactions,
      closingBalance,
    },
  }
}
```

**Verification:**
```bash
npx tsc --noEmit
npm run lint
```

**Commit:** `feat: add getClientStatement server action for OJ Projects`

---

### Task 8: PDF template — oj-statement.ts

**Files:**
- **Create:** `src/lib/oj-statement.ts`

**Steps:**

- [ ] Create the PDF template file:

```typescript
import { generatePDFFromHTML } from '@/lib/pdf-generator'
import { escapeHtml } from '@/lib/cron/alerting'
import { COMPANY_DETAILS } from '@/lib/company-details'
import type { StatementTransaction } from '@/app/actions/oj-projects/client-statement'

export interface StatementPDFInput {
  vendorName: string
  periodFrom: string
  periodTo: string
  openingBalance: number
  transactions: StatementTransaction[]
  closingBalance: number
}

function formatCurrency(amount: number): string {
  return `£${Math.abs(amount).toFixed(2)}`
}

function formatStatementDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function generateStatementHTML(input: StatementPDFInput): string {
  const vendorName = escapeHtml(input.vendorName)
  const periodFrom = escapeHtml(formatStatementDate(input.periodFrom))
  const periodTo = escapeHtml(formatStatementDate(input.periodTo))

  const transactionRows = input.transactions
    .map((txn) => {
      const debitCell = txn.debit !== null ? formatCurrency(txn.debit) : ''
      const creditCell = txn.credit !== null ? formatCurrency(txn.credit) : ''
      const balanceCell = txn.balance < 0
        ? `<span style="color: #dc2626;">(${formatCurrency(txn.balance)})</span>`
        : formatCurrency(txn.balance)

      return `
        <tr style="page-break-inside: avoid;">
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px;">${escapeHtml(formatStatementDate(txn.date))}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px;">${escapeHtml(txn.description)}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px;">${escapeHtml(txn.reference)}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; text-align: right;">${debitCell}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; text-align: right;">${creditCell}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; text-align: right; font-weight: 500;">${balanceCell}</td>
        </tr>`
    })
    .join('\n')

  const closingBalanceDisplay = input.closingBalance < 0
    ? `Credit Balance: ${formatCurrency(input.closingBalance)}`
    : formatCurrency(input.closingBalance)

  const companyName = escapeHtml(COMPANY_DETAILS?.name || 'Orange Jelly Limited')
  const companyAddress = escapeHtml(COMPANY_DETAILS?.address || '')
  const companyPhone = escapeHtml(COMPANY_DETAILS?.phone || '')
  const companyEmail = escapeHtml(COMPANY_DETAILS?.email || '')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page {
      margin: 20mm 15mm 25mm 15mm;
      @bottom-center {
        content: "Page " counter(page) " of " counter(pages);
        font-size: 10px;
        color: #9ca3af;
      }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #1f2937;
      line-height: 1.5;
      margin: 0;
      padding: 0;
    }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    tr { page-break-inside: avoid; }
    table { width: 100%; border-collapse: collapse; }
  </style>
</head>
<body>
  <!-- Header -->
  <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px;">
    <div>
      <h1 style="font-size: 24px; font-weight: 700; margin: 0 0 4px 0; color: #111827;">ACCOUNT STATEMENT</h1>
      <p style="font-size: 14px; color: #6b7280; margin: 0;">${companyName}</p>
    </div>
    <div style="text-align: right;">
      <p style="font-size: 13px; color: #6b7280; margin: 0;">${companyAddress}</p>
      <p style="font-size: 13px; color: #6b7280; margin: 0;">${companyPhone}</p>
      <p style="font-size: 13px; color: #6b7280; margin: 0;">${companyEmail}</p>
    </div>
  </div>

  <!-- Client & Period -->
  <div style="display: flex; justify-content: space-between; margin-bottom: 24px; padding: 16px; background: #f9fafb; border-radius: 8px;">
    <div>
      <p style="font-size: 12px; color: #6b7280; margin: 0 0 4px 0; text-transform: uppercase; letter-spacing: 0.05em;">Client</p>
      <p style="font-size: 16px; font-weight: 600; margin: 0;">${vendorName}</p>
    </div>
    <div style="text-align: right;">
      <p style="font-size: 12px; color: #6b7280; margin: 0 0 4px 0; text-transform: uppercase; letter-spacing: 0.05em;">Period</p>
      <p style="font-size: 14px; font-weight: 500; margin: 0;">${periodFrom} — ${periodTo}</p>
    </div>
  </div>

  <!-- Transactions Table -->
  <table>
    <thead>
      <tr style="background: #f3f4f6;">
        <th style="padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 600; color: #374151; border-bottom: 2px solid #d1d5db; text-transform: uppercase; letter-spacing: 0.05em;">Date</th>
        <th style="padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 600; color: #374151; border-bottom: 2px solid #d1d5db; text-transform: uppercase; letter-spacing: 0.05em;">Description</th>
        <th style="padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 600; color: #374151; border-bottom: 2px solid #d1d5db; text-transform: uppercase; letter-spacing: 0.05em;">Reference</th>
        <th style="padding: 10px 12px; text-align: right; font-size: 12px; font-weight: 600; color: #374151; border-bottom: 2px solid #d1d5db; text-transform: uppercase; letter-spacing: 0.05em;">Debit</th>
        <th style="padding: 10px 12px; text-align: right; font-size: 12px; font-weight: 600; color: #374151; border-bottom: 2px solid #d1d5db; text-transform: uppercase; letter-spacing: 0.05em;">Credit</th>
        <th style="padding: 10px 12px; text-align: right; font-size: 12px; font-weight: 600; color: #374151; border-bottom: 2px solid #d1d5db; text-transform: uppercase; letter-spacing: 0.05em;">Balance</th>
      </tr>
    </thead>
    <tbody>
      <!-- Opening Balance -->
      <tr style="background: #fefce8; page-break-inside: avoid;">
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px;" colspan="5"><strong>Opening Balance</strong></td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; text-align: right; font-weight: 600;">${formatCurrency(input.openingBalance)}</td>
      </tr>
      ${transactionRows}
    </tbody>
    <tfoot>
      <!-- Closing Balance -->
      <tr style="background: #f0fdf4; page-break-inside: avoid;">
        <td style="padding: 12px; border-top: 2px solid #16a34a; font-size: 14px; font-weight: 700;" colspan="5">Closing Balance</td>
        <td style="padding: 12px; border-top: 2px solid #16a34a; font-size: 14px; font-weight: 700; text-align: right;">${closingBalanceDisplay}</td>
      </tr>
    </tfoot>
  </table>

  <!-- Note -->
  <div style="margin-top: 24px; padding: 12px 16px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px;">
    <p style="font-size: 12px; color: #1e40af; margin: 0; font-style: italic;">
      This statement reflects invoiced amounts only. Unbilled work in progress is not included.
    </p>
  </div>

  <!-- Footer -->
  <div style="margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
    <p style="font-size: 11px; color: #9ca3af; text-align: center; margin: 0;">
      ${companyName} | Generated on ${escapeHtml(new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/London' }))}
    </p>
  </div>
</body>
</html>`
}

export async function generateStatementPDF(input: StatementPDFInput): Promise<Buffer> {
  const html = generateStatementHTML(input)
  return generatePDFFromHTML(html, {
    format: 'A4',
    printBackground: true,
    margin: { top: '20mm', bottom: '25mm', left: '15mm', right: '15mm' },
  })
}
```

**Verification:**
```bash
npx tsc --noEmit
npm run lint
```

**Commit:** `feat: add statement PDF template for OJ Projects`

---

### Task 9: Email — sendStatementEmail function

**Files:**
- **Modify:** `src/app/actions/oj-projects/client-statement.ts` (add email function)

**Steps:**

- [ ] Add the `sendStatementEmail` function to `src/app/actions/oj-projects/client-statement.ts`:

```typescript
import { sendEmail } from '@/lib/email/emailService'
import { generateStatementPDF } from '@/lib/oj-statement'
import { logAuditEvent } from '@/app/actions/audit'
import { resolveInvoiceRecipientsForVendor } from '@/app/actions/invoices'
import { createClient } from '@/lib/supabase/server'

export async function sendStatementEmail(
  vendorId: string,
  dateFrom: string,
  dateTo: string
): Promise<{ success?: boolean; error?: string }> {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) return { error: 'You do not have permission to send statements' }

  // Get statement data
  const result = await getClientStatement(vendorId, dateFrom, dateTo)
  if (result.error || !result.statement) {
    return { error: result.error || 'Failed to generate statement data' }
  }

  const { statement } = result
  const supabase = await createClient()

  // Resolve recipient
  const recipientResult = await resolveInvoiceRecipientsForVendor(
    supabase,
    vendorId,
    statement.vendor.email
  )

  if ('error' in recipientResult) {
    return { error: recipientResult.error }
  }

  if (!recipientResult.to) {
    return { error: 'No billing email configured for this vendor' }
  }

  // Generate PDF
  const pdfBuffer = await generateStatementPDF({
    vendorName: statement.vendor.name,
    periodFrom: dateFrom,
    periodTo: dateTo,
    openingBalance: statement.openingBalance,
    transactions: statement.transactions,
    closingBalance: statement.closingBalance,
  })

  // Format date range for subject
  const fromDate = new Date(dateFrom + 'T00:00:00Z')
  const toDate = new Date(dateTo + 'T00:00:00Z')
  const fromLabel = fromDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const toLabel = toDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  const subject = `Account Statement — ${statement.vendor.name} — ${fromLabel} to ${toLabel}`
  const closingLabel = statement.closingBalance < 0
    ? `Credit balance: £${Math.abs(statement.closingBalance).toFixed(2)}`
    : `£${statement.closingBalance.toFixed(2)}`

  const bodyHtml = `
    <p>Dear ${escapeHtml(statement.vendor.name)},</p>
    <p>Please find attached your account statement for the period ${escapeHtml(formatStatementDate(dateFrom))} to ${escapeHtml(formatStatementDate(dateTo))}.</p>
    <p>Current balance: <strong>${closingLabel}</strong></p>
    <p>If you have any questions, please don't hesitate to get in touch.</p>
    <p>Kind regards,<br>Orange Jelly Limited</p>
  `

  // Derive vendor code for filename
  const vendorCode = statement.vendor.name
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()

  const emailResult = await sendEmail({
    to: recipientResult.to,
    subject,
    html: bodyHtml,
    cc: recipientResult.cc,
    attachments: [
      {
        name: `statement-${vendorCode}-${dateFrom}-${dateTo}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  })

  if (!emailResult.success) {
    return { error: emailResult.error || 'Failed to send statement email' }
  }

  // Log to invoice_email_logs
  const { data: { user } } = await supabase.auth.getUser()

  await supabase.from('invoice_email_logs').insert({
    invoice_id: null,
    sent_to: recipientResult.to,
    sent_by: user?.id || null,
    subject,
    body: bodyHtml,
    status: 'sent',
  })

  await logAuditEvent({
    operation_type: 'send',
    resource_type: 'statement',
    resource_id: vendorId,
    operation_status: 'success',
    new_values: {
      action: 'statement_sent',
      vendor_name: statement.vendor.name,
      period_from: dateFrom,
      period_to: dateTo,
      recipient: recipientResult.to,
    },
  })

  return { success: true }
}
```

Note: The imports for `escapeHtml` and `formatStatementDate` need to be at the top of the file. Since `formatStatementDate` is in `oj-statement.ts`, either export it from there or use a simple inline format. For simplicity, add a local helper or import from the statement lib. The `escapeHtml` import comes from `@/lib/cron/alerting`.

- [ ] Ensure `resolveInvoiceRecipientsForVendor` is exported from `src/app/actions/invoices.ts`. If not currently exported, add `export` to it.

**Verification:**
```bash
npx tsc --noEmit
npm run lint
```

**Commit:** `feat: add statement email sending for OJ Projects`

---

### Task 10: UI — Statement button + modal on clients page

**Files:**
- **Modify:** `src/app/(authenticated)/oj-projects/clients/page.tsx`

**Steps:**

- [ ] Add a "Statement" button to each vendor card/row in the clients page. This button opens a modal component.

- [ ] Create a `StatementModal` client component (can be inline in the file or extracted to a component file). The modal should contain:
  - Date range picker with `dateFrom` and `dateTo` inputs (default: 3 months ago to today)
  - "Preview" button that calls `getClientStatement()` and renders a table
  - "Download PDF" button that calls `generateStatementPDF()` via a server action wrapper and triggers browser download
  - "Email to Client" button — disabled when vendor has no billing email
  - Empty state: "No transactions found for this period" with PDF still downloadable

- [ ] The download mechanism: create an API route `src/app/api/oj-projects/statement-pdf/route.ts` that accepts GET params (`vendorId`, `dateFrom`, `dateTo`), generates the PDF, and returns it with appropriate headers:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { getClientStatement } from '@/app/actions/oj-projects/client-statement'
import { generateStatementPDF } from '@/lib/oj-statement'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { searchParams } = request.nextUrl
  const vendorId = searchParams.get('vendorId')
  const dateFrom = searchParams.get('dateFrom')
  const dateTo = searchParams.get('dateTo')

  if (!vendorId || !dateFrom || !dateTo) {
    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
  }

  const result = await getClientStatement(vendorId, dateFrom, dateTo)
  if (result.error || !result.statement) {
    return NextResponse.json({ error: result.error || 'Failed' }, { status: 500 })
  }

  const { statement } = result

  const pdfBuffer = await generateStatementPDF({
    vendorName: statement.vendor.name,
    periodFrom: dateFrom,
    periodTo: dateTo,
    openingBalance: statement.openingBalance,
    transactions: statement.transactions,
    closingBalance: statement.closingBalance,
  })

  const vendorCode = statement.vendor.name
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()

  return new NextResponse(pdfBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="statement-${vendorCode}-${dateFrom}-${dateTo}.pdf"`,
    },
  })
}
```

- [ ] The modal UI (client component) should follow the project's existing modal patterns. Approximate structure:

```typescript
'use client'

import { useState, useCallback } from 'react'
import { getClientStatement, sendStatementEmail } from '@/app/actions/oj-projects/client-statement'
import type { StatementTransaction, ClientStatementData } from '@/app/actions/oj-projects/client-statement'
import { toast } from 'sonner'

interface StatementModalProps {
  vendorId: string
  vendorName: string
  vendorEmail: string | null
  isOpen: boolean
  onClose: () => void
}

export function StatementModal({ vendorId, vendorName, vendorEmail, isOpen, onClose }: StatementModalProps) {
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 3)
    return d.toISOString().slice(0, 10)
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [statement, setStatement] = useState<ClientStatementData | null>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)

  const handlePreview = useCallback(async () => {
    setLoading(true)
    try {
      const result = await getClientStatement(vendorId, dateFrom, dateTo)
      if (result.error) {
        toast.error(result.error)
      } else if (result.statement) {
        setStatement(result.statement)
      }
    } finally {
      setLoading(false)
    }
  }, [vendorId, dateFrom, dateTo])

  const handleDownload = useCallback(() => {
    const url = `/api/oj-projects/statement-pdf?vendorId=${vendorId}&dateFrom=${dateFrom}&dateTo=${dateTo}`
    window.open(url, '_blank')
  }, [vendorId, dateFrom, dateTo])

  const handleEmail = useCallback(async () => {
    if (!vendorEmail) return

    if (statement && statement.transactions.length === 0) {
      if (!confirm('This statement has no transactions. Are you sure you want to email it?')) return
    }

    setSending(true)
    try {
      const result = await sendStatementEmail(vendorId, dateFrom, dateTo)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Statement emailed successfully')
        onClose()
      }
    } finally {
      setSending(false)
    }
  }, [vendorId, vendorEmail, dateFrom, dateTo, statement, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Account Statement — {vendorName}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            ✕
          </button>
        </div>

        {/* Date Range */}
        <div className="flex gap-4 mb-4">
          <div>
            <label htmlFor="stmt-from" className="block text-sm font-medium text-gray-700 mb-1">From</label>
            <input
              id="stmt-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="stmt-to" className="block text-sm font-medium text-gray-700 mb-1">To</label>
            <input
              id="stmt-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={handlePreview}
              disabled={loading}
              className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Preview'}
            </button>
          </div>
        </div>

        {/* Preview Table */}
        {statement && (
          <div className="mb-4">
            {statement.transactions.length === 0 ? (
              <p className="text-gray-500 text-sm italic py-4 text-center">No transactions found for this period.</p>
            ) : (
              <div className="border rounded overflow-auto max-h-96">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Date</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Description</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Reference</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-600">Debit</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-600">Credit</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-600">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="bg-yellow-50">
                      <td className="px-3 py-2" colSpan={5}><strong>Opening Balance</strong></td>
                      <td className="px-3 py-2 text-right font-semibold">£{statement.openingBalance.toFixed(2)}</td>
                    </tr>
                    {statement.transactions.map((txn, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-2">{txn.date}</td>
                        <td className="px-3 py-2">{txn.description}</td>
                        <td className="px-3 py-2">{txn.reference}</td>
                        <td className="px-3 py-2 text-right">{txn.debit !== null ? `£${txn.debit.toFixed(2)}` : ''}</td>
                        <td className="px-3 py-2 text-right">{txn.credit !== null ? `£${txn.credit.toFixed(2)}` : ''}</td>
                        <td className="px-3 py-2 text-right font-medium">£{txn.balance.toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr className="bg-green-50 border-t-2 border-green-600">
                      <td className="px-3 py-2 font-bold" colSpan={5}>Closing Balance</td>
                      <td className="px-3 py-2 text-right font-bold">£{statement.closingBalance.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-xs text-blue-600 italic mt-2">
              This statement reflects invoiced amounts only. Unbilled work in progress is not included.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 justify-end pt-4 border-t">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="bg-gray-100 text-gray-800 px-4 py-2 rounded text-sm hover:bg-gray-200"
          >
            Download PDF
          </button>
          <button
            type="button"
            onClick={handleEmail}
            disabled={!vendorEmail || sending}
            title={!vendorEmail ? 'No billing email configured for this vendor' : ''}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? 'Sending...' : 'Email to Client'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] Add the `StatementModal` to the clients page. Add state to track which vendor's statement modal is open. Add a "Statement" button per vendor row.

**Verification:**
```bash
npx tsc --noEmit
npm run lint
npm run build
```

**Commit:** `feat: add statement UI with preview, PDF download, and email on clients page`

---

## Phase 3: Partial Payment Receipts (Tasks 11-13)

### Task 11: Rename function + add paymentId parameter + dedup guard

**Files:**
- **Modify:** `src/app/actions/invoices.ts`

**Steps:**

- [ ] Rename `sendRemittanceAdviceForPaidInvoice` to `sendPaymentReceipt` (line 112). Update the function signature to accept `paymentId`:

Old code (line 112-114):
```typescript
async function sendRemittanceAdviceForPaidInvoice(
  invoiceId: string,
  sentByUserId?: string | null
): Promise<RemittanceAdviceResult> {
```

New code:
```typescript
async function sendPaymentReceipt(
  invoiceId: string,
  paymentId: string,
  sentByUserId?: string | null
): Promise<RemittanceAdviceResult> {
```

- [ ] Update the internal guard (line 129) to accept `partially_paid`:

Old code:
```typescript
  if (invoice.status !== 'paid') {
    return { sent: false, skippedReason: 'invoice_not_paid' }
  }
```

New code:
```typescript
  if (invoice.status !== 'paid' && invoice.status !== 'partially_paid') {
    return { sent: false, skippedReason: 'invoice_not_paid' }
  }
```

- [ ] Add dedup guard after the status check, before resolving recipients. Query `invoice_email_logs` for an existing sent receipt for this specific `payment_id`:

```typescript
  // Dedup: check if receipt already sent for this specific payment
  const { data: existingLog } = await supabase
    .from('invoice_email_logs')
    .select('id')
    .eq('payment_id', paymentId)
    .eq('status', 'sent')
    .limit(1)
    .maybeSingle()

  if (existingLog) {
    return { sent: false, skippedReason: 'already_sent' }
  }
```

- [ ] Replace the latest payment sort logic (lines 163-169) with a direct lookup using the provided `paymentId`:

Old code:
```typescript
  const latestPayment = (invoice.payments || [])
    .slice()
    .sort((a, b) => {
      const aDate = new Date(a.payment_date || a.created_at || 0).getTime()
      const bDate = new Date(b.payment_date || b.created_at || 0).getTime()
      return bDate - aDate
    })[0]
```

New code:
```typescript
  const latestPayment = (invoice.payments || []).find((p) => p.id === paymentId)
    || (invoice.payments || []).slice().sort((a, b) => {
      const aDate = new Date(a.payment_date || a.created_at || 0).getTime()
      const bDate = new Date(b.payment_date || b.created_at || 0).getTime()
      return bDate - aDate
    })[0]
```

- [ ] Add `payment_id` to the email log insert (line 221):

Old code:
```typescript
      recipients.map((address) => ({
        invoice_id: invoiceId,
        sent_to: address,
        sent_by: sentByUserId || null,
        subject,
        body,
        status: 'sent',
      }))
```

New code:
```typescript
      recipients.map((address) => ({
        invoice_id: invoiceId,
        payment_id: paymentId,
        sent_to: address,
        sent_by: sentByUserId || null,
        subject,
        body,
        status: 'sent',
      }))
```

- [ ] Also add `payment_id` to the failed log insert (around line 259).

**Verification:**
```bash
npx tsc --noEmit
npm run lint
```

**Commit:** `feat: rename to sendPaymentReceipt with paymentId dedup and partial payment support`

---

### Task 12: Update recordPayment caller condition + pass paymentId

**Files:**
- **Modify:** `src/app/actions/invoices.ts`

**Steps:**

- [ ] Update the caller condition (lines 743-747) to trigger on `partially_paid` OR `paid`, and pass `payment.id`:

Old code:
```typescript
    } else if (
      invoiceBeforePayment.status !== 'paid' &&
      invoiceAfterPayment?.status === 'paid'
    ) {
      remittanceAdvice = await sendRemittanceAdviceForPaidInvoice(invoiceId, user?.id || null)
    }
```

New code:
```typescript
    } else if (
      invoiceAfterPayment?.status === 'paid' ||
      invoiceAfterPayment?.status === 'partially_paid'
    ) {
      remittanceAdvice = await sendPaymentReceipt(invoiceId, payment.id, user?.id || null)
    }
```

Note: The old condition checked that status wasn't already `paid` before the payment. The new condition simply checks if the invoice is now `paid` or `partially_paid` after the payment. The dedup guard in `sendPaymentReceipt` (from Task 11) prevents duplicate sends.

**Verification:**
```bash
npx tsc --noEmit
npm run lint
```

**Commit:** `feat: trigger payment receipt on both partial and full payments`

---

### Task 13: Update email subject lines for partial vs full

**Files:**
- **Modify:** `src/app/actions/invoices.ts`

**Steps:**

- [ ] In `sendPaymentReceipt`, update the subject line (around line 177). Replace the static subject:

Old code:
```typescript
  const subject = `Receipt: Invoice ${invoice.invoice_number} (Paid)`
```

New code:
```typescript
  const outstandingBalance = Math.max(0, invoice.total_amount - invoice.paid_amount)
  const isPaidInFull = invoice.status === 'paid' || outstandingBalance <= 0
  const subject = isPaidInFull
    ? `Receipt: Invoice ${invoice.invoice_number} (Paid in Full)`
    : `Receipt: Invoice ${invoice.invoice_number} (Payment Received — Balance: £${outstandingBalance.toFixed(2)})`
```

Note: The `outstandingBalance` variable was already computed below the old subject line (line 174). Move it before the subject line or reorder slightly.

- [ ] Ensure the `outstandingBalance` computation is done before the subject line (reorder if needed — currently it's on line 174 and subject is on line 177, so just move subject below the existing computation).

**Verification:**
```bash
npx tsc --noEmit
npm run lint
npm run build
```

**Commit:** `feat: differentiate receipt email subjects for partial vs full payments`

---

## Phase 4: Completeness (Tasks 14-18)

### Task 14: Payment history on project detail page

**Files:**
- **Modify:** `src/app/actions/oj-projects/projects.ts` (add new server action)
- **Modify:** `src/app/(authenticated)/oj-projects/projects/[id]/page.tsx` (add Payments section)

**Steps:**

- [ ] Add `getProjectPaymentHistory` server action to `src/app/actions/oj-projects/projects.ts`:

```typescript
export interface ProjectPaymentSummary {
  invoiceId: string
  invoiceNumber: string
  invoiceDate: string
  invoiceStatus: string
  totalAmount: number
  paidAmount: number
  outstanding: number
  payments: Array<{
    id: string
    amount: number
    paymentDate: string
    paymentMethod: string
    reference: string | null
  }>
}

export async function getProjectPaymentHistory(
  projectId: string
): Promise<{ history?: ProjectPaymentSummary[]; totals?: { billed: number; paid: number; outstanding: number }; error?: string }> {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) return { error: 'You do not have permission to view OJ Projects data' }

  const supabase = await createClient()

  // Get all unique invoice IDs for entries linked to this project
  const { data: entries, error: entriesError } = await supabase
    .from('oj_entries')
    .select('invoice_id')
    .eq('project_id', projectId)
    .not('invoice_id', 'is', null)

  if (entriesError) return { error: entriesError.message }

  const invoiceIds = [...new Set((entries || []).map((e) => e.invoice_id).filter(Boolean))]

  if (invoiceIds.length === 0) {
    return { history: [], totals: { billed: 0, paid: 0, outstanding: 0 } }
  }

  // Fetch invoices with their payments
  const { data: invoices, error: invoicesError } = await supabase
    .from('invoices')
    .select('id, invoice_number, invoice_date, status, total_amount, paid_amount')
    .in('id', invoiceIds)
    .is('deleted_at', null)
    .order('invoice_date', { ascending: false })

  if (invoicesError) return { error: invoicesError.message }

  const { data: payments, error: paymentsError } = await supabase
    .from('invoice_payments')
    .select('id, invoice_id, amount, payment_date, payment_method, reference')
    .in('invoice_id', invoiceIds)
    .order('payment_date', { ascending: false })

  if (paymentsError) return { error: paymentsError.message }

  const history: ProjectPaymentSummary[] = (invoices || []).map((inv) => ({
    invoiceId: inv.id,
    invoiceNumber: inv.invoice_number,
    invoiceDate: inv.invoice_date,
    invoiceStatus: inv.status,
    totalAmount: Number(inv.total_amount || 0),
    paidAmount: Number(inv.paid_amount || 0),
    outstanding: Math.max(Number(inv.total_amount || 0) - Number(inv.paid_amount || 0), 0),
    payments: (payments || [])
      .filter((p) => p.invoice_id === inv.id)
      .map((p) => ({
        id: p.id,
        amount: Number(p.amount || 0),
        paymentDate: p.payment_date,
        paymentMethod: p.payment_method || 'unknown',
        reference: p.reference || null,
      })),
  }))

  const totals = {
    billed: history.reduce((acc, inv) => acc + inv.totalAmount, 0),
    paid: history.reduce((acc, inv) => acc + inv.paidAmount, 0),
    outstanding: history.reduce((acc, inv) => acc + inv.outstanding, 0),
  }

  return { history, totals }
}
```

- [ ] Add a "Payments" section to the project detail page `src/app/(authenticated)/oj-projects/projects/[id]/page.tsx`. This should show:
  - Summary cards: Total Billed, Total Paid, Outstanding
  - A table of invoices with expandable rows showing individual payments
  - Status badges per invoice

**Verification:**
```bash
npx tsc --noEmit
npm run lint
```

**Commit:** `feat: add payment history section to OJ Projects project detail page`

---

### Task 15: Billing cron error alerting

**Files:**
- **Create:** `src/lib/oj-projects/billing-alerts.ts`
- **Modify:** `src/app/api/cron/oj-projects-billing/route.ts`
- **Modify:** `.env.example`

**Steps:**

- [ ] Create `src/lib/oj-projects/billing-alerts.ts`:

```typescript
import { sendEmail } from '@/lib/email/emailService'
import { escapeHtml, redactPii } from '@/lib/cron/alerting'

export type BillingAlertIssue = {
  vendorName: string
  issueType: 'hard_failure' | 'soft_failure' | 'skipped_vendor' | 'zero_vendor_run' | 'email_failure'
  message: string
}

/**
 * Sends a single alert email summarising all issues from a billing run.
 * Content is sanitized — vendor name and failure type only, no raw errors or financial amounts.
 */
export async function sendBillingRunAlert(
  issues: BillingAlertIssue[],
  runDate: string
): Promise<void> {
  const alertEmail =
    process.env.OJ_PROJECTS_BILLING_ALERT_EMAIL ||
    process.env.PAYROLL_ACCOUNTANT_EMAIL

  if (!alertEmail) {
    console.warn('[billing-alert] No alert email configured (OJ_PROJECTS_BILLING_ALERT_EMAIL / PAYROLL_ACCOUNTANT_EMAIL)')
    return
  }

  if (issues.length === 0) return

  const subject = `OJ Projects Billing Alert — ${runDate} — ${issues.length} issue${issues.length > 1 ? 's' : ''}`

  const issueTypeLabels: Record<string, string> = {
    hard_failure: 'Hard Failure (Exception)',
    soft_failure: 'Soft Failure (Anomalous Invoice)',
    skipped_vendor: 'Skipped Vendor',
    zero_vendor_run: 'Zero-Vendor Run',
    email_failure: 'Email Delivery Failure',
  }

  const issueRows = issues
    .map((issue) => {
      const safeVendor = escapeHtml(redactPii(issue.vendorName))
      const typeLabel = issueTypeLabels[issue.issueType] || issue.issueType
      const safeMessage = escapeHtml(redactPii(issue.message))
      return `<tr>
        <td style="padding: 8px; border: 1px solid #e5e7eb;">${safeVendor}</td>
        <td style="padding: 8px; border: 1px solid #e5e7eb;">${escapeHtml(typeLabel)}</td>
        <td style="padding: 8px; border: 1px solid #e5e7eb;">${safeMessage}</td>
      </tr>`
    })
    .join('\n')

  const html = `
    <h2>OJ Projects Billing Run Alert</h2>
    <p><strong>Date:</strong> ${escapeHtml(runDate)}</p>
    <p><strong>Issues:</strong> ${issues.length}</p>
    <table style="border-collapse: collapse; width: 100%;">
      <thead>
        <tr style="background: #f3f4f6;">
          <th style="padding: 8px; border: 1px solid #e5e7eb; text-align: left;">Vendor</th>
          <th style="padding: 8px; border: 1px solid #e5e7eb; text-align: left;">Issue Type</th>
          <th style="padding: 8px; border: 1px solid #e5e7eb; text-align: left;">Details</th>
        </tr>
      </thead>
      <tbody>${issueRows}</tbody>
    </table>
    <p style="color: #6b7280; font-size: 12px; margin-top: 16px;">
      This is an automated alert. Financial amounts and raw error messages are excluded for security.
    </p>
  `

  try {
    await sendEmail({
      to: alertEmail,
      subject,
      html,
    })
  } catch (err) {
    console.error('[billing-alert] Failed to send alert email:', err)
  }
}
```

- [ ] In `src/app/api/cron/oj-projects-billing/route.ts`, import `sendBillingRunAlert` and `BillingAlertIssue`:

```typescript
import { sendBillingRunAlert, type BillingAlertIssue } from '@/lib/oj-projects/billing-alerts'
```

- [ ] Wrap each vendor's billing processing in a try/catch block. Accumulate issues into a `BillingAlertIssue[]` array. At the end of the billing run, call `sendBillingRunAlert()` if there are any issues.

The exact integration point depends on the billing cron's main loop structure. Find the vendor iteration loop and wrap its body:

```typescript
const billingIssues: BillingAlertIssue[] = []

for (const vendor of vendors) {
  try {
    // ... existing vendor billing logic ...
  } catch (err) {
    console.error(`[billing-cron] Hard failure for vendor ${vendor.name}:`, err)
    billingIssues.push({
      vendorName: vendor.name || 'Unknown',
      issueType: 'hard_failure',
      message: 'Billing run failed for this vendor',
    })
    // Continue to next vendor — don't let one failure block others
    continue
  }
}

// Send alert if any issues
if (billingIssues.length > 0) {
  await sendBillingRunAlert(billingIssues, new Date().toISOString().slice(0, 10))
}
```

- [ ] Add `OJ_PROJECTS_BILLING_ALERT_EMAIL` to `.env.example`:

```
# OJ Projects billing alert recipient (falls back to PAYROLL_ACCOUNTANT_EMAIL)
OJ_PROJECTS_BILLING_ALERT_EMAIL=
```

**Verification:**
```bash
npx tsc --noEmit
npm run lint
```

**Commit:** `feat: add billing cron error alerting with per-vendor isolation`

---

### Task 16: Statement mode UI tooltip/help text

**Files:**
- **Modify:** `src/app/(authenticated)/oj-projects/clients/page.tsx`

**Steps:**

- [ ] Find the `statement_mode` toggle in the clients page. Add a tooltip or help text next to it:

```tsx
<div className="flex items-center gap-2">
  {/* existing toggle */}
  <span className="text-xs text-gray-500" title="When enabled, monthly invoices show a running balance statement with opening balance, charges, and closing balance — rather than itemised time entries. Best for clients on a monthly retainer or cap arrangement.">
    ⓘ
  </span>
</div>
```

- [ ] Add a visual badge when statement mode is active on the client card:

```tsx
{settings.statement_mode && (
  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
    Statement Mode
  </span>
)}
```

**Verification:**
```bash
npx tsc --noEmit
npm run lint
```

**Commit:** `feat: add statement mode tooltip and visual badge on clients page`

---

### Task 17: Void invoice action

**Files:**
- **Modify:** `src/app/actions/invoices.ts`

**Steps:**

- [ ] Add `voidInvoice` server action:

```typescript
export async function voidInvoice(
  invoiceId: string,
  reason: string
): Promise<{ success?: boolean; error?: string; code?: string }> {
  try {
    const supabase = await createClient()
    const [hasInvoicePermission, hasOjPermission] = await Promise.all([
      checkUserPermission('invoices', 'delete'),
      checkUserPermission('oj_projects', 'manage'),
    ])

    if (!hasInvoicePermission) {
      return { error: 'You do not have permission to void invoices' }
    }

    if (!invoiceId || !reason.trim()) {
      return { error: 'Invoice ID and reason are required' }
    }

    // Fetch the invoice
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('id, status, paid_amount, invoice_number, vendor_id')
      .eq('id', invoiceId)
      .is('deleted_at', null)
      .single()

    if (invoiceError || !invoice) {
      return { error: invoiceError?.message || 'Invoice not found' }
    }

    // Absolute guard: cannot void invoices with payments (decision D2)
    if (Number(invoice.paid_amount || 0) > 0) {
      return {
        error: 'Cannot void an invoice with payments. Issue a credit note instead.',
        code: 'HAS_PAYMENTS',
      }
    }

    if (invoice.status === 'void') {
      return { error: 'Invoice is already voided' }
    }

    // Check for linked OJ entries — need OJ manage permission to reverse them
    const adminClient = createAdminClient()
    const [
      { data: linkedEntries, error: entriesError },
      { data: linkedInstances, error: instancesError },
    ] = await Promise.all([
      adminClient
        .from('oj_entries')
        .select('id')
        .eq('invoice_id', invoiceId),
      adminClient
        .from('oj_recurring_charge_instances')
        .select('id')
        .eq('invoice_id', invoiceId),
    ])

    if (entriesError || instancesError) {
      return { error: 'Failed to check linked OJ items' }
    }

    const hasLinkedOjItems = ((linkedEntries || []).length + (linkedInstances || []).length) > 0

    if (hasLinkedOjItems && !hasOjPermission) {
      return { error: 'Voiding this invoice requires OJ Projects manage permission (linked entries need reversal)' }
    }

    // Void the invoice
    const { error: voidError } = await supabase
      .from('invoices')
      .update({
        status: 'void',
        internal_notes: `${invoice.internal_notes ? invoice.internal_notes + '\n' : ''}Voided: ${reason} (${new Date().toISOString()})`,
      })
      .eq('id', invoiceId)

    if (voidError) return { error: voidError.message }

    // Reverse linked OJ entries — set back to unbilled, clear billing run refs
    if ((linkedEntries || []).length > 0) {
      const entryIds = (linkedEntries || []).map((e) => e.id)
      const { error: revertError } = await adminClient
        .from('oj_entries')
        .update({
          status: 'unbilled',
          billing_run_id: null,
          invoice_id: null,
          billed_at: null,
          paid_at: null,
        })
        .in('id', entryIds)

      if (revertError) {
        console.error('[voidInvoice] Failed to revert OJ entries:', revertError)
      }
    }

    // Reverse linked recurring charge instances
    if ((linkedInstances || []).length > 0) {
      const instanceIds = (linkedInstances || []).map((i) => i.id)
      const { error: revertError } = await adminClient
        .from('oj_recurring_charge_instances')
        .update({
          status: 'unbilled',
          billing_run_id: null,
          invoice_id: null,
          billed_at: null,
          paid_at: null,
        })
        .in('id', instanceIds)

      if (revertError) {
        console.error('[voidInvoice] Failed to revert OJ recurring instances:', revertError)
      }
    }

    const { data: { user } } = await supabase.auth.getUser()

    await logAuditEvent({
      operation_type: 'delete',
      resource_type: 'invoice',
      resource_id: invoiceId,
      operation_status: 'success',
      new_values: {
        action: 'voided',
        invoice_number: invoice.invoice_number,
        reason,
        reverted_entries: (linkedEntries || []).length,
        reverted_instances: (linkedInstances || []).length,
      },
    })

    revalidatePath('/invoices')
    revalidatePath(`/invoices/${invoiceId}`)
    revalidateTag('dashboard')

    return { success: true }
  } catch (error: unknown) {
    console.error('Error in voidInvoice:', error)
    return { error: getErrorMessage(error) }
  }
}
```

- [ ] Ensure `createAdminClient` is imported (should already be imported in this file).

**Verification:**
```bash
npx tsc --noEmit
npm run lint
```

**Commit:** `feat: add voidInvoice action with absolute payment guard and OJ entry reversal`

---

### Task 18: Credit note action + PDF

**Files:**
- **Modify:** `src/app/actions/invoices.ts` (add createCreditNote action)
- **Modify:** `src/lib/invoice-template-compact.ts` (add credit_note document kind)
- **Modify:** `src/types/invoices.ts` (add CreditNote type)
- **Modify:** `src/app/actions/oj-projects/client-balance.ts` (subtract credit notes from balance)

**Steps:**

- [ ] Add `CreditNote` type to `src/types/invoices.ts`:

```typescript
export interface CreditNote {
  id: string
  credit_note_number: string
  invoice_id: string
  vendor_id: string
  amount_ex_vat: number
  vat_rate: number
  amount_inc_vat: number
  reason: string
  status: 'draft' | 'issued' | 'void'
  created_at: string
  created_by: string
}
```

- [ ] Update `InvoiceDocumentKind` in `src/lib/invoice-template-compact.ts` (line 8):

Old code:
```typescript
export type InvoiceDocumentKind = 'invoice' | 'remittance_advice'
```

New code:
```typescript
export type InvoiceDocumentKind = 'invoice' | 'remittance_advice' | 'credit_note'
```

- [ ] Add `createCreditNote` server action to `src/app/actions/invoices.ts`:

```typescript
export async function createCreditNote(
  invoiceId: string,
  amountExVat: number,
  reason: string
): Promise<{ success?: boolean; creditNote?: { id: string; credit_note_number: string }; error?: string }> {
  try {
    const supabase = await createClient()
    const hasPermission = await checkUserPermission('invoices', 'create')
    if (!hasPermission) {
      return { error: 'You do not have permission to create credit notes' }
    }

    if (!invoiceId || !reason.trim() || !Number.isFinite(amountExVat) || amountExVat <= 0) {
      return { error: 'Invoice ID, valid amount, and reason are required' }
    }

    // Fetch the invoice to derive vendor_id and validate
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('id, vendor_id, invoice_number, total_amount, paid_amount, status')
      .eq('id', invoiceId)
      .is('deleted_at', null)
      .single()

    if (invoiceError || !invoice) {
      return { error: invoiceError?.message || 'Invoice not found' }
    }

    if (invoice.status === 'void') {
      return { error: 'Cannot create a credit note against a voided invoice' }
    }

    // Derive VAT rate from the invoice (use 20% default)
    const vatRate = 20
    const amountIncVat = Math.round((amountExVat * (1 + vatRate / 100) + Number.EPSILON) * 100) / 100

    // Generate credit note number (CN-YYYY-NNN)
    const year = new Date().getFullYear()
    const { count, error: countError } = await supabase
      .from('credit_notes')
      .select('id', { count: 'exact', head: true })

    if (countError) return { error: countError.message }

    const nextNumber = (count || 0) + 1
    const creditNoteNumber = `CN-${year}-${String(nextNumber).padStart(3, '0')}`

    // Get current user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }

    // Check if this would result in a negative balance — warn but allow
    const outstanding = Math.max(Number(invoice.total_amount || 0) - Number(invoice.paid_amount || 0), 0)
    if (amountIncVat > outstanding) {
      console.warn(
        `[createCreditNote] Credit note £${amountIncVat} exceeds outstanding £${outstanding} on invoice ${invoice.invoice_number}`
      )
    }

    // Insert credit note
    const { data: creditNote, error: insertError } = await supabase
      .from('credit_notes')
      .insert({
        credit_note_number: creditNoteNumber,
        invoice_id: invoiceId,
        vendor_id: invoice.vendor_id,
        amount_ex_vat: amountExVat,
        vat_rate: vatRate,
        amount_inc_vat: amountIncVat,
        reason,
        status: 'issued',
        created_by: user.id,
      })
      .select('id, credit_note_number')
      .single()

    if (insertError) return { error: insertError.message }

    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'credit_note',
      resource_id: creditNote.id,
      operation_status: 'success',
      new_values: {
        credit_note_number: creditNoteNumber,
        invoice_id: invoiceId,
        invoice_number: invoice.invoice_number,
        amount_ex_vat: amountExVat,
        amount_inc_vat: amountIncVat,
        reason,
      },
    })

    revalidatePath('/invoices')
    revalidatePath(`/invoices/${invoiceId}`)

    return { success: true, creditNote }
  } catch (error: unknown) {
    console.error('Error in createCreditNote:', error)
    return { error: getErrorMessage(error) }
  }
}
```

- [ ] Update `client-balance.ts` to subtract credit notes from the vendor balance. Add a query for credit notes and subtract from `unpaidInvoiceBalance`:

After the invoices query block (around line 50), add:

```typescript
  // Fetch credit notes for these invoices
  const invoiceIdsForCn = (invoices || []).map((inv) => inv.id)
  let totalCreditNotes = 0
  if (invoiceIdsForCn.length > 0) {
    const { data: creditNotes, error: cnError } = await supabase
      .from('credit_notes')
      .select('amount_inc_vat')
      .in('invoice_id', invoiceIdsForCn)
      .eq('status', 'issued')

    if (!cnError && creditNotes) {
      totalCreditNotes = roundMoney(
        creditNotes.reduce((acc, cn) => acc + Number(cn.amount_inc_vat || 0), 0)
      )
    }
  }
```

Then adjust the `totalOutstanding` calculation to subtract credit notes:

Old code:
```typescript
  const totalOutstanding = roundMoney(unpaidInvoiceBalance + unbilledTotal)
```

New code:
```typescript
  const adjustedInvoiceBalance = roundMoney(Math.max(unpaidInvoiceBalance - totalCreditNotes, 0))
  const totalOutstanding = roundMoney(adjustedInvoiceBalance + unbilledTotal)
```

And update the return to use `adjustedInvoiceBalance`:

Old code:
```typescript
      unpaidInvoiceBalance,
```

New code:
```typescript
      unpaidInvoiceBalance: adjustedInvoiceBalance,
```

**Verification:**
```bash
npx tsc --noEmit
npm run lint
npm run build
```

**Commit:** `feat: add credit note creation and integrate into client balance computation`

---

## Final Verification

After all tasks are complete, run the full verification pipeline:

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
```

Ensure:
- [ ] Zero lint warnings
- [ ] Zero type errors
- [ ] All tests pass
- [ ] Build succeeds
- [ ] No console.log debug statements left in production code

---

## Summary

| Phase | Tasks | Key Files |
|-------|-------|-----------|
| 1: Bug Fixes | 1-6 | Migration, client-balance.ts, oj-projects.ts, billing cron, utils.ts, invoice-template-compact.ts |
| 2: Client Statement | 7-10 | client-statement.ts (new), oj-statement.ts (new), statement-pdf API route (new), clients page |
| 3: Payment Receipts | 11-13 | invoices.ts (rename, dedup, subject lines) |
| 4: Completeness | 14-18 | projects.ts, billing-alerts.ts (new), clients page, invoices.ts (void + credit note) |

**Estimated total:** 18 tasks across 4 phases. Each task is independently committable. Phases are independently deployable.
