OpenAI Codex v0.107.0 (research preview)
--------
workdir: /Users/peterpitcher/Cursor/OJ-AnchorManagementTools
model: gpt-5.4
provider: openai
approval: never
sandbox: workspace-write [workdir, /tmp, $TMPDIR] (network access enabled)
reasoning effort: xhigh
reasoning summaries: none
session id: 019d8b1b-71ba-7740-896d-0879ebca1f07
--------
user
You are the Assumption Breaker. Read the spec at docs/superpowers/specs/2026-04-14-oj-projects-review-design.md then verify EACH claim against the real code.

CHECK THESE 10 CLAIMS:
1. 'client-balance.ts excludes one_off entries' — Read src/app/actions/oj-projects/client-balance.ts fully. What does it query?
2. 'one_off not in DB constraint' — Read supabase/migrations/20260120130000_oj_projects_core.sql, find chk_oj_entries_time_fields
3. 'Cap-mode splitting requires start_at/end_at' — Search src/app/api/cron/oj-projects-billing/route.ts for split logic
4. 'Receipt template supports outstanding balance' — Read src/lib/invoice-template-compact.ts, check remittance_advice rendering
5. 'sendRemittanceAdviceForPaidInvoice only fires on paid' — Read src/app/actions/invoices.ts, find the condition
6. 'OJRecurringChargeInstance type missing' — Read src/types/oj-projects.ts fully
7. 'deriveClientCode duplicated' — Search for all instances
8. 'No client statement page exists' — Search for statement routes/pages
9. 'statement_mode has UI toggle' — Read src/app/(authenticated)/oj-projects/clients/page.tsx
10. 'No credit_notes table exists' — Search migrations

For EACH: state claim, what code shows, verdict (CONFIRMED/PARTIALLY CORRECT/WRONG). Include file paths.
mcp: playwright starting
mcp: playwright ready
mcp startup: ready: playwright
codex
I’m verifying each of the 10 claims directly against the referenced files and route logic, then I’ll return a claim-by-claim verdict with concrete file paths and line references.
exec
/bin/zsh -lc "sed -n '1,260p' supabase/migrations/20260120130000_oj_projects_core.sql" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,320p' src/types/oj-projects.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,240p' src/app/actions/oj-projects/client-balance.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,320p' src/lib/invoice-template-compact.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,360p' src/app/actions/invoices.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,260p' 'src/app/(authenticated)/oj-projects/clients/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,280p' src/app/api/cron/oj-projects-billing/route.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc 'rg -n "chk_oj_entries_time_fields|one_off|statement_mode|deriveClientCode|statement|credit_notes|sendRemittanceAdviceForPaidInvoice|remittance_advice|split|start_at|end_at|OJRecurringChargeInstance" -S supabase/migrations src/app src/lib src/types' in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
export type OJBillingMode = 'full' | 'cap'
export type OJProjectStatus = 'active' | 'paused' | 'completed' | 'archived'
export type OJEntryType = 'time' | 'mileage' | 'one_off'
export type OJEntryStatus = 'unbilled' | 'billing_pending' | 'billed' | 'paid'

export type OJWorkType = {
  id: string
  name: string
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export type OJVendorBillingSettings = {
  vendor_id: string
  client_code: string | null
  billing_mode: OJBillingMode
  monthly_cap_inc_vat: number | null
  hourly_rate_ex_vat: number
 succeeded in 51ms:
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
 succeeded in 51ms:
import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculateInvoiceTotals, type InvoiceTotalsResult } from '@/lib/invoiceCalculations'
import { isGraphConfigured, sendInvoiceEmail } from '@/lib/microsoft-graph'
import { resolveVendorInvoiceRecipients } from '@/lib/invoice-recipients'
import { generateOjTimesheetPDF } from '@/lib/oj-timesheet'
import { formatInTimeZone } from 'date-fns-tz'
import type { InvoiceWithDetails } from '@/types/invoices'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim
} from '@/lib/api/idempotency'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

 succeeded in 51ms:
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

 succeeded in 51ms:
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
 succeeded in 52ms:
src/types/parking.ts:38:  start_at: string; // ISO string
src/types/parking.ts:39:  end_at: string;   // ISO string
src/types/parking.ts:53:  start_at: string;
src/types/parking.ts:54:  end_at: string;
src/types/parking.ts:86:  start_at: string;
src/types/parking.ts:87:  end_at: string;
src/types/oj-projects.ts:3:export type OJEntryType = 'time' | 'mileage' | 'one_off'
src/types/oj-projects.ts:24:  statement_mode: boolean | null
src/types/oj-projects.ts:71:  start_at: string | null
src/types/oj-projects.ts:72:  end_at: string | null
src/lib/cleanup-phone-numbers-script-safety.ts:55:    return parseOptionalPositiveInt(eq.split('=')[1])
src/lib/invoice-recipients.ts:16:      .split(/[;,]/)
src/lib/invoice-recipients.ts:22:export function splitToAndCc(recipients: string[], preferredTo?: string | null): { to: string | null; cc: string[] } {
src/lib/invoice-recipients.ts:84:  return splitToAndCc(recipients, primaryEmail)
src/types/database.generated.ts:5922:          end_at: string | null
src/types/database.generated.ts:5933:          start_at: string | null
src/types/database.generated.ts:5950:          end_at?: string | null
src/types/database.generated.ts:5961:          start_at?: string | null
src/types/database.generated.ts:5978:          end_at?: string | null
src/types/database.generated.ts:5989:          start_at?: string | null
codex
I’ve pulled the primary files. Next I’m anchoring each verdict with exact line references and checking the spec wording plus route/page existence searches.
exec
/bin/zsh -lc "nl -ba docs/superpowers/specs/2026-04-14-oj-projects-review-design.md | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/oj-projects/client-balance.ts | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql | sed -n '1,120p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba supabase/migrations/20260120130000_oj_projects_core.sql | sed -n '110,170p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/lib/invoice-template-compact.ts | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '630,930p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/invoices.ts | sed -n '95,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '1390,1495p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/types/oj-projects.ts | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/oj-projects/clients/page.tsx' | sed -n '700,820p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"credit_notes|credit note|CREATE TABLE IF NOT EXISTS public\\.credit_notes|CREATE TABLE public\\.credit_notes\" -S supabase/migrations" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"statement\" -S 'src/app/(authenticated)/oj-projects' src/app/actions/oj-projects src/app/api/cron/oj-projects-billing src/lib | sed -n '1,240p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc 'rg -n "deriveClientCode" -S src supabase docs' in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 50ms:
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
exec
/bin/zsh -lc "find src/app -path '*statement*' -o -path '*statements*' | sed -n '1,200p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 50ms:
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
 succeeded in 51ms:
    95	  ]
    96	
    97	  const seen = new Set<string>()
    98	  const toLower = to ? to.toLowerCase() : null
    99	  const cc = ccRaw
   100	    .map((email) => email.trim())
   101	    .filter((email) => email && email.includes('@') && email.toLowerCase() !== toLower)
   102	    .filter((email) => {
   103	      const key = email.toLowerCase()
   104	      if (seen.has(key)) return false
   105	      seen.add(key)
   106	      return true
   107	    })
   108	
   109	  return { to, cc }
   110	}
   111	
   112	async function sendRemittanceAdviceForPaidInvoice(
   113	  invoiceId: string,
   114	  sentByUserId?: string | null
 succeeded in 50ms:
  1390	        project_name
  1391	      ),
  1392	      work_type:oj_work_types(
  1393	        id,
  1394	        name
  1395	      )
  1396	    `
  1397	    )
  1398	    .eq('vendor_id', vendorId)
  1399	    .eq('status', 'unbilled')
  1400	    .eq('billable', true)
  1401	    .lte('entry_date', period.period_end)
  1402	    .order('entry_date', { ascending: true })
  1403	    .order('created_at', { ascending: true })
  1404	    .limit(10000)
  1405	  if (entriesError) throw new Error(entriesError.message)
  1406	
  1407	  const oneOffEntries = (eligibleEntries || []).filter((e: any) => e.entry_type === 'one_off')
  1408	  const mileageEntries = (eligibleEntries || []).filter((e: any) => e.entry_type === 'mileage')
  1409	  const timeEntries = (eligibleEntries || []).filter((e: any) => e.entry_type === 'time')
 succeeded in 50ms:
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
 exited 1 in 52ms:

 succeeded in 50ms:
src/app/api/cron/oj-projects-billing/route.ts:979:async function computeStatementBalanceBefore(input: {
src/app/api/cron/oj-projects-billing/route.ts:1045:function applyStatementCapTopUp(input: {
src/app/api/cron/oj-projects-billing/route.ts:1117:function buildStatementLineItems(input: {
src/app/api/cron/oj-projects-billing/route.ts:1317:  const statementMode = !!settings?.statement_mode
src/app/api/cron/oj-projects-billing/route.ts:1477:  let statementBalanceBefore: number | null = null
src/app/api/cron/oj-projects-billing/route.ts:1478:  if (statementMode && billingMode === 'cap' && capIncVat != null && capIncVat > 0) {
src/app/api/cron/oj-projects-billing/route.ts:1479:    const summary = await computeStatementBalanceBefore({
src/app/api/cron/oj-projects-billing/route.ts:1492:    statementBalanceBefore = summary.balanceBefore
src/app/api/cron/oj-projects-billing/route.ts:1525:      statement_mode: statementMode,
src/app/api/cron/oj-projects-billing/route.ts:1533:  let lineItems = statementMode
src/app/api/cron/oj-projects-billing/route.ts:1534:    ? buildStatementLineItems({
src/app/api/cron/oj-projects-billing/route.ts:1555:      statement_mode: statementMode,
src/app/api/cron/oj-projects-billing/route.ts:1562:  if (statementMode && billingMode === 'cap' && capIncVat != null && capIncVat > 0 && statementBalanceBefore != null) {
src/app/api/cron/oj-projects-billing/route.ts:1563:    const targetIncVat = roundMoney(Math.min(statementBalanceBefore, capIncVat))
src/app/api/cron/oj-projects-billing/route.ts:1564:    const adjusted = applyStatementCapTopUp({
src/app/api/cron/oj-projects-billing/route.ts:1578:  if (statementMode) {
src/app/api/cron/oj-projects-billing/route.ts:1579:    notes = await buildStatementNotes({
src/app/api/cron/oj-projects-billing/route.ts:1634:    statement_mode: statementMode,
src/app/api/cron/oj-projects-billing/route.ts:1662:async function buildStatementNotes(input: {
src/app/api/cron/oj-projects-billing/route.ts:2644:      const statementMode = !!settings?.statement_mode
 succeeded in 52ms:
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:76:### 1.5 — Duplicated deriveClientCode
docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:78:**Problem:** `deriveClientCode()` is duplicated identically in `src/app/actions/oj-projects/projects.ts` and `src/app/api/cron/oj-projects-retainer-projects/route.ts`.
src/app/api/cron/oj-projects-retainer-projects/route.ts:12:function deriveClientCode(vendorName: string) {
src/app/api/cron/oj-projects-retainer-projects/route.ts:61:    clientCode = deriveClientCode(String(vendor?.name || 'CLIENT'))
src/app/actions/oj-projects/projects.ts:27:function deriveClientCode(vendorName: string) {
src/app/actions/oj-projects/projects.ts:74:    clientCode = deriveClientCode(String(vendor?.name || 'CLIENT'))
 succeeded in 52ms:

codex
I have the main evidence. I’m filling the remaining gaps for statement-page existence, duplicate function bodies, and whether any `credit_notes` table appears anywhere in migrations.
exec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '926,980p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-retainer-projects/route.ts | sed -n '1,90p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/oj-projects/projects.ts | sed -n '1,110p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"recordPayment\\(|sendRemittanceAdviceForPaidInvoice\\(|status changed to|partially_paid|invoice_not_paid\" -S src/app/actions/invoices.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n --files src/app src/lib src/app/actions | rg '/?statement|statement\\.(ts|tsx)"'$|oj-statement|client-statement'"'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
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
   940	  if (input.billingMode !== 'cap') return { addedIncVat: 0 }
   941	  const capPounds = input.capIncVat != null ? roundMoney(Number(input.capIncVat) || 0) : null
   942	  if (!capPounds || capPounds <= 0) return { addedIncVat: 0 }
   943	
   944	  const headroom = roundMoney(capPounds - Number(input.runningIncVat || 0))
   945	  if (headroom <= 0.01) return { addedIncVat: 0 }
exec
/bin/zsh -lc "rg -n \"credit_note|credit_notes\" -S supabase/migrations | sed -n '1,240p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 50ms:
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
/bin/zsh -lc "rg -n \"client-statement|oj-statement|getClientStatement|ACCOUNT STATEMENT|Statement\" -S src/app src/lib src/app/actions | sed -n '1,240p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
112:async function sendRemittanceAdviceForPaidInvoice(
130:    return { sent: false, skippedReason: 'invoice_not_paid' }
428:      'draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void', 'written_off'
436:    if (newStatus === 'paid' || newStatus === 'partially_paid') {
670:export async function recordPayment(formData: FormData) {
710:      InvoiceService.recordPayment({
747:      remittanceAdvice = await sendRemittanceAdviceForPaidInvoice(invoiceId, user?.id || null)
 exited 1 in 51ms:

 succeeded in 51ms:
supabase/migrations/20251123120000_squashed.sql:12050:    CONSTRAINT invoice_emails_email_type_check CHECK (((email_type)::text = ANY ((ARRAY['new_invoice'::character varying, 'reminder'::character varying, 'chase'::character varying, 'credit_note'::character varying, 'statement'::character varying, 'quote'::character varying])::text[]))),
 succeeded in 51ms:
src/app/(authenticated)/oj-projects/clients/page.tsx:747:                <FormGroup label="Statement Mode">
src/app/(authenticated)/oj-projects/clients/page.tsx:794:                  {settings.statement_mode ? 'Preview Statement Invoice' : 'Preview Invoice (Dry Run)'}
src/app/(authenticated)/oj-projects/clients/page.tsx:1029:        title={previewVendor?.statement_mode ? 'Statement Invoice Preview (Dry Run)' : 'Invoice Preview (Dry Run)'}
src/app/actions/receipts.ts:52:  performImportReceiptStatement,
src/app/actions/receipts.ts:230:export async function importReceiptStatement(formData: FormData) {
src/app/actions/receipts.ts:246:  const result = await performImportReceiptStatement(user_id, user_email, receiptFile, buffer)
src/app/actions/receipts.ts:52:  performImportReceiptStatement,
src/app/actions/receipts.ts:230:export async function importReceiptStatement(formData: FormData) {
src/app/actions/receipts.ts:246:  const result = await performImportReceiptStatement(user_id, user_email, receiptFile, buffer)
src/app/api/cron/oj-projects-billing/route.ts:979:async function computeStatementBalanceBefore(input: {
src/app/api/cron/oj-projects-billing/route.ts:1045:function applyStatementCapTopUp(input: {
src/app/api/cron/oj-projects-billing/route.ts:1117:function buildStatementLineItems(input: {
src/app/api/cron/oj-projects-billing/route.ts:1479:    const summary = await computeStatementBalanceBefore({
src/app/api/cron/oj-projects-billing/route.ts:1534:    ? buildStatementLineItems({
src/app/api/cron/oj-projects-billing/route.ts:1564:    const adjusted = applyStatementCapTopUp({
src/app/api/cron/oj-projects-billing/route.ts:1579:    notes = await buildStatementNotes({
src/app/api/cron/oj-projects-billing/route.ts:1662:async function buildStatementNotes(input: {
src/app/api/cron/oj-projects-billing/route.ts:2804:        const summary = await computeStatementBalanceBefore({
src/app/api/cron/oj-projects-billing/route.ts:2919:          ...buildStatementLineItems({
src/app/api/cron/oj-projects-billing/route.ts:2947:        const adjusted = applyStatementCapTopUp({
codex
One claim is a little subtler than expected: `recordPayment()` already triggers on `partially_paid`, but the helper it calls still refuses anything except `paid`. I’m pulling that exact path so the verdict is precise.
exec
/bin/zsh -lc "nl -ba src/app/actions/invoices.ts | sed -n '420,455p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"oj_recurring_charge_instances\" -S src/types/database.generated.ts | sed -n '1,80p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/lib/invoice-template-compact.ts | sed -n '260,420p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/invoices.ts | sed -n '670,760p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"CREATE TABLE .*oj_recurring_charge_instances|oj_recurring_charge_instances \\(\" -S supabase/migrations src/types/database.generated.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
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
6130:      oj_recurring_charge_instances: {
6190:            foreignKeyName: "oj_recurring_charge_instances_billing_run_id_fkey"
6197:            foreignKeyName: "oj_recurring_charge_instances_invoice_id_fkey"
6204:            foreignKeyName: "oj_recurring_charge_instances_recurring_charge_id_fkey"
6211:            foreignKeyName: "oj_recurring_charge_instances_vendor_id_fkey"
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
 succeeded in 52ms:
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
 succeeded in 52ms:
supabase/migrations/20260121100000_oj_recurring_charge_instances.sql:4:CREATE TABLE IF NOT EXISTS public.oj_recurring_charge_instances (
exec
/bin/zsh -lc "nl -ba src/lib/invoice-template-compact.ts | sed -n '420,620p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
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
exec
/bin/zsh -lc "rg -n --files src/app/actions/oj-projects src/lib 'src/app/(authenticated)/oj-projects' | sed -n '1,240p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
src/app/actions/oj-projects/work-types.ts
src/app/actions/oj-projects/system.ts
src/app/actions/oj-projects/vendor-settings.ts
src/app/(authenticated)/oj-projects/page.tsx
src/app/actions/oj-projects/__tests__/entries.test.ts
src/app/actions/oj-projects/client-balance.ts
src/app/actions/oj-projects/project-contacts.ts
src/app/actions/oj-projects/projects.ts
src/app/actions/oj-projects/recurring-charges.ts
src/app/actions/oj-projects/entries.ts
src/app/(authenticated)/oj-projects/projects/page.tsx
src/app/(authenticated)/oj-projects/projects/[id]/page.tsx
src/app/(authenticated)/oj-projects/clients/page.tsx
src/app/(authenticated)/oj-projects/entries/page.tsx
src/app/(authenticated)/oj-projects/work-types/page.tsx
src/lib/test-sms-new-customer-safety.ts
src/lib/contract-template.ts
src/lib/cleanup-phone-numbers-script-safety.ts
src/lib/oj-timesheet.ts
src/lib/complete-past-event-checklists-script-safety.ts
exec
/bin/zsh -lc "rg -n \"oj_entries_one_off|entry_type = 'one_off'|amount_ex_vat_snapshot\" -S supabase/migrations | sed -n '1,240p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
supabase/migrations/20260121100000_oj_recurring_charge_instances.sql:12:  amount_ex_vat_snapshot numeric(12,2) NOT NULL,
supabase/migrations/20260226120000_oj_entries_one_off.sql:2:-- Adds amount_ex_vat_snapshot column and updates CHECK constraints
supabase/migrations/20260226120000_oj_entries_one_off.sql:6:  ADD COLUMN IF NOT EXISTS amount_ex_vat_snapshot NUMERIC(10,2) DEFAULT NULL;
supabase/migrations/20260226120000_oj_entries_one_off.sql:28:    (entry_type = 'one_off' AND amount_ex_vat_snapshot IS NOT NULL AND miles IS NULL AND start_at IS NULL AND end_at IS NULL AND duration_minutes_rounded IS NULL)
supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql:7:-- the constraint set in 20260226120000_oj_entries_one_off.sql.
supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql:29:      entry_type = 'one_off'
supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql:30:      AND amount_ex_vat_snapshot IS NOT NULL
exec
/bin/zsh -lc "nl -ba supabase/migrations/20260226120000_oj_entries_one_off.sql | sed -n '1,80p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
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
exec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/oj-projects/clients/page.tsx' | sed -n '1018,1035p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
  1018	                </form>
  1019	              </div>
  1020	            </Card>
  1021	          </div>
  1022	        </div>
  1023	        </>
  1024	      )}
  1025	
  1026	      <Modal
  1027	        open={previewOpen}
  1028	        onClose={() => setPreviewOpen(false)}
  1029	        title={previewVendor?.statement_mode ? 'Statement Invoice Preview (Dry Run)' : 'Invoice Preview (Dry Run)'}
  1030	        size="lg"
  1031	      >
  1032	        <div className="space-y-4 text-sm">
  1033	          <Alert variant="info">
  1034	            This is a dry run preview. No invoice is created or sent.
  1035	          </Alert>
exec
/bin/zsh -lc "rg -n \"credit_notes|credit_note\" -S src/types src/app src/lib supabase/migrations | sed -n '1,240p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
supabase/migrations/20251123120000_squashed.sql:12050:    CONSTRAINT invoice_emails_email_type_check CHECK (((email_type)::text = ANY ((ARRAY['new_invoice'::character varying, 'reminder'::character varying, 'chase'::character varying, 'credit_note'::character varying, 'statement'::character varying, 'quote'::character varying])::text[]))),
exec
/bin/zsh -lc "nl -ba src/types/database.generated.ts | sed -n '6130,6188p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
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
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/oj-projects/clients/page.tsx' | sed -n '48,65p;112,132p;266,315p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
    48	  Users
    49	} from 'lucide-react'
    50	
    51	type SettingsFormState = {
    52	  vendor_id: string
    53	  client_code: string
    54	  billing_mode: 'full' | 'cap'
    55	  monthly_cap_inc_vat: string
    56	  hourly_rate_ex_vat: string
    57	  vat_rate: string
    58	  mileage_rate: string
    59	  retainer_included_hours_per_month: string
    60	  statement_mode: boolean
    61	}
    62	
    63	type ChargeFormState = {
    64	  id?: string
    65	  description: string
   112	    billing_mode: 'full',
   113	    monthly_cap_inc_vat: '',
exec
/bin/zsh -lc "rg --files src/app | rg 'statement'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools exited 1 in 51ms:

exec
/bin/zsh -lc "rg -n \"sendRemittanceAdviceForPaidInvoice\\(\" -S src" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
src/app/actions/invoices.ts:112:async function sendRemittanceAdviceForPaidInvoice(
src/app/actions/invoices.ts:747:      remittanceAdvice = await sendRemittanceAdviceForPaidInvoice(invoiceId, user?.id || null)
exec
/bin/zsh -lc "rg -n \"credit_notes|credit_note\" -S src/types/database.generated.ts | sed -n '1,120p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:

codex
Checked [the spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:1) against the current repo.

1. Claim: `client-balance.ts excludes one_off entries`
Code: [client-balance.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/client-balance.ts:64) queries `oj_entries` by `vendor_id`, `status = 'unbilled'`, and `billable = true` with no `entry_type` filter. But the aggregation loop at [lines 77-86](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/client-balance.ts:77) only sums `time` and `mileage`, so `one_off` rows are ignored in `unbilledTotal`. The file also queries [invoices](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/client-balance.ts:41) and [oj_recurring_charge_instances](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/client-balance.ts:90).
Verdict: PARTIALLY CORRECT.

2. Claim: `one_off not in DB constraint`
Code: In the core migration, [20260120130000_oj_projects_core.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260120130000_oj_projects_core.sql:115), `entry_type` only allows `time` and `mileage`, and `chk_oj_entries_time_fields` at [lines 147-152](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260120130000_oj_projects_core.sql:147) has only those two branches. But later migrations add `one_off`: [20260226120000_oj_entries_one_off.sql:12](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260226120000_oj_entries_one_off.sql:12) and [20260512000000_oj_entries_relax_time_constraint.sql:13](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql:13).
Verdict: PARTIALLY CORRECT.

3. Claim: `Cap-mode splitting requires start_at/end_at`
Code: `applyPartialSplit()` in [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:926) tries recurring, then mileage, then time. `splitTimeEntryForCap()` at [lines 844-846](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:844) returns `null` if `start_at`/`end_at` are missing or invalid. But [splitRecurringInstanceForCap()](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:640) and [splitMileageEntryForCap()](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:738) do not require timestamps.
Verdict: PARTIALLY CORRECT.

4. Claim: `Receipt template supports outstanding balance`
Code: [invoice-template-compact.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:149) computes `outstandingBalance`, then renders it for `remittance_advice` in the summary at [lines 552-564](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:552) and again in “Receipt Details” at [lines 574-584](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:574).
Verdict: CONFIRMED.

5. Claim: `sendRemittanceAdviceForPaidInvoice only fires on paid`
Code: The helper itself exits unless `invoice.status === 'paid'` at [invoices.ts:129](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:129). Its only call site is `recordPayment()`, which calls it only when status changes to `paid` at [lines 743-748](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:743).
Verdict: CONFIRMED.

6. Claim: `OJRecurringChargeInstance type missing`
Code: [src/types/oj-projects.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/oj-projects.ts:1) defines `OJWorkType`, `OJVendorBillingSettings`, `OJVendorRecurringCharge`, `OJProject`, `OJProjectContact`, `OJEntry`, and `OJBillingRun`, but no `OJRecurringChargeInstance`. The billing cron still uses `any[]` for recurring instances at [route.ts:644-645](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:644). There is generated schema info for the table in [database.generated.ts:6130](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:6130), but no exported domain type in `src/types/oj-projects.ts`.
Verdict: CONFIRMED.

7. Claim: `deriveClientCode duplicated`
Code: The same function body appears in [projects.ts:27](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/projects.ts:27) and [oj-projects-retainer-projects/route.ts:12](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-retainer-projects/route.ts:12).
Verdict: CONFIRMED.

8. Claim: `No client statement page exists`
Code: There is no `src/app/actions/oj-projects/client-statement.ts`, no `src/lib/oj-statement.ts`, and no `statement` page file under `src/app`. The only statement-related UI I found is inside [clients/page.tsx:747](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:747) and statement-mode billing code in [oj-projects-billing/route.ts:979](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:979).
Verdict: CONFIRMED.

9. Claim: `statement_mode has UI toggle`
Code: The clients page defines `statement_mode` in state at [lines 51-60](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:51), loads it from settings at [line 273](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:273), submits it at [line 312](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:312), and renders a checkbox toggle at [lines 747-754](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:747).
Verdict: CONFIRMED.

10. Claim: `No credit_notes table exists`
Code: Searching `supabase/migrations` finds no `credit_notes` table creation. The only repo hit is `credit_note` as an allowed `invoice_email_logs.email_type` value in [20251123120000_squashed.sql:12050](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:12050). There is also no `credit_notes` type entry in generated DB types.
Verdict: CONFIRMED.
tokens used
402,736
Checked [the spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:1) against the current repo.

1. Claim: `client-balance.ts excludes one_off entries`
Code: [client-balance.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/client-balance.ts:64) queries `oj_entries` by `vendor_id`, `status = 'unbilled'`, and `billable = true` with no `entry_type` filter. But the aggregation loop at [lines 77-86](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/client-balance.ts:77) only sums `time` and `mileage`, so `one_off` rows are ignored in `unbilledTotal`. The file also queries [invoices](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/client-balance.ts:41) and [oj_recurring_charge_instances](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/client-balance.ts:90).
Verdict: PARTIALLY CORRECT.

2. Claim: `one_off not in DB constraint`
Code: In the core migration, [20260120130000_oj_projects_core.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260120130000_oj_projects_core.sql:115), `entry_type` only allows `time` and `mileage`, and `chk_oj_entries_time_fields` at [lines 147-152](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260120130000_oj_projects_core.sql:147) has only those two branches. But later migrations add `one_off`: [20260226120000_oj_entries_one_off.sql:12](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260226120000_oj_entries_one_off.sql:12) and [20260512000000_oj_entries_relax_time_constraint.sql:13](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql:13).
Verdict: PARTIALLY CORRECT.

3. Claim: `Cap-mode splitting requires start_at/end_at`
Code: `applyPartialSplit()` in [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:926) tries recurring, then mileage, then time. `splitTimeEntryForCap()` at [lines 844-846](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:844) returns `null` if `start_at`/`end_at` are missing or invalid. But [splitRecurringInstanceForCap()](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:640) and [splitMileageEntryForCap()](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:738) do not require timestamps.
Verdict: PARTIALLY CORRECT.

4. Claim: `Receipt template supports outstanding balance`
Code: [invoice-template-compact.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:149) computes `outstandingBalance`, then renders it for `remittance_advice` in the summary at [lines 552-564](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:552) and again in “Receipt Details” at [lines 574-584](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:574).
Verdict: CONFIRMED.

5. Claim: `sendRemittanceAdviceForPaidInvoice only fires on paid`
Code: The helper itself exits unless `invoice.status === 'paid'` at [invoices.ts:129](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:129). Its only call site is `recordPayment()`, which calls it only when status changes to `paid` at [lines 743-748](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:743).
Verdict: CONFIRMED.

6. Claim: `OJRecurringChargeInstance type missing`
Code: [src/types/oj-projects.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/oj-projects.ts:1) defines `OJWorkType`, `OJVendorBillingSettings`, `OJVendorRecurringCharge`, `OJProject`, `OJProjectContact`, `OJEntry`, and `OJBillingRun`, but no `OJRecurringChargeInstance`. The billing cron still uses `any[]` for recurring instances at [route.ts:644-645](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:644). There is generated schema info for the table in [database.generated.ts:6130](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:6130), but no exported domain type in `src/types/oj-projects.ts`.
Verdict: CONFIRMED.

7. Claim: `deriveClientCode duplicated`
Code: The same function body appears in [projects.ts:27](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/projects.ts:27) and [oj-projects-retainer-projects/route.ts:12](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-retainer-projects/route.ts:12).
Verdict: CONFIRMED.

8. Claim: `No client statement page exists`
Code: There is no `src/app/actions/oj-projects/client-statement.ts`, no `src/lib/oj-statement.ts`, and no `statement` page file under `src/app`. The only statement-related UI I found is inside [clients/page.tsx:747](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:747) and statement-mode billing code in [oj-projects-billing/route.ts:979](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:979).
Verdict: CONFIRMED.

9. Claim: `statement_mode has UI toggle`
Code: The clients page defines `statement_mode` in state at [lines 51-60](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:51), loads it from settings at [line 273](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:273), submits it at [line 312](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:312), and renders a checkbox toggle at [lines 747-754](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:747).
Verdict: CONFIRMED.

10. Claim: `No credit_notes table exists`
Code: Searching `supabase/migrations` finds no `credit_notes` table creation. The only repo hit is `credit_note` as an allowed `invoice_email_logs.email_type` value in [20251123120000_squashed.sql:12050](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:12050). There is also no `credit_notes` type entry in generated DB types.
Verdict: CONFIRMED.
