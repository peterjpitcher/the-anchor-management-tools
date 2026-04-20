OpenAI Codex v0.107.0 (research preview)
--------
workdir: /Users/peterpitcher/Cursor/OJ-AnchorManagementTools
model: gpt-5.4
provider: openai
approval: never
sandbox: workspace-write [workdir, /tmp, $TMPDIR] (network access enabled)
reasoning effort: xhigh
reasoning summaries: none
session id: 019d8b1b-500c-7841-a40a-d051406e9733
--------
user
You are the Repo Reality Mapper. Inspect the REAL codebase for OJ Projects and map what exists.

READ THESE FILES and report what you find:
1. All files in src/app/(authenticated)/oj-projects/ 
2. All server actions in src/app/actions/oj-projects/
3. src/app/api/cron/oj-projects-billing/route.ts (first 200 lines + search for key functions)
4. src/types/oj-projects.ts
5. src/app/actions/invoices.ts (find recordPayment, sendRemittanceAdviceForPaidInvoice)
6. src/lib/invoice-template-compact.ts (find remittance_advice handling)
7. src/app/actions/oj-projects/client-balance.ts
8. src/types/invoices.ts
9. supabase/migrations/ files matching oj_*

Also read: docs/superpowers/specs/2026-04-14-oj-projects-review-design.md

For each area report: what exists, key patterns, data flow, constraints encoded, and risks. Structured markdown, under 400 lines.
mcp: playwright starting
mcp: playwright ready
mcp startup: ready: playwright
codex
Inspecting the requested OJ Projects surfaces first so I can map the real shape of the code before summarizing patterns and risks. I’m starting with file inventory for the authenticated routes, actions, types, migrations, and the design spec, then I’ll trace the billing and remittance flow end to end.
exec
/bin/zsh -lc "rg --files 'src/app/(authenticated)/oj-projects'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "wc -l 'src/app/api/cron/oj-projects-billing/route.ts' 'src/types/oj-projects.ts' 'src/app/actions/invoices.ts' 'src/lib/invoice-template-compact.ts' 'src/app/actions/oj-projects/client-balance.ts' 'src/types/invoices.ts' 'docs/superpowers/specs/2026-04-14-oj-projects-review-design.md'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg --files 'src/app/actions/oj-projects'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg --files 'supabase/migrations' | rg '("'^|/)oj_'"'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
src/app/(authenticated)/oj-projects/page.tsx
src/app/(authenticated)/oj-projects/projects/page.tsx
src/app/(authenticated)/oj-projects/projects/[id]/page.tsx
src/app/(authenticated)/oj-projects/entries/page.tsx
src/app/(authenticated)/oj-projects/clients/page.tsx
src/app/(authenticated)/oj-projects/work-types/page.tsx
 succeeded in 51ms:
    3434 src/app/api/cron/oj-projects-billing/route.ts
     111 src/types/oj-projects.ts
     855 src/app/actions/invoices.ts
     634 src/lib/invoice-template-compact.ts
     131 src/app/actions/oj-projects/client-balance.ts
     185 src/types/invoices.ts
     279 docs/superpowers/specs/2026-04-14-oj-projects-review-design.md
    5629 total
 succeeded in 51ms:
src/app/actions/oj-projects/work-types.ts
src/app/actions/oj-projects/system.ts
src/app/actions/oj-projects/vendor-settings.ts
src/app/actions/oj-projects/__tests__/entries.test.ts
src/app/actions/oj-projects/client-balance.ts
src/app/actions/oj-projects/project-contacts.ts
src/app/actions/oj-projects/projects.ts
src/app/actions/oj-projects/recurring-charges.ts
src/app/actions/oj-projects/entries.ts
 exited 1 in 51ms:

codex
I have the main surface area. Next I’m reading the route pages, OJ project actions, types, and the review spec in parallel, then I’ll trace the billing cron and invoice/remittance functions against the migration history.
Plan update
Mapping the existing OJ Projects implementation across UI routes, server actions, billing/remittance flow, types, migrations, and the current review design spec.
  ✓ Inventory requested files and migrations
  → Read authenticated OJ Projects pages, OJ project actions, and shared types/spec
  • Trace billing cron, invoice/remittance functions, and client balance flow
  • Summarize what exists, patterns, constraints, data flow, and risks by area
exec
/bin/zsh -lc "sed -n '1,220p' 'src/app/(authenticated)/oj-projects/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,260p' 'src/app/(authenticated)/oj-projects/projects/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,260p' 'src/app/(authenticated)/oj-projects/entries/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,260p' 'src/app/(authenticated)/oj-projects/clients/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,260p' 'src/app/(authenticated)/oj-projects/projects/[id]/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,260p' 'src/app/(authenticated)/oj-projects/work-types/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,220p' 'src/types/oj-projects.ts' && printf '\\n---SPEC---\\n' && sed -n '1,260p' 'docs/superpowers/specs/2026-04-14-oj-projects-review-design.md'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
import { formatDateDdMmmmYyyy, getTodayIsoDate } from '@/lib/dateUtils'
import { usePermissions } from '@/contexts/PermissionContext'
import { getVendors } from '@/app/actions/vendors'
import { getProjects } from '@/app/actions/oj-projects/projects'
import { getRecurringCharges } from '@/app/actions/oj-projects/recurring-charges'
import { getVendorBillingSettings } from '@/app/actions/oj-projects/vendor-settings'
 succeeded in 52ms:
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button, IconButton } from '@/components/ui-v2/forms/Button'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
import { usePermissions } from '@/contexts/PermissionContext'
import { getVendors } from '@/app/actions/vendors'
import { createProject, deleteProject, getProjects, updateProject, updateProjectStatus } from '@/app/actions/oj-projects/projects'
import type { InvoiceVendor } from '@/types/invoices'
import {
  Archive,
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
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card, CardTitle } from '@/components/ui-v2/layout/Card'
import { Button, IconButton } from '@/components/ui-v2/forms/Button'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Input } from '@/components/ui-v2/forms/Input'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { usePermissions } from '@/contexts/PermissionContext'
import { createWorkType, disableWorkType, getWorkTypes, updateWorkType } from '@/app/actions/oj-projects/work-types'
import {
  Briefcase,
  Check,
  LayoutDashboard,
  List,
  Plus,
 succeeded in 51ms:
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
import { usePermissions } from '@/contexts/PermissionContext'
import { getVendors } from '@/app/actions/vendors'
import { getProjects } from '@/app/actions/oj-projects/projects'
import { getWorkTypes } from '@/app/actions/oj-projects/work-types'
import { deleteEntry, getEntries, updateEntry } from '@/app/actions/oj-projects/entries'
import type { InvoiceVendor } from '@/types/invoices'
 succeeded in 51ms:
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card, CardTitle } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Select } from '@/components/ui-v2/forms/Select'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { usePermissions } from '@/contexts/PermissionContext'
import { deleteProject, getProject, updateProjectStatus } from '@/app/actions/oj-projects/projects'
import { addProjectContact, removeProjectContact } from '@/app/actions/oj-projects/project-contacts'
import { getVendorContacts } from '@/app/actions/vendor-contacts'
import { getEntries } from '@/app/actions/oj-projects/entries'
import { formatDateDdMmmmYyyy } from '@/lib/dateUtils'
import {
  ArrowLeft,
 succeeded in 51ms:
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
exec
/bin/zsh -lc "sed -n '221,520p' 'src/app/(authenticated)/oj-projects/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg --files 'supabase/migrations' | rg 'oj|OJ'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '261,520p' 'src/app/(authenticated)/oj-projects/projects/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '261,620p' 'src/app/(authenticated)/oj-projects/clients/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '261,520p' 'src/app/(authenticated)/oj-projects/projects/[id]/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '261,420p' 'src/app/(authenticated)/oj-projects/work-types/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '261,520p' 'src/app/(authenticated)/oj-projects/entries/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
      dataMap.set(key, (dataMap.get(key) || 0) + exVat)
    })

    const chartData: { key: string; label: string; value: number; color: string }[] = []
    const iter = new Date(cutoffDate)

    // Normalize start date based on granularity
    if (historyRange === 60) {
      const day = iter.getDay()
      const diff = iter.getDate() - day + (day === 0 ? -6 : 1)
      iter.setDate(diff)
    } else if (historyRange === 90) {
      iter.setDate(1) // Start of month
    }

    while (iter <= now) {
      const key = getSortKey(iter)
      const label = formatLabel(iter)

      // Check if we already added this key (for weekly/monthly iterations)
 succeeded in 51ms:
supabase/migrations/20260405130001_update_oj_mileage_rate.sql
supabase/migrations/20260226120000_oj_entries_one_off.sql
supabase/migrations/20260120132000_add_oj_projects_permissions.sql
supabase/migrations/20260120130000_oj_projects_core.sql
supabase/migrations/20260121100000_oj_recurring_charge_instances.sql
supabase/migrations/20260121120000_oj_retainer_projects.sql
supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql
supabase/migrations/20260121130000_project_stats_view.sql
supabase/migrations/20260405130002_oj_mileage_sync_trigger.sql
supabase/migrations/20260203090000_add_statement_mode_to_oj_vendor_billing_settings.sql
 succeeded in 51ms:
            <ul className="list-disc pl-4 space-y-1">
              <li>Work types help categorize billable time on invoices.</li>
              <li>Common types: Development, Design, Meeting, Support.</li>
              <li>Sort order determines the display order in dropdowns.</li>
            </ul>
          </div>
        </div>
      </div>
    </PageLayout>
  )
}
 succeeded in 52ms:
            Show Closed
          </label>
          <Button onClick={openCreate} disabled={!canCreate}>
            <Plus className="w-4 h-4 mr-2" />
            New Project
          </Button>
        </div>
      }
    >
      {error && <Alert variant="error" description={error} className="mb-6" />}

      {filteredProjects.length === 0 ? (
        <Card className="p-12 text-center text-gray-500 border-dashed border-2 bg-gray-50">
          <Briefcase className="w-12 h-12 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">No projects found</h3>
          <p className="mb-6">
            {projects.length > 0
              ? "No active projects. Toggle 'Show Closed' to view history."
              : "Get started by creating your first client project."}
          </p>
 succeeded in 52ms:

      const s = settingsRes.settings
      setSettings({
        vendor_id: id,
        client_code: s?.client_code || '',
        billing_mode: (s?.billing_mode as any) || 'full',
        monthly_cap_inc_vat: s?.monthly_cap_inc_vat != null ? String(s.monthly_cap_inc_vat) : '',
        hourly_rate_ex_vat: s?.hourly_rate_ex_vat != null ? String(s.hourly_rate_ex_vat) : '75',
        vat_rate: s?.vat_rate != null ? String(s.vat_rate) : '20',
        mileage_rate: s?.mileage_rate != null ? String(s.mileage_rate) : '0.45',
        retainer_included_hours_per_month:
          s?.retainer_included_hours_per_month != null ? String(s.retainer_included_hours_per_month) : '',
        statement_mode: !!s?.statement_mode,
      })

      setCharges(chargesRes.charges || [])
      setContacts((contactsRes.contacts as VendorContact[]) || [])
      setChargeForm({ description: '', amount_ex_vat: '', vat_rate: '20', is_active: true, sort_order: '0' })
      setContactForm({ name: '', email: '', phone: '', role: '', is_primary: false, receive_invoice_copy: false })

 succeeded in 52ms:
    { label: 'Dashboard', href: '/oj-projects', icon: <LayoutDashboard className="w-4 h-4" /> },
    { label: 'Projects', href: '/oj-projects/projects', icon: <Briefcase className="w-4 h-4" /> },
    { label: 'Entries', href: '/oj-projects/entries', icon: <List className="w-4 h-4" /> },
    { label: 'Clients', href: '/oj-projects/clients', icon: <Users className="w-4 h-4" /> },
    { label: 'Work Types', href: '/oj-projects/work-types', icon: <List className="w-4 h-4" /> },
  ]

  return (
    <PageLayout
      title={project.project_code}
      subtitle={project.project_name}
      navItems={navItems}
      backButton={{ label: 'Back to Projects', href: '/oj-projects/projects' }}
      headerActions={
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={!canEdit}
            onClick={() => router.push(`/oj-projects/projects?edit=${projectId}`)}
            title={!canEdit ? 'You do not have permission to edit projects' : undefined}
 succeeded in 51ms:
  ]

  const getStatusBadge = (status: string, billable: boolean) => {
    if (!billable) return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">Non-billable</span>

    switch (status) {
      case 'unbilled': return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">Unbilled</span>
      case 'billing_pending': return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">Pending</span>
      case 'billed': return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800">Billed</span>
      case 'paid': return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Paid</span>
      default: return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">{status}</span>
    }
  }

  return (
    <PageLayout
      title="Entries"
      subtitle="View and manage time and mileage logs"
      navItems={navItems}
    >
codex
The UI picture is clear enough to trace behaviour now: dashboard + CRUD pages + client settings/balance + preview scaffolding. I’m moving into the server actions and cron path, which is where most of the real constraints and failure modes are encoded.
exec
/bin/zsh -lc "sed -n '1,260p' 'src/app/actions/oj-projects/projects.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,260p' 'src/app/actions/oj-projects/entries.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,260p' 'src/app/actions/oj-projects/recurring-charges.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,220p' 'src/app/actions/oj-projects/project-contacts.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,260p' 'src/app/actions/oj-projects/work-types.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,260p' 'src/app/actions/oj-projects/vendor-settings.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,220p' 'src/app/actions/oj-projects/system.ts' && printf '\\n---CLIENT-BALANCE---\\n' && sed -n '1,220p' 'src/app/actions/oj-projects/client-balance.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
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

 succeeded in 51ms:
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
import { logAuditEvent } from '@/app/actions/audit'
import { z } from 'zod'

const WorkTypeSchema = z.object({
  name: z.string().min(1, 'Work type name is required').max(80, 'Work type name is too long'),
  sort_order: z.coerce.number().int().min(0).max(1000).optional(),
  is_active: z.coerce.boolean().optional(),
})

export async function getWorkTypes() {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) return { error: 'You do not have permission to view work types' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('oj_work_types')
 succeeded in 52ms:
'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { z } from 'zod'

const ProjectContactSchema = z.object({
  project_id: z.string().uuid('Invalid project ID'),
  contact_id: z.string().uuid('Invalid contact ID'),
})

export async function getProjectContacts(projectId: string) {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) return { error: 'You do not have permission to view project contacts' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('oj_project_contacts')
    .select(`
 succeeded in 52ms:
'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { z } from 'zod'

const RecurringChargeSchema = z.object({
  vendor_id: z.string().uuid('Invalid vendor ID'),
  description: z.string().min(1, 'Description is required').max(200),
  amount_ex_vat: z.coerce.number().min(0),
  vat_rate: z.coerce.number().min(0).max(100),
  is_active: z.coerce.boolean().optional(),
  sort_order: z.coerce.number().int().min(0).max(1000).optional(),
})

export async function getRecurringCharges(vendorId: string) {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) return { error: 'You do not have permission to view recurring charges' }

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
 succeeded in 50ms:
'use server'

import { checkUserPermission } from '@/app/actions/rbac'
import { isGraphConfigured } from '@/lib/microsoft-graph'

export async function getOjProjectsEmailStatus() {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) return { error: 'You do not have permission to view OJ Projects email status' }

  return {
    configured: isGraphConfigured(),
    senderEmail: process.env.MICROSOFT_USER_EMAIL || null,
  }
}


---CLIENT-BALANCE---
'use server'

import { createClient } from '@/lib/supabase/server'
exec
/bin/zsh -lc "sed -n '261,520p' 'src/app/actions/oj-projects/projects.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '261,620p' 'src/app/actions/oj-projects/entries.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,260p' 'src/app/actions/oj-projects/__tests__/entries.test.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
  })

  return { project: data, success: true as const }
}

export async function deleteProject(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'delete')
  if (!hasPermission) return { error: 'You do not have permission to delete projects' }

  const projectId = String(formData.get('id') || '')
  if (!projectId) return { error: 'Project ID is required' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { count, error: countError } = await supabase
    .from('oj_entries')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)

 succeeded in 51ms:
      duration_minutes_rounded: null,
      miles: parsed.data.miles,
      work_type_id: null,
      work_type_name_snapshot: null,
      description: parsed.data.description || null,
      internal_notes: parsed.data.internal_notes || null,
      billable: parsed.data.billable ?? true,
      status: 'unbilled',
      hourly_rate_ex_vat_snapshot: null,
      vat_rate_snapshot: 0,
      mileage_rate_snapshot: settings.mileage_rate,
    })
    .select('*')
    .single()

  if (error) return { error: error.message }

  await logAuditEvent({
    user_id: user?.id,
    user_email: user?.email,
 succeeded in 52ms:
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))
vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

import { createTimeEntry, updateEntry } from '../entries'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'

const mockCheckUserPermission = vi.mocked(checkUserPermission)
const mockCreateClient = vi.mocked(createClient)
const mockLogAuditEvent = vi.mocked(logAuditEvent)
exec
/bin/zsh -lc "sed -n '1,220p' 'src/app/api/cron/oj-projects-billing/route.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc 'rg -n "''^(async function|function|const [A-Za-z0-9_]+ = async|export async function|type |interface )" '"'src/app/api/cron/oj-projects-billing/route.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"split|statement_mode|billing_mode|create.*invoice|send.*email|remittance|recurring_charge_instances|billing_run|carry|preview|partial|warning|alert|cap\" 'src/app/api/cron/oj-projects-billing/route.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
25:function roundMoney(value: number) {
29:function toIsoDateUtc(date: Date) {
33:function moneyIncVat(exVat: number, vatRate: number) {
40:function formatCurrency(amount: number) {
44:function parseIsoDateUtc(dateIso: string) {
49:function addMonthsUtc(date: Date, months: number) {
55:function addMinutes(date: Date, minutes: number) {
59:function formatMonthLabel(date: Date) {
63:function getProjectLabel(project: any) {
71:function formatPeriodLabel(periodYyyymm: string | null | undefined) {
77:function toLondonTimeHm(iso: string | null) {
91:function addDaysIsoDate(dateIso: string, days: number) {
98:async function updateBillingRunById(
119:async function throwOnMutationError(
129:async function lockRowsForBillingRunOrThrow(input: {
171:async function updateSelectedRowsByIdsOrThrow(input: {
220:function getPreviousMonthPeriod(now: Date) {
235:function buildInvoiceNotes(input: {
430:function getEntryCharge(entry: any, settings: any) {
457:function getRecurringCharge(instance: any) {
 succeeded in 52ms:
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
45:  const [y, m, d] = dateIso.split('-').map((v) => Number.parseInt(v, 10))
92:  const [y, m, d] = dateIso.split('-').map((v) => Number.parseInt(v, 10))
104:    .from('oj_billing_runs')
131:  table: 'oj_entries' | 'oj_recurring_charge_instances'
145:      billing_run_id: input.billingRunId,
173:  table: 'oj_entries' | 'oj_recurring_charge_instances'
195:    query = query.eq('billing_run_id', input.billingRunId)
242:  billingMode: 'full' | 'cap'
243:  capIncVat: number | null
375:  if (input.billingMode === 'cap') {
377:    lines.push(`Billing mode: Monthly cap`)
378:    if (input.capIncVat != null) lines.push(`Cap (inc VAT): £${input.capIncVat.toFixed(2)}`)
590:    billing_run_id: null,
615:    billing_run_id: null,
640:async function splitRecurringInstanceForCap(input: {
654:  const partial = computePartialExVatForHeadroom(input.headroom, fullCharge.vatRate)
655:  if (!partial) return null
656:  if (partial.exVat < 0.01) return null
658:  const remainderExVat = roundMoney(fullCharge.exVat - partial.exVat)
665:    if (!input.supabase) throw new Error('Supabase client required for split persist')
codex
The billing route is large enough that I’m splitting the inspection: one pass on the cron flow itself, one on the schema/migration history. That should surface the encoded rules and where the spec is already aligning or diverging from reality.
collab spawn_agent(call_JtzWSHE4ePD1P0Qr5Eeb3eDf, prompt="Inspect src/app/api/cron/oj-projects-billing/route.ts and summarize the real implementation. Focus on: main GET flow, pr…")
spawn_agent(call_JtzWSHE4ePD1P0Qr5Eeb3eDf, prompt="Inspect src/app/api/cron/oj-projects-billing/route.ts and summarize the real implementation. Focus on: main GET flow, pr…") pending init:
  agent: 019d8b1d-b0c7-7622-8c5d-ce8ec8506d3b
mcp: playwright starting
collab spawn_agent(call_9LzEZq3TbKlxEvo9CKH2xq9O, prompt="Inspect the OJ Projects schema history and related types. Read src/types/oj-projects.ts, src/types/invoices.ts, src/app/…")
spawn_agent(call_9LzEZq3TbKlxEvo9CKH2xq9O, prompt="Inspect the OJ Projects schema history and related types. Read src/types/oj-projects.ts, src/types/invoices.ts, src/app/…") pending init:
  agent: 019d8b1d-b0df-7d51-90c2-b64662dfadc5
mcp: playwright starting
mcp: playwright ready
mcp startup: ready: playwright
mcp: playwright ready
mcp startup: ready: playwright
codex
I’m tracing the OJ Projects schema from the migrations and comparing it to the current TypeScript shapes and balance logic. First I’ll read the requested files and list the relevant `oj*` migrations so I can reconstruct the table history before calling out gaps and billing risks.
exec
/bin/zsh -lc 'ls -1 supabase/migrations' in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg --files src/types src/app/actions supabase/migrations | rg 'src/types/oj-projects\\.ts|src/types/invoices\\.ts|src/app/actions/oj-projects/client-balance\\.ts|supabase/migrations/.*/?oj|supabase/migrations/.*oj'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
20240625000000_remote_placeholder.sql
20240712000001_remote_placeholder.sql
20240712000002_remote_placeholder.sql
20240712000003_remote_placeholder.sql
20240712000004_remote_placeholder.sql
20240712000005_remote_placeholder.sql
20240712000006_remote_placeholder.sql
20240712000007_remote_placeholder.sql
20240712000008_remote_placeholder.sql
20240720000000_remote_placeholder.sql
20240928123000_update_vendor_service_type_check.sql
20240929120000_add_vendor_contact_name.sql
20250113155500_remote_placeholder.sql
20250113170000_remote_placeholder.sql
20250113180000_remote_placeholder.sql
20250114180000_remote_placeholder.sql
20250114181000_remote_placeholder.sql
20250114182000_remote_placeholder.sql
20250114183000_remote_placeholder.sql
20250119210000_create_sunday_lunch_menu.sql
 succeeded in 51ms:
src/types/oj-projects.ts
src/types/invoices.ts
src/app/actions/oj-projects/client-balance.ts
supabase/migrations/20260405130001_update_oj_mileage_rate.sql
supabase/migrations/20260226120000_oj_entries_one_off.sql
supabase/migrations/20260120130000_oj_projects_core.sql
supabase/migrations/20260121100000_oj_recurring_charge_instances.sql
supabase/migrations/20260121120000_oj_retainer_projects.sql
supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql
supabase/migrations/20260121130000_project_stats_view.sql
supabase/migrations/20260405130002_oj_mileage_sync_trigger.sql
supabase/migrations/20260203090000_add_statement_mode_to_oj_vendor_billing_settings.sql
supabase/migrations/20260120132000_add_oj_projects_permissions.sql
exec
/bin/zsh -lc "sed -n '1,240p' 'src/types/invoices.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"recordPayment|sendRemittanceAdviceForPaidInvoice|remittance|receipt|partially_paid|invoice_email_logs\" 'src/app/actions/invoices.ts' 'src/lib/invoice-template-compact.ts' 'src/types/invoices.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,260p' 'src/app/actions/invoices.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '261,620p' 'src/app/actions/invoices.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,260p' 'src/lib/invoice-template-compact.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '261,520p' 'src/lib/invoice-template-compact.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '621,920p' 'src/app/actions/invoices.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
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
 succeeded in 51ms:
src/types/invoices.ts:17:export type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue' | 'void' | 'written_off'
src/app/actions/invoices.ts:112:async function sendRemittanceAdviceForPaidInvoice(
src/app/actions/invoices.ts:150:      console.error('[Invoices] Failed to resolve remittance recipients:', recipientResult.error)
src/app/actions/invoices.ts:182:This is a receipt confirming payment has been received for invoice ${invoice.invoice_number}.
src/app/actions/invoices.ts:207:      documentKind: 'remittance_advice',
src/app/actions/invoices.ts:208:      remittance: {
src/app/actions/invoices.ts:220:    const { error: logError } = await supabase.from('invoice_email_logs').insert(
src/app/actions/invoices.ts:232:      console.error('[Invoices] Failed to write remittance email logs:', logError)
src/app/actions/invoices.ts:241:        action: 'receipt_sent',
src/app/actions/invoices.ts:245:        receipt_test_override: forcedRecipient
src/app/actions/invoices.ts:258:  const errorMessage = emailResult.error || 'Failed to send receipt'
src/app/actions/invoices.ts:259:  const { error: failedLogError } = await supabase.from('invoice_email_logs').insert({
src/app/actions/invoices.ts:270:    console.error('[Invoices] Failed to write receipt failure log:', failedLogError)
src/app/actions/invoices.ts:280:      action: 'receipt_send_failed',
src/app/actions/invoices.ts:284:      receipt_test_override: forcedRecipient
src/app/actions/invoices.ts:428:      'draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void', 'written_off'
src/app/actions/invoices.ts:436:    if (newStatus === 'paid' || newStatus === 'partially_paid') {
src/app/actions/invoices.ts:670:export async function recordPayment(formData: FormData) {
src/app/actions/invoices.ts:710:      InvoiceService.recordPayment({
src/app/actions/invoices.ts:733:    let remittanceAdvice: RemittanceAdviceResult | null = null
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
 succeeded in 50ms:
    }
    
    .address-block {
      background: #f9fafb;
      padding: 8px;
      border-radius: 4px;
    }
    
    .address-block h3 {
      margin: 0 0 5px 0;
      color: #111827;
      font-size: 9pt;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    
    .address-block p {
      margin: 2px 0;
      color: #4b5563;
      font-size: 8pt;
 succeeded in 50ms:
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

export async function deleteCatalogItem(formData: FormData) {
codex
Inspecting `src/app/api/cron/oj-projects-billing/route.ts` only. I’ll map the function structure first, then read the file in chunks so the summary tracks the actual control flow rather than inferred behavior.
exec
/bin/zsh -lc 'wc -l src/app/api/cron/oj-projects-billing/route.ts' in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 50ms:
    3434 src/app/api/cron/oj-projects-billing/route.ts
exec
/bin/zsh -lc 'rg -n "''^(export'"\\s+async\\s+function\\s+GET|async function|function |const [A-Za-z0-9_]+\\s*=\\s*async|const [A-Za-z0-9_]+\\s*=\\s*\\()\" src/app/api/cron/oj-projects-billing/route.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
25:function roundMoney(value: number) {
29:function toIsoDateUtc(date: Date) {
33:function moneyIncVat(exVat: number, vatRate: number) {
40:function formatCurrency(amount: number) {
44:function parseIsoDateUtc(dateIso: string) {
49:function addMonthsUtc(date: Date, months: number) {
55:function addMinutes(date: Date, minutes: number) {
59:function formatMonthLabel(date: Date) {
63:function getProjectLabel(project: any) {
71:function formatPeriodLabel(periodYyyymm: string | null | undefined) {
77:function toLondonTimeHm(iso: string | null) {
91:function addDaysIsoDate(dateIso: string, days: number) {
98:async function updateBillingRunById(
119:async function throwOnMutationError(
129:async function lockRowsForBillingRunOrThrow(input: {
171:async function updateSelectedRowsByIdsOrThrow(input: {
220:function getPreviousMonthPeriod(now: Date) {
235:function buildInvoiceNotes(input: {
430:function getEntryCharge(entry: any, settings: any) {
457:function getRecurringCharge(instance: any) {
codex
I’ve got the migration set. Next I’m reading the current OJ type layer and the OJ migrations together so I can map table evolution against what the app actually assumes for client balances and remittances.
exec
/bin/zsh -lc 'nl -ba src/types/oj-projects.ts' in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc 'nl -ba src/types/invoices.ts' in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc 'nl -ba src/app/actions/oj-projects/client-balance.ts' in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc 'for f in supabase/migrations/*oj*.sql; do echo "===== $f ====="; nl -ba "$f"; done' in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
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
 succeeded in 51ms:
===== supabase/migrations/20260120130000_oj_projects_core.sql =====
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
exec
/bin/zsh -lc "sed -n '520,760p' 'src/app/(authenticated)/oj-projects/entries/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '620,740p' 'src/app/(authenticated)/oj-projects/clients/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '520,760p' 'src/app/(authenticated)/oj-projects/projects/[id]/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '540,620p' 'src/lib/invoice-template-compact.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.project_code} — {p.project_name}
                    </option>
                  ))}
              </Select>
            </FormGroup>

            {form.entry_type === 'time' ? (
              <>
                <FormGroup label="Duration (h)" required>
                  <Input
                    type="number"
                    min="0.25"
                    step="0.25"
                    value={form.duration_hours}
                    onChange={(e) => setForm({ ...form, duration_hours: parseFloat(e.target.value) || 0 })}
                    required
                  />
                </FormGroup>
 succeeded in 52ms:
        <span>${formatCurrency(invoice.subtotal_amount)}</span>
      </div>
      ${invoice.invoice_discount_percentage > 0 ? `
        <div class="summary-row">
          <span>Invoice Discount (${invoice.invoice_discount_percentage}%)</span>
          <span>-${formatCurrency(invoice.discount_amount)}</span>
        </div>
      ` : ''}
      <div class="summary-row">
        <span>VAT</span>
        <span>${formatCurrency(invoice.vat_amount)}</span>
      </div>
      ${isRemittanceAdvice ? `
        <div class="summary-row">
          <span>Invoice Total</span>
          <span>${formatCurrency(invoice.total_amount)}</span>
        </div>
        <div class="summary-row">
          <span>Total Paid</span>
          <span>${formatCurrency(invoice.paid_amount)}</span>
 succeeded in 52ms:
                <CardTitle>Tagged Contacts</CardTitle>
              </div>
            }
          >
            <div className="space-y-3 mb-4">
              {taggedContacts.length === 0 ? (
                <div className="text-sm text-gray-500 italic">No contacts tagged.</div>
              ) : (
                taggedContacts.map((tc: any) => (
                  <div key={tc.id} className="flex items-start justify-between gap-2 p-2 rounded bg-gray-50 border border-gray-100">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{tc.contact?.name || 'Unknown'}</div>
                      <div className="text-xs text-gray-500 truncate">{tc.contact?.email}</div>
                    </div>
                    <button type="button"
                      onClick={() => removeContactTag(tc.id)}
                      disabled={!canEdit}
                      className="text-gray-400 hover:text-red-500 p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
 succeeded in 52ms:
                          <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</th>
                          <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Paid</th>
                          <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Outstanding</th>
                          <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {balance.invoices.map((inv) => {
                          const period = inv.reference.replace(/^OJ Projects\s*/i, '')
                          const statusColors: Record<string, string> = {
                            paid: 'bg-green-100 text-green-700',
                            sent: 'bg-blue-100 text-blue-700',
                            partially_paid: 'bg-amber-100 text-amber-700',
                            overdue: 'bg-red-100 text-red-700',
                            draft: 'bg-gray-100 text-gray-600',
                            void: 'bg-gray-100 text-gray-400',
                            written_off: 'bg-gray-100 text-gray-400',
                          }
                          const statusColor = statusColors[inv.status] || 'bg-gray-100 text-gray-600'
                          return (
codex
I’ve mapped the major helpers. Next I’m reading the `GET` handler and the billing-specific helpers it calls so the summary can follow the actual execution path, recovery branches, and failure handling.
exec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '3101,3434p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '2301,2700p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '2701,3100p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '1928,2300p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
  1928	export async function GET(request: Request) {
  1929	  const authResult = authorizeCronRequest(request)
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
 succeeded in 52ms:
  3101	        })
  3102	
  3103	        results.failed++
  3104	        results.vendors.push({ vendor_id: vendorId, status: 'failed', invoice_id: invoiceId, invoice_number: invoiceNumber, error: 'Email service is not configured' })
  3105	        continue
  3106	      }
  3107	
  3108	      const fullInvoiceRes = await loadInvoiceWithDetails(supabase, invoiceId)
  3109	      if ('error' in fullInvoiceRes) throw new Error(fullInvoiceRes.error)
  3110	      const fullInvoice = fullInvoiceRes.invoice
  3111	
  3112	      const recipients = await resolveVendorInvoiceRecipients(supabase, vendorId, vendor.email)
  3113	      if ('error' in recipients) throw new Error(recipients.error)
  3114	      if (!recipients.to) {
  3115	        await updateBillingRunById(supabase, billingRun.id, {
  3116	          status: 'failed',
  3117	          error_message: 'No invoice recipient email configured (primary contact or vendor email)',
  3118	          run_finished_at: new Date().toISOString(),
  3119	          updated_at: new Date().toISOString(),
  3120	        })
 succeeded in 52ms:
  2701	            id,
  2702	            project_code,
  2703	            project_name
  2704	          ),
  2705	          work_type:oj_work_types(
  2706	            id,
  2707	            name
  2708	          )
  2709	        `
  2710	        )
  2711	        .eq('vendor_id', vendorId)
  2712	        .eq('status', 'unbilled')
  2713	        .eq('billable', true)
  2714	        .lte('entry_date', period.period_end)
  2715	        .order('entry_date', { ascending: true })
  2716	        .order('created_at', { ascending: true })
  2717	        .limit(10000)
  2718	      if (entriesError) throw new Error(entriesError.message)
  2719	
  2720	      const oneOffEntries = (eligibleEntries || []).filter((e: any) => e.entry_type === 'one_off')
 succeeded in 52ms:
  2301	          })
  2302	
  2303	          const timesheetPdf = await generateOjTimesheetPDF({
  2304	            invoiceNumber: invoice.invoice_number,
  2305	            vendorName: vendor.name,
  2306	            periodStart: String(billingRun.period_start),
  2307	            periodEnd: String(billingRun.period_end),
  2308	            notesText: timesheetNotes,
  2309	          })
  2310	
  2311	          additionalAttachments = [
  2312	            {
  2313	              name: `timesheet-${invoice.invoice_number}.pdf`,
  2314	              contentType: 'application/pdf',
  2315	              buffer: timesheetPdf,
  2316	            },
  2317	          ]
  2318	        }
  2319	
  2320	        const { claimKey, claimHash } = buildOjInvoiceSendClaimParams({
exec
/bin/zsh -lc "sed -n '1160,1560p' 'src/app/(authenticated)/oj-projects/clients/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '740,1160p' 'src/app/(authenticated)/oj-projects/clients/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc 'wc -l supabase/migrations/20260120130000_oj_projects_core.sql supabase/migrations/20260120132000_add_oj_projects_permissions.sql supabase/migrations/20260121100000_oj_recurring_charge_instances.sql supabase/migrations/20260121120000_oj_retainer_projects.sql supabase/migrations/20260121130000_project_stats_view.sql supabase/migrations/20260203090000_add_statement_mode_to_oj_vendor_billing_settings.sql supabase/migrations/20260226120000_oj_entries_one_off.sql supabase/migrations/20260405130001_update_oj_mileage_rate.sql supabase/migrations/20260405130002_oj_mileage_sync_trigger.sql supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql' in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
        </form>
      </Modal>
    </PageLayout>
  )
}
 succeeded in 51ms:
     295 supabase/migrations/20260120130000_oj_projects_core.sql
      47 supabase/migrations/20260120132000_add_oj_projects_permissions.sql
      79 supabase/migrations/20260121100000_oj_recurring_charge_instances.sql
      29 supabase/migrations/20260121120000_oj_retainer_projects.sql
      28 supabase/migrations/20260121130000_project_stats_view.sql
       2 supabase/migrations/20260203090000_add_statement_mode_to_oj_vendor_billing_settings.sql
      29 supabase/migrations/20260226120000_oj_entries_one_off.sql
       4 supabase/migrations/20260405130001_update_oj_mileage_rate.sql
     135 supabase/migrations/20260405130002_oj_mileage_sync_trigger.sql
      36 supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql
     684 total
 succeeded in 51ms:
                      onChange={(e) => setSettings({ ...settings, monthly_cap_inc_vat: e.target.value })}
                      disabled={!canEditSettings}
                      leftElement={<span className="text-gray-400 pl-3">£</span>}
                    />
                  </FormGroup>
                )}

                <FormGroup label="Statement Mode">
                  <Checkbox
                    checked={settings.statement_mode}
                    onChange={(e) => setSettings({ ...settings, statement_mode: e.target.checked })}
                    disabled={!canEditSettings}
                    label="Send balance statement invoices"
                    description="Hide itemised work; show project balance summary and payment projection."
                  />
                </FormGroup>

                <FormGroup label="Mileage Rate (£/mile)" required>
                  <Input
                    type="number"
codex
The `GET` path is clear now. I’m reading the helper functions that determine selection, splitting, statement-mode adjustments, and row locking because those are where the real billing semantics and edge cases live.
exec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '235,430p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '98,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '430,640p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '640,979p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
    98	async function updateBillingRunById(
    99	  supabase: any,
   100	  billingRunId: string,
   101	  patch: Record<string, unknown>
   102	) {
   103	  const { data: updatedBillingRun, error: updateError } = await supabase
   104	    .from('oj_billing_runs')
   105	    .update(patch)
   106	    .eq('id', billingRunId)
   107	    .select('id')
   108	    .maybeSingle()
   109	
   110	  if (updateError) {
   111	    throw new Error(updateError.message || `Failed to update billing run ${billingRunId}`)
   112	  }
   113	
   114	  if (!updatedBillingRun) {
   115	    throw new Error(`Billing run not found while updating status: ${billingRunId}`)
   116	  }
   117	}
 succeeded in 51ms:
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
   248	  carriedForwardOneOffEntries?: any[]
   249	}) {
   250	  const lines: string[] = []
   251	  lines.push(`OJ Projects timesheet`)
   252	  lines.push(`Billing month: ${input.period_start} to ${input.period_end}`)
   253	  lines.push(`Includes unbilled billable work up to ${input.period_end} (older items may appear if previously unbilled).`)
   254	  lines.push(`Rounding: time is rounded up to 15 minutes per entry`)
 succeeded in 51ms:
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
   440	
   441	  if (entryType === 'one_off') {
   442	    const exVat = roundMoney(Number(entry.amount_ex_vat_snapshot || 0))
   443	    const vatRate = Number(entry.vat_rate_snapshot ?? settings?.vat_rate ?? 20)
   444	    const incVat = moneyIncVat(exVat, vatRate)
   445	    return { exVat, vatRate, incVat }
   446	  }
   447	
   448	  const minutes = Number(entry.duration_minutes_rounded || 0)
   449	  const hours = minutes / 60
 succeeded in 51ms:
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
   651	  const fullCharge = getRecurringCharge(candidate)
   652	  if (fullCharge.incVat <= 0) return null
   653	
   654	  const partial = computePartialExVatForHeadroom(input.headroom, fullCharge.vatRate)
   655	  if (!partial) return null
   656	  if (partial.exVat < 0.01) return null
   657	
   658	  const remainderExVat = roundMoney(fullCharge.exVat - partial.exVat)
   659	  if (remainderExVat < 0.01) return null
codex
The `oj*` files cover the main rollout, but there may be later migrations that touch the same tables under different filenames. I’m checking the rest of `supabase/migrations` for any `oj_` references so the history and risk assessment isn’t incomplete.
exec
/bin/zsh -lc 'rg -n "oj_(projects|entries|billing_runs|project_contacts|work_types|vendor_billing_settings|vendor_recurring_charges|recurring_charge_instances|project_stats)" supabase/migrations' in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"OJ Projects|oj_projects|oj_entries|oj_recurring_charge_instances|statement_mode|balance payment|remittance|invoice_id\" src supabase/migrations | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
supabase/migrations/20260405130001_update_oj_mileage_rate.sql:2:UPDATE public.oj_vendor_billing_settings
supabase/migrations/20260226120000_oj_entries_one_off.sql:1:-- Add one_off entry type to oj_entries
supabase/migrations/20260226120000_oj_entries_one_off.sql:5:ALTER TABLE public.oj_entries
supabase/migrations/20260226120000_oj_entries_one_off.sql:9:ALTER TABLE public.oj_entries
supabase/migrations/20260226120000_oj_entries_one_off.sql:10:  DROP CONSTRAINT IF EXISTS oj_entries_entry_type_check;
supabase/migrations/20260226120000_oj_entries_one_off.sql:12:ALTER TABLE public.oj_entries
supabase/migrations/20260226120000_oj_entries_one_off.sql:13:  ADD CONSTRAINT oj_entries_entry_type_check
supabase/migrations/20260226120000_oj_entries_one_off.sql:18:ALTER TABLE public.oj_entries
supabase/migrations/20260226120000_oj_entries_one_off.sql:19:  DROP CONSTRAINT IF EXISTS chk_oj_entries_time_fields;
supabase/migrations/20260226120000_oj_entries_one_off.sql:21:ALTER TABLE public.oj_entries
supabase/migrations/20260226120000_oj_entries_one_off.sql:22:  ADD CONSTRAINT chk_oj_entries_time_fields
supabase/migrations/20260120132000_add_oj_projects_permissions.sql:5:    ('oj_projects', 'view', 'View OJ Projects'),
supabase/migrations/20260120132000_add_oj_projects_permissions.sql:6:    ('oj_projects', 'create', 'Create OJ Projects data'),
supabase/migrations/20260120132000_add_oj_projects_permissions.sql:7:    ('oj_projects', 'edit', 'Edit OJ Projects data'),
supabase/migrations/20260120132000_add_oj_projects_permissions.sql:8:    ('oj_projects', 'delete', 'Delete OJ Projects data'),
supabase/migrations/20260120132000_add_oj_projects_permissions.sql:9:    ('oj_projects', 'manage', 'Full OJ Projects management')
supabase/migrations/20260120132000_add_oj_projects_permissions.sql:25:    SELECT id, action FROM public.permissions WHERE module_name = 'oj_projects'
supabase/migrations/20260120130000_oj_projects_core.sql:12:      ('oj_projects', 'view', 'View OJ Projects'),
supabase/migrations/20260120130000_oj_projects_core.sql:13:      ('oj_projects', 'create', 'Create OJ Projects data'),
supabase/migrations/20260120130000_oj_projects_core.sql:14:      ('oj_projects', 'edit', 'Edit OJ Projects data'),
 succeeded in 52ms:
supabase/migrations/20251123120000_squashed.sql:11939:    converted_to_invoice_id uuid,
supabase/migrations/20251123120000_squashed.sql:11958:    last_invoice_id uuid,
supabase/migrations/20251123120000_squashed.sql:11966:    invoice_id uuid NOT NULL,
supabase/migrations/20251123120000_squashed.sql:11982:    invoice_id uuid NOT NULL,
supabase/migrations/20251123120000_squashed.sql:11994:    invoice_id uuid,
supabase/migrations/20251123120000_squashed.sql:12008:    invoice_id uuid,
supabase/migrations/20251123120000_squashed.sql:12019:    CONSTRAINT chk_one_reference CHECK (((invoice_id IS NOT NULL) AND (quote_id IS NULL)) OR ((invoice_id IS NULL) AND (quote_id IS NOT NULL))),
supabase/migrations/20251123120000_squashed.sql:12036:    invoice_id uuid,
supabase/migrations/20251123120000_squashed.sql:15111:  invoice_id uuid,
supabase/migrations/20251123120000_squashed.sql:16151:  p_invoice_id uuid,
supabase/migrations/20251123120000_squashed.sql:16164:  if p_invoice_id is null then
supabase/migrations/20251123120000_squashed.sql:16165:    raise exception 'invoice_id is required';
supabase/migrations/20251123120000_squashed.sql:16177:  where id = p_invoice_id
supabase/migrations/20251123120000_squashed.sql:16181:    raise exception 'Invoice % not found', p_invoice_id;
supabase/migrations/20251123120000_squashed.sql:16211:  where id = p_invoice_id
supabase/migrations/20251123120000_squashed.sql:16215:  where invoice_id = p_invoice_id;
supabase/migrations/20251123120000_squashed.sql:16218:    invoice_id,
supabase/migrations/20251123120000_squashed.sql:16227:    p_invoice_id,
supabase/migrations/20251123120000_squashed.sql:18153:  v_invoice_id UUID;
supabase/migrations/20251123120000_squashed.sql:18186:  RETURNING id INTO v_invoice_id;
exec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '1300,1662p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '1662,1927p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '979,1300p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
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
   979	async function computeStatementBalanceBefore(input: {
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
 succeeded in 51ms:
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
  1680	  const unbilledEntries = [
  1681	    ...(input.selectedTimeEntries || []),
codex
I’ve confirmed there are a few non-`oj*` migrations that still change OJ tables, plus some generated DB types and billing code that are useful for the mismatch check. I’m pulling those in now so the summary can separate “schema says”, “TS says”, and “runtime assumes”.
exec
/bin/zsh -lc 'nl -ba supabase/migrations/20260121123000_fix_retainer_check.sql' in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '3270,3625p' src/types/database.generated.ts | nl -ba -v3270" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '5880,6265p' src/types/database.generated.ts | nl -ba -v5880" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"remittance|statement_mode|carried_forward_inc_vat|billing_pending|one_off|recurring_charge_instances|OJ Projects\" src/app src/services src/types supabase/migrations | sed -n '1,320p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
     1	-- Fix retainer period check to be safer against escape sequences
     2	ALTER TABLE public.oj_projects
     3	  DROP CONSTRAINT IF EXISTS chk_oj_projects_retainer_period;
     4	
     5	ALTER TABLE public.oj_projects
     6	  ADD CONSTRAINT chk_oj_projects_retainer_period
     7	  CHECK (
     8	    is_retainer = false
     9	    OR (
    10	      retainer_period_yyyymm IS NOT NULL
    11	      AND retainer_period_yyyymm ~ '^[0-9]{4}-[0-9]{2}$'
    12	    )
    13	  );
 succeeded in 52ms:
  3270	            foreignKeyName: "guest_tokens_table_booking_id_fkey"
  3271	            columns: ["table_booking_id"]
  3272	            isOneToOne: false
  3273	            referencedRelation: "table_bookings"
  3274	            referencedColumns: ["id"]
  3275	          },
  3276	          {
  3277	            foreignKeyName: "guest_tokens_waitlist_offer_id_fkey"
  3278	            columns: ["waitlist_offer_id"]
  3279	            isOneToOne: false
  3280	            referencedRelation: "waitlist_offers"
  3281	            referencedColumns: ["id"]
  3282	          },
  3283	        ]
  3284	      }
  3285	      idempotency_keys: {
  3286	        Row: {
  3287	          created_at: string
  3288	          expires_at: string
  3289	          key: string
 succeeded in 51ms:
  5880	          carried_forward_inc_vat?: number | null
  5881	          created_at?: string
  5882	          error_message?: string | null
  5883	          id?: string
  5884	          invoice_id?: string | null
  5885	          period_end?: string
  5886	          period_start?: string
  5887	          period_yyyymm?: string
  5888	          run_finished_at?: string | null
  5889	          run_started_at?: string
  5890	          selected_entry_ids?: Json | null
  5891	          status?: string
  5892	          updated_at?: string
  5893	          vendor_id?: string
  5894	        }
  5895	        Relationships: [
  5896	          {
  5897	            foreignKeyName: "oj_billing_runs_invoice_id_fkey"
  5898	            columns: ["invoice_id"]
  5899	            isOneToOne: false
 succeeded in 51ms:
src/types/database.generated.ts:5848:          carried_forward_inc_vat: number | null
src/types/database.generated.ts:5864:          carried_forward_inc_vat?: number | null
src/types/database.generated.ts:5880:          carried_forward_inc_vat?: number | null
src/types/database.generated.ts:6130:      oj_recurring_charge_instances: {
src/types/database.generated.ts:6190:            foreignKeyName: "oj_recurring_charge_instances_billing_run_id_fkey"
src/types/database.generated.ts:6197:            foreignKeyName: "oj_recurring_charge_instances_invoice_id_fkey"
src/types/database.generated.ts:6204:            foreignKeyName: "oj_recurring_charge_instances_recurring_charge_id_fkey"
src/types/database.generated.ts:6211:            foreignKeyName: "oj_recurring_charge_instances_vendor_id_fkey"
src/types/database.generated.ts:6228:          statement_mode: boolean
src/types/database.generated.ts:6241:          statement_mode?: boolean
src/types/database.generated.ts:6254:          statement_mode?: boolean
src/types/oj-projects.ts:3:export type OJEntryType = 'time' | 'mileage' | 'one_off'
src/types/oj-projects.ts:4:export type OJEntryStatus = 'unbilled' | 'billing_pending' | 'billed' | 'paid'
src/types/oj-projects.ts:24:  statement_mode: boolean | null
src/types/oj-projects.ts:105:  carried_forward_inc_vat: number | null
supabase/migrations/20260120132000_add_oj_projects_permissions.sql:1:-- Add OJ Projects module permissions (new RBAC system: permissions/roles/role_permissions)
supabase/migrations/20260120132000_add_oj_projects_permissions.sql:5:    ('oj_projects', 'view', 'View OJ Projects'),
supabase/migrations/20260120132000_add_oj_projects_permissions.sql:6:    ('oj_projects', 'create', 'Create OJ Projects data'),
supabase/migrations/20260120132000_add_oj_projects_permissions.sql:7:    ('oj_projects', 'edit', 'Edit OJ Projects data'),
supabase/migrations/20260120132000_add_oj_projects_permissions.sql:8:    ('oj_projects', 'delete', 'Delete OJ Projects data'),
codex
I have the billing semantics. I’m checking the small utility block at the top for constants and date handling so any notes about period calculation, note truncation, or send/retry behavior are tied to the actual definitions.
exec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '1,97p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '220,235p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
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
 succeeded in 52ms:
   220	function getPreviousMonthPeriod(now: Date) {
   221	  const year = Number(formatInTimeZone(now, LONDON_TZ, 'yyyy'))
   222	  const month1 = Number(formatInTimeZone(now, LONDON_TZ, 'MM')) // 1..12 (current month)
   223	  const currentMonthIndex = month1 - 1 // 0..11
   224	
   225	  const prevMonthEndUtc = new Date(Date.UTC(year, currentMonthIndex, 0))
   226	  const prevMonthStartUtc = new Date(Date.UTC(year, currentMonthIndex - 1, 1))
   227	
   228	  return {
   229	    period_start: toIsoDateUtc(prevMonthStartUtc),
   230	    period_end: toIsoDateUtc(prevMonthEndUtc),
   231	    period_yyyymm: formatInTimeZone(prevMonthEndUtc, LONDON_TZ, 'yyyy-MM'),
   232	  }
   233	}
   234	
   235	function buildInvoiceNotes(input: {
exec
/bin/zsh -lc "sed -n '221,380p' 'supabase/migrations/20260120130000_oj_projects_core.sql'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,220p' 'supabase/migrations/20260120130000_oj_projects_core.sql'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,220p' 'supabase/migrations/20260405130001_update_oj_mileage_rate.sql' && printf '\\n---\\n' && sed -n '1,260p' 'supabase/migrations/20260405130002_oj_mileage_sync_trigger.sql' && printf '\\n---\\n' && sed -n '1,220p' 'supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,220p' 'supabase/migrations/20260121100000_oj_recurring_charge_instances.sql' && printf '\\n---\\n' && sed -n '1,220p' 'supabase/migrations/20260121120000_oj_retainer_projects.sql' && printf '\\n---\\n' && sed -n '1,220p' 'supabase/migrations/20260121130000_project_stats_view.sql'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1,220p' 'supabase/migrations/20260120132000_add_oj_projects_permissions.sql' && printf '\\n---\\n' && sed -n '1,220p' 'supabase/migrations/20260203090000_add_statement_mode_to_oj_vendor_billing_settings.sql' && printf '\\n---\\n' && sed -n '1,220p' 'supabase/migrations/20260226120000_oj_entries_one_off.sql'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
CREATE POLICY "oj_vendor_recurring_charges_all" ON public.oj_vendor_recurring_charges
  FOR ALL TO authenticated
  USING (public.user_has_permission(auth.uid(), 'oj_projects', 'edit') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'oj_projects', 'edit') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));

-- Projects
CREATE POLICY "oj_projects_select" ON public.oj_projects
  FOR SELECT TO authenticated
  USING (public.user_has_permission(auth.uid(), 'oj_projects', 'view') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));

CREATE POLICY "oj_projects_insert" ON public.oj_projects
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_permission(auth.uid(), 'oj_projects', 'create') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));

CREATE POLICY "oj_projects_update" ON public.oj_projects
  FOR UPDATE TO authenticated
  USING (public.user_has_permission(auth.uid(), 'oj_projects', 'edit') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'oj_projects', 'edit') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));

CREATE POLICY "oj_projects_delete" ON public.oj_projects
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

 succeeded in 51ms:
-- OJ Projects: recurring charge instances (per period) to support cap carry-forward.
-- Tracks billed status and allows deferred recurring charges to be billed in later runs.

CREATE TABLE IF NOT EXISTS public.oj_recurring_charge_instances (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id uuid NOT NULL REFERENCES public.invoice_vendors(id) ON DELETE CASCADE,
  recurring_charge_id uuid NOT NULL REFERENCES public.oj_vendor_recurring_charges(id) ON DELETE CASCADE,
  period_yyyymm text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  description_snapshot text NOT NULL,
  amount_ex_vat_snapshot numeric(12,2) NOT NULL,
  vat_rate_snapshot numeric(5,2) NOT NULL DEFAULT 20,
  sort_order_snapshot integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'unbilled' CHECK (status IN ('unbilled', 'billing_pending', 'billed', 'paid')),
  billing_run_id uuid REFERENCES public.oj_billing_runs(id),
  invoice_id uuid REFERENCES public.invoices(id),
  billed_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
 succeeded in 51ms:
-- Update default mileage rate from £0.42 to £0.45 for all vendors
UPDATE public.oj_vendor_billing_settings
SET mileage_rate = 0.45
WHERE mileage_rate = 0.42;

---
-- OJ-Projects mileage → mileage_trips sync trigger
--
-- Lightweight trigger that syncs oj_entries rows with entry_type = 'mileage'
-- into mileage_trips. Does NOT perform HMRC rate recalculation — the
-- application layer handles that after the transaction commits.
--
-- Behaviour matrix:
--   INSERT + NEW.entry_type = 'mileage'        → create mileage_trips row
--   INSERT + NEW.entry_type ≠ 'mileage'        → no-op
--   UPDATE + OLD/NEW both 'mileage'            → update synced row
--   UPDATE + OLD ≠ 'mileage', NEW = 'mileage'  → create synced row
--   UPDATE + OLD = 'mileage', NEW ≠ 'mileage'  → delete synced row
--   UPDATE + neither is 'mileage'              → no-op
--   DELETE + OLD.entry_type = 'mileage'        → delete synced row
 succeeded in 50ms:
-- Add OJ Projects module permissions (new RBAC system: permissions/roles/role_permissions)
DO $$
BEGIN
  INSERT INTO public.permissions (module_name, action, description) VALUES
    ('oj_projects', 'view', 'View OJ Projects'),
    ('oj_projects', 'create', 'Create OJ Projects data'),
    ('oj_projects', 'edit', 'Edit OJ Projects data'),
    ('oj_projects', 'delete', 'Delete OJ Projects data'),
    ('oj_projects', 'manage', 'Full OJ Projects management')
  ON CONFLICT (module_name, action) DO NOTHING;
END $$;

DO $$
DECLARE
  v_super_admin_role_id UUID;
  v_admin_role_id UUID;
  v_manager_role_id UUID;
  v_permission RECORD;
BEGIN
  SELECT id INTO v_super_admin_role_id FROM public.roles WHERE name = 'super_admin';
codex
I have enough of the OJ schema itself. One more pass is useful on the generated `invoices`/`invoice_vendors` shapes, because the balance code depends on invoice status, payment totals, and vendor linkage rather than OJ tables alone.
exec
/bin/zsh -lc 'rg -n "''^'"\\s*invoices: \\{|"'^'"\\s*invoice_vendors: \\{\" src/types/database.generated.ts" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '1290,1675p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/invoices.ts | sed -n '430,480p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
3716:      invoice_vendors: {
3761:      invoices: {
 succeeded in 51ms:
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
   440	    // Prevent voiding invoices that have linked OJ Projects items, unless explicitly overridden.
   441	    if (newStatus === 'void' && !force) {
   442	      const adminClient = createAdminClient()
   443	
   444	      const [
   445	        { count: entryCount, error: entryError },
   446	        { count: recurringCount, error: recurringError },
   447	      ] = await Promise.all([
   448	        adminClient
   449	          .from('oj_entries')
 succeeded in 51ms:
  1290	      quantity: 1,
  1291	      unit_price: roundMoney(totalExVat),
  1292	      discount_percentage: 0,
  1293	      vat_rate: bucket.vatRate,
  1294	    })
  1295	  }
  1296	
  1297	  return lineItems
  1298	}
  1299	
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
exec
/bin/zsh -lc "nl -ba src/app/actions/invoices.ts | sed -n '720,770p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '3716,3848p' src/types/database.generated.ts | nl -ba -v3716" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"CREATE TABLE.*invoices|ALTER TABLE public\\.invoices|CHECK .*status.*invoices|partially_paid|written_off|deleted_at|paid_amount|reference\" supabase/migrations | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
   720	
   721	    await logAuditEvent({
   722	      operation_type: 'create',
   723	      resource_type: 'invoice_payment',
   724	      resource_id: payment.id,
   725	      operation_status: 'success',
   726	      new_values: { 
   727	        invoice_id: invoiceId,
   728	        amount,
   729	        payment_method: paymentMethod
   730	      }
   731	    })
   732	
   733	    let remittanceAdvice: RemittanceAdviceResult | null = null
   734	    const { data: invoiceAfterPayment, error: invoiceAfterError } = await supabase
   735	      .from('invoices')
   736	      .select('status')
   737	      .eq('id', invoiceId)
   738	      .is('deleted_at', null)
   739	      .maybeSingle()
 succeeded in 51ms:
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
  3730	        }
  3731	        Insert: {
  3732	          address?: string | null
  3733	          contact_name?: string | null
  3734	          created_at?: string | null
  3735	          email?: string | null
 succeeded in 52ms:
supabase/migrations/20260420000003_bookings_v05_foundations.sql:361:    WHERE conname = 'booking_holds_reference_check'
supabase/migrations/20260420000003_bookings_v05_foundations.sql:364:      ADD CONSTRAINT booking_holds_reference_check
supabase/migrations/20260420000003_bookings_v05_foundations.sql:401:    WHERE conname = 'payments_booking_reference_check'
supabase/migrations/20260420000003_bookings_v05_foundations.sql:404:      ADD CONSTRAINT payments_booking_reference_check
supabase/migrations/20260420000003_bookings_v05_foundations.sql:515:    WHERE conname = 'feedback_reference_check'
supabase/migrations/20260420000003_bookings_v05_foundations.sql:518:      ADD CONSTRAINT feedback_reference_check
supabase/migrations/20260411000000_hiring_m0_schema.sql:134:  external_reference text,
supabase/migrations/20260517000000_fix_parking_toctou.sql:85:  -- Insert the booking. The reference and timestamps are handled by
supabase/migrations/20260517000000_fix_parking_toctou.sql:86:  -- existing triggers (trg_generate_parking_reference, trg_set_parking_booking_timestamps).
supabase/migrations/20260420000013_charge_approval_runtime.sql:60:    tb.booking_reference,
supabase/migrations/20260420000013_charge_approval_runtime.sql:132:    'booking_reference', v_charge.booking_reference,
supabase/migrations/20260420000013_charge_approval_runtime.sql:220:    tb.booking_reference,
supabase/migrations/20260225120001_fuzzy_grouping_and_ai_stats.sql:2:-- 1. Normalize receipt details — strips trailing reference codes
supabase/migrations/20260225120001_fuzzy_grouping_and_ai_stats.sql:18:  -- Strip trailing alphanumeric reference codes like *AB12CD or /REF123
supabase/migrations/20260302000002_fix_deposit_payment_confirmed_bookings.sql:33:    tb.booking_reference,
supabase/migrations/20260302000002_fix_deposit_payment_confirmed_bookings.sql:129:      'booking_reference', v_booking.booking_reference,
supabase/migrations/20260302000002_fix_deposit_payment_confirmed_bookings.sql:156:      'booking_reference', v_booking.booking_reference,
supabase/migrations/20260509000013_fix_core_remove_card_capture_refs.sql:1:-- Fix: remove dead card-capture references from create_table_booking_v05_core.
supabase/migrations/20260509000013_fix_core_remove_card_capture_refs.sql:4:-- to create_table_booking_v05_core, but still referenced two pieces of
supabase/migrations/20260420000022_event_modes_table_reservations_and_private_buffers.sql:438:  v_booking_reference text;
exec
/bin/zsh -lc "sed -n '620,1048p' 'src/app/api/cron/oj-projects-billing/route.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '220,620p' 'src/app/api/cron/oj-projects-billing/route.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1665,2305p' 'src/app/api/cron/oj-projects-billing/route.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '2305,3434p' 'src/app/api/cron/oj-projects-billing/route.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '1048,1665p' 'src/app/api/cron/oj-projects-billing/route.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function getNextSplitPeriodYyyymm(basePeriod: string, existingPeriods: string[]) {
  const base = formatPeriodLabel(basePeriod)
  if (!base) return `${basePeriod}-S1`
  const prefix = `${base}-S`
  let maxIndex = 0
  for (const period of existingPeriods) {
    const text = String(period || '')
    if (!text.startsWith(prefix)) continue
    const suffix = text.slice(prefix.length)
    const parsed = Number.parseInt(suffix, 10)
    if (Number.isFinite(parsed) && parsed > maxIndex) maxIndex = parsed
  }
  return `${base}-S${maxIndex + 1}`
}

 succeeded in 51ms:
function getPreviousMonthPeriod(now: Date) {
  const year = Number(formatInTimeZone(now, LONDON_TZ, 'yyyy'))
  const month1 = Number(formatInTimeZone(now, LONDON_TZ, 'MM')) // 1..12 (current month)
  const currentMonthIndex = month1 - 1 // 0..11

  const prevMonthEndUtc = new Date(Date.UTC(year, currentMonthIndex, 0))
  const prevMonthStartUtc = new Date(Date.UTC(year, currentMonthIndex - 1, 1))

  return {
    period_start: toIsoDateUtc(prevMonthStartUtc),
    period_end: toIsoDateUtc(prevMonthEndUtc),
    period_yyyymm: formatInTimeZone(prevMonthEndUtc, LONDON_TZ, 'yyyy-MM'),
  }
}

function buildInvoiceNotes(input: {
  period_start: string
  period_end: string
  selectedTimeEntries: any[]
  selectedMileageEntries: any[]
 succeeded in 52ms:
  period_start: string
  period_end: string
  invoiceDate: string
  capIncVat: number | null
  settings: any
  selectedRecurringInstances: any[]
  skippedRecurringInstances: any[]
  selectedMileageEntries: any[]
  skippedMileageEntries: any[]
  selectedTimeEntries: any[]
  skippedTimeEntries: any[]
  invoiceTotalIncVat: number
}) {
  const supabase = input.supabase

  const unbilledEntries = [
    ...(input.selectedTimeEntries || []),
    ...(input.selectedMileageEntries || []),
    ...(input.skippedTimeEntries || []),
    ...(input.skippedMileageEntries || []),
 succeeded in 52ms:
            vendorName: vendor.name,
            periodStart: String(billingRun.period_start),
            periodEnd: String(billingRun.period_end),
            notesText: timesheetNotes,
          })

          additionalAttachments = [
            {
              name: `timesheet-${invoice.invoice_number}.pdf`,
              contentType: 'application/pdf',
              buffer: timesheetPdf,
            },
          ]
        }

        const { claimKey, claimHash } = buildOjInvoiceSendClaimParams({
          invoiceId: invoice.id,
          billingRunId: billingRun.id,
          to: recipients.to,
          cc: recipients.cc,
 succeeded in 50ms:
    description: string
    quantity: number
    unit_price: number
    discount_percentage: number
    vat_rate: number
  }>
  totals: InvoiceTotalsResult
  targetIncVat: number
  vatRate: number
}) {
  let totals = input.totals
  const target = roundMoney(Number(input.targetIncVat))
  if (!Number.isFinite(target) || target <= 0) return { lineItems: input.lineItems, totals }

  let diff = roundMoney(target - Number(totals.totalAmount))
  if (!Number.isFinite(diff) || diff <= 0.009) return { lineItems: input.lineItems, totals }

  const vatRate = Number(input.vatRate || 0)
  const label =
    vatRate === 0
exec
/bin/zsh -lc "nl -ba src/app/actions/oj-projects/vendor-settings.ts | sed -n '1,120p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
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
exec
/bin/zsh -lc "rg -n \"from '@/types/oj-projects'|from \\\"@/types/oj-projects\\\"|OJProject\\b|OJEntry\\b|OJBillingRun\\b|OJVendorBillingSettings\\b|OJBillingMode\\b|OJEntryStatus\\b\" src | sed -n '1,240p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"from '@/types/invoices'|from \\\"@/types/invoices\\\"|InvoiceWithDetails\\b|InvoicePayment\\b|InvoiceVendor\\b|RecurringInvoice\\b\" src | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
src/types/oj-projects.ts:1:export type OJBillingMode = 'full' | 'cap'
src/types/oj-projects.ts:4:export type OJEntryStatus = 'unbilled' | 'billing_pending' | 'billed' | 'paid'
src/types/oj-projects.ts:15:export type OJVendorBillingSettings = {
src/types/oj-projects.ts:18:  billing_mode: OJBillingMode
src/types/oj-projects.ts:41:export type OJProject = {
src/types/oj-projects.ts:65:export type OJEntry = {
src/types/oj-projects.ts:81:  status: OJEntryStatus
src/types/oj-projects.ts:96:export type OJBillingRun = {
 succeeded in 52ms:
src/services/vendors.ts:3:import type { InvoiceVendor } from '@/types/invoices';
src/services/invoices.ts:8:import type { InvoiceStatus, InvoiceLineItemInput, Invoice, InvoiceWithDetails, LineItemCatalogItem } from '@/types/invoices';
src/services/invoices.ts:325:      invoices: normalizedInvoices as InvoiceWithDetails[],
src/services/invoices.ts:360:    return normalized as InvoiceWithDetails;
src/services/quotes.ts:5:import type { QuoteStatus, InvoiceLineItemInput } from '@/types/invoices';
src/types/invoices.ts:2:export interface InvoiceVendor {
src/types/invoices.ts:69:export interface InvoicePayment {
src/types/invoices.ts:80:export interface InvoiceWithDetails extends Invoice {
src/types/invoices.ts:81:  vendor?: InvoiceVendor
src/types/invoices.ts:83:  payments?: InvoicePayment[]
src/types/invoices.ts:134:  vendor?: InvoiceVendor
src/types/invoices.ts:139:export interface RecurringInvoice {
src/types/invoices.ts:169:export interface RecurringInvoiceWithDetails extends RecurringInvoice {
src/types/invoices.ts:170:  vendor?: InvoiceVendor
src/app/api/cron/auto-send-invoices/route.ts:6:import type { InvoiceWithDetails } from '@/types/invoices'
src/app/api/cron/auto-send-invoices/route.ts:183:        invoice as InvoiceWithDetails,
src/app/api/cron/oj-projects-billing/route.ts:9:import type { InvoiceWithDetails } from '@/types/invoices'
src/app/api/cron/oj-projects-billing/route.ts:1891:async function loadInvoiceWithDetails(supabase: ReturnType<typeof createAdminClient>, invoiceId: string) {
src/app/api/cron/oj-projects-billing/route.ts:1906:  return { invoice: data as InvoiceWithDetails }
src/app/api/cron/oj-projects-billing/route.ts:2165:        const loaded = await loadInvoiceWithDetails(supabase, billingRun.invoice_id)
codex
The manual OJ types look effectively orphaned, while `src/types/invoices.ts` is actively used. I’m checking the invoice service normalization path to see whether those invoice types intentionally paper over DB nullability or whether there are assumptions that could leak into OJ billing/remittance flows.
exec
/bin/zsh -lc "nl -ba src/services/invoices.ts | sed -n '1,240p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '3000,3115p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '3090,3388p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
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
 succeeded in 51ms:
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
exec
/bin/zsh -lc "rg -n \"recordPayment\\(|updateInvoiceStatus\\(\" 'src/services' 'src/app/actions/invoices.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
src/app/actions/invoices.ts:410:export async function updateInvoiceStatus(formData: FormData) {
src/app/actions/invoices.ts:477:      InvoiceService.updateInvoiceStatus(invoiceId, newStatus),
src/app/actions/invoices.ts:670:export async function recordPayment(formData: FormData) {
src/app/actions/invoices.ts:710:      InvoiceService.recordPayment({
src/services/invoices.ts:164:  static async recordPayment(input: RecordPaymentInput) {
src/services/invoices.ts:407:  static async updateInvoiceStatus(invoiceId: string, newStatus: InvoiceStatus) {
exec
/bin/zsh -lc "nl -ba src/services/invoices.ts | sed -n '240,390p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"normalized|as InvoiceWithDetails|paid_amount|status: .*InvoiceStatus|vendor:|line_items:|payments:\" src/services/invoices.ts | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"computeStatementBalanceBefore|buildStatementNotes|sendRemittanceAdviceForPaidInvoice|remittance_advice\" src/app src/lib | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
38:  line_items: InvoiceLineItemInput[];
92:      status: 'draft' as InvoiceStatus,
98:      p_line_items: input.line_items
145:      status: 'draft' as InvoiceStatus,
150:      p_line_items: input.line_items
225:      p_line_items: input.line_items.map(item => ({
255:        status: 'overdue' as InvoiceStatus,
284:        vendor:invoice_vendors(*)
316:    const normalizedInvoices = invoices.map((invoice) => ({
325:      invoices: normalizedInvoices as InvoiceWithDetails[],
341:        vendor:invoice_vendors(*),
342:        line_items:invoice_line_items(*),
343:        payments:invoice_payments(*)
355:    const normalized =
357:        ? { ...invoice, status: 'overdue' as InvoiceStatus }
360:    return normalized as InvoiceWithDetails;
436:      updates.paid_amount = currentInvoice.total_amount;
 succeeded in 52ms:
   240	    if (updateError) {
   241	      console.error('Error updating invoice via RPC:', updateError);
   242	      throw new Error('Failed to update invoice');
   243	    }
   244	
   245	    return updatedInvoice;
   246	  }
   247	
   248	  static async persistOverdueInvoices() {
   249	    const adminClient = await createAdminClient();
   250	    const today = getTodayIsoDate();
   251	
   252	    const { error } = await adminClient
   253	      .from('invoices')
   254	      .update({
   255	        status: 'overdue' as InvoiceStatus,
   256	        updated_at: new Date().toISOString(),
   257	      })
   258	      .lte('due_date', today)
   259	      .eq('status', 'sent')
 succeeded in 51ms:
src/lib/microsoft-graph.ts:103:    const isRemittanceAdvice = documentKind === 'remittance_advice'
src/lib/invoice-template-compact.ts:8:export type InvoiceDocumentKind = 'invoice' | 'remittance_advice'
src/lib/invoice-template-compact.ts:26:  const isRemittanceAdvice = documentKind === 'remittance_advice'
src/app/api/cron/oj-projects-billing/route.ts:979:async function computeStatementBalanceBefore(input: {
src/app/api/cron/oj-projects-billing/route.ts:1479:    const summary = await computeStatementBalanceBefore({
src/app/api/cron/oj-projects-billing/route.ts:1579:    notes = await buildStatementNotes({
src/app/api/cron/oj-projects-billing/route.ts:1662:async function buildStatementNotes(input: {
src/app/api/cron/oj-projects-billing/route.ts:2804:        const summary = await computeStatementBalanceBefore({
src/app/api/cron/oj-projects-billing/route.ts:3007:        notes = await buildStatementNotes({
src/app/actions/invoices.ts:112:async function sendRemittanceAdviceForPaidInvoice(
src/app/actions/invoices.ts:207:      documentKind: 'remittance_advice',
src/app/actions/invoices.ts:747:      remittanceAdvice = await sendRemittanceAdviceForPaidInvoice(invoiceId, user?.id || null)
exec
/bin/zsh -lc "sed -n '400,470p' 'src/services/invoices.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '150,250p' 'src/services/invoices.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
      console.error('Error fetching line item catalog:', error);
      throw new Error('Failed to fetch line items');
    }

    return items as LineItemCatalogItem[];
  }

  static async updateInvoiceStatus(invoiceId: string, newStatus: InvoiceStatus) {
    const supabase = await createClient();
    
    // Get current invoice for old status
    const { data: currentInvoice, error: fetchError } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .is('deleted_at', null)
      .single();

    if (fetchError || !currentInvoice) {
      throw new Error('Invoice not found');
 succeeded in 52ms:
      p_line_items: input.line_items
    })

    if (error) {
      console.error('Create invoice transaction error:', error)
      throw new Error('Failed to create invoice')
    }

    return invoice
  }

  /**
   * Records a payment and updates invoice status atomically.
   */
  static async recordPayment(input: RecordPaymentInput) {
    const supabase = await createClient();

    const { data: result, error } = await supabase.rpc('record_invoice_payment_transaction', {
      p_payment_data: {
        invoice_id: input.invoice_id,
exec
/bin/zsh -lc "nl -ba src/app/actions/invoices.ts | sed -n '100,240p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '979,1105p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
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
   115	): Promise<RemittanceAdviceResult> {
   116	  if (!isGraphConfigured()) {
   117	    return { sent: false, skippedReason: 'email_not_configured' }
   118	  }
   119	
 succeeded in 52ms:
   979	async function computeStatementBalanceBefore(input: {
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
exec
/bin/zsh -lc "rg -n \"async function|const navItems|createTimeEntry|createMileageEntry|createOneOffCharge|getEntries|getOjProjectsEmailStatus|getVendorBillingSettings|getRecurringCharges|handle|submit|openEdit|deleteEntry|BarChart|StatCard|Preview\" 'src/app/(authenticated)/oj-projects/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '520,980p' 'src/app/(authenticated)/oj-projects/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
19:import { getRecurringCharges } from '@/app/actions/oj-projects/recurring-charges'
20:import { getVendorBillingSettings } from '@/app/actions/oj-projects/vendor-settings'
22:import { createMileageEntry, createOneOffCharge, createTimeEntry, deleteEntry, getEntries, updateEntry } from '@/app/actions/oj-projects/entries'
23:import { getOjProjectsEmailStatus } from '@/app/actions/oj-projects/system'
25:import { BarChart } from '@/components/charts/BarChart'
82:function StatCard({
482:    async function loadVendorMeta() {
485:          getVendorBillingSettings(vendorId),
486:          getRecurringCharges(vendorId),
533:  async function load() {
541:        getEntries({ startDate: selectedMonth.start, endDate: selectedMonth.end, limit: 500 }),
542:        getEntries({ limit: 1000 }), // Increased limit for history graph
543:        getOjProjectsEmailStatus(),
574:  async function submitEntry(e: React.FormEvent) {
611:        res = await createTimeEntry(fd)
614:        res = await createOneOffCharge(fd)
617:        res = await createMileageEntry(fd)
638:  function openEdit(entry: any) {
668:  async function saveEdit(e: React.FormEvent) {
710:  async function removeEntry(entry: any) {
 succeeded in 52ms:
    const retainerProject =
      projects.find(
        (p: any) =>
          String(p?.vendor_id || '') === vendorId &&
          !!p?.is_retainer &&
          String(p?.retainer_period_yyyymm || '') === entryPeriod
      ) || null

    if (retainerProject?.id) {
      setProjectId(String(retainerProject.id))
    }
  }, [projects, vendorId, entryDate, projectId])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [vendorsRes, projectsRes, workTypesRes, monthEntriesRes, recentEntriesRes, emailStatusRes] = await Promise.all([
        getVendors(),
        getProjects({ status: 'active' }),
exec
/bin/zsh -lc "rg -n \"oj_recurring_charge_instances|oj_vendor_billing_settings|oj_billing_runs|oj_project_contacts|oj_work_types|oj_vendor_recurring_charges|mileage_trips\" src/types/oj-projects.ts src/types/invoices.ts src/app/actions/oj-projects/client-balance.ts | sed -n '1,200p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"amount_ex_vat_snapshot|mileage_rate_snapshot|hourly_rate_ex_vat_snapshot|statement_mode|carried_forward_inc_vat|retainer_included_hours_per_month|one_off|billing_pending\" src/app/actions/oj-projects/client-balance.ts src/types/oj-projects.ts src/types/invoices.ts | sed -n '1,200p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"oj_project_stats\" src/types/database.generated.ts src/types/oj-projects.ts src | sed -n '1,120p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
src/app/actions/oj-projects/client-balance.ts:91:    .from('oj_recurring_charge_instances')
 succeeded in 51ms:
src/app/actions/oj-projects/client-balance.ts:67:      'entry_type, duration_minutes_rounded, miles, hourly_rate_ex_vat_snapshot, vat_rate_snapshot, mileage_rate_snapshot'
src/app/actions/oj-projects/client-balance.ts:80:      const rate = Number(entry.hourly_rate_ex_vat_snapshot || 75)
src/app/actions/oj-projects/client-balance.ts:84:      const mileageRate = Number(entry.mileage_rate_snapshot || 0.42)
src/app/actions/oj-projects/client-balance.ts:92:    .select('amount_ex_vat_snapshot, vat_rate_snapshot')
src/app/actions/oj-projects/client-balance.ts:100:      const exVat = Number(inst.amount_ex_vat_snapshot || 0)
src/types/oj-projects.ts:3:export type OJEntryType = 'time' | 'mileage' | 'one_off'
src/types/oj-projects.ts:4:export type OJEntryStatus = 'unbilled' | 'billing_pending' | 'billed' | 'paid'
src/types/oj-projects.ts:23:  retainer_included_hours_per_month: number | null
src/types/oj-projects.ts:24:  statement_mode: boolean | null
src/types/oj-projects.ts:86:  hourly_rate_ex_vat_snapshot: number | null
src/types/oj-projects.ts:88:  mileage_rate_snapshot: number | null
src/types/oj-projects.ts:89:  amount_ex_vat_snapshot: number | null
src/types/oj-projects.ts:105:  carried_forward_inc_vat: number | null
 succeeded in 52ms:
src/types/database.generated.ts:11187:      oj_project_stats: {
src/types/database.generated.ts:11187:      oj_project_stats: {
src/app/actions/oj-projects/projects.ts:122:      .from('oj_project_stats')
exec
/bin/zsh -lc "rg -n \"\\bany\\b\" 'src/app/actions/oj-projects' 'src/app/api/cron/oj-projects-billing/route.ts' 'src/app/(authenticated)/oj-projects' 'src/types/oj-projects.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
src/types/oj-projects.ts:104:  selected_entry_ids: any | null
src/app/api/cron/oj-projects-billing/route.ts:63:function getProjectLabel(project: any) {
src/app/api/cron/oj-projects-billing/route.ts:99:  supabase: any,
src/app/api/cron/oj-projects-billing/route.ts:120:  mutation: any,
src/app/api/cron/oj-projects-billing/route.ts:130:  supabase: any
src/app/api/cron/oj-projects-billing/route.ts:158:    const lockedIdSet = new Set((lockedRows || []).map((row: any) => String(row.id)))
src/app/api/cron/oj-projects-billing/route.ts:172:  supabase: any
src/app/api/cron/oj-projects-billing/route.ts:207:    const updatedIdSet = new Set((updatedRows || []).map((row: any) => String(row.id)))
src/app/api/cron/oj-projects-billing/route.ts:238:  selectedTimeEntries: any[]
src/app/api/cron/oj-projects-billing/route.ts:239:  selectedMileageEntries: any[]
src/app/api/cron/oj-projects-billing/route.ts:240:  selectedOneOffEntries?: any[]
src/app/api/cron/oj-projects-billing/route.ts:245:  carriedForwardRecurringInstances?: any[]
src/app/api/cron/oj-projects-billing/route.ts:246:  carriedForwardMileageEntries?: any[]
src/app/api/cron/oj-projects-billing/route.ts:247:  carriedForwardTimeEntries?: any[]
src/app/api/cron/oj-projects-billing/route.ts:248:  carriedForwardOneOffEntries?: any[]
src/app/api/cron/oj-projects-billing/route.ts:256:  const getWorkTypeLabel = (e: any) => String(e.work_type_name_snapshot || e.work_type?.name || 'Unspecified')
src/app/api/cron/oj-projects-billing/route.ts:276:  const timeByProject = new Map<string, { projectLabel: string; entries: any[] }>()
src/app/api/cron/oj-projects-billing/route.ts:282:    const bucket = timeByProject.get(key) || { projectLabel, entries: [] as any[] }
src/app/api/cron/oj-projects-billing/route.ts:391:        const recurringIncVat = cfRecurring.reduce((acc: number, c: any) => {
src/app/api/cron/oj-projects-billing/route.ts:397:        const mileageMiles = cfMileage.reduce((acc: number, e: any) => acc + Number(e.miles || 0), 0)
codex
I’ve pinned down the main type coverage gaps. I’m grabbing the generated `oj_project_stats` view shape and one quick scan of OJ-specific actions so I can distinguish “missing entirely” from “covered, but stale/nullability differs.”
exec
/bin/zsh -lc "sed -n '11180,11220p' src/types/database.generated.ts | nl -ba -v11180" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba src/app/actions/oj-projects/projects.ts | sed -n '100,150p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"from\\('oj_billing_runs'\\)|from\\('oj_entries'\\)|from\\('oj_vendor_billing_settings'\\)|from\\('oj_recurring_charge_instances'\\)|from\\('oj_project_stats'\\)\" src/app/actions src/app/api | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
   100	        id,
   101	        name
   102	      )
   103	    `)
   104	    .order('created_at', { ascending: false })
   105	
   106	  if (options?.vendorId) {
   107	    query = query.eq('vendor_id', options.vendorId)
   108	  }
   109	  if (options?.status && options.status !== 'all') {
   110	    query = query.eq('status', options.status)
   111	  }
   112	
   113	  const { data, error } = await query
   114	  if (error) return { error: error.message }
   115	
   116	  // Fetch stats for these projects
   117	  const projectIds = data?.map(p => p.id) || []
   118	  const statsMap = new Map<string, any>()
   119	
 succeeded in 51ms:
 11180	            columns: ["created_by"]
 11181	            isOneToOne: false
 11182	            referencedRelation: "admin_users_view"
 11183	            referencedColumns: ["id"]
 11184	          },
 11185	        ]
 11186	      }
 11187	      oj_project_stats: {
 11188	        Row: {
 11189	          project_id: string | null
 11190	          total_hours_used: number | null
 11191	          total_spend_ex_vat: number | null
 11192	        }
 11193	        Relationships: [
 11194	          {
 11195	            foreignKeyName: "oj_entries_project_id_fkey"
 11196	            columns: ["project_id"]
 11197	            isOneToOne: false
 11198	            referencedRelation: "oj_projects"
 11199	            referencedColumns: ["id"]
 succeeded in 52ms:
src/app/actions/invoices.ts:449:          .from('oj_entries')
src/app/actions/invoices.ts:453:          .from('oj_recurring_charge_instances')
src/app/actions/oj-projects/vendor-settings.ts:25:    .from('oj_vendor_billing_settings')
src/app/actions/oj-projects/vendor-settings.ts:64:    .from('oj_vendor_billing_settings')
src/app/actions/oj-projects/client-balance.ts:65:    .from('oj_entries')
src/app/actions/oj-projects/client-balance.ts:91:    .from('oj_recurring_charge_instances')
src/app/actions/oj-projects/projects.ts:59:      .from('oj_vendor_billing_settings')
src/app/actions/oj-projects/projects.ts:122:      .from('oj_project_stats')
src/app/actions/oj-projects/projects.ts:277:    .from('oj_entries')
src/app/actions/oj-projects/entries.ts:58:    .from('oj_vendor_billing_settings')
src/app/actions/oj-projects/entries.ts:118:    .from('oj_entries')
src/app/actions/oj-projects/entries.ts:184:    .from('oj_entries')
src/app/actions/oj-projects/entries.ts:252:    .from('oj_entries')
src/app/actions/oj-projects/entries.ts:320:    .from('oj_entries')
src/app/actions/oj-projects/entries.ts:384:    .from('oj_entries')
src/app/actions/oj-projects/entries.ts:416:      .from('oj_entries')
src/app/actions/oj-projects/entries.ts:467:      .from('oj_entries')
src/app/actions/oj-projects/entries.ts:511:    .from('oj_entries')
src/app/actions/oj-projects/entries.ts:570:    .from('oj_entries')
src/app/actions/oj-projects/entries.ts:579:    .from('oj_entries')
exec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-retainer-projects/route.ts | sed -n '1,240p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"retainer_included_hours_per_month|is_retainer|retainer_period_yyyymm|budget_hours\" src/app src/services supabase/migrations | sed -n '1,240p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
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
 succeeded in 51ms:
supabase/migrations/20260120130000_oj_projects_core.sql:40:  retainer_included_hours_per_month numeric(12,2),
supabase/migrations/20260121123000_fix_retainer_check.sql:8:    is_retainer = false
supabase/migrations/20260121123000_fix_retainer_check.sql:10:      retainer_period_yyyymm IS NOT NULL
supabase/migrations/20260121123000_fix_retainer_check.sql:11:      AND retainer_period_yyyymm ~ '^[0-9]{4}-[0-9]{2}$'
supabase/migrations/20260121120000_oj_retainer_projects.sql:5:  ADD COLUMN IF NOT EXISTS is_retainer boolean NOT NULL DEFAULT false,
supabase/migrations/20260121120000_oj_retainer_projects.sql:6:  ADD COLUMN IF NOT EXISTS retainer_period_yyyymm text,
supabase/migrations/20260121120000_oj_retainer_projects.sql:7:  ADD COLUMN IF NOT EXISTS budget_hours numeric(12,2);
supabase/migrations/20260121120000_oj_retainer_projects.sql:16:    is_retainer = false
supabase/migrations/20260121120000_oj_retainer_projects.sql:18:      retainer_period_yyyymm IS NOT NULL
supabase/migrations/20260121120000_oj_retainer_projects.sql:19:      AND retainer_period_yyyymm ~ '^\\d{4}-\\d{2}$'
supabase/migrations/20260121120000_oj_retainer_projects.sql:25:ON public.oj_projects (vendor_id, retainer_period_yyyymm)
supabase/migrations/20260121120000_oj_retainer_projects.sql:26:WHERE is_retainer = true;
supabase/migrations/20260121120000_oj_retainer_projects.sql:29:ON public.oj_projects (vendor_id, is_retainer, retainer_period_yyyymm);
src/app/api/cron/oj-projects-retainer-projects/route.ts:100:    .select('vendor_id, retainer_included_hours_per_month')
src/app/api/cron/oj-projects-retainer-projects/route.ts:101:    .gt('retainer_included_hours_per_month', 0)
src/app/api/cron/oj-projects-retainer-projects/route.ts:150:    const hours = Number(row?.retainer_included_hours_per_month || 0)
src/app/api/cron/oj-projects-retainer-projects/route.ts:157:        .eq('is_retainer', true)
src/app/api/cron/oj-projects-retainer-projects/route.ts:158:        .eq('retainer_period_yyyymm', periodYyyymm)
src/app/api/cron/oj-projects-retainer-projects/route.ts:190:          budget_hours: Number.isFinite(hours) && hours > 0 ? hours : null,
src/app/api/cron/oj-projects-retainer-projects/route.ts:192:          is_retainer: true,
exec
/bin/zsh -lc "rg -n \"function deriveClientCode|deriveClientCode\\(\" 'src/app/actions/oj-projects/projects.ts' 'src/app/api/cron/oj-projects-retainer-projects/route.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
src/app/actions/oj-projects/projects.ts:27:function deriveClientCode(vendorName: string) {
src/app/actions/oj-projects/projects.ts:74:    clientCode = deriveClientCode(String(vendor?.name || 'CLIENT'))
src/app/api/cron/oj-projects-retainer-projects/route.ts:12:function deriveClientCode(vendorName: string) {
src/app/api/cron/oj-projects-retainer-projects/route.ts:61:    clientCode = deriveClientCode(String(vendor?.name || 'CLIENT'))
exec
/bin/zsh -lc "rg -n \"getProjectPaymentHistory|payment history|invoice_payments|oj_entries.*invoice_id\" 'src/app/actions/oj-projects' 'src/app/(authenticated)/oj-projects/projects/[id]/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools exited 1 in 52ms:

exec
/bin/zsh -lc "rg -n \"OJ_PROJECTS_BILLING_ALERT_EMAIL|billing alert|zero-vendor|admin email|sendEmail\\(\" 'src/app/api/cron/oj-projects-billing/route.ts' 'src/lib'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
src/lib/table-bookings/charge-approvals.ts:280:  const emailResult = await sendEmail({
src/lib/parking/payments.ts:560:    const emailResult = await sendEmail({ to: managerEmail.to, subject: managerEmail.subject, html: managerEmail.html })
src/lib/table-bookings/bookings.ts:362:  const emailResult = await sendEmail({
src/lib/private-bookings/manager-notifications.ts:193:  const result = await sendEmail({
src/lib/private-bookings/manager-notifications.ts:365:  const result = await sendEmail({
src/lib/private-bookings/feedback.ts:288:    result = await sendEmail({
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
src/lib/rota/send-rota-emails.ts:103:      const emailResult = await sendEmail({
src/lib/rota/send-rota-emails.ts:281:      const emailResult = await sendEmail({
exec
/bin/zsh -lc "rg -n \"client-statement|getClientStatement|Account Statement|statement-\" 'src/app/actions/oj-projects' 'src/lib' 'src/app/(authenticated)/oj-projects/clients/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools exited 1 in 52ms:

exec
/bin/zsh -lc "nl -ba src/app/api/cron/oj-projects-billing/route.ts | sed -n '1888,1912p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"loadInvoiceWithDetails\\(|InvoiceWithDetails\" src/app/api/cron/oj-projects-billing/route.ts src/app/actions/invoices.ts | sed -n '1,120p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
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
 succeeded in 52ms:
src/app/actions/invoices.ts:13:  InvoiceWithDetails,
src/app/actions/invoices.ts:120:  let invoice: InvoiceWithDetails
src/app/api/cron/oj-projects-billing/route.ts:9:import type { InvoiceWithDetails } from '@/types/invoices'
src/app/api/cron/oj-projects-billing/route.ts:1891:async function loadInvoiceWithDetails(supabase: ReturnType<typeof createAdminClient>, invoiceId: string) {
src/app/api/cron/oj-projects-billing/route.ts:1906:  return { invoice: data as InvoiceWithDetails }
src/app/api/cron/oj-projects-billing/route.ts:2165:        const loaded = await loadInvoiceWithDetails(supabase, billingRun.invoice_id)
src/app/api/cron/oj-projects-billing/route.ts:3108:      const fullInvoiceRes = await loadInvoiceWithDetails(supabase, invoiceId)
exec
/bin/zsh -lc "rg -n \"voidInvoice|credit note|credit_notes|documentKind: 'credit_note'|credit_note\" 'src/app/actions/invoices.ts' 'src/lib' 'src/types' 'supabase/migrations'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
supabase/migrations/20251123120000_squashed.sql:12050:    CONSTRAINT invoice_emails_email_type_check CHECK (((email_type)::text = ANY ((ARRAY['new_invoice'::character varying, 'reminder'::character varying, 'chase'::character varying, 'credit_note'::character varying, 'statement'::character varying, 'quote'::character varying])::text[]))),
exec
/bin/zsh -lc "rg -n \"billing-preview\" 'src/app/api' 'src/app/(authenticated)/oj-projects/clients/page.tsx'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
src/app/(authenticated)/oj-projects/clients/page.tsx:331:      const res = await fetch(`/api/oj-projects/billing-preview?vendor_id=${vendorId}`)
exec
/bin/zsh -lc "rg --files 'src/app/api' | rg 'oj-projects/.+preview|billing-preview|oj-projects-billing'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
src/app/api/cron/oj-projects-billing/route.ts
src/app/api/cron/oj-projects-billing/__tests__/invoice-notes.test.ts
src/app/api/cron/oj-projects-billing-reminders/route.ts
src/app/api/oj-projects/billing-preview/route.ts
exec
/bin/zsh -lc "sed -n '1,220p' 'src/app/api/oj-projects/billing-preview/route.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
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
codex
Only inspected [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:1928).

**Main GET Flow**
- `GET` (`~1928-3434`) authorizes the cron request, parses `force`, `preview`, `dry_run`, and optional `vendor_id`, and skips unless it is the 1st day in `Europe/London` unless `force=true`.
- It bills the previous London month via `getPreviousMonthPeriod` (`~220-232`) and uses today’s London date as `invoice_date`.
- Vendor processing is per-vendor, sequential, with a summary response: `processed`, `sent`, `skipped`, `failed`.
- For each vendor it loads the vendor row, creates or reuses an `oj_billing_runs` row for `(vendor_id, period_yyyymm)`, and uses that run as the idempotency anchor.

**Preview vs Live**
- There are really two preview modes:
- `dry_run=true` uses `buildDryRunPreview` (`~1300-1660`). This is the true non-mutating preview: no billing run insert, no row locking, no invoice creation, and partial splits run with `persist:false`.
- `preview=true` still goes through the live path in `GET`. If an invoice already exists for the run, it skips sending. If no invoice exists, it will create the draft invoice, persist `billingRun.invoice_id`, and then stop before email send (`~3088-3091`).
- So `preview=true` is mutating. It is not equivalent to `dry_run=true`.

**Vendor Selection**
- If `vendor_id` is passed, only that vendor is processed (`~1953-1955`).
- Otherwise vendors are collected into a `Set` from four sources (`~1956-2015`):
- `oj_entries`: `status='unbilled'`, `billable=true`, `entry_date <= period_end`
- `oj_vendor_recurring_charges`: `is_active=true`
- `oj_recurring_charge_instances`: `status='unbilled'`, `period_end <= period_end`
- `oj_billing_runs`: failed runs for the target period
- Each source is capped at `limit(10000)`.

**Loading and Locking Entries / Recurring Charges**
- Billing settings load from `oj_vendor_billing_settings` (`~2635-2645`).
- Active recurring definitions are loaded, then current-period instances are upserted idempotently into `oj_recurring_charge_instances` (`~2646-2678`).
- Eligible recurring instances are then loaded as all unbilled instances up to the period end, ordered oldest-first (`~2680-2692`).
- Eligible entries are loaded from `oj_entries` as unbilled, billable entries up to period end, ordered by `entry_date` then `created_at` (`~2694-2718`).
- After selection, `lockRowsForBillingRunOrThrow` (`~129-169`) flips selected rows from `unbilled` to `billing_pending` and sets `billing_run_id`. It requires an exact row count match, so it doubles as an optimistic concurrency check.
- If a run has no `invoice_id` but already has `billing_pending` rows, those stranded rows are unlocked back to `unbilled` before rebuilding (`~2588-2633`).

**Cap Mode / Statement Mode**
- `billing_mode` is `'cap'` or `'full'`; `statement_mode` is a boolean (`~2642-2644`).
- In full mode, everything eligible is selected.
- In cap mode, selection is greedy and ordered: recurring instances, then one-off entries, then mileage, then time (`~2749-2781`). `runningIncVat` tracks the cap at invoice-inc-VAT level.
- `applyPartialSplit` (`~926-977`) then tries one partial fill for remaining headroom, in priority order: recurring, then mileage, then time.
- `statement_mode` changes invoice construction:
- `buildStatementLineItems` (`~1117-1179`) collapses everything into VAT-grouped “Account balance payment” lines.
- `buildStatementNotes` (`~1662-1889`) builds an account-balance summary and payment projection.
- In `statement_mode + cap`, `computeStatementBalanceBefore` (`~979-1043`) calculates outstanding balance before billing, and `applyStatementCapTopUp` (`~1045-1115`) adjusts line items so the invoice total lands on `min(balanceBefore, cap)`.

**Partial Split Behavior**
- `splitRecurringInstanceForCap` (`~640-736`) reduces the selected instance amount and inserts a new remainder instance with a synthetic split period like `YYYY-MM-S1`.
- `splitMileageEntryForCap` (`~738-819`) reduces miles on the selected row and inserts a remainder entry.
- `splitTimeEntryForCap` (`~821-924`) only works if `start_at` and `end_at` exist and parse cleanly. It splits rounded minutes in 15-minute blocks, then proportionally splits raw minutes and timestamps.
- There is no partial split for one-off entries.

**Invoice Creation / Email / Linking**
- Line items come from `buildDetailedLineItems` (`~1181-1298`) unless `statement_mode` is on.
- Notes come from `buildInvoiceNotes` (`~235-427`) or `buildStatementNotes`. Non-statement mode attaches a timesheet PDF if notes exceed `OJ_INVOICE_NOTES_MAX_CHARS` (`~22`, `~3026-3030`).
- Invoice number comes from RPC `get_and_increment_invoice_series` (`~2957-2965`).
- Invoice creation is via RPC `create_invoice_transaction` with draft status (`~3049-3053`).
- After create, the run is linked to `invoice_id` (`~3083-3086`).
- Email send uses `loadInvoiceWithDetails` (`~1891-1907`), recipient resolution, optional timesheet attachment, then `sendInvoiceEmail`, then invoice `status` is moved `draft -> sent`, email logs are inserted, locked rows are marked `billed`, and the run becomes `sent` (`~3108-3415`).
- If the invoice already exists and is already `sent`/`paid`/`overdue`/`partially_paid`, the code skips re-sending and just reconciles `billing_pending` rows to `billed` or `paid` (`~2203-2238`).

**Idempotency / Recovery / Error Handling**
- Billing-run idempotency is “insert or load existing run” on `(vendor_id, period_yyyymm)` (`~2089-2124`).
- If `billingRun.invoice_id` is missing, it tries to recover an orphaned invoice by matching vendor, `reference = OJ Projects YYYY-MM`, and `internal_notes` containing the run id (`~2132-2160`).
- Email send idempotency is per invoice via `buildOjInvoiceSendClaimParams` (`~1909-1926`) and `claimIdempotencyKey` (`~2320-2359`, `~3151-3190`).
- `conflict` marks the run failed; `in_progress` skips; `replay` skips actual sending but continues reconciliation/finalization.
- If send fails, the idempotency claim is released and the run is marked failed.
- If invoice creation fails, selected locked rows are explicitly unlocked back to `unbilled` using `updateSelectedRowsByIdsOrThrow` (`~171-218`, `~3054-3079`).
- If email config or recipient info is missing after invoice creation, the draft invoice and `billing_pending` locks are intentionally left in place for retry (`~3094-3124`).
- Outer `catch` marks the period run failed for that vendor (`~3416-3429`).

**Notable Risks**
- `preview=true` is mutating and can create draft invoices and leave rows `billing_pending`. That is the biggest behavioral trap.
- Statement notes appear incomplete for one-off charges: `buildStatementNotes` does not include current unbilled one-offs at all, and its billed-entry query does not select `amount_ex_vat_snapshot`, so billed one-offs likely contribute `0` in the balance narrative.
- Partial split is not transactional with selection/locking. Split mutations happen before row locks, so concurrent runs could race.
- One-off entries cannot be partially split; time entries also cannot split without valid `start_at`/`end_at`. Cap headroom can go unused.
- Multiple queries use `limit(10000)` with no pagination, so large datasets can be silently truncated.
- `applyStatementCapTopUp` uses a single configured VAT rate for the top-up line, which can skew VAT composition relative to the underlying outstanding mix.
collab wait(call_Uc4wkrR8JMwnSndT9i9zAKSx)
  receivers: 019d8b1d-b0c7-7622-8c5d-ce8ec8506d3b, 019d8b1d-b0df-7d51-90c2-b64662dfadc5
wait(call_Uc4wkrR8JMwnSndT9i9zAKSx) 1 agents complete:
  019d8b1d-b0c7-7622-8c5d-ce8ec8506d3b completed: "Only inspected [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route…"
collab wait(call_BNKEmDZCgelosDa16PUfEh4l)
  receivers: 019d8b1d-b0df-7d51-90c2-b64662dfadc5
codex
There’s one non-`oj*` schema dependency worth checking directly: the mileage sync trigger writes into `mileage_trips`. I’m reading that migration so I can say whether the trigger is backed by an FK/uniqueness guarantee or just a convention.
exec
/bin/zsh -lc "nl -ba supabase/migrations/20260405130000_mileage_expenses_mgd.sql | sed -n '70,120p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "rg -n \"oj_entry_id|source IN \\('manual', 'oj_projects'\\)|UNIQUE.*oj_entry_id|mileage_trips\" supabase/migrations/20260405130000_mileage_expenses_mgd.sql supabase/migrations/* | sed -n '1,200p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
    70	
    71	-- -------------------------------------------------------
    72	-- Mileage: Trips
    73	-- -------------------------------------------------------
    74	CREATE TABLE public.mileage_trips (
    75	  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    76	  trip_date DATE NOT NULL,
    77	  description TEXT,
    78	  total_miles NUMERIC(8,1) NOT NULL CHECK (total_miles > 0),
    79	  miles_at_standard_rate NUMERIC(8,1) NOT NULL DEFAULT 0 CHECK (miles_at_standard_rate >= 0),
    80	  miles_at_reduced_rate NUMERIC(8,1) NOT NULL DEFAULT 0 CHECK (miles_at_reduced_rate >= 0),
    81	  amount_due NUMERIC(10,2) NOT NULL CHECK (amount_due >= 0),
    82	  source TEXT NOT NULL CHECK (source IN ('manual', 'oj_projects')),
    83	  oj_entry_id UUID REFERENCES public.oj_entries(id) ON DELETE SET NULL,
    84	  created_by UUID REFERENCES auth.users(id),
    85	  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    86	  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    87	  CONSTRAINT chk_miles_split CHECK (total_miles = miles_at_standard_rate + miles_at_reduced_rate),
    88	  CONSTRAINT uq_oj_entry UNIQUE (oj_entry_id)
    89	);
 succeeded in 51ms:
Total output lines: 181

supabase/migrations/20260405130000_mileage_expenses_mgd.sql:74:CREATE TABLE public.mileage_trips (
supabase/migrations/20260405130000_mileage_expenses_mgd.sql:82:  source TEXT NOT NULL CHECK (source IN ('manual', 'oj_projects')),
supabase/migrations/20260405130000_mileage_expenses_mgd.sql:83:  oj_entry_id UUID REFERENCES public.oj_entries(id) ON DELETE SET NULL,
supabase/migrations/20260405130000_mileage_expenses_mgd.sql:88:  CONSTRAINT uq_oj_entry UNIQUE (oj_entry_id)
supabase/migrations/20260405130000_mileage_expenses_mgd.sql:91:CREATE INDEX idx_mileage_trips_date ON public.mileage_trips (trip_date DESC);
supabase/migrations/20260405130000_mileage_expenses_mgd.sql:92:CREATE INDEX idx_mileage_trips_source ON public.mileage_trips (source);
supabase/migrations/20260405130000_mileage_expenses_mgd.sql:94:ALTER TABLE public.mileage_trips ENABLE ROW LEVEL SECURITY;
supabase/migrations/20260405130000_mileage_expenses_mgd.sql:96:CREATE POLICY "super_admin_all" ON public.mileage_trips
supabase/migrations/20260405130000_mileage_expenses_mgd.sql:104:  trip_id UUID NOT NULL REFERENCES public.mileage_trips(id) ON DELETE CASCADE,
supabase/migrations/20260405130000_mileage_expenses_mgd.sql:227:      'mileage_trips',
supabase/migrations/20260405130000_mileage_expenses_mgd.sql:74:CREATE TABLE public.mileage_trips (
supabase/migrations/20260405130000_mileage_expenses_mgd.sql:82:  source TEXT NOT NULL CHECK (source IN ('manual', 'oj_projects')),
supabase/migrations/20260405130000_mileage_expenses_mgd.sql:83:  oj_entry_id UUID REFERENCES public.oj_entries(id) ON DELETE SET NULL,
supabase/migrations/20260405130000_mileage_expenses_mgd.sql:88:  CONSTRAINT uq_oj_entry UNIQUE (oj_entry_id)
supabase/migrations/20260405130000_mileage_expenses_mgd.sql:91:CREATE INDEX idx_mileage_trips_date ON public.mileage_trips (trip_date DESC);
supabase/migrations/20260405130000_mileage_expenses_mgd.sql:92:CREATE INDEX idx_mileage_trips_source ON public.mileage_trips (source);
supabase/migrations/20260405130000_mileage_expenses_mgd.sql:94:ALTER TABLE public.mileage_trips ENABLE ROW LEVEL SECURITY;
supabase/migrations/20260405130000_mileage_expenses_mgd.sql:96:CREATE POLICY "super_admin_all" ON public.mileage_trips
wait(call_BNKEmDZCgelosDa16PUfEh4l) timed out:
codex
I’ve got the cron path and most of the app/action surfaces mapped. I’m doing one last pass on schema/type mismatches and the invoice/remittance edges so the report can call out what’s actually encoded versus what the spec proposes.
collab wait(call_bNJ3UqiguZy1jm1E8aped46G)
  receivers: 019d8b1d-b0df-7d51-90c2-b64662dfadc5
codex
One last check on the remittance side: I’m verifying whether the invoice/vendoring types cover the recipient fields the payment/remittance flow actually uses, or whether some of that lives in tables the manual types ignore.
exec
/bin/zsh -lc "rg -n \"invoice_cc|cc_emails|resolveInvoiceRecipientsForVendor|resolveVendorInvoiceRecipients|invoice_vendor_contacts|primary contact|vendor email\" src supabase/migrations/20260120131000_invoice_vendor_contacts_invoice_cc.sql supabase/migrations/20250912_add_invoice_vendor_contacts.sql | sed -n '1,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba supabase/migrations/20250912_add_invoice_vendor_contacts.sql | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc 'nl -ba supabase/migrations/20260120131000_invoice_vendor_contacts_invoice_cc.sql' in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
supabase/migrations/20250912_add_invoice_vendor_contacts.sql:1:-- Placeholder for 20250912_add_invoice_vendor_contacts.sql
supabase/migrations/20250912_add_invoice_vendor_contacts.sql:3:-- Original file stored at supabase/migrations-archive/pre-squash-20251123/20250912_add_invoice_vendor_contacts.sql
supabase/migrations/20260120131000_invoice_vendor_contacts_invoice_cc.sql:3:ALTER TABLE public.invoice_vendor_contacts
supabase/migrations/20260120131000_invoice_vendor_contacts_invoice_cc.sql:9:CREATE INDEX IF NOT EXISTS idx_invoice_vendor_contacts_receive_invoice_copy
supabase/migrations/20260120131000_invoice_vendor_contacts_invoice_cc.sql:10:ON public.invoice_vendor_contacts(vendor_id, receive_invoice_copy)
src/types/database.generated.ts:3455:          bcc_emails: string[] | null
src/types/database.generated.ts:3457:          cc_emails: string[] | null
src/types/database.generated.ts:3472:          bcc_emails?: string[] | null
src/types/database.generated.ts:3474:          cc_emails?: string[] | null
src/types/database.generated.ts:3489:          bcc_emails?: string[] | null
src/types/database.generated.ts:3491:          cc_emails?: string[] | null
src/types/database.generated.ts:3672:      invoice_vendor_contacts: {
src/types/database.generated.ts:3708:            foreignKeyName: "invoice_vendor_contacts_vendor_id_fkey"
src/types/database.generated.ts:6059:            referencedRelation: "invoice_vendor_contacts"
src/app/api/cron/auto-send-invoices/route.ts:132:      // Prefer primary contact email if available
src/app/api/cron/auto-send-invoices/route.ts:136:          .from('invoice_vendor_contacts')
src/app/api/cron/oj-projects-billing/route.ts:6:import { resolveVendorInvoiceRecipients } from '@/lib/invoice-recipients'
src/app/api/cron/oj-projects-billing/route.ts:2199:        const recipients = await resolveVendorInvoiceRecipients(supabase, vendorId, vendor.email)
src/app/api/cron/oj-projects-billing/route.ts:2201:        if (!recipients.to) throw new Error('No invoice recipient email configured (primary contact or vendor email)')
src/app/api/cron/oj-projects-billing/route.ts:3112:      const recipients = await resolveVendorInvoiceRecipients(supabase, vendorId, vendor.email)
 succeeded in 51ms:
     1	-- Placeholder for 20250912_add_invoice_vendor_contacts.sql
     2	-- This migration was squashed into 20251123120000_squashed.sql
     3	-- Original file stored at supabase/migrations-archive/pre-squash-20251123/20250912_add_invoice_vendor_contacts.sql
 succeeded in 51ms:
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
wait(call_bNJ3UqiguZy1jm1E8aped46G) timed out:
exec
/bin/zsh -lc "nl -ba src/lib/invoice-recipients.ts | sed -n '1,160p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "sed -n '3668,3716p' src/types/database.generated.ts | nl -ba -v3668" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
  3668	          series_code?: string
  3669	        }
  3670	        Relationships: []
  3671	      }
  3672	      invoice_vendor_contacts: {
  3673	        Row: {
  3674	          created_at: string
  3675	          email: string
  3676	          id: string
  3677	          is_primary: boolean
  3678	          name: string | null
  3679	          phone: string | null
  3680	          receive_invoice_copy: boolean
  3681	          role: string | null
  3682	          vendor_id: string
  3683	        }
  3684	        Insert: {
  3685	          created_at?: string
  3686	          email: string
  3687	          id?: string
 succeeded in 52ms:
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
exec
/bin/zsh -lc "rg -n \"invoice_email_logs|CREATE TABLE.*invoice_email_logs|email_type|metadata\" 'supabase/migrations' 'src/types/invoices.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
supabase/migrations/20260420000008_event_seat_increase_runtime.sql:132:    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
supabase/migrations/20260420000008_event_seat_increase_runtime.sql:151:      metadata,
supabase/migrations/20260411000000_hiring_m0_schema.sql:108:  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
supabase/migrations/20260411000000_hiring_m0_schema.sql:136:  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
supabase/migrations/20260411000000_hiring_m0_schema.sql:158:  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
supabase/migrations/20260420000013_charge_approval_runtime.sql:53:    cr.metadata,
supabase/migrations/20260420000013_charge_approval_runtime.sql:126:    'metadata', COALESCE(v_charge.metadata, '{}'::jsonb),
supabase/migrations/20260420000013_charge_approval_runtime.sql:216:    cr.metadata,
supabase/migrations/20260420000013_charge_approval_runtime.sql:275:      cr.metadata,
supabase/migrations/20260420000013_charge_approval_runtime.sql:296:      cr.metadata,
supabase/migrations/20260420000013_charge_approval_runtime.sql:343:    'metadata', COALESCE(v_charge.metadata, '{}'::jsonb),
supabase/migrations/20260321000005_fix_analytics_v2_column_types.sql:19:  metadata jsonb,
supabase/migrations/20260321000005_fix_analytics_v2_column_types.sql:71:      sl.metadata as link_metadata,
supabase/migrations/20260321000005_fix_analytics_v2_column_types.sql:82:             sl.name, sl.parent_link_id, sl.metadata, sl.created_at
supabase/migrations/20260321000005_fix_analytics_v2_column_types.sql:103:      lt.link_metadata,
supabase/migrations/20260321000005_fix_analytics_v2_column_types.sql:122:    plb.link_metadata as metadata,
supabase/migrations/20260321000005_fix_analytics_v2_column_types.sql:130:           plb.link_name, plb.link_parent_id, plb.link_metadata, plb.link_created_at
supabase/migrations/20260420000006_event_payment_runtime.sql:50:    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
supabase/migrations/20260420000006_event_payment_runtime.sql:68:      metadata,
supabase/migrations/20260302000002_fix_deposit_payment_confirmed_bookings.sql:57:    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
exec
/bin/zsh -lc "sed -n '12006,12035p' 'supabase/migrations/20251123120000_squashed.sql'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
CREATE TABLE IF NOT EXISTS public.invoice_email_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid,
    quote_id uuid,
    sent_at timestamp with time zone DEFAULT now(),
    sent_to character varying(255),
    sent_by character varying(255),
    subject text,
    body text,
    status character varying(20),
    error_message text,
    message_id character varying(255),
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT chk_one_reference CHECK (((invoice_id IS NOT NULL) AND (quote_id IS NULL)) OR ((invoice_id IS NULL) AND (quote_id IS NOT NULL))),
    CONSTRAINT invoice_email_logs_status_check CHECK (((status)::text = ANY ((ARRAY['sent'::character varying, 'failed'::character varying, 'bounced'::character varying])::text[])))
);

CREATE TABLE IF NOT EXISTS public.invoice_email_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_type character varying(50) NOT NULL,
codex
I have the substance. I’m pulling exact line references for the places where the current implementation diverges from the spec or encodes non-obvious constraints, then I’ll package the map by area.
exec
/bin/zsh -lc "nl -ba 'src/app/actions/oj-projects/client-balance.ts' | sed -n '1,180p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/oj-projects/projects/[id]/page.tsx' | sed -n '80,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'supabase/migrations/20260121130000_project_stats_view.sql' | sed -n '1,120p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'src/app/actions/invoices.ts' | sed -n '100,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'src/lib/invoice-template-compact.ts' | sed -n '560,610p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'src/lib/invoice-template-compact.ts' | sed -n '135,180p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'src/app/actions/invoices.ts' | sed -n '670,760p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
    80	  }, [permissionsLoading, canView, projectId])
    81	
    82	  async function load() {
    83	    setLoading(true)
    84	    setError(null)
    85	    try {
    86	      const projectRes = await getProject(projectId)
    87	      if (projectRes.error || !projectRes.project) throw new Error(projectRes.error || 'Failed to load project')
    88	
    89	      const vendorId = projectRes.project.vendor_id
    90	
    91	      const [contactsRes, entriesRes] = await Promise.all([
    92	        getVendorContacts(vendorId),
    93	        getEntries({ projectId, limit: 1000 }),
    94	      ])
    95	
    96	      if (contactsRes.error) throw new Error(contactsRes.error)
    97	      if (entriesRes.error) throw new Error(entriesRes.error)
    98	
    99	      setProject(projectRes.project)
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
   135	
   136	  const latestPayment = (invoice.payments || [])
   137	    .slice()
   138	    .sort((a, b) => {
   139	      const aDate = new Date(a.payment_date || a.created_at || 0).getTime()
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
 succeeded in 51ms:
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
   115	): Promise<RemittanceAdviceResult> {
   116	  if (!isGraphConfigured()) {
   117	    return { sent: false, skippedReason: 'email_not_configured' }
   118	  }
   119	
 succeeded in 51ms:
     1	-- Create a view to aggregate project usage stats
     2	CREATE OR REPLACE VIEW public.oj_project_stats AS
     3	SELECT
     4	  project_id,
     5	  -- Sum duration_minutes_rounded -> hours
     6	  COALESCE(SUM(duration_minutes_rounded) / 60.0, 0) as total_hours_used,
     7	  
     8	  -- Sum spend:
     9	  -- For time: duration * hourly_rate (from snapshot or setting)
    10	  -- For mileage: miles * mileage_rate (from snapshot)
    11	  COALESCE(
    12	    SUM(
    13	      CASE 
    14	        WHEN entry_type = 'time' THEN 
    15	          (duration_minutes_rounded / 60.0) * COALESCE(hourly_rate_ex_vat_snapshot, 0)
    16	        WHEN entry_type = 'mileage' THEN
    17	          miles * COALESCE(mileage_rate_snapshot, 0)
    18	        ELSE 0
    19	      END
    20	    ), 
 succeeded in 51ms:
   560	        </div>
   561	        <div class="summary-row total">
   562	          <span>Outstanding Balance</span>
   563	          <span>${formatCurrency(outstandingBalance)}</span>
   564	        </div>
   565	      ` : `
   566	        <div class="summary-row total">
   567	          <span>Total Due</span>
   568	          <span>${formatCurrency(invoice.total_amount)}</span>
   569	        </div>
   570	      `}
   571	    </div>
   572	  </div>
   573	
   574	  ${isRemittanceAdvice ? `
   575	    <div class="payment-section keep-together">
   576	      <h3>Receipt Details</h3>
   577	      <div class="payment-grid">
   578	        <div class="payment-method">
   579	          <h4>Payment Summary</h4>
 succeeded in 50ms:
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
exec
/bin/zsh -lc "nl -ba 'src/types/oj-projects.ts' | sed -n '1,160p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'src/types/invoices.ts' | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'src/app/actions/oj-projects/entries.ts' | sed -n '1,380p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'src/app/actions/oj-projects/projects.ts' | sed -n '1,180p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'src/app/actions/oj-projects/vendor-settings.ts' | sed -n '1,160p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
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
/bin/zsh -lc "nl -ba 'src/app/actions/oj-projects/work-types.ts' | sed -n '1,180p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'src/app/actions/oj-projects/project-contacts.ts' | sed -n '1,180p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
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
 succeeded in 50ms:
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
     5	import { logAuditEvent } from '@/app/actions/audit'
     6	import { z } from 'zod'
     7	
     8	const WorkTypeSchema = z.object({
     9	  name: z.string().min(1, 'Work type name is required').max(80, 'Work type name is too long'),
    10	  sort_order: z.coerce.number().int().min(0).max(1000).optional(),
    11	  is_active: z.coerce.boolean().optional(),
    12	})
    13	
    14	export async function getWorkTypes() {
    15	  const hasPermission = await checkUserPermission('oj_projects', 'view')
    16	  if (!hasPermission) return { error: 'You do not have permission to view work types' }
    17	
    18	  const supabase = await createClient()
    19	  const { data, error } = await supabase
    20	    .from('oj_work_types')
 succeeded in 52ms:
     1	'use server'
     2	
     3	import { createClient } from '@/lib/supabase/server'
     4	import { checkUserPermission } from '@/app/actions/rbac'
     5	import { logAuditEvent } from '@/app/actions/audit'
     6	import { z } from 'zod'
     7	
     8	const ProjectContactSchema = z.object({
     9	  project_id: z.string().uuid('Invalid project ID'),
    10	  contact_id: z.string().uuid('Invalid contact ID'),
    11	})
    12	
    13	export async function getProjectContacts(projectId: string) {
    14	  const hasPermission = await checkUserPermission('oj_projects', 'view')
    15	  if (!hasPermission) return { error: 'You do not have permission to view project contacts' }
    16	
    17	  const supabase = await createClient()
    18	  const { data, error } = await supabase
    19	    .from('oj_project_contacts')
    20	    .select(`
codex
**History**
- January 20, 2026: the core OJ schema landed in [20260120130000_oj_projects_core.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260120130000_oj_projects_core.sql:22). It created `oj_work_types`, `oj_vendor_billing_settings`, `oj_vendor_recurring_charges`, `oj_projects`, `oj_project_contacts`, `oj_billing_runs`, and `oj_entries`, plus RLS, RBAC policies/grants, indexes, a unique `(vendor_id, period_yyyymm)` on billing runs, and an invoice-paid trigger that marks linked OJ entries as `paid`.
- January 20, 2026: permissions were also inserted into the newer RBAC tables in [20260120132000_add_oj_projects_permissions.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260120132000_add_oj_projects_permissions.sql:1).
- January 21, 2026: recurring-charge carry-forward support arrived in [20260121100000_oj_recurring_charge_instances.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260121100000_oj_recurring_charge_instances.sql:4) via `oj_recurring_charge_instances`, with status lifecycle, invoice/billing-run links, a uniqueness constraint on `(vendor_id, recurring_charge_id, period_yyyymm)`, and an expanded invoice-paid trigger that also marks recurring instances `paid`.
- January 21, 2026: retainer support arrived in [20260121120000_oj_retainer_projects.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260121120000_oj_retainer_projects.sql:4), adding `is_retainer`, `retainer_period_yyyymm`, and `budget_hours` to `oj_projects`, plus “one retainer project per vendor per month”; the regex check was hardened in [20260121123000_fix_retainer_check.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260121123000_fix_retainer_check.sql:2).
- January 21, 2026: the view [20260121130000_project_stats_view.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260121130000_project_stats_view.sql:2) added `oj_project_stats`, aggregating hours and spend from `oj_entries`.
- February 3, 2026: [20260203090000_add_statement_mode_to_oj_vendor_billing_settings.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260203090000_add_statement_mode_to_oj_vendor_billing_settings.sql:1) added `statement_mode boolean not null default false` to vendor billing settings.
- February 26, 2026: [20260226120000_oj_entries_one_off.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260226120000_oj_entries_one_off.sql:5) added `one_off` entries and `amount_ex_vat_snapshot`, and updated entry-type/check constraints accordingly.
- April 5, 2026: [20260405130001_update_oj_mileage_rate.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260405130001_update_oj_mileage_rate.sql:1) backfilled mileage rate from `0.42` to `0.45`. The related mileage module in [20260405130000_mileage_expenses_mgd.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260405130000_mileage_expenses_mgd.sql:74) created `mileage_trips` with `oj_entry_id` and a unique 1:1 constraint, and [20260405130002_oj_mileage_sync_trigger.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260405130002_oj_mileage_sync_trigger.sql:17) synced OJ mileage entries into it.
- May 12, 2026: [20260512000000_oj_entries_relax_time_constraint.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql:9) relaxed time-entry validation so `duration_minutes_rounded` is required but `start_at`/`end_at` may both be null.

**Type Coverage**
- [src/types/oj-projects.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/oj-projects.ts:1) covers `oj_work_types`, `oj_vendor_billing_settings`, `oj_vendor_recurring_charges`, `oj_projects`, `oj_project_contacts`, `oj_entries`, and `oj_billing_runs`. It does not cover `oj_recurring_charge_instances`, `oj_project_stats`, or the mileage sync tables. I also did not find it imported anywhere under `src`, so it looks effectively unused.
- `OJVendorBillingSettings.statement_mode` is typed as `boolean | null` in [src/types/oj-projects.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/oj-projects.ts:15), but the DB is now non-nullable boolean in [database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:6219).
- `OJBillingRun.selected_entry_ids` is `any` in [src/types/oj-projects.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/oj-projects.ts:96), while the DB shape is `Json | null` in [database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:5880).
- [src/types/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/invoices.ts:1) is actively used, but it is more optimistic than the DB. In [database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:3761), many `invoices` fields are nullable that the manual type treats as required; the same applies to `invoice_vendors`, `invoice_line_items`, `invoice_payments`, and `invoice_email_logs`.
- `invoice_email_logs` is under-modeled for remittance/audit: [src/types/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/invoices.ts:175) omits DB fields like `message_id` and `quote_id` present in [database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:3359).
- Billing/remittance recipient resolution depends on `invoice_vendor_contacts.receive_invoice_copy`, but `src/types/invoices.ts` has no type for `invoice_vendor_contacts`; the DB does in [database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts:3672), and the runtime uses it in [src/lib/invoice-recipients.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-recipients.ts:43).

**Risks**
- [src/app/actions/oj-projects/client-balance.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/client-balance.ts:63) ignores `one_off` entries completely. That entry type exists in the DB since February 26, 2026, so unbilled totals can be understated.
- The same balance function mixes gross and net. Unpaid invoice balance uses `total_amount - paid_amount` from `invoices` in [client-balance.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/client-balance.ts:52), but unbilled time/mileage/recurring totals are summed ex-VAT and ignore `vat_rate_snapshot` in [client-balance.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/client-balance.ts:63). The statement billing path computes inc-VAT balance in [oj-projects-billing/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:1020), so the two notions of “balance” disagree.
- The mileage fallback is stale. The DB backfilled default mileage to `0.45`, but [client-balance.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/client-balance.ts:84) still falls back to `0.42` when a snapshot is missing.
- Invoice matching is brittle and incomplete. [client-balance.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/client-balance.ts:40) finds OJ invoices by `reference ILIKE 'OJ Projects %'` and caps to 50 rows, instead of using `invoice_id`/`oj_billing_runs`. Old unpaid invoices or renamed references can drop out of the balance.
- The DB only has a forward trigger for `status -> paid` in [20260120130000_oj_projects_core.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260120130000_oj_projects_core.sql:154) and [20260121100000_oj_recurring_charge_instances.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260121100000_oj_recurring_charge_instances.sql:46). There is no reverse/unbill handling for `void` or `written_off`; the app warns about that explicitly in [src/app/actions/invoices.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:440).
- The schema has FK coverage, but not vendor-consistency coverage. `oj_entries`, `oj_billing_runs`, `oj_recurring_charge_instances`, and `oj_project_contacts` each link related rows independently, but nothing enforces that the linked project/invoice/billing run/contact belongs to the same `vendor_id`. That is a real billing/remittance integrity gap if bad data is inserted.
- `oj_project_stats` predates `one_off` and still only sums time and mileage in [20260121130000_project_stats_view.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260121130000_project_stats_view.sql:2), so project spend can diverge from what billing now considers billable.

The highest-signal issues for billing accuracy are the `client-balance` omissions/mixed VAT basis, the stale `0.42` fallback, and the lack of a reverse/unbill path when OJ-linked invoices are voided.
exec
/bin/zsh -lc "nl -ba 'supabase/migrations/20260120130000_oj_projects_core.sql' | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'supabase/migrations/20260121120000_oj_retainer_projects.sql' | sed -n '1,120p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'supabase/migrations/20260121100000_oj_recurring_charge_instances.sql' | sed -n '1,160p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql' | sed -n '1,120p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'supabase/migrations/20260226120000_oj_entries_one_off.sql' | sed -n '1,120p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/oj-projects/clients/page.tsx' | sed -n '120,260p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/oj-projects/clients/page.tsx' | sed -n '620,860p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
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
 succeeded in 52ms:
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
 succeeded in 52ms:
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
 succeeded in 52ms:
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
 succeeded in 50ms:
   120	
   121	  const [charges, setCharges] = useState<any[]>([])
   122	  const [contacts, setContacts] = useState<VendorContact[]>([])
   123	  const [previewOpen, setPreviewOpen] = useState(false)
   124	  const [previewLoading, setPreviewLoading] = useState(false)
   125	  const [previewError, setPreviewError] = useState<string | null>(null)
   126	  const [previewData, setPreviewData] = useState<any | null>(null)
   127	
   128	  const invoiceRecipientConfigured = useMemo(() => {
   129	    const vendorEmails = String(selectedVendor?.email || '')
   130	      .split(/[;,]/)
   131	      .map((s) => s.trim())
   132	      .filter((s) => s && s.includes('@'))
   133	
   134	    const primaryContactEmail = contacts.find((c) => c.is_primary && c.email && String(c.email).includes('@'))?.email
   135	    const anyContactEmail = contacts.find((c) => c.email && String(c.email).includes('@'))?.email
   136	
   137	    return Boolean(primaryContactEmail || vendorEmails[0] || anyContactEmail)
   138	  }, [selectedVendor?.email, contacts])
   139	
 succeeded in 50ms:
   620	                          <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</th>
   621	                          <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Paid</th>
   622	                          <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Outstanding</th>
   623	                          <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
   624	                        </tr>
   625	                      </thead>
   626	                      <tbody className="divide-y divide-gray-100">
   627	                        {balance.invoices.map((inv) => {
   628	                          const period = inv.reference.replace(/^OJ Projects\s*/i, '')
   629	                          const statusColors: Record<string, string> = {
   630	                            paid: 'bg-green-100 text-green-700',
   631	                            sent: 'bg-blue-100 text-blue-700',
   632	                            partially_paid: 'bg-amber-100 text-amber-700',
   633	                            overdue: 'bg-red-100 text-red-700',
   634	                            draft: 'bg-gray-100 text-gray-600',
   635	                            void: 'bg-gray-100 text-gray-400',
   636	                            written_off: 'bg-gray-100 text-gray-400',
   637	                          }
   638	                          const statusColor = statusColors[inv.status] || 'bg-gray-100 text-gray-600'
   639	                          return (
exec
/bin/zsh -lc "nl -ba 'src/app/actions/invoices.ts' | sed -n '430,470p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
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
   440	    // Prevent voiding invoices that have linked OJ Projects items, unless explicitly overridden.
   441	    if (newStatus === 'void' && !force) {
   442	      const adminClient = createAdminClient()
   443	
   444	      const [
   445	        { count: entryCount, error: entryError },
   446	        { count: recurringCount, error: recurringError },
   447	      ] = await Promise.all([
   448	        adminClient
   449	          .from('oj_entries')
exec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/oj-projects/clients/page.tsx' | sed -n '560,620p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
   560	
   561	      {!selectedVendor ? (
   562	        <EmptyState
   563	          title="No client selected"
   564	          description="Select a client above or create a new one to get started."
   565	          icon="users"
   566	        />
   567	      ) : (
   568	        <>
   569	        {/* Account Balance Summary */}
   570	        <Card className="mb-6" header={
   571	          <div className="flex items-center gap-2">
   572	            <TrendingUp className="w-5 h-5 text-gray-400" />
   573	            <CardTitle>Account Balance</CardTitle>
   574	          </div>
   575	        }>
   576	          {balanceLoading ? (
   577	            <div className="text-sm text-gray-400 py-2">Loading balance…</div>
   578	          ) : balance ? (
   579	            <div className="space-y-4">
exec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/oj-projects/page.tsx' | sed -n '760,1185p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'src/app/api/oj-projects/billing-preview/route.ts' | sed -n '1,120p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/oj-projects/page.tsx' | sed -n '533,760p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/oj-projects/projects/page.tsx' | sed -n '1,360p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/oj-projects/entries/page.tsx' | sed -n '1,560p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'src/app/actions/oj-projects/recurring-charges.ts' | sed -n '1,220p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementToolsexec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/oj-projects/work-types/page.tsx' | sed -n '1,320p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 51ms:
   533	  async function load() {
   534	    setLoading(true)
   535	    setError(null)
   536	    try {
   537	      const [vendorsRes, projectsRes, workTypesRes, monthEntriesRes, recentEntriesRes, emailStatusRes] = await Promise.all([
   538	        getVendors(),
   539	        getProjects({ status: 'active' }),
   540	        getWorkTypes(),
   541	        getEntries({ startDate: selectedMonth.start, endDate: selectedMonth.end, limit: 500 }),
   542	        getEntries({ limit: 1000 }), // Increased limit for history graph
   543	        getOjProjectsEmailStatus(),
   544	      ])
   545	
   546	      if (vendorsRes.error || !vendorsRes.vendors) throw new Error(vendorsRes.error || 'Failed to load vendors')
   547	      if (projectsRes.error || !projectsRes.projects) throw new Error(projectsRes.error || 'Failed to load projects')
   548	      if (workTypesRes.error || !workTypesRes.workTypes) throw new Error(workTypesRes.error || 'Failed to load work types')
   549	      if (monthEntriesRes.error || !monthEntriesRes.entries) throw new Error(monthEntriesRes.error || 'Failed to load entries')
   550	      if (recentEntriesRes.error || !recentEntriesRes.entries) throw new Error(recentEntriesRes.error || 'Failed to load entries')
   551	
   552	      setVendors(vendorsRes.vendors)
 succeeded in 51ms:
   760	          variant="warning"
   761	          className="mb-6"
   762	          title="Email service not configured"
   763	          description="Automated billing can create invoices, but emails will fail to send until Microsoft Graph is configured."
   764	        />
   765	      )}
   766	
   767	      {/* Hero Stats */}
   768	      <div className="space-y-6">
   769	        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
   770	          <div className="flex items-center gap-2 text-sm text-gray-500">
   771	            <Calendar className="w-4 h-4" />
   772	            <span className="font-medium">Summary for</span>
   773	            <Input
   774	              type="month"
   775	              value={monthKey}
   776	              onChange={(e) => setMonthKey(e.target.value)}
   777	              className="py-1 px-2 h-auto text-sm w-auto"
   778	            />
   779	          </div>
 succeeded in 51ms:
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
 succeeded in 50ms:
     1	'use client'
     2	
     3	import { useEffect, useMemo, useState } from 'react'
     4	import { useRouter, useSearchParams } from 'next/navigation'
     5	import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
     6	import { Card } from '@/components/ui-v2/layout/Card'
     7	import { Button, IconButton } from '@/components/ui-v2/forms/Button'
     8	import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
     9	import { Input } from '@/components/ui-v2/forms/Input'
    10	import { Select } from '@/components/ui-v2/forms/Select'
    11	import { Textarea } from '@/components/ui-v2/forms/Textarea'
    12	import { Alert } from '@/components/ui-v2/feedback/Alert'
    13	import { toast } from '@/components/ui-v2/feedback/Toast'
    14	import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
    15	import { usePermissions } from '@/contexts/PermissionContext'
    16	import { getVendors } from '@/app/actions/vendors'
    17	import { createProject, deleteProject, getProjects, updateProject, updateProjectStatus } from '@/app/actions/oj-projects/projects'
    18	import type { InvoiceVendor } from '@/types/invoices'
    19	import {
    20	  Archive,
 succeeded in 51ms:
     1	'use server'
     2	
     3	import { createClient } from '@/lib/supabase/server'
     4	import { checkUserPermission } from '@/app/actions/rbac'
     5	import { logAuditEvent } from '@/app/actions/audit'
     6	import { z } from 'zod'
     7	
     8	const RecurringChargeSchema = z.object({
     9	  vendor_id: z.string().uuid('Invalid vendor ID'),
    10	  description: z.string().min(1, 'Description is required').max(200),
    11	  amount_ex_vat: z.coerce.number().min(0),
    12	  vat_rate: z.coerce.number().min(0).max(100),
    13	  is_active: z.coerce.boolean().optional(),
    14	  sort_order: z.coerce.number().int().min(0).max(1000).optional(),
    15	})
    16	
    17	export async function getRecurringCharges(vendorId: string) {
    18	  const hasPermission = await checkUserPermission('oj_projects', 'view')
    19	  if (!hasPermission) return { error: 'You do not have permission to view recurring charges' }
    20	
 succeeded in 51ms:
     1	'use client'
     2	
     3	import { useEffect, useMemo, useState } from 'react'
     4	import { useRouter } from 'next/navigation'
     5	import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
     6	import { Card } from '@/components/ui-v2/layout/Card'
     7	import { Button } from '@/components/ui-v2/forms/Button'
     8	import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
     9	import { Input } from '@/components/ui-v2/forms/Input'
    10	import { Select } from '@/components/ui-v2/forms/Select'
    11	import { Textarea } from '@/components/ui-v2/forms/Textarea'
    12	import { Alert } from '@/components/ui-v2/feedback/Alert'
    13	import { toast } from '@/components/ui-v2/feedback/Toast'
    14	import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
    15	import { usePermissions } from '@/contexts/PermissionContext'
    16	import { getVendors } from '@/app/actions/vendors'
    17	import { getProjects } from '@/app/actions/oj-projects/projects'
    18	import { getWorkTypes } from '@/app/actions/oj-projects/work-types'
    19	import { deleteEntry, getEntries, updateEntry } from '@/app/actions/oj-projects/entries'
    20	import type { InvoiceVendor } from '@/types/invoices'
 succeeded in 50ms:
     1	'use client'
     2	
     3	import { useEffect, useState } from 'react'
     4	import { useRouter } from 'next/navigation'
     5	import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
     6	import { Card, CardTitle } from '@/components/ui-v2/layout/Card'
     7	import { Button, IconButton } from '@/components/ui-v2/forms/Button'
     8	import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
     9	import { Input } from '@/components/ui-v2/forms/Input'
    10	import { Alert } from '@/components/ui-v2/feedback/Alert'
    11	import { toast } from '@/components/ui-v2/feedback/Toast'
    12	import { EmptyState } from '@/components/ui-v2/display/EmptyState'
    13	import { usePermissions } from '@/contexts/PermissionContext'
    14	import { createWorkType, disableWorkType, getWorkTypes, updateWorkType } from '@/app/actions/oj-projects/work-types'
    15	import {
    16	  Briefcase,
    17	  Check,
    18	  LayoutDashboard,
    19	  List,
    20	  Plus,
exec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/oj-projects/projects/[id]/page.tsx' | sed -n '330,430p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
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
   340	              </div>
   341	              <div>
   342	                <div className="text-sm text-gray-500 mb-1">Paid</div>
   343	                <div className="font-semibold text-green-600">{formatCurrency(totals.paid_ex_vat)}</div>
   344	              </div>
   345	            </div>
   346	          </Card>
   347	
   348	          {/* Hours Budget */}
   349	          {budgetHours != null && (
exec
/bin/zsh -lc "nl -ba 'src/app/(authenticated)/oj-projects/projects/[id]/page.tsx' | sed -n '430,470p'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
   430	                          ) : (
   431	                            <div className="flex flex-col">
   432	                              <span className="font-medium">{formatCurrency(Number(entry.miles || 0) * Number(entry.mileage_rate_snapshot || 0.42))}</span>
   433	                              <span className="text-xs text-gray-500">{entry.miles} miles</span>
   434	                            </div>
   435	                          )}
   436	                        </td>
   437	                        <td className="px-6 py-4 text-sm text-gray-500 max-w-md truncate" title={entry.description}>
   438	                          {entry.description || '-'}
   439	                        </td>
   440	                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
   441	                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize
   442	                            ${entry.status === 'unbilled' ? 'bg-amber-100 text-amber-800' :
   443	                              entry.status === 'paid' ? 'bg-green-100 text-green-800' :
   444	                                'bg-gray-100 text-gray-800'
   445	                            }`}
   446	                          >
   447	                            {entry.status}
   448	                          </span>
   449	                        </td>
exec
/bin/zsh -lc "sed -n '1,220p' 'src/lib/invoice-recipients.ts'" in /Users/peterpitcher/Cursor/OJ-AnchorManagementTools succeeded in 52ms:
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
context compacted
codex
No repo skill was necessary here; this is a direct inspection of the current code and the review spec at [2026-04-14-oj-projects-review-design.md](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:1>).

**Repo Snapshot**
- OJ Projects is already a substantial feature area: authenticated UI, server actions, billing cron, invoice/remittance integration, and DB schema are all present.
- The main gaps are not “feature missing everywhere”; they are mostly “feature exists in some layers but not others”.
- The biggest theme is partial rollout of `one_off` charges and statement/balance logic: writes/billing largely support them, but several read/reporting surfaces do not.

**1. Authenticated Routes**
Files present:
- `src/app/(authenticated)/oj-projects/page.tsx`
- `src/app/(authenticated)/oj-projects/projects/page.tsx`
- `src/app/(authenticated)/oj-projects/projects/[id]/page.tsx`
- `src/app/(authenticated)/oj-projects/entries/page.tsx`
- `src/app/(authenticated)/oj-projects/clients/page.tsx`
- `src/app/(authenticated)/oj-projects/work-types/page.tsx`

Key files:
- [dashboard](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/page.tsx:1>)
- [projects list](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/projects/page.tsx:1>)
- [project detail](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/projects/[id]/page.tsx:1>)
- [entries](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/entries/page.tsx:1>)
- [clients](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:1>)
- [work types](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/work-types/page.tsx:1>)

- `What exists:` Dashboard is a quick-entry/admin surface; projects list/detail cover project CRUD and budgets; entries page is the main ledger UI; clients page is the billing/admin center; work types page is lightweight configuration.
- `Key patterns:` These are mostly client-heavy pages using server actions plus permission hooks. CRUD is modal-driven. Large result sets are loaded client-side and filtered in memory.
- `Data flow:` Dashboard quick entry calls `createTimeEntry`, `createMileageEntry`, and `createOneOffCharge`; project pages call project/contact actions; clients page combines vendor billing settings, recurring charges, invoice contacts, balance, and billing preview.
- `Constraints encoded:` Only unbilled entries can be edited/deleted; delete-project is blocked if entries exist; completed/archived projects are not entry targets; retainer projects are auto-selected in the dashboard for the current vendor/month.
- `What already exists vs spec:` Statement mode toggle is already exposed on the clients page, and billing preview already exists through `/api/oj-projects/billing-preview`.
- `Risks:` Project detail still behaves like entries are only `time` or `mileage`; `one_off` totals are omitted and one-off rows are rendered as mileage-like rows in [projects/[id]/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/projects/[id]/page.tsx:110>).
- `Risks:` Project list budget numbers depend on `oj_project_stats`, which undercounts spend because the stats view excludes one-off charges.
- `Risks:` Clients page labels and sums mix unpaid invoice balances with unbilled work in different tax bases, so the “account balance” UI is directionally useful but not financially clean.
- `Risks:` The pages rely heavily on ad hoc shapes and `any`, despite a dedicated OJ types file existing.

**2. Server Actions In `src/app/actions/oj-projects/`**
Files present:
- `projects.ts`
- `entries.ts`
- `work-types.ts`
- `vendor-settings.ts`
- `recurring-charges.ts`
- `project-contacts.ts`
- `client-balance.ts`
- `system.ts`
- `__tests__/entries.test.ts`

Key files:
- [projects.ts](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/projects.ts:1>)
- [entries.ts](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/entries.ts:1>)
- [vendor-settings.ts](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/vendor-settings.ts:1>)
- [client-balance.ts](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/client-balance.ts:1>)

- `What exists:` Full CRUD/service action coverage exists for projects, entries, work types, vendor billing settings, recurring charges, project contacts, system/email status, and vendor/client balance.
- `Key patterns:` Actions are `use server`, permission-gated via `checkUserPermission`, validated with Zod, backed by Supabase queries, and usually audit-logged with `logAuditEvent`.
- `Data flow:` Entries and projects write into OJ tables; billing settings and recurring charges shape the cron invoice run; contacts feed invoice-copy recipients; client balance reads both invoices and unbilled OJ work to produce a summary.
- `Constraints encoded:` `entries.ts` enforces project-vendor consistency, blocks entries on completed/archived projects, rounds time entries to 15-minute blocks, and only allows edits/deletes on `unbilled` rows.
- `Constraints encoded:` `projects.ts` prevents hard deletion if any entries exist and generates client/project codes with a local `deriveClientCode` helper.
- `Constraints encoded:` `vendor-settings.ts` requires positive `monthly_cap_inc_vat` when billing mode is `cap` and normalizes client codes / rates / statement mode.
- `Constraints encoded:` `project-contacts.ts` explicitly verifies that contact, project, and vendor relationships match before tagging.
- `What already exists vs spec:` `entries.ts` already supports `one_off` create/update/delete paths end to end.
- `Risks:` `deriveClientCode` is duplicated instead of centralized, matching the design doc’s concern.
- `Risks:` `vendor-settings.ts` is the notable action set that does not appear to audit-log its mutations.
- `Risks:` `client-balance.ts` is materially incomplete: it omits one-off entries, uses a stale mileage fallback rate, and combines unpaid invoices with unbilled work into one number even though those are not in the same basis.
- `Risks:` `client-balance.ts` identifies OJ invoices partly by `reference ILIKE 'OJ Projects %'`, which is brittle compared with a first-class linkage.
- `Risks:` `entries.ts` allows time entries with null `start_at`/`end_at`, which is now DB-valid, but that weakens later billing-cap split logic.
- `Risks:` Only one targeted test exists in this area, [entries.test.ts](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/__tests__/entries.test.ts:1>), and it focuses on timestamp nullability rather than billing/accounting flows.

**3. Billing Cron**
Primary file:
- [src/app/api/cron/oj-projects-billing/route.ts](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:1>)

Key functions found:
- `calculateRecurringChargeAmountExVat`
- `calculateEntryAmountExVat`
- `splitRecurringInstanceForCap`
- `splitMileageEntryForCap`
- `splitTimeEntryForCap`
- `buildStatementNotes`
- `fetchHistoricalBalance`
- `fetchBalanceBeforeCurrentPeriod`
- `buildStatementLineItems`
- `buildDryRunPreview`
- `createAndSendInvoiceForVendor`
- `processVendor`
- `processFailedBillingRuns`
- `GET`

- `What exists:` This is a full monthly billing engine, not a stub. It discovers billable vendors, upserts recurring instances, selects billable work, enforces cap logic, creates invoices, emails them, and tracks billing runs.
- `Key patterns:` It uses per-vendor billing runs, optimistic row locking via status transitions to `billing_pending`, and supports both detailed invoices and statement-mode invoices.
- `Data flow:` Unbilled `oj_entries` plus unbilled recurring charge instances are gathered for a target period; selected rows are locked to a billing run; invoice line items are built; invoice creation is delegated through invoice actions/services; after send, OJ rows move to `billed`; later invoice-paid triggers move them to `paid`.
- `Data flow:` The clients page preview does not call the cron route directly; it goes through `/api/oj-projects/billing-preview`, which uses the safe dry-run path.
- `Constraints encoded:` Cron is date-gated to run on London day 1 unless forced.
- `Constraints encoded:` Billing runs are unique per `vendor_id + period_yyyymm`.
- `Constraints encoded:` Cap-mode selection order is recurring charges, one-off entries, mileage entries, then time entries.
- `Constraints encoded:` Partial split support exists for recurring charges, mileage, and time, but not for one-off charges.
- `Constraints encoded:` Time-entry splitting only works when both `start_at` and `end_at` are present and parseable.
- `What already exists vs spec:` Statement mode is already real in both settings and invoice generation. This is not future work; it is partially implemented today.
- `Risks:` The safe non-mutating preview flag is `dry_run=true`; anyone assuming `preview=true` is harmless would be wrong.
- `Risks:` Statement-mode note generation still omits one-off charges from the narrative/balance treatment even though one-offs are billable elsewhere in the same flow.
- `Risks:` Because many UI-created time entries have null timestamps, `splitTimeEntryForCap` will frequently be unable to split them, which makes cap filling less reliable than the code shape suggests.
- `Risks:` Large queries repeatedly use fixed limits like `10000` without pagination or chunking.
- `Risks:` If invoice creation succeeds but emailing fails or recipients/config are missing, rows can remain `billing_pending` awaiting retry.
- `Risks:` I did not find alerting for failed vendor runs, zero-vendor runs, or other operator-facing sanity checks that the design doc proposes.

**4. `src/types/oj-projects.ts`**
File:
- [src/types/oj-projects.ts](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/oj-projects.ts:1>)

- `What exists:` Types are defined for work types, vendor billing settings, recurring charge definitions, projects, project contacts, entries, and billing runs.
- `Key patterns:` This is a hand-maintained domain types file rather than generated DB typing.
- `Constraints encoded:` `OJEntry` includes `entry_type` support and the snapshot-style fields needed for billing.
- `Risks:` There is no `OJRecurringChargeInstance` type even though the table and cron logic exist.
- `Risks:` `statement_mode` is typed as `boolean | null` even though the schema migration makes it effectively non-null with a default.
- `Risks:` `selected_entry_ids` is `any | null`, which weakens the billing-run typing surface.
- `Risks:` The file is underused in the inspected pages/actions; much of the implementation still falls back to `any` or inferred shapes.

**5. Invoice Payment / Remittance Actions**
Primary file:
- [src/app/actions/invoices.ts](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:1>)

Relevant functions:
- [sendRemittanceAdviceForPaidInvoice](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:112>)
- [recordPayment](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:670>)

- `What exists:` Remittance advice sending is already implemented, including recipient resolution, PDF generation, email logging, and audit logging.
- `Key patterns:` `recordPayment` delegates to `InvoiceService.recordPayment`, then reloads invoice state and conditionally triggers remittance sending.
- `Data flow:` Payment is recorded on the invoice service side; invoice status is recalculated; if the invoice newly becomes `paid`, remittance advice is emailed.
- `Constraints encoded:` `sendRemittanceAdviceForPaidInvoice` hard-requires `invoice.status === 'paid'`.
- `Constraints encoded:` Recipient logic respects invoice-copy contacts and logs send/failure into `invoice_email_logs`.
- `What already exists vs spec:` The system already has receipt/remittance plumbing; the missing piece is broader trigger behavior, not PDF/email infrastructure.
- `Risks:` Partial payments do not trigger remittance advice today, because the send path is gated on transition to fully `paid`.
- `Risks:` I did not find a payment-level dedupe guard beyond the transition-to-paid check, so the current behavior is safe mainly because it only sends once at full payment.

**6. Remittance Handling In The Compact Invoice Template**
Primary file:
- [src/lib/invoice-template-compact.ts](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:1>)

- `What exists:` The compact invoice template already supports a `documentKind: 'remittance_advice'` mode.
- `Key patterns:` The template accepts remittance metadata separately from invoice core data and derives a payment summary panel from that payload plus the invoice/payment state.
- `Data flow:` The remittance action passes latest payment details, outstanding balance, and invoice context into the template, which then renders a receipt-style PDF.
- `Constraints encoded:` The template can show payment date, method, reference, and outstanding balance, and it visually distinguishes partial-payment status.
- `What already exists vs spec:` The PDF layer already supports partial-balance presentation. The design doc’s desired receipt format is mostly already there.
- `Risks:` The code path name says “paid invoice”, but the template itself is already capable of a “paid vs partially paid” distinction. The application trigger logic is the bottleneck.

**7. `src/app/actions/oj-projects/client-balance.ts`**
File:
- [client-balance.ts](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/client-balance.ts:1>)

- `What exists:` It computes a vendor-facing balance summary by combining unpaid OJ invoices with unbilled OJ work and recurring charges.
- `Key patterns:` It is a read-only aggregation action that joins invoice state and OJ state at the app layer rather than through a dedicated DB view.
- `Data flow:` It fetches recent invoices for the vendor, totals remaining unpaid amounts, fetches unbilled `oj_entries`, fetches unbilled recurring instances, and produces summary totals/breakdowns.
- `Constraints encoded:` It only considers invoices that look like OJ invoices by reference pattern and only examines a limited recent set.
- `Risks:` One-off entries are not included, so the summary is incomplete for current OJ billing reality.
- `Risks:` The fallback mileage rate is stale versus the later mileage-rate migration.
- `Risks:` `totalOutstanding` conflates unpaid invoices and unbilled work despite differing tax/status semantics.
- `Risks:` The clients page surfaces this result as if it were a clean “account balance”, which is stronger than the implementation warrants.

**8. `src/types/invoices.ts`**
File:
- [src/types/invoices.ts](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/invoices.ts:1>)

- `What exists:` Shared invoice domain types are already fairly mature, including invoice statuses, invoice/payment shapes, and `InvoiceWithDetails`.
- `Key patterns:` The file is broad enough to support payment history and remittance flows, especially through `payments` on `InvoiceWithDetails`.
- `Constraints encoded:` `InvoiceStatus` already includes `partially_paid`, `void`, and `written_off`.
- `Risks:` `InvoiceEmailLog` appears under-modeled compared with DB reality; it does not reflect all observed statuses/columns used elsewhere.
- `Risks:` There is no first-class type here for invoice vendor contacts, even though recipient logic depends on those records.

**9. OJ Migrations**
Matched OJ-related migrations inspected:
- [20260120130000_oj_projects_core.sql](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260120130000_oj_projects_core.sql:1>)
- [20260120132000_add_oj_projects_permissions.sql](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260120132000_add_oj_projects_permissions.sql:1>)
- [20260121100000_oj_recurring_charge_instances.sql](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260121100000_oj_recurring_charge_instances.sql:1>)
- [20260121120000_oj_retainer_projects.sql](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260121120000_oj_retainer_projects.sql:1>)
- [20260203090000_add_statement_mode_to_oj_vendor_billing_settings.sql](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260203090000_add_statement_mode_to_oj_vendor_billing_settings.sql:1>)
- [20260226120000_oj_entries_one_off.sql](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260226120000_oj_entries_one_off.sql:1>)
- [20260405130001_update_oj_mileage_rate.sql](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260405130001_update_oj_mileage_rate.sql:1>)
- [20260405130002_oj_mileage_sync_trigger.sql](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260405130002_oj_mileage_sync_trigger.sql:1>)
- [20260512000000_oj_entries_relax_time_constraint.sql](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql:1>)

Adjacent non-`oj_*` migration that still matters:
- [20260121130000_project_stats_view.sql](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260121130000_project_stats_view.sql:1>)

- `What exists:` Core schema covers work types, vendor billing settings, projects, project-contact mapping, entries, billing runs, RBAC/RLS, recurring charge instances, retainer projects, statement mode, one-off entries, mileage sync, and relaxed time constraints.
- `Key patterns:` The schema uses snapshot billing fields on entries, explicit status lifecycles, and invoice-paid triggers to move OJ rows from `billed` to `paid`.
- `Data flow:` App writes `oj_entries` and related config tables; billing cron creates invoices and links billing runs; invoice status changes then cascade back into OJ status through trigger logic.
- `Constraints encoded:` `oj_entries` status lifecycle is explicit; retainer project uniqueness is enforced; mileage entries sync to `mileage_trips`; time entries may now have both timestamps null.
- `Constraints encoded:` `statement_mode` is a real DB column with a default, not a planned field.
- `What already exists vs spec:` One-off schema support and statement-mode schema support are already live.
- `Risks:` The project stats view excludes one-off charges, so any UI relying on it under-reports project spend.
- `Risks:` One-off constraints still rely partly on application discipline rather than exhaustively null-checking every non-applicable snapshot column.
- `Risks:` Vendor-consistency rules across linked rows are mostly app-enforced, not fully encoded as database invariants.
- `Risks:` The paid-status trigger is forward-only; I did not find a reverse/unbill path for invoice void/write-off handling.

**Spec Reality Check**
- `Already present:` One-off entries, recurring charge instances, statement mode, billing preview, remittance/receipt template mode, and a void-warning safeguard in invoice actions.
- `Partially present:` Statement-mode billing exists, but statement-style client history/statement PDFs and statement send actions do not.
- `Still missing:` A dedicated client statement action/flow, project payment-history UI, partial-payment remittance sending, stronger duplicate-send protection for remittance emails, operator alerting around billing cron anomalies, and broader type cleanup.
- `Accurate spec concerns:` Duplicated `deriveClientCode`, incomplete one-off support in read/reporting surfaces, and mismatch between payment/remittance capability and trigger behavior are all real in the current code.

**Highest-Signal Risks**
- Client balance is not financially reliable yet: it omits one-offs, uses a stale mileage fallback, and mixes invoiced debt with unbilled work.
- One-off support is incomplete on read/reporting surfaces: project detail, project stats, statement notes, and client balance all lag the write/billing path.
- Cap-mode splitting for time entries is fragile because the UI and DB now allow null timestamps but `splitTimeEntryForCap` still needs real times.
- Partial-payment receipts are one small logic change away: the template already supports them, but `recordPayment` only sends on full payment.
- The safe preview path is `dry_run=true` through the billing-preview route; that distinction matters operationally.

If you want, I can turn this into a second-pass gap matrix: `spec item -> current code -> exact change surface`.
tokens used
543,692
No repo skill was necessary here; this is a direct inspection of the current code and the review spec at [2026-04-14-oj-projects-review-design.md](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-14-oj-projects-review-design.md:1>).

**Repo Snapshot**
- OJ Projects is already a substantial feature area: authenticated UI, server actions, billing cron, invoice/remittance integration, and DB schema are all present.
- The main gaps are not “feature missing everywhere”; they are mostly “feature exists in some layers but not others”.
- The biggest theme is partial rollout of `one_off` charges and statement/balance logic: writes/billing largely support them, but several read/reporting surfaces do not.

**1. Authenticated Routes**
Files present:
- `src/app/(authenticated)/oj-projects/page.tsx`
- `src/app/(authenticated)/oj-projects/projects/page.tsx`
- `src/app/(authenticated)/oj-projects/projects/[id]/page.tsx`
- `src/app/(authenticated)/oj-projects/entries/page.tsx`
- `src/app/(authenticated)/oj-projects/clients/page.tsx`
- `src/app/(authenticated)/oj-projects/work-types/page.tsx`

Key files:
- [dashboard](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/page.tsx:1>)
- [projects list](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/projects/page.tsx:1>)
- [project detail](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/projects/[id]/page.tsx:1>)
- [entries](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/entries/page.tsx:1>)
- [clients](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx:1>)
- [work types](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/work-types/page.tsx:1>)

- `What exists:` Dashboard is a quick-entry/admin surface; projects list/detail cover project CRUD and budgets; entries page is the main ledger UI; clients page is the billing/admin center; work types page is lightweight configuration.
- `Key patterns:` These are mostly client-heavy pages using server actions plus permission hooks. CRUD is modal-driven. Large result sets are loaded client-side and filtered in memory.
- `Data flow:` Dashboard quick entry calls `createTimeEntry`, `createMileageEntry`, and `createOneOffCharge`; project pages call project/contact actions; clients page combines vendor billing settings, recurring charges, invoice contacts, balance, and billing preview.
- `Constraints encoded:` Only unbilled entries can be edited/deleted; delete-project is blocked if entries exist; completed/archived projects are not entry targets; retainer projects are auto-selected in the dashboard for the current vendor/month.
- `What already exists vs spec:` Statement mode toggle is already exposed on the clients page, and billing preview already exists through `/api/oj-projects/billing-preview`.
- `Risks:` Project detail still behaves like entries are only `time` or `mileage`; `one_off` totals are omitted and one-off rows are rendered as mileage-like rows in [projects/[id]/page.tsx](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/projects/[id]/page.tsx:110>).
- `Risks:` Project list budget numbers depend on `oj_project_stats`, which undercounts spend because the stats view excludes one-off charges.
- `Risks:` Clients page labels and sums mix unpaid invoice balances with unbilled work in different tax bases, so the “account balance” UI is directionally useful but not financially clean.
- `Risks:` The pages rely heavily on ad hoc shapes and `any`, despite a dedicated OJ types file existing.

**2. Server Actions In `src/app/actions/oj-projects/`**
Files present:
- `projects.ts`
- `entries.ts`
- `work-types.ts`
- `vendor-settings.ts`
- `recurring-charges.ts`
- `project-contacts.ts`
- `client-balance.ts`
- `system.ts`
- `__tests__/entries.test.ts`

Key files:
- [projects.ts](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/projects.ts:1>)
- [entries.ts](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/entries.ts:1>)
- [vendor-settings.ts](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/vendor-settings.ts:1>)
- [client-balance.ts](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/client-balance.ts:1>)

- `What exists:` Full CRUD/service action coverage exists for projects, entries, work types, vendor billing settings, recurring charges, project contacts, system/email status, and vendor/client balance.
- `Key patterns:` Actions are `use server`, permission-gated via `checkUserPermission`, validated with Zod, backed by Supabase queries, and usually audit-logged with `logAuditEvent`.
- `Data flow:` Entries and projects write into OJ tables; billing settings and recurring charges shape the cron invoice run; contacts feed invoice-copy recipients; client balance reads both invoices and unbilled OJ work to produce a summary.
- `Constraints encoded:` `entries.ts` enforces project-vendor consistency, blocks entries on completed/archived projects, rounds time entries to 15-minute blocks, and only allows edits/deletes on `unbilled` rows.
- `Constraints encoded:` `projects.ts` prevents hard deletion if any entries exist and generates client/project codes with a local `deriveClientCode` helper.
- `Constraints encoded:` `vendor-settings.ts` requires positive `monthly_cap_inc_vat` when billing mode is `cap` and normalizes client codes / rates / statement mode.
- `Constraints encoded:` `project-contacts.ts` explicitly verifies that contact, project, and vendor relationships match before tagging.
- `What already exists vs spec:` `entries.ts` already supports `one_off` create/update/delete paths end to end.
- `Risks:` `deriveClientCode` is duplicated instead of centralized, matching the design doc’s concern.
- `Risks:` `vendor-settings.ts` is the notable action set that does not appear to audit-log its mutations.
- `Risks:` `client-balance.ts` is materially incomplete: it omits one-off entries, uses a stale mileage fallback rate, and combines unpaid invoices with unbilled work into one number even though those are not in the same basis.
- `Risks:` `client-balance.ts` identifies OJ invoices partly by `reference ILIKE 'OJ Projects %'`, which is brittle compared with a first-class linkage.
- `Risks:` `entries.ts` allows time entries with null `start_at`/`end_at`, which is now DB-valid, but that weakens later billing-cap split logic.
- `Risks:` Only one targeted test exists in this area, [entries.test.ts](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/__tests__/entries.test.ts:1>), and it focuses on timestamp nullability rather than billing/accounting flows.

**3. Billing Cron**
Primary file:
- [src/app/api/cron/oj-projects-billing/route.ts](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/oj-projects-billing/route.ts:1>)

Key functions found:
- `calculateRecurringChargeAmountExVat`
- `calculateEntryAmountExVat`
- `splitRecurringInstanceForCap`
- `splitMileageEntryForCap`
- `splitTimeEntryForCap`
- `buildStatementNotes`
- `fetchHistoricalBalance`
- `fetchBalanceBeforeCurrentPeriod`
- `buildStatementLineItems`
- `buildDryRunPreview`
- `createAndSendInvoiceForVendor`
- `processVendor`
- `processFailedBillingRuns`
- `GET`

- `What exists:` This is a full monthly billing engine, not a stub. It discovers billable vendors, upserts recurring instances, selects billable work, enforces cap logic, creates invoices, emails them, and tracks billing runs.
- `Key patterns:` It uses per-vendor billing runs, optimistic row locking via status transitions to `billing_pending`, and supports both detailed invoices and statement-mode invoices.
- `Data flow:` Unbilled `oj_entries` plus unbilled recurring charge instances are gathered for a target period; selected rows are locked to a billing run; invoice line items are built; invoice creation is delegated through invoice actions/services; after send, OJ rows move to `billed`; later invoice-paid triggers move them to `paid`.
- `Data flow:` The clients page preview does not call the cron route directly; it goes through `/api/oj-projects/billing-preview`, which uses the safe dry-run path.
- `Constraints encoded:` Cron is date-gated to run on London day 1 unless forced.
- `Constraints encoded:` Billing runs are unique per `vendor_id + period_yyyymm`.
- `Constraints encoded:` Cap-mode selection order is recurring charges, one-off entries, mileage entries, then time entries.
- `Constraints encoded:` Partial split support exists for recurring charges, mileage, and time, but not for one-off charges.
- `Constraints encoded:` Time-entry splitting only works when both `start_at` and `end_at` are present and parseable.
- `What already exists vs spec:` Statement mode is already real in both settings and invoice generation. This is not future work; it is partially implemented today.
- `Risks:` The safe non-mutating preview flag is `dry_run=true`; anyone assuming `preview=true` is harmless would be wrong.
- `Risks:` Statement-mode note generation still omits one-off charges from the narrative/balance treatment even though one-offs are billable elsewhere in the same flow.
- `Risks:` Because many UI-created time entries have null timestamps, `splitTimeEntryForCap` will frequently be unable to split them, which makes cap filling less reliable than the code shape suggests.
- `Risks:` Large queries repeatedly use fixed limits like `10000` without pagination or chunking.
- `Risks:` If invoice creation succeeds but emailing fails or recipients/config are missing, rows can remain `billing_pending` awaiting retry.
- `Risks:` I did not find alerting for failed vendor runs, zero-vendor runs, or other operator-facing sanity checks that the design doc proposes.

**4. `src/types/oj-projects.ts`**
File:
- [src/types/oj-projects.ts](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/oj-projects.ts:1>)

- `What exists:` Types are defined for work types, vendor billing settings, recurring charge definitions, projects, project contacts, entries, and billing runs.
- `Key patterns:` This is a hand-maintained domain types file rather than generated DB typing.
- `Constraints encoded:` `OJEntry` includes `entry_type` support and the snapshot-style fields needed for billing.
- `Risks:` There is no `OJRecurringChargeInstance` type even though the table and cron logic exist.
- `Risks:` `statement_mode` is typed as `boolean | null` even though the schema migration makes it effectively non-null with a default.
- `Risks:` `selected_entry_ids` is `any | null`, which weakens the billing-run typing surface.
- `Risks:` The file is underused in the inspected pages/actions; much of the implementation still falls back to `any` or inferred shapes.

**5. Invoice Payment / Remittance Actions**
Primary file:
- [src/app/actions/invoices.ts](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:1>)

Relevant functions:
- [sendRemittanceAdviceForPaidInvoice](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:112>)
- [recordPayment](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/invoices.ts:670>)

- `What exists:` Remittance advice sending is already implemented, including recipient resolution, PDF generation, email logging, and audit logging.
- `Key patterns:` `recordPayment` delegates to `InvoiceService.recordPayment`, then reloads invoice state and conditionally triggers remittance sending.
- `Data flow:` Payment is recorded on the invoice service side; invoice status is recalculated; if the invoice newly becomes `paid`, remittance advice is emailed.
- `Constraints encoded:` `sendRemittanceAdviceForPaidInvoice` hard-requires `invoice.status === 'paid'`.
- `Constraints encoded:` Recipient logic respects invoice-copy contacts and logs send/failure into `invoice_email_logs`.
- `What already exists vs spec:` The system already has receipt/remittance plumbing; the missing piece is broader trigger behavior, not PDF/email infrastructure.
- `Risks:` Partial payments do not trigger remittance advice today, because the send path is gated on transition to fully `paid`.
- `Risks:` I did not find a payment-level dedupe guard beyond the transition-to-paid check, so the current behavior is safe mainly because it only sends once at full payment.

**6. Remittance Handling In The Compact Invoice Template**
Primary file:
- [src/lib/invoice-template-compact.ts](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/invoice-template-compact.ts:1>)

- `What exists:` The compact invoice template already supports a `documentKind: 'remittance_advice'` mode.
- `Key patterns:` The template accepts remittance metadata separately from invoice core data and derives a payment summary panel from that payload plus the invoice/payment state.
- `Data flow:` The remittance action passes latest payment details, outstanding balance, and invoice context into the template, which then renders a receipt-style PDF.
- `Constraints encoded:` The template can show payment date, method, reference, and outstanding balance, and it visually distinguishes partial-payment status.
- `What already exists vs spec:` The PDF layer already supports partial-balance presentation. The design doc’s desired receipt format is mostly already there.
- `Risks:` The code path name says “paid invoice”, but the template itself is already capable of a “paid vs partially paid” distinction. The application trigger logic is the bottleneck.

**7. `src/app/actions/oj-projects/client-balance.ts`**
File:
- [client-balance.ts](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/client-balance.ts:1>)

- `What exists:` It computes a vendor-facing balance summary by combining unpaid OJ invoices with unbilled OJ work and recurring charges.
- `Key patterns:` It is a read-only aggregation action that joins invoice state and OJ state at the app layer rather than through a dedicated DB view.
- `Data flow:` It fetches recent invoices for the vendor, totals remaining unpaid amounts, fetches unbilled `oj_entries`, fetches unbilled recurring instances, and produces summary totals/breakdowns.
- `Constraints encoded:` It only considers invoices that look like OJ invoices by reference pattern and only examines a limited recent set.
- `Risks:` One-off entries are not included, so the summary is incomplete for current OJ billing reality.
- `Risks:` The fallback mileage rate is stale versus the later mileage-rate migration.
- `Risks:` `totalOutstanding` conflates unpaid invoices and unbilled work despite differing tax/status semantics.
- `Risks:` The clients page surfaces this result as if it were a clean “account balance”, which is stronger than the implementation warrants.

**8. `src/types/invoices.ts`**
File:
- [src/types/invoices.ts](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/invoices.ts:1>)

- `What exists:` Shared invoice domain types are already fairly mature, including invoice statuses, invoice/payment shapes, and `InvoiceWithDetails`.
- `Key patterns:` The file is broad enough to support payment history and remittance flows, especially through `payments` on `InvoiceWithDetails`.
- `Constraints encoded:` `InvoiceStatus` already includes `partially_paid`, `void`, and `written_off`.
- `Risks:` `InvoiceEmailLog` appears under-modeled compared with DB reality; it does not reflect all observed statuses/columns used elsewhere.
- `Risks:` There is no first-class type here for invoice vendor contacts, even though recipient logic depends on those records.

**9. OJ Migrations**
Matched OJ-related migrations inspected:
- [20260120130000_oj_projects_core.sql](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260120130000_oj_projects_core.sql:1>)
- [20260120132000_add_oj_projects_permissions.sql](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260120132000_add_oj_projects_permissions.sql:1>)
- [20260121100000_oj_recurring_charge_instances.sql](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260121100000_oj_recurring_charge_instances.sql:1>)
- [20260121120000_oj_retainer_projects.sql](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260121120000_oj_retainer_projects.sql:1>)
- [20260203090000_add_statement_mode_to_oj_vendor_billing_settings.sql](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260203090000_add_statement_mode_to_oj_vendor_billing_settings.sql:1>)
- [20260226120000_oj_entries_one_off.sql](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260226120000_oj_entries_one_off.sql:1>)
- [20260405130001_update_oj_mileage_rate.sql](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260405130001_update_oj_mileage_rate.sql:1>)
- [20260405130002_oj_mileage_sync_trigger.sql](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260405130002_oj_mileage_sync_trigger.sql:1>)
- [20260512000000_oj_entries_relax_time_constraint.sql](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql:1>)

Adjacent non-`oj_*` migration that still matters:
- [20260121130000_project_stats_view.sql](</Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260121130000_project_stats_view.sql:1>)

- `What exists:` Core schema covers work types, vendor billing settings, projects, project-contact mapping, entries, billing runs, RBAC/RLS, recurring charge instances, retainer projects, statement mode, one-off entries, mileage sync, and relaxed time constraints.
- `Key patterns:` The schema uses snapshot billing fields on entries, explicit status lifecycles, and invoice-paid triggers to move OJ rows from `billed` to `paid`.
- `Data flow:` App writes `oj_entries` and related config tables; billing cron creates invoices and links billing runs; invoice status changes then cascade back into OJ status through trigger logic.
- `Constraints encoded:` `oj_entries` status lifecycle is explicit; retainer project uniqueness is enforced; mileage entries sync to `mileage_trips`; time entries may now have both timestamps null.
- `Constraints encoded:` `statement_mode` is a real DB column with a default, not a planned field.
- `What already exists vs spec:` One-off schema support and statement-mode schema support are already live.
- `Risks:` The project stats view excludes one-off charges, so any UI relying on it under-reports project spend.
- `Risks:` One-off constraints still rely partly on application discipline rather than exhaustively null-checking every non-applicable snapshot column.
- `Risks:` Vendor-consistency rules across linked rows are mostly app-enforced, not fully encoded as database invariants.
- `Risks:` The paid-status trigger is forward-only; I did not find a reverse/unbill path for invoice void/write-off handling.

**Spec Reality Check**
- `Already present:` One-off entries, recurring charge instances, statement mode, billing preview, remittance/receipt template mode, and a void-warning safeguard in invoice actions.
- `Partially present:` Statement-mode billing exists, but statement-style client history/statement PDFs and statement send actions do not.
- `Still missing:` A dedicated client statement action/flow, project payment-history UI, partial-payment remittance sending, stronger duplicate-send protection for remittance emails, operator alerting around billing cron anomalies, and broader type cleanup.
- `Accurate spec concerns:` Duplicated `deriveClientCode`, incomplete one-off support in read/reporting surfaces, and mismatch between payment/remittance capability and trigger behavior are all real in the current code.

**Highest-Signal Risks**
- Client balance is not financially reliable yet: it omits one-offs, uses a stale mileage fallback, and mixes invoiced debt with unbilled work.
- One-off support is incomplete on read/reporting surfaces: project detail, project stats, statement notes, and client balance all lag the write/billing path.
- Cap-mode splitting for time entries is fragile because the UI and DB now allow null timestamps but `splitTimeEntryForCap` still needs real times.
- Partial-payment receipts are one small logic change away: the template already supports them, but `recordPayment` only sends on full payment.
- The safe preview path is `dry_run=true` through the billing-preview route; that distinction matters operationally.

If you want, I can turn this into a second-pass gap matrix: `spec item -> current code -> exact change surface`.
