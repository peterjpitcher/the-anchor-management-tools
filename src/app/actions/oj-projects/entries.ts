'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { recalculateTaxYearMileage } from '@/lib/mileage/recalculateTaxYear'
import { getTaxYearBounds } from '@/lib/mileage/hmrcRates'
import { generateProjectCode } from '@/lib/oj-projects/project-codes'
import { getEntryDatePeriod } from '@/lib/oj-projects/retainers'
import {
  buildOjInvoiceRevision,
  getOjInvoiceRevisionBlockReason,
  type OjInvoiceRevisionEntry,
  type OjInvoiceRevisionRecurringInstance,
} from '@/lib/oj-projects/invoice-revision'
import { revalidatePath, revalidateTag } from 'next/cache'
import { z } from 'zod'

function hasAtMostOneDecimalPlace(value: number): boolean {
  return Math.abs(Math.round(value * 10) - value * 10) < 0.000001
}

const MileageMilesSchema = z.coerce
  .number()
  .finite('Miles must be a valid number')
  .min(0.1, 'Miles must be at least 0.1')
  .refine(hasAtMostOneDecimalPlace, 'Miles must be rounded to 1 decimal place')

const TimeEntrySchema = z.object({
  vendor_id: z.string().uuid('Invalid vendor ID'),
  project_id: z.string().uuid('Invalid project ID').optional().or(z.literal('')).optional(),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  duration_minutes: z.coerce.number().min(1, 'Duration must be at least 1 minute'),
  work_type_id: z.string().uuid('Invalid work type').optional().or(z.literal('')).optional(),
  description: z.string().max(5000).optional(),
  internal_notes: z.string().max(10000).optional(),
  billable: z.coerce.boolean().optional(),
})

const MileageEntrySchema = z.object({
  vendor_id: z.string().uuid('Invalid vendor ID'),
  project_id: z.string().uuid('Invalid project ID').optional().or(z.literal('')).optional(),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  miles: MileageMilesSchema,
  description: z.string().max(5000).optional(),
  internal_notes: z.string().max(10000).optional(),
  billable: z.coerce.boolean().optional(),
})

const OneOffChargeSchema = z.object({
  vendor_id: z.string().uuid('Invalid vendor ID'),
  project_id: z.string().uuid('Invalid project ID').optional().or(z.literal('')).optional(),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  amount_ex_vat: z.coerce.number().positive('Amount must be greater than 0'),
  description: z.string().max(5000).optional(),
  internal_notes: z.string().max(10000).optional(),
  billable: z.coerce.boolean().optional(),
})

const UpdateEntrySchema = z.object({
  id: z.string().uuid('Invalid entry ID'),
  entry_type: z.enum(['time', 'mileage', 'one_off'] as const),
  vendor_id: z.string().uuid('Invalid vendor ID'),
  project_id: z.string().uuid('Invalid project ID').optional().or(z.literal('')).optional(),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  duration_minutes: z.coerce.number().min(1).optional(),
  miles: MileageMilesSchema.optional(),
  amount_ex_vat: z.coerce.number().positive().optional(),
  work_type_id: z.string().uuid().optional().or(z.literal('')).optional(),
  description: z.string().max(5000).optional(),
  internal_notes: z.string().max(10000).optional(),
  billable: z.coerce.boolean().optional(),
})

async function getVendorSettingsOrDefault(supabase: Awaited<ReturnType<typeof createClient>>, vendorId: string) {
  const { data } = await supabase
    .from('oj_vendor_billing_settings')
    .select('hourly_rate_ex_vat, vat_rate, mileage_rate, retainer_included_hours_per_month')
    .eq('vendor_id', vendorId)
    .maybeSingle()

  return {
    hourly_rate_ex_vat: typeof data?.hourly_rate_ex_vat === 'number' ? data.hourly_rate_ex_vat : 75,
    vat_rate: typeof data?.vat_rate === 'number' ? data.vat_rate : 20,
    mileage_rate: typeof data?.mileage_rate === 'number' ? data.mileage_rate : 0.55,
    retainer_included_hours_per_month: typeof data?.retainer_included_hours_per_month === 'number' ? data.retainer_included_hours_per_month : null,
  }
}

async function ensureProjectMatchesVendor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  vendorId: string,
  entryDate: string
) {
  const { data: project, error } = await supabase
    .from('oj_projects')
    .select('id, vendor_id, status, is_retainer, retainer_period_yyyymm')
    .eq('id', projectId)
    .single()

  if (error) return { error: error.message }
  if (project.vendor_id !== vendorId) {
    return { error: 'Selected project does not belong to the selected vendor' }
  }
  if (project.status === 'completed' || project.status === 'archived') {
    if (project.is_retainer) {
      return { error: 'Cannot add entries to a closed retainer' }
    }
    return { error: 'Cannot add entries to a closed project' }
  }
  if (project.is_retainer && project.retainer_period_yyyymm !== getEntryDatePeriod(entryDate)) {
    return { error: 'Selected retainer does not match the entry date. Use Current retainer / General Work to route this entry to the correct monthly retainer.' }
  }
  return { success: true as const }
}

const GENERAL_PROJECT_NAME = 'General Work'
const GENERAL_PROJECT_NOTES = 'Auto-created by OJ Projects for client-level entries without a specific project.'

function periodFromEntryDate(entryDate: string): string {
  return getEntryDatePeriod(entryDate)
}

function monthLabelFromPeriod(periodYyyymm: string): string {
  const [year, month] = periodYyyymm.split('-').map(Number)
  if (!year || !month) return periodYyyymm
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

async function getVendorName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  vendorId: string
) {
  const { data } = await supabase
    .from('invoice_vendors')
    .select('name')
    .eq('id', vendorId)
    .maybeSingle()

  return data?.name ? String(data.name) : 'Client'
}

async function createGeneralProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  vendorId: string
) {
  const projectCode = await generateProjectCode(supabase, vendorId)
  const { data, error } = await supabase
    .from('oj_projects')
    .insert({
      vendor_id: vendorId,
      project_code: projectCode,
      project_name: GENERAL_PROJECT_NAME,
      brief: 'Default bucket for ad hoc client work that is not tied to a specific project.',
      internal_notes: GENERAL_PROJECT_NOTES,
      deadline: null,
      budget_ex_vat: null,
      budget_hours: null,
      status: 'active',
      is_retainer: false,
      retainer_period_yyyymm: null,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }
  return { projectId: data.id as string }
}

async function resolveGeneralProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  vendorId: string
) {
  const { data: existing, error: existingError } = await supabase
    .from('oj_projects')
    .select('id')
    .eq('vendor_id', vendorId)
    .eq('is_retainer', false)
    .eq('project_name', GENERAL_PROJECT_NAME)
    .in('status', ['active', 'paused'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (existingError) return { error: existingError.message }
  if (existing?.id) return { projectId: existing.id as string }

  return createGeneralProject(supabase, vendorId)
}

async function createRetainerProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  vendorId: string,
  periodYyyymm: string,
  includedHours: number
) {
  const [vendorName, projectCode] = await Promise.all([
    getVendorName(supabase, vendorId),
    generateProjectCode(supabase, vendorId),
  ])
  const monthLabel = monthLabelFromPeriod(periodYyyymm)

  const { data, error } = await supabase
    .from('oj_projects')
    .insert({
      vendor_id: vendorId,
      project_code: projectCode,
      project_name: `${vendorName} Retainer (${monthLabel})`,
      brief: `Monthly retainer bucket for ${monthLabel}.`,
      internal_notes: `Auto-created by OJ Projects when logging a retainer entry for ${periodYyyymm}.`,
      deadline: null,
      budget_ex_vat: null,
      budget_hours: includedHours,
      status: 'active',
      is_retainer: true,
      retainer_period_yyyymm: periodYyyymm,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }
  return { projectId: data.id as string }
}

async function resolveRetainerProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  vendorId: string,
  entryDate: string,
  includedHours: number
) {
  const periodYyyymm = periodFromEntryDate(entryDate)
  const { data: existing, error: existingError } = await supabase
    .from('oj_projects')
    .select('id, status')
    .eq('vendor_id', vendorId)
    .eq('is_retainer', true)
    .eq('retainer_period_yyyymm', periodYyyymm)
    .maybeSingle()

  if (existingError) return { error: existingError.message }
  if (existing?.id) {
    if (existing.status === 'completed' || existing.status === 'archived') {
      return { error: 'Cannot add entries to a closed retainer' }
    }
    return { projectId: existing.id as string }
  }

  return createRetainerProject(supabase, vendorId, periodYyyymm, includedHours)
}

async function resolveProjectForEntry(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: { projectId?: string | null; vendorId: string; entryDate: string }
) {
  if (input.projectId) {
    const match = await ensureProjectMatchesVendor(supabase, input.projectId, input.vendorId, input.entryDate)
    if ('error' in match) return { error: match.error }
    return { projectId: input.projectId }
  }

  const settings = await getVendorSettingsOrDefault(supabase, input.vendorId)
  const includedHours = Number(settings.retainer_included_hours_per_month || 0)
  if (Number.isFinite(includedHours) && includedHours > 0) {
    return resolveRetainerProject(supabase, input.vendorId, input.entryDate, includedHours)
  }

  return resolveGeneralProject(supabase, input.vendorId)
}

async function getWorkTypeName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workTypeId: string | null
) {
  if (!workTypeId) return null
  const { data } = await supabase
    .from('oj_work_types')
    .select('name')
    .eq('id', workTypeId)
    .maybeSingle()
  return data?.name ? String(data.name) : null
}

type RevisableLinkedInvoice = {
  id: string
  invoice_number: string
  status: string | null
}

type OjInvoiceRevisionResult = {
  invoice_id: string
  invoice_number: string
  previous_total_amount: number
  total_amount: number
  mode: 'updated' | 'replacement'
  voided_invoice_id?: string
  voided_invoice_number?: string
}

function encodeInvoiceSequence(sequence: number): string {
  return `INV-${(sequence + 5000).toString(36).toUpperCase().padStart(5, '0')}`
}

async function generateInvoiceNumber(admin: ReturnType<typeof createAdminClient>): Promise<string> {
  const { data, error } = await admin
    .rpc('get_and_increment_invoice_series', { p_series_code: 'INV' })
    .single()

  if (error) {
    throw new Error(error.message || 'Failed to generate replacement invoice number')
  }

  const sequence = Number((data as { next_sequence?: number } | null)?.next_sequence)
  if (!Number.isFinite(sequence)) {
    throw new Error('Replacement invoice number sequence was invalid')
  }

  return encodeInvoiceSequence(sequence)
}

async function getLinkedInvoiceForRevision(input: {
  invoiceId: string | null
  vendorId: string
}) {
  if (!input.invoiceId) {
    return { error: 'Billed entry is not linked to an invoice' }
  }

  const hasInvoicePermission = await checkUserPermission('invoices', 'edit')
  if (!hasInvoicePermission) {
    return { error: 'You do not have permission to revise linked invoices' }
  }

  const admin = createAdminClient()
  const { data: invoice, error: invoiceError } = await admin
    .from('invoices')
    .select('id, invoice_number, vendor_id, status')
    .eq('id', input.invoiceId)
    .is('deleted_at', null)
    .maybeSingle()

  if (invoiceError) return { error: invoiceError.message }
  if (!invoice) return { error: 'Linked invoice not found' }
  if (invoice.vendor_id !== input.vendorId) {
    return { error: 'Linked invoice does not belong to the entry client' }
  }

  const { count: paymentCount, error: paymentError } = await admin
    .from('invoice_payments')
    .select('id', { count: 'exact', head: true })
    .eq('invoice_id', input.invoiceId)

  if (paymentError) return { error: paymentError.message }

  const blockReason = getOjInvoiceRevisionBlockReason(invoice, paymentCount ?? 0)
  if (blockReason) return { error: blockReason }

  return { invoice: invoice as RevisableLinkedInvoice }
}

function serializeInvoiceLineItems(invoiceId: string, lineItems: Array<{
  catalog_item_id?: string | null
  description: string
  quantity: number
  unit_price: number
  discount_percentage: number
  vat_rate: number
}>) {
  return lineItems.map((item) => ({
    invoice_id: invoiceId,
    catalog_item_id: item.catalog_item_id || null,
    description: item.description,
    quantity: item.quantity,
    unit_price: item.unit_price,
    discount_percentage: item.discount_percentage,
    vat_rate: item.vat_rate,
  }))
}

async function recalculateLinkedOjInvoice(input: {
  invoiceId: string
  changedEntryId: string
  user?: { id?: string | null; email?: string | null } | null
}): Promise<{ invoiceRevision: OjInvoiceRevisionResult } | { error: string }> {
  const admin = createAdminClient()
  const { data: invoice, error: invoiceError } = await admin
    .from('invoices')
    .select('id, invoice_number, vendor_id, invoice_date, due_date, reference, status, total_amount, notes, internal_notes, invoice_discount_percentage')
    .eq('id', input.invoiceId)
    .is('deleted_at', null)
    .maybeSingle()

  if (invoiceError) return { error: invoiceError.message }
  if (!invoice) return { error: 'Linked invoice not found' }

  const { count: paymentCount, error: paymentError } = await admin
    .from('invoice_payments')
    .select('id', { count: 'exact', head: true })
    .eq('invoice_id', input.invoiceId)

  if (paymentError) return { error: paymentError.message }

  const blockReason = getOjInvoiceRevisionBlockReason(invoice, paymentCount ?? 0)
  if (blockReason) return { error: blockReason }

  const invoiceStatus = String(invoice.status || '')
  if (!['draft', 'sent', 'overdue'].includes(invoiceStatus)) {
    return { error: 'Only draft or sent unpaid invoices can be revised from OJ Projects entries' }
  }

  const [
    { data: entries, error: entriesError },
    { data: recurringInstances, error: recurringError },
    { data: settings, error: settingsError },
  ] = await Promise.all([
    admin
      .from('oj_entries')
      .select(`
        id,
        entry_type,
        entry_date,
        project_id,
        duration_minutes_rounded,
        miles,
        hourly_rate_ex_vat_snapshot,
        vat_rate_snapshot,
        mileage_rate_snapshot,
        amount_ex_vat_snapshot,
        billable,
        description,
        work_type_name_snapshot,
        project:oj_projects(
          project_code,
          project_name
        ),
        work_type:oj_work_types(
          name
        )
      `)
      .eq('invoice_id', input.invoiceId)
      .order('entry_date', { ascending: true })
      .order('created_at', { ascending: true }),
    admin
      .from('oj_recurring_charge_instances')
      .select(`
        id,
        period_yyyymm,
        description_snapshot,
        amount_ex_vat_snapshot,
        vat_rate_snapshot,
        sort_order_snapshot,
        recurring_charge:oj_vendor_recurring_charges(
          is_active
        )
      `)
      .eq('invoice_id', input.invoiceId)
      .order('period_end', { ascending: true })
      .order('sort_order_snapshot', { ascending: true })
      .order('created_at', { ascending: true }),
    admin
      .from('oj_vendor_billing_settings')
      .select('hourly_rate_ex_vat, mileage_rate, vat_rate, statement_mode')
      .eq('vendor_id', invoice.vendor_id)
      .maybeSingle(),
  ])

  if (entriesError) return { error: entriesError.message }
  if (recurringError) return { error: recurringError.message }
  if (settingsError) return { error: settingsError.message }

  const revisedAtIso = new Date().toISOString()
  const linkedEntries = (entries || []) as OjInvoiceRevisionEntry[]
  const linkedRecurringInstances = (recurringInstances || []) as OjInvoiceRevisionRecurringInstance[]
  const replacementInvoiceNumber = invoiceStatus === 'draft' ? null : await generateInvoiceNumber(admin)
  const invoiceForRevision = replacementInvoiceNumber
    ? { ...invoice, invoice_number: replacementInvoiceNumber }
    : invoice

  let revision
  try {
    revision = buildOjInvoiceRevision({
      invoice: invoiceForRevision,
      settings,
      entries: linkedEntries,
      recurringInstances: linkedRecurringInstances,
      revisedAtIso,
    })
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to rebuild invoice' }
  }

  const previousTotal = Number(invoice.total_amount || 0)

  if (invoiceStatus !== 'draft') {
    const replacementEntryIds = linkedEntries
      .filter((entry) => entry.billable !== false)
      .map((entry) => entry.id)
    const replacementRecurringIds = linkedRecurringInstances
      .filter((instance) => instance.recurring_charge?.is_active !== false)
      .map((instance) => instance.id)
    const replacementNotes = `Replacement for voided invoice ${invoice.invoice_number}.\n\n${revision.notes}`
    const replacementInternalNotes = `${revision.internalNotes}\n\n[OJ_PROJECTS_REPLACES ${revisedAtIso}] Replaces invoice ${invoice.invoice_number} (${invoice.id}). Replacement created as draft for review before sending.`

    const { data: replacementResult, error: replacementError } = await (admin as any).rpc('replace_oj_invoice_transaction', {
      p_old_invoice_id: input.invoiceId,
      p_replacement_invoice_data: {
        invoice_number: replacementInvoiceNumber,
        vendor_id: invoice.vendor_id,
        invoice_date: invoice.invoice_date,
        due_date: invoice.due_date,
        reference: invoice.reference,
        invoice_discount_percentage: invoice.invoice_discount_percentage || 0,
        subtotal_amount: revision.totals.subtotalBeforeInvoiceDiscount,
        discount_amount: revision.totals.invoiceDiscountAmount,
        vat_amount: revision.totals.vatAmount,
        total_amount: revision.totals.totalAmount,
        notes: replacementNotes,
        internal_notes: replacementInternalNotes,
      },
      p_line_items: revision.lineItems,
      p_entry_ids: replacementEntryIds,
      p_recurring_instance_ids: replacementRecurringIds,
      p_void_reason: `OJ Projects entry revised; replaced by ${replacementInvoiceNumber}`,
      p_changed_entry_id: input.changedEntryId,
    })

    if (replacementError) return { error: replacementError.message || 'Failed to create replacement invoice' }

    const replacementInvoice = (replacementResult as any)?.replacement_invoice
    if (!replacementInvoice?.id || !replacementInvoice?.invoice_number) {
      return { error: 'Replacement invoice was created but the response was invalid' }
    }

    await logAuditEvent({
      user_id: input.user?.id || undefined,
      user_email: input.user?.email || undefined,
      operation_type: 'update',
      resource_type: 'invoice',
      resource_id: input.invoiceId,
      operation_status: 'success',
      old_values: { status: invoice.status, total_amount: previousTotal },
      new_values: {
        status: 'void',
        replacement_invoice_id: replacementInvoice.id,
        replacement_invoice_number: replacementInvoice.invoice_number,
        total_amount: revision.totals.totalAmount,
      },
      additional_info: {
        action: 'oj_projects_invoice_replacement',
        invoice_number: invoice.invoice_number,
        replacement_invoice_number: replacementInvoice.invoice_number,
        changed_entry_id: input.changedEntryId,
      },
    })

    revalidatePath('/invoices')
    revalidatePath(`/invoices/${input.invoiceId}`)
    revalidatePath(`/invoices/${replacementInvoice.id}`)
    revalidatePath('/oj-projects')
    revalidatePath('/oj-projects/entries')
    revalidateTag('dashboard')

    return {
      invoiceRevision: {
        invoice_id: String(replacementInvoice.id),
        invoice_number: String(replacementInvoice.invoice_number),
        previous_total_amount: previousTotal,
        total_amount: Number(replacementInvoice.total_amount || revision.totals.totalAmount),
        mode: 'replacement',
        voided_invoice_id: input.invoiceId,
        voided_invoice_number: String(invoice.invoice_number),
      },
    }
  }

  const { data: updatedInvoice, error: updateError } = await admin
    .from('invoices')
    .update({
      subtotal_amount: revision.totals.subtotalBeforeInvoiceDiscount,
      discount_amount: revision.totals.invoiceDiscountAmount,
      vat_amount: revision.totals.vatAmount,
      total_amount: revision.totals.totalAmount,
      notes: revision.notes,
      internal_notes: revision.internalNotes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.invoiceId)
    .not('status', 'in', '(paid,partially_paid,void,written_off)')
    .is('deleted_at', null)
    .select('id, invoice_number, total_amount')
    .maybeSingle()

  if (updateError) return { error: updateError.message }
  if (!updatedInvoice) return { error: 'Invoice could not be revised because it is no longer unpaid' }

  const { error: deleteLineItemsError } = await admin
    .from('invoice_line_items')
    .delete()
    .eq('invoice_id', input.invoiceId)

  if (deleteLineItemsError) return { error: deleteLineItemsError.message }

  const { error: insertLineItemsError } = await admin
    .from('invoice_line_items')
    .insert(serializeInvoiceLineItems(input.invoiceId, revision.lineItems))

  if (insertLineItemsError) return { error: insertLineItemsError.message }

  const { error: detachNonBillableEntriesError } = await admin
    .from('oj_entries')
    .update({
      invoice_id: null,
      billing_run_id: null,
      status: 'unbilled',
      billed_at: null,
      paid_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('invoice_id', input.invoiceId)
    .eq('billable', false)

  if (detachNonBillableEntriesError) return { error: detachNonBillableEntriesError.message }

  await logAuditEvent({
    user_id: input.user?.id || undefined,
    user_email: input.user?.email || undefined,
    operation_type: 'update',
    resource_type: 'invoice',
    resource_id: input.invoiceId,
    operation_status: 'success',
    old_values: { total_amount: previousTotal },
    new_values: { total_amount: revision.totals.totalAmount },
    additional_info: {
      action: 'oj_projects_invoice_revision',
      invoice_number: invoice.invoice_number,
      changed_entry_id: input.changedEntryId,
    },
  })

  revalidatePath('/invoices')
  revalidatePath(`/invoices/${input.invoiceId}`)
  revalidatePath('/oj-projects')
  revalidatePath('/oj-projects/entries')
  revalidateTag('dashboard')

  return {
    invoiceRevision: {
      invoice_id: input.invoiceId,
      invoice_number: String(updatedInvoice.invoice_number || invoice.invoice_number),
      previous_total_amount: previousTotal,
      total_amount: Number(updatedInvoice.total_amount || revision.totals.totalAmount),
      mode: 'updated',
    },
  }
}

async function buildUpdateEntryResult(input: {
  entry: any
  revisableInvoice: RevisableLinkedInvoice | null
  user?: { id?: string | null; email?: string | null } | null
}) {
  if (!input.revisableInvoice) {
    return { entry: input.entry, success: true as const }
  }

  const revision = await recalculateLinkedOjInvoice({
    invoiceId: input.revisableInvoice.id,
    changedEntryId: input.entry.id,
    user: input.user,
  })

  if ('error' in revision) {
    return {
      entry: input.entry,
      error: `Entry updated, but linked invoice ${input.revisableInvoice.invoice_number} could not be revised: ${revision.error}`,
    }
  }

  return { entry: input.entry, success: true as const, invoiceRevision: revision.invoiceRevision }
}

async function buildDeleteEntryResult(input: {
  entry: { id: string }
  revisableInvoice: RevisableLinkedInvoice | null
  user?: { id?: string | null; email?: string | null } | null
}) {
  if (!input.revisableInvoice) {
    return { success: true as const }
  }

  const revision = await recalculateLinkedOjInvoice({
    invoiceId: input.revisableInvoice.id,
    changedEntryId: input.entry.id,
    user: input.user,
  })

  if ('error' in revision) {
    return {
      error: `Entry deleted, but linked invoice ${input.revisableInvoice.invoice_number} could not be revised: ${revision.error}`,
    }
  }

  return { success: true as const, invoiceRevision: revision.invoiceRevision }
}

export async function getEntries(options?: {
  vendorId?: string
  projectId?: string
  status?: string
  entryType?: string
  startDate?: string
  endDate?: string
  limit?: number
}) {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) return { error: 'You do not have permission to view entries' }

  const supabase = await createClient()
  let query = supabase
    .from('oj_entries')
    .select(`
      *,
      project:oj_projects(
        id,
        project_code,
        project_name,
        is_retainer,
        retainer_period_yyyymm
      ),
      vendor:invoice_vendors(
        id,
        name
      ),
      invoice:invoices(
        id,
        invoice_number,
        status,
        total_amount
      ),
      work_type:oj_work_types(
        id,
        name
      )
    `)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (options?.vendorId) query = query.eq('vendor_id', options.vendorId)
  if (options?.projectId) query = query.eq('project_id', options.projectId)
  if (options?.status && options.status !== 'all') query = query.eq('status', options.status)
  if (options?.entryType && options.entryType !== 'all') query = query.eq('entry_type', options.entryType)
  if (options?.startDate) query = query.gte('entry_date', options.startDate)
  if (options?.endDate) query = query.lte('entry_date', options.endDate)
  if (options?.limit) query = query.limit(options.limit)

  const { data, error } = await query
  if (error) return { error: error.message }
  return { entries: data || [] }
}

export async function createTimeEntry(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'create')
  if (!hasPermission) return { error: 'You do not have permission to create entries' }

  const parsed = TimeEntrySchema.safeParse({
    vendor_id: formData.get('vendor_id'),
    project_id: formData.get('project_id') || undefined,
    entry_date: formData.get('entry_date'),
    duration_minutes: formData.get('duration_minutes'),
    work_type_id: formData.get('work_type_id') || undefined,
    description: formData.get('description') || undefined,
    internal_notes: formData.get('internal_notes') || undefined,
    billable: formData.get('billable') ?? undefined,
  })
  if (!parsed.success) return { error: parsed.error.errors[0].message }

  const rawMinutes = parsed.data.duration_minutes
  const roundedMinutes = Math.ceil(rawMinutes / 15) * 15
  if (roundedMinutes <= 0) return { error: 'Invalid duration after rounding' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const projectResolution = await resolveProjectForEntry(supabase, {
    projectId: parsed.data.project_id || null,
    vendorId: parsed.data.vendor_id,
    entryDate: parsed.data.entry_date,
  })
  if ('error' in projectResolution) return { error: projectResolution.error }

  const workTypeId = parsed.data.work_type_id ? String(parsed.data.work_type_id) : null
  const [settings, workTypeName] = await Promise.all([
    getVendorSettingsOrDefault(supabase, parsed.data.vendor_id),
    getWorkTypeName(supabase, workTypeId),
  ])

  const { data, error } = await supabase
    .from('oj_entries')
    .insert({
      vendor_id: parsed.data.vendor_id,
      project_id: projectResolution.projectId,
      entry_type: 'time',
      entry_date: parsed.data.entry_date,
      start_at: null,
      end_at: null,
      duration_minutes_raw: rawMinutes,
      duration_minutes_rounded: roundedMinutes,
      miles: null,
      work_type_id: workTypeId,
      work_type_name_snapshot: workTypeName,
      description: parsed.data.description || null,
      internal_notes: parsed.data.internal_notes || null,
      billable: parsed.data.billable ?? true,
      status: 'unbilled',
      hourly_rate_ex_vat_snapshot: settings.hourly_rate_ex_vat,
      vat_rate_snapshot: settings.vat_rate,
      mileage_rate_snapshot: null,
    })
    .select('*')
    .single()

  if (error) return { error: error.message }

  await logAuditEvent({
    user_id: user?.id,
    user_email: user?.email,
    operation_type: 'create',
    resource_type: 'oj_entry',
    resource_id: data.id,
    operation_status: 'success',
    new_values: {
      entry_type: 'time',
      project_id: data.project_id,
      entry_date: data.entry_date,
      duration_minutes_rounded: data.duration_minutes_rounded,
    },
  })

  return { entry: data, success: true as const }
}

export async function createMileageEntry(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'create')
  if (!hasPermission) return { error: 'You do not have permission to create entries' }

  const parsed = MileageEntrySchema.safeParse({
    vendor_id: formData.get('vendor_id'),
    project_id: formData.get('project_id') || undefined,
    entry_date: formData.get('entry_date'),
    miles: formData.get('miles'),
    description: formData.get('description') || undefined,
    internal_notes: formData.get('internal_notes') || undefined,
    billable: formData.get('billable') ?? undefined,
  })
  if (!parsed.success) return { error: parsed.error.errors[0].message }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const projectResolution = await resolveProjectForEntry(supabase, {
    projectId: parsed.data.project_id || null,
    vendorId: parsed.data.vendor_id,
    entryDate: parsed.data.entry_date,
  })
  if ('error' in projectResolution) return { error: projectResolution.error }

  const settings = await getVendorSettingsOrDefault(supabase, parsed.data.vendor_id)

  const { data, error } = await supabase
    .from('oj_entries')
    .insert({
      vendor_id: parsed.data.vendor_id,
      project_id: projectResolution.projectId,
      entry_type: 'mileage',
      entry_date: parsed.data.entry_date,
      start_at: null,
      end_at: null,
      duration_minutes_raw: null,
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
    operation_type: 'create',
    resource_type: 'oj_entry',
    resource_id: data.id,
    operation_status: 'success',
    new_values: { entry_type: 'mileage', project_id: data.project_id, entry_date: data.entry_date, miles: data.miles },
  })

  // Trigger has synced this mileage entry to mileage_trips with default rates.
  // Recalculate HMRC rate splits for the entire tax year so cumulative thresholds
  // are applied correctly across all trips.
  await recalculateTaxYearMileage(parsed.data.entry_date)

  return { entry: data, success: true as const }
}

export async function createOneOffCharge(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'create')
  if (!hasPermission) return { error: 'You do not have permission to create entries' }

  const parsed = OneOffChargeSchema.safeParse({
    vendor_id: formData.get('vendor_id'),
    project_id: formData.get('project_id') || undefined,
    entry_date: formData.get('entry_date'),
    amount_ex_vat: formData.get('amount_ex_vat'),
    description: formData.get('description') || undefined,
    internal_notes: formData.get('internal_notes') || undefined,
    billable: formData.get('billable') ?? undefined,
  })
  if (!parsed.success) return { error: parsed.error.errors[0].message }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const projectResolution = await resolveProjectForEntry(supabase, {
    projectId: parsed.data.project_id || null,
    vendorId: parsed.data.vendor_id,
    entryDate: parsed.data.entry_date,
  })
  if ('error' in projectResolution) return { error: projectResolution.error }

  const settings = await getVendorSettingsOrDefault(supabase, parsed.data.vendor_id)

  const { data, error } = await supabase
    .from('oj_entries')
    .insert({
      vendor_id: parsed.data.vendor_id,
      project_id: projectResolution.projectId,
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
      amount_ex_vat_snapshot: parsed.data.amount_ex_vat,
    })
    .select('*')
    .single()

  if (error) return { error: error.message }

  await logAuditEvent({
    user_id: user?.id,
    user_email: user?.email,
    operation_type: 'create',
    resource_type: 'oj_entry',
    resource_id: data.id,
    operation_status: 'success',
    new_values: { entry_type: 'one_off', project_id: data.project_id, entry_date: data.entry_date, amount_ex_vat_snapshot: data.amount_ex_vat_snapshot },
  })

  return { entry: data, success: true as const }
}

export async function updateEntry(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'edit')
  if (!hasPermission) return { error: 'You do not have permission to edit entries' }

  const parsed = UpdateEntrySchema.safeParse({
    id: formData.get('id'),
    entry_type: formData.get('entry_type'),
    vendor_id: formData.get('vendor_id'),
    project_id: formData.get('project_id') || undefined,
    entry_date: formData.get('entry_date'),
    duration_minutes: formData.get('duration_minutes') || undefined,
    miles: formData.get('miles') ?? undefined,
    amount_ex_vat: formData.get('amount_ex_vat') || undefined,
    work_type_id: formData.get('work_type_id') || undefined,
    description: formData.get('description') || undefined,
    internal_notes: formData.get('internal_notes') || undefined,
    billable: formData.get('billable') ?? undefined,
  })
  if (!parsed.success) return { error: parsed.error.errors[0].message }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: existing, error: fetchError } = await supabase
    .from('oj_entries')
    .select('id, status, start_at, end_at, entry_type, entry_date, invoice_id, vendor_id')
    .eq('id', parsed.data.id)
    .single()

  if (fetchError || !existing) return { error: fetchError?.message || 'Entry not found' }
  let revisableInvoice: RevisableLinkedInvoice | null = null
  if (existing.status !== 'unbilled') {
    if (!['billed', 'billing_pending'].includes(String(existing.status))) {
      return { error: 'Only unbilled or unpaid invoiced entries can be edited' }
    }

    const invoiceCheck = await getLinkedInvoiceForRevision({
      invoiceId: existing.invoice_id,
      vendorId: existing.vendor_id,
    })
    if ('error' in invoiceCheck) return { error: invoiceCheck.error }
    revisableInvoice = invoiceCheck.invoice
  }

  const projectResolution = await resolveProjectForEntry(supabase, {
    projectId: parsed.data.project_id || null,
    vendorId: parsed.data.vendor_id,
    entryDate: parsed.data.entry_date,
  })
  if ('error' in projectResolution) return { error: projectResolution.error }

  const entryWorkTypeId = parsed.data.entry_type === 'time' && parsed.data.work_type_id
    ? String(parsed.data.work_type_id)
    : null
  const [settings, preloadedWorkTypeName] = await Promise.all([
    getVendorSettingsOrDefault(supabase, parsed.data.vendor_id),
    parsed.data.entry_type === 'time' ? getWorkTypeName(supabase, entryWorkTypeId) : Promise.resolve(null),
  ])

  if (parsed.data.entry_type === 'time') {
    if (!parsed.data.duration_minutes) {
      return { error: 'Duration is required for time entries' }
    }

    const rawMinutes = parsed.data.duration_minutes
    const roundedMinutes = Math.ceil(rawMinutes / 15) * 15
    if (roundedMinutes <= 0) return { error: 'Invalid duration after rounding' }

    const workTypeId = entryWorkTypeId
    const workTypeName = preloadedWorkTypeName

    const { data, error } = await supabase
      .from('oj_entries')
      .update({
        vendor_id: parsed.data.vendor_id,
        project_id: projectResolution.projectId,
        entry_type: 'time',
        entry_date: parsed.data.entry_date,
        start_at: existing.start_at ?? null,
        end_at: existing.end_at ?? null,
        duration_minutes_raw: rawMinutes,
        duration_minutes_rounded: roundedMinutes,
        miles: null,
        amount_ex_vat_snapshot: null,
        work_type_id: workTypeId,
        work_type_name_snapshot: workTypeName,
        description: parsed.data.description ?? null,
        internal_notes: parsed.data.internal_notes ?? null,
        billable: parsed.data.billable ?? true,
        hourly_rate_ex_vat_snapshot: settings.hourly_rate_ex_vat,
        vat_rate_snapshot: settings.vat_rate,
        mileage_rate_snapshot: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parsed.data.id)
      .select('*')
      .maybeSingle()

    if (error) return { error: error.message }
    if (!data) return { error: 'Entry not found' }

    await logAuditEvent({
      user_id: user?.id,
      user_email: user?.email,
      operation_type: 'update',
      resource_type: 'oj_entry',
      resource_id: parsed.data.id,
      operation_status: 'success',
      new_values: { entry_type: 'time', duration_minutes_rounded: roundedMinutes },
    })

    // If the entry was previously mileage, the trigger deleted the synced
    // mileage_trips row. Recalculate the affected tax year.
    if (existing.entry_type === 'mileage') {
      await recalculateTaxYearMileage(existing.entry_date)
    }

    return buildUpdateEntryResult({ entry: data, revisableInvoice, user })
  }

  // one_off
  if (parsed.data.entry_type === 'one_off') {
    if (typeof parsed.data.amount_ex_vat !== 'number' || !Number.isFinite(parsed.data.amount_ex_vat) || parsed.data.amount_ex_vat <= 0) {
      return { error: 'Amount must be greater than 0' }
    }

    const { data, error } = await supabase
      .from('oj_entries')
      .update({
        vendor_id: parsed.data.vendor_id,
        project_id: projectResolution.projectId,
        entry_type: 'one_off',
        entry_date: parsed.data.entry_date,
        start_at: null,
        end_at: null,
        duration_minutes_raw: null,
        duration_minutes_rounded: null,
        miles: null,
        work_type_id: null,
        work_type_name_snapshot: null,
        amount_ex_vat_snapshot: parsed.data.amount_ex_vat,
        description: parsed.data.description ?? null,
        internal_notes: parsed.data.internal_notes ?? null,
        billable: parsed.data.billable ?? true,
        hourly_rate_ex_vat_snapshot: null,
        vat_rate_snapshot: settings.vat_rate,
        mileage_rate_snapshot: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parsed.data.id)
      .select('*')
      .maybeSingle()

    if (error) return { error: error.message }
    if (!data) return { error: 'Entry not found' }

    await logAuditEvent({
      user_id: user?.id,
      user_email: user?.email,
      operation_type: 'update',
      resource_type: 'oj_entry',
      resource_id: parsed.data.id,
      operation_status: 'success',
      new_values: { entry_type: 'one_off', amount_ex_vat_snapshot: parsed.data.amount_ex_vat },
    })

    // If the entry was previously mileage, the trigger deleted the synced
    // mileage_trips row. Recalculate the affected tax year.
    if (existing.entry_type === 'mileage') {
      await recalculateTaxYearMileage(existing.entry_date)
    }

    return buildUpdateEntryResult({ entry: data, revisableInvoice, user })
  }

  // mileage
  if (typeof parsed.data.miles !== 'number' || !Number.isFinite(parsed.data.miles) || parsed.data.miles <= 0) {
    return { error: 'Miles must be greater than 0' }
  }

  const { data, error } = await supabase
    .from('oj_entries')
    .update({
      vendor_id: parsed.data.vendor_id,
      project_id: projectResolution.projectId,
      entry_type: 'mileage',
      entry_date: parsed.data.entry_date,
      start_at: null,
      end_at: null,
      duration_minutes_raw: null,
      duration_minutes_rounded: null,
      miles: parsed.data.miles,
      work_type_id: null,
      work_type_name_snapshot: null,
      amount_ex_vat_snapshot: null,
      description: parsed.data.description ?? null,
      internal_notes: parsed.data.internal_notes ?? null,
      billable: parsed.data.billable ?? true,
      hourly_rate_ex_vat_snapshot: null,
      mileage_rate_snapshot: settings.mileage_rate,
      vat_rate_snapshot: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.id)
    .select('*')
    .maybeSingle()

  if (error) return { error: error.message }
  if (!data) return { error: 'Entry not found' }

  await logAuditEvent({
    user_id: user?.id,
    user_email: user?.email,
    operation_type: 'update',
    resource_type: 'oj_entry',
    resource_id: parsed.data.id,
    operation_status: 'success',
    new_values: { entry_type: 'mileage', miles: parsed.data.miles },
  })

  // Trigger has updated the synced mileage_trips row with default rates.
  // Recalculate HMRC rate splits for the affected tax year.
  // If the date moved across a tax year boundary, recalculate both years.
  await recalculateTaxYearMileage(parsed.data.entry_date)
  if (existing.entry_type === 'mileage' && existing.entry_date !== parsed.data.entry_date) {
    const oldBounds = getTaxYearBounds(existing.entry_date)
    const newBounds = getTaxYearBounds(parsed.data.entry_date)
    if (oldBounds.start !== newBounds.start) {
      await recalculateTaxYearMileage(existing.entry_date)
    }
  }

  return buildUpdateEntryResult({ entry: data, revisableInvoice, user })
}

export async function deleteEntry(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'delete')
  if (!hasPermission) return { error: 'You do not have permission to delete entries' }

  const id = String(formData.get('id') || '')
  if (!id) return { error: 'Entry ID is required' }

  // L16: Validate UUID format before using in DB query
  if (!z.string().uuid().safeParse(id).success) return { error: 'Invalid entry ID' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: entry, error: fetchError } = await supabase
    .from('oj_entries')
    .select('id, status, entry_type, entry_date, invoice_id, vendor_id')
    .eq('id', id)
    .single()

  if (fetchError || !entry) return { error: fetchError?.message || 'Entry not found' }
  let revisableInvoice: RevisableLinkedInvoice | null = null
  if (entry.status !== 'unbilled') {
    if (!['billed', 'billing_pending'].includes(String(entry.status))) {
      return { error: 'Only unbilled or unpaid invoiced entries can be deleted' }
    }

    const invoiceCheck = await getLinkedInvoiceForRevision({
      invoiceId: entry.invoice_id,
      vendorId: entry.vendor_id,
    })
    if ('error' in invoiceCheck) return { error: invoiceCheck.error }
    revisableInvoice = invoiceCheck.invoice
  }

  const { data: deletedEntry, error } = await supabase
    .from('oj_entries')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) return { error: error.message }
  if (!deletedEntry) return { error: 'Entry not found' }

  await logAuditEvent({
    user_id: user?.id,
    user_email: user?.email,
    operation_type: 'delete',
    resource_type: 'oj_entry',
    resource_id: id,
    operation_status: 'success',
  })

  // If the deleted entry was mileage, the trigger removed the synced
  // mileage_trips row. Recalculate the affected tax year.
  if (entry.entry_type === 'mileage') {
    await recalculateTaxYearMileage(entry.entry_date)
  }

  return buildDeleteEntryResult({ entry: deletedEntry, revisableInvoice, user })
}
