OpenAI Codex v0.107.0 (research preview)
--------
workdir: /Users/peterpitcher/Cursor/OJ-AnchorManagementTools
model: gpt-5.4
provider: openai
approval: never
sandbox: workspace-write [workdir, /tmp, $TMPDIR] (network access enabled)
reasoning effort: xhigh
reasoning summaries: none
session id: 019d8b1b-9126-7161-a83a-4a99796765b2
--------
user
You are the Spec Trace Auditor. Read docs/superpowers/specs/2026-04-14-oj-projects-review-design.md then trace each requirement against the codebase.

FOR EACH SPEC ITEM (1.1-1.5, Phase 2, Phase 3, 4.1-4.4):
- What does the spec require?
- What exists in code? (read actual files)
- Classification: MISSING/PARTIAL/DEVIATION/AMBIGUOUS/SPEC_DEFECT
- Implementation risk

CRITICAL CHECKS:
- Does the invoices table have vendor_id? Check src/types/invoices.ts and grep for vendor_id in invoices-related files
- How does recordPayment() work exactly? Read src/app/actions/invoices.ts
- Does InvoiceStatus include 'void'? Read src/types/invoices.ts
- How do invoices link to vendors? Check the invoice schema and types

Output a requirements traceability matrix as structured markdown.
mcp: playwright starting
mcp: playwright ready
mcp startup: ready: playwright
codex
I’m reading the spec and mapping each required item to the implemented code paths, with extra focus on invoice/vendor linkage and payment status handling. Next I’m pulling the spec, invoice types, invoice actions, and the main related modules so the matrix is grounded in actual files rather than assumptions.
Plan update
  → Read the review design spec and extract every required item: 1.1-1.5, Phase 2, Phase 3, 4.1-4.4
  • Inspect implemented code paths and schemas related to each spec item, including invoice types and actions
  • Produce a structured traceability matrix with classification and implementation risk per item
exec
/bin/zsh -lc "sed -n '1,260p' src/app/actions/invoices.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,260p' src/types/invoices.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,260p' docs/superpowers/specs/2026-04-14-oj-projects-review-design.md" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "pwd && rg --files docs/superpowers/specs src | rg '2026-04-14-oj-projects-review-design\\.md|src/types/invoices\\.ts|src/app/actions/invoices\\.ts|invoice|vendor|project|review'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
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
 succeeded in 52ms:
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
 succeeded in 52ms:
/Users/peterpitcher/Cursor/OJ-AnchorManagementTools
docs/superpowers/specs/2026-03-21-booking-form-holistic-review.md
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md
src/services/vendors.ts
src/services/invoices.ts
src/lib/invoiceCalculations.ts
src/lib/invoice-reminder-safety.ts
src/types/vendor.ts
src/types/invoices.ts
src/types/oj-projects.ts
src/lib/vendors/paymentTerms.ts
src/app/actions/vendors.ts
src/app/actions/recurring-invoices.ts
src/lib/delete-invoice-cleanup-safety.ts
src/app/actions/invoices.ts
src/app/actions/vendor-contacts.ts
src/app/actions/oj-projects/work-types.ts
src/app/actions/oj-projects/system.ts
src/app/actions/oj-projects/vendor-settings.ts
src/lib/invoice-template-compact.ts
codex
I have the spec and the key invoice types/action file in hand. Next I’m tracing each spec item by searching for the exact implementation hooks: DB constraint names, one-off balance handling, recurring charge types, cap split logic, statement UI/actions, receipt dispatch, project payment history, billing alerts, statement-mode copy, and void/credit-note support.
exec
/bin/zsh -lc "rg -n \"unbilledTotal|client-balance|one_off|amount_ex_vat_snapshot\" src/app/actions/oj-projects src/app/\\(authenticated\\)/oj-projects/clients src/types" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc 'rg -n "deriveClientCode|cap|split|start_at|end_at|fallback" src/app/actions/oj-projects src/app/api/cron/oj-projects-billing src/lib src/types' in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 50ms:
src/types/database.generated.ts:5914:          amount_ex_vat_snapshot: number | null
src/types/database.generated.ts:5942:          amount_ex_vat_snapshot?: number | null
src/types/database.generated.ts:5970:          amount_ex_vat_snapshot?: number | null
src/types/database.generated.ts:6132:          amount_ex_vat_snapshot: number
src/types/database.generated.ts:6151:          amount_ex_vat_snapshot: number
src/types/database.generated.ts:6170:          amount_ex_vat_snapshot?: number
src/app/(authenticated)/oj-projects/clients/page.tsx:28:import { getClientBalance } from '@/app/actions/oj-projects/client-balance'
src/app/(authenticated)/oj-projects/clients/page.tsx:29:import type { ClientBalance } from '@/app/actions/oj-projects/client-balance'
src/app/(authenticated)/oj-projects/clients/page.tsx:589:                  <div className="text-2xl font-bold text-amber-800">£{balance.unbilledTotal.toFixed(2)}</div>
src/app/(authenticated)/oj-projects/clients/page.tsx:596:                    {balance.unbilledTotal === 0 && 'Nothing pending'}
src/app/actions/oj-projects/entries.ts:43:  entry_type: z.enum(['time', 'mileage', 'one_off'] as const),
src/app/actions/oj-projects/entries.ts:324:      entry_type: 'one_off',
src/app/actions/oj-projects/entries.ts:340:      amount_ex_vat_snapshot: parsed.data.amount_ex_vat,
src/app/actions/oj-projects/entries.ts:354:    new_values: { entry_type: 'one_off', project_id: data.project_id, entry_date: data.entry_date, amount_ex_vat_snapshot: data.amount_ex_vat_snapshot },
src/app/actions/oj-projects/entries.ts:460:  // one_off
src/app/actions/oj-projects/entries.ts:461:  if (parsed.data.entry_type === 'one_off') {
src/app/actions/oj-projects/entries.ts:472:        amount_ex_vat_snapshot: parsed.data.amount_ex_vat,
src/app/actions/oj-projects/entries.ts:493:      new_values: { entry_type: 'one_off', amount_ex_vat_snapshot: parsed.data.amount_ex_vat },
src/types/oj-projects.ts:3:export type OJEntryType = 'time' | 'mileage' | 'one_off'
src/types/oj-projects.ts:89:  amount_ex_vat_snapshot: number | null
exec
/bin/zsh -lc 'rg -n "OJRecurringChargeInstance|oj_recurring_charge_instances|any" src/app/api/cron/oj-projects-billing src/types/oj-projects.ts src' in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc 'rg -n "chk_oj_entries_time_fields|one_off|amount_ex_vat_snapshot|duration_minutes_rounded|miles|hourly_rate_snapshot|mileage_rate_snapshot" src supabase db migrations .' in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
Total output lines: 862

src/types/oj-projects.ts:1:export type OJBillingMode = 'full' | 'cap'
src/types/oj-projects.ts:19:  monthly_cap_inc_vat: number | null
src/types/oj-projects.ts:71:  start_at: string | null
src/types/oj-projects.ts:72:  end_at: string | null
src/types/venue.ts:5:  capacity_seated?: number;
src/types/venue.ts:6:  capacity_standing?: number;
src/types/venue.ts:19:  capacity_seated?: number | null;
src/types/venue.ts:20:  capacity_standing?: number | null;
src/types/database.generated.ts:857:          capacity: number | null
src/types/database.generated.ts:867:          capacity?: number | null
src/types/database.generated.ts:877:          capacity?: number | null
src/types/database.generated.ts:2347:          default_capacity: number | null
src/types/database.generated.ts:2392:          default_capacity?: number | null
src/types/database.generated.ts:2437:          default_capacity?: number | null
src/types/database.generated.ts:2643:          caption: string | null
src/types/database.generated.ts:2658:          caption?: string | null
src/types/database.generated.ts:2673:          caption?: string | null
src/types/database.generated.ts:2814:          capacity: number | null
 succeeded in 51ms:
Total output lines: 1478

src/types/oj-projects.ts:104:  selected_entry_ids: any | null
src/services/customer-labels.ts:13:      // Continue anyway - partial data is better than none
src/services/parking.ts:9:type GenericClient = SupabaseClient<any, 'public', any>
src/services/event-marketing.test.ts:56:    const insertMock = vi.fn().mockImplementation((row: any) => {
src/services/event-marketing.test.ts:83:    vi.mocked(createAdminClient).mockReturnValue(supabaseMock as any)
src/services/event-marketing.test.ts:124:    vi.mocked(createAdminClient).mockReturnValue(supabaseMock as any)
src/services/event-marketing.test.ts:156:    vi.mocked(createAdminClient).mockReturnValue(supabaseMock as any)
src/services/event-marketing.test.ts:167:    vi.mocked(createAdminClient).mockReturnValue(supabaseMock as any)
src/services/event-marketing.test.ts:170:      EventMarketingService.generateSingleLink(mockEvent.id, 'unknown_channel' as any)
src/services/event-marketing.test.ts:185:    vi.mocked(createAdminClient).mockReturnValue(supabaseMock as any)
src/services/gdpr.ts:6:  profile: any;
src/services/gdpr.ts:7:  customers: any[];
src/services/gdpr.ts:8:  bookings: any[];
src/services/gdpr.ts:9:  messages: any[];
src/services/gdpr.ts:10:  employees: any[];
src/services/gdpr.ts:11:  auditLogs: any[];
src/services/menu.ts:172:    let usageRows: any[] = [];
src/services/menu.ts:173:    let assignmentRows: any[] = [];
 exited 2 in 51ms:
Total output lines: 2236

rg: db: No such file or directory (os error 2)
rg: migrations: No such file or directory (os error 2)
./src/lib/mileage/__tests__/hmrcRates.test.ts:64:    expect(result.milesAtStandardRate).toBe(100)
./src/lib/mileage/__tests__/hmrcRates.test.ts:65:    expect(result.milesAtReducedRate).toBe(0)
./src/lib/mileage/__tests__/hmrcRates.test.ts:71:    expect(result.milesAtStandardRate).toBe(0)
./src/lib/mileage/__tests__/hmrcRates.test.ts:72:    expect(result.milesAtReducedRate).toBe(50)
./src/lib/mileage/__tests__/hmrcRates.test.ts:78:    expect(result.milesAtStandardRate).toBe(50) // 10000 - 9950
./src/lib/mileage/__tests__/hmrcRates.test.ts:79:    expect(result.milesAtReducedRate).toBe(50) // 100 - 50
./src/lib/mileage/__tests__/hmrcRates.test.ts:85:    expect(result.milesAtStandardRate).toBe(100)
./src/lib/mileage/__tests__/hmrcRates.test.ts:86:    expect(result.milesAtReducedRate).toBe(0)
./src/lib/mileage/__tests__/hmrcRates.test.ts:92:    expect(result.milesAtStandardRate).toBe(0)
./src/lib/mileage/__tests__/hmrcRates.test.ts:93:    expect(result.milesAtReducedRate).toBe(100)
./src/lib/mileage/__tests__/hmrcRates.test.ts:99:    expect(result.milesAtStandardRate).toBe(2.4)
./src/lib/mileage/__tests__/hmrcRates.test.ts:100:    expect(result.milesAtReducedRate).toBe(0)
./src/lib/mileage/__tests__/hmrcRates.test.ts:106:    expect(result.milesAtStandardRate).toBe(10000)
./src/lib/mileage/__tests__/hmrcRates.test.ts:107:    expect(result.milesAtReducedRate).toBe(2000)
./src/lib/mileage/__tests__/hmrcRates.test.ts:123:    expect(splits[0].milesAtStandardRate).toBe(5000)
./src/lib/mileage/__tests__/hmrcRates.test.ts:124:    expect(splits[0].milesAtReducedRate).toBe(0)
collab spawn_agent(call_mKXhHgSZJW5bjNbk78C6zgvU, prompt="Inspect the codebase for invoice/vendor linkage and payment receipt flow. Answer with concise findings and file/line ref…")
mcp: playwright starting
spawn_agent(call_mKXhHgSZJW5bjNbk78C6zgvU, prompt="Inspect the codebase for invoice/vendor linkage and payment receipt flow. Answer with concise findings and file/line ref…") pending init:
  agent: 019d8b1c-4efb-7543-ac3f-57d6424c62f8
mcp: playwright ready
mcp startup: ready: playwright
codex
I’m tracing invoice/vendor linkage and payment receipt handling in the codebase. First I’ll locate the schema/types and the invoice action implementation, then I’ll verify whether `void` or credit-note support exists anywhere with targeted searches.
exec
/bin/zsh -lc "rg --files --hidden --glob '"'!node_modules'"' --glob '"'!.git'"' . | rg \"(schema|invoice|vendor|types)\"" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n --hidden --glob '"'!node_modules'"' --glob '"'!.git'"' \"recordPayment\\(|vendor_id|InvoiceStatus|credit note|credit_note|void\" ." in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
./src/services/vendors.ts
./src/services/private-bookings/types.ts
./src/services/invoices.ts
./src/services/receipts/types.ts
./src/types/database.generated.ts
./src/types/event.ts
./src/types/vendor.ts
./src/types/cashing-up.ts
./src/types/event-categories.ts
./src/types/venue.ts
./src/types/business-hours.ts
./src/types/catering.ts
./src/types/database.ts
./src/types/rbac.ts
./src/types/actions.ts
./src/types/parking.ts
./src/types/private-bookings.ts
./src/types/booking-states.ts
./src/types/api.ts
./src/types/short-links.ts
 succeeded in 51ms:
Total output lines: 2100

./src/services/vendors.ts:98:      .eq('vendor_id', vendorId)
./src/services/employees.ts:803:    // Clear DB reference first with an optimistic guard to avoid stale-worker overwrite.
./src/services/private-bookings/payments.ts:50:  // cancellation_reason untouched to avoid unnecessary churn.
./src/services/private-bookings/payments.ts:533:): Promise<void> {
./src/services/private-bookings/payments.ts:557:export async function deleteBalancePayment(paymentId: string, bookingId: string): Promise<void> {
./src/services/private-bookings/payments.ts:581:): Promise<void> {
./src/services/private-bookings/payments.ts:592: * Unlike updateDeposit, this does NOT write deposit_payment_method (avoids method pollution).
./src/services/private-bookings/payments.ts:598:): Promise<void> {
./src/services/private-bookings/mutations.ts:35:async function sendCreationSms(booking: any, phone?: string | null): Promise<void> {
./src/services/private-bookings/mutations.ts:228:    void sendCreationSms(bookingWithHoldExpiry, normalizedContactPhone).catch((smsError) => {
./src/services/private-bookings/mutations.ts:1304:  vendor_id?: string | null;
./src/services/private-bookings/mutations.ts:1337:      vendor_id: data.vendor_id,
./src/services/private-bookings/mutations.ts:1499:    // Best-effort rollback to avoid leaving partially reordered items.
./docs/standards/DATABASE.md:31:-   **Selects**: Be specific. Avoid `select('*')` in critical paths; select only needed fields.
./docs/ARCHITECTURE.md:482:// Avoid N+1 queries - use joins
./docs/reports/hiring-screening-recommendations.md:153:- Avoid long free-form rationales; use concise evidence bullets.
./src/services/event-bookings.ts:68:   * requireFohPermission) should pass it in to avoid creating a second connection.
./src/services/event-bookings.ts:282:): Promise<void> {
collab spawn_agent(call_mKp1vMfdeJQ3udENUbo7Q0V8, prompt="Inspect the codebase for OJ Projects spec coverage from docs/superpowers/specs/2026-04-14-oj-projects-review-design.md. …")
mcp: playwright starting
spawn_agent(call_mKp1vMfdeJQ3udENUbo7Q0V8, prompt="Inspect the codebase for OJ Projects spec coverage from docs/superpowers/specs/2026-04-14-oj-projects-review-design.md. …") pending init:
  agent: 019d8b1c-7911-7522-a4ce-d04ac1033ab8
mcp: playwright ready
mcp startup: ready: playwright
codex
Reviewing the spec and tracing the corresponding implementation paths is the first step. I’ll read the target spec section, locate the project/billing/statement code paths it implies, then compare them item by item and return only concrete coverage gaps or mismatches with file references.
Plan update
  → Read the OJ Projects review spec and extract the exact expected behaviors for the requested items
  • Trace implementation across models, billing cron, actions, emails, and UI components
  • Compare spec vs code and assemble concise findings with file/line references and classification hints
codex
I’ve narrowed this to the invoice types, generated DB schema, the invoice service/action layer, and a repo-wide search for `void`/credit-note terms. Next I’m pulling exact line ranges so the answer can cite the implementation directly.
exec
/bin/zsh -lc "nl -ba src/app/actions/invoices.ts | sed -n '1,360p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/types/invoices.ts | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
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
     1	// Invoice-specific vendor type (different from private bookings vendor)
     2	export interface InvoiceVendor {
     3	  id: string
     4	  name: string
     5	  contact_name?: string
     6	  email?: string
     7	  phone?: string
     8	  address?: string
     9	  vat_number?: string
    10	  payment_terms?: number
    11	  notes?: string
    12	  is_active: boolean
    13	  created_at: string
    14	  updated_at: string
    15	}
    16	
    17	export type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue' | 'void' | 'written_off'
    18	export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired'
    19	export type PaymentMethod = 'bank_transfer' | 'card' | 'cash' | 'cheque' | 'other'
    20	export type RecurringFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly'
exec
/bin/zsh -lc "rg -n \"vendor_id|vendors\\(|vendors:|foreign key|InvoiceStatus|status:\" src/types/database.generated.ts src/types/database.ts src/services/invoices.ts src/app/\\(authenticated\\)/invoices -g '"'!node_modules'"'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
src/types/database.ts:66:  status: PerformerSubmissionStatus;
src/types/database.ts:150:  auto_status: ReceiptTransactionStatus;
src/types/database.ts:171:  status: ReceiptTransactionStatus;
src/types/database.ts:208:  previous_status: ReceiptTransactionStatus | null;
src/types/database.ts:209:  new_status: ReceiptTransactionStatus | null;
src/types/database.ts:301:  status: string; // 'Onboarding' | 'Active' | 'Started Separation' | 'Former'
src/types/database.ts:450:  status: string;
src/types/database.ts:454:  twilio_status: string | null;
src/types/database.ts:473:  status: string;
src/types/database.ts:483:  status: string;
src/types/database.ts:506:  operation_status: 'success' | 'failure';
src/types/database.ts:620:  status: HiringJobStatus;
src/types/database.ts:748:  status: HiringMessageStatus;
src/types/database.ts:768:  status: HiringMessageStatus;
src/types/database.ts:804:  status: string;
src/services/invoices.ts:5:import { isInvoiceStatusTransitionAllowed } from '@/lib/status-transitions';
src/services/invoices.ts:8:import type { InvoiceStatus, InvoiceLineItemInput, Invoice, InvoiceWithDetails, LineItemCatalogItem } from '@/types/invoices';
src/services/invoices.ts:17:export { isInvoiceStatusTransitionAllowed } from '@/lib/status-transitions';
src/services/invoices.ts:21:  vendor_id: z.string().uuid('Invalid vendor ID'),
src/services/invoices.ts:31:  vendor_id: string;
codex
I’m pulling the spec and mapping the likely ownership areas now: projects, billing, statements, invoices, and related UI/email flows. After that I’ll check each requested subsection against concrete code, not just naming matches.
exec
/bin/zsh -lc "pwd && rg --files docs src app lib db config test spec | sed 's#"'^#/#'"' | head -n 400" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,260p' docs/superpowers/specs/2026-04-14-oj-projects-review-design.md" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
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
/Users/peterpitcher/Cursor/OJ-AnchorManagementTools
rg: app: No such file or directory (os error 2)
rg: lib: No such file or directory (os error 2)
rg: db: No such file or directory (os error 2)
rg: config: No such file or directory (os error 2)
rg: test: No such file or directory (os error 2)
rg: spec: No such file or directory (os error 2)
/src/middleware.ts.disabled
/docs/ui-v2-component-catalog-outline.md
/docs/bookings-payments-messaging-v0.5-direction.md
/docs/FEATURES.md
/docs/CONTRIBUTING.md
/docs/SECURITY.md
/src/services/quotes.ts
/src/services/menu-settings.ts
/src/services/employees.ts
/src/services/customers.ts
/src/services/event-bookings.ts
/src/services/menu.ts
/src/services/event-checklist.ts
exec
/bin/zsh -lc "nl -ba src/app/actions/oj-projects/client-balance.ts | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/types/oj-projects.ts | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '620,920p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"deriveClientCode|getProjectPaymentHistory|statement_mode|Statement|client-statement|voidInvoice|createCreditNote|credit note|credit_notes|OJ_PROJECTS_BILLING_ALERT_EMAIL|sendEmail\\(\" src/app src/lib src/services" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
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
 succeeded in 51ms:
   620	    updated_at: new Date().toISOString(),
   621	    ...overrides,
   622	  }
   623	}
   624	
   625	function getNextSplitPeriodYyyymm(basePeriod: string, existingPeriods: string[]) {
   626	  const base = formatPeriodLabel(basePeriod)
   627	  if (!base) return `${basePeriod}-S1`
   628	  const prefix = `${base}-S`
   629	  let maxIndex = 0
   630	  for (const period of existingPeriods) {
   631	    const text = String(period || '')
   632	    if (!text.startsWith(prefix)) continue
   633	    const suffix = text.slice(prefix.length)
   634	    const parsed = Number.parseInt(suffix, 10)
   635	    if (Number.isFinite(parsed) && parsed > maxIndex) maxIndex = parsed
   636	  }
   637	  return `${base}-S${maxIndex + 1}`
   638	}
   639	
 succeeded in 51ms:
src/lib/cron/alerting.ts:107:    const result = await sendEmail({
src/lib/email/employee-invite-emails.ts:56:  return sendEmail({ to: email, subject, text, cc });
src/lib/email/employee-invite-emails.ts:61:  return sendEmail({ to: email, subject, text, cc });
src/lib/email/employee-invite-emails.ts:66:  return sendEmail({ to: email, subject, text, cc });
src/lib/email/employee-invite-emails.ts:71:  return sendEmail({ to: MANAGER_EMAIL, subject, text });
src/lib/table-bookings/charge-approvals.ts:280:  const emailResult = await sendEmail({
src/lib/email/emailService.ts:25:export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; error?: string; messageId?: string }> {
src/lib/email/emailService.ts:103:  return sendEmail({ to, subject, text: body });
src/lib/table-bookings/bookings.ts:362:  const emailResult = await sendEmail({
src/lib/email/private-booking-emails.ts:96:    const result = await sendEmail({ to: booking.contact_email, subject, html });
src/lib/email/private-booking-emails.ts:168:    const result = await sendEmail({ to: booking.contact_email, subject, html });
src/lib/email/private-booking-emails.ts:221:    const result = await sendEmail({ to: booking.contact_email, subject, html });
src/lib/email/private-booking-emails.ts:276:    const result = await sendEmail({
src/lib/email/private-booking-emails.ts:346:    const result = await sendEmail({ to: booking.contact_email, subject, html });
src/services/receipts/receiptMutations.ts:462:// importReceiptStatement
src/services/receipts/receiptMutations.ts:466:export async function performImportReceiptStatement(
src/app/api/cron/oj-projects-billing/route.ts:979:async function computeStatementBalanceBefore(input: {
src/app/api/cron/oj-projects-billing/route.ts:1045:function applyStatementCapTopUp(input: {
src/app/api/cron/oj-projects-billing/route.ts:1117:function buildStatementLineItems(input: {
src/app/api/cron/oj-projects-billing/route.ts:1317:  const statementMode = !!settings?.statement_mode
exec
/bin/zsh -lc "nl -ba src/app/actions/invoices.ts | sed -n '520,760p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"export async function recordPayment|recordPayment\\(\" src/app/actions/invoices.ts src/services/invoices.ts tests/actions/invoices.test.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/services/invoices.ts | sed -n '1,520p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
   520	
   521	    await logAuditEvent({
   522	      operation_type: 'delete',
   523	      resource_type: 'invoice',
   524	      resource_id: invoiceId,
   525	      operation_status: 'success',
   526	      additional_info: { invoice_number: deletedInvoice.invoice_number }
   527	    })
   528	
   529	    revalidatePath('/invoices')
   530	    revalidateTag('dashboard')
   531	    
   532	    return { success: true }
   533	  } catch (error: unknown) {
   534	    console.error('Error in deleteInvoice:', error)
   535	    return { error: getErrorMessage(error) }
   536	  }
   537	}
   538	
   539	export async function getInvoiceSummary() {
 succeeded in 51ms:
src/services/invoices.ts:164:  static async recordPayment(input: RecordPaymentInput) {
tests/actions/invoices.test.ts:368:      const result = await recordPayment(formData)
tests/actions/invoices.test.ts:377:      const result = await recordPayment(formData)
tests/actions/invoices.test.ts:391:      const result = await recordPayment(formData)
tests/actions/invoices.test.ts:405:      const result = await recordPayment(formData)
tests/actions/invoices.test.ts:437:      const result = await recordPayment(formData)
src/app/actions/invoices.ts:670:export async function recordPayment(formData: FormData) {
src/app/actions/invoices.ts:710:      InvoiceService.recordPayment({
 succeeded in 52ms:
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
codex
I have the action and service flow. I’m now checking the generated schema and migrations to confirm whether `vendor_id` is part of the invoice table definition and whether there is any actual implementation surface for `void` or credit notes beyond type declarations.
exec
/bin/zsh -lc "nl -ba src/types/database.generated.ts | sed -n '3710,3855p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/types/database.generated.ts | sed -n '7820,7895p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n --hidden --glob '"'!node_modules'"' --glob '"'!.git'"' \"record_invoice_payment_transaction|create_invoice_transaction|update_invoice_payment_status|status-transitions|void|credit note|credit_note|creditnote|credit-note\" supabase src tests" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
  7820	          discount_amount: number | null
  7821	          id: string
  7822	          internal_notes: string | null
  7823	          notes: string | null
  7824	          quote_date: string
  7825	          quote_discount_percentage: number | null
  7826	          quote_number: string
  7827	          reference: string | null
  7828	          status: string | null
  7829	          subtotal_amount: number | null
  7830	          total_amount: number | null
  7831	          updated_at: string | null
  7832	          valid_until: string
  7833	          vat_amount: number | null
  7834	          vendor_id: string | null
  7835	        }
  7836	        Insert: {
  7837	          converted_to_invoice_id?: string | null
  7838	          created_at?: string | null
  7839	          discount_amount?: number | null
 succeeded in 52ms:
  3710	            isOneToOne: false
  3711	            referencedRelation: "invoice_vendors"
  3712	            referencedColumns: ["id"]
  3713	          },
  3714	        ]
  3715	      }
  3716	      invoice_vendors: {
  3717	        Row: {
  3718	          address: string | null
  3719	          contact_name: string | null
  3720	          created_at: string | null
  3721	          email: string | null
  3722	          id: string
  3723	          is_active: boolean | null
  3724	          name: string
  3725	          notes: string | null
  3726	          payment_terms: number | null
  3727	          phone: string | null
  3728	          updated_at: string | null
  3729	          vat_number: string | null
 succeeded in 51ms:
Total output lines: 986

src/services/private-bookings/payments.ts:50:  // cancellation_reason untouched to avoid unnecessary churn.
src/services/private-bookings/payments.ts:533:): Promise<void> {
src/services/private-bookings/payments.ts:557:export async function deleteBalancePayment(paymentId: string, bookingId: string): Promise<void> {
src/services/private-bookings/payments.ts:581:): Promise<void> {
src/services/private-bookings/payments.ts:592: * Unlike updateDeposit, this does NOT write deposit_payment_method (avoids method pollution).
src/services/private-bookings/payments.ts:598:): Promise<void> {
src/services/private-bookings/mutations.ts:35:async function sendCreationSms(booking: any, phone?: string | null): Promise<void> {
src/services/private-bookings/mutations.ts:228:    void sendCreationSms(bookingWithHoldExpiry, normalizedContactPhone).catch((smsError) => {
src/services/private-bookings/mutations.ts:1499:    // Best-effort rollback to avoid leaving partially reordered items.
src/services/invoices.ts:5:import { isInvoiceStatusTransitionAllowed } from '@/lib/status-transitions';
src/services/invoices.ts:17:export { isInvoiceStatusTransitionAllowed } from '@/lib/status-transitions';
src/services/invoices.ts:96:    const { data: invoice, error } = await supabase.rpc('create_invoice_transaction', {
src/services/invoices.ts:148:    const { data: invoice, error } = await adminClient.rpc('create_invoice_transaction', {
src/services/invoices.ts:167:    const { data: result, error } = await supabase.rpc('record_invoice_payment_transaction', {
src/services/invoices.ts:277:    // The DB-level persistOverdueInvoices() write was removed from this read path to avoid
src/services/invoices.ts:335:    // to avoid mutations on every detail fetch. It should run in a dedicated cron job instead.
src/services/event-bookings.ts:68:   * requireFohPermission) should pass it in to avoid creating a second connection.
src/services/event-bookings.ts:282:): Promise<void> {
exec
/bin/zsh -lc "nl -ba src/app/actions/invoices.ts | sed -n '80,320p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"recordPayment\\(|sendRemittanceAdviceForPaidInvoice|invoice_email_logs|voidInvoice|createCreditNote\" src/app/actions/invoices.ts src/services/invoices.ts src/lib/microsoft-graph.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/invoices.ts | sed -n '320,520p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/services/invoices.ts | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 50ms:
src/services/invoices.ts:164:  static async recordPayment(input: RecordPaymentInput) {
src/app/actions/invoices.ts:112:async function sendRemittanceAdviceForPaidInvoice(
src/app/actions/invoices.ts:220:    const { error: logError } = await supabase.from('invoice_email_logs').insert(
src/app/actions/invoices.ts:259:  const { error: failedLogError } = await supabase.from('invoice_email_logs').insert({
src/app/actions/invoices.ts:670:export async function recordPayment(formData: FormData) {
src/app/actions/invoices.ts:710:      InvoiceService.recordPayment({
src/app/actions/invoices.ts:747:      remittanceAdvice = await sendRemittanceAdviceForPaidInvoice(invoiceId, user?.id || null)
 succeeded in 51ms:
    80	  const contactEmails = (contacts || [])
    81	    .map((contact: any) => ({
    82	      email: typeof contact?.email === 'string' ? contact.email.trim() : '',
    83	      isPrimary: !!contact?.is_primary,
    84	      cc: !!contact?.receive_invoice_copy,
    85	    }))
    86	    .filter((contact) => contact.email && contact.email.includes('@'))
    87	
    88	  const primaryEmail = contactEmails.find((contact) => contact.isPrimary)?.email || null
    89	  const firstVendorEmail = recipientsFromVendor[0] || null
    90	  const to = primaryEmail || firstVendorEmail || contactEmails[0]?.email || null
    91	
    92	  const ccRaw = [
    93	    ...recipientsFromVendor.slice(firstVendorEmail ? 1 : 0),
    94	    ...contactEmails.filter((contact) => contact.cc).map((contact) => contact.email),
    95	  ]
    96	
    97	  const seen = new Set<string>()
    98	  const toLower = to ? to.toLowerCase() : null
    99	  const cc = ccRaw
 succeeded in 51ms:
   320	    if (!hasPermission) {
   321	      return { error: 'You do not have permission to view invoices' }
   322	    }
   323	
   324	    const invoice = await InvoiceService.getInvoiceById(invoiceId)
   325	    return { invoice }
   326	  } catch (error: unknown) {
   327	    console.error('Error in getInvoice:', error)
   328	    return { error: getErrorMessage(error) }
   329	  }
   330	}
   331	
   332	export async function createInvoice(formData: FormData): Promise<CreateInvoiceResult> {
   333	  try {
   334	    const hasPermission = await checkUserPermission('invoices', 'create')
   335	    if (!hasPermission) {
   336	      return { error: 'You do not have permission to create invoices' }
   337	    }
   338	
   339	    const supabase = await createClient()
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
codex
I have the spec requirements. Next I’m tracing the concrete implementation anchors: migrations/types, client balance action, billing cron, project actions/UI, clients UI, statement/PDF/email code, and invoice void/credit support.
exec
/bin/zsh -lc "rg -n \"oj_entries|oj_recurring_charge_instances|chk_oj_entries_time_fields|credit_notes|statement_mode\" supabase migrations sql src/types/database.generated.ts src/types/database.ts docs -g '"'!**/*.map'"'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"client-balance|one_off|oj_recurring_charge_instances|deriveClientCode|statement_mode|client statement|getClientStatement|getProjectPaymentHistory|voidInvoice|credit note|credit_notes|OJRecurringChargeInstance|remittance_advice|sendPaymentReceipt|sendRemittanceAdviceForPaidInvoice|billing alert|OJ_PROJECTS_BILLING_ALERT_EMAIL|Payment history|Payments tab|invoice_payments|oj-projects-billing|oj-projects-retainer-projects|cap mode|start_at|end_at\" src docs -g '"'!**/*.map'"'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools exited 2 in 51ms:
rg: migrations: No such file or directory (os error 2)
rg: sql: No such file or directory (os error 2)
src/types/database.generated.ts:5841:            referencedRelation: "oj_entries"
src/types/database.generated.ts:5912:      oj_entries: {
src/types/database.generated.ts:5999:            foreignKeyName: "oj_entries_billing_run_id_fkey"
src/types/database.generated.ts:6006:            foreignKeyName: "oj_entries_invoice_id_fkey"
src/types/database.generated.ts:6013:            foreignKeyName: "oj_entries_project_id_fkey"
src/types/database.generated.ts:6020:            foreignKeyName: "oj_entries_vendor_id_fkey"
src/types/database.generated.ts:6027:            foreignKeyName: "oj_entries_work_type_id_fkey"
src/types/database.generated.ts:6130:      oj_recurring_charge_instances: {
src/types/database.generated.ts:6190:            foreignKeyName: "oj_recurring_charge_instances_billing_run_id_fkey"
src/types/database.generated.ts:6197:            foreignKeyName: "oj_recurring_charge_instances_invoice_id_fkey"
src/types/database.generated.ts:6204:            foreignKeyName: "oj_recurring_charge_instances_recurring_charge_id_fkey"
src/types/database.generated.ts:6211:            foreignKeyName: "oj_recurring_charge_instances_vendor_id_fkey"
src/types/database.generated.ts:6228:          statement_mode: boolean
src/types/database.generated.ts:6241:          statement_mode?: boolean
src/types/database.generated.ts:6254:          statement_mode?: boolean
src/types/database.generated.ts:11195:            foreignKeyName: "oj_entries_project_id_fkey"
docs/superpowers/plans/2026-03-12-remove-start-time-from-oj-projects.md:19:| `supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql` | **Create** — new constraint allows NULL start_at/end_at for time entries |
docs/superpowers/plans/2026-03-12-remove-start-time-from-oj-projects.md:33:- Create: `supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql`
 succeeded in 51ms:
src/services/short-links.ts:40:  start_at: z.string().datetime({ offset: true }),
src/services/short-links.ts:41:  end_at: z.string().datetime({ offset: true }),
src/services/short-links.ts:47:    new Date(value.start_at),
src/services/short-links.ts:48:    new Date(value.end_at),
src/services/short-links.ts:56:      path: ['start_at'],
src/services/short-links.ts:387:        p_start_at: input.start_at,
src/services/short-links.ts:388:        p_end_at: input.end_at,
src/services/invoices.ts:343:        payments:invoice_payments(*)
docs/guides/api/parking.md:35:  "start_at": "2025-11-01T09:00:00Z",
docs/guides/api/parking.md:36:  "end_at": "2025-11-03T17:00:00Z",
docs/guides/api/parking.md:96:    "start_at": "2025-11-01T09:00:00Z",
docs/guides/api/parking.md:97:    "end_at": "2025-11-03T17:00:00Z",
docs/guides/api/parking.md:124:      "start_at": "2025-11-01T00:00:00.000Z",
docs/guides/api/parking.md:125:      "end_at": "2025-11-01T23:59:59.999Z",
docs/guides/api/parking.md:131:      "start_at": "2025-11-02T00:00:00.000Z",
docs/guides/api/parking.md:132:      "end_at": "2025-11-02T23:59:59.999Z",
src/services/private-bookings/payments.ts:472:// Payment history & admin payment CRUD
src/services/parking.ts:120:      start_at: input.startAt,
src/services/parking.ts:121:      end_at: input.endAt,
docs/superpowers/plans/2026-04-04-technical-debt-remediation.md:1340:- Wrong column names (`booking_date` vs `start_at/end_at`)
exec
/bin/zsh -lc "nl -ba src/services/invoices.ts | sed -n '260,520p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/invoices.ts | sed -n '650,800p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"vendor_id\" src/types/invoices.ts src/services/invoices.ts src/app/actions/invoices.ts src/app/\\(authenticated\\)/invoices src/components/features/invoices src/app/api/invoices src/app/api/cron/invoice-reminders src/lib/invoice*" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
   650	    }
   651	
   652	    await InvoiceService.deleteCatalogItem(itemId)
   653	
   654	    await logAuditEvent({
   655	      operation_type: 'delete',
   656	      resource_type: 'line_item_catalog',
   657	      resource_id: itemId,
   658	      operation_status: 'success'
   659	    })
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
 succeeded in 51ms:
   260	      .is('deleted_at', null);
   261	
   262	    if (error) {
   263	      console.error('Error persisting overdue invoices:', error);
   264	      throw new Error('Failed to persist overdue invoices');
   265	    }
   266	  }
   267	
   268	  static async getInvoices(
   269	    status?: InvoiceStatus | 'unpaid',
   270	    page: number = 1,
   271	    limit: number = 20,
   272	    search?: string
   273	  ) {
   274	    const supabase = await createClient();
   275	
   276	    // Overdue status is computed at read time via JS-side normalisation below (line ~314).
   277	    // The DB-level persistOverdueInvoices() write was removed from this read path to avoid
   278	    // mutations on every list fetch. It should run in a dedicated cron job instead.
   279	
 succeeded in 52ms:
src/lib/invoice-recipients.ts:94:    .eq('vendor_id', vendorId)
src/types/invoices.ts:25:  vendor_id: string
src/types/invoices.ts:100:  vendor_id: string
src/types/invoices.ts:141:  vendor_id: string
src/services/invoices.ts:21:  vendor_id: z.string().uuid('Invalid vendor ID'),
src/services/invoices.ts:31:  vendor_id: string;
src/services/invoices.ts:81:      vendor_id: input.vendor_id,
src/services/invoices.ts:134:      vendor_id: input.vendor_id,
src/services/invoices.ts:213:        vendor_id: input.vendor_id,
src/app/actions/invoices.ts:72:    .eq('vendor_id', vendorId)
src/app/actions/invoices.ts:145:      invoice.vendor_id,
src/app/actions/invoices.ts:345:      vendor_id: formData.get('vendor_id'),
src/app/actions/invoices.ts:392:        vendor_id: invoice.vendor_id,
src/app/actions/invoices.ts:796:      vendor_id: formData.get('vendor_id'),
src/components/features/invoices/EmailInvoiceModal.tsx:58:        .eq('vendor_id', vendorId)
src/app/(authenticated)/invoices/new/page.tsx:163:      formData.append('vendor_id', vendorId)
src/app/(authenticated)/invoices/recurring/[id]/edit/page.tsx:83:        setVendorId(recurring.vendor_id)
src/app/(authenticated)/invoices/recurring/[id]/edit/page.tsx:192:      formData.append('vendor_id', vendorId)
src/app/(authenticated)/invoices/[id]/edit/page.tsx:88:      setVendorId(inv.vendor_id)
src/app/(authenticated)/invoices/[id]/edit/page.tsx:185:      formData.append('vendor_id', vendorId)
codex
I’ve narrowed it to a small set of implementation files. Now I’m reading those directly to separate actual coverage from nearby but unrelated OJ Projects work.
exec
/bin/zsh -lc "nl -ba supabase/migrations/20260226120000_oj_entries_one_off.sql | sed -n '1,120p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/oj-projects/client-balance.ts | sed -n '1,240p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql | sed -n '1,120p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/types/oj-projects.ts | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
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
 succeeded in 51ms:
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
/bin/zsh -lc "nl -ba src/lib/status-transitions.ts | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx | sed -n '80,560p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"OJ_LINKED_ITEMS|credit_note|credit note|invoice_emails_email_type_check|updateInvoiceStatus\\(|void'|\\bvoid\\b\" src/app/actions/invoices.ts src/app/api/cron/oj-projects-billing/route.ts src/components/features/invoices src/lib tests supabase/migrations/20251123120000_squashed.sql" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
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
zsh:1: no matches found: src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx
 succeeded in 51ms:
src/app/actions/invoices.ts:410:export async function updateInvoiceStatus(formData: FormData) {
src/app/actions/invoices.ts:428:      'draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void', 'written_off'
src/app/actions/invoices.ts:441:    if (newStatus === 'void' && !force) {
src/app/actions/invoices.ts:470:          code: 'OJ_LINKED_ITEMS',
src/app/actions/invoices.ts:477:      InvoiceService.updateInvoiceStatus(invoiceId, newStatus),
src/app/api/cron/oj-projects-billing/route.ts:1026:    .not('status', 'in', '(paid,void,written_off)')
src/app/api/cron/oj-projects-billing/route.ts:1717:    .not('status', 'in', '(paid,void,written_off)')
supabase/migrations/20251123120000_squashed.sql:225:CREATE OR REPLACE FUNCTION "public"."cleanup_import"() RETURNS "void"
supabase/migrations/20251123120000_squashed.sql:258:CREATE OR REPLACE FUNCTION "public"."cleanup_old_reminder_logs"() RETURNS "void"
supabase/migrations/20251123120000_squashed.sql:335:CREATE OR REPLACE FUNCTION "public"."encrypt_sensitive_audit_data"("p_encryption_key" "text") RETURNS "void"
supabase/migrations/20251123120000_squashed.sql:7109:RETURNS void AS $$
supabase/migrations/20251123120000_squashed.sql:11921:    CONSTRAINT invoices_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'sent'::character varying, 'paid'::character varying, 'partially_paid'::character varying, 'overdue'::character varying, 'void'::character varying, 'written_off'::character varying])::text[])))
supabase/migrations/20251123120000_squashed.sql:12050:    CONSTRAINT invoice_emails_email_type_check CHECK (((email_type)::text = ANY ((ARRAY['new_invoice'::character varying, 'reminder'::character varying, 'chase'::character varying, 'credit_note'::character varying, 'statement'::character varying, 'quote'::character varying])::text[]))),
supabase/migrations/20251123120000_squashed.sql:12201:RETURNS void AS $$
supabase/migrations/20251123120000_squashed.sql:13160:RETURNS void
supabase/migrations/20251123120000_squashed.sql:14841:RETURNS void
supabase/migrations/20251123120000_squashed.sql:15191:RETURNS void
supabase/migrations/20251123120000_squashed.sql:17992:      WHEN i.status NOT IN ('paid', 'void', 'written_off')
supabase/migrations/20251123120000_squashed.sql:18013:      WHEN i.status NOT IN ('paid', 'void', 'written_off') 
supabase/migrations/20251123120000_squashed.sql:18281:  ELSIF v_new_paid > 0 AND v_new_status NOT IN ('void', 'written_off') THEN
exec
/bin/zsh -lc "ls -R src/app/actions/oj-projects src/app/(authenticated)/oj-projects src/app/api/cron/oj-projects-billing src/app/api/cron/oj-projects-retainer-projects src/lib | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg --files src | rg 'oj-statement|client-statement|oj-projects/utils|credit_note|credit-notes|statement.*pdf|payment history|voidInvoice|createCreditNote'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
zsh:1: no matches found: src/app/(authenticated)/oj-projects
 exited 1 in 51ms:

exec
/bin/zsh -lc "nl -ba src/app/actions/invoices.ts | sed -n '400,520p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx' | sed -n '90,560p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba supabase/migrations-archive/pre-squash-20251123/20260401130000_create_invoice_transactions.sql | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolscodex
I’ve confirmed the invoice type already includes `vendor_id`, `InvoiceStatus` already includes `void`, and `recordPayment()` only triggers receipts on transition to `paid`. I’m now checking the generated DB types and OJ billing/project modules to verify whether the rest of the spec is actually implemented or only implied.
 succeeded in 52ms:
   400	    return { success: true, invoice }
   401	  } catch (error: unknown) {
   402	    console.error('Error in createInvoice:', error)
   403	    if (error instanceof z.ZodError) {
   404	      return { error: error.errors[0].message }
   405	    }
   406	    return { error: getErrorMessage(error) }
   407	  }
   408	}
   409	
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
 succeeded in 52ms:
    90	
    91	    return { totals, lineTotals: lineTotalsMap }
    92	  }, [invoice])
    93	
    94	  async function handleStatusChange(newStatus: InvoiceStatus) {
    95	    if (!invoice || actionLoading) return
    96	    if (!canEdit) {
    97	      setError('You do not have permission to update invoices')
    98	      return
    99	    }
   100	
   101	    if (newStatus === 'void') {
   102	      const confirmed = window.confirm('Void this invoice?')
   103	      if (!confirmed) return
   104	    }
   105	
   106	    setActionLoading(true)
   107	    setError(null)
   108	
   109	    try {
 succeeded in 52ms:
     1	-- Function to handle atomic creation of invoices with line items
     2	CREATE OR REPLACE FUNCTION create_invoice_transaction(
     3	  p_invoice_data JSONB,
     4	  p_line_items JSONB
     5	)
     6	RETURNS JSONB
     7	LANGUAGE plpgsql
     8	SECURITY DEFINER
     9	AS $$
    10	DECLARE
    11	  v_invoice_id UUID;
    12	  v_invoice_record JSONB;
    13	BEGIN
    14	  -- 1. Insert Invoice
    15	  INSERT INTO invoices (
    16	    invoice_number,
    17	    vendor_id,
    18	    invoice_date,
    19	    due_date,
    20	    reference,
exec
/bin/zsh -lc "nl -ba src/types/database.generated.ts | sed -n '7700,7795p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/types/database.generated.ts | sed -n '5900,5995p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/types/database.generated.ts | sed -n '6120,6190p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
  7700	            isOneToOne: false
  7701	            referencedRelation: "customers"
  7702	            referencedColumns: ["id"]
  7703	          },
  7704	        ]
  7705	      }
  7706	      profiles: {
  7707	        Row: {
  7708	          avatar_url: string | null
  7709	          created_at: string | null
  7710	          email: string | null
  7711	          email_notifications: boolean | null
  7712	          first_name: string | null
  7713	          full_name: string | null
  7714	          id: string
  7715	          last_name: string | null
  7716	          sms_notifications: boolean | null
  7717	          updated_at: string
  7718	        }
  7719	        Insert: {
 succeeded in 51ms:
  5900	            referencedRelation: "invoices"
  5901	            referencedColumns: ["id"]
  5902	          },
  5903	          {
  5904	            foreignKeyName: "oj_billing_runs_vendor_id_fkey"
  5905	            columns: ["vendor_id"]
  5906	            isOneToOne: false
  5907	            referencedRelation: "invoice_vendors"
  5908	            referencedColumns: ["id"]
  5909	          },
  5910	        ]
  5911	      }
  5912	      oj_entries: {
  5913	        Row: {
  5914	          amount_ex_vat_snapshot: number | null
  5915	          billable: boolean
  5916	          billed_at: string | null
  5917	          billing_run_id: string | null
  5918	          created_at: string
  5919	          description: string | null
 succeeded in 51ms:
  6120	        Relationships: [
  6121	          {
  6122	            foreignKeyName: "oj_projects_vendor_id_fkey"
  6123	            columns: ["vendor_id"]
  6124	            isOneToOne: false
  6125	            referencedRelation: "invoice_vendors"
  6126	            referencedColumns: ["id"]
  6127	          },
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
exec
/bin/zsh -lc "find . -maxdepth 4 \\( -path '*/supabase/migrations/*' -o -path '*/migrations/*' \\) -type f | sed -n '1,200p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 65ms:
./supabase/migrations/20260401190000_create_quote_transaction.sql
./supabase/migrations/20260420000026_table_booking_card_capture_and_fee_policy.sql
./supabase/migrations/20260301120000_rota_shifts_drop_department_check.sql
./supabase/migrations/20260216210000_fix_customer_category_stats.sql
./supabase/migrations/20251216120000_add_booking_update_sms_templates.sql
./supabase/migrations/20260110120000_menu_management.sql
./supabase/migrations/20250820195912_add_invoice_permissions.sql
./supabase/migrations/20260315000002_update_dish_transaction.sql
./supabase/migrations/20260228000003_timeclock_anon_update_policy.sql
./supabase/migrations/20260321000005_fix_analytics_v2_column_types.sql
./supabase/migrations/20250725122005_fix_table_booking_tables.sql
./supabase/migrations/20250114183000_remote_placeholder.sql
./supabase/migrations/20260405130004_import_historical_data_2024.sql
./supabase/migrations/20260404000000_fix_create_booking_rpc_items.sql
./supabase/migrations/20260412010000_hiring_stage_reminders.sql
./supabase/migrations/20260515000003_add_marty_pitcher_summers_timeclock_entries.sql
./supabase/migrations/20240929120000_add_vendor_contact_name.sql
./supabase/migrations/20260403000000_fix_create_booking_rpc.sql
./supabase/migrations/20260225120001_fuzzy_grouping_and_ai_stats.sql
./supabase/migrations/20260402020000_private_booking_lifecycle.sql
codex
There’s no direct hit yet for the new statement and credit-note filenames from the spec, so I’m verifying whether they’re absent entirely or implemented under different names before I classify them as missing.
exec
/bin/zsh -lc "find 'src/app/actions/oj-projects' 'src/app/(authenticated)/oj-projects' 'src/app/api/cron/oj-projects-billing' 'src/app/api/cron/oj-projects-retainer-projects' 'src/lib' -maxdepth 3 -type f | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
src/app/actions/oj-projects/entries.ts
src/app/actions/oj-projects/recurring-charges.ts
src/app/actions/oj-projects/projects.ts
src/app/actions/oj-projects/project-contacts.ts
src/app/actions/oj-projects/client-balance.ts
src/app/actions/oj-projects/__tests__/entries.test.ts
src/app/actions/oj-projects/vendor-settings.ts
src/app/actions/oj-projects/system.ts
src/app/actions/oj-projects/work-types.ts
src/app/(authenticated)/oj-projects/work-types/page.tsx
src/app/(authenticated)/oj-projects/clients/page.tsx
src/app/(authenticated)/oj-projects/entries/page.tsx
src/app/(authenticated)/oj-projects/projects/[id]/page.tsx
src/app/(authenticated)/oj-projects/projects/page.tsx
src/app/(authenticated)/oj-projects/page.tsx
src/app/api/cron/oj-projects-billing/__tests__/invoice-notes.test.ts
src/app/api/cron/oj-projects-billing/route.ts
src/app/api/cron/oj-projects-retainer-projects/route.ts
src/lib/receipts/ai-classification.ts
src/lib/receipts/export/mileage-csv.ts
exec
/bin/zsh -lc "rg -n \"getClientStatement|ACCOUNT STATEMENT|statement-.*pdf|sendEmail\\(|invoice_email_logs|voidInvoice|createCreditNote|credit_notes|credit note|statement_mode|badge|Tooltip|Payment history|invoice_payments|OJ_PROJECTS_BILLING_ALERT_EMAIL|alert email|admin email\" src supabase -g '"'!**/*.map'"'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
src/services/private-bookings/payments.ts:472:// Payment history & admin payment CRUD
supabase/migrations-archive/pre-squash-20251123/20251120010000_fix_invoice_rls_policies.sql:103:ALTER TABLE "public"."invoice_payments" ENABLE ROW LEVEL SECURITY;
supabase/migrations-archive/pre-squash-20251123/20251120010000_fix_invoice_rls_policies.sql:107:ON "public"."invoice_payments" 
supabase/migrations-archive/pre-squash-20251123/20251120010000_fix_invoice_rls_policies.sql:116:ON "public"."invoice_payments" 
supabase/migrations-archive/pre-squash-20251123/20251120010000_fix_invoice_rls_policies.sql:125:ON "public"."invoice_payments" 
supabase/migrations-archive/pre-squash-20251123/20251120010000_fix_invoice_rls_policies.sql:137:ON "public"."invoice_payments" 
src/services/invoices.ts:343:        payments:invoice_payments(*)
src/types/database.generated.ts:3359:      invoice_email_logs: {
src/types/database.generated.ts:3404:            foreignKeyName: "invoice_email_logs_invoice_id_fkey"
src/types/database.generated.ts:3411:            foreignKeyName: "invoice_email_logs_quote_id_fkey"
src/types/database.generated.ts:3577:      invoice_payments: {
src/types/database.generated.ts:3610:            foreignKeyName: "invoice_payments_invoice_id_fkey"
src/types/database.generated.ts:6228:          statement_mode: boolean
src/types/database.generated.ts:6241:          statement_mode?: boolean
src/types/database.generated.ts:6254:          statement_mode?: boolean
src/types/oj-projects.ts:24:  statement_mode: boolean | null
src/types/api.ts:103:  failure_badge: number;
src/types/api.ts:115:  attempt_badge: number;
src/types/database.ts:562:  booking_badge: number;
src/hooks/useUnreadMessageCount.ts:8:  badge?: number
exec
/bin/zsh -lc "nl -ba tests/actions/invoices.test.ts | sed -n '360,520p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"remittanceAdvice|receipt|recordPayment\\(\" tests/actions/invoices.test.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 50ms:
368:      const result = await recordPayment(formData)
377:      const result = await recordPayment(formData)
391:      const result = await recordPayment(formData)
405:      const result = await recordPayment(formData)
437:      const result = await recordPayment(formData)
 succeeded in 51ms:
   360	      mockSupabaseClient()
   361	
   362	      const formData = buildFormData({
   363	        invoiceId: 'inv-1',
   364	        paymentDate: '2026-04-01',
   365	        amount: '100',
   366	        paymentMethod: 'bank_transfer',
   367	      })
   368	      const result = await recordPayment(formData)
   369	      expect(result).toEqual({ error: 'You do not have permission to record payments' })
   370	    })
   371	
   372	    it('should return error when required fields are missing', async () => {
   373	      mockedPermission.mockResolvedValue(true)
   374	      mockSupabaseClient()
   375	
   376	      const formData = buildFormData({})
   377	      const result = await recordPayment(formData)
   378	      expect(result).toEqual({ error: 'Missing required fields' })
   379	    })
exec
/bin/zsh -lc "nl -ba src/types/database.generated.ts | sed -n '11750,12495p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
 11750	          p_source?: string
 11751	        }
 11752	        Returns: Json
 11753	      }
 11754	      create_event_transaction: {
 11755	        Args: { p_event_data: Json; p_faqs?: Json }
 11756	        Returns: Json
 11757	      }
 11758	      create_event_waitlist_entry_v05: {
 11759	        Args: {
 11760	          p_customer_id: string
 11761	          p_event_id: string
 11762	          p_requested_seats: number
 11763	        }
 11764	        Returns: Json
 11765	      }
 11766	      create_invoice_transaction: {
 11767	        Args: { p_invoice_data: Json; p_line_items: Json }
 11768	        Returns: Json
 11769	      }
exec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '780,960p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-retainer-projects/route.ts | sed -n '1,140p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/oj-projects/projects.ts | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
   780	
   781	  if (input.persist) {
   782	    if (!input.supabase) throw new Error('Supabase client required for split persist')
   783	    const { data: updatedRow, error: updateError } = await input.supabase
   784	      .from('oj_entries')
   785	      .update({
   786	        miles: partial.miles,
   787	        updated_at: nowIso,
   788	      })
   789	      .eq('id', candidate.id)
   790	      .select('id')
   791	      .maybeSingle()
   792	    if (updateError) throw new Error(updateError.message)
   793	    if (!updatedRow) throw new Error(`Mileage entry not found while splitting for cap: ${candidate.id}`)
   794	
   795	    const { data: inserted, error: insertError } = await input.supabase
   796	      .from('oj_entries')
   797	      .insert(
   798	        buildEntryInsertPayload(candidate, {
   799	          miles: remainderMiles,
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
 succeeded in 51ms:
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
     1	import { NextResponse } from 'next/server'
     2	import { authorizeCronRequest } from '@/lib/cron-auth'
     3	import { createAdminClient } from '@/lib/supabase/admin'
     4	import { formatInTimeZone } from 'date-fns-tz'
     5	import crypto from 'crypto'
     6	
     7	export const dynamic = 'force-dynamic'
     8	export const maxDuration = 60
     9	
    10	const LONDON_TZ = 'Europe/London'
    11	
    12	function deriveClientCode(vendorName: string) {
    13	  const stopWords = new Set(['THE', 'LIMITED', 'LTD', 'CO', 'COMPANY', 'GROUP', 'SERVICES', 'SERVICE', 'AND'])
    14	  const tokens = String(vendorName || '')
    15	    .trim()
    16	    .split(/\s+/)
    17	    .map((t) => t.replace(/[^A-Za-z0-9]/g, ''))
    18	    .filter(Boolean)
    19	    .map((t) => t.toUpperCase())
    20	    .filter((t) => !stopWords.has(t))
exec
/bin/zsh -lc "nl -ba supabase/migrations/20260226120000_oj_entries_one_off.sql | sed -n '1,240p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc 'rg -n "chk_oj_entries_time_fields|oj_entries.*check|one_off" supabase/migrations/20260226120000_oj_entries_one_off.sql supabase/migrations src/types/database.generated.ts' in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 54ms:
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
supabase/migrations/20260226120000_oj_entries_one_off.sql:1:-- Add one_off entry type to oj_entries
supabase/migrations/20260226120000_oj_entries_one_off.sql:8:-- 2. Drop and recreate the entry_type check constraint to include 'one_off'
supabase/migrations/20260226120000_oj_entries_one_off.sql:10:  DROP CONSTRAINT IF EXISTS oj_entries_entry_type_check;
supabase/migrations/20260226120000_oj_entries_one_off.sql:13:  ADD CONSTRAINT oj_entries_entry_type_check
supabase/migrations/20260226120000_oj_entries_one_off.sql:14:  CHECK (entry_type IN ('time', 'mileage', 'one_off'));
supabase/migrations/20260226120000_oj_entries_one_off.sql:16:-- 3. Drop and recreate the time-fields check to allow one_off entries
supabase/migrations/20260226120000_oj_entries_one_off.sql:17:--    (one_off entries have no start_at, end_at, duration, or miles)
supabase/migrations/20260226120000_oj_entries_one_off.sql:19:  DROP CONSTRAINT IF EXISTS chk_oj_entries_time_fields;
supabase/migrations/20260226120000_oj_entries_one_off.sql:22:  ADD CONSTRAINT chk_oj_entries_time_fields
supabase/migrations/20260226120000_oj_entries_one_off.sql:28:    (entry_type = 'one_off' AND amount_ex_vat_snapshot IS NOT NULL AND miles IS NULL AND start_at IS NULL AND end_at IS NULL AND duration_minutes_rounded IS NULL)
supabase/migrations/20260226120000_oj_entries_one_off.sql:1:-- Add one_off entry type to oj_entries
supabase/migrations/20260226120000_oj_entries_one_off.sql:8:-- 2. Drop and recreate the entry_type check constraint to include 'one_off'
supabase/migrations/20260226120000_oj_entries_one_off.sql:10:  DROP CONSTRAINT IF EXISTS oj_entries_entry_type_check;
supabase/migrations/20260226120000_oj_entries_one_off.sql:13:  ADD CONSTRAINT oj_entries_entry_type_check
supabase/migrations/20260226120000_oj_entries_one_off.sql:14:  CHECK (entry_type IN ('time', 'mileage', 'one_off'));
supabase/migrations/20260226120000_oj_entries_one_off.sql:16:-- 3. Drop and recreate the time-fields check to allow one_off entries
supabase/migrations/20260226120000_oj_entries_one_off.sql:17:--    (one_off entries have no start_at, end_at, duration, or miles)
supabase/migrations/20260226120000_oj_entries_one_off.sql:19:  DROP CONSTRAINT IF EXISTS chk_oj_entries_time_fields;
supabase/migrations/20260226120000_oj_entries_one_off.sql:22:  ADD CONSTRAINT chk_oj_entries_time_fields
supabase/migrations/20260226120000_oj_entries_one_off.sql:28:    (entry_type = 'one_off' AND amount_ex_vat_snapshot IS NOT NULL AND miles IS NULL AND start_at IS NULL AND end_at IS NULL AND duration_minutes_rounded IS NULL)
exec
/bin/zsh -lc 'rg -n "client-statement|Account Statement|statement-.*pdf|getClientStatement|oj-statement|statement mode|Payment history|Payments tab|billing alert" src docs/superpowers/specs' in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc 'rg -n "record_invoice_payment_transaction|invoice_email_logs|void|credit_notes|credit note|remittance_advice" supabase/migrations src' in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
src/services/private-bookings/payments.ts:472:// Payment history & admin payment CRUD
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:16:4. **Completeness recommendations** — payment history on project detail, billing cron alerting, statement mode UI clarity, void/credit note support
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:103:**File:** `src/app/actions/oj-projects/client-statement.ts`
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:106:export async function getClientStatement(
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:133:**File:** `src/lib/oj-statement.ts`
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:161:- **Subject:** `Account Statement — {Vendor Name} — {Month Year} to {Month Year}`
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:163:- **Attachment:** Statement PDF (named `statement-{vendor-code}-{from}-{to}.pdf`)
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:206:### 4.1 — Payment history on project detail page
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:233:- Visual indicator when statement mode is active (e.g. badge on the client card)
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:258:- Changes to the billing cron's core logic (cap mode, statement mode algorithms)
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:272:| Server actions | `client-balance.ts`, `client-statement.ts` (new), `projects.ts`, `invoices.ts` | Edit + New |
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:273:| Lib | `oj-statement.ts` (new), `oj-projects/utils.ts` (new), `microsoft-graph.ts` | New + Edit |
src/app/(authenticated)/private-bookings/[id]/PaymentHistoryTable.tsx:146:      <p className="text-xs font-medium text-gray-500 mb-2">Payment history</p>
 succeeded in 51ms:
Total output lines: 971

src/services/private-bookings/payments.ts:50:  // cancellation_reason untouched to avoid unnecessary churn.
src/services/private-bookings/payments.ts:533:): Promise<void> {
src/services/private-bookings/payments.ts:557:export async function deleteBalancePayment(paymentId: string, bookingId: string): Promise<void> {
src/services/private-bookings/payments.ts:581:): Promise<void> {
src/services/private-bookings/payments.ts:592: * Unlike updateDeposit, this does NOT write deposit_payment_method (avoids method pollution).
src/services/private-bookings/payments.ts:598:): Promise<void> {
src/services/private-bookings/mutations.ts:35:async function sendCreationSms(booking: any, phone?: string | null): Promise<void> {
src/services/private-bookings/mutations.ts:228:    void sendCreationSms(bookingWithHoldExpiry, normalizedContactPhone).catch((smsError) => {
src/services/private-bookings/mutations.ts:1499:    // Best-effort rollback to avoid leaving partially reordered items.
src/services/cashing-up.service.ts:7:    // DEF-M02: use format() (local time) instead of toISOString() (UTC) to avoid date boundary shift
src/services/cashing-up.service.ts:184:      // Check for existing session to avoid constraint violation
src/services/cashing-up.service.ts:378:    // Compute the week end date (DEF-M02: use format() to avoid UTC toISOString shift)
src/services/cashing-up.service.ts:448:      const dow = new Date(sessionDate + 'T12:00:00').getDay(); // DEF-M02: noon avoids UTC boundary shift
src/services/cashing-up.service.ts:548:    const dayOfWeek = new Date(date + 'T12:00:00').getDay(); // DEF-M02: noon avoids UTC boundary shift
src/services/cashing-up.service.ts:569:    const dayOfWeek = new Date(date + 'T12:00:00').getDay(); // DEF-M02: noon avoids UTC boundary shift
src/services/cashing-up.service.ts:613:    const requestedDate = new Date(date + 'T12:00:00'); // DEF-M02: noon avoids UTC boundary shift
src/services/cashing-up.service.ts:682:    // 1. Generate all 7 dates for the week (DEF-M02: noon + format() avoids UTC boundary shift)
supabase/migrations/20260228000004_auto_close_past_event_tasks.sql:7:RETURNS void
codex
I have enough to answer the payment flow. I’m doing one last targeted pass on `credit_note` and DB invoice status definitions so I can separate “declared in schema” from “actually implemented in app code.”
exec
/bin/zsh -lc "rg -n --hidden --glob '"'!node_modules'"' --glob '"'!.git'"' \"credit_note|credit note|credit-note|creditnote\" src tests supabase/migrations-archive/pre-squash-20251123/20260401130000_create_invoice_transactions.sql supabase/migrations/20251123120000_squashed.sql" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n --hidden --glob '"'!node_modules'"' --glob '"'!.git'"' \"invoice_emails|invoice_email_logs|email_type\" src tests supabase/migrations/20251123120000_squashed.sql" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
supabase/migrations/20251123120000_squashed.sql:12050:    CONSTRAINT invoice_emails_email_type_check CHECK (((email_type)::text = ANY ((ARRAY['new_invoice'::character varying, 'reminder'::character varying, 'chase'::character varying, 'credit_note'::character varying, 'statement'::character varying, 'quote'::character varying])::text[]))),
 succeeded in 50ms:
supabase/migrations/20251123120000_squashed.sql:12006:CREATE TABLE IF NOT EXISTS public.invoice_email_logs (
supabase/migrations/20251123120000_squashed.sql:12020:    CONSTRAINT invoice_email_logs_status_check CHECK (((status)::text = ANY ((ARRAY['sent'::character varying, 'failed'::character varying, 'bounced'::character varying])::text[])))
supabase/migrations/20251123120000_squashed.sql:12034:CREATE TABLE IF NOT EXISTS public.invoice_emails (
supabase/migrations/20251123120000_squashed.sql:12037:    email_type character varying(50) NOT NULL,
supabase/migrations/20251123120000_squashed.sql:12050:    CONSTRAINT invoice_emails_email_type_check CHECK (((email_type)::text = ANY ((ARRAY['new_invoice'::character varying, 'reminder'::character varying, 'chase'::character varying, 'credit_note'::character varying, 'statement'::character varying, 'quote'::character varying])::text[]))),
supabase/migrations/20251123120000_squashed.sql:12051:    CONSTRAINT invoice_emails_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'sent'::character varying, 'failed'::character varying])::text[])))
tests/lib/invoiceReminderSafety.test.ts:13:      error: { message: 'invoice_email_logs read failed' }
tests/lib/invoiceReminderSafety.test.ts:31:      error: 'invoice_email_logs read failed'
src/types/database.generated.ts:3359:      invoice_email_logs: {
src/types/database.generated.ts:3404:            foreignKeyName: "invoice_email_logs_invoice_id_fkey"
src/types/database.generated.ts:3411:            foreignKeyName: "invoice_email_logs_quote_id_fkey"
src/types/database.generated.ts:3452:      invoice_emails: {
src/types/database.generated.ts:3460:          email_type: string
src/types/database.generated.ts:3477:          email_type: string
src/types/database.generated.ts:3494:          email_type?: string
src/types/database.generated.ts:3506:            foreignKeyName: "invoice_emails_created_by_fkey"
src/types/database.generated.ts:8687:          email_type: string
src/types/database.generated.ts:8702:          email_type: string
src/types/database.generated.ts:8717:          email_type?: string
src/lib/invoice-reminder-safety.ts:20:    .from('invoice_email_logs')
exec
/bin/zsh -lc "nl -ba src/lib/invoice-template.ts | sed -n '460,500p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
   460	      <div class="summary-row">
   461	        <span class="summary-label">VAT</span>
   462	        <span class="summary-value">${formatCurrency(invoice.vat_amount)}</span>
   463	      </div>
   464	      
   465	      <div class="summary-row total">
   466	        <span>Total</span>
   467	        <span>${formatCurrency(invoice.total_amount)}</span>
   468	      </div>
   469	    </div>
   470	  </div>
   471	
   472	  ${invoice.notes ? `
   473	    <div class="notes-section">
   474	      <h3>Notes</h3>
   475	      <p>${formatMultiline(invoice.notes)}</p>
   476	    </div>
   477	  ` : ''}
   478	
   479	  ${invoice.status !== 'paid' && invoice.status !== 'void' ? `
exec
/bin/zsh -lc "nl -ba supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba supabase/migrations/20251123120000_squashed.sql | sed -n '18220,18310p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-retainer-projects/route.ts | sed -n '1,120p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/oj-projects/projects.ts | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
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
 succeeded in 52ms:
 18220	$$;
 18221	
 18222	-- Function to record payment and update invoice status
 18223	CREATE OR REPLACE FUNCTION record_invoice_payment_transaction(
 18224	  p_payment_data JSONB
 18225	)
 18226	RETURNS JSONB
 18227	LANGUAGE plpgsql
 18228	SECURITY DEFINER
 18229	AS $$
 18230	DECLARE
 18231	  v_payment_id UUID;
 18232	  v_invoice_id UUID;
 18233	  v_amount DECIMAL;
 18234	  v_current_paid DECIMAL;
 18235	  v_total DECIMAL;
 18236	  v_new_paid DECIMAL;
 18237	  v_new_status text; -- Changed from invoice_status to text
 18238	  v_payment_record JSONB;
 18239	BEGIN
 succeeded in 51ms:
     1	import { NextResponse } from 'next/server'
     2	import { authorizeCronRequest } from '@/lib/cron-auth'
     3	import { createAdminClient } from '@/lib/supabase/admin'
     4	import { formatInTimeZone } from 'date-fns-tz'
     5	import crypto from 'crypto'
     6	
     7	export const dynamic = 'force-dynamic'
     8	export const maxDuration = 60
     9	
    10	const LONDON_TZ = 'Europe/London'
    11	
    12	function deriveClientCode(vendorName: string) {
    13	  const stopWords = new Set(['THE', 'LIMITED', 'LTD', 'CO', 'COMPANY', 'GROUP', 'SERVICES', 'SERVICE', 'AND'])
    14	  const tokens = String(vendorName || '')
    15	    .trim()
    16	    .split(/\s+/)
    17	    .map((t) => t.replace(/[^A-Za-z0-9]/g, ''))
    18	    .filter(Boolean)
    19	    .map((t) => t.toUpperCase())
    20	    .filter((t) => !stopWords.has(t))
 succeeded in 50ms:
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
exec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/oj-projects/clients/page.tsx' | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/oj-projects/clients/page.tsx' | sed -n '700,860p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/invoices.ts | sed -n '1,340p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/oj-projects/projects/[id]/page.tsx' | sed -n '1,320p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
   700	                    required
   701	                  >
   702	                    <option value="full">Pay in full</option>
   703	                    <option value="cap">Monthly cap</option>
   704	                  </Select>
   705	                </FormGroup>
   706	
   707	                <FormGroup label="Hourly Rate (ex VAT)" required>
   708	                  <Input
   709	                    type="number"
   710	                    min="0"
   711	                    step="0.01"
   712	                    value={settings.hourly_rate_ex_vat}
   713	                    onChange={(e) => setSettings({ ...settings, hourly_rate_ex_vat: e.target.value })}
   714	                    disabled={!canEditSettings}
   715	                    required
   716	                    leftElement={<span className="text-gray-400 pl-3">£</span>}
   717	                  />
   718	                </FormGroup>
   719	
 succeeded in 52ms:
     1	'use client'
     2	
     3	import { useEffect, useMemo, useState } from 'react'
     4	import { useRouter } from 'next/navigation'
     5	import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
     6	import { Card, CardTitle } from '@/components/ui-v2/layout/Card'
     7	import { Button, IconButton } from '@/components/ui-v2/forms/Button'
     8	import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
     9	import { Input } from '@/components/ui-v2/forms/Input'
    10	import { Select } from '@/components/ui-v2/forms/Select'
    11	import { Textarea } from '@/components/ui-v2/forms/Textarea'
    12	import { Checkbox } from '@/components/ui-v2/forms/Checkbox'
    13	import { Alert } from '@/components/ui-v2/feedback/Alert'
    14	import { toast } from '@/components/ui-v2/feedback/Toast'
    15	import { EmptyState } from '@/components/ui-v2/display/EmptyState'
    16	import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
    17	import { usePermissions } from '@/contexts/PermissionContext'
    18	import { createVendor, getVendors } from '@/app/actions/vendors'
    19	import { getVendorBillingSettings, upsertVendorBillingSettings } from '@/app/actions/oj-projects/vendor-settings'
    20	import { getOjProjectsEmailStatus } from '@/app/actions/oj-projects/system'
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
 succeeded in 52ms:
     1	'use client'
     2	
     3	import { useEffect, useMemo, useState } from 'react'
     4	import { useParams, useRouter } from 'next/navigation'
     5	import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
     6	import { Card, CardTitle } from '@/components/ui-v2/layout/Card'
     7	import { Button } from '@/components/ui-v2/forms/Button'
     8	import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
     9	import { Select } from '@/components/ui-v2/forms/Select'
    10	import { Alert } from '@/components/ui-v2/feedback/Alert'
    11	import { toast } from '@/components/ui-v2/feedback/Toast'
    12	import { EmptyState } from '@/components/ui-v2/display/EmptyState'
    13	import { usePermissions } from '@/contexts/PermissionContext'
    14	import { deleteProject, getProject, updateProjectStatus } from '@/app/actions/oj-projects/projects'
    15	import { addProjectContact, removeProjectContact } from '@/app/actions/oj-projects/project-contacts'
    16	import { getVendorContacts } from '@/app/actions/vendor-contacts'
    17	import { getEntries } from '@/app/actions/oj-projects/entries'
    18	import { formatDateDdMmmmYyyy } from '@/lib/dateUtils'
    19	import {
    20	  ArrowLeft,
exec
/bin/zsh -lc "nl -ba src/app/\\(authenticated\\)/oj-projects/clients/page.tsx | sed -n '540,720p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/\\(authenticated\\)/oj-projects/clients/page.tsx | sed -n '720,860p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/\\(authenticated\\)/oj-projects/projects/[id]/page.tsx | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/\\(authenticated\\)/oj-projects/projects/[id]/page.tsx | sed -n '260,560p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 50ms:
zsh:1: no matches found: src/app/(authenticated)/oj-projects/projects/[id]/page.tsx
 succeeded in 50ms:
   720	                <FormGroup label="VAT Rate (%)" required>
   721	                  <Input
   722	                    type="number"
   723	                    min="0"
   724	                    step="0.01"
   725	                    value={settings.vat_rate}
   726	                    onChange={(e) => setSettings({ ...settings, vat_rate: e.target.value })}
   727	                    disabled={!canEditSettings}
   728	                    required
   729	                    rightElement={<span className="text-gray-400 pr-3">%</span>}
   730	                  />
   731	                </FormGroup>
   732	
   733	                {settings.billing_mode === 'cap' && (
   734	                  <FormGroup label="Monthly Cap (inc VAT)" required>
   735	                    <Input
   736	                      type="number"
   737	                      min="0"
   738	                      step="0.01"
   739	                      value={settings.monthly_cap_inc_vat}
 succeeded in 50ms:
   540	          <div className="flex-1">
   541	            <FormGroup label="Select Client to Manage" className="mb-0">
   542	              <Select
   543	                value={vendorId}
   544	                onChange={(e) => setVendorId(e.target.value)}
   545	                className="text-lg font-medium"
   546	              >
   547	                {vendors.map((v) => (
   548	                  <option key={v.id} value={v.id}>
   549	                    {v.name}
   550	                  </option>
   551	                ))}
   552	              </Select>
   553	            </FormGroup>
   554	          </div>
   555	          <div className="text-sm text-gray-500 pb-2 md:text-right">
   556	            <p>Manage billing rates, recurring charges, and invoice contacts.</p>
   557	          </div>
   558	        </div>
   559	      </Card>
 succeeded in 51ms:
zsh:1: no matches found: src/app/(authenticated)/oj-projects/projects/[id]/page.tsx
exec
/bin/zsh -lc "nl -ba src/app/actions/invoices.ts | sed -n '420,520p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/invoices.ts | sed -n '680,820p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/invoices.ts | sed -n '820,980p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"void|credit note|credit_note|credit_notes|write off|written_off\" src/app/actions/invoices.ts src/services/invoices.ts src/types/invoices.ts supabase/migrations src/app -g '"'!**/*.map'"'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
   680	    const amountRaw = String(formData.get('amount') || '').trim()
   681	    const amount = Number.parseFloat(amountRaw)
   682	    const paymentMethod = String(formData.get('paymentMethod') || '').trim()
   683	    const reference = String(formData.get('reference') || '').trim()
   684	    const notes = String(formData.get('notes') || '').trim()
   685	
   686	    if (!invoiceId || !paymentDate || !paymentMethod || !amountRaw) {
   687	      return { error: 'Missing required fields' }
   688	    }
   689	
   690	    if (!Number.isFinite(amount) || amount <= 0) {
   691	      return { error: 'Payment amount must be greater than zero' }
   692	    }
   693	
   694	    if (Number.isNaN(Date.parse(paymentDate))) {
   695	      return { error: 'Payment date is invalid' }
   696	    }
   697	
   698	    const { data: invoiceBeforePayment, error: invoiceBeforeError } = await supabase
   699	      .from('invoices')
 succeeded in 52ms:
   820	    }
   821	
   822	    if (!lineItems || lineItems.length === 0) {
   823	      return { error: 'At least one line item is required' }
   824	    }
   825	
   826	    const updatedInvoice = await InvoiceService.updateInvoice(invoiceId, {
   827	      ...validatedData,
   828	      line_items: lineItems
   829	    });
   830	
   831	    await logAuditEvent({
   832	      user_id: user.id,
   833	      user_email: user.email,
   834	      operation_type: 'update',
   835	      resource_type: 'invoice',
   836	      resource_id: invoiceId,
   837	      operation_status: 'success',
   838	      new_values: {
   839	        invoice_number: updatedInvoice.invoice_number,
 succeeded in 52ms:
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
   430	    const newStatus = String(rawStatus) as InvoiceStatus
   431	    if (!VALID_INVOICE_STATUSES.includes(newStatus)) {
   432	      return { error: 'Invalid status' }
   433	    }
   434	
   435	    // Payment statuses must only be set through the dedicated payment recording flow
   436	    if (newStatus === 'paid' || newStatus === 'partially_paid') {
   437	      return { error: 'Payment statuses must be set through the payment recording flow' }
   438	    }
   439	
 succeeded in 52ms:
Total output lines: 492

src/types/invoices.ts:17:export type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue' | 'void' | 'written_off'
src/app/actions/invoices.ts:428:      'draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void', 'written_off'
src/app/actions/invoices.ts:440:    // Prevent voiding invoices that have linked OJ Projects items, unless explicitly overridden.
src/app/actions/invoices.ts:441:    if (newStatus === 'void' && !force) {
src/services/invoices.ts:277:    // The DB-level persistOverdueInvoices() write was removed from this read path to avoid
src/services/invoices.ts:335:    // to avoid mutations on every detail fetch. It should run in a dedicated cron job instead.
src/app/global-error.tsx:11:  reset: () => void;
supabase/migrations/20260307000001_reconciliation_notes_unique_constraint.sql:11:-- Drop the non-unique index first to avoid duplicate index overhead
src/app/(staff-portal)/portal/leave/LeaveRequestForm.tsx:30:  // Compute today's London date client-side using Intl — avoids UTC offset bugs
src/app/m/[token]/charge-request/action/route.ts:51:): Promise<void> {
src/app/api/employees/[employee_id]/starter-pack/route.ts:49:    // as JPEG at 82% quality. This keeps documents legible on A4 while avoiding
supabase/migrations/20260228000004_auto_close_past_event_tasks.sql:7:RETURNS void
src/app/(employee-onboarding)/onboarding/[token]/steps/PersonalStep.tsx:19:  onSuccess: (data: PersonalData) => void;
src/app/(employee-onboarding)/onboarding/[token]/steps/FinancialStep.tsx:19:  onSuccess: (data: Omit<FinancialData, 'bank_sort_code_confirm' | 'bank_account_number_confirm'>) => void;
src/app/(employee-onboarding)/onboarding/[token]/steps/EmergencyContactsStep.tsx:21:  onSuccess: (data: EmergencyContactsData) => void;
src/app/(employee-onboarding)/onboarding/[token]/steps/EmergencyContactsStep.tsx:85:    onChange: (field: keyof ContactData, value: string) => void,
src/app/(employee-onboarding)/onboarding/[token]/steps/CreateAccountStep.tsx:9:  onSuccess: () => void;
src/app/api/stripe/webhook/route.ts:70:): Promise<void> {
exec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/oj-projects/projects/[id]/page.tsx' | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/oj-projects/projects/[id]/page.tsx' | sed -n '260,560p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"invoice_id|payment|Payments|paid|outstanding|invoice\" 'src/app/(authenticated)/oj-projects/projects/[id]/page.tsx' src/app/actions/oj-projects/projects.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
     1	'use client'
     2	
     3	import { useEffect, useMemo, useState } from 'react'
     4	import { useParams, useRouter } from 'next/navigation'
     5	import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
     6	import { Card, CardTitle } from '@/components/ui-v2/layout/Card'
     7	import { Button } from '@/components/ui-v2/forms/Button'
     8	import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
     9	import { Select } from '@/components/ui-v2/forms/Select'
    10	import { Alert } from '@/components/ui-v2/feedback/Alert'
    11	import { toast } from '@/components/ui-v2/feedback/Toast'
    12	import { EmptyState } from '@/components/ui-v2/display/EmptyState'
    13	import { usePermissions } from '@/contexts/PermissionContext'
    14	import { deleteProject, getProject, updateProjectStatus } from '@/app/actions/oj-projects/projects'
    15	import { addProjectContact, removeProjectContact } from '@/app/actions/oj-projects/project-contacts'
    16	import { getVendorContacts } from '@/app/actions/vendor-contacts'
    17	import { getEntries } from '@/app/actions/oj-projects/entries'
    18	import { formatDateDdMmmmYyyy } from '@/lib/dateUtils'
    19	import {
    20	  ArrowLeft,
 succeeded in 52ms:
   260	  const navItems = [
   261	    { label: 'Dashboard', href: '/oj-projects', icon: <LayoutDashboard className="w-4 h-4" /> },
   262	    { label: 'Projects', href: '/oj-projects/projects', icon: <Briefcase className="w-4 h-4" /> },
   263	    { label: 'Entries', href: '/oj-projects/entries', icon: <List className="w-4 h-4" /> },
   264	    { label: 'Clients', href: '/oj-projects/clients', icon: <Users className="w-4 h-4" /> },
   265	    { label: 'Work Types', href: '/oj-projects/work-types', icon: <List className="w-4 h-4" /> },
   266	  ]
   267	
   268	  return (
   269	    <PageLayout
   270	      title={project.project_code}
   271	      subtitle={project.project_name}
   272	      navItems={navItems}
   273	      backButton={{ label: 'Back to Projects', href: '/oj-projects/projects' }}
   274	      headerActions={
   275	        <div className="flex gap-2">
   276	          <Button
   277	            variant="secondary"
   278	            disabled={!canEdit}
   279	            onClick={() => router.push(`/oj-projects/projects?edit=${projectId}`)}
 succeeded in 51ms:
src/app/actions/oj-projects/projects.ts:70:      .from('invoice_vendors')
src/app/actions/oj-projects/projects.ts:99:      vendor:invoice_vendors(
src/app/actions/oj-projects/projects.ts:149:      vendor:invoice_vendors(*),
src/app/actions/oj-projects/projects.ts:152:        contact:invoice_vendor_contacts(*)
src/app/(authenticated)/oj-projects/projects/[id]/page.tsx:116:      paid_ex_vat: 0,
src/app/(authenticated)/oj-projects/projects/[id]/page.tsx:137:      if (entry.status === 'paid') t.paid_ex_vat += exVat
src/app/(authenticated)/oj-projects/projects/[id]/page.tsx:146:    t.paid_ex_vat = roundCurrency(t.paid_ex_vat)
src/app/(authenticated)/oj-projects/projects/[id]/page.tsx:343:                <div className="font-semibold text-green-600">{formatCurrency(totals.paid_ex_vat)}</div>
src/app/(authenticated)/oj-projects/projects/[id]/page.tsx:443:                              entry.status === 'paid' ? 'bg-green-100 text-green-800' :
exec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/oj-projects/clients/page.tsx' | sed -n '520,700p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"Statement|statement|one_off_ex_vat|unbilledRecurringTotal|unbilledTimeTotal|unbilledMileageTotal|balance\" 'src/app/(authenticated)/oj-projects/clients/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/oj-projects/clients/page.tsx' | sed -n '860,1100p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
   520	      {selectedVendor && !invoiceRecipientConfigured && (
   521	        <Alert
   522	          variant="warning"
   523	          className="mb-6"
   524	          title="No invoice recipient email configured"
   525	          description="Add a vendor email or a contact email (and optionally mark a primary contact) to enable automated billing emails."
   526	        />
   527	      )}
   528	      {selectedVendor && capMisconfigured && (
   529	        <Alert
   530	          variant="warning"
   531	          className="mb-6"
   532	          title="Monthly cap is smaller than recurring charges"
   533	          description={`Active recurring charges total £${recurringChargesExVat.toFixed(2)} ex VAT (£${recurringChargesIncVat.toFixed(2)} inc VAT), which exceeds the monthly billing cap of £${Number.parseFloat(settings.monthly_cap_inc_vat).toFixed(2)}. Billing will fail until the cap is increased or charges are reduced.`}
   534	        />
   535	      )}
   536	
   537	      {/* Client Selection Header */}
   538	      <Card className="mb-6" variant="elevated">
   539	        <div className="flex flex-col md:flex-row md:items-end gap-4">
 succeeded in 50ms:
28:import { getClientBalance } from '@/app/actions/oj-projects/client-balance'
29:import type { ClientBalance } from '@/app/actions/oj-projects/client-balance'
60:  statement_mode: boolean
118:    statement_mode: false,
190:  const [balance, setBalance] = useState<ClientBalance | null>(null)
191:  const [balanceLoading, setBalanceLoading] = useState(false)
273:        statement_mode: !!s?.statement_mode,
281:      // Load balance separately so it doesn't block the settings from rendering
283:        if (!res.error && res.balance) setBalance(res.balance)
312:      fd.append('statement_mode', settings.statement_mode ? 'on' : 'off')
576:          {balanceLoading ? (
577:            <div className="text-sm text-gray-400 py-2">Loading balance…</div>
578:          ) : balance ? (
584:                  <div className="text-2xl font-bold text-red-700">£{balance.unpaidInvoiceBalance.toFixed(2)}</div>
589:                  <div className="text-2xl font-bold text-amber-800">£{balance.unbilledTotal.toFixed(2)}</div>
591:                    {balance.unbilledTimeTotal > 0 && `Time £${balance.unbilledTimeTotal.toFixed(2)}`}
592:                    {balance.unbilledTimeTotal > 0 && (balance.unbilledMileageTotal > 0 || balance.unbilledRecurringTotal > 0) && ' · '}
593:                    {balance.unbilledMileageTotal > 0 && `Mileage £${balance.unbilledMileageTotal.toFixed(2)}`}
594:                    {balance.unbilledMileageTotal > 0 && balance.unbilledRecurringTotal > 0 && ' · '}
595:                    {balance.unbilledRecurringTotal > 0 && `Recurring £${balance.unbilledRecurringTotal.toFixed(2)}`}
 succeeded in 51ms:
   860		                      </div>
   861		                    </div>
   862		                  ))}
   863		                </div>
   864		              )}
   865	
   866	              <div className="border-t border-gray-100 pt-4">
   867	                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{chargeForm.id ? 'Edit Charge' : 'Add New Charge'}</h4>
   868	                <form onSubmit={saveCharge} className="space-y-3">
   869	                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
   870	                    <FormGroup label="Description" className="sm:col-span-2 mb-0">
   871	                      <Input
   872	                        value={chargeForm.description}
   873	                        onChange={(e) => setChargeForm({ ...chargeForm, description: e.target.value })}
   874	                        disabled={!canEditSettings}
   875	                        required
   876	                        placeholder="e.g. Hosting"
   877	                      />
   878	                    </FormGroup>
   879	                    <FormGroup label="Amount (ex VAT)" className="mb-0">
codex
One edge case is worth checking before I close: whether the app/UI blocks payment recording for `void` invoices, or whether that restriction only exists in the detail screen while the server action still allows it. I’m verifying the payment page briefly so I can call out the real enforcement boundary.
exec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/invoices/[id]/payment/page.tsx' | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"Record Payment|recordPayment\\(|status "'!== '"'paid' && status "'!== '"'void'|void\" 'src/app/(authenticated)/invoices/[id]/payment/page.tsx' 'src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '1016,1034p;1708,1726p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
src/app/(authenticated)/invoices/[id]/payment/page.tsx:125:      const result = await recordPayment(formData)
src/app/(authenticated)/invoices/[id]/payment/page.tsx:143:        title="Record Payment"
src/app/(authenticated)/invoices/[id]/payment/page.tsx:159:        title="Record Payment"
src/app/(authenticated)/invoices/[id]/payment/page.tsx:171:      title="Record Payment"
src/app/(authenticated)/invoices/[id]/payment/page.tsx:280:              Record Payment
src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx:101:    if (newStatus === 'void') {
src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx:116:      if (newStatus === 'void' && result?.error && result?.code === 'OJ_LINKED_ITEMS') {
src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx:117:        const force = window.confirm(`${result.error}\n\nForce void anyway? This will not unbill linked OJ Projects items.`)
src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx:180:      case 'void': return 'secondary'
src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx:479:              {invoice.status !== 'paid' && invoice.status !== 'void' && (
src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx:490:                  Record Payment
src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx:537:              {invoice.status !== 'void' && invoice.status !== 'written_off' && canEdit && (
src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx:541:                  onClick={() => handleStatusChange('void')}
 succeeded in 52ms:
     1	'use client'
     2	
     3	export const dynamic = 'force-dynamic'
     4	
     5	import { useState, useEffect } from 'react'
     6	import { useParams, useRouter } from 'next/navigation'
     7	import { getInvoice, recordPayment } from '@/app/actions/invoices'
     8	import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
     9	import { Card } from '@/components/ui-v2/layout/Card'
    10	import { Button } from '@/components/ui-v2/forms/Button'
    11	import { Input } from '@/components/ui-v2/forms/Input'
    12	import { Select } from '@/components/ui-v2/forms/Select'
    13	import { Textarea } from '@/components/ui-v2/forms/Textarea'
    14	import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
    15	import { Alert } from '@/components/ui-v2/feedback/Alert'
    16	import { toast } from '@/components/ui-v2/feedback/Toast'
    17	import { Save } from 'lucide-react'
    18	import { getTodayIsoDate } from '@/lib/dateUtils'
    19	import type { InvoiceWithDetails, PaymentMethod } from '@/types/invoices'
    20	import { usePermissions } from '@/contexts/PermissionContext'
 succeeded in 52ms:
  1016	    if (incVat <= 0) continue
  1017	    unbilledRecurringTotal = roundMoney(unbilledRecurringTotal + incVat)
  1018	  }
  1019	
  1020	  const { data: unpaidInvoices, error: unpaidInvoiceError } = await input.supabase
  1021	    .from('invoices')
  1022	    .select('id, total_amount, paid_amount, status, reference')
  1023	    .eq('vendor_id', input.vendorId)
  1024	    .is('deleted_at', null)
  1025	    .ilike('reference', 'OJ Projects %')
  1026	    .not('status', 'in', '(paid,void,written_off)')
  1027	    .limit(10000)
  1028	
  1029	  if (unpaidInvoiceError) throw new Error(unpaidInvoiceError.message)
  1030	
  1031	  const unpaidInvoiceBalance = roundMoney(
  1032	    (unpaidInvoices || []).reduce((acc: number, inv: any) => {
  1033	      const total = Number(inv.total_amount || 0)
  1034	      const paid = Number(inv.paid_amount || 0)
  1708	    unbilledRecurringTotal = roundMoney(unbilledRecurringTotal + incVat)
exec
/bin/zsh -lc "nl -ba src/app/api/oj-projects/billing-preview/route.ts | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"computeStatementBalanceBefore|buildStatementLineItems|buildStatementNotes|statementMode|statement_mode\" src/app/api/cron/oj-projects-billing/route.ts src/app/api/oj-projects/billing-preview/route.ts src/app/\\(authenticated\\)/oj-projects/clients/page.tsx" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "ls src/app/actions/oj-projects && ls src/lib | rg 'oj-statement|invoice-template-compact|pdf'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
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
 succeeded in 51ms:
src/app/(authenticated)/oj-projects/clients/page.tsx:60:  statement_mode: boolean
src/app/(authenticated)/oj-projects/clients/page.tsx:118:    statement_mode: false,
src/app/(authenticated)/oj-projects/clients/page.tsx:273:        statement_mode: !!s?.statement_mode,
src/app/(authenticated)/oj-projects/clients/page.tsx:312:      fd.append('statement_mode', settings.statement_mode ? 'on' : 'off')
src/app/(authenticated)/oj-projects/clients/page.tsx:749:                    checked={settings.statement_mode}
src/app/(authenticated)/oj-projects/clients/page.tsx:750:                    onChange={(e) => setSettings({ ...settings, statement_mode: e.target.checked })}
src/app/(authenticated)/oj-projects/clients/page.tsx:794:                  {settings.statement_mode ? 'Preview Statement Invoice' : 'Preview Invoice (Dry Run)'}
src/app/(authenticated)/oj-projects/clients/page.tsx:1029:        title={previewVendor?.statement_mode ? 'Statement Invoice Preview (Dry Run)' : 'Invoice Preview (Dry Run)'}
src/app/api/cron/oj-projects-billing/route.ts:979:async function computeStatementBalanceBefore(input: {
src/app/api/cron/oj-projects-billing/route.ts:1117:function buildStatementLineItems(input: {
src/app/api/cron/oj-projects-billing/route.ts:1317:  const statementMode = !!settings?.statement_mode
src/app/api/cron/oj-projects-billing/route.ts:1478:  if (statementMode && billingMode === 'cap' && capIncVat != null && capIncVat > 0) {
src/app/api/cron/oj-projects-billing/route.ts:1479:    const summary = await computeStatementBalanceBefore({
src/app/api/cron/oj-projects-billing/route.ts:1525:      statement_mode: statementMode,
src/app/api/cron/oj-projects-billing/route.ts:1533:  let lineItems = statementMode
src/app/api/cron/oj-projects-billing/route.ts:1534:    ? buildStatementLineItems({
src/app/api/cron/oj-projects-billing/route.ts:1555:      statement_mode: statementMode,
src/app/api/cron/oj-projects-billing/route.ts:1562:  if (statementMode && billingMode === 'cap' && capIncVat != null && capIncVat > 0 && statementBalanceBefore != null) {
src/app/api/cron/oj-projects-billing/route.ts:1578:  if (statementMode) {
src/app/api/cron/oj-projects-billing/route.ts:1579:    notes = await buildStatementNotes({
exec
/bin/zsh -lc "rg -n \"client statement|account statement|statement pdf|statement-.*\\.pdf|generatePDFFromHTML|invoice-template-compact|remittance_advice|credit_note\" src/lib src/app" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
__tests__
client-balance.ts
entries.ts
project-contacts.ts
projects.ts
recurring-charges.ts
system.ts
vendor-settings.ts
work-types.ts
cashing-up-pdf-template.ts
invoice-template-compact.ts
pdf-generator.ts
 succeeded in 51ms:
src/lib/oj-timesheet.ts:1:import { generatePDFFromHTML } from '@/lib/pdf-generator'
src/lib/oj-timesheet.ts:72:  return generatePDFFromHTML(html, {
src/lib/microsoft-graph.ts:5:import type { InvoiceDocumentKind, InvoiceRemittanceDetails } from '@/lib/invoice-template-compact'
src/lib/microsoft-graph.ts:103:    const isRemittanceAdvice = documentKind === 'remittance_advice'
src/app/api/employees/[employee_id]/starter-pack/route.ts:8:import { generatePDFFromHTML } from '@/lib/pdf-generator'
src/app/api/employees/[employee_id]/starter-pack/route.ts:193:    let pdfBuffer = await generatePDFFromHTML(html, {
src/lib/invoice-template-compact.ts:8:export type InvoiceDocumentKind = 'invoice' | 'remittance_advice'
src/lib/invoice-template-compact.ts:26:  const isRemittanceAdvice = documentKind === 'remittance_advice'
src/app/api/employees/[employee_id]/employment-contract/route.ts:7:import { generatePDFFromHTML } from '@/lib/pdf-generator'
src/app/api/employees/[employee_id]/employment-contract/route.ts:66:    const pdfBuffer = await generatePDFFromHTML(html, {
src/app/actions/invoices.ts:207:      documentKind: 'remittance_advice',
src/lib/pdf-generator.ts:7:} from './invoice-template-compact'
src/lib/pdf-generator.ts:224:export async function generatePDFFromHTML(
src/app/api/cashup/weekly/print/route.ts:7:import { generatePDFFromHTML } from '@/lib/pdf-generator';
src/app/api/cashup/weekly/print/route.ts:59:    const pdfBuffer = await generatePDFFromHTML(html, {
src/app/api/receipts/pnl/export/route.ts:6:import { generatePDFFromHTML } from '@/lib/pdf-generator'
src/app/api/receipts/pnl/export/route.ts:66:    const pdfBuffer = await generatePDFFromHTML(html, {
src/app/api/boh/table-bookings/preorder-sheet/route.ts:4:import { generatePDFFromHTML } from '@/lib/pdf-generator'
src/app/api/boh/table-bookings/preorder-sheet/route.ts:515:    const pdfBuffer = await generatePDFFromHTML(html)
src/app/api/boh/table-bookings/preorder-sheet/route.ts:603:  const pdfBuffer = await generatePDFFromHTML(html)
exec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/oj-projects/projects/[id]/page.tsx' | sed -n '320,760p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"Payment|invoice|paid|billed|outstanding|invoice_id|invoice number|status\" 'src/app/(authenticated)/oj-projects/projects/[id]/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"getProjectPaymentHistory|invoice_payments|oj_entries.*invoice_id|Payments tab|Payment history\" src/app/actions/oj-projects src/app/'(authenticated)'/oj-projects -g '"'!**/*.map'"'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
114:      unbilled_ex_vat: 0,
115:      billed_ex_vat: 0,
116:      paid_ex_vat: 0,
137:      if (entry.status === 'paid') t.paid_ex_vat += exVat
138:      else if (entry.status === 'billed') t.billed_ex_vat += exVat
139:      else t.unbilled_ex_vat += exVat
144:    t.unbilled_ex_vat = roundCurrency(t.unbilled_ex_vat)
145:    t.billed_ex_vat = roundCurrency(t.billed_ex_vat)
146:    t.paid_ex_vat = roundCurrency(t.paid_ex_vat)
334:                <div className="text-sm text-gray-500 mb-1">Unbilled</div>
335:                <div className="font-semibold text-gray-900">{formatCurrency(totals.unbilled_ex_vat)}</div>
339:                <div className="font-semibold text-blue-600">{formatCurrency(totals.billed_ex_vat)}</div>
343:                <div className="font-semibold text-green-600">{formatCurrency(totals.paid_ex_vat)}</div>
442:                            ${entry.status === 'unbilled' ? 'bg-amber-100 text-amber-800' :
443:                              entry.status === 'paid' ? 'bg-green-100 text-green-800' :
447:                            {entry.status}
471:                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${project.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
473:                    {project.status === 'active' && <CheckCircle2 className="w-3 h-3 mr-1" />}
474:                    {project.status.toUpperCase()}
575:            {project.status !== 'completed' && project.status !== 'archived' ? (
 succeeded in 51ms:
   320	            </div>
   321	
   322	            {/* Progress Bar for Budget */}
   323	            {budget != null && (
   324	              <div className="w-full bg-gray-100 rounded-full h-2.5 mb-6 overflow-hidden">
   325	                <div
   326	                  className={`h-2.5 rounded-full ${percentageUsed > 100 ? 'bg-red-500' : 'bg-blue-600'}`}
   327	                  style={{ width: `${Math.min(percentageUsed, 100)}%` }}
   328	                ></div>
   329	              </div>
   330	            )}
   331	
   332	            <div className="grid grid-cols-3 gap-4 border-t border-gray-100 pt-6">
   333	              <div>
   334	                <div className="text-sm text-gray-500 mb-1">Unbilled</div>
   335	                <div className="font-semibold text-gray-900">{formatCurrency(totals.unbilled_ex_vat)}</div>
   336	              </div>
   337	              <div>
   338	                <div className="text-sm text-gray-500 mb-1">Billed</div>
   339	                <div className="font-semibold text-blue-600">{formatCurrency(totals.billed_ex_vat)}</div>
 exited 1 in 52ms:

exec
/bin/zsh -lc "nl -ba src/lib/microsoft-graph.ts | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/lib/invoice-template-compact.ts | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc 'rg -n "generateInvoicePDF|documentKind|remittance_advice|receipt-" src/lib src/app/api/invoices src/app/actions/invoices.ts' in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
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
src/app/actions/invoices.ts:207:      documentKind: 'remittance_advice',
src/app/api/invoices/[id]/pdf/route.ts:7:import { generateInvoicePDF } from '@/lib/pdf-generator'
src/app/api/invoices/[id]/pdf/route.ts:54:    const pdfBuffer = await generateInvoicePDF(invoice)
src/app/api/invoices/export/route.ts:9:import { closePdfBrowser, createPdfBrowser, generateInvoicePDF } from '@/lib/pdf-generator'
src/app/api/invoices/export/route.ts:154:        const pdfBuffer = await generateInvoicePDF(typedInvoice, { browser })
src/lib/microsoft-graph.ts:4:import { generateInvoicePDF, generateQuotePDF } from '@/lib/pdf-generator'
src/lib/microsoft-graph.ts:73:  documentKind?: InvoiceDocumentKind
src/lib/microsoft-graph.ts:102:    const documentKind = emailOptions?.documentKind ?? 'invoice'
src/lib/microsoft-graph.ts:103:    const isRemittanceAdvice = documentKind === 'remittance_advice'
src/lib/microsoft-graph.ts:105:    const pdfBuffer = await generateInvoicePDF(invoiceForPDF, {
src/lib/microsoft-graph.ts:106:      documentKind,
src/lib/microsoft-graph.ts:166:          ? `receipt-${invoice.invoice_number}.pdf`
src/lib/invoice-template-compact.ts:8:export type InvoiceDocumentKind = 'invoice' | 'remittance_advice'
src/lib/invoice-template-compact.ts:20:  documentKind?: InvoiceDocumentKind
src/lib/invoice-template-compact.ts:25:  const { invoice, logoUrl, documentKind = 'invoice', remittance } = data
src/lib/invoice-template-compact.ts:26:  const isRemittanceAdvice = documentKind === 'remittance_advice'
src/lib/pdf-generator.ts:37:  documentKind?: InvoiceDocumentKind
src/lib/pdf-generator.ts:134:export async function generateInvoicePDF(
src/lib/pdf-generator.ts:152:      documentKind: options.documentKind,
exec
/bin/zsh -lc "nl -ba src/types/database.generated.ts | sed -n '3448,3508p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba supabase/migrations/20251123120000_squashed.sql | sed -n '11916,12056p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc 'rg -n "credit_note|new_invoice|reminder|chase|statement|quote" src/app/actions/email.ts src/app/actions/invoices.ts src/app/api/cron/auto-send-invoices/route.ts src/app/api/cron/invoice-reminders/route.ts src/app/api/cron/recurring-invoices/route.ts src/app/api/cron/oj-projects-billing/route.ts' in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
  3448	          updated_at?: string | null
  3449	        }
  3450	        Relationships: []
  3451	      }
  3452	      invoice_emails: {
  3453	        Row: {
  3454	          attachments: Json | null
  3455	          bcc_emails: string[] | null
  3456	          body: string
  3457	          cc_emails: string[] | null
  3458	          created_at: string | null
  3459	          created_by: string | null
  3460	          email_type: string
  3461	          error_message: string | null
  3462	          id: string
  3463	          invoice_id: string | null
  3464	          message_id: string | null
  3465	          recipient_email: string
  3466	          sent_at: string | null
  3467	          status: string | null
 succeeded in 51ms:
 11916	    internal_notes text,
 11917	    created_at timestamp with time zone DEFAULT now(),
 11918	    updated_at timestamp with time zone DEFAULT now(),
 11919	    deleted_at timestamp with time zone,
 11920	    deleted_by uuid,
 11921	    CONSTRAINT invoices_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'sent'::character varying, 'paid'::character varying, 'partially_paid'::character varying, 'overdue'::character varying, 'void'::character varying, 'written_off'::character varying])::text[])))
 11922	);
 11923	
 11924	CREATE TABLE IF NOT EXISTS public.quotes (
 11925	    id uuid DEFAULT gen_random_uuid() NOT NULL,
 11926	    quote_number character varying(50) NOT NULL,
 11927	    vendor_id uuid,
 11928	    quote_date date DEFAULT CURRENT_DATE NOT NULL,
 11929	    valid_until date NOT NULL,
 11930	    reference character varying(200),
 11931	    status character varying(20) DEFAULT 'draft'::character varying,
 11932	    quote_discount_percentage numeric(5,2) DEFAULT 0,
 11933	    subtotal_amount numeric(10,2) DEFAULT 0,
 11934	    discount_amount numeric(10,2) DEFAULT 0,
 11935	    vat_amount numeric(10,2) DEFAULT 0,
 succeeded in 52ms:
src/app/api/cron/invoice-reminders/route.ts:20:// Configuration for reminder intervals (days)
src/app/api/cron/invoice-reminders/route.ts:48:    console.warn('[Cron] Starting invoice reminders processing')
src/app/api/cron/invoice-reminders/route.ts:89:      reminders_sent: 0,
src/app/api/cron/invoice-reminders/route.ts:107:      let reminderSendFailed = false
src/app/api/cron/invoice-reminders/route.ts:108:      let reminderClaimHeld = false
src/app/api/cron/invoice-reminders/route.ts:109:      let reminderClaimKey: string | null = null
src/app/api/cron/invoice-reminders/route.ts:110:      let reminderClaimHash: string | null = null
src/app/api/cron/invoice-reminders/route.ts:153:        // Check if we should send a reminder based on intervals
src/app/api/cron/invoice-reminders/route.ts:164:        // Determine reminder type
src/app/api/cron/invoice-reminders/route.ts:165:        let reminderType = 'First Reminder'
src/app/api/cron/invoice-reminders/route.ts:167:          reminderType = 'Due Today'
src/app/api/cron/invoice-reminders/route.ts:169:          reminderType = 'Second Reminder'
src/app/api/cron/invoice-reminders/route.ts:171:          reminderType = 'Final Reminder'
src/app/api/cron/invoice-reminders/route.ts:175:          const reminderKeySuffix = reminderType.toLowerCase().replace(/\s+/g, '_')
src/app/api/cron/invoice-reminders/route.ts:176:          reminderClaimKey = `cron:invoice-reminder:${invoice.id}:${reminderKeySuffix}`
src/app/api/cron/invoice-reminders/route.ts:177:          reminderClaimHash = computeIdempotencyRequestHash({
src/app/api/cron/invoice-reminders/route.ts:179:            reminder_type: reminderType,
src/app/api/cron/invoice-reminders/route.ts:183:          const reminderClaim = await claimIdempotencyKey(
src/app/api/cron/invoice-reminders/route.ts:185:            reminderClaimKey,
src/app/api/cron/invoice-reminders/route.ts:186:            reminderClaimHash,
exec
/bin/zsh -lc "rg -n \"any\\b\" src/app/api/cron/oj-projects-billing/route.ts | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"OJ_PROJECTS_BILLING_ALERT_EMAIL|sendEmail\\(|reportCronFailure|alert|failed vendors|succeeded vendors|zero-vendor|process.env|admin email\" src/app/api/cron/oj-projects-billing/route.ts src/lib/cron/alerting.ts src/lib/email/emailService.ts src/lib/env.ts src/config/environment.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/types/database.generated.ts | sed -n '6130,6190p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
63:function getProjectLabel(project: any) {
99:  supabase: any,
120:  mutation: any,
130:  supabase: any
158:    const lockedIdSet = new Set((lockedRows || []).map((row: any) => String(row.id)))
172:  supabase: any
207:    const updatedIdSet = new Set((updatedRows || []).map((row: any) => String(row.id)))
238:  selectedTimeEntries: any[]
239:  selectedMileageEntries: any[]
240:  selectedOneOffEntries?: any[]
245:  carriedForwardRecurringInstances?: any[]
246:  carriedForwardMileageEntries?: any[]
247:  carriedForwardTimeEntries?: any[]
248:  carriedForwardOneOffEntries?: any[]
256:  const getWorkTypeLabel = (e: any) => String(e.work_type_name_snapshot || e.work_type?.name || 'Unspecified')
276:  const timeByProject = new Map<string, { projectLabel: string; entries: any[] }>()
282:    const bucket = timeByProject.get(key) || { projectLabel, entries: [] as any[] }
391:        const recurringIncVat = cfRecurring.reduce((acc: number, c: any) => {
397:        const mileageMiles = cfMileage.reduce((acc: number, e: any) => acc + Number(e.miles || 0), 0)
398:        const mileageIncVat = cfMileage.reduce((acc: number, e: any) => {
 succeeded in 51ms:
src/config/environment.ts:36:  if (process.env.NODE_ENV !== 'production') {
src/lib/env.ts:48:    process.env.NODE_ENV === 'test'
src/lib/env.ts:53:          ...process.env,
src/lib/env.ts:55:      : process.env;
src/lib/env.ts:95:  return process.env.NODE_ENV === 'development' && env.SKIP_TWILIO_SIGNATURE_VALIDATION === 'true';
src/lib/email/emailService.ts:25:export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; error?: string; messageId?: string }> {
src/lib/email/emailService.ts:35:    const senderEmail = process.env.MICROSOFT_USER_EMAIL!;
src/lib/email/emailService.ts:103:  return sendEmail({ to, subject, text: body });
src/lib/email/emailService.ts:112:    process.env.MICROSOFT_TENANT_ID!,
src/lib/email/emailService.ts:113:    process.env.MICROSOFT_CLIENT_ID!,
src/lib/email/emailService.ts:114:    process.env.MICROSOFT_CLIENT_SECRET!
src/lib/cron/alerting.ts:5: * Escapes HTML special characters to prevent injection in alert emails.
src/lib/cron/alerting.ts:18: * before including it in alert emails.
src/lib/cron/alerting.ts:41: * Reports a cron job failure by sending an alert email to the configured
src/lib/cron/alerting.ts:50: * @param context - Optional additional context to include in the alert (will be PII-redacted)
src/lib/cron/alerting.ts:52:export async function reportCronFailure(
src/lib/cron/alerting.ts:57:  const alertEmail = process.env.CRON_ALERT_EMAIL
src/lib/cron/alerting.ts:58:  if (!alertEmail) {
src/lib/cron/alerting.ts:60:      `[cron-alert] CRON_ALERT_EMAIL not configured; skipping failure alert for ${cronName}`
src/lib/cron/alerting.ts:67:  const environment = process.env.NODE_ENV ?? 'unknown'
 succeeded in 51ms:
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
  6148	          vendor_id: string
  6149	        }
exec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"selectedRecurringInstances|skippedRecurringInstances|oj_recurring_charge_instances|any\\[\\]|: any|as any|OJRecurringChargeInstance|billing failed|sendEmail|alert|zero-vendor|vendors succeeded|vendors failed|failure\" src/app/api/cron/oj-projects-billing/route.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '2520,3200p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
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
63:function getProjectLabel(project: any) {
99:  supabase: any,
120:  mutation: any,
130:  supabase: any
131:  table: 'oj_entries' | 'oj_recurring_charge_instances'
158:    const lockedIdSet = new Set((lockedRows || []).map((row: any) => String(row.id)))
172:  supabase: any
173:  table: 'oj_entries' | 'oj_recurring_charge_instances'
207:    const updatedIdSet = new Set((updatedRows || []).map((row: any) => String(row.id)))
238:  selectedTimeEntries: any[]
239:  selectedMileageEntries: any[]
240:  selectedOneOffEntries?: any[]
245:  carriedForwardRecurringInstances?: any[]
246:  carriedForwardMileageEntries?: any[]
247:  carriedForwardTimeEntries?: any[]
248:  carriedForwardOneOffEntries?: any[]
256:  const getWorkTypeLabel = (e: any) => String(e.work_type_name_snapshot || e.work_type?.name || 'Unspecified')
276:  const timeByProject = new Map<string, { projectLabel: string; entries: any[] }>()
282:    const bucket = timeByProject.get(key) || { projectLabel, entries: [] as any[] }
391:        const recurringIncVat = cfRecurring.reduce((acc: number, c: any) => {
 succeeded in 51ms:
Total output lines: 681

  2520	              status: 'sent',
  2521	            })
  2522	            if (ccLogError) {
  2523	              console.error('Failed to write OJ billing invoice send log (cc):', ccLogError)
  2524	            }
  2525	          }
  2526	        }
  2527	
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
exec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '3200,3460p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"return NextResponse.json|results\\.failed|results\\.vendors|OJ_PROJECTS_BILLING_ALERT_EMAIL|admin email|sendEmail\\(\" src/app/api/cron/oj-projects-billing/route.ts src/lib/cron/alerting.ts src/lib/email/emailService.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 50ms:
src/lib/cron/alerting.ts:107:    const result = await sendEmail({
src/lib/email/emailService.ts:25:export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; error?: string; messageId?: string }> {
src/lib/email/emailService.ts:103:  return sendEmail({ to, subject, text: body });
src/app/api/cron/oj-projects-billing/route.ts:1931:    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
src/app/api/cron/oj-projects-billing/route.ts:1943:    return NextResponse.json({ skipped: true, reason: 'Not the 1st in Europe/London' })
src/app/api/cron/oj-projects-billing/route.ts:1967:      return NextResponse.json({ error: 'Failed to load billing vendor candidates' }, { status: 500 })
src/app/api/cron/oj-projects-billing/route.ts:1982:      return NextResponse.json({ error: 'Failed to load billing vendor candidates' }, { status: 500 })
src/app/api/cron/oj-projects-billing/route.ts:1998:      return NextResponse.json({ error: 'Failed to load billing vendor candidates' }, { status: 500 })
src/app/api/cron/oj-projects-billing/route.ts:2054:    return NextResponse.json({
src/app/api/cron/oj-projects-billing/route.ts:2128:        results.vendors.push({ vendor_id: vendorId, status: 'skipped', invoice_id: billingRun.invoice_id || undefined })
src/app/api/cron/oj-projects-billing/route.ts:2171:          results.vendors.push({
src/app/api/cron/oj-projects-billing/route.ts:2188:          results.failed++
src/app/api/cron/oj-projects-billing/route.ts:2189:          results.vendors.push({
src/app/api/cron/oj-projects-billing/route.ts:2237:          results.vendors.push({ vendor_id: vendorId, status: 'sent', invoice_id: invoice.id, invoice_number: invoice.invoice_number })
src/app/api/cron/oj-projects-billing/route.ts:2336:          results.failed++
src/app/api/cron/oj-projects-billing/route.ts:2337:          results.vendors.push({
src/app/api/cron/oj-projects-billing/route.ts:2348:          results.vendors.push({
src/app/api/cron/oj-projects-billing/route.ts:2379:            results.failed++
src/app/api/cron/oj-projects-billing/route.ts:2380:            results.vendors.push({
src/app/api/cron/oj-projects-billing/route.ts:2429:          results.failed++
 succeeded in 52ms:
  3200	            }
  3201	            claimHeld = false
  3202	          }
  3203	
  3204	          await updateBillingRunById(supabase, billingRun.id, {
  3205	            status: 'failed',
  3206	            error_message: sendRes.error || 'Failed to send invoice email',
  3207	            run_finished_at: new Date().toISOString(),
  3208	            updated_at: new Date().toISOString(),
  3209	          })
  3210	
  3211	          results.failed++
  3212	          results.vendors.push({ vendor_id: vendorId, status: 'failed', invoice_id: invoiceId, invoice_number: invoiceNumber, error: sendRes.error || 'Failed to send invoice email' })
  3213	          continue
  3214	        }
  3215	      }
  3216	
  3217	      const { data: sentInvoiceRow, error: sentInvoiceError } = await supabase
  3218	        .from('invoices')
  3219	        .update({ status: 'sent', updated_at: new Date().toISOString() })
exec
/bin/zsh -lc "rg -n --hidden --glob '"'!node_modules'"' --glob '"'!.git'"' \"credit_note|credit note|credit-note\" src supabase/migrations/20251123120000_squashed.sql" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/email.ts | sed -n '1,180p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"invoice_vendors\\(\\*\\)|vendor:invoice_vendors\\(\\*\\)|resolveInvoiceRecipientsForVendor|getVendorInvoiceEmail|vendor_id\" src/services/invoices.ts src/app/actions/invoices.ts src/app/actions/email.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
supabase/migrations/20251123120000_squashed.sql:12050:    CONSTRAINT invoice_emails_email_type_check CHECK (((email_type)::text = ANY ((ARRAY['new_invoice'::character varying, 'reminder'::character varying, 'chase'::character varying, 'credit_note'::character varying, 'statement'::character varying, 'quote'::character varying])::text[]))),
 succeeded in 50ms:
     1	'use server'
     2	
     3	import { createClient } from '@/lib/supabase/server'
     4	import { checkUserPermission } from '@/app/actions/rbac'
     5	import { logAuditEvent } from './audit'
     6	import { sendInvoiceEmail, sendQuoteEmail, testEmailConnection, isGraphConfigured } from '@/lib/microsoft-graph'
     7	import { getInvoice } from './invoices'
     8	import { getQuote } from './quotes'
     9	import { getTodayIsoDate } from '@/lib/dateUtils'
    10	import { z } from 'zod'
    11	import { createAdminClient } from '@/lib/supabase/admin'
    12	import { parseRecipientList, resolveManualInvoiceRecipients } from '@/lib/invoice-recipients'
    13	import {
    14	  claimIdempotencyKey,
    15	  computeIdempotencyRequestHash,
    16	  persistIdempotencyResponse,
    17	  releaseIdempotencyClaim
    18	} from '@/lib/api/idempotency'
    19	
    20	const CONTACT_NAME = process.env.COMPANY_CONTACT_NAME || 'Peter Pitcher'
 succeeded in 51ms:
src/app/actions/email.ts:171:      invoice.vendor_id,
src/app/actions/email.ts:443:      invoice.vendor_id,
src/app/actions/email.ts:652:      quote.vendor_id,
src/services/invoices.ts:21:  vendor_id: z.string().uuid('Invalid vendor ID'),
src/services/invoices.ts:31:  vendor_id: string;
src/services/invoices.ts:81:      vendor_id: input.vendor_id,
src/services/invoices.ts:134:      vendor_id: input.vendor_id,
src/services/invoices.ts:213:        vendor_id: input.vendor_id,
src/services/invoices.ts:284:        vendor:invoice_vendors(*)
src/services/invoices.ts:341:        vendor:invoice_vendors(*),
src/app/actions/invoices.ts:62:async function resolveInvoiceRecipientsForVendor(
src/app/actions/invoices.ts:72:    .eq('vendor_id', vendorId)
src/app/actions/invoices.ts:143:    const recipientResult = await resolveInvoiceRecipientsForVendor(
src/app/actions/invoices.ts:145:      invoice.vendor_id,
src/app/actions/invoices.ts:345:      vendor_id: formData.get('vendor_id'),
src/app/actions/invoices.ts:392:        vendor_id: invoice.vendor_id,
src/app/actions/invoices.ts:796:      vendor_id: formData.get('vendor_id'),
codex
The remaining checks are around “near misses”: places where something similar exists but doesn’t meet the spec. That matters for statement mode copy, invoice voiding, and project-level payment visibility.
exec
/bin/zsh -lc "nl -ba src/lib/cron/alerting.ts | sed -n '1,180p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"reportCronFailure|CRON_ALERT_EMAIL|sendEmail\\(\" src/app/api/cron/oj-projects-billing/route.ts src/app/api/cron/oj-projects-retainer-projects/route.ts src/app/api/cron/oj-projects-billing-reminders/route.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg --files src/lib src/app/actions/oj-projects src/app/api/cron | rg 'oj-projects.*utils|oj-statement|client-statement'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 50ms:
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
 exited 1 in 51ms:

 exited 1 in 51ms:

exec
/bin/zsh -lc "nl -ba src/lib/cron/alerting.ts | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '1930,2065p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
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
 succeeded in 52ms:
  1930	  if (!authResult.authorized) {
  1931	    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  1932	  }
  1933	
  1934	  const url = new URL(request.url)
  1935	  const force = url.searchParams.get('force') === 'true'
  1936	  const preview = url.searchParams.get('preview') === 'true'
  1937	  const dryRun = url.searchParams.get('dry_run') === 'true'
  1938	  const vendorFilter = url.searchParams.get('vendor_id')
  1939	
  1940	  const now = new Date()
  1941	  const londonDay = Number(formatInTimeZone(now, LONDON_TZ, 'd'))
  1942	  if (londonDay !== 1 && !force) {
  1943	    return NextResponse.json({ skipped: true, reason: 'Not the 1st in Europe/London' })
  1944	  }
  1945	
  1946	  const period = getPreviousMonthPeriod(now)
  1947	  const invoiceDate = formatInTimeZone(now, LONDON_TZ, 'yyyy-MM-dd')
  1948	
  1949	  const supabase = createAdminClient()
exec
/bin/zsh -lc "nl -ba src/config/environment.ts | sed -n '1,140p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/lib/env.ts | sed -n '1,180p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"OJ_PROJECTS_BILLING_ALERT_EMAIL|CRON_ALERT_EMAIL|MICROSOFT_USER_EMAIL|ADMIN_EMAIL|NEXT_PUBLIC_APP_URL\" src config .env* docs -g '"'!**/*.map'"'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
     1	import { env, isSmsEnabled, skipTwilioSignatureValidation } from '@/lib/env'
     2	
     3	export type Environment = 'development' | 'staging' | 'production'
     4	
     5	export interface EnvironmentConfig {
     6	  name: Environment
     7	  isDevelopment: boolean
     8	  isStaging: boolean
     9	  isProduction: boolean
    10	  app: {
    11	    url: string
    12	    name: string
    13	    contactPhone: string
    14	  }
    15	  features: {
    16	    sms: boolean
    17	    rateLimiting: boolean
    18	    backgroundJobs: boolean
    19	    webhookValidation: boolean
    20	  }
 succeeded in 52ms:
     1	import { z } from 'zod';
     2	
     3	// Define the schema for environment variables
     4	const envSchema = z.object({
     5	  // Public variables (available to client and server)
     6	  NEXT_PUBLIC_SUPABASE_URL: z.string().url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
     7	  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
     8	  NEXT_PUBLIC_APP_URL: z.string().url('NEXT_PUBLIC_APP_URL must be a valid URL'),
     9	  NEXT_PUBLIC_CONTACT_PHONE_NUMBER: z.string().optional(),
    10	  
    11	  // Server-only variables
    12	  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
    13	  TWILIO_ACCOUNT_SID: z.string().optional(),
    14	  TWILIO_AUTH_TOKEN: z.string().optional(),
    15	  TWILIO_PHONE_NUMBER: z.string().optional(),
    16	  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
    17	  STRIPE_SECRET_KEY: z.string().optional(),
    18	  STRIPE_WEBHOOK_SECRET: z.string().optional(),
    19	  SUSPEND_EVENT_SMS: z.string().optional(),
    20	  SUSPEND_ALL_SMS: z.string().optional(),
 exited 2 in 52ms:
rg: config: No such file or directory (os error 2)
.env.local:16:MICROSOFT_USER_EMAIL="peter@orangejelly.co.uk"
.env.local:17:NEXT_PUBLIC_APP_URL="https://management.orangejelly.co.uk"
.env.example:7:NEXT_PUBLIC_APP_URL=http://localhost:3000
.env.example:41:WEBHOOK_BASE_URL=https://your-domain.com # Override for webhook callbacks (defaults to NEXT_PUBLIC_APP_URL)
.env.example:47:MICROSOFT_USER_EMAIL=your_email@domain.com
.env.example:75:CRON_ALERT_EMAIL=manager@the-anchor.pub
docs/TROUBLESHOOTING.md:43:1. Confirm Microsoft Graph credentials (`MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_USER_EMAIL`) are present.
docs/setup/GITHUB_SECRETS_SETUP.md:33:7. **NEXT_PUBLIC_APP_URL** - Should be: https://management.orangejelly.co.uk
src/services/event-bookings.ts:59:  /** Base URL for payment/manage token generation (e.g. process.env.NEXT_PUBLIC_APP_URL) */
docs/FEATURES.md:491:MICROSOFT_USER_EMAIL
docs/DEPLOYMENT.md:99:NEXT_PUBLIC_APP_URL=https://management.orangejelly.co.uk
docs/DEPLOYMENT.md:123:MICROSOFT_USER_EMAIL=sender@domain.com
docs/DEPLOYMENT.md:257:   - Change `NEXT_PUBLIC_APP_URL` to custom domain
docs/reports/event-reminder-sms-report.md:5311:  NEXT_PUBLIC_APP_URL: z.string().url('NEXT_PUBLIC_APP_URL must be a valid URL'),
docs/reports/event-reminder-sms-report.md:5341:          NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
docs/reports/event-reminder-sms-report.md:5364:  env.NEXT_PUBLIC_APP_URL ||
docs/SECURITY.md:227:  process.env.NEXT_PUBLIC_APP_URL,
docs/SECURITY.md:399:- `NEXT_PUBLIC_APP_URL`
src/lib/cron/alerting.ts:42: * CRON_ALERT_EMAIL address. Fails silently (logs to console) if the email
exec
/bin/zsh -lc "nl -ba src/app/actions/oj-projects/entries.ts | sed -n '280,520p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc 'rg -n "duration_minutes_raw|start_at|end_at|hourly_rate_ex_vat_snapshot|mileage_rate_snapshot|amount_ex_vat_snapshot" src/app/actions/oj-projects/entries.ts' in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
190:      start_at: null,
191:      end_at: null,
192:      duration_minutes_raw: rawMinutes,
201:      hourly_rate_ex_vat_snapshot: settings.hourly_rate_ex_vat,
203:      mileage_rate_snapshot: null,
258:      start_at: null,
259:      end_at: null,
260:      duration_minutes_raw: null,
269:      hourly_rate_ex_vat_snapshot: null,
271:      mileage_rate_snapshot: settings.mileage_rate,
326:      start_at: null,
327:      end_at: null,
328:      duration_minutes_raw: null,
337:      hourly_rate_ex_vat_snapshot: null,
339:      mileage_rate_snapshot: null,
340:      amount_ex_vat_snapshot: parsed.data.amount_ex_vat,
354:    new_values: { entry_type: 'one_off', project_id: data.project_id, entry_date: data.entry_date, amount_ex_vat_snapshot: data.amount_ex_vat_snapshot },
385:    .select('id, status, start_at, end_at, entry_type, entry_date')
421:        start_at: existing.start_at ?? null,
422:        end_at: existing.end_at ?? null,
 succeeded in 52ms:
   280	    user_email: user?.email,
   281	    operation_type: 'create',
   282	    resource_type: 'oj_entry',
   283	    resource_id: data.id,
   284	    operation_status: 'success',
   285	    new_values: { entry_type: 'mileage', project_id: data.project_id, entry_date: data.entry_date, miles: data.miles },
   286	  })
   287	
   288	  // Trigger has synced this mileage entry to mileage_trips with default rates.
   289	  // Recalculate HMRC rate splits for the entire tax year so cumulative thresholds
   290	  // are applied correctly across all trips.
   291	  await recalculateTaxYearMileage(parsed.data.entry_date)
   292	
   293	  return { entry: data, success: true as const }
   294	}
   295	
   296	export async function createOneOffCharge(formData: FormData) {
   297	  const hasPermission = await checkUserPermission('oj_projects', 'create')
   298	  if (!hasPermission) return { error: 'You do not have permission to create entries' }
   299	
exec
/bin/zsh -lc 'rg -n "vendorsProcessed|failed|error_message|success|return NextResponse.json|results" src/app/api/cron/oj-projects-billing/route.ts' in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '3400,3525p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '3210,3405p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
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
 succeeded in 50ms:
  3210	
  3211	          results.failed++
  3212	          results.vendors.push({ vendor_id: vendorId, status: 'failed', invoice_id: invoiceId, invoice_number: invoiceNumber, error: sendRes.error || 'Failed to send invoice email' })
  3213	          continue
  3214	        }
  3215	      }
  3216	
  3217	      const { data: sentInvoiceRow, error: sentInvoiceError } = await supabase
  3218	        .from('invoices')
  3219	        .update({ status: 'sent', updated_at: new Date().toISOString() })
  3220	        .eq('id', invoiceId)
  3221	        .eq('status', 'draft')
  3222	        .select('id')
  3223	        .maybeSingle()
  3224	
  3225	      let invoiceFinalized = Boolean(sentInvoiceRow)
  3226	
  3227	      if (sentInvoiceError) {
  3228	        if (claimHeld) {
  3229	          try {
 succeeded in 51ms:
1931:    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
1943:    return NextResponse.json({ skipped: true, reason: 'Not the 1st in Europe/London' })
1967:      return NextResponse.json({ error: 'Failed to load billing vendor candidates' }, { status: 500 })
1982:      return NextResponse.json({ error: 'Failed to load billing vendor candidates' }, { status: 500 })
1998:      return NextResponse.json({ error: 'Failed to load billing vendor candidates' }, { status: 500 })
2004:    // Vendors with failed runs for this period (retry)
2005:    const { data: failedRuns } = await supabase
2009:      .eq('status', 'failed')
2012:    for (const row of failedRuns || []) {
2054:    return NextResponse.json({
2062:  const results = {
2068:    failed: 0,
2071:      status: 'sent' | 'skipped' | 'failed'
2079:    results.processed++
2127:        results.skipped++
2128:        results.vendors.push({ vendor_id: vendorId, status: 'skipped', invoice_id: billingRun.invoice_id || undefined })
2170:          results.skipped++
2171:          results.vendors.push({
2183:            status: 'failed',
2184:            error_message: 'Email service is not configured',
exec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '1940,2068p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
  1940	  const now = new Date()
  1941	  const londonDay = Number(formatInTimeZone(now, LONDON_TZ, 'd'))
  1942	  if (londonDay !== 1 && !force) {
  1943	    return NextResponse.json({ skipped: true, reason: 'Not the 1st in Europe/London' })
  1944	  }
  1945	
  1946	  const period = getPreviousMonthPeriod(now)
  1947	  const invoiceDate = formatInTimeZone(now, LONDON_TZ, 'yyyy-MM-dd')
  1948	
  1949	  const supabase = createAdminClient()
  1950	
  1951	  const vendorIds = new Set<string>()
  1952	
  1953	  if (vendorFilter) {
  1954	    vendorIds.add(String(vendorFilter))
  1955	  } else {
  1956	    // Vendors with eligible entries up to period_end
  1957	    const { data: entryVendors, error: entryVendorError } = await supabase
  1958	      .from('oj_entries')
  1959	      .select('vendor_id')
codex
The current picture is narrowing: several spec items already have adjacent groundwork, but not the exact behavior the spec asks for. I’m checking the remaining edge cases now: whether one-off updates leave stale fields behind, whether billing cron has any fallback alert path, and whether there’s any existing statement/void support hidden in migrations or generated types.
exec
/bin/zsh -lc 'rg -n "credit_notes|credit note|credit_note|voided_at|void_reason|void_reason|reason and timestamp|written_off" src supabase/migrations' in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc 'rg -n "null out|spurious|data-fix|cleanup.*one_off|amount_ex_vat_snapshot.*one_off|hourly_rate_ex_vat_snapshot.*null|mileage_rate_snapshot.*null" supabase/migrations src/app/actions/oj-projects src' in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"invoice_id\" src/app/actions/oj-projects src/app/\\(authenticated\\)/oj-projects src/types/oj-projects.ts src/types/database.generated.ts | sed -n '1,200p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"getClientStatement|client-statement|oj-statement|Account Statement|statement-\" src/app/actions src/lib src/app/\\(authenticated\\)/oj-projects" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
supabase/migrations/20251123120000_squashed.sql:11921:    CONSTRAINT invoices_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'sent'::character varying, 'paid'::character varying, 'partially_paid'::character varying, 'overdue'::character varying, 'void'::character varying, 'written_off'::character varying])::text[])))
supabase/migrations/20251123120000_squashed.sql:12050:    CONSTRAINT invoice_emails_email_type_check CHECK (((email_type)::text = ANY ((ARRAY['new_invoice'::character varying, 'reminder'::character varying, 'chase'::character varying, 'credit_note'::character varying, 'statement'::character varying, 'quote'::character varying])::text[]))),
supabase/migrations/20251123120000_squashed.sql:17992:      WHEN i.status NOT IN ('paid', 'void', 'written_off')
supabase/migrations/20251123120000_squashed.sql:18013:      WHEN i.status NOT IN ('paid', 'void', 'written_off') 
supabase/migrations/20251123120000_squashed.sql:18281:  ELSIF v_new_paid > 0 AND v_new_status NOT IN ('void', 'written_off') THEN
src/app/api/cron/oj-projects-billing/route.ts:1026:    .not('status', 'in', '(paid,void,written_off)')
src/app/api/cron/oj-projects-billing/route.ts:1717:    .not('status', 'in', '(paid,void,written_off)')
src/lib/__tests__/status-transitions.test.ts:10:    const validTargets: InvoiceStatus[] = ['draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void', 'written_off']
src/lib/__tests__/status-transitions.test.ts:17:    const validTargets: InvoiceStatus[] = ['sent', 'partially_paid', 'paid', 'overdue', 'void', 'written_off']
src/lib/__tests__/status-transitions.test.ts:28:    const validTargets: InvoiceStatus[] = ['partially_paid', 'paid', 'overdue', 'void', 'written_off']
src/lib/__tests__/status-transitions.test.ts:43:    const validTargets: InvoiceStatus[] = ['overdue', 'sent', 'partially_paid', 'paid', 'void', 'written_off']
src/lib/__tests__/status-transitions.test.ts:58:    const lockedTargets: InvoiceStatus[] = ['draft', 'sent', 'partially_paid', 'overdue', 'void', 'written_off']
src/lib/__tests__/status-transitions.test.ts:69:    const lockedTargets: InvoiceStatus[] = ['draft', 'sent', 'partially_paid', 'overdue', 'paid', 'written_off']
src/lib/__tests__/status-transitions.test.ts:75:  describe('terminal state: written_off', () => {
src/lib/__tests__/status-transitions.test.ts:76:    it('should allow written_off → written_off (same-state)', () => {
src/lib/__tests__/status-transitions.test.ts:77:      expect(isInvoiceStatusTransitionAllowed('written_off', 'written_off')).toBe(true)
src/lib/__tests__/status-transitions.test.ts:81:    it.each(lockedTargets)('should not allow written_off → %s', (to) => {
src/lib/__tests__/status-transitions.test.ts:82:      expect(isInvoiceStatusTransitionAllowed('written_off', to)).toBe(false)
src/app/actions/email.ts:409:    if (['paid', 'void', 'written_off'].includes(invoiceStatus)) {
src/app/actions/invoices.ts:428:      'draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void', 'written_off'
 succeeded in 51ms:
src/app/actions/oj-projects/entries.ts:203:      mileage_rate_snapshot: null,
src/app/actions/oj-projects/entries.ts:269:      hourly_rate_ex_vat_snapshot: null,
src/app/actions/oj-projects/entries.ts:337:      hourly_rate_ex_vat_snapshot: null,
src/app/actions/oj-projects/entries.ts:339:      mileage_rate_snapshot: null,
src/types/database.generated.ts:5925:          hourly_rate_ex_vat_snapshot: number | null
src/types/database.generated.ts:5929:          mileage_rate_snapshot: number | null
src/types/database.generated.ts:5953:          hourly_rate_ex_vat_snapshot?: number | null
src/types/database.generated.ts:5957:          mileage_rate_snapshot?: number | null
src/types/database.generated.ts:5981:          hourly_rate_ex_vat_snapshot?: number | null
src/types/database.generated.ts:5985:          mileage_rate_snapshot?: number | null
src/types/oj-projects.ts:86:  hourly_rate_ex_vat_snapshot: number | null
src/types/oj-projects.ts:88:  mileage_rate_snapshot: number | null
src/app/api/cron/oj-projects-billing/route.ts:594:    hourly_rate_ex_vat_snapshot: entry.hourly_rate_ex_vat_snapshot ?? null,
src/app/api/cron/oj-projects-billing/route.ts:596:    mileage_rate_snapshot: entry.mileage_rate_snapshot ?? null,
src/app/actions/oj-projects/entries.ts:203:      mileage_rate_snapshot: null,
src/app/actions/oj-projects/entries.ts:269:      hourly_rate_ex_vat_snapshot: null,
src/app/actions/oj-projects/entries.ts:337:      hourly_rate_ex_vat_snapshot: null,
src/app/actions/oj-projects/entries.ts:339:      mileage_rate_snapshot: null,
 exited 1 in 51ms:

 succeeded in 51ms:
src/types/oj-projects.ts:83:  invoice_id: string | null
src/types/oj-projects.ts:103:  invoice_id: string | null
src/types/database.generated.ts:3315:          invoice_id: string | null
src/types/database.generated.ts:3328:          invoice_id?: string | null
src/types/database.generated.ts:3341:          invoice_id?: string | null
src/types/database.generated.ts:3365:          invoice_id: string | null
src/types/database.generated.ts:3379:          invoice_id?: string | null
src/types/database.generated.ts:3393:          invoice_id?: string | null
src/types/database.generated.ts:3404:            foreignKeyName: "invoice_email_logs_invoice_id_fkey"
src/types/database.generated.ts:3405:            columns: ["invoice_id"]
src/types/database.generated.ts:3463:          invoice_id: string | null
src/types/database.generated.ts:3480:          invoice_id?: string | null
src/types/database.generated.ts:3497:          invoice_id?: string | null
src/types/database.generated.ts:3522:          invoice_id: string
src/types/database.generated.ts:3537:          invoice_id: string
src/types/database.generated.ts:3552:          invoice_id?: string
src/types/database.generated.ts:3569:            foreignKeyName: "invoice_line_items_invoice_id_fkey"
src/types/database.generated.ts:3570:            columns: ["invoice_id"]
src/types/database.generated.ts:3582:          invoice_id: string
src/types/database.generated.ts:3592:          invoice_id: string
exec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '1195,1715p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '960,1195p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
   960	    settings: input.settings,
   961	    selectedMileageEntries: input.selectedMileageEntries,
   962	    skippedMileageEntries: input.skippedMileageEntries,
   963	  })
   964	  if (mileageSplit) return { addedIncVat: mileageSplit.addedIncVat }
   965	
   966	  const timeSplit = await splitTimeEntryForCap({
   967	    supabase: input.supabase,
   968	    persist: input.persist,
   969	    headroom,
   970	    settings: input.settings,
   971	    selectedTimeEntries: input.selectedTimeEntries,
   972	    skippedTimeEntries: input.skippedTimeEntries,
   973	  })
   974	  if (timeSplit) return { addedIncVat: timeSplit.addedIncVat }
   975	
   976	  return { addedIncVat: 0 }
   977	}
   978	
   979	async function computeStatementBalanceBefore(input: {
 succeeded in 51ms:
Total output lines: 521

  1195	    vat_rate: number
  1196	  }> = []
  1197	
  1198	  for (const c of input.selectedRecurringInstances || []) {
  1199	    const baseDescription = String(c.description_snapshot || '')
  1200	    const periodLabel = formatPeriodLabel(c?.period_yyyymm)
  1201	    const description =
  1202	      periodLabel && String(periodLabel) !== input.periodYyyymm
  1203	        ? `${baseDescription} (${periodLabel})`
  1204	        : baseDescription
  1205	    lineItems.push({
  1206	      catalog_item_id: null,
  1207	      description,
  1208	      quantity: 1,
  1209	      unit_price: Number(c.amount_ex_vat_snapshot || 0),
  1210	      discount_percentage: 0,
  1211	      vat_rate: Number(c.vat_rate_snapshot || 0),
  1212	    })
exec
/bin/zsh -lc "rg -n \"OJRecurringChargeInstance|oj_recurring_charge_instances\" src/types src/app/api/cron/oj-projects-billing/route.ts src/app/actions/invoices.ts -g '"'!**/*.map'"'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
src/app/actions/invoices.ts:453:          .from('oj_recurring_charge_instances')
src/app/api/cron/oj-projects-billing/route.ts:131:  table: 'oj_entries' | 'oj_recurring_charge_instances'
src/app/api/cron/oj-projects-billing/route.ts:173:  table: 'oj_entries' | 'oj_recurring_charge_instances'
src/app/api/cron/oj-projects-billing/route.ts:667:      .from('oj_recurring_charge_instances')
src/app/api/cron/oj-projects-billing/route.ts:705:      .from('oj_recurring_charge_instances')
src/app/api/cron/oj-projects-billing/route.ts:717:      .from('oj_recurring_charge_instances')
src/app/api/cron/oj-projects-billing/route.ts:1329:    .from('oj_recurring_charge_instances')
src/app/api/cron/oj-projects-billing/route.ts:1341:    .from('oj_recurring_charge_instances')
src/app/api/cron/oj-projects-billing/route.ts:1773:      .from('oj_recurring_charge_instances')
src/app/api/cron/oj-projects-billing/route.ts:1990:      .from('oj_recurring_charge_instances')
src/app/api/cron/oj-projects-billing/route.ts:2222:              .from('oj_recurring_charge_instances')
src/app/api/cron/oj-projects-billing/route.ts:2544:            .from('oj_recurring_charge_instances')
src/app/api/cron/oj-projects-billing/route.ts:2599:        .from('oj_recurring_charge_instances')
src/app/api/cron/oj-projects-billing/route.ts:2619:            .from('oj_recurring_charge_instances')
src/app/api/cron/oj-projects-billing/route.ts:2671:          .from('oj_recurring_charge_instances')
src/app/api/cron/oj-projects-billing/route.ts:2682:        .from('oj_recurring_charge_instances')
src/app/api/cron/oj-projects-billing/route.ts:2901:        table: 'oj_recurring_charge_instances',
src/app/api/cron/oj-projects-billing/route.ts:3070:            table: 'oj_recurring_charge_instances',
src/app/api/cron/oj-projects-billing/route.ts:3373:          table: 'oj_recurring_charge_instances',
src/types/database.generated.ts:6130:      oj_recurring_charge_instances: {
exec
/bin/zsh -lc "rg -n \"invoices: \\{|invoice_vendors|vendor_id\" src/types/database.generated.ts | sed -n '1,120p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/types/database.generated.ts | sed -n '3440,3528p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/types/database.generated.ts | sed -n '3528,3620p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
3682:          vendor_id: string
3693:          vendor_id: string
3704:          vendor_id?: string
3708:            foreignKeyName: "invoice_vendor_contacts_vendor_id_fkey"
3709:            columns: ["vendor_id"]
3711:            referencedRelation: "invoice_vendors"
3716:      invoice_vendors: {
3761:      invoices: {
3781:          vendor_id: string | null
3802:          vendor_id?: string | null
3823:          vendor_id?: string | null
3827:            foreignKeyName: "invoices_vendor_id_fkey"
3828:            columns: ["vendor_id"]
3830:            referencedRelation: "invoice_vendors"
5861:          vendor_id: string
5877:          vendor_id: string
5893:          vendor_id?: string
5904:            foreignKeyName: "oj_billing_runs_vendor_id_fkey"
5905:            columns: ["vendor_id"]
5907:            referencedRelation: "invoice_vendors"
 succeeded in 51ms:
  3440	        Update: {
  3441	          body_template?: string
  3442	          created_at?: string | null
  3443	          description?: string | null
  3444	          id?: string
  3445	          is_active?: boolean | null
  3446	          subject_template?: string
  3447	          template_type?: string
  3448	          updated_at?: string | null
  3449	        }
  3450	        Relationships: []
  3451	      }
  3452	      invoice_emails: {
  3453	        Row: {
  3454	          attachments: Json | null
  3455	          bcc_emails: string[] | null
  3456	          body: string
  3457	          cc_emails: string[] | null
  3458	          created_at: string | null
  3459	          created_by: string | null
 succeeded in 52ms:
  3528	          vat_rate: number | null
  3529	        }
  3530	        Insert: {
  3531	          catalog_item_id?: string | null
  3532	          created_at?: string | null
  3533	          description: string
  3534	          discount_amount?: number | null
  3535	          discount_percentage?: number | null
  3536	          id?: string
  3537	          invoice_id: string
  3538	          quantity?: number | null
  3539	          subtotal_amount?: number | null
  3540	          total_amount?: number | null
  3541	          unit_price?: number | null
  3542	          vat_amount?: number | null
  3543	          vat_rate?: number | null
  3544	        }
  3545	        Update: {
  3546	          catalog_item_id?: string | null
  3547	          created_at?: string | null
exec
/bin/zsh -lc "nl -ba supabase/migrations/20260121100000_oj_recurring_charge_instances.sql | sed -n '1,120p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
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
/bin/zsh -lc "nl -ba src/lib/invoice-recipients.ts | sed -n '1,180p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/types/database.generated.ts | sed -n '3760,3835p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
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
  3760	      }
  3761	      invoices: {
  3762	        Row: {
  3763	          created_at: string | null
  3764	          deleted_at: string | null
  3765	          deleted_by: string | null
  3766	          discount_amount: number | null
  3767	          due_date: string
  3768	          id: string
  3769	          internal_notes: string | null
  3770	          invoice_date: string
  3771	          invoice_discount_percentage: number | null
  3772	          invoice_number: string
  3773	          notes: string | null
  3774	          paid_amount: number | null
  3775	          reference: string | null
  3776	          status: string | null
  3777	          subtotal_amount: number | null
  3778	          total_amount: number | null
  3779	          updated_at: string | null
exec
/bin/zsh -lc "rg -n \"duration_minutes_rounded IS NULL|miles IS NULL|amount_ex_vat_snapshot IS NOT NULL|one_off.*UPDATE|UPDATE public\\.oj_entries|spurious|data-fix|data fix|null out\" supabase/migrations src docs -g '"'!**/*.map'"'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
supabase/migrations/20260120130000_oj_projects_core.sql:149:    (entry_type = 'time' AND start_at IS NOT NULL AND end_at IS NOT NULL AND duration_minutes_rounded IS NOT NULL AND miles IS NULL)
supabase/migrations/20260120130000_oj_projects_core.sql:151:    (entry_type = 'mileage' AND miles IS NOT NULL AND start_at IS NULL AND end_at IS NULL AND duration_minutes_rounded IS NULL)
supabase/migrations/20260120130000_oj_projects_core.sql:161:    UPDATE public.oj_entries
supabase/migrations/20260226120000_oj_entries_one_off.sql:24:    (entry_type = 'time' AND start_at IS NOT NULL AND end_at IS NOT NULL AND duration_minutes_rounded IS NOT NULL AND miles IS NULL)
supabase/migrations/20260226120000_oj_entries_one_off.sql:26:    (entry_type = 'mileage' AND miles IS NOT NULL AND start_at IS NULL AND end_at IS NULL AND duration_minutes_rounded IS NULL)
supabase/migrations/20260226120000_oj_entries_one_off.sql:28:    (entry_type = 'one_off' AND amount_ex_vat_snapshot IS NOT NULL AND miles IS NULL AND start_at IS NULL AND end_at IS NULL AND duration_minutes_rounded IS NULL)
supabase/migrations/20260121100000_oj_recurring_charge_instances.sql:53:    UPDATE public.oj_entries
supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql:18:      AND miles IS NULL
supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql:26:      AND duration_minutes_rounded IS NULL
supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql:30:      AND amount_ex_vat_snapshot IS NOT NULL
supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql:31:      AND miles IS NULL
supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql:34:      AND duration_minutes_rounded IS NULL
docs/superpowers/specs/2026-03-12-remove-quick-entry-start-time-design.md:44:    AND miles IS NULL
docs/superpowers/specs/2026-03-12-remove-quick-entry-start-time-design.md:58:    AND amount_ex_vat_snapshot IS NOT NULL
docs/superpowers/specs/2026-03-12-remove-quick-entry-start-time-design.md:62:    AND miles IS NULL
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:24:**Problem:** `chk_oj_entries_time_fields` in `oj_entries` only validates `time` and `mileage` entry types. `one_off` entries can have spurious `miles` or `duration_minutes_rounded` values that pass DB validation silently.
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:36:Also add a data-fix query to null out any existing spurious values on `one_off` entries.
docs/superpowers/plans/2026-03-12-remove-start-time-from-oj-projects.md:37:(entry_type = 'time' AND start_at IS NOT NULL AND end_at IS NOT NULL AND duration_minutes_rounded IS NOT NULL AND miles IS NULL)
docs/superpowers/plans/2026-03-12-remove-start-time-from-oj-projects.md:39:(entry_type = 'mileage' AND miles IS NOT NULL AND start_at IS NULL AND end_at IS NULL AND duration_minutes_rounded IS NULL)
docs/superpowers/plans/2026-03-12-remove-start-time-from-oj-projects.md:41:(entry_type = 'one_off' AND amount_ex_vat_snapshot IS NOT NULL AND miles IS NULL AND start_at IS NULL AND end_at IS NULL AND duration_minutes_rounded IS NULL)
exec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '944,1016p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
   944	  const headroom = roundMoney(capPounds - Number(input.runningIncVat || 0))
   945	  if (headroom <= 0.01) return { addedIncVat: 0 }
   946	
   947	  const recurringSplit = await splitRecurringInstanceForCap({
   948	    supabase: input.supabase,
   949	    persist: input.persist,
   950	    headroom,
   951	    selectedRecurringInstances: input.selectedRecurringInstances,
   952	    skippedRecurringInstances: input.skippedRecurringInstances,
   953	  })
   954	  if (recurringSplit) return { addedIncVat: recurringSplit.addedIncVat }
   955	
   956	  const mileageSplit = await splitMileageEntryForCap({
   957	    supabase: input.supabase,
   958	    persist: input.persist,
   959	    headroom,
   960	    settings: input.settings,
   961	    selectedMileageEntries: input.selectedMileageEntries,
   962	    skippedMileageEntries: input.skippedMileageEntries,
   963	  })
exec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '1428,1498p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '920,980p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '2780,2855p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
  1428	      runningIncVat = next
  1429	      return true
  1430	    }
  1431	    return false
  1432	  }
  1433	
  1434	  for (const c of eligibleRecurringInstances || []) {
  1435	    const charge = getRecurringCharge(c)
  1436	    if (includeItem(charge.incVat)) selectedRecurringInstances.push(c)
  1437	    else skippedRecurringInstances.push(c)
  1438	  }
  1439	
  1440	  for (const e of oneOffEntries) {
  1441	    const charge = getEntryCharge(e, settings)
  1442	    if (includeItem(charge.incVat)) selectedOneOff.push(e)
  1443	    else skippedOneOff.push(e)
  1444	  }
  1445	
  1446	  for (const e of mileageEntries) {
  1447	    const charge = getEntryCharge(e, settings)
 succeeded in 52ms:
   920	  input.skippedTimeEntries.splice(index, 1, remainderEntry)
   921	  input.selectedTimeEntries.push(partialEntry)
   922	
   923	  return { addedIncVat: partial.incVat }
   924	}
   925	
   926	async function applyPartialSplit(input: {
   927	  supabase: ReturnType<typeof createAdminClient> | null
   928	  persist: boolean
   929	  billingMode: 'full' | 'cap'
   930	  capIncVat: number | null
   931	  runningIncVat: number
   932	  settings: any
   933	  selectedRecurringInstances: any[]
   934	  skippedRecurringInstances: any[]
   935	  selectedMileageEntries: any[]
   936	  skippedMileageEntries: any[]
   937	  selectedTimeEntries: any[]
   938	  skippedTimeEntries: any[]
   939	}) {
 succeeded in 52ms:
  2780	        else skippedTime.push(e)
  2781	      }
  2782	
  2783	      const splitResult = await applyPartialSplit({
  2784	        supabase,
  2785	        persist: true,
  2786	        billingMode,
  2787	        capIncVat,
  2788	        runningIncVat,
  2789	        settings,
  2790	        selectedRecurringInstances,
  2791	        skippedRecurringInstances,
  2792	        selectedMileageEntries: selectedMileage,
  2793	        skippedMileageEntries: skippedMileage,
  2794	        selectedTimeEntries: selectedTime,
  2795	        skippedTimeEntries: skippedTime,
  2796	      })
  2797	
  2798	      if (splitResult.addedIncVat > 0) {
  2799	        runningIncVat = roundMoney(runningIncVat + splitResult.addedIncVat)
codex
1. Yes. App types define `Invoice.vendor_id: string` and `InvoiceWithDetails.vendor?: InvoiceVendor` in [src/types/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/invoices.ts:22) and [src/types/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/invoices.ts:80). The generated DB schema also has `invoices.vendor_id` plus an FK from `invoices.vendor_id` to `invoice_vendors.id` in [src/types/database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:3761) and [src/types/database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:3825). In reads, invoices are linked to vendors via `vendor:invoice_vendors(*)`, not the general `vendors` table, in [src/services/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/invoices.ts:280) and [src/services/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/invoices.ts:337). One nuance: app types require `vendor_id`, but the generated DB type marks it nullable in [src/types/database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:3781).

2. `recordPayment()` validates permission, required fields, amount, and date; loads the invoice’s pre-payment status; then runs `InvoiceService.recordPayment(...)` and `auth.getUser()` in parallel in [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:670), [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:698), and [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:709). The service call is an RPC that inserts an `invoice_payments` row, rejects overpayments, increments `paid_amount`, and sets status to `paid` when fully settled or `partially_paid` when partially settled unless the current status is already `void`/`written_off` in [src/services/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/invoices.ts:164), [supabase/migrations-archive/pre-squash-20251123/20260401130000_create_invoice_transactions.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations-archive/pre-squash-20251123/20260401130000_create_invoice_transactions.sql:81), and [supabase/migrations-archive/pre-squash-20251123/20260401130000_create_invoice_transactions.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations-archive/pre-squash-20251123/20260401130000_create_invoice_transactions.sql:137).  
   Receipt/remittance email is attempted only when status changes from anything other than `paid` to `paid` after the payment write; otherwise `remittanceAdvice` stays `null`, and if the post-payment status check fails it logs and still returns success in [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:733), [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:741), and [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:754). The email helper itself skips when Graph is not configured, invoice lookup fails, the invoice is not `paid`, recipient lookup fails, or no recipient exists; recipients come from `invoice.vendor_id` plus `invoice_vendor_contacts` / vendor email, with `INVOICE_REMITTANCE_TEST_RECIPIENT` able to override the real recipient, and success/failure is logged to `invoice_email_logs` plus audit in [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:62), [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:112), [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:143), [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:199), and [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:219). UI note: the detail page hides the payment button for `void` invoices, but the payment page/action do not add their own status guard in [InvoiceDetailClient.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx:479>) and [payment/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/invoices/[id]/payment/page.tsx:63>).

3. Yes. `InvoiceStatus` includes `'void'` in [src/types/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/invoices.ts:17), and the DB check constraint also includes `void` in [supabase/migrations/20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:11921).

4. `void` support does appear implemented. It has allowed transitions in [src/lib/status-transitions.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/status-transitions.ts:3), UI affordances in [InvoiceDetailClient.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx:101>) and [InvoiceDetailClient.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx:537>), backend handling plus an OJ-projects-linked warning/force override in [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:440), and unpaid-balance logic excludes `void` invoices in [src/app/api/cron/oj-projects-billing/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:1020) and [src/app/api/cron/oj-projects-billing/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:1711). But it is only a status change; the code explicitly says voiding does not automatically unbill linked OJ Projects entries/charges in [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:469).  
   Credit notes do not appear implemented in app code. The only hit is the DB constraint allowing `invoice_emails.email_type = 'credit_note'` in [supabase/migrations/20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:12034) and [supabase/migrations/20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:12050), mirrored as a generic `email_type: string` table type in [src/types/database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:3452). I did not find any credit-note type, action, route, template, or UI flow.
collab wait(call_BsgrfOvpkaFObRRiLvkN8LNj)
  receivers: 019d8b1c-4efb-7543-ac3f-57d6424c62f8, 019d8b1c-7911-7522-a4ce-d04ac1033ab8
wait(call_BsgrfOvpkaFObRRiLvkN8LNj) 1 agents complete:
  019d8b1c-4efb-7543-ac3f-57d6424c62f8 completed: "1. Yes. App types define `Invoice.vendor_id: string` and `InvoiceWithDetails.vendor?: InvoiceVendor` in [src/types/invoi…"
exec
/bin/zsh -lc "rg -n \"credit_note|documentKind|remittance_advice|void\" src/lib/invoice-template-compact.ts src/lib/invoice-template.ts src/lib/microsoft-graph.ts src/services/invoices.ts src/types/invoices.ts src/app/api/invoices/[id]/pdf/route.ts -g '"'!**/*.map'"'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/types/invoices.ts | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/services/invoices.ts | sed -n '1,460p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools exited 1 in 51ms:
zsh:1: no matches found: src/app/api/invoices/[id]/pdf/route.ts
 succeeded in 52ms:
     1	// Invoice-specific vendor type (different from private bookings vendor)
     2	export interface InvoiceVendor {
     3	  id: string
     4	  name: string
     5	  contact_name?: string
     6	  email?: string
     7	  phone?: string
     8	  address?: string
     9	  vat_number?: string
    10	  payment_terms?: number
    11	  notes?: string
    12	  is_active: boolean
    13	  created_at: string
    14	  updated_at: string
    15	}
    16	
    17	export type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue' | 'void' | 'written_off'
    18	export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired'
    19	export type PaymentMethod = 'bank_transfer' | 'card' | 'cash' | 'cheque' | 'other'
    20	export type RecurringFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly'
 succeeded in 52ms:
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
collab wait(call_ECuV0yxEna8cVrreRX52P3fL)
  receivers: 019d8b1c-7911-7522-a4ce-d04ac1033ab8
exec
/bin/zsh -lc "nl -ba src/lib/invoice-template-compact.ts | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"credit_note|documentKind|remittance_advice|PAID IN FULL|outstandingBalance|statement\" src/lib/invoice-template-compact.ts src/lib/invoice-template.ts src/lib/microsoft-graph.ts src/lib/pdf-generator.ts 'src/app/api/invoices/[id]/pdf/route.ts' -g '"'!**/*.map'"'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/lib/invoice-template-compact.ts | sed -n '380,620p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
src/lib/invoice-template-compact.ts:8:export type InvoiceDocumentKind = 'invoice' | 'remittance_advice'
src/lib/invoice-template-compact.ts:20:  documentKind?: InvoiceDocumentKind
src/lib/invoice-template-compact.ts:25:  const { invoice, logoUrl, documentKind = 'invoice', remittance } = data
src/lib/invoice-template-compact.ts:26:  const isRemittanceAdvice = documentKind === 'remittance_advice'
src/lib/invoice-template-compact.ts:149:  const outstandingBalance = Math.max(0, invoice.total_amount - invoice.paid_amount)
src/lib/invoice-template-compact.ts:563:          <span>${formatCurrency(outstandingBalance)}</span>
src/lib/invoice-template-compact.ts:583:          <p><strong>Outstanding Balance:</strong> ${formatCurrency(outstandingBalance)}</p>
src/lib/pdf-generator.ts:37:  documentKind?: InvoiceDocumentKind
src/lib/pdf-generator.ts:152:      documentKind: options.documentKind,
src/lib/microsoft-graph.ts:73:  documentKind?: InvoiceDocumentKind
src/lib/microsoft-graph.ts:102:    const documentKind = emailOptions?.documentKind ?? 'invoice'
src/lib/microsoft-graph.ts:103:    const isRemittanceAdvice = documentKind === 'remittance_advice'
src/lib/microsoft-graph.ts:106:      documentKind,
src/lib/microsoft-graph.ts:111:    const outstandingBalance = Math.max(0, invoice.total_amount - invoice.paid_amount)
src/lib/microsoft-graph.ts:131:Outstanding Balance: £${outstandingBalance.toFixed(2)}
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
 succeeded in 51ms:
   380	      font-weight: 700;
   381	      color: #111827;
   382	    }
   383	    
   384	    .payment-section {
   385	      background: #f9fafb;
   386	      padding: 12px;
   387	      border-radius: 4px;
   388	      margin-top: 15px;
   389	      page-break-inside: avoid;
   390	    }
   391	    
   392	    .payment-section h3 {
   393	      margin: 0 0 8px 0;
   394	      color: #111827;
   395	      font-size: 10pt;
   396	    }
   397	    
   398	    .payment-grid {
   399	      display: grid;
wait(call_ECuV0yxEna8cVrreRX52P3fL) timed out:
exec
/bin/zsh -lc "nl -ba src/app/actions/oj-projects/entries.ts | sed -n '160,210p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/oj-projects/entries.ts | sed -n '318,340p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/oj-projects/entries.ts | sed -n '236,270p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
   160	    work_type_id: formData.get('work_type_id') || undefined,
   161	    description: formData.get('description') || undefined,
   162	    internal_notes: formData.get('internal_notes') || undefined,
   163	    billable: formData.get('billable') ?? undefined,
   164	  })
   165	  if (!parsed.success) return { error: parsed.error.errors[0].message }
   166	
   167	  const rawMinutes = parsed.data.duration_minutes
   168	  const roundedMinutes = Math.ceil(rawMinutes / 15) * 15
   169	  if (roundedMinutes <= 0) return { error: 'Invalid duration after rounding' }
   170	
   171	  const supabase = await createClient()
   172	  const { data: { user } } = await supabase.auth.getUser()
   173	
   174	  const match = await ensureProjectMatchesVendor(supabase, parsed.data.project_id, parsed.data.vendor_id)
   175	  if ('error' in match) return { error: match.error }
   176	
   177	  const workTypeId = parsed.data.work_type_id ? String(parsed.data.work_type_id) : null
   178	  const [settings, workTypeName] = await Promise.all([
   179	    getVendorSettingsOrDefault(supabase, parsed.data.vendor_id),
 succeeded in 51ms:
   318	
   319	  const { data, error } = await supabase
   320	    .from('oj_entries')
   321	    .insert({
   322	      vendor_id: parsed.data.vendor_id,
   323	      project_id: parsed.data.project_id,
   324	      entry_type: 'one_off',
   325	      entry_date: parsed.data.entry_date,
   326	      start_at: null,
   327	      end_at: null,
   328	      duration_minutes_raw: null,
   329	      duration_minutes_rounded: null,
   330	      miles: null,
   331	      work_type_id: null,
   332	      work_type_name_snapshot: null,
   333	      description: parsed.data.description || null,
   334	      internal_notes: parsed.data.internal_notes || null,
   335	      billable: parsed.data.billable ?? true,
   336	      status: 'unbilled',
   337	      hourly_rate_ex_vat_snapshot: null,
 succeeded in 51ms:
   236	    miles: formData.get('miles'),
   237	    description: formData.get('description') || undefined,
   238	    internal_notes: formData.get('internal_notes') || undefined,
   239	    billable: formData.get('billable') ?? undefined,
   240	  })
   241	  if (!parsed.success) return { error: parsed.error.errors[0].message }
   242	
   243	  const supabase = await createClient()
   244	  const { data: { user } } = await supabase.auth.getUser()
   245	
   246	  const match = await ensureProjectMatchesVendor(supabase, parsed.data.project_id, parsed.data.vendor_id)
   247	  if ('error' in match) return { error: match.error }
   248	
   249	  const settings = await getVendorSettingsOrDefault(supabase, parsed.data.vendor_id)
   250	
   251	  const { data, error } = await supabase
   252	    .from('oj_entries')
   253	    .insert({
   254	      vendor_id: parsed.data.vendor_id,
   255	      project_id: parsed.data.project_id,
collab wait(call_JUAzgmjIOEM5T0RlnBfUTfQ4)
  receivers: 019d8b1c-7911-7522-a4ce-d04ac1033ab8
exec
/bin/zsh -lc "rg -n \"ACCOUNT STATEMENT|openingBalance|opening balance|closingBalance|closing balance|running balance|StatementTransaction|account statement|statement transaction|payment received|credit entry|statement-.*pdf\" src -g '"'!**/*.map'"'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
src/services/private-bookings/payments.ts:249:    const smsMessage = `The Anchor: ${booking.customer_first_name}! Final payment received — you're all set for ${eventDate}. We'll be in touch with final details!`;
src/services/private-bookings/payments.ts:363:    const smsMessage = `The Anchor: ${booking.customer_first_name}! Final payment received — you're all set for ${eventDate}. We'll be in touch with final details!`;
src/lib/parking/notifications.ts:68:  const subject = `Parking payment received – ${booking.reference}`
src/lib/events/event-payments.ts:433:    `The Anchor: Hi ${firstName}, payment received. Your booking for ${input.eventName}${datePart} is confirmed for ${input.seats} ${seatWord}.${manageLink ? ` Manage booking: ${manageLink}` : ''}`,
src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx:1452:          toast.success('Deposit payment received successfully.');
exec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx' | sed -n '88,130p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
    88	      }
    89	    })
    90	
    91	    return { totals, lineTotals: lineTotalsMap }
    92	  }, [invoice])
    93	
    94	  async function handleStatusChange(newStatus: InvoiceStatus) {
    95	    if (!invoice || actionLoading) return
    96	    if (!canEdit) {
    97	      setError('You do not have permission to update invoices')
    98	      return
    99	    }
   100	
   101	    if (newStatus === 'void') {
   102	      const confirmed = window.confirm('Void this invoice?')
   103	      if (!confirmed) return
   104	    }
   105	
   106	    setActionLoading(true)
   107	    setError(null)
exec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx' | sed -n '520,550p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
   520	
   521	          <Card className="p-4 sm:p-6">
   522	            <h2 className="text-base sm:text-lg font-semibold mb-4">Actions</h2>
   523	            
   524	            <div className="space-y-2">
   525	              <Button
   526	                variant="secondary"
   527	                fullWidth
   528	                onClick={() => {
   529	                  navigator.clipboard.writeText(window.location.href)
   530	                  toast.success('Link copied to clipboard!')
   531	                }}
   532	                leftIcon={<Copy className="h-4 w-4" />}
   533	              >
   534	                Copy Link
   535	              </Button>
   536	              
   537	              {invoice.status !== 'void' && invoice.status !== 'written_off' && canEdit && (
   538	                <Button
   539	                  variant="secondary"
exec
/bin/zsh -lc "nl -ba .env.example | sed -n '68,82p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
    68	TURNSTILE_SECRET_KEY=your_turnstile_secret_key
    69	
    70	# Cron Secret (for Vercel cron jobs)
    71	CRON_SECRET=your_cron_secret
    72	PRIVATE_BOOKINGS_DAILY_DIGEST_HOUR_LONDON=9
    73	
    74	# Cron failure alert recipient — receives an email when a cron job fails (optional)
    75	CRON_ALERT_EMAIL=manager@the-anchor.pub
    76	
    77	# GitHub Bug Reporting (Optional)
    78	GITHUB_BUG_REPORTER_TOKEN=ghp_your_token
    79	GITHUB_OWNER=your_github_org_or_user
    80	GITHUB_REPO=your_repo_name
    81	
    82	# Google Calendar Extended (Optional - for service account / delegate access)
exec
/bin/zsh -lc "rg -n \"void_reason|voided_at|credit_notes|credit note|credit_note\" src supabase/migrations src/types -g '"'!**/*.map'"'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
supabase/migrations/20251123120000_squashed.sql:12050:    CONSTRAINT invoice_emails_email_type_check CHECK (((email_type)::text = ANY ((ARRAY['new_invoice'::character varying, 'reminder'::character varying, 'chase'::character varying, 'credit_note'::character varying, 'statement'::character varying, 'quote'::character varying])::text[]))),
wait(call_JUAzgmjIOEM5T0RlnBfUTfQ4) timed out:
codex
The picture is clear now: 1.1 is partly covered, 4.3 is partly covered, and the rest of the requested items are either absent or intentionally short of the spec. I’m assembling the final findings with severity/classification hints and exact references.
Plan update
  ✓ Read the OJ Projects review spec and extract the exact expected behaviors for the requested items
  ✓ Trace implementation across models, billing cron, actions, emails, and UI components
  → Compare spec vs code and assemble concise findings with file/line references and classification hints
exec
/bin/zsh -lc "rg -n \"reportCronFailure|CRON_ALERT_EMAIL|sendEmail\\({ to: .*alert|alert email|failure alert\" src/app/api/cron/oj-projects-billing/route.ts src/lib/cron/alerting.ts src" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"Payments|payment history|getProjectPaymentHistory|invoice_payments|total billed|total paid|total outstanding\" src/app/actions/oj-projects/projects.ts 'src/app/(authenticated)/oj-projects/projects/[id]/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"Download PDF|Email to Client|Statement|statement\" 'src/app/(authenticated)/oj-projects/clients/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
60:  statement_mode: boolean
118:    statement_mode: false,
273:        statement_mode: !!s?.statement_mode,
312:      fd.append('statement_mode', settings.statement_mode ? 'on' : 'off')
747:                <FormGroup label="Statement Mode">
749:                    checked={settings.statement_mode}
750:                    onChange={(e) => setSettings({ ...settings, statement_mode: e.target.checked })}
752:                    label="Send balance statement invoices"
794:                  {settings.statement_mode ? 'Preview Statement Invoice' : 'Preview Invoice (Dry Run)'}
1029:        title={previewVendor?.statement_mode ? 'Statement Invoice Preview (Dry Run)' : 'Invoice Preview (Dry Run)'}
 exited 1 in 51ms:

 exited 2 in 51ms:
rg: regex parse error:
    (?:reportCronFailure|CRON_ALERT_EMAIL|sendEmail\({ to: .*alert|alert email|failure alert)
                                                       ^
error: repetition quantifier expects a valid decimal
codex
I’ve verified the remaining completeness items: there’s no project payment history action/UI, no client-statement action/PDF flow, and no billing alert email path in the OJ cron. I’m consolidating this into the final matrix now, with exact classifications rather than a vague “mostly missing” summary.
exec
/bin/zsh -lc "rg -n \"reportCronFailure|CRON_ALERT_EMAIL|OJ_PROJECTS_BILLING_ALERT_EMAIL|sendEmail\\(\" src/app/api/cron/oj-projects-billing/route.ts src/lib/cron/alerting.ts src/lib/email/emailService.ts src" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
src/lib/cron/alerting.ts:42: * CRON_ALERT_EMAIL address. Fails silently (logs to console) if the email
src/lib/cron/alerting.ts:52:export async function reportCronFailure(
src/lib/cron/alerting.ts:57:  const alertEmail = process.env.CRON_ALERT_EMAIL
src/lib/cron/alerting.ts:60:      `[cron-alert] CRON_ALERT_EMAIL not configured; skipping failure alert for ${cronName}`
src/lib/cron/alerting.ts:107:    const result = await sendEmail({
src/lib/email/emailService.ts:25:export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; error?: string; messageId?: string }> {
src/lib/email/emailService.ts:103:  return sendEmail({ to, subject, text: body });
src/lib/table-bookings/charge-approvals.ts:280:  const emailResult = await sendEmail({
src/lib/cron/alerting.ts:42: * CRON_ALERT_EMAIL address. Fails silently (logs to console) if the email
src/lib/cron/alerting.ts:52:export async function reportCronFailure(
src/lib/cron/alerting.ts:57:  const alertEmail = process.env.CRON_ALERT_EMAIL
src/lib/cron/alerting.ts:60:      `[cron-alert] CRON_ALERT_EMAIL not configured; skipping failure alert for ${cronName}`
src/lib/cron/alerting.ts:107:    const result = await sendEmail({
src/lib/table-bookings/bookings.ts:362:  const emailResult = await sendEmail({
src/lib/email/employee-invite-emails.ts:56:  return sendEmail({ to: email, subject, text, cc });
src/lib/email/employee-invite-emails.ts:61:  return sendEmail({ to: email, subject, text, cc });
src/lib/email/employee-invite-emails.ts:66:  return sendEmail({ to: email, subject, text, cc });
src/lib/email/employee-invite-emails.ts:71:  return sendEmail({ to: MANAGER_EMAIL, subject, text });
src/lib/email/emailService.ts:25:export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; error?: string; messageId?: string }> {
src/lib/email/emailService.ts:103:  return sendEmail({ to, subject, text: body });
exec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/oj-projects/clients/page.tsx' | sed -n '1000,1065p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"selected_entry_ids|carried_forward_inc_vat|error_message|run_finished_at|status: 'failed'|status: 'sent'\" src/app/api/cron/oj-projects-billing/route.ts | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
  1000	                    </div>
  1001	
  1002	                    <div className="sm:col-span-2 flex gap-2 justify-end pt-1">
  1003	                      {contactForm.id && (
  1004	                        <Button
  1005	                          type="button"
  1006	                          variant="secondary"
  1007	                          onClick={() => setContactForm({ name: '', email: '', phone: '', role: '', is_primary: false, receive_invoice_copy: false })}
  1008	                          disabled={!canEditContacts}
  1009	                        >
  1010	                          Cancel
  1011	                        </Button>
  1012	                      )}
  1013	                      <Button type="submit" loading={contactSaving} disabled={!canEditContacts || contactSaving}>
  1014	                        {contactForm.id ? 'Save Contact' : 'Add Contact'}
  1015	                      </Button>
  1016	                    </div>
  1017	                  </div>
  1018	                </form>
  1019	              </div>
 succeeded in 51ms:
1645:      carried_forward_inc_vat: carriedForwardIncVat,
2071:      status: 'sent' | 'skipped' | 'failed'
2183:            status: 'failed',
2184:            error_message: 'Email service is not configured',
2191:            status: 'failed',
2230:            status: 'sent',
2231:            error_message: null,
2232:            run_finished_at: new Date().toISOString(),
2237:          results.vendors.push({ vendor_id: vendorId, status: 'sent', invoice_id: invoice.id, invoice_number: invoice.invoice_number })
2258:          const carriedForwardIncVat = typeof billingRun?.carried_forward_inc_vat === 'number' ? billingRun.carried_forward_inc_vat : null
2330:            status: 'failed',
2331:            error_message: 'Invoice email idempotency conflict; manual reconciliation required.',
2332:            run_finished_at: new Date().toISOString(),
2339:            status: 'failed',
2374:              status: 'failed',
2375:              error_message: sendRes.error || 'Failed to send invoice email',
2382:              status: 'failed',
2393:          .update({ status: 'sent', updated_at: new Date().toISOString() })
2423:            status: 'failed',
2424:            error_message: 'Invoice email sent but invoice status update failed',
exec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '636,650p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '1410,1426p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '228,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
   636	  }
   637	  return `${base}-S${maxIndex + 1}`
   638	}
   639	
   640	async function splitRecurringInstanceForCap(input: {
   641	  supabase: ReturnType<typeof createAdminClient> | null
   642	  persist: boolean
   643	  headroom: number
   644	  selectedRecurringInstances: any[]
   645	  skippedRecurringInstances: any[]
   646	}) {
   647	  const index = input.skippedRecurringInstances.findIndex((item) => getRecurringCharge(item).incVat > 0)
   648	  if (index < 0) return null
   649	
   650	  const candidate = input.skippedRecurringInstances[index]
 succeeded in 52ms:
  1410	
  1411	  const selectedRecurringInstances: any[] = []
  1412	  const selectedOneOff: any[] = []
  1413	  const selectedMileage: any[] = []
  1414	  const selectedTime: any[] = []
  1415	  const skippedRecurringInstances: any[] = []
  1416	  const skippedOneOff: any[] = []
  1417	  const skippedMileage: any[] = []
  1418	  const skippedTime: any[] = []
  1419	
  1420	  let runningIncVat = 0
  1421	  const capPounds = capIncVat != null ? roundMoney(Number(capIncVat) || 0) : null
  1422	
  1423	  const includeItem = (incVat: number) => {
  1424	    if (billingMode !== 'cap') return true
  1425	    if (!capPounds || capPounds <= 0) return false
  1426	    const next = roundMoney(runningIncVat + incVat)
 succeeded in 52ms:
   228	  return {
   229	    period_start: toIsoDateUtc(prevMonthStartUtc),
   230	    period_end: toIsoDateUtc(prevMonthEndUtc),
   231	    period_yyyymm: formatInTimeZone(prevMonthEndUtc, LONDON_TZ, 'yyyy-MM'),
   232	  }
   233	}
   234	
   235	function buildInvoiceNotes(input: {
   236	  period_start: string
   237	  period_end: string
   238	  selectedTimeEntries: any[]
   239	  selectedMileageEntries: any[]
   240	  selectedOneOffEntries?: any[]
   241	  includeEntryDetails: boolean
   242	  billingMode: 'full' | 'cap'
   243	  capIncVat: number | null
   244	  carriedForwardIncVat: number | null
   245	  carriedForwardRecurringInstances?: any[]
   246	  carriedForwardMileageEntries?: any[]
   247	  carriedForwardTimeEntries?: any[]
exec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '2060,2095p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"payment/page.tsx|recordPayment\\(|void|written_off\" 'src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx' 'src/app/(authenticated)/invoices/[id]/payment/page.tsx' src/lib/status-transitions.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
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
  2078	  for (const vendorId of vendorIds) {
  2079	    results.processed++
 succeeded in 50ms:
src/lib/status-transitions.ts:4:  draft: ['draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void', 'written_off'],
src/lib/status-transitions.ts:5:  sent: ['sent', 'partially_paid', 'paid', 'overdue', 'void', 'written_off'],
src/lib/status-transitions.ts:6:  partially_paid: ['partially_paid', 'paid', 'overdue', 'void', 'written_off'],
src/lib/status-transitions.ts:7:  overdue: ['overdue', 'sent', 'partially_paid', 'paid', 'void', 'written_off'],
src/lib/status-transitions.ts:9:  void: ['void'],
src/lib/status-transitions.ts:10:  written_off: ['written_off'],
src/app/(authenticated)/invoices/[id]/payment/page.tsx:125:      const result = await recordPayment(formData)
src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx:101:    if (newStatus === 'void') {
src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx:116:      if (newStatus === 'void' && result?.error && result?.code === 'OJ_LINKED_ITEMS') {
src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx:117:        const force = window.confirm(`${result.error}\n\nForce void anyway? This will not unbill linked OJ Projects items.`)
src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx:180:      case 'void': return 'secondary'
src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx:181:      case 'written_off': return 'secondary'
src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx:479:              {invoice.status !== 'paid' && invoice.status !== 'void' && (
src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx:537:              {invoice.status !== 'void' && invoice.status !== 'written_off' && canEdit && (
src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx:541:                  onClick={() => handleStatusChange('void')}
exec
/bin/zsh -lc "nl -ba src/lib/invoice-template-compact.ts | sed -n '140,420p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"Outstanding Balance|PAID IN FULL|Receipt|remittance\" src/lib/invoice-template-compact.ts | sed -n '1,160p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
   140	      const bDate = new Date(b.payment_date || b.created_at || 0).getTime()
   141	      return bDate - aDate
   142	    })[0]
   143	
   144	  const remittancePaymentAmount = remittance?.paymentAmount ?? latestPayment?.amount ?? invoice.paid_amount
   145	  const remittancePaymentDate = remittance?.paymentDate ?? latestPayment?.payment_date ?? null
   146	  const remittancePaymentMethod = remittance?.paymentMethod ?? latestPayment?.payment_method ?? null
   147	  const remittancePaymentReference =
   148	    remittance?.paymentReference ?? latestPayment?.reference ?? invoice.reference ?? null
   149	  const outstandingBalance = Math.max(0, invoice.total_amount - invoice.paid_amount)
   150	
   151	  // Internally we still call this "remittance advice", but the customer-facing term is "Receipt".
   152	  const documentTitle = isRemittanceAdvice ? 'Receipt' : 'Invoice'
   153	  const documentHeader = isRemittanceAdvice ? 'RECEIPT' : 'INVOICE'
   154	  const documentNumberLabel = isRemittanceAdvice
   155	    ? `For Invoice #${invoice.invoice_number}`
   156	    : `#${invoice.invoice_number}`
   157	
   158	  const secondMetaLabel = isRemittanceAdvice ? 'Payment Date' : 'Due Date'
   159	  const secondMetaValue = isRemittanceAdvice
 succeeded in 51ms:
8:export type InvoiceDocumentKind = 'invoice' | 'remittance_advice'
21:  remittance?: InvoiceRemittanceDetails
25:  const { invoice, logoUrl, documentKind = 'invoice', remittance } = data
26:  const isRemittanceAdvice = documentKind === 'remittance_advice'
144:  const remittancePaymentAmount = remittance?.paymentAmount ?? latestPayment?.amount ?? invoice.paid_amount
145:  const remittancePaymentDate = remittance?.paymentDate ?? latestPayment?.payment_date ?? null
146:  const remittancePaymentMethod = remittance?.paymentMethod ?? latestPayment?.payment_method ?? null
147:  const remittancePaymentReference =
148:    remittance?.paymentReference ?? latestPayment?.reference ?? invoice.reference ?? null
151:  // Internally we still call this "remittance advice", but the customer-facing term is "Receipt".
152:  const documentTitle = isRemittanceAdvice ? 'Receipt' : 'Invoice'
160:    ? formatDateOrDash(remittancePaymentDate)
165:    ? formatPaymentMethod(remittancePaymentMethod)
170:    ? remittancePaymentReference || '-'
562:          <span>Outstanding Balance</span>
576:      <h3>Receipt Details</h3>
581:          <p><strong>Payment Received:</strong> ${formatCurrency(remittancePaymentAmount)}</p>
583:          <p><strong>Outstanding Balance:</strong> ${formatCurrency(outstandingBalance)}</p>
588:          <p><strong>Payment Date:</strong> ${escapeHtml(formatDateOrDash(remittancePaymentDate))}</p>
589:          <p><strong>Method:</strong> ${escapeHtml(formatPaymentMethod(remittancePaymentMethod))}</p>
exec
/bin/zsh -lc "nl -ba src/types/invoices.ts | sed -n '145,180p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/types/database.generated.ts | sed -n '3310,3412p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
   145	  next_invoice_date: string
   146	  days_before_due: number
   147	  reference?: string
   148	  invoice_discount_percentage: number
   149	  notes?: string
   150	  internal_notes?: string
   151	  is_active: boolean
   152	  last_invoice_id?: string
   153	  created_at: string
   154	  updated_at: string
   155	}
   156	
   157	export interface RecurringInvoiceLineItem {
   158	  id: string
   159	  recurring_invoice_id: string
   160	  catalog_item_id?: string
   161	  description: string
   162	  quantity: number
   163	  unit_price: number
   164	  discount_percentage: number
 succeeded in 51ms:
  3310	        Row: {
  3311	          action: string
  3312	          created_at: string | null
  3313	          details: Json | null
  3314	          id: string
  3315	          invoice_id: string | null
  3316	          ip_address: unknown
  3317	          new_values: Json | null
  3318	          old_values: Json | null
  3319	          performed_by: string | null
  3320	          performed_by_email: string | null
  3321	          user_agent: string | null
  3322	        }
  3323	        Insert: {
  3324	          action: string
  3325	          created_at?: string | null
  3326	          details?: Json | null
  3327	          id?: string
  3328	          invoice_id?: string | null
  3329	          ip_address?: unknown
codex
**Findings**
- `[High][Missing][4.4]` Void/credit-note support is not implemented to spec, and the current void flow can leave OJ-linked items stranded on a void invoice. [invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:440) explicitly blocks voiding linked OJ items unless forced, [InvoiceDetailClient.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx:116>) tells the user forced voiding “will not unbill linked OJ Projects items,” and [services/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/invoices.ts:430) only updates `status`/`updated_at`. I found no `voidInvoice(...)`, no `credit_notes` table/action, and [invoice-template-compact.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:8) only supports `'invoice' | 'remittance_advice'`.

- `[High][Missing][Phase 2]` The client statement feature is absent; the Clients page only supports monthly invoice dry-run preview, not a date-ranged account statement with PDF/email. [clients/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:786>) only offers “Preview Statement Invoice / Preview Invoice,” and [clients/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:1026>) opens a dry-run invoice modal with no statement date range, PDF download, or email action. I found no `src/app/actions/oj-projects/client-statement.ts` or `src/lib/oj-statement.ts`.

- `[High][Missing][1.4]` Cap-mode split fallback for entries without `start_at`/`end_at` is still missing, and the current code silently gives up. UI-created time entries are written with null timestamps in [entries.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/entries.ts:190), while [oj-projects-billing/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:844) returns `null` when timestamps are absent/invalid and [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:966) has no fallback path or warning before returning `addedIncVat: 0`.

- `[Medium][Missing][4.1]` Project payment history UI/action is not there. The detail page only loads contacts and entries in [projects/[id]/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/projects/[id]/page.tsx:91>), derives billed/paid totals from entry status in [projects/[id]/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/projects/[id]/page.tsx:110>), and renders only a “Project Entries” table in [projects/[id]/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/projects/[id]/page.tsx:383>). I found no `getProjectPaymentHistory(projectId)`.

- `[Medium][Missing][4.2]` Billing cron alert emails are not wired up. The route accumulates `results` and returns JSON in [oj-projects-billing/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:2062) and [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:3433), but never calls the generic alert helper in [alerting.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/cron/alerting.ts:52). There is also no `OJ_PROJECTS_BILLING_ALERT_EMAIL` in [env.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/env.ts:4) or [.env.example](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/.env.example:74).

- `[Medium][Missing][1.2]` Client balance still excludes unbilled `one_off` charges. [client-balance.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/client-balance.ts:75) only accumulates `time` and `mileage`, and the Clients UI breakdown in [clients/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:591>) only renders Time/Mileage/Recurring buckets.

- `[Medium][Missing][1.3]` The domain type for `oj_recurring_charge_instances` is still missing, and the billing cron remains heavily `any`-typed. The table exists in generated DB types at [database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:6130), but [oj-projects.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/oj-projects.ts:1) exports no `OJRecurringChargeInstance`, and the cron uses `any` throughout from [oj-projects-billing/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:99) onward.

- `[Low][Missing][1.5]` `deriveClientCode()` is still duplicated instead of extracted to a shared OJ Projects util. The same implementation appears in [projects.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/projects.ts:27) and [oj-projects-retainer-projects/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-retainer-projects/route.ts:12), and I found no `src/lib/oj-projects/utils.ts`.

- `[Low][Partial][4.3]` Statement-mode explanatory UI is only partially covered. The toggle already has short helper text in [clients/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:747>), but there is no tooltip/help copy matching the spec and no active visual indicator/badge outside the checkbox state.

- `[Low][Partial][1.1]` The `one_off` constraint gap itself appears already fixed, but the requested data-fix/backfill is missing. Both [20260226120000_oj_entries_one_off.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260226120000_oj_entries_one_off.sql:21) and [20260512000000_oj_entries_relax_time_constraint.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql:9) enforce a `one_off` arm on `chk_oj_entries_time_fields`, but neither migration includes the spec’s cleanup `UPDATE` to null existing spurious `miles` / `duration_minutes_rounded` values.
Plan update
  ✓ Read the review design spec and extract every required item: 1.1-1.5, Phase 2, Phase 3, 4.1-4.4
  ✓ Inspect implemented code paths and schemas related to each spec item, including invoice types and actions
  → Produce a structured traceability matrix with classification and implementation risk per item
exec
/bin/zsh -lc "nl -ba .env.example | sed -n '60,95p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/lib/env.ts | sed -n '1,120p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc 'rg -n "OJ_PROJECTS_BILLING_ALERT_EMAIL|CRON_ALERT_EMAIL" .env.example src/lib/env.ts' in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
    60	
    61	# Google Calendar Configuration (Optional)
    62	GOOGLE_CALENDAR_CLIENT_ID=your_google_client_id
    63	GOOGLE_CALENDAR_CLIENT_SECRET=your_google_client_secret
    64	GOOGLE_CALENDAR_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
    65	GOOGLE_CALENDAR_ID=your_calendar_id@group.calendar.google.com
    66	
    67	# Cloudflare Turnstile (bot protection for public booking endpoints)
    68	TURNSTILE_SECRET_KEY=your_turnstile_secret_key
    69	
    70	# Cron Secret (for Vercel cron jobs)
    71	CRON_SECRET=your_cron_secret
    72	PRIVATE_BOOKINGS_DAILY_DIGEST_HOUR_LONDON=9
    73	
    74	# Cron failure alert recipient — receives an email when a cron job fails (optional)
    75	CRON_ALERT_EMAIL=manager@the-anchor.pub
    76	
    77	# GitHub Bug Reporting (Optional)
    78	GITHUB_BUG_REPORTER_TOKEN=ghp_your_token
    79	GITHUB_OWNER=your_github_org_or_user
 succeeded in 52ms:
     1	import { z } from 'zod';
     2	
     3	// Define the schema for environment variables
     4	const envSchema = z.object({
     5	  // Public variables (available to client and server)
     6	  NEXT_PUBLIC_SUPABASE_URL: z.string().url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
     7	  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
     8	  NEXT_PUBLIC_APP_URL: z.string().url('NEXT_PUBLIC_APP_URL must be a valid URL'),
     9	  NEXT_PUBLIC_CONTACT_PHONE_NUMBER: z.string().optional(),
    10	  
    11	  // Server-only variables
    12	  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
    13	  TWILIO_ACCOUNT_SID: z.string().optional(),
    14	  TWILIO_AUTH_TOKEN: z.string().optional(),
    15	  TWILIO_PHONE_NUMBER: z.string().optional(),
    16	  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
    17	  STRIPE_SECRET_KEY: z.string().optional(),
    18	  STRIPE_WEBHOOK_SECRET: z.string().optional(),
    19	  SUSPEND_EVENT_SMS: z.string().optional(),
    20	  SUSPEND_ALL_SMS: z.string().optional(),
 succeeded in 51ms:
.env.example:75:CRON_ALERT_EMAIL=manager@the-anchor.pub
exec
/bin/zsh -lc "nl -ba src/app/actions/oj-projects/entries.ts | sed -n '220,280p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/oj-projects/entries.ts | sed -n '160,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
   160	    work_type_id: formData.get('work_type_id') || undefined,
   161	    description: formData.get('description') || undefined,
   162	    internal_notes: formData.get('internal_notes') || undefined,
   163	    billable: formData.get('billable') ?? undefined,
   164	  })
   165	  if (!parsed.success) return { error: parsed.error.errors[0].message }
   166	
   167	  const rawMinutes = parsed.data.duration_minutes
   168	  const roundedMinutes = Math.ceil(rawMinutes / 15) * 15
   169	  if (roundedMinutes <= 0) return { error: 'Invalid duration after rounding' }
   170	
   171	  const supabase = await createClient()
   172	  const { data: { user } } = await supabase.auth.getUser()
   173	
   174	  const match = await ensureProjectMatchesVendor(supabase, parsed.data.project_id, parsed.data.vendor_id)
   175	  if ('error' in match) return { error: match.error }
   176	
   177	  const workTypeId = parsed.data.work_type_id ? String(parsed.data.work_type_id) : null
   178	  const [settings, workTypeName] = await Promise.all([
   179	    getVendorSettingsOrDefault(supabase, parsed.data.vendor_id),
 succeeded in 52ms:
   220	      entry_date: data.entry_date,
   221	      duration_minutes_rounded: data.duration_minutes_rounded,
   222	    },
   223	  })
   224	
   225	  return { entry: data, success: true as const }
   226	}
   227	
   228	export async function createMileageEntry(formData: FormData) {
   229	  const hasPermission = await checkUserPermission('oj_projects', 'create')
   230	  if (!hasPermission) return { error: 'You do not have permission to create entries' }
   231	
   232	  const parsed = MileageEntrySchema.safeParse({
   233	    vendor_id: formData.get('vendor_id'),
   234	    project_id: formData.get('project_id'),
   235	    entry_date: formData.get('entry_date'),
   236	    miles: formData.get('miles'),
   237	    description: formData.get('description') || undefined,
   238	    internal_notes: formData.get('internal_notes') || undefined,
   239	    billable: formData.get('billable') ?? undefined,
collab close_agent(call_PWfjfo262ub96wNYDTXtVhN9)
  receiver: 019d8b1c-4efb-7543-ac3f-57d6424c62f8
close_agent(call_PWfjfo262ub96wNYDTXtVhN9) completed: "1. Yes. App types define `Invoice.vendor_id: string` and `InvoiceWithDetails.vendor?: InvoiceVendor` in [src/types/invoi…":
  receiver: 019d8b1c-4efb-7543-ac3f-57d6424c62f8
collab close_agent(call_uftCdyseRF7MCgk8wMWst4e7)
  receiver: 019d8b1c-7911-7522-a4ce-d04ac1033ab8
close_agent(call_uftCdyseRF7MCgk8wMWst4e7) completed: "**Findings**
- `[High][Missing][4.4]` Void/credit-note support is not implemented to spec, and the current void flow can…":
  receiver: 019d8b1c-7911-7522-a4ce-d04ac1033ab8
codex
**Critical Checks**
- `invoices.vendor_id`: yes. It exists in [src/types/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/invoices.ts:22), the generated DB schema in [src/types/database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:3761), and is used across invoice reads/actions in [src/services/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/invoices.ts:280), [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:145), and [src/lib/invoice-recipients.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-recipients.ts:43). One mismatch: generated DB types mark it nullable, app types do not.
- `recordPayment()`: it validates fields, reads pre-payment status, calls the RPC-backed [InvoiceService.recordPayment]( /Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/invoices.ts:164) via [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:670), then only sends a receipt if status changed from non-`paid` to `paid` at [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:743). The DB RPC sets `partially_paid` for partial settlements and `paid` for full settlement in [supabase/migrations/20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:18223).
- `InvoiceStatus` includes `void`: yes in [src/types/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/invoices.ts:17).
- Invoice/vendor linkage: invoices link directly through `invoices.vendor_id -> invoice_vendors.id` in [src/types/database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:3825). OJ items link to invoices through `oj_entries.invoice_id` / `oj_recurring_charge_instances.invoice_id` in [src/types/oj-projects.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/oj-projects.ts:83) and [src/types/database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:6006).

**Requirements Traceability Matrix**
**1.1**
Spec: strengthen `one_off` DB validation and add a cleanup migration for bad historical rows.
Code: `chk_oj_entries_time_fields` already has a `one_off` arm in [20260226120000_oj_entries_one_off.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260226120000_oj_entries_one_off.sql:21) and [20260512000000_oj_entries_relax_time_constraint.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql:9), but it still does not enforce null `hourly_rate_ex_vat_snapshot` / `mileage_rate_snapshot`, and I found no data-fix migration. Insert clears those fields in [entries.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/entries.ts:319), but update-to-`one_off` does not null prior type-specific fields in [entries.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/entries.ts:466).
Classification: `PARTIAL`
Implementation risk: medium; historical and converted rows can retain stale data.

**1.2**
Spec: include unbilled `one_off` charges in client balance and any per-type UI breakdown.
Code: [client-balance.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/client-balance.ts:75) only sums `time` and `mileage`; [clients/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:591>) only shows Time/Mileage/Recurring.
Classification: `MISSING`
Implementation risk: medium-high; client balances are understated.

**1.3**
Spec: add `OJRecurringChargeInstance` type and replace cron `any` usage with it.
Code: the table exists in generated types at [database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:6130), but [src/types/oj-projects.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/oj-projects.ts:1) has no `OJRecurringChargeInstance`, and the cron still uses `any[]` in places like [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:238), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:640), and [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:1411).
Classification: `MISSING`
Implementation risk: low-medium; mainly maintainability and type-safety.

**1.4**
Spec: add cap-mode fallback splitting for time entries without timestamps and log a warning.
Code: UI-created time entries are saved with `start_at/end_at = null` in [entries.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/entries.ts:183), `splitTimeEntryForCap()` returns `null` when timestamps are absent in [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:844), and `applyPartialSplit()` just returns `addedIncVat: 0` with no warning in [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:926).
Classification: `MISSING`
Implementation risk: high; silent underbilling in cap mode.

**1.5**
Spec: extract duplicated `deriveClientCode()` to shared OJ utils.
Code: same function still exists in [projects.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/projects.ts:27) and [oj-projects-retainer-projects/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-retainer-projects/route.ts:12); no shared util file exists.
Classification: `MISSING`
Implementation risk: low; drift risk only.

**Phase 2**
Spec: standalone client statement action, PDF, date-range UI, email flow, running balance.
Code: no `src/app/actions/oj-projects/client-statement.ts` or `src/lib/oj-statement.ts`. The Clients page only offers statement-mode invoice preview in [clients/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:786>) and a dry-run modal in [clients/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:1026>). There is adjacent statement-mode billing logic in [oj-projects-billing/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:979), but it is for monthly invoice generation, not client statements.
Classification: `MISSING`
Implementation risk: high; no statement workflow exists.

**Phase 3**
Spec: send payment receipts for both `paid` and `partially_paid`, rename helper, vary subject, and prevent double-send.
Code: `recordPayment()` only triggers receipt sending on transition to `paid` in [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:743); `sendRemittanceAdviceForPaidInvoice()` explicitly aborts unless invoice status is `paid` at [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:129). The receipt template already supports remittance details and outstanding balance in [invoice-template-compact.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:144) and [invoice-template-compact.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:576). There is no duplicate-send lookup, and `invoice_email_logs` has no payment-specific key in [database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:3359).
Classification: `PARTIAL`
Implementation risk: medium-high; partial payments get no receipt and retries can duplicate sends.

**4.1**
Spec: add project payment history UI/action with invoice/payment joins and billed/paid/outstanding totals.
Code: project detail only loads project, contacts, and entries in [projects/[id]/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/projects/[id]/page.tsx:86>) and renders a “Project Entries” table in [projects/[id]/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/projects/[id]/page.tsx:383>). There is no `getProjectPaymentHistory()`. Current totals are entry-status based in [projects/[id]/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/projects/[id]/page.tsx:110>) and do not handle `one_off`.
Classification: `MISSING`
Implementation risk: medium; no trustworthy project payment audit trail.

**4.2**
Spec: send internal billing-cron alerts for failures and suspicious zero-vendor runs, with dedicated env var fallback.
Code: the cron records per-vendor failures in `results` at [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:2062) and returns JSON at [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:3433), but never calls [reportCronFailure()](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/cron/alerting.ts:52) or `sendEmail()`. `.env.example` only exposes `CRON_ALERT_EMAIL` in [.env.example](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/.env.example:75), and [src/lib/env.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/env.ts:4) has no `OJ_PROJECTS_BILLING_ALERT_EMAIL`.
Classification: `MISSING`
Implementation risk: medium-high; failures can remain silent.

**4.3**
Spec: clearer statement-mode help text plus visible active-state indicator.
Code: the toggle already has brief description text in [clients/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:747>) and preview copy changes in [clients/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:794>) and [clients/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:1029>). I found no badge or separate active visual indicator.
Classification: `PARTIAL`
Implementation risk: low; mainly operator confusion.

**4.4**
Spec: dedicated void flow that reverts OJ-linked billing state, plus credit notes, statement integration, PDFs, and email support.
Code: `void` already exists as an invoice status in [src/types/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/invoices.ts:17), but the current flow is just generic status update in [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:410) and [src/services/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/invoices.ts:407). If an invoice is OJ-linked, the UI and action explicitly warn that force-voiding will not unbill linked items in [InvoiceDetailClient.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx:116>) and [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:469). I found no `voidInvoice()`, no `credit_notes` table/action, and the PDF template only supports `'invoice' | 'remittance_advice'` in [invoice-template-compact.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:8).
Classification: `DEVIATION`
Implementation risk: high; forced voids can strand OJ entries/instances, and credit-note support is absent.
tokens used
1,123,171
**Critical Checks**
- `invoices.vendor_id`: yes. It exists in [src/types/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/invoices.ts:22), the generated DB schema in [src/types/database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:3761), and is used across invoice reads/actions in [src/services/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/invoices.ts:280), [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:145), and [src/lib/invoice-recipients.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-recipients.ts:43). One mismatch: generated DB types mark it nullable, app types do not.
- `recordPayment()`: it validates fields, reads pre-payment status, calls the RPC-backed [InvoiceService.recordPayment]( /Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/invoices.ts:164) via [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:670), then only sends a receipt if status changed from non-`paid` to `paid` at [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:743). The DB RPC sets `partially_paid` for partial settlements and `paid` for full settlement in [supabase/migrations/20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:18223).
- `InvoiceStatus` includes `void`: yes in [src/types/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/invoices.ts:17).
- Invoice/vendor linkage: invoices link directly through `invoices.vendor_id -> invoice_vendors.id` in [src/types/database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:3825). OJ items link to invoices through `oj_entries.invoice_id` / `oj_recurring_charge_instances.invoice_id` in [src/types/oj-projects.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/oj-projects.ts:83) and [src/types/database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:6006).

**Requirements Traceability Matrix**
**1.1**
Spec: strengthen `one_off` DB validation and add a cleanup migration for bad historical rows.
Code: `chk_oj_entries_time_fields` already has a `one_off` arm in [20260226120000_oj_entries_one_off.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260226120000_oj_entries_one_off.sql:21) and [20260512000000_oj_entries_relax_time_constraint.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql:9), but it still does not enforce null `hourly_rate_ex_vat_snapshot` / `mileage_rate_snapshot`, and I found no data-fix migration. Insert clears those fields in [entries.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/entries.ts:319), but update-to-`one_off` does not null prior type-specific fields in [entries.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/entries.ts:466).
Classification: `PARTIAL`
Implementation risk: medium; historical and converted rows can retain stale data.

**1.2**
Spec: include unbilled `one_off` charges in client balance and any per-type UI breakdown.
Code: [client-balance.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/client-balance.ts:75) only sums `time` and `mileage`; [clients/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:591>) only shows Time/Mileage/Recurring.
Classification: `MISSING`
Implementation risk: medium-high; client balances are understated.

**1.3**
Spec: add `OJRecurringChargeInstance` type and replace cron `any` usage with it.
Code: the table exists in generated types at [database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:6130), but [src/types/oj-projects.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/oj-projects.ts:1) has no `OJRecurringChargeInstance`, and the cron still uses `any[]` in places like [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:238), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:640), and [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:1411).
Classification: `MISSING`
Implementation risk: low-medium; mainly maintainability and type-safety.

**1.4**
Spec: add cap-mode fallback splitting for time entries without timestamps and log a warning.
Code: UI-created time entries are saved with `start_at/end_at = null` in [entries.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/entries.ts:183), `splitTimeEntryForCap()` returns `null` when timestamps are absent in [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:844), and `applyPartialSplit()` just returns `addedIncVat: 0` with no warning in [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:926).
Classification: `MISSING`
Implementation risk: high; silent underbilling in cap mode.

**1.5**
Spec: extract duplicated `deriveClientCode()` to shared OJ utils.
Code: same function still exists in [projects.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/projects.ts:27) and [oj-projects-retainer-projects/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-retainer-projects/route.ts:12); no shared util file exists.
Classification: `MISSING`
Implementation risk: low; drift risk only.

**Phase 2**
Spec: standalone client statement action, PDF, date-range UI, email flow, running balance.
Code: no `src/app/actions/oj-projects/client-statement.ts` or `src/lib/oj-statement.ts`. The Clients page only offers statement-mode invoice preview in [clients/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:786>) and a dry-run modal in [clients/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:1026>). There is adjacent statement-mode billing logic in [oj-projects-billing/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:979), but it is for monthly invoice generation, not client statements.
Classification: `MISSING`
Implementation risk: high; no statement workflow exists.

**Phase 3**
Spec: send payment receipts for both `paid` and `partially_paid`, rename helper, vary subject, and prevent double-send.
Code: `recordPayment()` only triggers receipt sending on transition to `paid` in [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:743); `sendRemittanceAdviceForPaidInvoice()` explicitly aborts unless invoice status is `paid` at [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:129). The receipt template already supports remittance details and outstanding balance in [invoice-template-compact.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:144) and [invoice-template-compact.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:576). There is no duplicate-send lookup, and `invoice_email_logs` has no payment-specific key in [database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:3359).
Classification: `PARTIAL`
Implementation risk: medium-high; partial payments get no receipt and retries can duplicate sends.

**4.1**
Spec: add project payment history UI/action with invoice/payment joins and billed/paid/outstanding totals.
Code: project detail only loads project, contacts, and entries in [projects/[id]/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/projects/[id]/page.tsx:86>) and renders a “Project Entries” table in [projects/[id]/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/projects/[id]/page.tsx:383>). There is no `getProjectPaymentHistory()`. Current totals are entry-status based in [projects/[id]/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/projects/[id]/page.tsx:110>) and do not handle `one_off`.
Classification: `MISSING`
Implementation risk: medium; no trustworthy project payment audit trail.

**4.2**
Spec: send internal billing-cron alerts for failures and suspicious zero-vendor runs, with dedicated env var fallback.
Code: the cron records per-vendor failures in `results` at [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:2062) and returns JSON at [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:3433), but never calls [reportCronFailure()](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/cron/alerting.ts:52) or `sendEmail()`. `.env.example` only exposes `CRON_ALERT_EMAIL` in [.env.example](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/.env.example:75), and [src/lib/env.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/env.ts:4) has no `OJ_PROJECTS_BILLING_ALERT_EMAIL`.
Classification: `MISSING`
Implementation risk: medium-high; failures can remain silent.

**4.3**
Spec: clearer statement-mode help text plus visible active-state indicator.
Code: the toggle already has brief description text in [clients/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:747>) and preview copy changes in [clients/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:794>) and [clients/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:1029>). I found no badge or separate active visual indicator.
Classification: `PARTIAL`
Implementation risk: low; mainly operator confusion.

**4.4**
Spec: dedicated void flow that reverts OJ-linked billing state, plus credit notes, statement integration, PDFs, and email support.
Code: `void` already exists as an invoice status in [src/types/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/invoices.ts:17), but the current flow is just generic status update in [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:410) and [src/services/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/invoices.ts:407). If an invoice is OJ-linked, the UI and action explicitly warn that force-voiding will not unbill linked items in [InvoiceDetailClient.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx:116>) and [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:469). I found no `voidInvoice()`, no `credit_notes` table/action, and the PDF template only supports `'invoice' | 'remittance_advice'` in [invoice-template-compact.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:8).
Classification: `DEVIATION`
Implementation risk: high; forced voids can strand OJ entries/instances, and credit-note support is absent.
