OpenAI Codex v0.107.0 (research preview)
--------
workdir: /Users/peterpitcher/Cursor/OJ-AnchorManagementTools
model: gpt-5.4
provider: openai
approval: never
sandbox: workspace-write [workdir, /tmp, $TMPDIR] (network access enabled)
reasoning effort: xhigh
reasoning summaries: none
session id: 019d8b1b-a978-76e0-849a-ca57b6c68f1f
--------
user
You are the Security & Data Risk Reviewer. Read docs/superpowers/specs/2026-04-14-oj-projects-review-design.md then inspect the codebase for security implications.

CHECK:
1. Could client-statement action expose one vendor's data to another? Read existing OJ Projects actions for vendor scoping patterns.
2. Could manipulated recordPayment send receipts to wrong addresses? Read src/app/actions/invoices.ts and src/lib/microsoft-graph.ts
3. Credit note auth — what permission model is proposed vs what exists?
4. Void + unbilled race — could voiding cause double-billing? 
5. RLS status on oj_entries, invoices, invoice_payments — read migrations
6. Billing cron error emails — could they leak sensitive data?
7. PDF Puppeteer injection risk from vendor names?
8. Universal receipt extension — safe for all invoice types?

Read actual files. Report specific risks with file paths and evidence.
mcp: playwright starting
mcp: playwright ready
mcp startup: ready: playwright
codex
I’m reading the design spec first, then I’ll inspect the relevant actions, auth patterns, migrations, and billing code paths for the seven security questions you listed.
exec
/bin/zsh -lc "sed -n '1,240p' docs/superpowers/specs/2026-04-14-oj-projects-review-design.md" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg --files src app docs supabase . | sed -n '1,240p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
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
 succeeded in 51ms:
rg: app: No such file or directory (os error 2)
docs/standards/DATABASE.md
docs/standards/UI_UX.md
docs/standards/README.md
docs/standards/AGENT_PROMPT.md
docs/standards/ARCHITECTURE.md
docs/standards/CODE_QUALITY.md
docs/standards/PROCESS.md
src/services/auth.ts
src/services/vendors.ts
src/services/audit.ts
supabase/sql-scripts/add_event_time_format_check.sql
supabase/sql-scripts/cleanup_event_reminders.sql
supabase/sql-scripts/cleanup_all_event_reminders.sql
supabase/sql-scripts/deactivate_legacy_message_templates.sql
supabase/sql-scripts/add_private_booking_cancellation_columns.sql
supabase/sql-scripts/check_booking_discount.sql
supabase/sql-scripts/add_reminder_logging.sql
supabase/sql-scripts/fix_reminder_timing_function.sql
supabase/sql-scripts/backfill_private_booking_messages.sql
codex
I have the spec. Next I’m splitting the code inspection by risk area: OJ vendor scoping and billing flows, invoice/payment email paths, and database RLS/auth migrations.
Plan update
Reviewing the design against the current implementation, focusing on cross-vendor isolation, payment receipt targeting, auth model gaps, billing race conditions, RLS coverage, alert-email leakage, PDF injection surfaces, and receipt compatibility.
  ✓ Read the full OJ Projects review spec and identify the proposed behaviors that affect security/data scope
  → Inspect existing OJ Projects actions and invoice/payment/email code paths for vendor scoping, receipt targeting, voiding, and PDF generation
  • Inspect Supabase migrations and policies for oj_entries, invoices, and invoice_payments RLS/auth coverage
  • Synthesize findings by severity with concrete file evidence and note residual questions
collab spawn_agent(call_hMW0CT14lT55K664y9KlLKFW, prompt="Inspect OJ Projects code for vendor scoping and statement-related risks. Read docs/superpowers/specs/2026-04-14-oj-proje…")
mcp: playwright starting
spawn_agent(call_hMW0CT14lT55K664y9KlLKFW, prompt="Inspect OJ Projects code for vendor scoping and statement-related risks. Read docs/superpowers/specs/2026-04-14-oj-proje…") pending init:
  agent: 019d8b1c-4f3f-7392-991b-dc83fd896fb3
collab spawn_agent(call_C42qnPMuRWdnDdPiYOE4UPRA, prompt="Inspect invoice payment receipt flows. Read src/app/actions/invoices.ts and src/lib/microsoft-graph.ts plus any directly…")
spawn_agent(call_C42qnPMuRWdnDdPiYOE4UPRA, prompt="Inspect invoice payment receipt flows. Read src/app/actions/invoices.ts and src/lib/microsoft-graph.ts plus any directly…") pending init:
  agent: 019d8b1c-4f4a-7ac3-9ef3-438aec87587f
mcp: playwright starting
collab spawn_agent(call_CKKII1dmbrwHeKTPfpPTxCnr, prompt="Inspect database auth and RLS coverage. Read current migrations and policies affecting oj_entries, invoices, invoice_pay…")
spawn_agent(call_CKKII1dmbrwHeKTPfpPTxCnr, prompt="Inspect database auth and RLS coverage. Read current migrations and policies affecting oj_entries, invoices, invoice_pay…") pending init:
  agent: 019d8b1c-4f6f-7f81-83dc-8262d073557b
mcp: playwright starting
mcp: playwright ready
mcp startup: ready: playwright
mcp: playwright ready
mcp startup: ready: playwright
mcp: playwright ready
mcp startup: ready: playwright
codex
Reviewing the invoice receipt flow with a security lens. I’m starting by reading the two entry-point files and the directly referenced email/PDF helpers, then I’ll trace the `recordPayment` inputs and cron error-reporting paths for concrete issues.
exec
/bin/zsh -lc "sed -n '1,260p' src/app/actions/invoices.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "pwd && rg --files src | rg '"'^(src/app/actions/invoices'"\\.ts|src/lib/microsoft-graph\\.ts|src/.+invoice|src/.+receipt|src/.+pdf|src/.+email)'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,260p' src/lib/microsoft-graph.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from './audit'
import { isGraphConfigured, sendInvoiceEmail } from '@/lib/microsoft-graph'
import { z } from 'zod'
import { getErrorMessage } from '@/lib/errors'
import { revalidatePath, revalidateTag } from 'next/cache'
import type {
  Invoice,
  InvoiceWithDetails,
  InvoiceStatus,
  InvoiceLineItemInput,
  LineItemCatalogItem
} from '@/types/invoices'
import { InvoiceService, CreateInvoiceSchema } from '@/services/invoices'

const CONTACT_NAME = process.env.COMPANY_CONTACT_NAME || 'Peter Pitcher'
 succeeded in 51ms:
/Users/peterpitcher/Cursor/OJ-AnchorManagementTools
src/services/invoices.ts
src/services/receipts/receiptHelpers.ts
src/services/receipts/index.ts
src/services/receipts/types.ts
src/services/receipts/receiptQueries.ts
src/services/receipts/receiptMutations.ts
src/lib/invoice-template-compact.ts
src/types/invoices.ts
src/types/pdf2json.d.ts
src/lib/invoice-reminder-safety.ts
src/lib/receipts/rule-matching.ts
src/lib/receipts/direction.ts
src/lib/invoiceCalculations.ts
src/lib/receipts/export/index.ts
src/lib/receipts/export/expenses-csv.ts
src/lib/receipts/export/mgd-csv.ts
src/lib/receipts/export/__tests__/csv-helpers.test.ts
src/lib/receipts/export/__tests__/mgd-csv.test.ts
src/lib/receipts/export/claim-summary-pdf.ts
 succeeded in 52ms:
// import { Client } from '@microsoft/microsoft-graph-client'
// import { ClientSecretCredential } from '@azure/identity'
import type { InvoiceWithDetails, QuoteWithDetails } from '@/types/invoices'
import { generateInvoicePDF, generateQuotePDF } from '@/lib/pdf-generator'
import type { InvoiceDocumentKind, InvoiceRemittanceDetails } from '@/lib/invoice-template-compact'
import { getErrorMessage, getErrorStatusCode } from '@/lib/errors'

const CONTACT_NAME = process.env.COMPANY_CONTACT_NAME || 'Peter Pitcher'
const CONTACT_PHONE = process.env.COMPANY_CONTACT_PHONE || '07995087315'

// Initialize Microsoft Graph client
async function getGraphClient() {
  // Check if Graph is configured
  if (!isGraphConfigured()) {
    throw new Error('Microsoft Graph is not configured. Please check environment variables.')
  }

  const { Client } = await import('@microsoft/microsoft-graph-client')
  const { ClientSecretCredential } = await import('@azure/identity')

codex
I’m reviewing the OJ Projects design doc first, then I’ll trace the current project actions and billing paths to check vendor scoping and statement/void risks against the existing implementation.
exec
/bin/zsh -lc 'pwd && rg -n "client statement|statement|void|unbilled|vendor|scope" docs/superpowers/specs/2026-04-14-oj-projects-review-design.md' in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
/Users/peterpitcher/Cursor/OJ-AnchorManagementTools
14:2. **Client statement** — running account statement (PDF + email) showing invoices, payments, credits, and balance over a date range
16:4. **Completeness recommendations** — payment history on project detail, billing cron alerting, statement mode UI clarity, void/credit note support
40:**Problem:** `src/app/actions/oj-projects/client-balance.ts` only sums unbilled `time` and `mileage` entries. Unbilled `one_off` entries with `amount_ex_vat_snapshot` are excluded from `unbilledTotal`.
42:**Fix:** Add a third query (or extend existing) to sum `amount_ex_vat_snapshot` for unbilled `one_off` entries. Include in the `unbilledTotal` calculation. Update the UI breakdown on the Clients page if it itemises by type.
88:No new tables. The statement is a read-time aggregation:
91:- `invoices` — filtered by vendor (via `reference ILIKE 'OJ Projects %'` or `vendor_id` join through `oj_entries`)
103:**File:** `src/app/actions/oj-projects/client-statement.ts`
107:  vendorId: string,
111:  vendor: { id: string; name: string; email: string };
133:**File:** `src/lib/oj-statement.ts`
138:- Header: business name/logo, "ACCOUNT STATEMENT", vendor name, date range
150:Per-vendor "Statement" button. Opens a modal with:
152:- Preview of statement data (table format)
160:- **To:** Vendor billing contact email (from `oj_vendor_billing_settings` or `invoice_vendors`)
162:- **Body:** Short cover note: "Please find attached your account statement for the period {from} to {to}. Current balance: £{closingBalance}."
163:- **Attachment:** Statement PDF (named `statement-{vendor-code}-{from}-{to}.pdf`)
222:- If any vendor billing failed (caught exceptions, partial failures), send an internal alert email
224:- Email contains: which vendors failed, error messages, which vendors succeeded
225:- Also fire on zero-vendor runs (sanity check — if billing expected vendors but found none)
exec
/bin/zsh -lc 'rg --files | rg "OJ Projects|oj-projects|oj_projects|project"' in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 50ms:
scripts/check-golden-barrels-projects.ts
supabase/migrations/20260120130000_oj_projects_core.sql
supabase/migrations/20260121120000_oj_retainer_projects.sql
supabase/migrations/20260121130000_project_stats_view.sql
supabase/migrations/20260120132000_add_oj_projects_permissions.sql
scripts/oj-projects/fix-typo.ts
scripts/oj-projects/move-to-website-content.ts
scripts/oj-projects/verify-monthly-hours.ts
scripts/oj-projects/find-barons-projects.ts
scripts/oj-projects/find-retainers.ts
scripts/oj-projects/list-january.ts
scripts/oj-projects/move-all-to-retainers.ts
scripts/oj-projects/debug-november.ts
scripts/oj-projects/verify-barons-entries.ts
scripts/oj-projects/update-barons-retainer.ts
scripts/oj-projects/find-barons-ids.ts
scripts/oj-projects/verify-project-stats.ts
scripts/oj-projects/fix-entry-rates.ts
scripts/oj-projects/check-golden-barrels.ts
scripts/oj-projects/verify-closing-logic.ts
codex
I’m inspecting the Supabase/Postgres auth model and RLS around `oj_entries`, `invoices`, `invoice_payments`, plus any credit-note or invoice-void permissions model. First step is locating the spec proposal and the migrations/policy files that currently define access.
exec
/bin/zsh -lc "rg -n --hidden --glob '"'!node_modules'"' --glob '"'!dist'"' --glob '"'!build'"' --glob '"'!coverage'"' \"oj_entries|invoice_payments|credit.?note|void|RLS|row level security|policy|spec proposal|permissions model|auth\" ." in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg --files --hidden --glob '"'!node_modules'"' --glob '"'!dist'"' --glob '"'!build'"' --glob '"'!coverage'"' . | rg \"migrations|supabase|sql|schema|spec|proposal|auth|policy|rls|invoice|credit|void|oj_entries\"" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
Total output lines: 924

./src/services/auth.ts
./src/services/invoices.ts
./scripts/diagnose-user-access.sql
./scripts/table-booking-permissions-sql.sql
./scripts/test-invoice-setup.sql
./scripts/fix-super-admin-safe.sql
./scripts/diagnose-table-booking-sql.sql
./scripts/check-loyalty-migration-progress.sql
./src/types/invoices.ts
./scripts/complete-loyalty-migration.sql
./supabase/sql-scripts/add_event_time_format_check.sql
./supabase/sql-scripts/cleanup_event_reminders.sql
./supabase/sql-scripts/cleanup_all_event_reminders.sql
./supabase/sql-scripts/deactivate_legacy_message_templates.sql
./supabase/sql-scripts/add_private_booking_cancellation_columns.sql
./supabase/sql-scripts/check_booking_discount.sql
./supabase/sql-scripts/add_reminder_logging.sql
./supabase/sql-scripts/fix_reminder_timing_function.sql
 succeeded in 100ms:
./src/app/(authenticated)/roles/components/RolePermissionsModal.tsx:16:  onClose: () => void
./src/app/(authenticated)/expenses/page.tsx:17:    redirect('/unauthorized')
./src/app/(authenticated)/expenses/_components/ExpenseForm.tsx:40:  onCancel: () => void
./src/app/(authenticated)/expenses/_components/ExpenseForm.tsx:194:      // Upload pending files if any — pass createdId directly to avoid stale closure
./src/app/(authenticated)/expenses/_components/ExpenseFileViewer.tsx:17:  onClose: () => void
./src/app/(authenticated)/expenses/insights/page.tsx:16:  if (!canView) redirect('/unauthorized')
./src/app/(authenticated)/expenses/insights/_components/ExpensesInsightsClient.tsx:85:  function handlePeriodChange(key: string): void {
./src/app/(authenticated)/expenses/insights/_components/ExpensesInsightsClient.tsx:96:  function handleBarClick(index: number): void {
./src/app/(authenticated)/quotes/page.tsx:9:    redirect('/unauthorized')
./src/app/(authenticated)/quotes/[id]/convert/page.tsx:45:      router.replace('/unauthorized')
./src/app/(authenticated)/quotes/[id]/convert/page.tsx:73:    void loadQuote(id)
./src/app/(authenticated)/quotes/[id]/convert/page.tsx:78:      router.replace('/unauthorized')
./src/app/(authenticated)/quotes/[id]/page.tsx:55:      router.replace('/unauthorized')
./src/app/(authenticated)/quotes/[id]/page.tsx:73:    void fetchAndSetQuote(id)
./src/app/(authenticated)/quotes/[id]/page.tsx:75:      void checkEmailConfig()
./src/app/(authenticated)/quotes/[id]/edit/page.tsx:62:      router.replace('/unauthorized')
./src/app/(authenticated)/quotes/[id]/edit/page.tsx:126:    void loadData(id)
./src/app/(authenticated)/quotes/new/page.tsx:59:      router.replace('/unauthorized')
./src/app/(authenticated)/quotes/new/page.tsx:63:    void loadData()
./src/app/(authenticated)/quotes/QuotesClient.tsx:140:    void loadData()
exec
/bin/zsh -lc "sed -n '241,420p' docs/superpowers/specs/2026-04-14-oj-projects-review-design.md" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
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
codex
I’m waiting on the deeper code reads now. Once those return, I’ll consolidate the concrete risks against the proposed design and the current implementation.
collab wait(call_LXrhqfeObwuzSZr9BW3WlmfY)
  receivers: 019d8b1c-4f3f-7392-991b-dc83fd896fb3, 019d8b1c-4f4a-7ac3-9ef3-438aec87587f, 019d8b1c-4f6f-7f81-83dc-8262d073557b
codex
I’ve mapped the entry points and identified likely helper modules for recipient resolution, PDF rendering, and cron delivery. Next I’m tracing the `recordPayment` path end-to-end and checking the cron error-email body composition against what invoice/vendor data it includes.
exec
/bin/zsh -lc "sed -n '261,520p' src/lib/microsoft-graph.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '261,620p' src/app/actions/invoices.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"recordPayment|sendRemittanceAdviceForPaidInvoice|sendInvoiceEmail|generateInvoicePDF|generateQuotePDF|oj-projects-billing|error email|billing\" src/app/actions/invoices.ts src/lib/microsoft-graph.ts src/lib/pdf-generator.ts src/lib/invoice-template*.ts src/app/api/cron -g '"'!**/*.test.*'"'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:

Best wishes,
${CONTACT_NAME}
Orange Jelly Limited
${CONTACT_PHONE}

P.S. The quote is attached as a PDF for your convenience.`

    // Create email message
    const message: any = {
      subject: emailSubject,
      body: {
        contentType: 'Text',
        content: emailBody
      },
      toRecipients: [
        {
          emailAddress: {
            address: recipientEmail
          }
 succeeded in 51ms:
    sent_to: toAddress,
    sent_by: sentByUserId || null,
    subject,
    body,
    status: 'failed',
    error_message: errorMessage,
  })

  if (failedLogError) {
    console.error('[Invoices] Failed to write receipt failure log:', failedLogError)
  }

  await logAuditEvent({
    operation_type: 'send',
    resource_type: 'invoice',
    resource_id: invoiceId,
    operation_status: 'failure',
    error_message: errorMessage,
    additional_info: {
      action: 'receipt_send_failed',
 succeeded in 51ms:
src/lib/pdf-generator.ts:134:export async function generateInvoicePDF(
src/lib/pdf-generator.ts:180:export async function generateQuotePDF(
src/lib/microsoft-graph.ts:4:import { generateInvoicePDF, generateQuotePDF } from '@/lib/pdf-generator'
src/lib/microsoft-graph.ts:78:export async function sendInvoiceEmail(
src/lib/microsoft-graph.ts:105:    const pdfBuffer = await generateInvoicePDF(invoiceForPDF, {
src/lib/microsoft-graph.ts:245:    const pdfBuffer = await generateQuotePDF(quote)
src/app/actions/invoices.ts:7:import { isGraphConfigured, sendInvoiceEmail } from '@/lib/microsoft-graph'
src/app/actions/invoices.ts:112:async function sendRemittanceAdviceForPaidInvoice(
src/app/actions/invoices.ts:199:  const emailResult = await sendInvoiceEmail(
src/app/actions/invoices.ts:670:export async function recordPayment(formData: FormData) {
src/app/actions/invoices.ts:710:      InvoiceService.recordPayment({
src/app/actions/invoices.ts:747:      remittanceAdvice = await sendRemittanceAdviceForPaidInvoice(invoiceId, user?.id || null)
src/app/actions/invoices.ts:756:    console.error('Error in recordPayment:', error)
src/app/api/cron/oj-projects-retainer-projects/route.ts:46:      .from('oj_vendor_billing_settings')
src/app/api/cron/oj-projects-retainer-projects/route.ts:99:    .from('oj_vendor_billing_settings')
src/app/api/cron/oj-projects-billing/route.ts:5:import { isGraphConfigured, sendInvoiceEmail } from '@/lib/microsoft-graph'
src/app/api/cron/oj-projects-billing/route.ts:100:  billingRunId: string,
src/app/api/cron/oj-projects-billing/route.ts:104:    .from('oj_billing_runs')
src/app/api/cron/oj-projects-billing/route.ts:106:    .eq('id', billingRunId)
src/app/api/cron/oj-projects-billing/route.ts:111:    throw new Error(updateError.message || `Failed to update billing run ${billingRunId}`)
codex
The spec already calls out statement aggregation and invoice voiding. I’m tracing how vendor identity is enforced today in `oj_entries`, invoice generation, and client balance queries so I can compare the proposed statement action against real scoping boundaries.
exec
/bin/zsh -lc "sed -n '231,252p' docs/superpowers/specs/2026-04-14-oj-projects-review-design.md" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '80,170p' docs/superpowers/specs/2026-04-14-oj-projects-review-design.md" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc 'rg -n "voidInvoice|createCreditNote|getClientBalance|statement|vendor_id|invoice_vendors|oj_entries|billing_settings|unbilled|billed" src/app/actions src/app/api src/lib src/types supabase/migrations | head -n 400' in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
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
 succeeded in 51ms:
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
 succeeded in 51ms:
src/types/database.generated.ts:3682:          vendor_id: string
src/types/database.generated.ts:3693:          vendor_id: string
src/types/database.generated.ts:3704:          vendor_id?: string
src/types/database.generated.ts:3708:            foreignKeyName: "invoice_vendor_contacts_vendor_id_fkey"
src/types/database.generated.ts:3709:            columns: ["vendor_id"]
src/types/database.generated.ts:3711:            referencedRelation: "invoice_vendors"
src/types/database.generated.ts:3716:      invoice_vendors: {
src/types/database.generated.ts:3781:          vendor_id: string | null
src/types/database.generated.ts:3802:          vendor_id?: string | null
src/types/database.generated.ts:3823:          vendor_id?: string | null
src/types/database.generated.ts:3827:            foreignKeyName: "invoices_vendor_id_fkey"
src/types/database.generated.ts:3828:            columns: ["vendor_id"]
src/types/database.generated.ts:3830:            referencedRelation: "invoice_vendors"
src/types/database.generated.ts:5841:            referencedRelation: "oj_entries"
src/types/database.generated.ts:5861:          vendor_id: string
src/types/database.generated.ts:5877:          vendor_id: string
src/types/database.generated.ts:5893:          vendor_id?: string
src/types/database.generated.ts:5904:            foreignKeyName: "oj_billing_runs_vendor_id_fkey"
src/types/database.generated.ts:5905:            columns: ["vendor_id"]
src/types/database.generated.ts:5907:            referencedRelation: "invoice_vendors"
codex
I found the likely spec source: [docs/superpowers/specs/2026-04-14-oj-projects-review-design.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-14-oj-projects-review-design.md). Next I’m tracing the live schema from `supabase/migrations`, especially the OJ projects core migration and the invoice/RLS follow-up migrations, so the comparison is based on current SQL rather than app-layer assumptions.
exec
/bin/zsh -lc "sed -n '1,260p' docs/superpowers/specs/2026-04-14-oj-projects-review-design.md" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"oj_entries|CREATE POLICY|ALTER TABLE public\\.oj_entries ENABLE ROW LEVEL SECURITY|invoice_payments|credit note|credit_note|void|voided|invoices.manage|invoices.view|oj_projects|oj_projects.manage|oj_projects.view\" supabase/migrations/20260120130000_oj_projects_core.sql supabase/migrations/20250820195912_add_invoice_permissions.sql supabase/migrations/20251120010000_fix_invoice_rls_policies.sql supabase/migrations/20251123120000_squashed.sql supabase/migrations/20260121100000_oj_recurring_charge_instances.sql supabase/migrations/20260121120000_oj_retainer_projects.sql" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
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
 succeeded in 51ms:
Total output lines: 443

supabase/migrations/20260121100000_oj_recurring_charge_instances.sql:37:CREATE POLICY "oj_recurring_charge_instances_select" ON public.oj_recurring_charge_instances
supabase/migrations/20260121100000_oj_recurring_charge_instances.sql:39:  USING (public.user_has_permission(auth.uid(), 'oj_projects', 'view') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));
supabase/migrations/20260121100000_oj_recurring_charge_instances.sql:41:CREATE POLICY "oj_recurring_charge_instances_all" ON public.oj_recurring_charge_instances
supabase/migrations/20260121100000_oj_recurring_charge_instances.sql:43:  USING (public.user_has_permission(auth.uid(), 'oj_projects', 'manage'))
supabase/migrations/20260121100000_oj_recurring_charge_instances.sql:44:  WITH CHECK (public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));
supabase/migrations/20260121100000_oj_recurring_charge_instances.sql:53:    UPDATE public.oj_entries
supabase/migrations/20260121120000_oj_retainer_projects.sql:4:ALTER TABLE public.oj_projects
supabase/migrations/20260121120000_oj_retainer_projects.sql:10:ALTER TABLE public.oj_projects
supabase/migrations/20260121120000_oj_retainer_projects.sql:11:  DROP CONSTRAINT IF EXISTS chk_oj_projects_retainer_period;
supabase/migrations/20260121120000_oj_retainer_projects.sql:13:ALTER TABLE public.oj_projects
supabase/migrations/20260121120000_oj_retainer_projects.sql:14:  ADD CONSTRAINT chk_oj_projects_retainer_period
supabase/migrations/20260121120000_oj_retainer_projects.sql:24:CREATE UNIQUE INDEX IF NOT EXISTS ux_oj_projects_retainer_vendor_period
supabase/migrations/20260121120000_oj_retainer_projects.sql:25:ON public.oj_projects (vendor_id, retainer_period_yyyymm)
supabase/migrations/20260121120000_oj_retainer_projects.sql:28:CREATE INDEX IF NOT EXISTS idx_oj_projects_retainer_lookup
supabase/migrations/20260121120000_oj_retainer_projects.sql:29:ON public.oj_projects (vendor_id, is_retainer, retainer_period_yyyymm);
supabase/migrations/20260120130000_oj_projects_core.sql:12:      ('oj_projects', 'view', 'View OJ Projects'),
supabase/migrations/20260120130000_oj_projects_core.sql:13:      ('oj_projects', 'create', 'Create OJ Projects data'),
supabase/migrations/20260120130000_oj_projects_core.sql:14:      ('oj_projects', 'edit', 'Edit OJ Projects data'),
codex
The payment path is lower in `invoices.ts`, and I also need the service-layer update semantics to judge whether “send receipts for all partial payments” is actually safe. After that I’ll inspect the PDF renderer/template to see whether user-controlled names are inserted as raw HTML or escaped text.
exec
/bin/zsh -lc "sed -n '620,860p' src/app/actions/invoices.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,340p' src/services/invoices.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,260p' src/lib/pdf-generator.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,280p' src/lib/invoice-template-compact.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:

    const item = await InvoiceService.updateCatalogItem(itemId, { name, description, default_price, default_vat_rate })

    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'line_item_catalog',
      resource_id: item.id,
      operation_status: 'success',
      new_values: { name }
    })

    revalidatePath('/invoices/catalog')
    
    return { item, success: true }
  } catch (error: unknown) {
    console.error('Error in updateCatalogItem:', error)
    return { error: getErrorMessage(error) }
  }
}

 succeeded in 51ms:
// import type { PDFOptions } from 'puppeteer'
import type { ChildProcess } from 'node:child_process'
import {
  generateCompactInvoiceHTML,
  type InvoiceDocumentKind,
  type InvoiceRemittanceDetails
} from './invoice-template-compact'
import { generateCompactQuoteHTML } from './quote-template-compact'
import type { InvoiceWithDetails, QuoteWithDetails } from '@/types/invoices'

// Helper to load puppeteer deps dynamically
async function loadPuppeteer() {
  const puppeteer = (await import('puppeteer')).default
  const chromium = (await import('@sparticuz/chromium')).default
  return { puppeteer, chromium }
}

type PdfGeneratorBrowser = {
  newPage: () => Promise<any>
  close: () => Promise<void>
 succeeded in 51ms:
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { calculateInvoiceTotals } from '@/lib/invoiceCalculations';
import { getTodayIsoDate } from '@/lib/dateUtils';
import { isInvoiceStatusTransitionAllowed } from '@/lib/status-transitions';
import { z } from 'zod'; // Import Zod

import type { InvoiceStatus, InvoiceLineItemInput, Invoice, InvoiceWithDetails, LineItemCatalogItem } from '@/types/invoices';

function sanitizeInvoiceSearch(value: string): string {
  return value
    .replace(/[,%_()"'\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}
export { isInvoiceStatusTransitionAllowed } from '@/lib/status-transitions';

// Invoice validation schema
export const CreateInvoiceSchema = z.object({
 succeeded in 51ms:
import { InvoiceWithDetails } from '@/types/invoices'
import { formatDateFull } from '@/lib/dateUtils'
import { COMPANY_DETAILS } from '@/lib/company-details'

const CONTACT_NAME = process.env.COMPANY_CONTACT_NAME || 'Peter Pitcher'
const CONTACT_PHONE = process.env.COMPANY_CONTACT_PHONE || '07995087315'

export type InvoiceDocumentKind = 'invoice' | 'remittance_advice'

export interface InvoiceRemittanceDetails {
  paymentDate?: string | null
  paymentAmount?: number | null
  paymentMethod?: string | null
  paymentReference?: string | null
}

export interface InvoiceTemplateData {
  invoice: InvoiceWithDetails
  logoUrl?: string
  documentKind?: InvoiceDocumentKind
exec
/bin/zsh -lc "sed -n '520,760p' src/lib/invoice-template-compact.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '280,520p' src/lib/invoice-template-compact.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"error email|internal reminder|sendInternalReminder|billing run|Failed to|context:|sensitive|stack|error\\.stack|JSON\\.stringify|invoice_email_logs|send.*error|alert\" src/app/api/cron/oj-projects-billing/route.ts src/lib/microsoft-graph.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
      <tbody>
        ${invoice.line_items?.map(item => `
          <tr>
            <td>
              <div class="item-description">${item.description}</div>
              ${hasDiscounts && item.discount_percentage > 0 ? `<div class="item-line-discount">Line discount: ${item.discount_percentage}%</div>` : ''}
            </td>
            <td class="text-right">${item.quantity}</td>
            <td class="text-right">${formatCurrency(item.unit_price)}</td>
            ${hasDiscounts ? `<td class="text-right">${item.discount_percentage || 0}%</td>` : ''}
            <td class="text-right">${item.vat_rate}%</td>
            <td class="text-right">${formatCurrency(calculateLineTotal(item))}</td>
          </tr>
        `).join('') || ''}
      </tbody>
    </table>

    <div class="summary-section">
      <div class="summary-row">
        <span>Subtotal</span>
 succeeded in 51ms:
      font-size: 8pt;
    }
    
    .invoice-meta {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 10px;
      padding: 8px;
      background: #f9fafb;
      border-radius: 4px;
      font-size: 8pt;
    }
    
    .meta-item {
      text-align: center;
    }
    
    .meta-label {
      font-size: 7pt;
 succeeded in 50ms:
     1	import { NextResponse } from 'next/server'
     2	import { authorizeCronRequest } from '@/lib/cron-auth'
     3	import { createAdminClient } from '@/lib/supabase/admin'
     4	import { calculateInvoiceTotals, type InvoiceTotalsResult } from '@/lib/invoiceCalculations'
     5	import { isGraphConfigured, sendInvoiceEmail } from '@/lib/microsoft-graph'
     6	import { resolveVendorInvoiceRecipients } from '@/lib/invoice-recipients'
     7	import { generateOjTimesheetPDF } from '@/lib/oj-timesheet'
     8	import { formatInTimeZone } from 'date-fns-tz'
     9	import type { InvoiceWithDetails } from '@/types/invoices'
    10	import {
    11	  claimIdempotencyKey,
    12	  computeIdempotencyRequestHash,
    13	  persistIdempotencyResponse,
    14	  releaseIdempotencyClaim
    15	} from '@/lib/api/idempotency'
    16	
    17	export const runtime = 'nodejs'
    18	export const dynamic = 'force-dynamic'
    19	export const maxDuration = 300
    20	
 succeeded in 51ms:
src/lib/microsoft-graph.ts:217:    console.error('Error sending invoice email:', error)
src/lib/microsoft-graph.ts:310:    console.error('Error sending quote email:', error)
src/lib/microsoft-graph.ts:318:// Send internal reminder email
src/lib/microsoft-graph.ts:319:export async function sendInternalReminder(
src/lib/microsoft-graph.ts:374:    console.error('Error sending internal reminder:', error)
src/lib/microsoft-graph.ts:423:    let errorMessage = 'Failed to connect to Microsoft Graph'
src/app/api/cron/oj-projects-billing/route.ts:111:    throw new Error(updateError.message || `Failed to update billing run ${billingRunId}`)
src/app/api/cron/oj-projects-billing/route.ts:121:  context: string
src/app/api/cron/oj-projects-billing/route.ts:134:  context: string
src/app/api/cron/oj-projects-billing/route.ts:176:  context: string
src/app/api/cron/oj-projects-billing/route.ts:1966:      console.error('Failed to load OJ billing entry vendors', entryVendorError)
src/app/api/cron/oj-projects-billing/route.ts:1967:      return NextResponse.json({ error: 'Failed to load billing vendor candidates' }, { status: 500 })
src/app/api/cron/oj-projects-billing/route.ts:1981:      console.error('Failed to load OJ billing recurring-charge vendors', chargeVendorError)
src/app/api/cron/oj-projects-billing/route.ts:1982:      return NextResponse.json({ error: 'Failed to load billing vendor candidates' }, { status: 500 })
src/app/api/cron/oj-projects-billing/route.ts:1997:      console.error('Failed to load OJ billing recurring-charge instance vendors', instanceVendorError)
src/app/api/cron/oj-projects-billing/route.ts:1998:      return NextResponse.json({ error: 'Failed to load billing vendor candidates' }, { status: 500 })
src/app/api/cron/oj-projects-billing/route.ts:2049:          reason: err instanceof Error ? err.message : 'Failed to build preview',
src/app/api/cron/oj-projects-billing/route.ts:2089:      // Create or load billing run (idempotency)
src/app/api/cron/oj-projects-billing/route.ts:2113:            throw new Error(createError.message || existingError?.message || 'Failed to create or load billing run')
src/app/api/cron/oj-projects-billing/route.ts:2121:        throw err instanceof Error ? err : new Error('Failed to initialise billing run')
codex
I’ve got the likely hotspots. Next I’m reading the RLS/constraint layer and the server actions that load vendors, projects, entries, and unpaid invoice balances, because those are the actual guardrails a statement action would inherit or bypass.
exec
/bin/zsh -lc "sed -n '1,260p' src/app/actions/oj-projects/projects.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,220p' src/app/actions/oj-projects/client-balance.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,320p' src/app/actions/oj-projects/entries.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,220p' src/app/actions/oj-projects/vendor-settings.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,340p' supabase/migrations/20260120130000_oj_projects_core.sql" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'

function roundMoney(v: number) {
  return Math.round((v + Number.EPSILON) * 100) / 100
}

export type ClientInvoiceSummary = {
  id: string
  invoice_number: string
  invoice_date: string
  due_date: string
  reference: string
  status: string
  total_amount: number
  paid_amount: number
  outstanding: number
}
 succeeded in 52ms:
'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { z } from 'zod'
import crypto from 'crypto'

const CreateProjectSchema = z.object({
  vendor_id: z.string().uuid('Invalid vendor ID'),
  project_name: z.string().min(1, 'Project name is required').max(200),
  brief: z.string().max(5000).optional(),
  internal_notes: z.string().max(10000).optional(),
  deadline: z
    .string()
    .optional()
    .refine((value) => !value || !Number.isNaN(Date.parse(value)), 'Invalid deadline date'),
  budget_ex_vat: z.coerce.number().min(0).optional(),
  budget_hours: z.coerce.number().min(0).optional(),
  status: z.enum(['active', 'paused', 'completed', 'archived'] as const).optional(),
 succeeded in 52ms:
'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { z } from 'zod'

const BillingSettingsSchema = z.object({
  vendor_id: z.string().uuid('Invalid vendor ID'),
  client_code: z.string().trim().min(1).max(10).optional().or(z.literal('')).optional(),
  billing_mode: z.enum(['full', 'cap'] as const),
  monthly_cap_inc_vat: z.coerce.number().min(0).optional(),
  hourly_rate_ex_vat: z.coerce.number().min(0).max(10000),
  vat_rate: z.coerce.number().min(0).max(100),
  mileage_rate: z.coerce.number().min(0).max(100),
  retainer_included_hours_per_month: z.coerce.number().min(0).max(1000).optional(),
  statement_mode: z.boolean().optional(),
})

export async function getVendorBillingSettings(vendorId: string) {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
 succeeded in 52ms:
'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { recalculateTaxYearMileage } from '@/lib/mileage/recalculateTaxYear'
import { getTaxYearBounds } from '@/lib/mileage/hmrcRates'
import { z } from 'zod'

const TimeEntrySchema = z.object({
  vendor_id: z.string().uuid('Invalid vendor ID'),
  project_id: z.string().uuid('Invalid project ID'),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  duration_minutes: z.coerce.number().min(1, 'Duration must be at least 1 minute'),
  work_type_id: z.string().uuid('Invalid work type').optional().or(z.literal('')).optional(),
  description: z.string().max(5000).optional(),
  internal_notes: z.string().max(10000).optional(),
  billable: z.coerce.boolean().optional(),
})

 succeeded in 52ms:
-- OJ Projects core tables + RLS
-- Creates project/time tracking tables and billing run audit/locking.

-- 1) RBAC permissions (optional if table exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'rbac_permissions'
  ) THEN
    INSERT INTO public.rbac_permissions (module, action, description) VALUES
      ('oj_projects', 'view', 'View OJ Projects'),
      ('oj_projects', 'create', 'Create OJ Projects data'),
      ('oj_projects', 'edit', 'Edit OJ Projects data'),
      ('oj_projects', 'delete', 'Delete OJ Projects data'),
      ('oj_projects', 'manage', 'Full OJ Projects management')
    ON CONFLICT (module, action) DO NOTHING;
  END IF;
END $$;

exec
/bin/zsh -lc "nl -ba docs/superpowers/specs/2026-04-14-oj-projects-review-design.md | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"credit_notes|credit note|credit_note|voidInvoice|void_reason|voided_at|invoice void|invoice_email_logs|invoice_series|user_has_permission\\(auth.uid\\(\\), 'invoices'|invoices', 'delete'|invoices', 'view'|invoices', 'edit'|invoices', 'create'\" supabase/migrations src/app src/services src/lib docs/superpowers/specs/2026-04-14-oj-projects-review-design.md" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
     1	# OJ Projects Review — Bug Fixes, Client Statement, Payment Receipts & Completeness
     2	
     3	**Date:** 2026-04-14
     4	**Status:** Draft
     5	**Complexity:** L (score 4) — multiple files, new features, migration, cross-cutting receipt change
     6	
     7	---
     8	
     9	## Overview
    10	
    11	End-to-end review and enhancement of the OJ Projects section. Four workstreams:
    12	
    13	1. **Bug fixes** — data integrity issues affecting accuracy of balances and billing
    14	2. **Client statement** — running account statement (PDF + email) showing invoices, payments, credits, and balance over a date range
    15	3. **Partial payment receipts** — extend existing receipt flow to fire on partial payments (universal, not OJ Projects only)
    16	4. **Completeness recommendations** — payment history on project detail, billing cron alerting, statement mode UI clarity, void/credit note support
    17	
    18	---
    19	
    20	## Phase 1: Bug Fixes
 succeeded in 51ms:
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:16:4. **Completeness recommendations** — payment history on project detail, billing cron alerting, statement mode UI clarity, void/credit note support
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:93:- Future: credit notes (Phase 4.4)
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:164:- **Audit:** Log to `invoice_email_logs` with appropriate type
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:200:**Guard:** Ensure we don't double-send if `recordPayment()` is called multiple times (use the existing `invoice_email_logs` table to check for recent sends against the same invoice + payment combination).
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:235:### 4.4 — Void/credit note support
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:240:- Add `voidInvoice(invoiceId, reason)` server action in `src/app/actions/invoices.ts`
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:248:- New `credit_notes` table: `id`, `invoice_id` (optional — can be standalone), `vendor_id`, `amount`, `reason`, `created_at`, `created_by`
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:251:- PDF generation using same compact template with `documentKind: 'credit_note'`
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:270:| Migration | 1 new migration (constraint fix + credit_notes table) | New |
src/services/invoices.ts:65:      .rpc('get_and_increment_invoice_series', { p_series_code: 'INV' })
src/services/invoices.ts:119:      .rpc('get_and_increment_invoice_series', { p_series_code: 'INV' })
src/services/quotes.ts:29:      .rpc('get_and_increment_invoice_series', { p_series_code: 'QTE' })
src/lib/invoice-reminder-safety.ts:20:    .from('invoice_email_logs')
src/lib/invoice-reminder-safety.ts:47:    .from('invoice_email_logs')
src/app/api/cron/auto-send-invoices/route.ts:94:        .from('invoice_email_logs')
src/app/api/cron/auto-send-invoices/route.ts:196:          .from('invoice_email_logs')
src/app/api/cron/auto-send-invoices/route.ts:237:        .from('invoice_email_logs')
src/app/api/cron/oj-projects-billing/route.ts:2472:            await supabase.from('invoice_email_logs').insert({
src/app/api/cron/oj-projects-billing/route.ts:2502:          const { error: toLogError } = await supabase.from('invoice_email_logs').insert({
src/app/api/cron/oj-projects-billing/route.ts:2514:            const { error: ccLogError } = await supabase.from('invoice_email_logs').insert({
exec
/bin/zsh -lc "sed -n '320,760p' src/app/actions/oj-projects/entries.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,260p' src/app/api/oj-projects/billing-preview/route.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,260p' src/app/actions/invoices.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,220p' src/app/(authenticated)/oj-projects/clients/page.tsx" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 50ms:
import { NextResponse } from 'next/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { GET as runOjProjectsBilling } from '@/app/api/cron/oj-projects-billing/route'

export async function GET(request: Request) {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const url = new URL(request.url)
  const vendorId = url.searchParams.get('vendor_id')
  if (!vendorId) {
    return NextResponse.json({ error: 'vendor_id is required' }, { status: 400 })
  }

  const cronUrl = new URL('/api/cron/oj-projects-billing', url.origin)
  cronUrl.searchParams.set('dry_run', 'true')
  cronUrl.searchParams.set('force', 'true')
  cronUrl.searchParams.set('vendor_id', vendorId)
 succeeded in 50ms:
    .from('oj_entries')
    .insert({
      vendor_id: parsed.data.vendor_id,
      project_id: parsed.data.project_id,
      entry_type: 'one_off',
      entry_date: parsed.data.entry_date,
      start_at: null,
      end_at: null,
      duration_minutes_raw: null,
      duration_minutes_rounded: null,
      miles: null,
      work_type_id: null,
      work_type_name_snapshot: null,
      description: parsed.data.description || null,
      internal_notes: parsed.data.internal_notes || null,
      billable: parsed.data.billable ?? true,
      status: 'unbilled',
      hourly_rate_ex_vat_snapshot: null,
      vat_rate_snapshot: settings.vat_rate,
      mileage_rate_snapshot: null,
 succeeded in 52ms:
'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from './audit'
import { isGraphConfigured, sendInvoiceEmail } from '@/lib/microsoft-graph'
import { z } from 'zod'
import { getErrorMessage } from '@/lib/errors'
import { revalidatePath, revalidateTag } from 'next/cache'
import type {
  Invoice,
  InvoiceWithDetails,
  InvoiceStatus,
  InvoiceLineItemInput,
  LineItemCatalogItem
} from '@/types/invoices'
import { InvoiceService, CreateInvoiceSchema } from '@/services/invoices'

const CONTACT_NAME = process.env.COMPANY_CONTACT_NAME || 'Peter Pitcher'
 exited 1 in 52ms:
zsh:1: no matches found: src/app/(authenticated)/oj-projects/clients/page.tsx
exec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '2320,2465p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc 'rg -n "sendInternalReminder|MICROSOFT_USER_EMAIL|error email|failed run|alert|notify|notification|admin|toRecipients|support|receipt|receipt" src/app/api/cron/oj-projects-billing/route.ts' in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '3160,3355p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,260p' src/lib/invoice-recipients.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 50ms:
3:import { createAdminClient } from '@/lib/supabase/admin'
2004:    // Vendors with failed runs for this period (retry)
 succeeded in 51ms:
  2320	        const { claimKey, claimHash } = buildOjInvoiceSendClaimParams({
  2321	          invoiceId: invoice.id,
  2322	          billingRunId: billingRun.id,
  2323	          to: recipients.to,
  2324	          cc: recipients.cc,
  2325	          subject
  2326	        })
  2327	        const sendClaim = await claimIdempotencyKey(supabase, claimKey, claimHash, 24 * 180)
  2328	        if (sendClaim.state === 'conflict') {
  2329	          await updateBillingRunById(supabase, billingRun.id, {
  2330	            status: 'failed',
  2331	            error_message: 'Invoice email idempotency conflict; manual reconciliation required.',
  2332	            run_finished_at: new Date().toISOString(),
  2333	            updated_at: new Date().toISOString()
  2334	          })
  2335	
  2336	          results.failed++
  2337	          results.vendors.push({
  2338	            vendor_id: vendorId,
  2339	            status: 'failed',
 succeeded in 52ms:
import type { SupabaseClient } from '@supabase/supabase-js'

type GenericClient = SupabaseClient<any, 'public', any>

type InvoiceVendorContact = {
  email: string
  isPrimary: boolean
  receiveInvoiceCopy: boolean
}

export function parseRecipientList(raw: string | null | undefined): string[] {
  if (!raw) return []

  return dedupeRecipients(
    String(raw)
      .split(/[;,]/)
      .map((value) => value.trim())
      .filter((value) => isEmailLike(value))
  )
}
 succeeded in 52ms:
  3160	        await updateBillingRunById(supabase, billingRun.id, {
  3161	          status: 'failed',
  3162	          error_message: 'Invoice email idempotency conflict; manual reconciliation required.',
  3163	          run_finished_at: new Date().toISOString(),
  3164	          updated_at: new Date().toISOString()
  3165	        })
  3166	
  3167	        results.failed++
  3168	        results.vendors.push({
  3169	          vendor_id: vendorId,
  3170	          status: 'failed',
  3171	          invoice_id: invoiceId,
  3172	          invoice_number: invoiceNumber,
  3173	          error: 'Invoice email idempotency conflict'
  3174	        })
  3175	        continue
  3176	      }
  3177	      if (sendClaim.state === 'in_progress') {
  3178	        results.skipped++
  3179	        results.vendors.push({
codex
The spec is explicit on permissions: statements should require `oj_projects:view`, and invoice voids should require `invoices:delete` or a dedicated `void` action. I’m now pulling exact SQL ranges for the live RLS/policy definitions and schema fields to see where that lines up and where the model is incomplete.
exec
/bin/zsh -lc "nl -ba supabase/migrations/20260120130000_oj_projects_core.sql | sed -n '1,340p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba supabase/migrations/20251123120000_squashed.sql | sed -n '11560,12040p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba supabase/migrations/20260121100000_oj_recurring_charge_instances.sql | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba supabase/migrations/20251123120000_squashed.sql | sed -n '14756,15530p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
     1	-- OJ Projects core tables + RLS
     2	-- Creates project/time tracking tables and billing run audit/locking.
     3	
     4	-- 1) RBAC permissions (optional if table exists)
     5	DO $$
     6	BEGIN
     7	  IF EXISTS (
     8	    SELECT 1 FROM information_schema.tables
     9	    WHERE table_schema = 'public' AND table_name = 'rbac_permissions'
    10	  ) THEN
    11	    INSERT INTO public.rbac_permissions (module, action, description) VALUES
    12	      ('oj_projects', 'view', 'View OJ Projects'),
    13	      ('oj_projects', 'create', 'Create OJ Projects data'),
    14	      ('oj_projects', 'edit', 'Edit OJ Projects data'),
    15	      ('oj_projects', 'delete', 'Delete OJ Projects data'),
    16	      ('oj_projects', 'manage', 'Full OJ Projects management')
    17	    ON CONFLICT (module, action) DO NOTHING;
    18	  END IF;
    19	END $$;
    20	
 succeeded in 51ms:
 11560	-- 1. ADD INVOICE PERMISSIONS
 11561	-- ========================================
 11562	-- Insert invoice module permissions (check for existence first)
 11563	DO $$
 11564	BEGIN
 11565	  -- Invoice View Permission
 11566	  IF NOT EXISTS (
 11567	    SELECT 1 FROM permissions 
 11568	    WHERE module_name = 'invoices' AND action = 'view'
 11569	  ) THEN
 11570	    INSERT INTO permissions (module_name, action, description)
 11571	    VALUES ('invoices', 'view', 'View invoices and access invoice list');
 11572	  END IF;
 11573	
 11574	  -- Invoice Create Permission
 11575	  IF NOT EXISTS (
 11576	    SELECT 1 FROM permissions 
 11577	    WHERE module_name = 'invoices' AND action = 'create'
 11578	  ) THEN
 11579	    INSERT INTO permissions (module_name, action, description)
 succeeded in 51ms:
     1	-- OJ Projects: recurring charge instances (per period) to support cap carry-forward.
     2	-- Tracks billed status and allows deferred recurring charges to be billed in later runs.
     3	
     4	CREATE TABLE IF NOT EXISTS public.oj_recurring_charge_instances (
     5	  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
     6	  vendor_id uuid NOT NULL REFERENCES public.invoice_vendors(id) ON DELETE CASCADE,
     7	  recurring_charge_id uuid NOT NULL REFERENCES public.oj_vendor_recurring_charges(id) ON DELETE CASCADE,
     8	  period_yyyymm text NOT NULL,
     9	  period_start date NOT NULL,
    10	  period_end date NOT NULL,
    11	  description_snapshot text NOT NULL,
    12	  amount_ex_vat_snapshot numeric(12,2) NOT NULL,
    13	  vat_rate_snapshot numeric(5,2) NOT NULL DEFAULT 20,
    14	  sort_order_snapshot integer NOT NULL DEFAULT 0,
    15	  status text NOT NULL DEFAULT 'unbilled' CHECK (status IN ('unbilled', 'billing_pending', 'billed', 'paid')),
    16	  billing_run_id uuid REFERENCES public.oj_billing_runs(id),
    17	  invoice_id uuid REFERENCES public.invoices(id),
    18	  billed_at timestamptz,
    19	  paid_at timestamptz,
    20	  created_at timestamptz NOT NULL DEFAULT now(),
 succeeded in 50ms:
 14756	  );
 14757	REVOKE ALL ON public.attachment_categories FROM anon;
 14758	
 14759	-- 7. Invoice number series must honour invoice permissions
 14760	ALTER TABLE public.invoice_series ENABLE ROW LEVEL SECURITY;
 14761	DROP POLICY IF EXISTS "Invoice users can view invoice_series" ON public.invoice_series;
 14762	DROP POLICY IF EXISTS "Invoice users can modify invoice_series" ON public.invoice_series;
 14763	DROP POLICY IF EXISTS "Invoice users can insert invoice_series" ON public.invoice_series;
 14764	DROP POLICY IF EXISTS "Invoice users can delete invoice_series" ON public.invoice_series;
 14765	CREATE POLICY "Invoice users can view invoice_series"
 14766	  ON public.invoice_series
 14767	  FOR SELECT TO authenticated
 14768	  USING (
 14769	    auth.role() = 'service_role'
 14770	    OR public.user_has_permission(auth.uid(), 'invoices', 'view')
 14771	  );
 14772	CREATE POLICY "Invoice users can modify invoice_series"
 14773	  ON public.invoice_series
 14774	  FOR UPDATE TO authenticated
 14775	  USING (
codex
I’ve confirmed the OJ tables themselves are only protected by module-level RBAC, not per-vendor RLS. That means the main scoping question is whether the statement action consistently constrains every invoice/payment lookup to the requested vendor and to OJ-linked invoices, rather than relying on ambiguous references.
exec
/bin/zsh -lc "sed -n '1,260p' 'src/app/(authenticated)/oj-projects/clients/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc 'rg -n "void|written_off|deleted_at|status.*void|invoice_payments|invoice_email_logs|statement" src/app/actions/invoices.ts src/services/invoices.ts src/lib src/app/api/cron/oj-projects-billing/route.ts src/app/actions | head -n 400' in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 50ms:
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card, CardTitle } from '@/components/ui-v2/layout/Card'
import { Button, IconButton } from '@/components/ui-v2/forms/Button'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Checkbox } from '@/components/ui-v2/forms/Checkbox'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
import { usePermissions } from '@/contexts/PermissionContext'
import { createVendor, getVendors } from '@/app/actions/vendors'
import { getVendorBillingSettings, upsertVendorBillingSettings } from '@/app/actions/oj-projects/vendor-settings'
import { getOjProjectsEmailStatus } from '@/app/actions/oj-projects/system'
 succeeded in 51ms:
src/services/invoices.ts:196:      .is('deleted_at', null)
src/services/invoices.ts:260:      .is('deleted_at', null);
src/services/invoices.ts:277:    // The DB-level persistOverdueInvoices() write was removed from this read path to avoid
src/services/invoices.ts:286:      .is('deleted_at', null);
src/services/invoices.ts:335:    // to avoid mutations on every detail fetch. It should run in a dedicated cron job instead.
src/services/invoices.ts:343:        payments:invoice_payments(*)
src/services/invoices.ts:346:      .is('deleted_at', null)
src/services/invoices.ts:415:      .is('deleted_at', null)
src/services/invoices.ts:444:      .is('deleted_at', null)
src/services/invoices.ts:466:      .is('deleted_at', null)
src/services/invoices.ts:480:        deleted_at: new Date().toISOString(),
src/services/invoices.ts:486:      .is('deleted_at', null)
src/app/api/cron/oj-projects-billing/route.ts:1024:    .is('deleted_at', null)
src/app/api/cron/oj-projects-billing/route.ts:1026:    .not('status', 'in', '(paid,void,written_off)')
src/app/api/cron/oj-projects-billing/route.ts:1317:  const statementMode = !!settings?.statement_mode
src/app/api/cron/oj-projects-billing/route.ts:1477:  let statementBalanceBefore: number | null = null
src/app/api/cron/oj-projects-billing/route.ts:1478:  if (statementMode && billingMode === 'cap' && capIncVat != null && capIncVat > 0) {
src/app/api/cron/oj-projects-billing/route.ts:1492:    statementBalanceBefore = summary.balanceBefore
src/app/api/cron/oj-projects-billing/route.ts:1525:      statement_mode: statementMode,
src/app/api/cron/oj-projects-billing/route.ts:1533:  let lineItems = statementMode
exec
/bin/zsh -lc "nl -ba src/app/actions/oj-projects/entries.ts | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/oj-projects/client-balance.ts | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba supabase/migrations/20260120130000_oj_projects_core.sql | sed -n '110,310p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
     1	'use server'
     2	
     3	import { createClient } from '@/lib/supabase/server'
     4	import { checkUserPermission } from '@/app/actions/rbac'
     5	
     6	function roundMoney(v: number) {
     7	  return Math.round((v + Number.EPSILON) * 100) / 100
     8	}
     9	
    10	export type ClientInvoiceSummary = {
    11	  id: string
    12	  invoice_number: string
    13	  invoice_date: string
    14	  due_date: string
    15	  reference: string
    16	  status: string
    17	  total_amount: number
    18	  paid_amount: number
    19	  outstanding: number
    20	}
 succeeded in 52ms:
   110	-- 8) Entries (time + mileage)
   111	CREATE TABLE IF NOT EXISTS public.oj_entries (
   112	  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
   113	  vendor_id uuid NOT NULL REFERENCES public.invoice_vendors(id) ON DELETE CASCADE,
   114	  project_id uuid NOT NULL REFERENCES public.oj_projects(id),
   115	  entry_type text NOT NULL CHECK (entry_type IN ('time', 'mileage')),
   116	  entry_date date NOT NULL,
   117	  start_at timestamptz,
   118	  end_at timestamptz,
   119	  duration_minutes_raw integer,
   120	  duration_minutes_rounded integer,
   121	  miles numeric(12,2),
   122	  work_type_id uuid REFERENCES public.oj_work_types(id),
   123	  work_type_name_snapshot text,
   124	  description text,
   125	  internal_notes text,
   126	  billable boolean NOT NULL DEFAULT true,
   127	  status text NOT NULL DEFAULT 'unbilled' CHECK (status IN ('unbilled', 'billing_pending', 'billed', 'paid')),
   128	  billing_run_id uuid REFERENCES public.oj_billing_runs(id),
   129	  invoice_id uuid REFERENCES public.invoices(id),
 succeeded in 52ms:
     1	'use server'
     2	
     3	import { createClient } from '@/lib/supabase/server'
     4	import { checkUserPermission } from '@/app/actions/rbac'
     5	import { logAuditEvent } from '@/app/actions/audit'
     6	import { recalculateTaxYearMileage } from '@/lib/mileage/recalculateTaxYear'
     7	import { getTaxYearBounds } from '@/lib/mileage/hmrcRates'
     8	import { z } from 'zod'
     9	
    10	const TimeEntrySchema = z.object({
    11	  vendor_id: z.string().uuid('Invalid vendor ID'),
    12	  project_id: z.string().uuid('Invalid project ID'),
    13	  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    14	  duration_minutes: z.coerce.number().min(1, 'Duration must be at least 1 minute'),
    15	  work_type_id: z.string().uuid('Invalid work type').optional().or(z.literal('')).optional(),
    16	  description: z.string().max(5000).optional(),
    17	  internal_notes: z.string().max(10000).optional(),
    18	  billable: z.coerce.boolean().optional(),
    19	})
    20	
exec
/bin/zsh -lc "sed -n '1,120p' supabase/migrations/20250820195912_add_invoice_permissions.sql && printf '\\n---FILE-END---\\n' && sed -n '1,120p' supabase/migrations/20251120010000_fix_invoice_rls_policies.sql" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba supabase/migrations/20250820195912_add_invoice_permissions.sql | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba supabase/migrations/20251120010000_fix_invoice_rls_policies.sql | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
     1	-- Placeholder for 20251120010000_fix_invoice_rls_policies.sql
     2	-- This migration was squashed into 20251123120000_squashed.sql
     3	-- Original file stored at supabase/migrations-archive/pre-squash-20251123/20251120010000_fix_invoice_rls_policies.sql
 succeeded in 52ms:
-- Placeholder for 20250820195912_add_invoice_permissions.sql
-- This migration was squashed into 20251123120000_squashed.sql
-- Original file stored at supabase/migrations-archive/pre-squash-20251123/20250820195912_add_invoice_permissions.sql

---FILE-END---
-- Placeholder for 20251120010000_fix_invoice_rls_policies.sql
-- This migration was squashed into 20251123120000_squashed.sql
-- Original file stored at supabase/migrations-archive/pre-squash-20251123/20251120010000_fix_invoice_rls_policies.sql
 succeeded in 52ms:
     1	-- Placeholder for 20250820195912_add_invoice_permissions.sql
     2	-- This migration was squashed into 20251123120000_squashed.sql
     3	-- Original file stored at supabase/migrations-archive/pre-squash-20251123/20250820195912_add_invoice_permissions.sql
codex
I haven’t found an actual “billing cron error email” sender in the billing route yet, which matters because the risk profile changes if failures only go to logs/DB. I’m broadening the search to any cron-notification helper that references OJ billing failures so I can answer that part precisely instead of inferring.
exec
/bin/zsh -lc "sed -n '1,260p' src/types/invoices.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
// Invoice-specific vendor type (different from private bookings vendor)
export interface InvoiceVendor {
  id: string
  name: string
  contact_name?: string
  email?: string
  phone?: string
  address?: string
  vat_number?: string
  payment_terms?: number
  notes?: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue' | 'void' | 'written_off'
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired'
export type PaymentMethod = 'bank_transfer' | 'card' | 'cash' | 'cheque' | 'other'
export type RecurringFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly'
exec
/bin/zsh -lc "rg -n \"sendInternalReminder\\(|send.*failure|cron failed|billing.*failed|error_message|failure email|alert email|notification email|failed billing run|invoice send claim|manual reconciliation|required|support@|admin@\" src -g '"'!**/*.test.*'"'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"record_invoice_payment_transaction|create_invoice_transaction|update_invoice_with_line_items\" -g '*.sql' -g '*.ts' -g '*.tsx' ." in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
Total output lines: 987

src/services/audit.ts:12:  error_message?: string;
src/services/audit.ts:51:        error_message: params.error_message ?? null,
src/services/private-bookings/payments.ts:474:// invoking them. The userId parameter is not required here because these are
src/services/private-bookings/mutations.ts:1261:// Add note — userId required, caller handles auth
src/services/private-bookings/mutations.ts:1533:// Venue Space Management — userId required, caller handles auth
src/services/private-bookings/mutations.ts:1718:// Catering Package Management — userId required, caller handles auth
src/services/private-bookings/mutations.ts:1954:// Vendor Management — userId required, caller handles auth
src/services/private-bookings/types.ts:119:  customer_first_name: z.string().min(1, 'First name is required'),
src/types/database.generated.ts:334:          error_message: string | null
src/types/database.generated.ts:350:          error_message?: string | null
src/types/database.generated.ts:366:          error_message?: string | null
src/types/database.generated.ts:614:          error_message: string | null
src/types/database.generated.ts:628:          error_message?: string | null
src/types/database.generated.ts:642:          error_message?: string | null
src/types/database.generated.ts:1293:          error_message: string | null
src/types/database.generated.ts:1304:          error_message?: string | null
src/types/database.generated.ts:1315:          error_message?: string | null
src/types/database.generated.ts:3363:          error_message: string | null
 succeeded in 51ms:
./src/services/invoices.ts:96:    const { data: invoice, error } = await supabase.rpc('create_invoice_transaction', {
./src/services/invoices.ts:148:    const { data: invoice, error } = await adminClient.rpc('create_invoice_transaction', {
./src/services/invoices.ts:167:    const { data: result, error } = await supabase.rpc('record_invoice_payment_transaction', {
./src/services/invoices.ts:236:      'update_invoice_with_line_items',
./src/types/database.generated.ts:11766:      create_invoice_transaction: {
./src/types/database.generated.ts:12386:      record_invoice_payment_transaction: {
./src/types/database.generated.ts:12468:      update_invoice_with_line_items: {
./src/app/api/cron/oj-projects-billing/route.ts:3049:      const { data: createdInvoice, error: createInvoiceError } = await supabase.rpc('create_invoice_transaction', {
./supabase/migrations-archive/pre-squash-20251123/20260401130000_create_invoice_transactions.sql:2:CREATE OR REPLACE FUNCTION create_invoice_transaction(
./supabase/migrations-archive/pre-squash-20251123/20260401130000_create_invoice_transactions.sql:81:CREATE OR REPLACE FUNCTION record_invoice_payment_transaction(
./supabase/migrations-archive/pre-squash-20251123/20251215123000_update_invoice_transaction.sql:1:create or replace function update_invoice_with_line_items(
./supabase/migrations-archive/pre-squash-20251123/20251215123000_update_invoice_transaction.sql:91:grant execute on function update_invoice_with_line_items(uuid, jsonb, jsonb) to service_role;
./supabase/migrations/20251123120000_squashed.sql:16150:create or replace function update_invoice_with_line_items(
./supabase/migrations/20251123120000_squashed.sql:16240:grant execute on function update_invoice_with_line_items(uuid, jsonb, jsonb) to service_role;
./supabase/migrations/20251123120000_squashed.sql:18142:-- Begin 20260401130000_create_invoice_transactions.sql
./supabase/migrations/20251123120000_squashed.sql:18144:CREATE OR REPLACE FUNCTION create_invoice_transaction(
./supabase/migrations/20251123120000_squashed.sql:18223:CREATE OR REPLACE FUNCTION record_invoice_payment_transaction(
./supabase/migrations/20251123120000_squashed.sql:18303:-- End 20260401130000_create_invoice_transactions.sql
./supabase/migrations/20260401130000_create_invoice_transactions.sql:1:-- Placeholder for 20260401130000_create_invoice_transactions.sql
./supabase/migrations/20260401130000_create_invoice_transactions.sql:3:-- Original file stored at supabase/migrations-archive/pre-squash-20251123/20260401130000_create_invoice_transactions.sql
codex
The current invoice action already has a safety check around voiding OJ-linked invoices. I’m reading that path now, along with the billing cron’s linkage to `invoice_id`, because the spec’s “set back to unbilled” behavior can only be safe if it fully clears those links and respects the cap/statement carry-forward logic.
exec
/bin/zsh -lc "nl -ba src/app/actions/invoices.ts | sed -n '380,470p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/services/invoices.ts | sed -n '320,520p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '980,1065p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '1680,1815p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '2140,2235p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
   380	      line_items: lineItems
   381	    });
   382	
   383	    await logAuditEvent({
   384	      user_id: user.id,
   385	      user_email: user.email,
   386	      operation_type: 'create',
   387	      resource_type: 'invoice',
   388	      resource_id: invoice.id,
   389	      operation_status: 'success',
   390	      new_values: {
   391	        invoice_number: invoice.invoice_number,
   392	        vendor_id: invoice.vendor_id,
   393	        total_amount: invoice.total_amount
   394	      }
   395	    })
   396	
   397	    revalidatePath('/invoices')
   398	    revalidateTag('dashboard')
   399	
 succeeded in 51ms:
   320	          ? ('overdue' as InvoiceStatus)
   321	          : invoice.status,
   322	    }));
   323	
   324	    return {
   325	      invoices: normalizedInvoices as InvoiceWithDetails[],
   326	      total: count || 0
   327	    };
   328	  }
   329	
   330	  static async getInvoiceById(invoiceId: string) {
   331	    const supabase = await createClient();
   332	
   333	    // Overdue status is computed at read time via JS-side normalisation below.
   334	    // The DB-level persistOverdueInvoices() write was removed from this read path
   335	    // to avoid mutations on every detail fetch. It should run in a dedicated cron job instead.
   336	
   337	    const { data: invoice, error } = await supabase
   338	      .from('invoices')
   339	      .select(`
 succeeded in 50ms:
  1680	  const unbilledEntries = [
  1681	    ...(input.selectedTimeEntries || []),
  1682	    ...(input.selectedMileageEntries || []),
  1683	    ...(input.skippedTimeEntries || []),
  1684	    ...(input.skippedMileageEntries || []),
  1685	  ]
  1686	  const unbilledRecurring = [
  1687	    ...(input.selectedRecurringInstances || []),
  1688	    ...(input.skippedRecurringInstances || []),
  1689	  ]
  1690	
  1691	  const unbilledProjectBalances = new Map<string, { label: string; amount: number }>()
  1692	  let unbilledProjectsTotal = 0
  1693	  for (const entry of unbilledEntries) {
  1694	    const { incVat } = getEntryCharge(entry, input.settings)
  1695	    if (incVat <= 0) continue
  1696	    const projectLabel = getProjectLabel(entry?.project)
  1697	    const key = String(entry?.project_id || projectLabel)
  1698	    const existing = unbilledProjectBalances.get(key) || { label: projectLabel, amount: 0 }
  1699	    existing.amount = roundMoney(existing.amount + incVat)
 succeeded in 51ms:
   980	  supabase: ReturnType<typeof createAdminClient>
   981	  vendorId: string
   982	  settings: any
   983	  selectedRecurringInstances: any[]
   984	  skippedRecurringInstances: any[]
   985	  selectedMileageEntries: any[]
   986	  skippedMileageEntries: any[]
   987	  selectedTimeEntries: any[]
   988	  skippedTimeEntries: any[]
   989	  selectedOneOffEntries?: any[]
   990	  skippedOneOffEntries?: any[]
   991	}) {
   992	  const unbilledEntries = [
   993	    ...(input.selectedTimeEntries || []),
   994	    ...(input.selectedMileageEntries || []),
   995	    ...(input.selectedOneOffEntries || []),
   996	    ...(input.skippedTimeEntries || []),
   997	    ...(input.skippedMileageEntries || []),
   998	    ...(input.skippedOneOffEntries || []),
   999	  ]
 succeeded in 50ms:
  2140	          .order('created_at', { ascending: false })
  2141	          .limit(1)
  2142	          .maybeSingle()
  2143	
  2144	        if (recoveredInvoice?.id) {
  2145	          billingRun.invoice_id = recoveredInvoice.id
  2146	          const { data: updatedBillingRun, error: billingRunUpdateError } = await supabase
  2147	            .from('oj_billing_runs')
  2148	            .update({ invoice_id: recoveredInvoice.id, updated_at: new Date().toISOString() })
  2149	            .eq('id', billingRun.id)
  2150	            .select('id')
  2151	            .maybeSingle()
  2152	
  2153	          if (billingRunUpdateError) {
  2154	            throw new Error(`Failed to persist recovered invoice link on billing run: ${billingRunUpdateError.message}`)
  2155	          }
  2156	
  2157	          if (!updatedBillingRun) {
  2158	            throw new Error('Billing run not found while persisting recovered invoice link')
  2159	          }
codex
The pre-squash invoice migration filenames are only stubs in `supabase/migrations`; the live SQL now sits inside [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql). I’m checking for any post-squash migrations that changed invoice/payment auth or introduced void/credit-note schema, so the answer reflects the current state rather than the historical baseline.
exec
/bin/zsh -lc "rg -n \"invoices|invoice_payments|invoice_email_logs|credit_notes|credit_note|void|voided_at|void_reason|invoice_series|invoice_vendor_contacts\" supabase/migrations | sed -n '1,240p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/invoices.ts | sed -n '300,860p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/services/invoices.ts | sed -n '1,420p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
     1	import { createClient } from '@/lib/supabase/server';
     2	import { createAdminClient } from '@/lib/supabase/admin';
     3	import { calculateInvoiceTotals } from '@/lib/invoiceCalculations';
     4	import { getTodayIsoDate } from '@/lib/dateUtils';
     5	import { isInvoiceStatusTransitionAllowed } from '@/lib/status-transitions';
     6	import { z } from 'zod'; // Import Zod
     7	
     8	import type { InvoiceStatus, InvoiceLineItemInput, Invoice, InvoiceWithDetails, LineItemCatalogItem } from '@/types/invoices';
     9	
    10	function sanitizeInvoiceSearch(value: string): string {
    11	  return value
    12	    .replace(/[,%_()"'\\]/g, '')
    13	    .replace(/\s+/g, ' ')
    14	    .trim()
    15	    .slice(0, 80);
    16	}
    17	export { isInvoiceStatusTransitionAllowed } from '@/lib/status-transitions';
    18	
    19	// Invoice validation schema
    20	export const CreateInvoiceSchema = z.object({
 succeeded in 52ms:
   300	  limit: number = 20,
   301	  search?: string
   302	) {
   303	  try {
   304	    const hasPermission = await checkUserPermission('invoices', 'view')
   305	    if (!hasPermission) {
   306	      return { error: 'You do not have permission to view invoices' }
   307	    }
   308	
   309	    const { invoices, total } = await InvoiceService.getInvoices(status, page, limit, search)
   310	    return { invoices, total }
   311	  } catch (error: unknown) {
   312	    console.error('Error in getInvoices:', error)
   313	    return { error: getErrorMessage(error) }
   314	  }
   315	}
   316	
   317	export async function getInvoice(invoiceId: string) {
   318	  try {
   319	    const hasPermission = await checkUserPermission('invoices', 'view')
 succeeded in 52ms:
supabase/migrations/20250912_add_invoice_vendor_contacts.sql:1:-- Placeholder for 20250912_add_invoice_vendor_contacts.sql
supabase/migrations/20250912_add_invoice_vendor_contacts.sql:3:-- Original file stored at supabase/migrations-archive/pre-squash-20251123/20250912_add_invoice_vendor_contacts.sql
supabase/migrations/20260307000001_reconciliation_notes_unique_constraint.sql:11:-- Drop the non-unique index first to avoid duplicate index overhead
supabase/migrations/20260525000000_add_menu_performance_indexes.sql:42:--    enables an index-only scan, avoiding the heap fetch for every ingredient.
supabase/migrations/20260319124206_apply_balance_payment_status.sql:2:RETURNS void
supabase/migrations/20260228000004_auto_close_past_event_tasks.sql:7:RETURNS void
supabase/migrations/20260419000003_prevent_duplicate_short_links_by_destination.sql:2:-- Uses an advisory transaction lock to avoid race conditions when two requests create the same URL at the same time.
supabase/migrations/20260405130000_mileage_expenses_mgd.sql:8:-- Drop and recreate to avoid parameter name conflict with any existing version
supabase/migrations/20260216212500_fix_booking_logic.sql:5:RETURNS void
supabase/migrations/20260120131000_invoice_vendor_contacts_invoice_cc.sql:3:ALTER TABLE public.invoice_vendor_contacts
supabase/migrations/20260120131000_invoice_vendor_contacts_invoice_cc.sql:9:CREATE INDEX IF NOT EXISTS idx_invoice_vendor_contacts_receive_invoice_copy
supabase/migrations/20260120131000_invoice_vendor_contacts_invoice_cc.sql:10:ON public.invoice_vendor_contacts(vendor_id, receive_invoice_copy)
supabase/migrations/20251123120000_squashed.sql:225:CREATE OR REPLACE FUNCTION "public"."cleanup_import"() RETURNS "void"
supabase/migrations/20251123120000_squashed.sql:258:CREATE OR REPLACE FUNCTION "public"."cleanup_old_reminder_logs"() RETURNS "void"
supabase/migrations/20251123120000_squashed.sql:335:CREATE OR REPLACE FUNCTION "public"."encrypt_sensitive_audit_data"("p_encryption_key" "text") RETURNS "void"
supabase/migrations/20251123120000_squashed.sql:6168:-- Create RLS policies for staff access (drop existing policies first to avoid conflicts)
supabase/migrations/20251123120000_squashed.sql:6338:-- Drop existing policies if they exist to avoid conflicts
supabase/migrations/20251123120000_squashed.sql:7109:RETURNS void AS $$
supabase/migrations/20251123120000_squashed.sql:7375:      -- Check if code already exists (use full table reference to avoid ambiguity)
supabase/migrations/20251123120000_squashed.sql:7711:-- Fix all analytics functions to avoid nested aggregates and type mismatches
exec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '1300,1605p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"OJ Projects %|OJ Projects|statement_mode|client statement|selectedOneOffEntries|billing_pending|invoice_id\" src/app/api/cron/oj-projects-billing/route.ts src/app/actions/oj-projects src/app/actions/invoices.ts src/services/invoices.ts | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '3345,3395p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '2580,3075p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"createAdminClient\\(|service role|admin client|createClient\\(\" src/app/api/cron/oj-projects-billing/route.ts src/app/actions/invoices.ts src/services/invoices.ts src/app/actions/oj-projects/*.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
  1300	async function buildDryRunPreview(input: {
  1301	  supabase: ReturnType<typeof createAdminClient>
  1302	  vendorId: string
  1303	  vendor: any
  1304	  period: { period_start: string; period_end: string; period_yyyymm: string }
  1305	  invoiceDate: string
  1306	}) {
  1307	  const { supabase, vendorId, vendor, period, invoiceDate } = input
  1308	
  1309	  const { data: settings } = await supabase
  1310	    .from('oj_vendor_billing_settings')
  1311	    .select('*')
  1312	    .eq('vendor_id', vendorId)
  1313	    .maybeSingle()
  1314	
  1315	  const billingMode: 'full' | 'cap' = settings?.billing_mode === 'cap' ? 'cap' : 'full'
  1316	  const capIncVat = billingMode === 'cap' && typeof settings?.monthly_cap_inc_vat === 'number' ? settings.monthly_cap_inc_vat : null
  1317	  const statementMode = !!settings?.statement_mode
  1318	
  1319	  const { data: recurringChargeDefs, error: recurringError } = await supabase
 succeeded in 51ms:
src/services/invoices.ts:42:  invoice_id: string;
src/services/invoices.ts:169:        invoice_id: input.invoice_id,
src/services/invoices.ts:211:      p_invoice_id: invoiceId,
src/app/actions/invoices.ts:222:        invoice_id: invoiceId,
src/app/actions/invoices.ts:260:    invoice_id: invoiceId,
src/app/actions/invoices.ts:440:    // Prevent voiding invoices that have linked OJ Projects items, unless explicitly overridden.
src/app/actions/invoices.ts:451:          .eq('invoice_id', invoiceId),
src/app/actions/invoices.ts:455:          .eq('invoice_id', invoiceId),
src/app/actions/invoices.ts:459:        return { error: entryError.message || 'Failed to check linked OJ Projects entries' }
src/app/actions/invoices.ts:463:        return { error: recurringError.message || 'Failed to check linked OJ Projects recurring charges' }
src/app/actions/invoices.ts:469:          error: 'This invoice has linked OJ Projects items. Voiding it will not automatically revert or unbill those entries/charges.',
src/app/actions/invoices.ts:711:        invoice_id: invoiceId,
src/app/actions/invoices.ts:727:        invoice_id: invoiceId,
src/app/api/cron/oj-projects-billing/route.ts:144:      status: 'billing_pending',
src/app/api/cron/oj-projects-billing/route.ts:240:  selectedOneOffEntries?: any[]
src/app/api/cron/oj-projects-billing/route.ts:251:  lines.push(`OJ Projects timesheet`)
src/app/api/cron/oj-projects-billing/route.ts:362:  if ((input.selectedOneOffEntries?.length ?? 0) > 0) {
src/app/api/cron/oj-projects-billing/route.ts:365:    for (const e of input.selectedOneOffEntries!) {
src/app/api/cron/oj-projects-billing/route.ts:591:    invoice_id: null,
src/app/api/cron/oj-projects-billing/route.ts:616:    invoice_id: null,
 succeeded in 51ms:
  3345	            status: 'sent',
  3346	          })
  3347	          if (ccLogError) {
  3348	            console.error('Failed to write OJ billing invoice send log (cc):', ccLogError)
  3349	          }
  3350	        }
  3351	      }
  3352	
  3353	      if (selectedEntryIds.length > 0) {
  3354	        await updateSelectedRowsByIdsOrThrow({
  3355	          supabase,
  3356	          table: 'oj_entries',
  3357	          ids: selectedEntryIds,
  3358	          patch: {
  3359	            status: 'billed',
  3360	            invoice_id: invoiceId,
  3361	            billed_at: new Date().toISOString(),
  3362	            updated_at: new Date().toISOString(),
  3363	          },
  3364	          expectedStatus: 'billing_pending',
 succeeded in 51ms:
  2580	          }
  2581	        }
  2582	
  2583	        results.sent++
  2584	        results.vendors.push({ vendor_id: vendorId, status: 'sent', invoice_id: invoice.id, invoice_number: invoice.invoice_number })
  2585	        continue
  2586	      }
  2587	
  2588	      // If the run has no invoice and has stranded pending items (e.g. crash before invoice creation),
  2589	      // unlock them so they can be billed on the next attempt.
  2590	      const { data: strandedPending, error: strandedError } = await supabase
  2591	        .from('oj_entries')
  2592	        .select('id')
  2593	        .eq('billing_run_id', billingRun.id)
  2594	        .eq('status', 'billing_pending')
  2595	        .limit(10000)
  2596	      if (strandedError) throw new Error(strandedError.message)
  2597	
  2598	      const { data: strandedRecurring, error: strandedRecurringError } = await supabase
  2599	        .from('oj_recurring_charge_instances')
 succeeded in 51ms:
src/app/actions/oj-projects/work-types.ts:18:  const supabase = await createClient()
src/app/actions/oj-projects/work-types.ts:40:  const supabase = await createClient()
src/app/actions/oj-projects/work-types.ts:82:  const supabase = await createClient()
src/app/actions/oj-projects/work-types.ts:120:  const supabase = await createClient()
src/app/actions/oj-projects/recurring-charges.ts:21:  const supabase = await createClient()
src/app/actions/oj-projects/recurring-charges.ts:47:  const supabase = await createClient()
src/app/actions/oj-projects/recurring-charges.ts:95:  const supabase = await createClient()
src/app/actions/oj-projects/recurring-charges.ts:135:  const supabase = await createClient()
src/app/actions/oj-projects/vendor-settings.ts:23:  const supabase = await createClient()
src/app/actions/oj-projects/vendor-settings.ts:62:  const supabase = await createClient()
src/app/actions/oj-projects/project-contacts.ts:17:  const supabase = await createClient()
src/app/actions/oj-projects/project-contacts.ts:41:  const supabase = await createClient()
src/app/actions/oj-projects/project-contacts.ts:96:  const supabase = await createClient()
src/app/actions/oj-projects/projects.ts:94:  const supabase = await createClient()
src/app/actions/oj-projects/projects.ts:144:  const supabase = await createClient()
src/app/actions/oj-projects/projects.ts:178:  const supabase = await createClient()
src/app/actions/oj-projects/projects.ts:230:  const supabase = await createClient()
src/app/actions/oj-projects/projects.ts:273:  const supabase = await createClient()
src/app/actions/oj-projects/projects.ts:320:  const supabase = await createClient()
src/app/actions/oj-projects/entries.ts:116:  const supabase = await createClient()
exec
/bin/zsh -lc "nl -ba src/services/invoices.ts | sed -n '407,620p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba supabase/migrations/20260120131000_invoice_vendor_contacts_invoice_cc.sql | sed -n '1,120p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"voidInvoice|creditNote|credit note|credit_note|void_reason|voided_at|invoice_email_logs|record_invoice_payment_transaction|create_invoice_transaction|update_invoice_with_line_items|get_invoice_summary_stats\" supabase/migrations/20251123120000_squashed.sql src/services/invoices.ts src/app/actions/invoices.ts src/lib src/app/actions/oj-projects -g '"'!src/types/database.generated.ts'"'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
     1	-- Extend invoice vendor contacts with phone/role and invoice CC flag
     2	
     3	ALTER TABLE public.invoice_vendor_contacts
     4	  ADD COLUMN IF NOT EXISTS phone text,
     5	  ADD COLUMN IF NOT EXISTS role text,
     6	  ADD COLUMN IF NOT EXISTS receive_invoice_copy boolean NOT NULL DEFAULT false;
     7	
     8	-- Index for quickly loading CC recipients
     9	CREATE INDEX IF NOT EXISTS idx_invoice_vendor_contacts_receive_invoice_copy
    10	ON public.invoice_vendor_contacts(vendor_id, receive_invoice_copy)
    11	WHERE receive_invoice_copy = true;
    12	
 succeeded in 51ms:
   407	  static async updateInvoiceStatus(invoiceId: string, newStatus: InvoiceStatus) {
   408	    const supabase = await createClient();
   409	    
   410	    // Get current invoice for old status
   411	    const { data: currentInvoice, error: fetchError } = await supabase
   412	      .from('invoices')
   413	      .select('*')
   414	      .eq('id', invoiceId)
   415	      .is('deleted_at', null)
   416	      .single();
   417	
   418	    if (fetchError || !currentInvoice) {
   419	      throw new Error('Invoice not found');
   420	    }
   421	
   422	    if (!isInvoiceStatusTransitionAllowed(currentInvoice.status as InvoiceStatus, newStatus)) {
   423	      throw new Error(`Invalid status transition from ${currentInvoice.status} to ${newStatus}`);
   424	    }
   425	
   426	    if (currentInvoice.status === newStatus) {
 succeeded in 51ms:
src/app/actions/invoices.ts:220:    const { error: logError } = await supabase.from('invoice_email_logs').insert(
src/app/actions/invoices.ts:259:  const { error: failedLogError } = await supabase.from('invoice_email_logs').insert({
src/services/invoices.ts:96:    const { data: invoice, error } = await supabase.rpc('create_invoice_transaction', {
src/services/invoices.ts:148:    const { data: invoice, error } = await adminClient.rpc('create_invoice_transaction', {
src/services/invoices.ts:167:    const { data: result, error } = await supabase.rpc('record_invoice_payment_transaction', {
src/services/invoices.ts:236:      'update_invoice_with_line_items',
src/services/invoices.ts:367:      .rpc('get_invoice_summary_stats')
supabase/migrations/20251123120000_squashed.sql:12006:CREATE TABLE IF NOT EXISTS public.invoice_email_logs (
supabase/migrations/20251123120000_squashed.sql:12020:    CONSTRAINT invoice_email_logs_status_check CHECK (((status)::text = ANY ((ARRAY['sent'::character varying, 'failed'::character varying, 'bounced'::character varying])::text[])))
supabase/migrations/20251123120000_squashed.sql:12050:    CONSTRAINT invoice_emails_email_type_check CHECK (((email_type)::text = ANY ((ARRAY['new_invoice'::character varying, 'reminder'::character varying, 'chase'::character varying, 'credit_note'::character varying, 'statement'::character varying, 'quote'::character varying])::text[]))),
supabase/migrations/20251123120000_squashed.sql:16150:create or replace function update_invoice_with_line_items(
supabase/migrations/20251123120000_squashed.sql:16240:grant execute on function update_invoice_with_line_items(uuid, jsonb, jsonb) to service_role;
supabase/migrations/20251123120000_squashed.sql:17976:CREATE OR REPLACE FUNCTION public.get_invoice_summary_stats()
supabase/migrations/20251123120000_squashed.sql:18142:-- Begin 20260401130000_create_invoice_transactions.sql
supabase/migrations/20251123120000_squashed.sql:18144:CREATE OR REPLACE FUNCTION create_invoice_transaction(
supabase/migrations/20251123120000_squashed.sql:18223:CREATE OR REPLACE FUNCTION record_invoice_payment_transaction(
supabase/migrations/20251123120000_squashed.sql:18303:-- End 20260401130000_create_invoice_transactions.sql
src/lib/invoice-reminder-safety.ts:20:    .from('invoice_email_logs')
src/lib/invoice-reminder-safety.ts:47:    .from('invoice_email_logs')
exec
/bin/zsh -lc "nl -ba src/app/actions/invoices.ts | sed -n '1,240p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba supabase/migrations-archive/pre-squash-20251123/20260401130000_create_invoice_transactions.sql | sed -n '80,190p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/lib/microsoft-graph.ts | sed -n '1,240p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/lib/invoice-template-compact.ts | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 50ms:
     1	'use server'
     2	
     3	import { createClient } from '@/lib/supabase/server'
     4	import { createAdminClient } from '@/lib/supabase/admin'
     5	import { checkUserPermission } from '@/app/actions/rbac'
     6	import { logAuditEvent } from './audit'
     7	import { isGraphConfigured, sendInvoiceEmail } from '@/lib/microsoft-graph'
     8	import { z } from 'zod'
     9	import { getErrorMessage } from '@/lib/errors'
    10	import { revalidatePath, revalidateTag } from 'next/cache'
    11	import type {
    12	  Invoice,
    13	  InvoiceWithDetails,
    14	  InvoiceStatus,
    15	  InvoiceLineItemInput,
    16	  LineItemCatalogItem
    17	} from '@/types/invoices'
    18	import { InvoiceService, CreateInvoiceSchema } from '@/services/invoices'
    19	
    20	const CONTACT_NAME = process.env.COMPANY_CONTACT_NAME || 'Peter Pitcher'
 succeeded in 52ms:
     1	import { InvoiceWithDetails } from '@/types/invoices'
     2	import { formatDateFull } from '@/lib/dateUtils'
     3	import { COMPANY_DETAILS } from '@/lib/company-details'
     4	
     5	const CONTACT_NAME = process.env.COMPANY_CONTACT_NAME || 'Peter Pitcher'
     6	const CONTACT_PHONE = process.env.COMPANY_CONTACT_PHONE || '07995087315'
     7	
     8	export type InvoiceDocumentKind = 'invoice' | 'remittance_advice'
     9	
    10	export interface InvoiceRemittanceDetails {
    11	  paymentDate?: string | null
    12	  paymentAmount?: number | null
    13	  paymentMethod?: string | null
    14	  paymentReference?: string | null
    15	}
    16	
    17	export interface InvoiceTemplateData {
    18	  invoice: InvoiceWithDetails
    19	  logoUrl?: string
    20	  documentKind?: InvoiceDocumentKind
 succeeded in 52ms:
     1	// import { Client } from '@microsoft/microsoft-graph-client'
     2	// import { ClientSecretCredential } from '@azure/identity'
     3	import type { InvoiceWithDetails, QuoteWithDetails } from '@/types/invoices'
     4	import { generateInvoicePDF, generateQuotePDF } from '@/lib/pdf-generator'
     5	import type { InvoiceDocumentKind, InvoiceRemittanceDetails } from '@/lib/invoice-template-compact'
     6	import { getErrorMessage, getErrorStatusCode } from '@/lib/errors'
     7	
     8	const CONTACT_NAME = process.env.COMPANY_CONTACT_NAME || 'Peter Pitcher'
     9	const CONTACT_PHONE = process.env.COMPANY_CONTACT_PHONE || '07995087315'
    10	
    11	// Initialize Microsoft Graph client
    12	async function getGraphClient() {
    13	  // Check if Graph is configured
    14	  if (!isGraphConfigured()) {
    15	    throw new Error('Microsoft Graph is not configured. Please check environment variables.')
    16	  }
    17	
    18	  const { Client } = await import('@microsoft/microsoft-graph-client')
    19	  const { ClientSecretCredential } = await import('@azure/identity')
    20	
 succeeded in 53ms:
    80	-- Function to record payment and update invoice status
    81	CREATE OR REPLACE FUNCTION record_invoice_payment_transaction(
    82	  p_payment_data JSONB
    83	)
    84	RETURNS JSONB
    85	LANGUAGE plpgsql
    86	SECURITY DEFINER
    87	AS $$
    88	DECLARE
    89	  v_payment_id UUID;
    90	  v_invoice_id UUID;
    91	  v_amount DECIMAL;
    92	  v_current_paid DECIMAL;
    93	  v_total DECIMAL;
    94	  v_new_paid DECIMAL;
    95	  v_new_status text; -- Changed from invoice_status to text
    96	  v_payment_record JSONB;
    97	BEGIN
    98	  v_invoice_id := (p_payment_data->>'invoice_id')::UUID;
    99	  v_amount := (p_payment_data->>'amount')::DECIMAL;
codex
I’ve confirmed the app layer is also relevant here: invoice actions mostly pre-check `checkUserPermission(...)`, but the service layer mixes session clients and admin clients. I’m reading the invoice RPC definitions and grants next, because they determine whether DB enforcement actually backs those app checks or whether some paths bypass RLS.
exec
/bin/zsh -lc "nl -ba supabase/migrations/20251123120000_squashed.sql | sed -n '16140,16260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba supabase/migrations/20251123120000_squashed.sql | sed -n '17976,18320p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"GRANT EXECUTE ON FUNCTION (create_invoice_transaction|record_invoice_payment_transaction|get_invoice_summary_stats|update_invoice_with_line_items)|SECURITY DEFINER|SECURITY INVOKER|user_has_permission\\(.*invoices|user_has_permission\\(.*oj_projects|invoice_email_logs.*ENABLE ROW LEVEL SECURITY|ALTER TABLE public\\.invoice_email_logs ENABLE ROW LEVEL SECURITY|CREATE POLICY .*invoice_email_logs|ALTER TABLE public\\.invoice_audit ENABLE ROW LEVEL SECURITY|CREATE POLICY .*invoice_audit|ALTER TABLE public\\.invoice_emails ENABLE ROW LEVEL SECURITY|CREATE POLICY .*invoice_emails|ALTER TABLE public\\.invoice_vendors ENABLE ROW LEVEL SECURITY|CREATE POLICY .*invoice_vendors|line_item_catalog\" supabase/migrations/20251123120000_squashed.sql" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
 16140	    LIMIT GREATEST(limit_groups, 1)
 16141	  )
 16142	  SELECT * FROM grouped;
 16143	$$ LANGUAGE SQL STABLE;
 16144	
 16145	COMMIT;
 16146	-- End 20251205120000_receipt_bulk_require_manual_filter.sql
 16147	
 16148	
 16149	-- Begin 20251215123000_update_invoice_transaction.sql
 16150	create or replace function update_invoice_with_line_items(
 16151	  p_invoice_id uuid,
 16152	  p_invoice_data jsonb,
 16153	  p_line_items jsonb
 16154	)
 16155	returns invoices
 16156	language plpgsql
 16157	security definer
 16158	set search_path = public, extensions
 16159	as $$
 succeeded in 51ms:
240:    LANGUAGE "plpgsql" SECURITY DEFINER
272:    LANGUAGE "plpgsql" SECURITY DEFINER
336:    LANGUAGE "plpgsql" SECURITY DEFINER
436:    LANGUAGE "plpgsql" SECURITY DEFINER
456:    LANGUAGE "plpgsql" SECURITY DEFINER
610:    LANGUAGE "plpgsql" SECURITY DEFINER
640:    LANGUAGE "plpgsql" SECURITY DEFINER
697:    LANGUAGE "plpgsql" SECURITY DEFINER
754:    LANGUAGE "plpgsql" SECURITY DEFINER
870:    LANGUAGE "plpgsql" SECURITY DEFINER
888:    LANGUAGE "plpgsql" SECURITY DEFINER
904:    LANGUAGE "plpgsql" SECURITY DEFINER
937:    LANGUAGE "plpgsql" SECURITY DEFINER
1042:    LANGUAGE "plpgsql" SECURITY DEFINER
1158:    LANGUAGE "plpgsql" SECURITY DEFINER
1195:COMMENT ON FUNCTION "public"."rebuild_customer_category_stats"() IS 'Rebuilds customer category statistics from historical bookings. Uses SECURITY DEFINER to bypass RLS.';
1222:    LANGUAGE "plpgsql" SECURITY DEFINER
1418:    LANGUAGE "plpgsql" SECURITY DEFINER
1456:COMMENT ON FUNCTION "public"."update_customer_category_stats"() IS 'Automatically updates customer category stats when bookings are created. Uses SECURITY DEFINER to bypass RLS.';
1630:    LANGUAGE "plpgsql" SECURITY DEFINER
 succeeded in 51ms:
 17976	CREATE OR REPLACE FUNCTION public.get_invoice_summary_stats()
 17977	RETURNS TABLE(
 17978	  total_outstanding numeric,
 17979	  total_overdue numeric,
 17980	  total_draft numeric,
 17981	  total_this_month numeric,
 17982	  count_outstanding integer,
 17983	  count_overdue integer,
 17984	  count_draft integer
 17985	)
 17986	LANGUAGE plpgsql
 17987	AS $$
 17988	BEGIN
 17989	  RETURN QUERY
 17990	  SELECT
 17991	    COALESCE(SUM(CASE 
 17992	      WHEN i.status NOT IN ('paid', 'void', 'written_off')
 17993	        THEN i.total_amount - i.paid_amount 
 17994	      ELSE 0 
 17995	    END), 0) AS total_outstanding,
exec
/bin/zsh -lc "nl -ba src/lib/invoice-template-compact.ts | sed -n '260,420p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/lib/invoice-template-compact.ts | sed -n '420,520p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/invoices.ts | sed -n '660,770p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/services/invoices.ts | sed -n '150,190p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
   420	      border-radius: 4px;
   421	      page-break-inside: avoid;
   422	    }
   423	    
   424	    .notes-section h3 {
   425	      margin: 0 0 5px 0;
   426	      color: #111827;
   427	      font-size: 9pt;
   428	    }
   429	    
   430	    .notes-section p {
   431	      margin: 0;
   432	      color: #4b5563;
   433	      white-space: pre-wrap;
   434	      font-size: 8pt;
   435	    }
   436	    
   437	    .footer {
   438	      margin-top: 20px;
   439	      padding-top: 10px;
 succeeded in 52ms:
   260	      margin-bottom: 10px;
   261	    }
   262	    
   263	    .address-block {
   264	      background: #f9fafb;
   265	      padding: 8px;
   266	      border-radius: 4px;
   267	    }
   268	    
   269	    .address-block h3 {
   270	      margin: 0 0 5px 0;
   271	      color: #111827;
   272	      font-size: 9pt;
   273	      text-transform: uppercase;
   274	      letter-spacing: 0.3px;
   275	    }
   276	    
   277	    .address-block p {
   278	      margin: 2px 0;
   279	      color: #4b5563;
 succeeded in 51ms:
   660	
   661	    revalidatePath('/invoices/catalog')
   662	    
   663	    return { success: true }
   664	  } catch (error: unknown) {
   665	    console.error('Error in deleteCatalogItem:', error)
   666	    return { error: getErrorMessage(error) }
   667	  }
   668	}
   669	
   670	export async function recordPayment(formData: FormData) {
   671	  try {
   672	    const supabase = await createClient()
   673	    const hasPermission = await checkUserPermission('invoices', 'edit')
   674	    if (!hasPermission) {
   675	      return { error: 'You do not have permission to record payments' }
   676	    }
   677	
   678	    const invoiceId = String(formData.get('invoiceId') || '').trim()
   679	    const paymentDate = String(formData.get('paymentDate') || '').trim()
 succeeded in 51ms:
   150	      p_line_items: input.line_items
   151	    })
   152	
   153	    if (error) {
   154	      console.error('Create invoice transaction error:', error)
   155	      throw new Error('Failed to create invoice')
   156	    }
   157	
   158	    return invoice
   159	  }
   160	
   161	  /**
   162	   * Records a payment and updates invoice status atomically.
   163	   */
   164	  static async recordPayment(input: RecordPaymentInput) {
   165	    const supabase = await createClient();
   166	
   167	    const { data: result, error } = await supabase.rpc('record_invoice_payment_transaction', {
   168	      p_payment_data: {
   169	        invoice_id: input.invoice_id,
codex
I’m checking for hard database guarantees now. If the spec assumes “vendor_id join through `oj_entries`” is enough, that only works if the schema prevents mismatched `entry.vendor_id` and `project.vendor_id` from ever existing.
exec
/bin/zsh -lc "nl -ba src/app/actions/vendor-contacts.ts | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/vendors.ts | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/oj-projects/projects.ts | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"oj_recurring_charge_instances|CREATE TABLE IF NOT EXISTS public.oj_recurring_charge_instances|status IN \\('unbilled', 'billing_pending', 'billed', 'paid'\\)|invoice_id uuid REFERENCES public.invoices\" supabase/migrations/20260120130000_oj_projects_core.sql supabase/migrations/20260121120000_oj_retainer_projects.sql src/types/database.generated.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc 'rg -n "project.vendor_id|ensureProjectMatchesVendor|vendor_id.*project_id|oj_entries.*vendor_id.*project_id|constraint.*project.*vendor" supabase/migrations src/app/api/cron/oj-projects-billing/route.ts src/app/actions/oj-projects' in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
     1	'use server'
     2	
     3	import { createClient } from '@/lib/supabase/server'
     4	import { checkUserPermission } from '@/app/actions/rbac'
     5	import { revalidatePath } from 'next/cache'
     6	import { z } from 'zod'
     7	
     8	const ContactSchema = z.object({
     9	  vendorId: z.string().uuid('Invalid vendor ID'),
    10	  name: z.string().optional(),
    11	  email: z.string().email('Invalid email address'),
    12	  phone: z.string().optional(),
    13	  role: z.string().optional(),
    14	  isPrimary: z.coerce.boolean().optional(),
    15	  receiveInvoiceCopy: z.coerce.boolean().optional(),
    16	})
    17	
    18	export async function getVendorContacts(vendorId: string) {
    19	  const hasPermission = await checkUserPermission('invoices', 'view')
    20	  if (!hasPermission) return { error: 'Insufficient permissions' }
 succeeded in 52ms:
     1	'use server'
     2	
     3	import { createClient } from '@/lib/supabase/server'
     4	import { createAdminClient } from '@/lib/supabase/admin'
     5	import { checkUserPermission } from '@/app/actions/rbac'
     6	import { logAuditEvent } from './audit'
     7	import { z } from 'zod'
     8	import { getErrorMessage } from '@/lib/errors'
     9	import { revalidatePath } from 'next/cache'
    10	import type { InvoiceVendor } from '@/types/invoices'
    11	import { parsePaymentTermsValue } from '@/lib/vendors/paymentTerms'
    12	import { VendorService } from '@/services/vendors' // Import the new service
    13	
    14	// Vendor validation schema
    15	const VendorSchema = z.object({
    16	  name: z.string().min(1, 'Company name is required'),
    17	  contact_name: z.string().optional().or(z.literal('')),
    18	  email: z.string().email('Invalid email format').optional().or(z.literal('')),
    19	  phone: z.string().optional().or(z.literal('')),
    20	  address: z.string().optional().or(z.literal('')),
 succeeded in 52ms:
     1	'use server'
     2	
     3	import { createClient } from '@/lib/supabase/server'
     4	import { checkUserPermission } from '@/app/actions/rbac'
     5	import { logAuditEvent } from '@/app/actions/audit'
     6	import { z } from 'zod'
     7	import crypto from 'crypto'
     8	
     9	const CreateProjectSchema = z.object({
    10	  vendor_id: z.string().uuid('Invalid vendor ID'),
    11	  project_name: z.string().min(1, 'Project name is required').max(200),
    12	  brief: z.string().max(5000).optional(),
    13	  internal_notes: z.string().max(10000).optional(),
    14	  deadline: z
    15	    .string()
    16	    .optional()
    17	    .refine((value) => !value || !Number.isNaN(Date.parse(value)), 'Invalid deadline date'),
    18	  budget_ex_vat: z.coerce.number().min(0).optional(),
    19	  budget_hours: z.coerce.number().min(0).optional(),
    20	  status: z.enum(['active', 'paused', 'completed', 'archived'] as const).optional(),
 succeeded in 51ms:
supabase/migrations/20260120130000_oj_projects_core.sql:96:  invoice_id uuid REFERENCES public.invoices(id),
supabase/migrations/20260120130000_oj_projects_core.sql:127:  status text NOT NULL DEFAULT 'unbilled' CHECK (status IN ('unbilled', 'billing_pending', 'billed', 'paid')),
supabase/migrations/20260120130000_oj_projects_core.sql:129:  invoice_id uuid REFERENCES public.invoices(id),
src/types/database.generated.ts:6130:      oj_recurring_charge_instances: {
src/types/database.generated.ts:6190:            foreignKeyName: "oj_recurring_charge_instances_billing_run_id_fkey"
src/types/database.generated.ts:6197:            foreignKeyName: "oj_recurring_charge_instances_invoice_id_fkey"
src/types/database.generated.ts:6204:            foreignKeyName: "oj_recurring_charge_instances_recurring_charge_id_fkey"
src/types/database.generated.ts:6211:            foreignKeyName: "oj_recurring_charge_instances_vendor_id_fkey"
 succeeded in 50ms:
src/app/actions/oj-projects/entries.ts:70:async function ensureProjectMatchesVendor(
src/app/actions/oj-projects/entries.ts:82:  if (project.vendor_id !== vendorId) {
src/app/actions/oj-projects/entries.ts:174:  const match = await ensureProjectMatchesVendor(supabase, parsed.data.project_id, parsed.data.vendor_id)
src/app/actions/oj-projects/entries.ts:246:  const match = await ensureProjectMatchesVendor(supabase, parsed.data.project_id, parsed.data.vendor_id)
src/app/actions/oj-projects/entries.ts:314:  const match = await ensureProjectMatchesVendor(supabase, parsed.data.project_id, parsed.data.vendor_id)
src/app/actions/oj-projects/entries.ts:392:  const match = await ensureProjectMatchesVendor(supabase, parsed.data.project_id, parsed.data.vendor_id)
codex
The invoice RPCs are `SECURITY DEFINER`, so they can bypass caller RLS depending on function ownership and grants. I’m checking the exact grant surface now, because that’s the main place where the database auth story can diverge from the simple “RLS covers it” assumption.
exec
/bin/zsh -lc "rg -n \"invoice_email_logs|invoice_emails|invoice_audit|invoice_vendors|line_item_catalog\" supabase/migrations/20251123120000_squashed.sql | sed -n '1,240p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc 'rg -n "grant execute on function (create_invoice_transaction|record_invoice_payment_transaction|get_invoice_summary_stats)" supabase/migrations/20251123120000_squashed.sql' in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/oj-projects/client-balance.ts | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools exited 1 in 52ms:

 succeeded in 52ms:
11871:CREATE TABLE IF NOT EXISTS public.invoice_vendors (
11992:CREATE TABLE IF NOT EXISTS public.invoice_audit (
12006:CREATE TABLE IF NOT EXISTS public.invoice_email_logs (
12020:    CONSTRAINT invoice_email_logs_status_check CHECK (((status)::text = ANY ((ARRAY['sent'::character varying, 'failed'::character varying, 'bounced'::character varying])::text[])))
12034:CREATE TABLE IF NOT EXISTS public.invoice_emails (
12050:    CONSTRAINT invoice_emails_email_type_check CHECK (((email_type)::text = ANY ((ARRAY['new_invoice'::character varying, 'reminder'::character varying, 'chase'::character varying, 'credit_note'::character varying, 'statement'::character varying, 'quote'::character varying])::text[]))),
12051:    CONSTRAINT invoice_emails_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'sent'::character varying, 'failed'::character varying])::text[])))
12480:  vendor_id uuid not null references public.invoice_vendors(id) on delete cascade,
15077:  FROM invoice_vendors
15131:  JOIN invoice_vendors v ON i.vendor_id = v.id
15150:  JOIN invoice_vendors v ON i.vendor_id = v.id
15168:  JOIN invoice_vendors v ON q.vendor_id = v.id
15182:  JOIN invoice_vendors v ON r.vendor_id = v.id
 succeeded in 52ms:
     1	'use server'
     2	
     3	import { createClient } from '@/lib/supabase/server'
     4	import { checkUserPermission } from '@/app/actions/rbac'
     5	
     6	function roundMoney(v: number) {
     7	  return Math.round((v + Number.EPSILON) * 100) / 100
     8	}
     9	
    10	export type ClientInvoiceSummary = {
    11	  id: string
    12	  invoice_number: string
    13	  invoice_date: string
    14	  due_date: string
    15	  reference: string
    16	  status: string
    17	  total_amount: number
    18	  paid_amount: number
    19	  outstanding: number
    20	}
exec
/bin/zsh -lc "nl -ba supabase/migrations/20260121120000_oj_retainer_projects.sql | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba supabase/migrations/20260226120000_oj_entries_one_off.sql | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '1,420p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc 'rg -n "async function buildStatementNotes|function buildStatementLineItems|function buildDetailedLineItems|function getEntryCharge|OJ_TIMESHEET_MARKER|loadInvoiceWithDetails|resolveVendorInvoiceRecipients" src/app/api/cron/oj-projects-billing/route.ts' in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
     1	-- OJ Projects: retainer (monthly) projects
     2	-- Adds fields to identify and budget retainer projects and enforce 1/month per vendor.
     3	
     4	ALTER TABLE public.oj_projects
     5	  ADD COLUMN IF NOT EXISTS is_retainer boolean NOT NULL DEFAULT false,
     6	  ADD COLUMN IF NOT EXISTS retainer_period_yyyymm text,
     7	  ADD COLUMN IF NOT EXISTS budget_hours numeric(12,2);
     8	
     9	-- Ensure retainer projects have a period key (YYYY-MM).
    10	ALTER TABLE public.oj_projects
    11	  DROP CONSTRAINT IF EXISTS chk_oj_projects_retainer_period;
    12	
    13	ALTER TABLE public.oj_projects
    14	  ADD CONSTRAINT chk_oj_projects_retainer_period
    15	  CHECK (
    16	    is_retainer = false
    17	    OR (
    18	      retainer_period_yyyymm IS NOT NULL
    19	      AND retainer_period_yyyymm ~ '^\\d{4}-\\d{2}$'
    20	    )
 succeeded in 51ms:
6:import { resolveVendorInvoiceRecipients } from '@/lib/invoice-recipients'
23:const OJ_TIMESHEET_MARKER = 'OJ_TIMESHEET_ATTACHMENT=1'
430:function getEntryCharge(entry: any, settings: any) {
1117:function buildStatementLineItems(input: {
1181:function buildDetailedLineItems(input: {
1662:async function buildStatementNotes(input: {
1891:async function loadInvoiceWithDetails(supabase: ReturnType<typeof createAdminClient>, invoiceId: string) {
2165:        const loaded = await loadInvoiceWithDetails(supabase, billingRun.invoice_id)
2199:        const recipients = await resolveVendorInvoiceRecipients(supabase, vendorId, vendor.email)
2245:          String(invoice.internal_notes || '').includes(OJ_TIMESHEET_MARKER) ||
3029:          ? `Auto-generated by OJ Projects billing run ${billingRun.id} (${period.period_yyyymm}). ${OJ_TIMESHEET_MARKER}`
3108:      const fullInvoiceRes = await loadInvoiceWithDetails(supabase, invoiceId)
3112:      const recipients = await resolveVendorInvoiceRecipients(supabase, vendorId, vendor.email)
 succeeded in 51ms:
     1	-- Add one_off entry type to oj_entries
     2	-- Adds amount_ex_vat_snapshot column and updates CHECK constraints
     3	
     4	-- 1. Add the new column
     5	ALTER TABLE public.oj_entries
     6	  ADD COLUMN IF NOT EXISTS amount_ex_vat_snapshot NUMERIC(10,2) DEFAULT NULL;
     7	
     8	-- 2. Drop and recreate the entry_type check constraint to include 'one_off'
     9	ALTER TABLE public.oj_entries
    10	  DROP CONSTRAINT IF EXISTS oj_entries_entry_type_check;
    11	
    12	ALTER TABLE public.oj_entries
    13	  ADD CONSTRAINT oj_entries_entry_type_check
    14	  CHECK (entry_type IN ('time', 'mileage', 'one_off'));
    15	
    16	-- 3. Drop and recreate the time-fields check to allow one_off entries
    17	--    (one_off entries have no start_at, end_at, duration, or miles)
    18	ALTER TABLE public.oj_entries
    19	  DROP CONSTRAINT IF EXISTS chk_oj_entries_time_fields;
    20	
 succeeded in 51ms:
     1	import { NextResponse } from 'next/server'
     2	import { authorizeCronRequest } from '@/lib/cron-auth'
     3	import { createAdminClient } from '@/lib/supabase/admin'
     4	import { calculateInvoiceTotals, type InvoiceTotalsResult } from '@/lib/invoiceCalculations'
     5	import { isGraphConfigured, sendInvoiceEmail } from '@/lib/microsoft-graph'
     6	import { resolveVendorInvoiceRecipients } from '@/lib/invoice-recipients'
     7	import { generateOjTimesheetPDF } from '@/lib/oj-timesheet'
     8	import { formatInTimeZone } from 'date-fns-tz'
     9	import type { InvoiceWithDetails } from '@/types/invoices'
    10	import {
    11	  claimIdempotencyKey,
    12	  computeIdempotencyRequestHash,
    13	  persistIdempotencyResponse,
    14	  releaseIdempotencyClaim
    15	} from '@/lib/api/idempotency'
    16	
    17	export const runtime = 'nodejs'
    18	export const dynamic = 'force-dynamic'
    19	export const maxDuration = 300
    20	
🌐 Searching the web...
wait(call_LXrhqfeObwuzSZr9BW3WlmfY) timed out:
🌐 Searched: PostgreSQL default EXECUTE privilege on new functions PUBLIC documentation
collab wait(call_KMbfh48qPPAH0ZxP7Rxgh8E0)
  receivers: 019d8b1c-4f3f-7392-991b-dc83fd896fb3, 019d8b1c-4f4a-7ac3-9ef3-438aec87587f, 019d8b1c-4f6f-7f81-83dc-8262d073557b
codex
I found one concrete cross-vendor pattern worth checking against the statement design: the cron trusts `billingRun.invoice_id` and then loads the invoice by ID alone, without reasserting `invoice.vendor_id === current vendor`. I’m checking whether the schema has any FK/constraint that would make that impossible, and it doesn’t look like it does so far.
exec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '1888,1918p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '1660,1888p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/types/database.generated.ts | sed -n '6128,6218p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"CREATE POLICY .*invoices|ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY|invoices_select|invoice_payments\" supabase/migrations/20251123120000_squashed.sql | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"invoice_payments\" supabase/migrations src/types/database.generated.ts src/services/invoices.ts src/app/actions | sed -n '1,200p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
  1888	  return lines.join('\n')
  1889	}
  1890	
  1891	async function loadInvoiceWithDetails(supabase: ReturnType<typeof createAdminClient>, invoiceId: string) {
  1892	  const { data, error } = await supabase
  1893	    .from('invoices')
  1894	    .select(
  1895	      `
  1896	      *,
  1897	      vendor:invoice_vendors(*),
  1898	      line_items:invoice_line_items(*),
  1899	      payments:invoice_payments(*)
  1900	    `
  1901	    )
  1902	    .eq('id', invoiceId)
  1903	    .single()
  1904	
  1905	  if (error) return { error: error.message as string }
  1906	  return { invoice: data as InvoiceWithDetails }
  1907	}
 succeeded in 51ms:
  1660	}
  1661	
  1662	async function buildStatementNotes(input: {
  1663	  supabase: ReturnType<typeof createAdminClient>
  1664	  vendorId: string
  1665	  period_start: string
  1666	  period_end: string
  1667	  invoiceDate: string
  1668	  capIncVat: number | null
  1669	  settings: any
  1670	  selectedRecurringInstances: any[]
  1671	  skippedRecurringInstances: any[]
  1672	  selectedMileageEntries: any[]
  1673	  skippedMileageEntries: any[]
  1674	  selectedTimeEntries: any[]
  1675	  skippedTimeEntries: any[]
  1676	  invoiceTotalIncVat: number
  1677	}) {
  1678	  const supabase = input.supabase
  1679	
 succeeded in 51ms:
11980:CREATE TABLE IF NOT EXISTS public.invoice_payments (
11989:    CONSTRAINT invoice_payments_payment_method_check CHECK (((payment_method)::text = ANY ((ARRAY['bank_transfer'::character varying, 'cash'::character varying, 'cheque'::character varying, 'card'::character varying, 'other'::character varying])::text[])))
15385:CREATE POLICY "Users with invoices view permission can view invoices" 
15394:CREATE POLICY "Users with invoices create permission can create invoices" 
15403:CREATE POLICY "Users with invoices edit permission can update invoices" 
15415:CREATE POLICY "Users with invoices delete permission can delete invoices" 
15431:CREATE POLICY "Users with invoices view permission can view line items" 
15440:CREATE POLICY "Users with invoices create/edit permission can add line items" 
15450:CREATE POLICY "Users with invoices edit permission can update line items" 
15462:CREATE POLICY "Users with invoices edit/delete permission can delete line items" 
15476:ALTER TABLE "public"."invoice_payments" ENABLE ROW LEVEL SECURITY;
15479:CREATE POLICY "Users with invoices view permission can view payments" 
15480:ON "public"."invoice_payments" 
15488:CREATE POLICY "Users with invoices edit permission can record payments" 
15489:ON "public"."invoice_payments" 
15497:CREATE POLICY "Users with invoices edit permission can update payments" 
15498:ON "public"."invoice_payments" 
15509:CREATE POLICY "Users with invoices edit permission can delete payments" 
15510:ON "public"."invoice_payments" 
18259:  INSERT INTO invoice_payments (
 succeeded in 51ms:
  6128	        ]
  6129	      }
  6130	      oj_recurring_charge_instances: {
  6131	        Row: {
  6132	          amount_ex_vat_snapshot: number
  6133	          billed_at: string | null
  6134	          billing_run_id: string | null
  6135	          created_at: string
  6136	          description_snapshot: string
  6137	          id: string
  6138	          invoice_id: string | null
  6139	          paid_at: string | null
  6140	          period_end: string
  6141	          period_start: string
  6142	          period_yyyymm: string
  6143	          recurring_charge_id: string
  6144	          sort_order_snapshot: number
  6145	          status: string
  6146	          updated_at: string
  6147	          vat_rate_snapshot: number
 succeeded in 51ms:
src/services/invoices.ts:343:        payments:invoice_payments(*)
src/types/database.generated.ts:3577:      invoice_payments: {
src/types/database.generated.ts:3610:            foreignKeyName: "invoice_payments_invoice_id_fkey"
supabase/migrations/20251123120000_squashed.sql:11980:CREATE TABLE IF NOT EXISTS public.invoice_payments (
supabase/migrations/20251123120000_squashed.sql:11989:    CONSTRAINT invoice_payments_payment_method_check CHECK (((payment_method)::text = ANY ((ARRAY['bank_transfer'::character varying, 'cash'::character varying, 'cheque'::character varying, 'card'::character varying, 'other'::character varying])::text[])))
supabase/migrations/20251123120000_squashed.sql:15476:ALTER TABLE "public"."invoice_payments" ENABLE ROW LEVEL SECURITY;
supabase/migrations/20251123120000_squashed.sql:15480:ON "public"."invoice_payments" 
supabase/migrations/20251123120000_squashed.sql:15489:ON "public"."invoice_payments" 
supabase/migrations/20251123120000_squashed.sql:15498:ON "public"."invoice_payments" 
supabase/migrations/20251123120000_squashed.sql:15510:ON "public"."invoice_payments" 
supabase/migrations/20251123120000_squashed.sql:18259:  INSERT INTO invoice_payments (
supabase/migrations/20251123120000_squashed.sql:18294:  FROM invoice_payments ip
codex
I’ve confirmed the receipt generator has no invoice-type branching at all; everything flows through the same `InvoiceWithDetails` payload. I’m checking two edge cases before I write findings: how the payment RPC behaves for odd statuses like `void`/`written_off`, and whether OJ Projects “statement mode” introduces any extra assumptions that a partial-payment receipt would violate.
exec
/bin/zsh -lc 'rg -n "statement mode|internalNotes|OJ_TIMESHEET_MARKER|billing_mode|carried_forward|partially_paid|written_off|void" src/app/api/cron/oj-projects-billing/route.ts src/app/actions/invoices.ts supabase/migrations-archive/pre-squash-20251123/20260401130000_create_invoice_transactions.sql src/lib/invoice-template-compact.ts' in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '2460,2535p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '3000,3065p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '3288,3352p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
src/lib/invoice-template-compact.ts:130:      case 'partially_paid': return '#f59e0b'
src/lib/invoice-template-compact.ts:190:      .keep-together { page-break-inside: avoid; }
src/lib/invoice-template-compact.ts:364:      page-break-inside: avoid;
src/lib/invoice-template-compact.ts:389:      page-break-inside: avoid;
src/lib/invoice-template-compact.ts:421:      page-break-inside: avoid;
supabase/migrations-archive/pre-squash-20251123/20260401130000_create_invoice_transactions.sql:139:  ELSIF v_new_paid > 0 AND v_new_status NOT IN ('void', 'written_off') THEN
supabase/migrations-archive/pre-squash-20251123/20260401130000_create_invoice_transactions.sql:140:    v_new_status := 'partially_paid';
src/app/actions/invoices.ts:428:      'draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void', 'written_off'
src/app/actions/invoices.ts:436:    if (newStatus === 'paid' || newStatus === 'partially_paid') {
src/app/actions/invoices.ts:440:    // Prevent voiding invoices that have linked OJ Projects items, unless explicitly overridden.
src/app/actions/invoices.ts:441:    if (newStatus === 'void' && !force) {
src/app/api/cron/oj-projects-billing/route.ts:23:const OJ_TIMESHEET_MARKER = 'OJ_TIMESHEET_ATTACHMENT=1'
src/app/api/cron/oj-projects-billing/route.ts:1026:    .not('status', 'in', '(paid,void,written_off)')
src/app/api/cron/oj-projects-billing/route.ts:1315:  const billingMode: 'full' | 'cap' = settings?.billing_mode === 'cap' ? 'cap' : 'full'
src/app/api/cron/oj-projects-billing/route.ts:1524:      billing_mode: billingMode,
src/app/api/cron/oj-projects-billing/route.ts:1554:      billing_mode: billingMode,
src/app/api/cron/oj-projects-billing/route.ts:1633:    billing_mode: billingMode,
src/app/api/cron/oj-projects-billing/route.ts:1645:      carried_forward_inc_vat: carriedForwardIncVat,
src/app/api/cron/oj-projects-billing/route.ts:1717:    .not('status', 'in', '(paid,void,written_off)')
src/app/api/cron/oj-projects-billing/route.ts:2163:      // If an invoice exists for this run, attempt to send/reconcile it and avoid duplicates.
 succeeded in 52ms:
  2460	                    invoice_id: invoice.id,
  2461	                    billing_run_id: billingRun.id,
  2462	                    message: 'Invoice email sent but invoice status update did not transition row'
  2463	                  },
  2464	                  24 * 180
  2465	                )
  2466	                claimHeld = false
  2467	              } catch (persistError) {
  2468	                console.error('Failed to persist OJ billing invoice send claim after status mismatch:', persistError)
  2469	              }
  2470	            }
  2471	
  2472	            await supabase.from('invoice_email_logs').insert({
  2473	              invoice_id: invoice.id,
  2474	              sent_to: recipients.to,
  2475	              sent_by: 'system',
  2476	              subject,
  2477	              body: 'Invoice email sent, but invoice status update failed. Manual reconciliation required.',
  2478	              status: 'sent',
  2479	            })
 succeeded in 52ms:
  3288	                  message: 'Invoice email sent but invoice status update did not transition row'
  3289	                },
  3290	                24 * 180
  3291	              )
  3292	              claimHeld = false
  3293	            } catch (persistError) {
  3294	              console.error('Failed to persist OJ billing invoice send claim after status mismatch:', persistError)
  3295	            }
  3296	          }
  3297	
  3298	          await supabase.from('invoice_email_logs').insert({
  3299	            invoice_id: invoiceId,
  3300	            sent_to: recipients.to,
  3301	            sent_by: 'system',
  3302	            subject,
  3303	            body: 'Invoice email sent, but invoice status update failed. Manual reconciliation required.',
  3304	            status: 'sent',
  3305	          })
  3306	
  3307	          await updateBillingRunById(supabase, billingRun.id, {
 succeeded in 52ms:
  3000	      })
  3001	
  3002	      let notes = ''
  3003	      let internalNotes = ''
  3004	      let attachTimesheet = false
  3005	
  3006	      if (statementMode) {
  3007	        notes = await buildStatementNotes({
  3008	          supabase,
  3009	          vendorId,
  3010	          period_start: period.period_start,
  3011	          period_end: period.period_end,
  3012	          invoiceDate,
  3013	          capIncVat,
  3014	          settings,
  3015	          selectedRecurringInstances,
  3016	          skippedRecurringInstances,
  3017	          selectedMileageEntries: selectedMileage,
  3018	          skippedMileageEntries: skippedMileage,
  3019	          selectedTimeEntries: selectedTime,
codex
I’ve got the table-level policies now. One remaining gap check is whether the surrounding invoice tables (`invoice_vendors`, `line_item_catalog`, email/audit tables) are also covered by RLS, because the user-facing actions depend on them and gaps there would weaken the overall permission model even if `invoices` and `invoice_payments` themselves are protected.
exec
/bin/zsh -lc 'rg -n "invoice_vendors|line_item_catalog|invoice_email_logs|invoice_emails|invoice_audit" src/app/actions/invoices.ts src/services/invoices.ts src/app/actions/email.ts src/app/actions/vendors.ts src/app/actions/vendor-contacts.ts' in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"ALTER TABLE public\\.(invoice_vendors|line_item_catalog|invoice_email_logs|invoice_emails|invoice_audit) ENABLE ROW LEVEL SECURITY|CREATE POLICY .*invoice_vendors|CREATE POLICY .*line_item_catalog|CREATE POLICY .*invoice_email_logs|CREATE POLICY .*invoice_emails|CREATE POLICY .*invoice_audit|GRANT SELECT, INSERT, UPDATE, DELETE ON public\\.(invoice_vendors|line_item_catalog|invoice_email_logs|invoice_emails|invoice_audit)\" supabase/migrations/20251123120000_squashed.sql" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"checkUserPermission\\('oj_projects'|'checkUserPermission\\('invoices'\" src/app/actions/oj-projects src/app/actions/invoices.ts src/app/actions/vendors.ts src/app/actions/vendor-contacts.ts src/app/actions/email.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools exited 1 in 51ms:

 succeeded in 51ms:
src/app/actions/vendors.ts:36:      .from('invoice_vendors')
src/services/invoices.ts:284:        vendor:invoice_vendors(*)
src/services/invoices.ts:341:        vendor:invoice_vendors(*),
src/services/invoices.ts:394:      .from('line_item_catalog')
src/services/invoices.ts:504:      .from('line_item_catalog')
src/services/invoices.ts:526:      .from('line_item_catalog')
src/services/invoices.ts:552:      .from('line_item_catalog')
src/app/actions/email.ts:114:      .from('invoice_email_logs')
src/app/actions/email.ts:251:      const { error: emailLogError } = await admin.from('invoice_email_logs').insert(logRows)
src/app/actions/email.ts:526:        .from('invoice_email_logs')
src/app/actions/email.ts:733:      const { error: quoteLogError } = await admin.from('invoice_email_logs').insert(logRows)
src/app/actions/invoices.ts:220:    const { error: logError } = await supabase.from('invoice_email_logs').insert(
src/app/actions/invoices.ts:259:  const { error: failedLogError } = await supabase.from('invoice_email_logs').insert({
src/app/actions/invoices.ts:589:      resource_type: 'line_item_catalog',
src/app/actions/invoices.ts:625:      resource_type: 'line_item_catalog',
src/app/actions/invoices.ts:656:      resource_type: 'line_item_catalog',
 succeeded in 50ms:
src/app/actions/oj-projects/work-types.ts:15:  const hasPermission = await checkUserPermission('oj_projects', 'view')
src/app/actions/oj-projects/work-types.ts:30:  const hasPermission = await checkUserPermission('oj_projects', 'create')
src/app/actions/oj-projects/work-types.ts:69:  const hasPermission = await checkUserPermission('oj_projects', 'edit')
src/app/actions/oj-projects/work-types.ts:114:  const hasPermission = await checkUserPermission('oj_projects', 'edit')
src/app/actions/oj-projects/system.ts:7:  const hasPermission = await checkUserPermission('oj_projects', 'view')
src/app/actions/oj-projects/vendor-settings.ts:20:  const hasPermission = await checkUserPermission('oj_projects', 'view')
src/app/actions/oj-projects/vendor-settings.ts:35:  const hasPermission = await checkUserPermission('oj_projects', 'edit')
src/app/actions/oj-projects/recurring-charges.ts:18:  const hasPermission = await checkUserPermission('oj_projects', 'view')
src/app/actions/oj-projects/recurring-charges.ts:34:  const hasPermission = await checkUserPermission('oj_projects', 'edit')
src/app/actions/oj-projects/recurring-charges.ts:79:  const hasPermission = await checkUserPermission('oj_projects', 'edit')
src/app/actions/oj-projects/recurring-charges.ts:129:  const hasPermission = await checkUserPermission('oj_projects', 'edit')
src/app/actions/oj-projects/project-contacts.ts:14:  const hasPermission = await checkUserPermission('oj_projects', 'view')
src/app/actions/oj-projects/project-contacts.ts:32:  const hasPermission = await checkUserPermission('oj_projects', 'edit')
src/app/actions/oj-projects/project-contacts.ts:90:  const hasPermission = await checkUserPermission('oj_projects', 'edit')
src/app/actions/oj-projects/projects.ts:91:  const hasPermission = await checkUserPermission('oj_projects', 'view')
src/app/actions/oj-projects/projects.ts:141:  const hasPermission = await checkUserPermission('oj_projects', 'view')
src/app/actions/oj-projects/projects.ts:163:  const hasPermission = await checkUserPermission('oj_projects', 'create')
src/app/actions/oj-projects/projects.ts:214:  const hasPermission = await checkUserPermission('oj_projects', 'edit')
src/app/actions/oj-projects/projects.ts:267:  const hasPermission = await checkUserPermission('oj_projects', 'delete')
src/app/actions/oj-projects/projects.ts:309:  const hasPermission = await checkUserPermission('oj_projects', 'edit')
codex
There’s no hit for `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` or `CREATE POLICY` on `invoice_vendors`, `line_item_catalog`, `invoice_email_logs`, `invoice_emails`, or `invoice_audit` in the squashed migration. I’m validating whether that is truly absent versus defined under a different naming pattern, because if absent those tables are outside the DB-enforced model described by the invoice actions.
exec
/bin/zsh -lc "rg -n \"CREATE TABLE IF NOT EXISTS public\\.line_item_catalog|line_item_catalog\" supabase/migrations/20251123120000_squashed.sql" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"invoice_vendors|line_item_catalog|invoice_email_logs|invoice_emails|invoice_audit\" supabase/migrations/20251123120000_squashed.sql | sed -n '1,400p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"ALTER TABLE .*ENABLE ROW LEVEL SECURITY|CREATE POLICY .*line item|CREATE POLICY .*catalog|CREATE POLICY .*vendor|CREATE POLICY .*email log|CREATE POLICY .*invoice\" supabase/migrations/20251123120000_squashed.sql | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools exited 1 in 51ms:

 succeeded in 51ms:
11871:CREATE TABLE IF NOT EXISTS public.invoice_vendors (
11992:CREATE TABLE IF NOT EXISTS public.invoice_audit (
12006:CREATE TABLE IF NOT EXISTS public.invoice_email_logs (
12020:    CONSTRAINT invoice_email_logs_status_check CHECK (((status)::text = ANY ((ARRAY['sent'::character varying, 'failed'::character varying, 'bounced'::character varying])::text[])))
12034:CREATE TABLE IF NOT EXISTS public.invoice_emails (
12050:    CONSTRAINT invoice_emails_email_type_check CHECK (((email_type)::text = ANY ((ARRAY['new_invoice'::character varying, 'reminder'::character varying, 'chase'::character varying, 'credit_note'::character varying, 'statement'::character varying, 'quote'::character varying])::text[]))),
12051:    CONSTRAINT invoice_emails_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'sent'::character varying, 'failed'::character varying])::text[])))
12480:  vendor_id uuid not null references public.invoice_vendors(id) on delete cascade,
15077:  FROM invoice_vendors
15131:  JOIN invoice_vendors v ON i.vendor_id = v.id
15150:  JOIN invoice_vendors v ON i.vendor_id = v.id
15168:  JOIN invoice_vendors v ON q.vendor_id = v.id
15182:  JOIN invoice_vendors v ON r.vendor_id = v.id
 succeeded in 52ms:
4684:CREATE POLICY "All authenticated users can view active vendors" ON "public"."vendors" FOR SELECT TO "authenticated" USING ((("active" = true) OR "public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'manage_vendors'::"text")));
4963:CREATE POLICY "Users can manage vendors with permission" ON "public"."vendors" TO "authenticated" USING ("public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'manage_vendors'::"text")) WITH CHECK ("public"."user_has_permission"("auth"."uid"(), 'private_bookings'::"text", 'manage_vendors'::"text"));
5115:ALTER TABLE "public"."api_keys" ENABLE ROW LEVEL SECURITY;
5118:ALTER TABLE "public"."api_usage" ENABLE ROW LEVEL SECURITY;
5121:ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;
5132:ALTER TABLE "public"."background_jobs" ENABLE ROW LEVEL SECURITY;
5135:ALTER TABLE "public"."booking_reminders" ENABLE ROW LEVEL SECURITY;
5138:ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;
5141:ALTER TABLE "public"."business_amenities" ENABLE ROW LEVEL SECURITY;
5144:ALTER TABLE "public"."business_hours" ENABLE ROW LEVEL SECURITY;
5147:ALTER TABLE "public"."catering_packages" ENABLE ROW LEVEL SECURITY;
5150:ALTER TABLE "public"."customer_category_stats" ENABLE ROW LEVEL SECURITY;
5153:ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;
5156:ALTER TABLE "public"."employee_attachments" ENABLE ROW LEVEL SECURITY;
5159:ALTER TABLE "public"."employee_emergency_contacts" ENABLE ROW LEVEL SECURITY;
5162:ALTER TABLE "public"."employee_financial_details" ENABLE ROW LEVEL SECURITY;
5165:ALTER TABLE "public"."employee_health_records" ENABLE ROW LEVEL SECURITY;
5168:ALTER TABLE "public"."employee_notes" ENABLE ROW LEVEL SECURITY;
5171:ALTER TABLE "public"."employees" ENABLE ROW LEVEL SECURITY;
5174:ALTER TABLE "public"."event_categories" ENABLE ROW LEVEL SECURITY;
exec
/bin/zsh -lc "nl -ba src/app/actions/vendors.ts | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/vendor-contacts.ts | sed -n '1,180p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/email.ts | sed -n '90,280p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
    90	    body: normalizedBody
    91	  })
    92	
    93	  return {
    94	    key: `action:${kind}:${targetId}:${requestHash.slice(0, 16)}`,
    95	    requestHash
    96	  }
    97	}
    98	
    99	// Get email logs for an invoice
   100	export async function getInvoiceEmailLogs(invoiceId: string) {
   101	  try {
   102	    // Check permissions
   103	    const hasPermission = await checkUserPermission('invoices', 'view')
   104	    if (!hasPermission) {
   105	      return { error: 'You do not have permission to view email logs' }
   106	    }
   107	
   108	    // Use admin client to bypass restrictive RLS on logs table if necessary,
   109	    // or standard client if policy allows. Given the investigation findings,
 succeeded in 51ms:
     1	'use server'
     2	
     3	import { createClient } from '@/lib/supabase/server'
     4	import { createAdminClient } from '@/lib/supabase/admin'
     5	import { checkUserPermission } from '@/app/actions/rbac'
     6	import { logAuditEvent } from './audit'
     7	import { z } from 'zod'
     8	import { getErrorMessage } from '@/lib/errors'
     9	import { revalidatePath } from 'next/cache'
    10	import type { InvoiceVendor } from '@/types/invoices'
    11	import { parsePaymentTermsValue } from '@/lib/vendors/paymentTerms'
    12	import { VendorService } from '@/services/vendors' // Import the new service
    13	
    14	// Vendor validation schema
    15	const VendorSchema = z.object({
    16	  name: z.string().min(1, 'Company name is required'),
    17	  contact_name: z.string().optional().or(z.literal('')),
    18	  email: z.string().email('Invalid email format').optional().or(z.literal('')),
    19	  phone: z.string().optional().or(z.literal('')),
    20	  address: z.string().optional().or(z.literal('')),
 succeeded in 51ms:
     1	'use server'
     2	
     3	import { createClient } from '@/lib/supabase/server'
     4	import { checkUserPermission } from '@/app/actions/rbac'
     5	import { revalidatePath } from 'next/cache'
     6	import { z } from 'zod'
     7	
     8	const ContactSchema = z.object({
     9	  vendorId: z.string().uuid('Invalid vendor ID'),
    10	  name: z.string().optional(),
    11	  email: z.string().email('Invalid email address'),
    12	  phone: z.string().optional(),
    13	  role: z.string().optional(),
    14	  isPrimary: z.coerce.boolean().optional(),
    15	  receiveInvoiceCopy: z.coerce.boolean().optional(),
    16	})
    17	
    18	export async function getVendorContacts(vendorId: string) {
    19	  const hasPermission = await checkUserPermission('invoices', 'view')
    20	  if (!hasPermission) return { error: 'Insufficient permissions' }
codex
There’s also a statement-mode accounting gap in the current billing cron: one-off charges are included in cap selection and in `computeStatementBalanceBefore`, but they disappear from `buildStatementNotes`. I’m confirming whether that’s just the note text or whether it changes the billed balance math too.
exec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '420,520p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '1110,1218p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '1218,1265p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '1476,1505p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 50ms:
   420	        if (cfOneOff.length > 0) lines.push(`- One-off charges: £${roundMoney(oneOffIncVat).toFixed(2)} (${cfOneOff.length} items)`)
   421	        if (cfMileage.length > 0) lines.push(`- Mileage: £${roundMoney(mileageIncVat).toFixed(2)} (${mileageMiles.toFixed(2)} miles)`)
   422	        if (cfTime.length > 0) lines.push(`- Time: £${roundMoney(timeIncVat).toFixed(2)} (${(timeMinutes / 60).toFixed(2)} hours)`)
   423	      }
   424	    }
   425	  }
   426	
   427	  return lines.join('\n')
   428	}
   429	
   430	function getEntryCharge(entry: any, settings: any) {
   431	  const entryType = String(entry?.entry_type || '')
   432	  if (entryType === 'mileage') {
   433	    const miles = Number(entry.miles || 0)
   434	    const rate = Number(entry.mileage_rate_snapshot || settings?.mileage_rate || 0.42)
   435	    const exVat = roundMoney(miles * rate)
   436	    const vatRate = 0
   437	    const incVat = roundMoney(exVat)
   438	    return { exVat, vatRate, incVat }
   439	  }
 succeeded in 52ms:
  1110	      guard += 1
  1111	    }
  1112	  }
  1113	
  1114	  return { lineItems: input.lineItems, totals }
  1115	}
  1116	
  1117	function buildStatementLineItems(input: {
  1118	  selectedRecurringInstances: any[]
  1119	  selectedMileageEntries: any[]
  1120	  selectedTimeEntries: any[]
  1121	  selectedOneOffEntries?: any[]
  1122	  settings: any
  1123	}) {
  1124	  const vatGroups = new Map<number, number>()
  1125	  const addGroup = (vatRate: number, exVat: number) => {
  1126	    if (!Number.isFinite(exVat) || exVat <= 0) return
  1127	    const key = Number(vatRate || 0)
  1128	    vatGroups.set(key, roundMoney((vatGroups.get(key) || 0) + exVat))
  1129	  }
 succeeded in 52ms:
  1218	    const projectLabel = e?.project?.project_code
  1219	      ? `${e.project.project_code} — ${e.project.project_name || 'Project'}`
  1220	      : e?.project?.project_name || 'Project'
  1221	    const desc = e.description ? ` — ${String(e.description).replace(/\s+/g, ' ').trim()}` : ''
  1222	    lineItems.push({
  1223	      catalog_item_id: null,
  1224	      description: `${projectLabel}${desc}`,
  1225	      quantity: 1,
  1226	      unit_price: exVat,
  1227	      discount_percentage: 0,
  1228	      vat_rate: vatRate,
  1229	    })
  1230	  }
  1231	
  1232	  const selectedMileage = input.selectedMileageEntries || []
  1233	  if (selectedMileage.length > 0) {
  1234	    const totalMiles = selectedMileage.reduce((acc: number, e: any) => acc + Number(e.miles || 0), 0)
  1235	    const rateSet = new Set(selectedMileage.map((e: any) => Number(e.mileage_rate_snapshot || input.settings?.mileage_rate || 0.42)))
  1236	    if (rateSet.size === 1) {
  1237	      const rate = [...rateSet][0]
 succeeded in 50ms:
  1476	
  1477	  let statementBalanceBefore: number | null = null
  1478	  if (statementMode && billingMode === 'cap' && capIncVat != null && capIncVat > 0) {
  1479	    const summary = await computeStatementBalanceBefore({
  1480	      supabase,
  1481	      vendorId,
  1482	      settings,
  1483	      selectedRecurringInstances,
  1484	      skippedRecurringInstances,
  1485	      selectedMileageEntries: selectedMileage,
  1486	      skippedMileageEntries: skippedMileage,
  1487	      selectedTimeEntries: selectedTime,
  1488	      skippedTimeEntries: skippedTime,
  1489	      selectedOneOffEntries: selectedOneOff,
  1490	      skippedOneOffEntries: skippedOneOff,
  1491	    })
  1492	    statementBalanceBefore = summary.balanceBefore
  1493	  }
  1494	
  1495	  const carriedForwardIncVat =
codex
I’ve got the key divergence on invoice voiding: the database supports a `void` status value, but the current app path treats void as a normal status update gated by `invoices:edit`, and it explicitly warns that linked OJ items will not be reverted. I’m pulling the exact schema lines for that next, because it’s the clearest mismatch against the spec’s proposed permission and reversal model.
exec
/bin/zsh -lc "nl -ba src/app/actions/invoices.ts | sed -n '1,280p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/lib/status-transitions.ts | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"voided_at|void_reason|void_reason|credit_notes|credit_note|created_by|voidInvoice|createCreditNote|statement|documentKind: 'credit_note'|documentKind: 'remittance_advice'|sendRemittanceAdviceForPaidInvoice|sendPaymentReceipt\" src supabase/migrations/20251123120000_squashed.sql docs/superpowers/specs/2026-04-14-oj-projects-review-design.md" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 50ms:
     1	'use server'
     2	
     3	import { createClient } from '@/lib/supabase/server'
     4	import { createAdminClient } from '@/lib/supabase/admin'
     5	import { checkUserPermission } from '@/app/actions/rbac'
     6	import { logAuditEvent } from './audit'
     7	import { isGraphConfigured, sendInvoiceEmail } from '@/lib/microsoft-graph'
     8	import { z } from 'zod'
     9	import { getErrorMessage } from '@/lib/errors'
    10	import { revalidatePath, revalidateTag } from 'next/cache'
    11	import type {
    12	  Invoice,
    13	  InvoiceWithDetails,
    14	  InvoiceStatus,
    15	  InvoiceLineItemInput,
    16	  LineItemCatalogItem
    17	} from '@/types/invoices'
    18	import { InvoiceService, CreateInvoiceSchema } from '@/services/invoices'
    19	
    20	const CONTACT_NAME = process.env.COMPANY_CONTACT_NAME || 'Peter Pitcher'
 succeeded in 51ms:
     1	import type { InvoiceStatus, QuoteStatus } from '@/types/invoices'
     2	
     3	const ALLOWED_INVOICE_STATUS_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
     4	  draft: ['draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void', 'written_off'],
     5	  sent: ['sent', 'partially_paid', 'paid', 'overdue', 'void', 'written_off'],
     6	  partially_paid: ['partially_paid', 'paid', 'overdue', 'void', 'written_off'],
     7	  overdue: ['overdue', 'sent', 'partially_paid', 'paid', 'void', 'written_off'],
     8	  paid: ['paid'],
     9	  void: ['void'],
    10	  written_off: ['written_off'],
    11	}
    12	
    13	const ALLOWED_QUOTE_STATUS_TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
    14	  draft: ['draft', 'sent', 'accepted', 'rejected', 'expired'],
    15	  sent: ['sent', 'accepted', 'rejected', 'expired'],
    16	  accepted: ['accepted'],
    17	  rejected: ['rejected'],
    18	  expired: ['expired', 'sent', 'accepted', 'rejected'],
    19	}
    20	
 succeeded in 51ms:
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:14:2. **Client statement** — running account statement (PDF + email) showing invoices, payments, credits, and balance over a date range
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:16:4. **Completeness recommendations** — payment history on project detail, billing cron alerting, statement mode UI clarity, void/credit note support
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:88:No new tables. The statement is a read-time aggregation:
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:103:**File:** `src/app/actions/oj-projects/client-statement.ts`
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:133:**File:** `src/lib/oj-statement.ts`
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:152:- Preview of statement data (table format)
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:162:- **Body:** Short cover note: "Please find attached your account statement for the period {from} to {to}. Current balance: £{closingBalance}."
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:163:- **Attachment:** Statement PDF (named `statement-{vendor-code}-{from}-{to}.pdf`)
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:175:3. If yes, calls `sendRemittanceAdviceForPaidInvoice()` which:
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:176:   - Generates receipt PDF via `generateInvoicePDF()` with `documentKind: 'remittance_advice'`
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:184:Extend the condition that triggers `sendRemittanceAdviceForPaidInvoice()`:
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:188:**Rename function** to `sendPaymentReceipt()` (more accurate for both cases).
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:195:- The existing compact invoice template already has conditional rendering for `documentKind: 'remittance_advice'` and includes an "outstanding balance" field
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:231:Add explanatory text next to the `statement_mode` toggle:
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:232:- Tooltip or help text: "When enabled, monthly invoices show a running balance statement with opening balance, charges, and closing balance — rather than itemised time entries. Best for clients on a monthly retainer or cap arrangement."
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:233:- Visual indicator when statement mode is active (e.g. badge on the client card)
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:240:- Add `voidInvoice(invoiceId, reason)` server action in `src/app/actions/invoices.ts`
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:244:- Voided invoices appear on the client statement as a credit entry (negative debit)
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:248:- New `credit_notes` table: `id`, `invoice_id` (optional — can be standalone), `vendor_id`, `amount`, `reason`, `created_at`, `created_by`
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:249:- Server action: `createCreditNote(vendorId, amount, reason, invoiceId?)`
exec
/bin/zsh -lc "nl -ba src/services/invoices.ts | sed -n '290,380p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"InvoiceService.getInvoiceById\\(|from\\('invoices'\\)\\.select\\(|payments\\(|invoice_payments\" src/services/invoices.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/lib/invoice-template-compact.ts | sed -n '520,620p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"sendRemittanceAdviceForPaidInvoice\\(|latestPayment|paymentAmount = latestPayment|payment_date \\|\\| a\\.created_at|paymentReference\" src/app/actions/invoices.ts src/lib/invoice-template-compact.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
343:        payments:invoice_payments(*)
 succeeded in 51ms:
   520	      <tbody>
   521	        ${invoice.line_items?.map(item => `
   522	          <tr>
   523	            <td>
   524	              <div class="item-description">${item.description}</div>
   525	              ${hasDiscounts && item.discount_percentage > 0 ? `<div class="item-line-discount">Line discount: ${item.discount_percentage}%</div>` : ''}
   526	            </td>
   527	            <td class="text-right">${item.quantity}</td>
   528	            <td class="text-right">${formatCurrency(item.unit_price)}</td>
   529	            ${hasDiscounts ? `<td class="text-right">${item.discount_percentage || 0}%</td>` : ''}
   530	            <td class="text-right">${item.vat_rate}%</td>
   531	            <td class="text-right">${formatCurrency(calculateLineTotal(item))}</td>
   532	          </tr>
   533	        `).join('') || ''}
   534	      </tbody>
   535	    </table>
   536	
   537	    <div class="summary-section">
   538	      <div class="summary-row">
   539	        <span>Subtotal</span>
 succeeded in 51ms:
   290	    } else if (status) {
   291	      query = query.eq('status', status);
   292	    }
   293	
   294	    if (search) {
   295	      const searchTerm = sanitizeInvoiceSearch(search);
   296	      if (searchTerm.length > 0) {
   297	        query = query.or(`invoice_number.ilike.%${searchTerm}%,reference.ilike.%${searchTerm}%`);
   298	      }
   299	    }
   300	
   301	    const from = (page - 1) * limit;
   302	    const to = from + limit - 1;
   303	
   304	    query = query
   305	      .order('invoice_date', { ascending: false })
   306	      .range(from, to);
   307	
   308	    const { data: invoices, error, count } = await query;
   309	
 succeeded in 51ms:
src/lib/invoice-template-compact.ts:14:  paymentReference?: string | null
src/lib/invoice-template-compact.ts:136:  const latestPayment = (invoice.payments || [])
src/lib/invoice-template-compact.ts:139:      const aDate = new Date(a.payment_date || a.created_at || 0).getTime()
src/lib/invoice-template-compact.ts:144:  const remittancePaymentAmount = remittance?.paymentAmount ?? latestPayment?.amount ?? invoice.paid_amount
src/lib/invoice-template-compact.ts:145:  const remittancePaymentDate = remittance?.paymentDate ?? latestPayment?.payment_date ?? null
src/lib/invoice-template-compact.ts:146:  const remittancePaymentMethod = remittance?.paymentMethod ?? latestPayment?.payment_method ?? null
src/lib/invoice-template-compact.ts:148:    remittance?.paymentReference ?? latestPayment?.reference ?? invoice.reference ?? null
src/app/actions/invoices.ts:112:async function sendRemittanceAdviceForPaidInvoice(
src/app/actions/invoices.ts:163:  const latestPayment = (invoice.payments || [])
src/app/actions/invoices.ts:166:      const aDate = new Date(a.payment_date || a.created_at || 0).getTime()
src/app/actions/invoices.ts:171:  const paymentAmount = latestPayment?.amount ?? invoice.paid_amount
src/app/actions/invoices.ts:172:  const paymentDate = formatDateForEmail(latestPayment?.payment_date || null)
src/app/actions/invoices.ts:173:  const paymentMethod = formatPaymentMethodForEmail(latestPayment?.payment_method || null)
src/app/actions/invoices.ts:190:${latestPayment?.reference ? `Reference: ${latestPayment.reference}` : ''}
src/app/actions/invoices.ts:209:        paymentDate: latestPayment?.payment_date || null,
src/app/actions/invoices.ts:211:        paymentMethod: latestPayment?.payment_method || null,
src/app/actions/invoices.ts:212:        paymentReference: latestPayment?.reference || null,
src/app/actions/invoices.ts:747:      remittanceAdvice = await sendRemittanceAdviceForPaidInvoice(invoiceId, user?.id || null)
exec
/bin/zsh -lc "nl -ba src/app/actions/oj-projects/entries.ts | sed -n '100,420p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"one_off|amount_ex_vat_snapshot|entry_type.*one_off|chk_oj_entries_time_fields|oj_entries\" supabase/migrations src/types/oj-projects.ts src/types/database.generated.ts | sed -n '1,240p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/types/oj-projects.ts | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
   100	    .maybeSingle()
   101	  return data?.name ? String(data.name) : null
   102	}
   103	
   104	export async function getEntries(options?: {
   105	  vendorId?: string
   106	  projectId?: string
   107	  status?: string
   108	  entryType?: string
   109	  startDate?: string
   110	  endDate?: string
   111	  limit?: number
   112	}) {
   113	  const hasPermission = await checkUserPermission('oj_projects', 'view')
   114	  if (!hasPermission) return { error: 'You do not have permission to view entries' }
   115	
   116	  const supabase = await createClient()
   117	  let query = supabase
   118	    .from('oj_entries')
   119	    .select(`
 succeeded in 52ms:
src/types/oj-projects.ts:3:export type OJEntryType = 'time' | 'mileage' | 'one_off'
src/types/oj-projects.ts:89:  amount_ex_vat_snapshot: number | null
src/types/database.generated.ts:5841:            referencedRelation: "oj_entries"
src/types/database.generated.ts:5912:      oj_entries: {
src/types/database.generated.ts:5914:          amount_ex_vat_snapshot: number | null
src/types/database.generated.ts:5942:          amount_ex_vat_snapshot?: number | null
src/types/database.generated.ts:5970:          amount_ex_vat_snapshot?: number | null
src/types/database.generated.ts:5999:            foreignKeyName: "oj_entries_billing_run_id_fkey"
src/types/database.generated.ts:6006:            foreignKeyName: "oj_entries_invoice_id_fkey"
src/types/database.generated.ts:6013:            foreignKeyName: "oj_entries_project_id_fkey"
src/types/database.generated.ts:6020:            foreignKeyName: "oj_entries_vendor_id_fkey"
src/types/database.generated.ts:6027:            foreignKeyName: "oj_entries_work_type_id_fkey"
src/types/database.generated.ts:6132:          amount_ex_vat_snapshot: number
src/types/database.generated.ts:6151:          amount_ex_vat_snapshot: number
src/types/database.generated.ts:6170:          amount_ex_vat_snapshot?: number
src/types/database.generated.ts:11195:            foreignKeyName: "oj_entries_project_id_fkey"
supabase/migrations/20260405130000_mileage_expenses_mgd.sql:83:  oj_entry_id UUID REFERENCES public.oj_entries(id) ON DELETE SET NULL,
supabase/migrations/20260226120000_oj_entries_one_off.sql:1:-- Add one_off entry type to oj_entries
supabase/migrations/20260226120000_oj_entries_one_off.sql:2:-- Adds amount_ex_vat_snapshot column and updates CHECK constraints
supabase/migrations/20260226120000_oj_entries_one_off.sql:5:ALTER TABLE public.oj_entries
 succeeded in 52ms:
     1	export type OJBillingMode = 'full' | 'cap'
     2	export type OJProjectStatus = 'active' | 'paused' | 'completed' | 'archived'
     3	export type OJEntryType = 'time' | 'mileage' | 'one_off'
     4	export type OJEntryStatus = 'unbilled' | 'billing_pending' | 'billed' | 'paid'
     5	
     6	export type OJWorkType = {
     7	  id: string
     8	  name: string
     9	  is_active: boolean
    10	  sort_order: number
    11	  created_at: string
    12	  updated_at: string
    13	}
    14	
    15	export type OJVendorBillingSettings = {
    16	  vendor_id: string
    17	  client_code: string | null
    18	  billing_mode: OJBillingMode
    19	  monthly_cap_inc_vat: number | null
    20	  hourly_rate_ex_vat: number
exec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '3400,3465p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"return NextResponse\\.json\\(|console\\.error\\(|throw new Error\\(|catch \\(error\" src/app/api/cron/oj-projects-billing/route.ts | tail -n 40" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
  3400	            {
  3401	              state: 'sent',
  3402	              invoice_id: invoiceId,
  3403	              billing_run_id: billingRun.id,
  3404	              sent_to: recipients.to
  3405	            },
  3406	            24 * 180
  3407	          )
  3408	          claimHeld = false
  3409	        } catch (persistError) {
  3410	          console.error('Failed to persist OJ billing invoice send idempotency response:', persistError)
  3411	        }
  3412	      }
  3413	
  3414	      results.sent++
  3415	      results.vendors.push({ vendor_id: vendorId, status: 'sent', invoice_id: invoiceId, invoice_number: invoiceNumber })
  3416	    } catch (err) {
  3417	      const message = err instanceof Error ? err.message : 'Unknown error'
  3418	      results.failed++
  3419	      results.vendors.push({ vendor_id: vendorId, status: 'failed', error: message })
 succeeded in 52ms:
1966:      console.error('Failed to load OJ billing entry vendors', entryVendorError)
1967:      return NextResponse.json({ error: 'Failed to load billing vendor candidates' }, { status: 500 })
1981:      console.error('Failed to load OJ billing recurring-charge vendors', chargeVendorError)
1982:      return NextResponse.json({ error: 'Failed to load billing vendor candidates' }, { status: 500 })
1997:      console.error('Failed to load OJ billing recurring-charge instance vendors', instanceVendorError)
1998:      return NextResponse.json({ error: 'Failed to load billing vendor candidates' }, { status: 500 })
2054:    return NextResponse.json({
2087:      if (vendorError || !vendor) throw new Error(vendorError?.message || 'Vendor not found')
2113:            throw new Error(createError.message || existingError?.message || 'Failed to create or load billing run')
2124:      if (!billingRun) throw new Error('Failed to initialise billing run')
2154:            throw new Error(`Failed to persist recovered invoice link on billing run: ${billingRunUpdateError.message}`)
2158:            throw new Error('Billing run not found while persisting recovered invoice link')
2166:        if ('error' in loaded) throw new Error(loaded.error)
2200:        if ('error' in recipients) throw new Error(recipients.error)
2201:        if (!recipients.to) throw new Error('No invoice recipient email configured (primary contact or vendor email)')
2281:          if (runEntriesError) throw new Error(runEntriesError.message)
2368:                console.error('Failed to release OJ billing invoice send claim:', releaseError)
2418:              console.error('Failed to persist OJ billing invoice send claim after send:', persistError)
2468:                console.error('Failed to persist OJ billing invoice send claim after status mismatch:', persistError)
2511:            console.error('Failed to write OJ billing invoice send log (to):', toLogError)
codex
The void/rebill risk looks less about the cron selecting rows twice and more about payment state. The invoices module allows `partially_paid -> void`, and nothing I’ve seen transfers existing `invoice_payments` to a replacement invoice. If the spec reopens OJ rows automatically, the next run can bill the same work again while the original cash stays attached to the voided invoice.
exec
/bin/zsh -lc "nl -ba src/lib/status-transitions.ts | sed -n '1,80p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/invoices.ts | sed -n '410,520p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/invoices.ts | sed -n '760,840p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/invoices.ts | sed -n '660,760p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/types/database.generated.ts | sed -n '3576,3615p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
     1	import type { InvoiceStatus, QuoteStatus } from '@/types/invoices'
     2	
     3	const ALLOWED_INVOICE_STATUS_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
     4	  draft: ['draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void', 'written_off'],
     5	  sent: ['sent', 'partially_paid', 'paid', 'overdue', 'void', 'written_off'],
     6	  partially_paid: ['partially_paid', 'paid', 'overdue', 'void', 'written_off'],
     7	  overdue: ['overdue', 'sent', 'partially_paid', 'paid', 'void', 'written_off'],
     8	  paid: ['paid'],
     9	  void: ['void'],
    10	  written_off: ['written_off'],
    11	}
    12	
    13	const ALLOWED_QUOTE_STATUS_TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
    14	  draft: ['draft', 'sent', 'accepted', 'rejected', 'expired'],
    15	  sent: ['sent', 'accepted', 'rejected', 'expired'],
    16	  accepted: ['accepted'],
    17	  rejected: ['rejected'],
    18	  expired: ['expired', 'sent', 'accepted', 'rejected'],
    19	}
    20	
 succeeded in 51ms:
   410	export async function updateInvoiceStatus(formData: FormData) {
   411	  try {
   412	    const supabase = await createClient()
   413	    const hasPermission = await checkUserPermission('invoices', 'edit')
   414	    if (!hasPermission) {
   415	      return { error: 'You do not have permission to update invoices' }
   416	    }
   417	
   418	    const invoiceId = formData.get('invoiceId') as string
   419	    const rawStatus = formData.get('status')
   420	    const force = String(formData.get('force') || '') === 'true'
   421	
   422	    if (!invoiceId || !rawStatus) {
   423	      return { error: 'Invoice ID and status are required' }
   424	    }
   425	
   426	    // Runtime validation: ensure status is a known InvoiceStatus value
   427	    const VALID_INVOICE_STATUSES: readonly InvoiceStatus[] = [
   428	      'draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void', 'written_off'
   429	    ] as const
 succeeded in 51ms:
   660	
   661	    revalidatePath('/invoices/catalog')
   662	    
   663	    return { success: true }
   664	  } catch (error: unknown) {
   665	    console.error('Error in deleteCatalogItem:', error)
   666	    return { error: getErrorMessage(error) }
   667	  }
   668	}
   669	
   670	export async function recordPayment(formData: FormData) {
   671	  try {
   672	    const supabase = await createClient()
   673	    const hasPermission = await checkUserPermission('invoices', 'edit')
   674	    if (!hasPermission) {
   675	      return { error: 'You do not have permission to record payments' }
   676	    }
   677	
   678	    const invoiceId = String(formData.get('invoiceId') || '').trim()
   679	    const paymentDate = String(formData.get('paymentDate') || '').trim()
 succeeded in 51ms:
   760	
   761	export async function updateInvoice(formData: FormData) {
   762	  try {
   763	    const hasPermission = await checkUserPermission('invoices', 'edit')
   764	    if (!hasPermission) {
   765	      return { error: 'You do not have permission to edit invoices' }
   766	    }
   767	
   768	    const invoiceId = formData.get('invoiceId') as string
   769	    if (!invoiceId) {
   770	      return { error: 'Invoice ID is required' }
   771	    }
   772	
   773	    // Check if invoice exists and is draft
   774	    const supabase = await createClient()
   775	    const [{ data: { user } }, { data: existingInvoice, error: fetchError }] = await Promise.all([
   776	      supabase.auth.getUser(),
   777	      supabase
   778	        .from('invoices')
   779	        .select('id, status')
 succeeded in 51ms:
  3576	      }
  3577	      invoice_payments: {
  3578	        Row: {
  3579	          amount: number
  3580	          created_at: string | null
  3581	          id: string
  3582	          invoice_id: string
  3583	          notes: string | null
  3584	          payment_date: string
  3585	          payment_method: string | null
  3586	          reference: string | null
  3587	        }
  3588	        Insert: {
  3589	          amount: number
  3590	          created_at?: string | null
  3591	          id?: string
  3592	          invoice_id: string
  3593	          notes?: string | null
  3594	          payment_date?: string
  3595	          payment_method?: string | null
codex
I also found that the OJ schema has moved past the original core migration: `oj_entries` now supports `one_off` entries in later migrations. That matters mainly because the spec’s statement/void work assumes those charge types exist; I’ll keep the final comparison focused on auth/RLS, but I’ll note where the spec is already stale versus the current schema.
exec
/bin/zsh -lc "nl -ba supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql | sed -n '1,120p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba supabase/migrations/20260226120000_oj_entries_one_off.sql | sed -n '1,120p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"statement_mode|receives_statements|credit_note|statement\" supabase/migrations src/app/actions/oj-projects src/app/actions/email.ts src/app/actions/invoices.ts src/lib -g '"'!src/types/database.generated.ts'"' | sed -n '1,240p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
     1	-- Relax oj_entries CHECK constraint to allow NULL start_at/end_at for time entries.
     2	-- Previously time entries required start_at and end_at. Going forward, only
     3	-- duration_minutes_rounded is required; timestamps are optional (preserved for
     4	-- historical entries only).
     5	--
     6	-- Only the 'time' branch changes. Mileage and one_off branches are identical to
     7	-- the constraint set in 20260226120000_oj_entries_one_off.sql.
     8	
     9	ALTER TABLE public.oj_entries
    10	  DROP CONSTRAINT IF EXISTS chk_oj_entries_time_fields;
    11	
    12	ALTER TABLE public.oj_entries
    13	  ADD CONSTRAINT chk_oj_entries_time_fields
    14	  CHECK (
    15	    (
    16	      entry_type = 'time'
    17	      AND duration_minutes_rounded IS NOT NULL
    18	      AND miles IS NULL
    19	      AND (start_at IS NULL) = (end_at IS NULL)  -- both set or both NULL, never partial
    20	    )
 succeeded in 51ms:
     1	-- Add one_off entry type to oj_entries
     2	-- Adds amount_ex_vat_snapshot column and updates CHECK constraints
     3	
     4	-- 1. Add the new column
     5	ALTER TABLE public.oj_entries
     6	  ADD COLUMN IF NOT EXISTS amount_ex_vat_snapshot NUMERIC(10,2) DEFAULT NULL;
     7	
     8	-- 2. Drop and recreate the entry_type check constraint to include 'one_off'
     9	ALTER TABLE public.oj_entries
    10	  DROP CONSTRAINT IF EXISTS oj_entries_entry_type_check;
    11	
    12	ALTER TABLE public.oj_entries
    13	  ADD CONSTRAINT oj_entries_entry_type_check
    14	  CHECK (entry_type IN ('time', 'mileage', 'one_off'));
    15	
    16	-- 3. Drop and recreate the time-fields check to allow one_off entries
    17	--    (one_off entries have no start_at, end_at, duration, or miles)
    18	ALTER TABLE public.oj_entries
    19	  DROP CONSTRAINT IF EXISTS chk_oj_entries_time_fields;
    20	
 succeeded in 52ms:
src/app/actions/oj-projects/vendor-settings.ts:16:  statement_mode: z.boolean().optional(),
src/app/actions/oj-projects/vendor-settings.ts:47:    statement_mode: formData.get('statement_mode') === 'on' || formData.get('statement_mode') === 'true',
src/app/actions/oj-projects/vendor-settings.ts:75:        statement_mode: parsed.data.statement_mode ?? false,
supabase/migrations/20260425100000_fix_employee_attachments_storage_bucket.sql:42:-- NOTE: The actual trigger name has a _trigger suffix. This statement used the
supabase/migrations/20251123120000_squashed.sql:13:SET statement_timeout = 0;
supabase/migrations/20251123120000_squashed.sql:12050:    CONSTRAINT invoice_emails_email_type_check CHECK (((email_type)::text = ANY ((ARRAY['new_invoice'::character varying, 'reminder'::character varying, 'chase'::character varying, 'credit_note'::character varying, 'statement'::character varying, 'quote'::character varying])::text[]))),
supabase/migrations/20251123120000_squashed.sql:13299:-- 3. Receipt batches capture each bank statement import
supabase/migrations/20251123120000_squashed.sql:13456:    VALUES ('receipts', 'view', 'View bank statement receipts workspace');
supabase/migrations/20260509000012_fix_event_reservation_remove_card_capture_refs.sql:20:--   • Removes card_capture_required from both UPDATE statements
supabase/migrations/20260509000011_fix_core_legacy_remove_card_capture_column.sql:8:--   INSERT statement, which includes the column card_capture_required.  That
supabase/migrations/20260203090000_add_statement_mode_to_oj_vendor_billing_settings.sql:2:  ADD COLUMN IF NOT EXISTS statement_mode boolean NOT NULL DEFAULT false;
codex
There’s one more permission boundary to verify: the spec says `getClientStatement` only needs `oj_projects:view`, but the underlying invoice tables appear to have their own `invoices:*` RLS. If that’s true, a server action using `createClient()` will either fail for OJ-only users or switch to service-role access, which raises the scoping bar again.
codex
The main unresolved enforcement question is the invoice RPC surface. The SQL functions that create invoices and record payments do not call `user_has_permission(...)` internally, so the DB guarantee depends entirely on execute privileges. I’m checking for any global `REVOKE/GRANT EXECUTE` statements in migrations before I call that a true gap.
exec
/bin/zsh -lc "nl -ba src/app/actions/oj-projects/client-balance.ts | sed -n '32,110p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/(authenticated)/oj-projects/clients/page.tsx | sed -n '80,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"user_has_permission\\(auth.uid\\(\\), 'invoices'|Users with invoices view permission can view invoices|invoice_payments\" supabase/migrations/20251123120000_squashed.sql | sed -n '1,120p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba supabase/migrations/20251123120000_squashed.sql | sed -n '15380,15520p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/rbac.ts | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/lib/supabase/admin.ts | sed -n '1,180p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
    32	export async function getClientBalance(
    33	  vendorId: string
    34	): Promise<{ balance?: ClientBalance; error?: string }> {
    35	  const hasPermission = await checkUserPermission('oj_projects', 'view')
    36	  if (!hasPermission) return { error: 'You do not have permission to view OJ Projects data' }
    37	
    38	  const supabase = await createClient()
    39	
    40	  // Fetch all OJ Projects invoices for this vendor (most recent first, up to 50)
    41	  const { data: invoices, error: invoicesError } = await supabase
    42	    .from('invoices')
    43	    .select('id, invoice_number, invoice_date, due_date, reference, status, total_amount, paid_amount')
    44	    .eq('vendor_id', vendorId)
    45	    .is('deleted_at', null)
    46	    .ilike('reference', 'OJ Projects %')
    47	    .order('invoice_date', { ascending: false })
    48	    .limit(50)
    49	
    50	  if (invoicesError) return { error: invoicesError.message }
    51	
 succeeded in 51ms:
zsh:1: no matches found: src/app/(authenticated)/oj-projects/clients/page.tsx
 succeeded in 51ms:
11980:CREATE TABLE IF NOT EXISTS public.invoice_payments (
11989:    CONSTRAINT invoice_payments_payment_method_check CHECK (((payment_method)::text = ANY ((ARRAY['bank_transfer'::character varying, 'cash'::character varying, 'cheque'::character varying, 'card'::character varying, 'other'::character varying])::text[])))
14770:    OR public.user_has_permission(auth.uid(), 'invoices', 'view')
14777:    OR public.user_has_permission(auth.uid(), 'invoices', 'edit')
14781:    OR public.user_has_permission(auth.uid(), 'invoices', 'edit')
14788:    OR public.user_has_permission(auth.uid(), 'invoices', 'edit')
14795:    OR public.user_has_permission(auth.uid(), 'invoices', 'edit')
14808:    OR public.user_has_permission(auth.uid(), 'invoices', 'view')
14815:    OR public.user_has_permission(auth.uid(), 'invoices', 'edit')
14819:    OR public.user_has_permission(auth.uid(), 'invoices', 'edit')
15385:CREATE POLICY "Users with invoices view permission can view invoices" 
15476:ALTER TABLE "public"."invoice_payments" ENABLE ROW LEVEL SECURITY;
15480:ON "public"."invoice_payments" 
15489:ON "public"."invoice_payments" 
15498:ON "public"."invoice_payments" 
15510:ON "public"."invoice_payments" 
18259:  INSERT INTO invoice_payments (
18294:  FROM invoice_payments ip
 succeeded in 50ms:
 15380	
 15381	-- Ensure RLS is enabled
 15382	ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;
 15383	
 15384	-- View Policy
 15385	CREATE POLICY "Users with invoices view permission can view invoices" 
 15386	ON "public"."invoices" 
 15387	FOR SELECT 
 15388	TO "authenticated" 
 15389	USING (
 15390	  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'view')
 15391	);
 15392	
 15393	-- Create Policy
 15394	CREATE POLICY "Users with invoices create permission can create invoices" 
 15395	ON "public"."invoices" 
 15396	FOR INSERT 
 15397	TO "authenticated" 
 15398	WITH CHECK (
 15399	  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'create')
exec
/bin/zsh -lc "rg -n \"REVOKE EXECUTE ON FUNCTION|REVOKE EXECUTE ON ALL FUNCTIONS|ALTER DEFAULT PRIVILEGES.*FUNCTION|GRANT EXECUTE ON FUNCTION .* TO authenticated|GRANT EXECUTE ON FUNCTION .* TO public|GRANT EXECUTE ON ALL FUNCTIONS\" supabase/migrations/20251123120000_squashed.sql supabase/migrations | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
     1	'use server';
     2	
     3	import { createClient } from '@/lib/supabase/server';
     4	import { createAdminClient } from '@/lib/supabase/admin'; // Still needed for requirePermission helper
     5	import { revalidatePath } from 'next/cache';
     6	import { z } from 'zod'; // Zod still needed for form validation that's outside roleSchema
     7	import type { User as SupabaseUser } from '@supabase/supabase-js';
     8	import type { Role, Permission, UserPermission, ModuleName, ActionType } from '@/types/rbac';
     9	import { logAuditEvent } from './audit';
    10	import { PermissionService, roleSchema } from '@/services/permission'; // Import service and schema
    11	
    12	type PermissionCheckResult =
    13	  | { error: string }
    14	  | { user: SupabaseUser; admin: ReturnType<typeof createAdminClient> }; // Keep admin client for now, may be refactored away
    15	
    16	type UserSummary = Pick<SupabaseUser, 'id' | 'email' | 'created_at' | 'last_sign_in_at'>; // For getAllUsers result
    17	
    18	// This helper is kept in the action as it authenticates the user and then uses the service to check permissions.
    19	async function requirePermission(moduleName: ModuleName, action: ActionType): Promise<PermissionCheckResult> {
    20	  const supabase = await createClient();
 succeeded in 51ms:
     1	import { createClient as createSupabaseClient } from '@supabase/supabase-js';
     2	import { noStoreFetch } from '@/lib/supabase/no-store-fetch';
     3	
     4	export function createAdminClient() {
     5	  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
     6	  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
     7	
     8	  if (!supabaseUrl || !supabaseServiceRoleKey) {
     9	    throw new Error('Missing Supabase environment variables');
    10	  }
    11	
    12	  return createSupabaseClient(supabaseUrl, supabaseServiceRoleKey, {
    13	    auth: {
    14	      autoRefreshToken: false,
    15	      persistSession: false
    16	    },
    17	    global: {
    18	      fetch: noStoreFetch
    19	    }
    20	  });
 succeeded in 52ms:
supabase/migrations/20251123120000_squashed.sql:5911:ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "postgres";
supabase/migrations/20251123120000_squashed.sql:5912:ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "anon";
supabase/migrations/20251123120000_squashed.sql:5913:ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "authenticated";
supabase/migrations/20251123120000_squashed.sql:5914:ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "service_role";
supabase/migrations/20251123120000_squashed.sql:9521:    GRANT EXECUTE ON FUNCTION check_table_availability TO authenticated;
supabase/migrations/20251123120000_squashed.sql:9522:    GRANT EXECUTE ON FUNCTION generate_booking_reference TO authenticated;
supabase/migrations/20251123120000_squashed.sql:9523:    GRANT EXECUTE ON FUNCTION validate_booking_against_policy TO authenticated;
supabase/migrations/20251123120000_squashed.sql:9524:    GRANT EXECUTE ON FUNCTION calculate_refund_amount TO authenticated;
supabase/migrations/20251123120000_squashed.sql:13572:GRANT EXECUTE ON FUNCTION count_receipt_statuses() TO authenticated, service_role;
supabase/migrations/20251123120000_squashed.sql:5911:ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "postgres";
supabase/migrations/20251123120000_squashed.sql:5912:ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "anon";
supabase/migrations/20251123120000_squashed.sql:5913:ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "authenticated";
supabase/migrations/20251123120000_squashed.sql:5914:ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "service_role";
supabase/migrations/20251123120000_squashed.sql:9521:    GRANT EXECUTE ON FUNCTION check_table_availability TO authenticated;
supabase/migrations/20251123120000_squashed.sql:9522:    GRANT EXECUTE ON FUNCTION generate_booking_reference TO authenticated;
supabase/migrations/20251123120000_squashed.sql:9523:    GRANT EXECUTE ON FUNCTION validate_booking_against_policy TO authenticated;
supabase/migrations/20251123120000_squashed.sql:9524:    GRANT EXECUTE ON FUNCTION calculate_refund_amount TO authenticated;
supabase/migrations/20251123120000_squashed.sql:13572:GRANT EXECUTE ON FUNCTION count_receipt_statuses() TO authenticated, service_role;
supabase/migrations/20260517000000_fix_parking_toctou.sql:187:GRANT EXECUTE ON FUNCTION public.atomic_insert_parking_booking TO authenticated;
supabase/migrations/20260514000002_record_balance_payment_rpc.sql:71:GRANT EXECUTE ON FUNCTION public.record_balance_payment(UUID, NUMERIC, TEXT, UUID) TO authenticated;
exec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/oj-projects/clients/page.tsx' | sed -n '80,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
    80	}
    81	
    82	type ContactFormState = {
    83	  id?: string
    84	  name: string
    85	  email: string
    86	  phone: string
    87	  role: string
    88	  is_primary: boolean
    89	  receive_invoice_copy: boolean
    90	}
    91	
    92	export default function OJProjectsClientsPage() {
    93	  const router = useRouter()
    94	  const { hasPermission, loading: permissionsLoading } = usePermissions()
    95	
    96	  const canView = hasPermission('oj_projects', 'view')
    97	  const canEditSettings = hasPermission('oj_projects', 'edit')
    98	  const canCreateVendor = hasPermission('invoices', 'create')
    99	  const canEditContacts = hasPermission('invoices', 'edit')
exec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/oj-projects/clients/page.tsx' | sed -n '218,320p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
   218	  async function loadVendors() {
   219	    setLoading(true)
   220	    setError(null)
   221	    try {
   222	      const [res, emailRes] = await Promise.all([getVendors(), getOjProjectsEmailStatus()])
   223	
   224	      if (res.error || !res.vendors) throw new Error(res.error || 'Failed to load clients')
   225	      setVendors(res.vendors)
   226	      if (!vendorId && res.vendors.length > 0) {
   227	        setVendorId(res.vendors[0].id)
   228	      }
   229	
   230	      if (!emailRes.error) {
   231	        setEmailStatus({
   232	          configured: !!emailRes.configured,
   233	          senderEmail: emailRes.senderEmail ?? null,
   234	        })
   235	      } else {
   236	        setEmailStatus(null)
   237	      }
wait(call_KMbfh48qPPAH0ZxP7Rxgh8E0) timed out:
codex
I found the strongest database-level evidence so far: the squashed migration sets default privileges so new public-schema functions get `ALL` for both `anon` and `authenticated`. Combined with `SECURITY DEFINER` invoice RPCs that do not call `user_has_permission`, that means the payment/create RPCs are not visibly DB-gated by invoice RBAC in the migration layer. I’m checking whether there’s a corresponding table-default grant pattern too, to separate “RLS missing” from “not exposed anyway.”
exec
/bin/zsh -lc "nl -ba supabase/migrations/20251123120000_squashed.sql | sed -n '5890,5935p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"line_item_catalog\" supabase/migrations/20251123120000_squashed.sql | sed -n '1,120p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"ALTER DEFAULT PRIVILEGES.*TABLES|GRANT ALL ON TABLES|GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES|REVOKE ALL ON public\\.(invoice_vendors|invoice_email_logs|invoice_emails|invoice_audit|line_item_catalog)|GRANT .* ON public\\.(invoice_vendors|invoice_email_logs|invoice_emails|invoice_audit|line_item_catalog)\" supabase/migrations/20251123120000_squashed.sql" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
  5890	GRANT ALL ON TABLE "public"."webhook_logs" TO "authenticated";
  5891	GRANT ALL ON TABLE "public"."webhook_logs" TO "service_role";
  5892	
  5893	
  5894	
  5895	GRANT ALL ON TABLE "public"."webhooks" TO "anon";
  5896	GRANT ALL ON TABLE "public"."webhooks" TO "authenticated";
  5897	GRANT ALL ON TABLE "public"."webhooks" TO "service_role";
  5898	
  5899	
  5900	
  5901	ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "postgres";
  5902	ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "anon";
  5903	ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "authenticated";
  5904	ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "service_role";
  5905	
  5906	
  5907	
  5908	
  5909	
 succeeded in 51ms:

 succeeded in 50ms:
5921:ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "postgres";
5922:ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "anon";
5923:ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "authenticated";
5924:ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "service_role";
exec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '2230,2595p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
  2230	            status: 'sent',
  2231	            error_message: null,
  2232	            run_finished_at: new Date().toISOString(),
  2233	            updated_at: new Date().toISOString(),
  2234	          })
  2235	
  2236	          results.sent++
  2237	          results.vendors.push({ vendor_id: vendorId, status: 'sent', invoice_id: invoice.id, invoice_number: invoice.invoice_number })
  2238	          continue
  2239	        }
  2240	
  2241	        const subject = `Invoice ${invoice.invoice_number} from Orange Jelly Limited`
  2242	        const body = `Hi ${vendor.contact_name || vendor.name || 'there'},\n\nPlease find attached invoice ${invoice.invoice_number}.\n\nBest regards,\nPeter\nOrange Jelly Limited`
  2243	
  2244	        const shouldAttachTimesheet =
  2245	          String(invoice.internal_notes || '').includes(OJ_TIMESHEET_MARKER) ||
  2246	          String(invoice.notes || '').includes('Full breakdown attached as Timesheet PDF.')
  2247	
  2248	        let additionalAttachments: Array<{ name: string; contentType: string; buffer: Buffer }> | undefined
  2249	        if (shouldAttachTimesheet) {
codex
I have the main security picture now. I’m doing one last quick check on the auth gate for `recordPayment`, because the only way form tampering could redirect a receipt is by letting someone target an invoice they shouldn’t be able to edit in the first place.
exec
/bin/zsh -lc "rg -n \"export async function checkUserPermission|function checkUserPermission|checkUserPermission\\(\" src/app/actions/rbac.ts src/services/permission.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/rbac.ts | sed -n '1,180p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
src/services/permission.ts:101:  static async checkUserPermission(
src/services/permission.ts:124:      const hasPermission = await this.checkUserPermission('users', 'manage_roles', actingUserId);
src/app/actions/rbac.ts:31:  const hasPermission = await PermissionService.checkUserPermission(moduleName, action, user.id);
src/app/actions/rbac.ts:50:      const canManageUsers = await PermissionService.checkUserPermission('users', 'manage_roles', user.id);
src/app/actions/rbac.ts:64:export async function checkUserPermission(
src/app/actions/rbac.ts:72:    return await PermissionService.checkUserPermission(moduleName, action, userId);
src/app/actions/rbac.ts:80:  return await PermissionService.checkUserPermission(moduleName, action, user.id);
 succeeded in 52ms:
     1	'use server';
     2	
     3	import { createClient } from '@/lib/supabase/server';
     4	import { createAdminClient } from '@/lib/supabase/admin'; // Still needed for requirePermission helper
     5	import { revalidatePath } from 'next/cache';
     6	import { z } from 'zod'; // Zod still needed for form validation that's outside roleSchema
     7	import type { User as SupabaseUser } from '@supabase/supabase-js';
     8	import type { Role, Permission, UserPermission, ModuleName, ActionType } from '@/types/rbac';
     9	import { logAuditEvent } from './audit';
    10	import { PermissionService, roleSchema } from '@/services/permission'; // Import service and schema
    11	
    12	type PermissionCheckResult =
    13	  | { error: string }
    14	  | { user: SupabaseUser; admin: ReturnType<typeof createAdminClient> }; // Keep admin client for now, may be refactored away
    15	
    16	type UserSummary = Pick<SupabaseUser, 'id' | 'email' | 'created_at' | 'last_sign_in_at'>; // For getAllUsers result
    17	
    18	// This helper is kept in the action as it authenticates the user and then uses the service to check permissions.
    19	async function requirePermission(moduleName: ModuleName, action: ActionType): Promise<PermissionCheckResult> {
    20	  const supabase = await createClient();
collab send_input(call_jL4Y6Qnmfe20KGiqbV8rRWlF, prompt="Return your current findings now. Keep it concise and include only specific security risks with file paths and line refs…")
  receiver: 019d8b1c-4f3f-7392-991b-dc83fd896fb3
send_input(call_jL4Y6Qnmfe20KGiqbV8rRWlF, prompt="Return your current findings now. Keep it concise and include only specific security risks with file paths and line refs…") running:
  receiver: 019d8b1c-4f3f-7392-991b-dc83fd896fb3
task interrupted
collab send_input(call_l5laYxAW6jyJKvNq2GskQaSy, prompt="Return your current findings now. Keep it concise and include only specific security risks with file paths and line refs…")
  receiver: 019d8b1c-4f4a-7ac3-9ef3-438aec87587f
send_input(call_l5laYxAW6jyJKvNq2GskQaSy, prompt="Return your current findings now. Keep it concise and include only specific security risks with file paths and line refs…") running:
  receiver: 019d8b1c-4f4a-7ac3-9ef3-438aec87587f
task interrupted
collab send_input(call_Suz3sVF4TKSe4bkB1jvHsHp0, prompt="Return your current findings now. Keep it concise and include only specific security risks with file paths and line refs…")
  receiver: 019d8b1c-4f6f-7f81-83dc-8262d073557b
send_input(call_Suz3sVF4TKSe4bkB1jvHsHp0, prompt="Return your current findings now. Keep it concise and include only specific security risks with file paths and line refs…") running:
  receiver: 019d8b1c-4f6f-7f81-83dc-8262d073557b
task interrupted
codex
I’m switching to direct file inspection so I can pin every finding to concrete code and migration lines instead of waiting on the sub-agents.
exec
/bin/zsh -lc 'rg --files src/app/actions src/app/api/cron src/lib src/types supabase | rg "oj-projects|invoice|microsoft-graph|invoice-template|email|migration|sql|billing|receipt|payment|vendor|policy|rls|credit"' in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"oj-projects|oj_projects|invoice_payments|recordPayment|sendRemittanceAdviceForPaidInvoice|microsoft-graph|generatePDFFromHTML|renderToStaticMarkup|voidInvoice|credit note|credit_notes|statement_mode|RLS|ENABLE ROW LEVEL SECURITY|invoice_email_logs|sendEmail\\(|documentKind\" src supabase docs/superpowers/specs/2026-04-14-oj-projects-review-design.md" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
src/types/vendor.ts
src/types/invoices.ts
src/types/oj-projects.ts
supabase/sql-scripts/add_event_time_format_check.sql
supabase/sql-scripts/cleanup_event_reminders.sql
supabase/sql-scripts/cleanup_all_event_reminders.sql
supabase/sql-scripts/deactivate_legacy_message_templates.sql
supabase/sql-scripts/add_private_booking_cancellation_columns.sql
supabase/sql-scripts/check_booking_discount.sql
supabase/sql-scripts/add_reminder_logging.sql
supabase/sql-scripts/fix_reminder_timing_function.sql
supabase/sql-scripts/backfill_private_booking_messages.sql
supabase/sql-scripts/check_phone_formats.sql
supabase/sql-scripts/add_reminder_guardrails.sql
supabase/sql-scripts/verify_reminder_system_health.sql
supabase/sql-scripts/debug_reminder_system.sql
supabase/verify-migrations.sh
supabase/migrations-backup/20250714144905_add_pending_bookings.sql
supabase/migrations-backup/20250113155500_add_loyalty_access_token.sql
supabase/migrations-backup/20250719190000_add_sunday_lunch_menu_items.sql
 succeeded in 52ms:
Total output lines: 937

docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:16:4. **Completeness recommendations** — payment history on project detail, billing cron alerting, statement mode UI clarity, void/credit note support
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:40:**Problem:** `src/app/actions/oj-projects/client-balance.ts` only sums unbilled `time` and `mileage` entries. Unbilled `one_off` entries with `amount_ex_vat_snapshot` are excluded from `unbilledTotal`.
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:48:**Fix:** Add `OJRecurringChargeInstance` interface to `src/types/oj-projects.ts` matching the DB schema:
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:78:**Problem:** `deriveClientCode()` is duplicated identically in `src/app/actions/oj-projects/projects.ts` and `src/app/api/cron/oj-projects-retainer-projects/route.ts`.
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:80:**Fix:** Extract to `src/lib/oj-projects/utils.ts`. Import from both locations. Single source of truth.
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:92:- `invoice_payments` — all payments against those invoices
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:93:- Future: credit notes (Phase 4.4)
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:103:**File:** `src/app/actions/oj-projects/client-statement.ts`
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:129:**Permissions:** Requires `oj_projects` + `view` permission.
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:135:Uses `generatePDFFromHTML()` (same Puppeteer pipeline as invoices/timesheets).
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:148:**Location:** `src/app/(authenticated)/oj-projects/clients/page.tsx`
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:158:Uses `sendEmail()` from `src/lib/email/emailService.ts`.
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:164:- **Audit:** Log to `invoice_email_logs` with appropriate type
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:172:In `src/app/actions/invoices.ts`, `recordPayment()`:
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:173:1. Calls `InvoiceService.recordPayment()` to persist the payment
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:175:3. If yes, calls `sendRemittanceAdviceForPaidInvoice()` which:
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:176:   - Generates receipt PDF via `generateInvoicePDF()` with `documentKind: 'remittance_advice'`
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:182:**In `recordPayment()` (`src/app/actions/invoices.ts`):**
codex
I’ve narrowed the file set. Now I’m pulling the exact action implementations and migration policy blocks so the review can cite the current behavior, not the design intent.
exec
/bin/zsh -lc "nl -ba src/app/actions/invoices.ts | sed -n '1,340p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/invoices.ts | sed -n '340,860p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/lib/microsoft-graph.ts | sed -n '1,360p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '1,420p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
   340	    const { data: { user } } = await supabase.auth.getUser()
   341	    if (!user) return { error: 'Unauthorized' }
   342	
   343	    // Parse and validate form data
   344	    const validatedData = CreateInvoiceSchema.parse({
   345	      vendor_id: formData.get('vendor_id'),
   346	      invoice_date: formData.get('invoice_date'),
   347	      due_date: formData.get('due_date'),
   348	      reference: formData.get('reference') || undefined,
   349	      invoice_discount_percentage: parseFloat(formData.get('invoice_discount_percentage') as string) || 0,
   350	      notes: formData.get('notes') || undefined,
   351	      internal_notes: formData.get('internal_notes') || undefined
   352	    })
   353	
   354	    // Parse line items
   355	    const lineItemsJson = formData.get('line_items') as string
   356	    if (!lineItemsJson) {
   357	      return { error: 'Line items are required' }
   358	    }
   359	
 succeeded in 52ms:
     1	'use server'
     2	
     3	import { createClient } from '@/lib/supabase/server'
     4	import { createAdminClient } from '@/lib/supabase/admin'
     5	import { checkUserPermission } from '@/app/actions/rbac'
     6	import { logAuditEvent } from './audit'
     7	import { isGraphConfigured, sendInvoiceEmail } from '@/lib/microsoft-graph'
     8	import { z } from 'zod'
     9	import { getErrorMessage } from '@/lib/errors'
    10	import { revalidatePath, revalidateTag } from 'next/cache'
    11	import type {
    12	  Invoice,
    13	  InvoiceWithDetails,
    14	  InvoiceStatus,
    15	  InvoiceLineItemInput,
    16	  LineItemCatalogItem
    17	} from '@/types/invoices'
    18	import { InvoiceService, CreateInvoiceSchema } from '@/services/invoices'
    19	
    20	const CONTACT_NAME = process.env.COMPANY_CONTACT_NAME || 'Peter Pitcher'
 succeeded in 51ms:
     1	// import { Client } from '@microsoft/microsoft-graph-client'
     2	// import { ClientSecretCredential } from '@azure/identity'
     3	import type { InvoiceWithDetails, QuoteWithDetails } from '@/types/invoices'
     4	import { generateInvoicePDF, generateQuotePDF } from '@/lib/pdf-generator'
     5	import type { InvoiceDocumentKind, InvoiceRemittanceDetails } from '@/lib/invoice-template-compact'
     6	import { getErrorMessage, getErrorStatusCode } from '@/lib/errors'
     7	
     8	const CONTACT_NAME = process.env.COMPANY_CONTACT_NAME || 'Peter Pitcher'
     9	const CONTACT_PHONE = process.env.COMPANY_CONTACT_PHONE || '07995087315'
    10	
    11	// Initialize Microsoft Graph client
    12	async function getGraphClient() {
    13	  // Check if Graph is configured
    14	  if (!isGraphConfigured()) {
    15	    throw new Error('Microsoft Graph is not configured. Please check environment variables.')
    16	  }
    17	
    18	  const { Client } = await import('@microsoft/microsoft-graph-client')
    19	  const { ClientSecretCredential } = await import('@azure/identity')
    20	
 succeeded in 51ms:
     1	import { NextResponse } from 'next/server'
     2	import { authorizeCronRequest } from '@/lib/cron-auth'
     3	import { createAdminClient } from '@/lib/supabase/admin'
     4	import { calculateInvoiceTotals, type InvoiceTotalsResult } from '@/lib/invoiceCalculations'
     5	import { isGraphConfigured, sendInvoiceEmail } from '@/lib/microsoft-graph'
     6	import { resolveVendorInvoiceRecipients } from '@/lib/invoice-recipients'
     7	import { generateOjTimesheetPDF } from '@/lib/oj-timesheet'
     8	import { formatInTimeZone } from 'date-fns-tz'
     9	import type { InvoiceWithDetails } from '@/types/invoices'
    10	import {
    11	  claimIdempotencyKey,
    12	  computeIdempotencyRequestHash,
    13	  persistIdempotencyResponse,
    14	  releaseIdempotencyClaim
    15	} from '@/lib/api/idempotency'
    16	
    17	export const runtime = 'nodejs'
    18	export const dynamic = 'force-dynamic'
    19	export const maxDuration = 300
    20	
exec
/bin/zsh -lc "nl -ba src/lib/invoice-recipients.ts | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"sendEmail\\(|alert|error|failed|success|sendInvoiceEmail|resolveVendorInvoiceRecipients|statement_mode|void|credit|invoice_email_logs|vendor_id|invoice_vendor_contacts\" src/app/api/cron/oj-projects-billing/route.ts src/lib/invoice-recipients.ts src/services/invoices.ts src/lib/pdf-generator.ts src/lib/invoice-template-compact.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/lib/invoice-template-compact.ts | sed -n '1,340p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/services/invoices.ts | sed -n '1,460p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/lib/pdf-generator.ts | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 50ms:
     1	import type { SupabaseClient } from '@supabase/supabase-js'
     2	
     3	type GenericClient = SupabaseClient<any, 'public', any>
     4	
     5	type InvoiceVendorContact = {
     6	  email: string
     7	  isPrimary: boolean
     8	  receiveInvoiceCopy: boolean
     9	}
    10	
    11	export function parseRecipientList(raw: string | null | undefined): string[] {
    12	  if (!raw) return []
    13	
    14	  return dedupeRecipients(
    15	    String(raw)
    16	      .split(/[;,]/)
    17	      .map((value) => value.trim())
    18	      .filter((value) => isEmailLike(value))
    19	  )
    20	}
 succeeded in 51ms:
src/lib/invoice-template-compact.ts:190:      .keep-together { page-break-inside: avoid; }
src/lib/invoice-template-compact.ts:364:      page-break-inside: avoid;
src/lib/invoice-template-compact.ts:389:      page-break-inside: avoid;
src/lib/invoice-template-compact.ts:421:      page-break-inside: avoid;
src/lib/pdf-generator.ts:20:  close: () => Promise<void>
src/lib/pdf-generator.ts:25:  setViewport: (viewport: { width: number; height: number }) => Promise<void>
src/lib/pdf-generator.ts:29:  ) => Promise<void>
src/lib/pdf-generator.ts:30:  addStyleTag: (options: { content: string }) => Promise<void>
src/lib/pdf-generator.ts:32:  close: () => Promise<void>
src/lib/pdf-generator.ts:69:export async function closePdfBrowser(browser: PdfGeneratorBrowser): Promise<void> {
src/lib/pdf-generator.ts:76:      // Ignore cleanup errors
src/lib/pdf-generator.ts:81:async function closePdfPage(page: PdfGeneratorPage): Promise<void> {
src/lib/pdf-generator.ts:85:    // Ignore cleanup errors
src/lib/pdf-generator.ts:169:  } catch (error) {
src/lib/pdf-generator.ts:170:    console.error('Error generating invoice PDF:', error)
src/lib/pdf-generator.ts:213:  } catch (error) {
src/lib/pdf-generator.ts:214:    console.error('Error generating quote PDF:', error)
src/lib/pdf-generator.ts:249:  } catch (error) {
src/lib/pdf-generator.ts:250:    console.error('Error generating PDF from HTML:', error)
src/services/invoices.ts:21:  vendor_id: z.string().uuid('Invalid vendor ID'),
 succeeded in 50ms:
     1	// import type { PDFOptions } from 'puppeteer'
     2	import type { ChildProcess } from 'node:child_process'
     3	import {
     4	  generateCompactInvoiceHTML,
     5	  type InvoiceDocumentKind,
     6	  type InvoiceRemittanceDetails
     7	} from './invoice-template-compact'
     8	import { generateCompactQuoteHTML } from './quote-template-compact'
     9	import type { InvoiceWithDetails, QuoteWithDetails } from '@/types/invoices'
    10	
    11	// Helper to load puppeteer deps dynamically
    12	async function loadPuppeteer() {
    13	  const puppeteer = (await import('puppeteer')).default
    14	  const chromium = (await import('@sparticuz/chromium')).default
    15	  return { puppeteer, chromium }
    16	}
    17	
    18	type PdfGeneratorBrowser = {
    19	  newPage: () => Promise<any>
    20	  close: () => Promise<void>
 succeeded in 51ms:
     1	import { InvoiceWithDetails } from '@/types/invoices'
     2	import { formatDateFull } from '@/lib/dateUtils'
     3	import { COMPANY_DETAILS } from '@/lib/company-details'
     4	
     5	const CONTACT_NAME = process.env.COMPANY_CONTACT_NAME || 'Peter Pitcher'
     6	const CONTACT_PHONE = process.env.COMPANY_CONTACT_PHONE || '07995087315'
     7	
     8	export type InvoiceDocumentKind = 'invoice' | 'remittance_advice'
     9	
    10	export interface InvoiceRemittanceDetails {
    11	  paymentDate?: string | null
    12	  paymentAmount?: number | null
    13	  paymentMethod?: string | null
    14	  paymentReference?: string | null
    15	}
    16	
    17	export interface InvoiceTemplateData {
    18	  invoice: InvoiceWithDetails
    19	  logoUrl?: string
    20	  documentKind?: InvoiceDocumentKind
 succeeded in 51ms:
     1	import { createClient } from '@/lib/supabase/server';
     2	import { createAdminClient } from '@/lib/supabase/admin';
     3	import { calculateInvoiceTotals } from '@/lib/invoiceCalculations';
     4	import { getTodayIsoDate } from '@/lib/dateUtils';
     5	import { isInvoiceStatusTransitionAllowed } from '@/lib/status-transitions';
     6	import { z } from 'zod'; // Import Zod
     7	
     8	import type { InvoiceStatus, InvoiceLineItemInput, Invoice, InvoiceWithDetails, LineItemCatalogItem } from '@/types/invoices';
     9	
    10	function sanitizeInvoiceSearch(value: string): string {
    11	  return value
    12	    .replace(/[,%_()"'\\]/g, '')
    13	    .replace(/\s+/g, ' ')
    14	    .trim()
    15	    .slice(0, 80);
    16	}
    17	export { isInvoiceStatusTransitionAllowed } from '@/lib/status-transitions';
    18	
    19	// Invoice validation schema
    20	export const CreateInvoiceSchema = z.object({
exec
/bin/zsh -lc "nl -ba src/lib/invoice-template-compact.ts | sed -n '340,620p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
   340	    td {
   341	      padding: 6px 8px;
   342	      border-bottom: 1px solid #e5e7eb;
   343	      color: #4b5563;
   344	      vertical-align: top;
   345	    }
   346	    
   347	    td.text-right {
   348	      text-align: right;
   349	    }
   350	    
   351	    .item-description {
   352	      font-weight: 500;
   353	      color: #111827;
   354	      margin-bottom: 2px;
   355	    }
   356	    
   357	    .item-line-discount {
   358	      font-size: 7pt;
   359	      color: #059669;
exec
/bin/zsh -lc "nl -ba src/lib/invoice-template-compact.ts | sed -n '620,760p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 50ms:
   620	    <div class="notes-section keep-together">
   621	      <h3>Notes</h3>
   622	      <p>${escapeHtml(invoice.notes)}</p>
   623	    </div>
   624	  ` : ''}
   625	
   626	  <div class="footer">
   627	    <p>${COMPANY_DETAILS.name} | Company Reg: ${COMPANY_DETAILS.companyNumber} | VAT: ${COMPANY_DETAILS.vatNumber}</p>
   628	    <p>${COMPANY_DETAILS.fullAddress} | ${COMPANY_DETAILS.phone} | ${COMPANY_DETAILS.email}</p>
   629	    <p>Contact: ${CONTACT_NAME} | Mobile: ${CONTACT_PHONE}</p>
   630	  </div>
   631	</body>
   632	</html>
   633	  `
   634	}
codex
- High: Server-side HTML injection in invoice/receipt PDF generation. `generateCompactInvoiceHTML()` escapes some fields, but it injects vendor/customer-controlled values like `invoice.vendor.name`, `contact_name`, `email`, `phone`, `vat_number`, and `line_items[].description` straight into the HTML template, and `generateInvoicePDF()` renders that HTML with Puppeteer via `page.setContent()`. A malicious vendor/customer name can therefore inject markup/script into the server-rendered PDF and potentially trigger outbound requests from the Chromium renderer. Refs: [src/lib/pdf-generator.ts:99](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/pdf-generator.ts:99), [src/lib/invoice-template-compact.ts:179](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:179), [src/lib/invoice-template-compact.ts:480](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:480), [src/lib/invoice-template-compact.ts:481](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:481), [src/lib/invoice-template-compact.ts:483](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:483), [src/lib/invoice-template-compact.ts:524](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:524).

- Medium: Receipt generation can be made to reference the wrong payment by manipulating `paymentDate`. `recordPayment()` inserts the new payment, but the receipt flow then reloads the invoice and picks `latestPayment` by `payment_date`, not by the newly inserted payment ID. Because the payment RPC always stores a `payment_date`, backdated or same-day payments can cause the receipt to show another installment’s amount/reference/date instead of the payment just recorded. This is already an integrity issue for final-payment receipts and would get worse if receipts are extended to partial payments. Refs: [src/app/actions/invoices.ts:163](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:163), [src/app/actions/invoices.ts:171](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:171), [src/app/actions/invoices.ts:709](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:709), [src/app/actions/invoices.ts:747](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:747), [src/services/invoices.ts:343](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/invoices.ts:343), [supabase/migrations-archive/pre-squash-20251123/20260401130000_create_invoice_transactions.sql:126](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations-archive/pre-squash-20251123/20260401130000_create_invoice_transactions.sql:126).
exec
/bin/zsh -lc "nl -ba src/app/actions/oj-projects/client-balance.ts | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/oj-projects/projects.ts | sed -n '1,420p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/oj-projects/entries.ts | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/oj-projects/vendor-settings.ts | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/(authenticated)/oj-projects/clients/page.tsx | sed -n '300,380p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
     1	'use server'
     2	
     3	import { createClient } from '@/lib/supabase/server'
     4	import { checkUserPermission } from '@/app/actions/rbac'
     5	
     6	function roundMoney(v: number) {
     7	  return Math.round((v + Number.EPSILON) * 100) / 100
     8	}
     9	
    10	export type ClientInvoiceSummary = {
    11	  id: string
    12	  invoice_number: string
    13	  invoice_date: string
    14	  due_date: string
    15	  reference: string
    16	  status: string
    17	  total_amount: number
    18	  paid_amount: number
    19	  outstanding: number
    20	}
 succeeded in 52ms:
     1	'use server'
     2	
     3	import { createClient } from '@/lib/supabase/server'
     4	import { checkUserPermission } from '@/app/actions/rbac'
     5	import { logAuditEvent } from '@/app/actions/audit'
     6	import { z } from 'zod'
     7	import crypto from 'crypto'
     8	
     9	const CreateProjectSchema = z.object({
    10	  vendor_id: z.string().uuid('Invalid vendor ID'),
    11	  project_name: z.string().min(1, 'Project name is required').max(200),
    12	  brief: z.string().max(5000).optional(),
    13	  internal_notes: z.string().max(10000).optional(),
    14	  deadline: z
    15	    .string()
    16	    .optional()
    17	    .refine((value) => !value || !Number.isNaN(Date.parse(value)), 'Invalid deadline date'),
    18	  budget_ex_vat: z.coerce.number().min(0).optional(),
    19	  budget_hours: z.coerce.number().min(0).optional(),
    20	  status: z.enum(['active', 'paused', 'completed', 'archived'] as const).optional(),
 succeeded in 52ms:
     1	'use server'
     2	
     3	import { createClient } from '@/lib/supabase/server'
     4	import { checkUserPermission } from '@/app/actions/rbac'
     5	import { logAuditEvent } from '@/app/actions/audit'
     6	import { recalculateTaxYearMileage } from '@/lib/mileage/recalculateTaxYear'
     7	import { getTaxYearBounds } from '@/lib/mileage/hmrcRates'
     8	import { z } from 'zod'
     9	
    10	const TimeEntrySchema = z.object({
    11	  vendor_id: z.string().uuid('Invalid vendor ID'),
    12	  project_id: z.string().uuid('Invalid project ID'),
    13	  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    14	  duration_minutes: z.coerce.number().min(1, 'Duration must be at least 1 minute'),
    15	  work_type_id: z.string().uuid('Invalid work type').optional().or(z.literal('')).optional(),
    16	  description: z.string().max(5000).optional(),
    17	  internal_notes: z.string().max(10000).optional(),
    18	  billable: z.coerce.boolean().optional(),
    19	})
    20	
 succeeded in 52ms:
     1	'use server'
     2	
     3	import { createClient } from '@/lib/supabase/server'
     4	import { checkUserPermission } from '@/app/actions/rbac'
     5	import { z } from 'zod'
     6	
     7	const BillingSettingsSchema = z.object({
     8	  vendor_id: z.string().uuid('Invalid vendor ID'),
     9	  client_code: z.string().trim().min(1).max(10).optional().or(z.literal('')).optional(),
    10	  billing_mode: z.enum(['full', 'cap'] as const),
    11	  monthly_cap_inc_vat: z.coerce.number().min(0).optional(),
    12	  hourly_rate_ex_vat: z.coerce.number().min(0).max(10000),
    13	  vat_rate: z.coerce.number().min(0).max(100),
    14	  mileage_rate: z.coerce.number().min(0).max(100),
    15	  retainer_included_hours_per_month: z.coerce.number().min(0).max(1000).optional(),
    16	  statement_mode: z.boolean().optional(),
    17	})
    18	
    19	export async function getVendorBillingSettings(vendorId: string) {
    20	  const hasPermission = await checkUserPermission('oj_projects', 'view')
 succeeded in 52ms:
zsh:1: no matches found: src/app/(authenticated)/oj-projects/clients/page.tsx
exec
/bin/zsh -lc "nl -ba supabase/migrations/20251120010000_fix_invoice_rls_policies.sql | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba supabase/migrations/20260120130000_oj_projects_core.sql | sed -n '1,360p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba supabase/migrations/20251123120000_squashed.sql | sed -n '8040,8365p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"CREATE TABLE public\\.invoices|ALTER TABLE public\\.invoices ENABLE ROW LEVEL SECURITY|CREATE POLICY .*invoices|CREATE TABLE public\\.invoice_payments|ALTER TABLE public\\.invoice_payments ENABLE ROW LEVEL SECURITY|CREATE POLICY .*invoice_payments|CREATE TABLE public\\.oj_entries|ALTER TABLE public\\.oj_entries ENABLE ROW LEVEL SECURITY|CREATE POLICY .*oj_entries|invoice_vendor_contacts|oj_projects|oj_vendor_billing_settings|invoice_email_logs|credit_notes|void\" supabase/migrations/20251123120000_squashed.sql supabase/migrations/20251120010000_fix_invoice_rls_policies.sql supabase/migrations/20250820195912_add_invoice_permissions.sql supabase/migrations/20250912_add_invoice_vendor_contacts.sql supabase/migrations/20260120130000_oj_projects_core.sql supabase/migrations/20260120132000_add_oj_projects_permissions.sql supabase/migrations/20260226120000_oj_entries_one_off.sql supabase/migrations/20260203090000_add_statement_mode_to_oj_vendor_billing_settings.sql" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
     1	-- Placeholder for 20251120010000_fix_invoice_rls_policies.sql
     2	-- This migration was squashed into 20251123120000_squashed.sql
     3	-- Original file stored at supabase/migrations-archive/pre-squash-20251123/20251120010000_fix_invoice_rls_policies.sql
 succeeded in 51ms:
     1	-- OJ Projects core tables + RLS
     2	-- Creates project/time tracking tables and billing run audit/locking.
     3	
     4	-- 1) RBAC permissions (optional if table exists)
     5	DO $$
     6	BEGIN
     7	  IF EXISTS (
     8	    SELECT 1 FROM information_schema.tables
     9	    WHERE table_schema = 'public' AND table_name = 'rbac_permissions'
    10	  ) THEN
    11	    INSERT INTO public.rbac_permissions (module, action, description) VALUES
    12	      ('oj_projects', 'view', 'View OJ Projects'),
    13	      ('oj_projects', 'create', 'Create OJ Projects data'),
    14	      ('oj_projects', 'edit', 'Edit OJ Projects data'),
    15	      ('oj_projects', 'delete', 'Delete OJ Projects data'),
    16	      ('oj_projects', 'manage', 'Full OJ Projects management')
    17	    ON CONFLICT (module, action) DO NOTHING;
    18	  END IF;
    19	END $$;
    20	
 succeeded in 51ms:
  8040	CREATE INDEX IF NOT EXISTS idx_sunday_lunch_menu_items_display_order ON sunday_lunch_menu_items(display_order);
  8041	CREATE INDEX IF NOT EXISTS idx_sunday_lunch_menu_items_is_active ON sunday_lunch_menu_items(is_active);
  8042	
  8043	-- Enable RLS
  8044	ALTER TABLE sunday_lunch_menu_items ENABLE ROW LEVEL SECURITY;
  8045	
  8046	-- Drop existing policies if they exist
  8047	DROP POLICY IF EXISTS "Public can view active menu items" ON sunday_lunch_menu_items;
  8048	DROP POLICY IF EXISTS "Staff can view all menu items" ON sunday_lunch_menu_items;
  8049	DROP POLICY IF EXISTS "Managers can manage menu items" ON sunday_lunch_menu_items;
  8050	
  8051	-- Create RLS policies
  8052	-- Public can view active menu items
  8053	CREATE POLICY "Public can view active menu items" ON sunday_lunch_menu_items
  8054	  FOR SELECT
  8055	  USING (is_active = true);
  8056	
  8057	-- Staff can view all menu items
  8058	CREATE POLICY "Staff can view all menu items" ON sunday_lunch_menu_items
  8059	  FOR SELECT
 succeeded in 51ms:
supabase/migrations/20260203090000_add_statement_mode_to_oj_vendor_billing_settings.sql:1:ALTER TABLE public.oj_vendor_billing_settings
supabase/migrations/20250912_add_invoice_vendor_contacts.sql:1:-- Placeholder for 20250912_add_invoice_vendor_contacts.sql
supabase/migrations/20250912_add_invoice_vendor_contacts.sql:3:-- Original file stored at supabase/migrations-archive/pre-squash-20251123/20250912_add_invoice_vendor_contacts.sql
supabase/migrations/20260120132000_add_oj_projects_permissions.sql:5:    ('oj_projects', 'view', 'View OJ Projects'),
supabase/migrations/20260120132000_add_oj_projects_permissions.sql:6:    ('oj_projects', 'create', 'Create OJ Projects data'),
supabase/migrations/20260120132000_add_oj_projects_permissions.sql:7:    ('oj_projects', 'edit', 'Edit OJ Projects data'),
supabase/migrations/20260120132000_add_oj_projects_permissions.sql:8:    ('oj_projects', 'delete', 'Delete OJ Projects data'),
supabase/migrations/20260120132000_add_oj_projects_permissions.sql:9:    ('oj_projects', 'manage', 'Full OJ Projects management')
supabase/migrations/20260120132000_add_oj_projects_permissions.sql:25:    SELECT id, action FROM public.permissions WHERE module_name = 'oj_projects'
supabase/migrations/20260120130000_oj_projects_core.sql:12:      ('oj_projects', 'view', 'View OJ Projects'),
supabase/migrations/20260120130000_oj_projects_core.sql:13:      ('oj_projects', 'create', 'Create OJ Projects data'),
supabase/migrations/20260120130000_oj_projects_core.sql:14:      ('oj_projects', 'edit', 'Edit OJ Projects data'),
supabase/migrations/20260120130000_oj_projects_core.sql:15:      ('oj_projects', 'delete', 'Delete OJ Projects data'),
supabase/migrations/20260120130000_oj_projects_core.sql:16:      ('oj_projects', 'manage', 'Full OJ Projects management')
supabase/migrations/20260120130000_oj_projects_core.sql:32:CREATE TABLE IF NOT EXISTS public.oj_vendor_billing_settings (
supabase/migrations/20260120130000_oj_projects_core.sql:62:CREATE TABLE IF NOT EXISTS public.oj_projects (
supabase/migrations/20260120130000_oj_projects_core.sql:76:CREATE INDEX IF NOT EXISTS idx_oj_projects_vendor
supabase/migrations/20260120130000_oj_projects_core.sql:77:ON public.oj_projects(vendor_id, status, created_at DESC);
supabase/migrations/20260120130000_oj_projects_core.sql:82:  project_id uuid NOT NULL REFERENCES public.oj_projects(id) ON DELETE CASCADE,
supabase/migrations/20260120130000_oj_projects_core.sql:83:  contact_id uuid NOT NULL REFERENCES public.invoice_vendor_contacts(id) ON DELETE CASCADE,
exec
/bin/zsh -lc "nl -ba supabase/migrations/20251123120000_squashed.sql | sed -n '11880,12070p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba supabase/migrations/20251123120000_squashed.sql | sed -n '12476,12520p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba supabase/migrations/20251123120000_squashed.sql | sed -n '15370,15520p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba supabase/migrations/20260226120000_oj_entries_one_off.sql | sed -n '1,240p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
 11880	    notes text,
 11881	    is_active boolean DEFAULT true,
 11882	    created_at timestamp with time zone DEFAULT now(),
 11883	    updated_at timestamp with time zone DEFAULT now()
 11884	);
 11885	
 11886	CREATE TABLE IF NOT EXISTS public.invoice_vendor_contacts (
 11887	    id uuid DEFAULT gen_random_uuid() NOT NULL,
 11888	    vendor_id uuid NOT NULL,
 11889	    name text,
 11890	    email text NOT NULL,
 11891	    is_primary boolean DEFAULT false NOT NULL,
 11892	    created_at timestamp with time zone DEFAULT now() NOT NULL
 11893	);
 11894	
 11895	CREATE TABLE IF NOT EXISTS public.invoice_series (
 11896	    series_code character varying(10) PRIMARY KEY,
 11897	    current_sequence integer DEFAULT 0,
 11898	    created_at timestamp with time zone DEFAULT now()
 11899	);
 succeeded in 51ms:
 12476	-- Begin 20250912_add_invoice_vendor_contacts.sql
 12477	-- Create a normalized contacts table for invoice vendors
 12478	create table if not exists public.invoice_vendor_contacts (
 12479	  id uuid primary key default gen_random_uuid(),
 12480	  vendor_id uuid not null references public.invoice_vendors(id) on delete cascade,
 12481	  name text,
 12482	  email text not null,
 12483	  is_primary boolean not null default false,
 12484	  created_at timestamp with time zone not null default now()
 12485	);
 12486	
 12487	create index if not exists idx_invoice_vendor_contacts_vendor on public.invoice_vendor_contacts(vendor_id);
 12488	create index if not exists idx_invoice_vendor_contacts_email on public.invoice_vendor_contacts(email);
 12489	
 12490	-- Ensure only one primary contact per vendor
 12491	create or replace function public.enforce_single_primary_vendor_contact()
 12492	returns trigger as $$
 12493	begin
 12494	  if new.is_primary then
 12495	    update public.invoice_vendor_contacts
 succeeded in 51ms:
 15370	-- End 20251120000000_optimize_performance.sql
 15371	
 15372	
 15373	-- Begin 20251120010000_fix_invoice_rls_policies.sql
 15374	-- Description: Fix RLS policies for Invoices module to allow access based on RBAC permissions
 15375	-- Previously only super_admin had access via policies in the dump.
 15376	
 15377	-- ==============================================================================
 15378	-- 1. INVOICES TABLE
 15379	-- ==============================================================================
 15380	
 15381	-- Ensure RLS is enabled
 15382	ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;
 15383	
 15384	-- View Policy
 15385	CREATE POLICY "Users with invoices view permission can view invoices" 
 15386	ON "public"."invoices" 
 15387	FOR SELECT 
 15388	TO "authenticated" 
 15389	USING (
 succeeded in 52ms:
     1	-- Add one_off entry type to oj_entries
     2	-- Adds amount_ex_vat_snapshot column and updates CHECK constraints
     3	
     4	-- 1. Add the new column
     5	ALTER TABLE public.oj_entries
     6	  ADD COLUMN IF NOT EXISTS amount_ex_vat_snapshot NUMERIC(10,2) DEFAULT NULL;
     7	
     8	-- 2. Drop and recreate the entry_type check constraint to include 'one_off'
     9	ALTER TABLE public.oj_entries
    10	  DROP CONSTRAINT IF EXISTS oj_entries_entry_type_check;
    11	
    12	ALTER TABLE public.oj_entries
    13	  ADD CONSTRAINT oj_entries_entry_type_check
    14	  CHECK (entry_type IN ('time', 'mileage', 'one_off'));
    15	
    16	-- 3. Drop and recreate the time-fields check to allow one_off entries
    17	--    (one_off entries have no start_at, end_at, duration, or miles)
    18	ALTER TABLE public.oj_entries
    19	  DROP CONSTRAINT IF EXISTS chk_oj_entries_time_fields;
    20	
codex
1. High: wrong-vendor invoice disclosure is possible in the admin OJ billing flow because it loads an invoice by `invoice_id` alone, then uses the current loop’s `vendorId` to resolve recipients and continue reconciliation/emailing. There is no `invoice.vendor_id === vendorId` assertion before that send path. See [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:1891) and the caller path at [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:2164) plus recipient resolution at [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:2199).

2. High: the OJ schema does not enforce same-vendor integrity across linked records. `oj_entries` independently FK to `vendor_id`, `project_id`, and `invoice_id`, but there is no DB constraint that the project/invoice belong to the same vendor; the only guard is the app-level `ensureProjectMatchesVendor()` used on interactive entry create/update. A statement action that aggregates by vendor and joins projects/invoices/payments can therefore surface another vendor’s project or invoice data if any bad row is inserted via service-role code, manual SQL, or a bug. See the app-only check at [entries.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/entries.ts:70) and the unconstrained schema at [20260120130000_oj_projects_core.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260120130000_oj_projects_core.sql:111) plus recurring instance relationships at [database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:6130).

3. Medium: the proposed statement permission model is weaker than the underlying invoice/payment RLS. The spec says `oj_projects:view` is enough, but `invoices` and `invoice_payments` are protected by `invoices:view` RLS. Existing OJ code already reads invoices under only `oj_projects:view`, which means a real statement action will either fail for OJ-only users or be pushed onto an admin client, bypassing the only invoice/payment permission boundary and making any missed vendor filter a cross-vendor leak. See [client-balance.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/client-balance.ts:35) and the invoice/payment RLS at [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:15382) and [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:15476).

4. Medium: the proposed “void -> set linked OJ rows back to `unbilled`” behavior can re-bill already-paid work unless payments are explicitly handled. The system allows `partially_paid -> void`, payments remain attached to the original invoice by `invoice_id`, and the billing cron picks rows solely by `status = 'unbilled'`. If a future `voidInvoice` reopens linked OJ rows without transferring/refunding/applying existing payments, the same work can be invoiced again while prior cash stays on the voided invoice. See status transitions at [status-transitions.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/status-transitions.ts:3), current void guard at [invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:440), payment linkage at [database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:3577), payment recording at [invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:670), and rebill selection at [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:2694).
exec
/bin/zsh -lc "nl -ba supabase/migrations/20251123120000_squashed.sql | sed -n '14796,14820p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
 14796	  );
 14797	REVOKE ALL ON public.invoice_series FROM anon;
 14798	
 14799	-- 8. Vendor contacts align with invoice permissions
 14800	ALTER TABLE public.invoice_vendor_contacts ENABLE ROW LEVEL SECURITY;
 14801	DROP POLICY IF EXISTS "Invoice users can view vendor contacts" ON public.invoice_vendor_contacts;
 14802	DROP POLICY IF EXISTS "Invoice users can manage vendor contacts" ON public.invoice_vendor_contacts;
 14803	CREATE POLICY "Invoice users can view vendor contacts"
 14804	  ON public.invoice_vendor_contacts
 14805	  FOR SELECT TO authenticated
 14806	  USING (
 14807	    auth.role() = 'service_role'
 14808	    OR public.user_has_permission(auth.uid(), 'invoices', 'view')
 14809	  );
 14810	CREATE POLICY "Invoice users can manage vendor contacts"
 14811	  ON public.invoice_vendor_contacts
 14812	  FOR ALL TO authenticated
 14813	  USING (
 14814	    auth.role() = 'service_role'
 14815	    OR public.user_has_permission(auth.uid(), 'invoices', 'edit')
codex
- `Critical:` Invoice write RPCs are likely callable outside the intended invoice RBAC model. The squashed migration grants default `ALL` on future public-schema functions to `anon` and `authenticated` in [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:5911), and both `create_invoice_transaction` and `record_invoice_payment_transaction` are `SECURITY DEFINER` with no `user_has_permission(...)` check in [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:18144) and [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:18223). The app calls them with a normal session client in [src/services/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/invoices.ts:96) and [src/services/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/invoices.ts:167). Risk: direct RPC calls can bypass invoice table RLS and app-layer permission checks.

- `High:` Several invoice-adjacent tables appear outside DB-enforced RBAC/RLS. The same migration grants default `ALL` on future public tables to `anon` and `authenticated` in [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:5921). `invoice_vendors`, `invoice_audit`, `invoice_email_logs`, and `invoice_emails` are created later in [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:11871), [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:11992), [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:12006), and [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:12034), while the only invoice tables with explicit RLS/policies I found are `invoice_series`, `invoice_vendor_contacts`, `invoices`, `invoice_line_items`, and `invoice_payments` in [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:14760), [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:14800), [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:15382), [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:15428), and [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:15476). Risk: vendor master data plus invoice email/audit history are not visibly protected by the invoice permission model at the DB layer.

- `Medium:` Invoice voiding is currently authorized as an `edit`, not a `delete`/`void` privilege, and it does not revert linked OJ billing state. The current action gates voiding behind `checkUserPermission('invoices', 'edit')` in [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:413), and `void` is an allowed generic status transition in [src/lib/status-transitions.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/status-transitions.ts:4). DB-side, invoice updates require only `invoices:edit` in [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:15403), while the spec says void should require `invoices:delete` or a dedicated `void` action in [2026-04-14-oj-projects-review-design.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:239). The current code explicitly warns linked `oj_entries` / recurring charges will not be reverted in [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:440). Risk: edit-only users can void invoices, and forced voids can strand linked OJ billing records in inconsistent states.
exec
/bin/zsh -lc 'rg -n "invoice_email_logs|ALTER TABLE .*invoice_email_logs ENABLE ROW LEVEL SECURITY|CREATE POLICY .*invoice_email_logs" supabase/migrations/20251123120000_squashed.sql' in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
12006:CREATE TABLE IF NOT EXISTS public.invoice_email_logs (
12020:    CONSTRAINT invoice_email_logs_status_check CHECK (((status)::text = ANY ((ARRAY['sent'::character varying, 'failed'::character varying, 'bounced'::character varying])::text[])))
exec
/bin/zsh -lc "nl -ba supabase/migrations/20250820195912_add_invoice_permissions.sql | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/rbac.ts | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba supabase/migrations/20260120132000_add_oj_projects_permissions.sql | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
     1	-- Placeholder for 20250820195912_add_invoice_permissions.sql
     2	-- This migration was squashed into 20251123120000_squashed.sql
     3	-- Original file stored at supabase/migrations-archive/pre-squash-20251123/20250820195912_add_invoice_permissions.sql
 succeeded in 50ms:
     1	-- Add OJ Projects module permissions (new RBAC system: permissions/roles/role_permissions)
     2	DO $$
     3	BEGIN
     4	  INSERT INTO public.permissions (module_name, action, description) VALUES
     5	    ('oj_projects', 'view', 'View OJ Projects'),
     6	    ('oj_projects', 'create', 'Create OJ Projects data'),
     7	    ('oj_projects', 'edit', 'Edit OJ Projects data'),
     8	    ('oj_projects', 'delete', 'Delete OJ Projects data'),
     9	    ('oj_projects', 'manage', 'Full OJ Projects management')
    10	  ON CONFLICT (module_name, action) DO NOTHING;
    11	END $$;
    12	
    13	DO $$
    14	DECLARE
    15	  v_super_admin_role_id UUID;
    16	  v_admin_role_id UUID;
    17	  v_manager_role_id UUID;
    18	  v_permission RECORD;
    19	BEGIN
    20	  SELECT id INTO v_super_admin_role_id FROM public.roles WHERE name = 'super_admin';
 succeeded in 52ms:
     1	'use server';
     2	
     3	import { createClient } from '@/lib/supabase/server';
     4	import { createAdminClient } from '@/lib/supabase/admin'; // Still needed for requirePermission helper
     5	import { revalidatePath } from 'next/cache';
     6	import { z } from 'zod'; // Zod still needed for form validation that's outside roleSchema
     7	import type { User as SupabaseUser } from '@supabase/supabase-js';
     8	import type { Role, Permission, UserPermission, ModuleName, ActionType } from '@/types/rbac';
     9	import { logAuditEvent } from './audit';
    10	import { PermissionService, roleSchema } from '@/services/permission'; // Import service and schema
    11	
    12	type PermissionCheckResult =
    13	  | { error: string }
    14	  | { user: SupabaseUser; admin: ReturnType<typeof createAdminClient> }; // Keep admin client for now, may be refactored away
    15	
    16	type UserSummary = Pick<SupabaseUser, 'id' | 'email' | 'created_at' | 'last_sign_in_at'>; // For getAllUsers result
    17	
    18	// This helper is kept in the action as it authenticates the user and then uses the service to check permissions.
    19	async function requirePermission(moduleName: ModuleName, action: ActionType): Promise<PermissionCheckResult> {
    20	  const supabase = await createClient();
exec
/bin/zsh -lc "rg -n \"credit_note|credit note|credit_notes|voidInvoice|void invoice|voided|status = 'void'|invoices', 'delete'|invoices', 'manage'|checkUserPermission\\('invoices'\" src supabase/migrations" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
supabase/migrations/20251123120000_squashed.sql:11598:    VALUES ('invoices', 'delete', 'Delete invoices');
supabase/migrations/20251123120000_squashed.sql:11616:    VALUES ('invoices', 'manage', 'Full invoice management including settings and templates');
supabase/migrations/20251123120000_squashed.sql:12050:    CONSTRAINT invoice_emails_email_type_check CHECK (((email_type)::text = ANY ((ARRAY['new_invoice'::character varying, 'reminder'::character varying, 'chase'::character varying, 'credit_note'::character varying, 'statement'::character varying, 'quote'::character varying])::text[]))),
supabase/migrations/20251123120000_squashed.sql:15420:  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'delete')
supabase/migrations/20251123120000_squashed.sql:15468:  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'delete')
src/app/actions/vendors.ts:30:    const hasPermission = await checkUserPermission('invoices', 'view')
src/app/actions/vendors.ts:57:    const hasPermission = await checkUserPermission('invoices', 'create')
src/app/actions/vendors.ts:100:    const hasPermission = await checkUserPermission('invoices', 'edit')
src/app/actions/vendors.ts:148:    const hasPermission = await checkUserPermission('invoices', 'delete')
src/app/api/quotes/[id]/pdf/route.ts:30:  const hasPermission = await checkUserPermission('invoices', 'view')
src/app/actions/email.ts:103:    const hasPermission = await checkUserPermission('invoices', 'view')
src/app/actions/email.ts:138:    const hasPermission = await checkUserPermission('invoices', 'edit')
src/app/actions/email.ts:362:    const hasPermission = await checkUserPermission('invoices', 'edit')
src/app/actions/email.ts:618:    const hasPermission = await checkUserPermission('invoices', 'edit')
src/app/actions/email.ts:839:    const hasPermission = await checkUserPermission('invoices', 'manage')
src/app/actions/email.ts:861:    const hasPermission = await checkUserPermission('invoices', 'view')
src/app/api/invoices/[id]/pdf/route.ts:30:  const hasPermission = await checkUserPermission('invoices', 'view')
src/app/actions/recurring-invoices.ts:72:    const hasPermission = await checkUserPermission('invoices', 'view')
src/app/actions/recurring-invoices.ts:126:    const hasPermission = await checkUserPermission('invoices', 'view')
src/app/actions/recurring-invoices.ts:183:    const hasPermission = await checkUserPermission('invoices', 'create')
exec
/bin/zsh -lc "nl -ba supabase/migrations/20251123120000_squashed.sql | sed -n '11588,11620p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
 11588	    INSERT INTO permissions (module_name, action, description)
 11589	    VALUES ('invoices', 'edit', 'Edit existing invoices');
 11590	  END IF;
 11591	
 11592	  -- Invoice Delete Permission
 11593	  IF NOT EXISTS (
 11594	    SELECT 1 FROM permissions 
 11595	    WHERE module_name = 'invoices' AND action = 'delete'
 11596	  ) THEN
 11597	    INSERT INTO permissions (module_name, action, description)
 11598	    VALUES ('invoices', 'delete', 'Delete invoices');
 11599	  END IF;
 11600	
 11601	  -- Invoice Export Permission
 11602	  IF NOT EXISTS (
 11603	    SELECT 1 FROM permissions 
 11604	    WHERE module_name = 'invoices' AND action = 'export'
 11605	  ) THEN
 11606	    INSERT INTO permissions (module_name, action, description)
 11607	    VALUES ('invoices', 'export', 'Export invoices to PDF/Excel');
exec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '2058,2210p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '2350,2528p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '3090,3348p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '3415,3475p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
  2058	      vendors: previews,
  2059	    })
  2060	  }
  2061	
  2062	  const results = {
  2063	    period: period.period_yyyymm,
  2064	    invoice_date: invoiceDate,
  2065	    processed: 0,
  2066	    sent: 0,
  2067	    skipped: 0,
  2068	    failed: 0,
  2069	    vendors: [] as Array<{
  2070	      vendor_id: string
  2071	      status: 'sent' | 'skipped' | 'failed'
  2072	      invoice_id?: string
  2073	      invoice_number?: string
  2074	      error?: string
  2075	    }>,
  2076	  }
  2077	
 succeeded in 50ms:
  2350	            status: 'skipped',
  2351	            invoice_id: invoice.id,
  2352	            invoice_number: invoice.invoice_number,
  2353	            error: 'Invoice email already being processed by another run'
  2354	          })
  2355	          continue
  2356	        }
  2357	
  2358	        let claimHeld = sendClaim.state === 'claimed'
  2359	        const skipEmailSend = sendClaim.state === 'replay'
  2360	
  2361	        if (!skipEmailSend) {
  2362	          const sendRes = await sendInvoiceEmail(invoice, recipients.to, subject, body, recipients.cc, additionalAttachments)
  2363	          if (!sendRes.success) {
  2364	            if (claimHeld) {
  2365	              try {
  2366	                await releaseIdempotencyClaim(supabase, claimKey, claimHash)
  2367	              } catch (releaseError) {
  2368	                console.error('Failed to release OJ billing invoice send claim:', releaseError)
  2369	              }
 succeeded in 51ms:
  3090	        results.vendors.push({ vendor_id: vendorId, status: 'skipped', invoice_id: invoiceId, invoice_number: invoiceNumber, error: 'Preview only' })
  3091	        continue
  3092	      }
  3093	
  3094	      // If email not configured, leave invoice as draft + entries as billing_pending (retry later)
  3095	      if (!isGraphConfigured()) {
  3096	        await updateBillingRunById(supabase, billingRun.id, {
  3097	          status: 'failed',
  3098	          error_message: 'Email service is not configured',
  3099	          run_finished_at: new Date().toISOString(),
  3100	          updated_at: new Date().toISOString(),
  3101	        })
  3102	
  3103	        results.failed++
  3104	        results.vendors.push({ vendor_id: vendorId, status: 'failed', invoice_id: invoiceId, invoice_number: invoiceNumber, error: 'Email service is not configured' })
  3105	        continue
  3106	      }
  3107	
  3108	      const fullInvoiceRes = await loadInvoiceWithDetails(supabase, invoiceId)
  3109	      if ('error' in fullInvoiceRes) throw new Error(fullInvoiceRes.error)
 succeeded in 51ms:
  3415	      results.vendors.push({ vendor_id: vendorId, status: 'sent', invoice_id: invoiceId, invoice_number: invoiceNumber })
  3416	    } catch (err) {
  3417	      const message = err instanceof Error ? err.message : 'Unknown error'
  3418	      results.failed++
  3419	      results.vendors.push({ vendor_id: vendorId, status: 'failed', error: message })
  3420	      try {
  3421	        await throwOnMutationError(
  3422	          supabase
  3423	            .from('oj_billing_runs')
  3424	            .update({ status: 'failed', error_message: message, run_finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
  3425	            .eq('vendor_id', vendorId)
  3426	            .eq('period_yyyymm', period.period_yyyymm),
  3427	          `Failed to persist failed billing run state for vendor ${vendorId} period ${period.period_yyyymm}`
  3428	        )
  3429	      } catch { }
  3430	    }
  3431	  }
  3432	
  3433	  return NextResponse.json(results)
  3434	}
exec
/bin/zsh -lc "rg -n \"function loadInvoiceWithDetails|loadInvoiceWithDetails|getStatement|statement|reference ILIKE 'OJ Projects|reference"'`,|invoice_payments|payments:invoice_payments|oj_entries.invoice_id" src/app/api/cron/oj-projects-billing/route.ts src/app/actions/oj-projects src/services/invoices.ts' in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '1000,1060p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '1888,1948p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
  1888	  return lines.join('\n')
  1889	}
  1890	
  1891	async function loadInvoiceWithDetails(supabase: ReturnType<typeof createAdminClient>, invoiceId: string) {
  1892	  const { data, error } = await supabase
  1893	    .from('invoices')
  1894	    .select(
  1895	      `
  1896	      *,
  1897	      vendor:invoice_vendors(*),
  1898	      line_items:invoice_line_items(*),
  1899	      payments:invoice_payments(*)
  1900	    `
  1901	    )
  1902	    .eq('id', invoiceId)
  1903	    .single()
  1904	
  1905	  if (error) return { error: error.message as string }
  1906	  return { invoice: data as InvoiceWithDetails }
  1907	}
 succeeded in 51ms:
  1000	
  1001	  const unbilledRecurring = [
  1002	    ...(input.selectedRecurringInstances || []),
  1003	    ...(input.skippedRecurringInstances || []),
  1004	  ]
  1005	
  1006	  let unbilledProjectsTotal = 0
  1007	  for (const entry of unbilledEntries) {
  1008	    const { incVat } = getEntryCharge(entry, input.settings)
  1009	    if (incVat <= 0) continue
  1010	    unbilledProjectsTotal = roundMoney(unbilledProjectsTotal + incVat)
  1011	  }
  1012	
  1013	  let unbilledRecurringTotal = 0
  1014	  for (const instance of unbilledRecurring) {
  1015	    const { incVat } = getRecurringCharge(instance)
  1016	    if (incVat <= 0) continue
  1017	    unbilledRecurringTotal = roundMoney(unbilledRecurringTotal + incVat)
  1018	  }
  1019	
 exited 1 in 51ms:
zsh:1: unmatched "
codex
I’ve got the auth and RLS picture. I’m reading the payment RPC now because the remaining questions hinge on how invoice status and payment rows are updated atomically under concurrent writes.
exec
/bin/zsh -lc "nl -ba supabase/migrations/20251123120000_squashed.sql | sed -n '18190,18340p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba supabase/migrations/20251123120000_squashed.sql | sed -n '18036,18130p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba supabase/migrations/20251123120000_squashed.sql | sed -n '17970,18035p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc 'rg -n "record_invoice_payment_transaction|create_invoice_transaction|update_invoice_with_line_items|void|credit_note|invoice_payment|paid_amount|partially_paid|written_off" supabase/migrations/20251123120000_squashed.sql supabase/migrations/*.sql' in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
 18190	    INSERT INTO invoice_line_items (
 18191	      invoice_id,
 18192	      catalog_item_id,
 18193	      description,
 18194	      quantity,
 18195	      unit_price,
 18196	      discount_percentage,
 18197	      vat_rate
 18198	    )
 18199	    SELECT
 18200	      v_invoice_id,
 18201	      (item->>'catalog_item_id')::UUID,
 18202	      item->>'description',
 18203	      (item->>'quantity')::DECIMAL,
 18204	      (item->>'unit_price')::DECIMAL,
 18205	      (item->>'discount_percentage')::DECIMAL,
 18206	      (item->>'vat_rate')::DECIMAL
 18207	    FROM jsonb_array_elements(p_line_items) AS item;
 18208	  END IF;
 18209	
 succeeded in 52ms:
 18036	  p_payment_data JSONB DEFAULT NULL
 18037	)
 18038	RETURNS JSONB
 18039	LANGUAGE plpgsql
 18040	SECURITY DEFINER
 18041	AS $$
 18042	DECLARE
 18043	  v_booking_id UUID;
 18044	  v_booking_record JSONB;
 18045	  v_item JSONB;
 18046	  v_total_deposit DECIMAL(10,2);
 18047	BEGIN
 18048	  -- 1. Insert Booking
 18049	  INSERT INTO table_bookings (
 18050	    customer_id,
 18051	    booking_date,
 18052	    booking_time,
 18053	    party_size,
 18054	    booking_type,
 18055	    special_requirements,
 succeeded in 51ms:
 17970	$$;
 17971	-- End 20260315120000_manage_sunday_lunch_service.sql
 17972	
 17973	
 17974	-- Begin 20260320123000_update_invoice_summary_stats.sql
 17975	-- Ensure outstanding totals include every invoice that is not fully paid
 17976	CREATE OR REPLACE FUNCTION public.get_invoice_summary_stats()
 17977	RETURNS TABLE(
 17978	  total_outstanding numeric,
 17979	  total_overdue numeric,
 17980	  total_draft numeric,
 17981	  total_this_month numeric,
 17982	  count_outstanding integer,
 17983	  count_overdue integer,
 17984	  count_draft integer
 17985	)
 17986	LANGUAGE plpgsql
 17987	AS $$
 17988	BEGIN
 17989	  RETURN QUERY
 succeeded in 51ms:
supabase/migrations/20251123120000_squashed.sql:225:CREATE OR REPLACE FUNCTION "public"."cleanup_import"() RETURNS "void"
supabase/migrations/20251123120000_squashed.sql:258:CREATE OR REPLACE FUNCTION "public"."cleanup_old_reminder_logs"() RETURNS "void"
supabase/migrations/20251123120000_squashed.sql:335:CREATE OR REPLACE FUNCTION "public"."encrypt_sensitive_audit_data"("p_encryption_key" "text") RETURNS "void"
supabase/migrations/20251123120000_squashed.sql:6168:-- Create RLS policies for staff access (drop existing policies first to avoid conflicts)
supabase/migrations/20251123120000_squashed.sql:6338:-- Drop existing policies if they exist to avoid conflicts
supabase/migrations/20251123120000_squashed.sql:7109:RETURNS void AS $$
supabase/migrations/20251123120000_squashed.sql:7375:      -- Check if code already exists (use full table reference to avoid ambiguity)
supabase/migrations/20251123120000_squashed.sql:7711:-- Fix all analytics functions to avoid nested aggregates and type mismatches
supabase/migrations/20251123120000_squashed.sql:11914:    paid_amount numeric(10,2) DEFAULT 0,
supabase/migrations/20251123120000_squashed.sql:11921:    CONSTRAINT invoices_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'sent'::character varying, 'paid'::character varying, 'partially_paid'::character varying, 'overdue'::character varying, 'void'::character varying, 'written_off'::character varying])::text[])))
supabase/migrations/20251123120000_squashed.sql:11980:CREATE TABLE IF NOT EXISTS public.invoice_payments (
supabase/migrations/20251123120000_squashed.sql:11989:    CONSTRAINT invoice_payments_payment_method_check CHECK (((payment_method)::text = ANY ((ARRAY['bank_transfer'::character varying, 'cash'::character varying, 'cheque'::character varying, 'card'::character varying, 'other'::character varying])::text[])))
supabase/migrations/20251123120000_squashed.sql:12050:    CONSTRAINT invoice_emails_email_type_check CHECK (((email_type)::text = ANY ((ARRAY['new_invoice'::character varying, 'reminder'::character varying, 'chase'::character varying, 'credit_note'::character varying, 'statement'::character varying, 'quote'::character varying])::text[]))),
supabase/migrations/20251123120000_squashed.sql:12201:RETURNS void AS $$
supabase/migrations/20251123120000_squashed.sql:13160:RETURNS void
supabase/migrations/20251123120000_squashed.sql:14841:RETURNS void
supabase/migrations/20251123120000_squashed.sql:15132:  WHERE i.status IN ('sent', 'partially_paid')
supabase/migrations/20251123120000_squashed.sql:15191:RETURNS void
supabase/migrations/20251123120000_squashed.sql:15261:    -- Immutable audit log retained; this function intentionally avoids UPDATEs.
supabase/migrations/20251123120000_squashed.sql:15476:ALTER TABLE "public"."invoice_payments" ENABLE ROW LEVEL SECURITY;
exec
/bin/zsh -lc 'rg -n "receive_invoice_copy|invoice_cc" supabase/migrations src' in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 50ms:
supabase/migrations/20260120131000_invoice_vendor_contacts_invoice_cc.sql:6:  ADD COLUMN IF NOT EXISTS receive_invoice_copy boolean NOT NULL DEFAULT false;
supabase/migrations/20260120131000_invoice_vendor_contacts_invoice_cc.sql:9:CREATE INDEX IF NOT EXISTS idx_invoice_vendor_contacts_receive_invoice_copy
supabase/migrations/20260120131000_invoice_vendor_contacts_invoice_cc.sql:10:ON public.invoice_vendor_contacts(vendor_id, receive_invoice_copy)
supabase/migrations/20260120131000_invoice_vendor_contacts_invoice_cc.sql:11:WHERE receive_invoice_copy = true;
src/lib/invoice-recipients.ts:93:    .select('email, is_primary, receive_invoice_copy')
src/lib/invoice-recipients.ts:106:      receiveInvoiceCopy: Boolean(row?.receive_invoice_copy)
src/types/database.generated.ts:3680:          receive_invoice_copy: boolean
src/types/database.generated.ts:3691:          receive_invoice_copy?: boolean
src/types/database.generated.ts:3702:          receive_invoice_copy?: boolean
src/app/actions/invoices.ts:71:    .select('email, is_primary, receive_invoice_copy')
src/app/actions/invoices.ts:84:      cc: !!contact?.receive_invoice_copy,
src/app/actions/vendor-contacts.ts:25:    .select('id, vendor_id, name, email, phone, role, is_primary, receive_invoice_copy, created_at')
src/app/actions/vendor-contacts.ts:59:      receive_invoice_copy: parsed.data.receiveInvoiceCopy || false,
src/app/actions/vendor-contacts.ts:94:      receive_invoice_copy: parsed.data.receiveInvoiceCopy || false,
src/app/(authenticated)/invoices/vendors/page.tsx:68:  receive_invoice_copy?: boolean | null
src/app/(authenticated)/invoices/vendors/page.tsx:106:  const [contactForm, setContactForm] = useState<{ id?: string, name: string, email: string, phone: string, role: string, is_primary: boolean, receive_invoice_copy: boolean }>({
src/app/(authenticated)/invoices/vendors/page.tsx:112:    receive_invoice_copy: false,
src/app/(authenticated)/invoices/vendors/page.tsx:168:    setContactForm({ name: '', email: '', phone: '', role: '', is_primary: false, receive_invoice_copy: false })
src/app/(authenticated)/invoices/vendors/page.tsx:189:      fd.append('receiveInvoiceCopy', String(contactForm.receive_invoice_copy))
src/app/(authenticated)/invoices/vendors/page.tsx:197:      setContactForm({ name: '', email: '', phone: '', role: '', is_primary: false, receive_invoice_copy: false })
exec
/bin/zsh -lc "nl -ba src/lib/email/emailService.ts | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/lib/cron/alerting.ts | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"ADMIN_EMAIL|REMINDER_EMAIL|OJ_PROJECTS_BILLING_ALERT_EMAIL|billing alert|alert email|sendEmail\\(\" src .env* docs -g '"'!node_modules'"'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
     1	import { sendEmail } from '@/lib/email/emailService'
     2	import { getErrorMessage } from '@/lib/errors'
     3	
     4	/**
     5	 * Escapes HTML special characters to prevent injection in alert emails.
     6	 */
     7	export function escapeHtml(input: string): string {
     8	  return input
     9	    .replace(/&/g, '&amp;')
    10	    .replace(/</g, '&lt;')
    11	    .replace(/>/g, '&gt;')
    12	    .replace(/"/g, '&quot;')
    13	    .replace(/'/g, '&#39;')
    14	}
    15	
    16	/**
    17	 * Redacts PII (phone numbers and email addresses) from a string
    18	 * before including it in alert emails.
    19	 *
    20	 * - Phone numbers: replaces with [REDACTED_PHONE]
 succeeded in 51ms:
     1	import { isGraphConfigured } from '@/lib/microsoft-graph';
     2	import { Client } from '@microsoft/microsoft-graph-client';
     3	import { ClientSecretCredential } from '@azure/identity';
     4	import { getErrorMessage } from '@/lib/errors';
     5	
     6	interface EmailOptions {
     7	  to: string;
     8	  subject: string;
     9	  html?: string;
    10	  text?: string;
    11	  cc?: string[];
    12	  bcc?: string[];
    13	  attachments?: EmailAttachment[];
    14	}
    15	
    16	interface EmailAttachment {
    17	  name: string;
    18	  content: Buffer | string;
    19	  contentType: string;
    20	}
 succeeded in 52ms:
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:158:Uses `sendEmail()` from `src/lib/email/emailService.ts`.
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:222:- If any vendor billing failed (caught exceptions, partial failures), send an internal alert email
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:223:- Use `sendEmail()` to a configured admin address (new env var `OJ_PROJECTS_BILLING_ALERT_EMAIL`, fallback to existing admin email)
docs/superpowers/plans/2026-04-04-technical-debt-remediation.md:1154:    await sendEmail({
src/lib/cron/alerting.ts:5: * Escapes HTML special characters to prevent injection in alert emails.
src/lib/cron/alerting.ts:18: * before including it in alert emails.
src/lib/cron/alerting.ts:41: * Reports a cron job failure by sending an alert email to the configured
src/lib/cron/alerting.ts:107:    const result = await sendEmail({
src/lib/email/employee-invite-emails.ts:56:  return sendEmail({ to: email, subject, text, cc });
src/lib/email/employee-invite-emails.ts:61:  return sendEmail({ to: email, subject, text, cc });
src/lib/email/employee-invite-emails.ts:66:  return sendEmail({ to: email, subject, text, cc });
src/lib/email/employee-invite-emails.ts:71:  return sendEmail({ to: MANAGER_EMAIL, subject, text });
src/lib/email/emailService.ts:25:export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; error?: string; messageId?: string }> {
src/lib/email/emailService.ts:103:  return sendEmail({ to, subject, text: body });
src/lib/email/private-booking-emails.ts:96:    const result = await sendEmail({ to: booking.contact_email, subject, html });
src/lib/email/private-booking-emails.ts:168:    const result = await sendEmail({ to: booking.contact_email, subject, html });
src/lib/email/private-booking-emails.ts:221:    const result = await sendEmail({ to: booking.contact_email, subject, html });
src/lib/email/private-booking-emails.ts:276:    const result = await sendEmail({
src/lib/email/private-booking-emails.ts:346:    const result = await sendEmail({ to: booking.contact_email, subject, html });
src/app/actions/employeeActions.ts:175:  const emailResult = await sendEmail({
exec
/bin/zsh -lc "nl -ba src/app/actions/vendor-contacts.ts | sed -n '1,180p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/lib/oj-timesheet.ts | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/email.ts | sed -n '90,170p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
     1	'use server'
     2	
     3	import { createClient } from '@/lib/supabase/server'
     4	import { checkUserPermission } from '@/app/actions/rbac'
     5	import { revalidatePath } from 'next/cache'
     6	import { z } from 'zod'
     7	
     8	const ContactSchema = z.object({
     9	  vendorId: z.string().uuid('Invalid vendor ID'),
    10	  name: z.string().optional(),
    11	  email: z.string().email('Invalid email address'),
    12	  phone: z.string().optional(),
    13	  role: z.string().optional(),
    14	  isPrimary: z.coerce.boolean().optional(),
    15	  receiveInvoiceCopy: z.coerce.boolean().optional(),
    16	})
    17	
    18	export async function getVendorContacts(vendorId: string) {
    19	  const hasPermission = await checkUserPermission('invoices', 'view')
    20	  if (!hasPermission) return { error: 'Insufficient permissions' }
 succeeded in 51ms:
     1	import { generatePDFFromHTML } from '@/lib/pdf-generator'
     2	
     3	function escapeHtml(value: string) {
     4	  return String(value)
     5	    .replaceAll('&', '&amp;')
     6	    .replaceAll('<', '&lt;')
     7	    .replaceAll('>', '&gt;')
     8	    .replaceAll('"', '&quot;')
     9	    .replaceAll("'", '&#39;')
    10	}
    11	
    12	export async function generateOjTimesheetPDF(input: {
    13	  invoiceNumber: string
    14	  vendorName?: string | null
    15	  periodStart: string
    16	  periodEnd: string
    17	  notesText: string
    18	}): Promise<Buffer> {
    19	  const title = `OJ Projects Timesheet`
    20	  const vendorLabel = input.vendorName ? `Client: ${input.vendorName}` : ''
 succeeded in 52ms:
    90	    body: normalizedBody
    91	  })
    92	
    93	  return {
    94	    key: `action:${kind}:${targetId}:${requestHash.slice(0, 16)}`,
    95	    requestHash
    96	  }
    97	}
    98	
    99	// Get email logs for an invoice
   100	export async function getInvoiceEmailLogs(invoiceId: string) {
   101	  try {
   102	    // Check permissions
   103	    const hasPermission = await checkUserPermission('invoices', 'view')
   104	    if (!hasPermission) {
   105	      return { error: 'You do not have permission to view email logs' }
   106	    }
   107	
   108	    // Use admin client to bypass restrictive RLS on logs table if necessary,
   109	    // or standard client if policy allows. Given the investigation findings,
exec
/bin/zsh -lc "rg -n \"billing-preview|vendor_id=|vendorId|authorize|checkUserPermission\\('oj_projects'|preview\" src/app/api/oj-projects src/app/actions/oj-projects" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "find src/app/api -path '*oj-projects*' -type f | sort | sed -n '1,120p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
src/app/actions/oj-projects/work-types.ts:15:  const hasPermission = await checkUserPermission('oj_projects', 'view')
src/app/actions/oj-projects/work-types.ts:30:  const hasPermission = await checkUserPermission('oj_projects', 'create')
src/app/actions/oj-projects/work-types.ts:69:  const hasPermission = await checkUserPermission('oj_projects', 'edit')
src/app/actions/oj-projects/work-types.ts:114:  const hasPermission = await checkUserPermission('oj_projects', 'edit')
src/app/api/oj-projects/billing-preview/route.ts:6:  const hasPermission = await checkUserPermission('oj_projects', 'view')
src/app/api/oj-projects/billing-preview/route.ts:8:    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
src/app/api/oj-projects/billing-preview/route.ts:12:  const vendorId = url.searchParams.get('vendor_id')
src/app/api/oj-projects/billing-preview/route.ts:13:  if (!vendorId) {
src/app/api/oj-projects/billing-preview/route.ts:20:  cronUrl.searchParams.set('vendor_id', vendorId)
src/app/api/oj-projects/billing-preview/route.ts:25:      { error: 'CRON_SECRET is required to invoke preview billing run' },
src/app/actions/oj-projects/projects.ts:55:async function generateProjectCode(supabase: Awaited<ReturnType<typeof createClient>>, vendorId: string) {
src/app/actions/oj-projects/projects.ts:61:      .eq('vendor_id', vendorId)
src/app/actions/oj-projects/projects.ts:72:      .eq('id', vendorId)
src/app/actions/oj-projects/projects.ts:90:export async function getProjects(options?: { vendorId?: string; status?: string }) {
src/app/actions/oj-projects/projects.ts:91:  const hasPermission = await checkUserPermission('oj_projects', 'view')
src/app/actions/oj-projects/projects.ts:106:  if (options?.vendorId) {
src/app/actions/oj-projects/projects.ts:107:    query = query.eq('vendor_id', options.vendorId)
src/app/actions/oj-projects/projects.ts:141:  const hasPermission = await checkUserPermission('oj_projects', 'view')
src/app/actions/oj-projects/projects.ts:163:  const hasPermission = await checkUserPermission('oj_projects', 'create')
src/app/actions/oj-projects/projects.ts:214:  const hasPermission = await checkUserPermission('oj_projects', 'edit')
 succeeded in 50ms:
src/app/api/cron/oj-projects-billing-reminders/route.ts
src/app/api/cron/oj-projects-billing/__tests__/invoice-notes.test.ts
src/app/api/cron/oj-projects-billing/route.ts
src/app/api/cron/oj-projects-retainer-projects/route.ts
src/app/api/oj-projects/billing-preview/route.ts
exec
/bin/zsh -lc "nl -ba src/app/api/oj-projects/billing-preview/route.ts | sed -n '1,120p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
     1	import { NextResponse } from 'next/server'
     2	import { checkUserPermission } from '@/app/actions/rbac'
     3	import { GET as runOjProjectsBilling } from '@/app/api/cron/oj-projects-billing/route'
     4	
     5	export async function GET(request: Request) {
     6	  const hasPermission = await checkUserPermission('oj_projects', 'view')
     7	  if (!hasPermission) {
     8	    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
     9	  }
    10	
    11	  const url = new URL(request.url)
    12	  const vendorId = url.searchParams.get('vendor_id')
    13	  if (!vendorId) {
    14	    return NextResponse.json({ error: 'vendor_id is required' }, { status: 400 })
    15	  }
    16	
    17	  const cronUrl = new URL('/api/cron/oj-projects-billing', url.origin)
    18	  cronUrl.searchParams.set('dry_run', 'true')
    19	  cronUrl.searchParams.set('force', 'true')
    20	  cronUrl.searchParams.set('vendor_id', vendorId)
exec
/bin/zsh -lc "rg -n \"lockRowsForBillingRunOrThrow\\(|status: 'billing_pending'|expectedStatus: 'billing_pending'|status: 'billed'|invoice_id: invoiceId|billing_run_id: billingRun.id\" src/app/api/cron/oj-projects-billing/route.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
129:async function lockRowsForBillingRunOrThrow(input: {
144:      status: 'billing_pending',
2209:              : { status: 'billed', invoice_id: invoice.id, billed_at: new Date().toISOString(), updated_at: new Date().toISOString() }
2411:                  billing_run_id: billingRun.id,
2461:                    billing_run_id: billingRun.id,
2532:              status: 'billed',
2546:              status: 'billed',
2572:                billing_run_id: billingRun.id,
2891:      await lockRowsForBillingRunOrThrow({
2899:      await lockRowsForBillingRunOrThrow({
3062:            expectedStatus: 'billing_pending',
3073:            expectedStatus: 'billing_pending',
3084:        invoice_id: invoiceId,
3090:        results.vendors.push({ vendor_id: vendorId, status: 'skipped', invoice_id: invoiceId, invoice_number: invoiceNumber, error: 'Preview only' })
3104:        results.vendors.push({ vendor_id: vendorId, status: 'failed', invoice_id: invoiceId, invoice_number: invoiceNumber, error: 'Email service is not configured' })
3123:        results.vendors.push({ vendor_id: vendorId, status: 'failed', invoice_id: invoiceId, invoice_number: invoiceNumber, error: 'No invoice recipient email configured' })
3171:          invoice_id: invoiceId,
3182:          invoice_id: invoiceId,
3212:          results.vendors.push({ vendor_id: vendorId, status: 'failed', invoice_id: invoiceId, invoice_number: invoiceNumber, error: sendRes.error || 'Failed to send invoice email' })
3236:                invoice_id: invoiceId,
exec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '2528,2580p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '3348,3408p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '2878,3090p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
  3348	            console.error('Failed to write OJ billing invoice send log (cc):', ccLogError)
  3349	          }
  3350	        }
  3351	      }
  3352	
  3353	      if (selectedEntryIds.length > 0) {
  3354	        await updateSelectedRowsByIdsOrThrow({
  3355	          supabase,
  3356	          table: 'oj_entries',
  3357	          ids: selectedEntryIds,
  3358	          patch: {
  3359	            status: 'billed',
  3360	            invoice_id: invoiceId,
  3361	            billed_at: new Date().toISOString(),
  3362	            updated_at: new Date().toISOString(),
  3363	          },
  3364	          expectedStatus: 'billing_pending',
  3365	          billingRunId: billingRun.id,
  3366	          context: `Failed to mark selected OJ entries as billed for billing run ${billingRun.id}.`,
  3367	        })
 succeeded in 51ms:
  2528	        await throwOnMutationError(
  2529	          supabase
  2530	            .from('oj_entries')
  2531	            .update({
  2532	              status: 'billed',
  2533	              invoice_id: invoice.id,
  2534	              billed_at: new Date().toISOString(),
  2535	              updated_at: new Date().toISOString(),
  2536	            })
  2537	            .eq('billing_run_id', billingRun.id)
  2538	            .eq('status', 'billing_pending'),
  2539	          `Failed to mark OJ entries as billed for billing run ${billingRun.id}`
  2540	        )
  2541	
  2542	        await throwOnMutationError(
  2543	          supabase
  2544	            .from('oj_recurring_charge_instances')
  2545	            .update({
  2546	              status: 'billed',
  2547	              invoice_id: invoice.id,
 succeeded in 51ms:
  2878	        await updateBillingRunById(supabase, billingRun.id, {
  2879	          status: 'sent',
  2880	          invoice_id: null,
  2881	          error_message: null,
  2882	          run_finished_at: new Date().toISOString(),
  2883	          updated_at: new Date().toISOString(),
  2884	        })
  2885	
  2886	        results.skipped++
  2887	        results.vendors.push({ vendor_id: vendorId, status: 'skipped' })
  2888	        continue
  2889	      }
  2890	
  2891	      await lockRowsForBillingRunOrThrow({
  2892	        supabase,
  2893	        table: 'oj_entries',
  2894	        ids: selectedEntryIds,
  2895	        billingRunId: billingRun.id,
  2896	        context: `Failed to lock selected OJ entries for billing run ${billingRun.id}.`,
  2897	      })
exec
/bin/zsh -lc "nl -ba supabase/migrations/20260121100000_oj_recurring_charge_instances.sql | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
     1	-- OJ Projects: recurring charge instances (per period) to support cap carry-forward.
     2	-- Tracks billed status and allows deferred recurring charges to be billed in later runs.
     3	
     4	CREATE TABLE IF NOT EXISTS public.oj_recurring_charge_instances (
     5	  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
     6	  vendor_id uuid NOT NULL REFERENCES public.invoice_vendors(id) ON DELETE CASCADE,
     7	  recurring_charge_id uuid NOT NULL REFERENCES public.oj_vendor_recurring_charges(id) ON DELETE CASCADE,
     8	  period_yyyymm text NOT NULL,
     9	  period_start date NOT NULL,
    10	  period_end date NOT NULL,
    11	  description_snapshot text NOT NULL,
    12	  amount_ex_vat_snapshot numeric(12,2) NOT NULL,
    13	  vat_rate_snapshot numeric(5,2) NOT NULL DEFAULT 20,
    14	  sort_order_snapshot integer NOT NULL DEFAULT 0,
    15	  status text NOT NULL DEFAULT 'unbilled' CHECK (status IN ('unbilled', 'billing_pending', 'billed', 'paid')),
    16	  billing_run_id uuid REFERENCES public.oj_billing_runs(id),
    17	  invoice_id uuid REFERENCES public.invoices(id),
    18	  billed_at timestamptz,
    19	  paid_at timestamptz,
    20	  created_at timestamptz NOT NULL DEFAULT now(),
exec
/bin/zsh -lc "nl -ba docs/superpowers/specs/2026-04-14-oj-projects-review-design.md | sed -n '84,130p;172,225p;235,252p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
    84	## Phase 2: Client Statement
    85	
    86	### Data Model
    87	
    88	No new tables. The statement is a read-time aggregation:
    89	
    90	**Sources:**
    91	- `invoices` — filtered by vendor (via `reference ILIKE 'OJ Projects %'` or `vendor_id` join through `oj_entries`)
    92	- `invoice_payments` — all payments against those invoices
    93	- Future: credit notes (Phase 4.4)
    94	
    95	**Computed fields:**
    96	- Opening balance: sum of all unpaid invoice amounts with `created_at < dateFrom`
    97	- Transactions: chronological list of invoices (debits) and payments (credits) within the date range
    98	- Running balance: opening balance + cumulative debits - cumulative credits
    99	- Closing balance: final running balance value
   100	
   101	### Server Action
   102	
   103	**File:** `src/app/actions/oj-projects/client-statement.ts`
codex
**Findings**

- High: The client-statement design is one missed predicate away from cross-vendor disclosure. The spec allows invoice selection “via `reference ILIKE 'OJ Projects %'` or `vendor_id` join through `oj_entries`”, but current safe OJ patterns always bind both the vendor and the OJ reference. See the spec at [2026-04-14-oj-projects-review-design.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:91), the existing safe filters in [client-balance.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/client-balance.ts:41) and [oj-projects-billing/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:1020). This matters because RLS on both `invoices` and `invoice_payments` is only module-permission based, not `vendor_id` based, so the database will not prevent an overbroad statement query: [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:15382), [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:15476).

- High: The PDF pipeline has stored HTML injection in invoice/vendor data. Puppeteer renders raw HTML via `page.setContent(...)` in [pdf-generator.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/pdf-generator.ts:104), and the compact invoice template injects unescaped vendor and line-item fields such as `invoice.vendor?.name`, `contact_name`, `email`, `phone`, `vat_number`, and `item.description` in [invoice-template-compact.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:179), [invoice-template-compact.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:480), [invoice-template-compact.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:524). A malicious vendor name can become active markup in the headless browser. The OJ timesheet renderer shows the safer pattern by escaping its inputs in [oj-timesheet.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/oj-timesheet.ts:3).

- High: The proposed void flow can cause double-billing unless it participates in the billing-run lock protocol. The spec says voiding should set linked `oj_entries` and `oj_recurring_charge_instances` back to `unbilled` in [2026-04-14-oj-projects-review-design.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:240). The billing cron currently relies on a strict `unbilled -> billing_pending -> billed` transition with `billing_run_id` ownership in [oj-projects-billing/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:129), [oj-projects-billing/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:2891), [oj-projects-billing/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:3353). The current invoice action explicitly blocks voiding OJ-linked invoices unless forced because there is no safe automatic reversal today: [invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:440). If `voidInvoice()` just flips linked rows back to `unbilled`, a concurrent or subsequent run can pick them up again.

- Medium: The proposed void/credit-note auth model does not match the current permission boundaries. The spec gives void to `invoices + delete` (or a new `void` action) and does not define a credit-note permission at all: [2026-04-14-oj-projects-review-design.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:245), [2026-04-14-oj-projects-review-design.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:247). Today there is no `credit_note` or `void` permission in the invoices module, only `view/create/edit/delete/export/manage`: [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:11588). More importantly, reversing linked OJ data is not an invoice-only operation: `oj_entries` updates require OJ edit/manage and `oj_recurring_charge_instances` writes require OJ manage in [20260120130000_oj_projects_core.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260120130000_oj_projects_core.sql:273) and [20260121100000_oj_recurring_charge_instances.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260121100000_oj_recurring_charge_instances.sql:41). A void path gated only by invoice delete either over-authorizes via admin bypass or fails at runtime.

- Medium: The universal partial-receipt extension is not safe yet because the receipt code is not payment-specific. `recordPayment()` creates the payment but then calls the receipt sender with only `invoiceId`, not the new payment id, in [invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:709) and [invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:733). The sender then picks `latestPayment` by sorting all payments in [invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:163), and the template uses that derived payment in [invoice-template-compact.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:136). Backdated payments or same-day multiple payments can therefore generate a receipt for the wrong payment. The spec’s proposed dedupe “against the same invoice + payment combination” also cannot be implemented reliably with the current log table because `invoice_email_logs` has no `payment_id`: [2026-04-14-oj-projects-review-design.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:200), [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:12006).

- Medium: The billing-cron alert-email proposal can leak raw operational data if implemented as written. The spec says to email “which vendors failed, error messages, which vendors succeeded” using `sendEmail()` directly in [2026-04-14-oj-projects-review-design.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:221). The route currently captures raw exception text into `results.vendors[].error` and persists raw `error_message` strings in [oj-projects-billing/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:3417). `sendEmail()` itself does no redaction or destination validation in [emailService.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/email/emailService.ts:25). There is already a safer alerting helper that escapes and redacts PII in [alerting.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/cron/alerting.ts:5); the new billing alerts should reuse that pattern.

**Other checks**

- `recordPayment()` does not let a caller override receipt recipients directly. The form only carries invoice/payment fields in [invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:678); recipients are resolved server-side from the invoice vendor and vendor contacts in [invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:143), then passed to Graph in [microsoft-graph.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/microsoft-graph.ts:190). The broader risk is that recipient master data is globally editable by `invoices:edit` users, not vendor-scoped.

- RLS is enabled on `oj_entries`, `invoices`, and `invoice_payments`, but all three are permission-scoped rather than vendor-scoped. See [20260120130000_oj_projects_core.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260120130000_oj_projects_core.sql:186), [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:15382), and [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:15476).

Assumption: I treated each vendor as a data-isolation boundary for this review. Under the current codebase, vendor separation is enforced in application query filters, not in the RLS model itself.
tokens used
518,147
**Findings**

- High: The client-statement design is one missed predicate away from cross-vendor disclosure. The spec allows invoice selection “via `reference ILIKE 'OJ Projects %'` or `vendor_id` join through `oj_entries`”, but current safe OJ patterns always bind both the vendor and the OJ reference. See the spec at [2026-04-14-oj-projects-review-design.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:91), the existing safe filters in [client-balance.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/client-balance.ts:41) and [oj-projects-billing/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:1020). This matters because RLS on both `invoices` and `invoice_payments` is only module-permission based, not `vendor_id` based, so the database will not prevent an overbroad statement query: [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:15382), [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:15476).

- High: The PDF pipeline has stored HTML injection in invoice/vendor data. Puppeteer renders raw HTML via `page.setContent(...)` in [pdf-generator.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/pdf-generator.ts:104), and the compact invoice template injects unescaped vendor and line-item fields such as `invoice.vendor?.name`, `contact_name`, `email`, `phone`, `vat_number`, and `item.description` in [invoice-template-compact.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:179), [invoice-template-compact.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:480), [invoice-template-compact.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:524). A malicious vendor name can become active markup in the headless browser. The OJ timesheet renderer shows the safer pattern by escaping its inputs in [oj-timesheet.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/oj-timesheet.ts:3).

- High: The proposed void flow can cause double-billing unless it participates in the billing-run lock protocol. The spec says voiding should set linked `oj_entries` and `oj_recurring_charge_instances` back to `unbilled` in [2026-04-14-oj-projects-review-design.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:240). The billing cron currently relies on a strict `unbilled -> billing_pending -> billed` transition with `billing_run_id` ownership in [oj-projects-billing/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:129), [oj-projects-billing/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:2891), [oj-projects-billing/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:3353). The current invoice action explicitly blocks voiding OJ-linked invoices unless forced because there is no safe automatic reversal today: [invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:440). If `voidInvoice()` just flips linked rows back to `unbilled`, a concurrent or subsequent run can pick them up again.

- Medium: The proposed void/credit-note auth model does not match the current permission boundaries. The spec gives void to `invoices + delete` (or a new `void` action) and does not define a credit-note permission at all: [2026-04-14-oj-projects-review-design.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:245), [2026-04-14-oj-projects-review-design.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:247). Today there is no `credit_note` or `void` permission in the invoices module, only `view/create/edit/delete/export/manage`: [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:11588). More importantly, reversing linked OJ data is not an invoice-only operation: `oj_entries` updates require OJ edit/manage and `oj_recurring_charge_instances` writes require OJ manage in [20260120130000_oj_projects_core.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260120130000_oj_projects_core.sql:273) and [20260121100000_oj_recurring_charge_instances.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260121100000_oj_recurring_charge_instances.sql:41). A void path gated only by invoice delete either over-authorizes via admin bypass or fails at runtime.

- Medium: The universal partial-receipt extension is not safe yet because the receipt code is not payment-specific. `recordPayment()` creates the payment but then calls the receipt sender with only `invoiceId`, not the new payment id, in [invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:709) and [invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:733). The sender then picks `latestPayment` by sorting all payments in [invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:163), and the template uses that derived payment in [invoice-template-compact.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:136). Backdated payments or same-day multiple payments can therefore generate a receipt for the wrong payment. The spec’s proposed dedupe “against the same invoice + payment combination” also cannot be implemented reliably with the current log table because `invoice_email_logs` has no `payment_id`: [2026-04-14-oj-projects-review-design.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:200), [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:12006).

- Medium: The billing-cron alert-email proposal can leak raw operational data if implemented as written. The spec says to email “which vendors failed, error messages, which vendors succeeded” using `sendEmail()` directly in [2026-04-14-oj-projects-review-design.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:221). The route currently captures raw exception text into `results.vendors[].error` and persists raw `error_message` strings in [oj-projects-billing/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:3417). `sendEmail()` itself does no redaction or destination validation in [emailService.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/email/emailService.ts:25). There is already a safer alerting helper that escapes and redacts PII in [alerting.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/cron/alerting.ts:5); the new billing alerts should reuse that pattern.

**Other checks**

- `recordPayment()` does not let a caller override receipt recipients directly. The form only carries invoice/payment fields in [invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:678); recipients are resolved server-side from the invoice vendor and vendor contacts in [invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:143), then passed to Graph in [microsoft-graph.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/microsoft-graph.ts:190). The broader risk is that recipient master data is globally editable by `invoices:edit` users, not vendor-scoped.

- RLS is enabled on `oj_entries`, `invoices`, and `invoice_payments`, but all three are permission-scoped rather than vendor-scoped. See [20260120130000_oj_projects_core.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260120130000_oj_projects_core.sql:186), [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:15382), and [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:15476).

Assumption: I treated each vendor as a data-isolation boundary for this review. Under the current codebase, vendor separation is enforced in application query filters, not in the RLS model itself.
