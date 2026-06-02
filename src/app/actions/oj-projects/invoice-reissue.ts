'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  buildOjInvoiceRevision,
  type OjInvoiceRevisionEntry,
  type OjInvoiceRevisionRecurringInstance,
} from '@/lib/oj-projects/invoice-revision'
import type { InvoiceLineItemInput } from '@/types/invoices'

type ReissueMode = 'rebuild_draft' | 'replacement'

type Period = {
  period_start: string
  period_end: string
  period_yyyymm: string
  label: string
}

type SourceInvoice = {
  id: string
  invoice_number: string
  vendor_id: string
  vendor_name: string | null
  status: string
  invoice_date: string
  due_date: string
  reference: string | null
  invoice_discount_percentage: number | null
  total_amount: number | null
  paid_amount: number | null
  notes: string | null
  internal_notes: string | null
}

type PreviewEntry = {
  id: string
  entry_date: string
  project_name: string
  project_code: string | null
  description: string | null
  entry_type: string
  quantity_label: string
  amount_ex_vat: number
  status: string
  invoice_number: string | null
  reason?: string
}

type PreviewRecurring = {
  id: string
  recurring_charge_id: string | null
  description: string
  period_yyyymm: string
  amount_ex_vat: number
  vat_rate: number
  status: string
  invoice_number: string | null
  is_virtual: boolean
  reason?: string
}

type VirtualRecurringInstance = {
  vendor_id: string
  recurring_charge_id: string
  period_yyyymm: string
  period_start: string
  period_end: string
  description_snapshot: string
  amount_ex_vat_snapshot: number
  vat_rate_snapshot: number
  sort_order_snapshot: number
}

export type OjInvoiceReissuePreview =
  | {
      eligible: false
      error: string
      sourceInvoice?: SourceInvoice
      period?: Period
      warnings?: string[]
    }
  | {
      eligible: true
      mode: ReissueMode
      actionLabel: string
      sourceInvoice: SourceInvoice
      period: Period
      includedEntries: PreviewEntry[]
      includedRecurring: PreviewRecurring[]
      excludedEntries: PreviewEntry[]
      excludedRecurring: PreviewRecurring[]
      warnings: string[]
      lineItems: InvoiceLineItemInput[]
      totals: {
        subtotalBeforeInvoiceDiscount: number
        invoiceDiscountAmount: number
        vatAmount: number
        totalAmount: number
      }
      invoiceNotes: string
      internalNotes: string
    }

function roundMoney(value: number): number {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

function encodeInvoiceSequence(sequence: number): string {
  return `INV-${(sequence + 5000).toString(36).toUpperCase().padStart(5, '0')}`
}

async function generateInvoiceNumber(admin: ReturnType<typeof createAdminClient>): Promise<string> {
  const { data, error } = await admin
    .rpc('get_and_increment_invoice_series', { p_series_code: 'INV' })
    .single()

  if (error) throw new Error(error.message || 'Failed to generate invoice number')
  const sequence = Number((data as { next_sequence?: number } | null)?.next_sequence)
  if (!Number.isFinite(sequence)) throw new Error('Invoice number sequence was invalid')
  return encodeInvoiceSequence(sequence)
}

function parseOjPeriodFromReference(reference: string | null | undefined): Period | null {
  const match = String(reference || '').match(/OJ Projects\s+(\d{4})-(\d{2})/i)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null
  const periodStart = `${year}-${String(month).padStart(2, '0')}-01`
  const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
  return {
    period_start: periodStart,
    period_end: periodEnd,
    period_yyyymm: `${year}-${String(month).padStart(2, '0')}`,
    label,
  }
}

function periodFromEntryDate(entryDate: string): Period | null {
  const match = String(entryDate || '').match(/^(\d{4})-(\d{2})-\d{2}$/)
  if (!match) return null
  return parseOjPeriodFromReference(`OJ Projects ${match[1]}-${match[2]}`)
}

function getRecurringChargePeriod(
  frequency: string | null | undefined,
  billingPeriod: Period
): Omit<Period, 'label'> | null {
  const rawFrequency = String(frequency || 'monthly')
  if (rawFrequency === 'monthly') return billingPeriod

  const endDate = new Date(`${billingPeriod.period_end}T00:00:00.000Z`)
  const month = endDate.getUTCMonth() + 1
  const year = endDate.getUTCFullYear()

  if (rawFrequency === 'quarterly') {
    if (month % 3 !== 0) return null
    const quarter = Math.ceil(month / 3)
    const qStart = new Date(Date.UTC(year, (quarter - 1) * 3, 1)).toISOString().slice(0, 10)
    const qEnd = new Date(Date.UTC(year, quarter * 3, 0)).toISOString().slice(0, 10)
    return {
      period_yyyymm: `${year}-Q${quarter}`,
      period_start: qStart,
      period_end: qEnd,
    }
  }

  if (rawFrequency === 'yearly' || rawFrequency === 'annually') {
    if (month !== 12) return null
    return {
      period_yyyymm: String(year),
      period_start: `${year}-01-01`,
      period_end: `${year}-12-31`,
    }
  }

  return billingPeriod
}

function getEntryAmount(entry: any, settings: any): number {
  if (entry.entry_type === 'mileage') {
    return roundMoney(Number(entry.miles || 0) * Number(entry.mileage_rate_snapshot ?? settings?.mileage_rate ?? 0.55))
  }
  if (entry.entry_type === 'one_off') {
    return roundMoney(Number(entry.amount_ex_vat_snapshot || 0))
  }
  return roundMoney((Number(entry.duration_minutes_rounded || 0) / 60) * Number(entry.hourly_rate_ex_vat_snapshot ?? settings?.hourly_rate_ex_vat ?? 75))
}

function getEntryQuantityLabel(entry: any): string {
  if (entry.entry_type === 'time') return `${(Number(entry.duration_minutes_rounded || 0) / 60).toFixed(2)}h`
  if (entry.entry_type === 'mileage') return `${Number(entry.miles || 0).toFixed(2)} mi`
  return '-'
}

function toPreviewEntry(entry: any, settings: any, reason?: string): PreviewEntry {
  return {
    id: String(entry.id),
    entry_date: String(entry.entry_date || ''),
    project_name: String(entry.project?.project_name || 'Unknown project'),
    project_code: entry.project?.project_code ? String(entry.project.project_code) : null,
    description: entry.description ? String(entry.description) : null,
    entry_type: String(entry.entry_type || ''),
    quantity_label: getEntryQuantityLabel(entry),
    amount_ex_vat: getEntryAmount(entry, settings),
    status: String(entry.status || ''),
    invoice_number: entry.invoice?.invoice_number ? String(entry.invoice.invoice_number) : null,
    reason,
  }
}

function toPreviewRecurring(instance: any, reason?: string): PreviewRecurring {
  return {
    id: String(instance.id),
    recurring_charge_id: instance.recurring_charge_id ? String(instance.recurring_charge_id) : null,
    description: String(instance.description_snapshot || ''),
    period_yyyymm: String(instance.period_yyyymm || ''),
    amount_ex_vat: roundMoney(Number(instance.amount_ex_vat_snapshot || 0)),
    vat_rate: Number(instance.vat_rate_snapshot || 0),
    status: String(instance.status || 'unbilled'),
    invoice_number: instance.invoice?.invoice_number ? String(instance.invoice.invoice_number) : null,
    is_virtual: String(instance.id || '').startsWith('virtual:'),
    reason,
  }
}

function actionLabelForMode(mode: ReissueMode, status: string): string {
  if (mode === 'rebuild_draft') return 'Rebuild Draft'
  if (status === 'void') return 'Create Replacement Draft'
  return 'Void and Create Replacement Draft'
}

function getModeForInvoice(invoice: SourceInvoice): ReissueMode | { error: string } {
  if (invoice.status === 'draft') return 'rebuild_draft'
  if (['sent', 'overdue', 'void'].includes(invoice.status)) return 'replacement'
  if (['paid', 'partially_paid', 'written_off'].includes(invoice.status)) {
    return { error: 'Paid, partially paid, and written off invoices cannot be reissued from OJ Projects.' }
  }
  return { error: 'Only draft, sent, overdue, or void OJ invoices can be reissued.' }
}

async function resolveInvoicePeriod(admin: ReturnType<typeof createAdminClient>, invoice: SourceInvoice): Promise<Period | { error: string }> {
  const fromReference = parseOjPeriodFromReference(invoice.reference)
  if (fromReference) return fromReference

  const { data: linkedEntry, error: linkedEntryError } = await admin
    .from('oj_entries')
    .select('entry_date')
    .eq('invoice_id', invoice.id)
    .order('entry_date', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (linkedEntryError) return { error: linkedEntryError.message }
  const fromEntry = periodFromEntryDate(String(linkedEntry?.entry_date || ''))
  if (fromEntry) return fromEntry

  const { data: linkedRecurring, error: recurringError } = await admin
    .from('oj_recurring_charge_instances')
    .select('period_yyyymm')
    .eq('invoice_id', invoice.id)
    .order('period_end', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (recurringError) return { error: recurringError.message }
  const recurringPeriod = String(linkedRecurring?.period_yyyymm || '').match(/^(\d{4})-(\d{2})$/)
  if (recurringPeriod) return parseOjPeriodFromReference(`OJ Projects ${recurringPeriod[1]}-${recurringPeriod[2]}`)!

  return { error: 'This invoice is not linked to a monthly OJ Projects billing period.' }
}

async function buildReissuePreview(invoiceId: string, options?: { replacementInvoiceNumber?: string }): Promise<OjInvoiceReissuePreview & { virtualRecurringInstances?: VirtualRecurringInstance[] }> {
  const admin = createAdminClient()

  const { data: invoiceRow, error: invoiceError } = await admin
    .from('invoices')
    .select(`
      id,
      invoice_number,
      vendor_id,
      invoice_date,
      due_date,
      reference,
      status,
      invoice_discount_percentage,
      total_amount,
      paid_amount,
      notes,
      internal_notes,
      vendor:invoice_vendors(name)
    `)
    .eq('id', invoiceId)
    .is('deleted_at', null)
    .maybeSingle()

  if (invoiceError) return { eligible: false, error: invoiceError.message }
  if (!invoiceRow) return { eligible: false, error: 'Invoice not found' }

  const invoice: SourceInvoice = {
    ...invoiceRow,
    vendor_name: (invoiceRow as any).vendor?.name || null,
    status: String(invoiceRow.status || ''),
    reference: invoiceRow.reference || null,
    notes: invoiceRow.notes || null,
    internal_notes: invoiceRow.internal_notes || null,
  } as SourceInvoice

  const period = await resolveInvoicePeriod(admin, invoice)
  if ('error' in period) return { eligible: false, error: period.error, sourceInvoice: invoice }

  const mode = getModeForInvoice(invoice)
  if (typeof mode !== 'string') return { eligible: false, error: mode.error, sourceInvoice: invoice, period }
  if (Number(invoice.paid_amount || 0) > 0) {
    return {
      eligible: false,
      error: 'Cannot reissue an invoice after a payment has been recorded. Issue a credit note instead.',
      sourceInvoice: invoice,
      period,
    }
  }

  const { count: paymentCount, error: paymentError } = await admin
    .from('invoice_payments')
    .select('id', { count: 'exact', head: true })
    .eq('invoice_id', invoice.id)
  if (paymentError) return { eligible: false, error: paymentError.message, sourceInvoice: invoice, period }
  if ((paymentCount ?? 0) > 0) {
    return {
      eligible: false,
      error: 'Cannot reissue an invoice after a payment has been recorded. Issue a credit note instead.',
      sourceInvoice: invoice,
      period,
    }
  }

  const [
    { data: settings, error: settingsError },
    { data: entries, error: entriesError },
    { data: olderUnbilledEntries, error: olderEntriesError },
    { data: activeCharges, error: activeChargesError },
    { data: recurringInstances, error: recurringInstancesError },
    { data: sourceRecurringInstances, error: sourceRecurringError },
  ] = await Promise.all([
    admin
      .from('oj_vendor_billing_settings')
      .select('hourly_rate_ex_vat, mileage_rate, vat_rate, statement_mode')
      .eq('vendor_id', invoice.vendor_id)
      .maybeSingle(),
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
        status,
        invoice_id,
        project:oj_projects(project_code, project_name),
        work_type:oj_work_types(name),
        invoice:invoices(id, invoice_number, status)
      `)
      .eq('vendor_id', invoice.vendor_id)
      .gte('entry_date', period.period_start)
      .lte('entry_date', period.period_end)
      .order('entry_date', { ascending: true })
      .order('created_at', { ascending: true }),
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
        status,
        invoice_id,
        project:oj_projects(project_code, project_name),
        work_type:oj_work_types(name),
        invoice:invoices(id, invoice_number, status)
      `)
      .eq('vendor_id', invoice.vendor_id)
      .eq('billable', true)
      .eq('status', 'unbilled')
      .lt('entry_date', period.period_start)
      .limit(10000),
    admin
      .from('oj_vendor_recurring_charges')
      .select('id, description, amount_ex_vat, vat_rate, sort_order, frequency, is_active, created_at')
      .eq('vendor_id', invoice.vendor_id)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    admin
      .from('oj_recurring_charge_instances')
      .select(`
        id,
        vendor_id,
        recurring_charge_id,
        period_yyyymm,
        period_start,
        period_end,
        description_snapshot,
        amount_ex_vat_snapshot,
        vat_rate_snapshot,
        sort_order_snapshot,
        status,
        invoice_id,
        created_at,
        recurring_charge:oj_vendor_recurring_charges(is_active),
        invoice:invoices(id, invoice_number, status)
      `)
      .eq('vendor_id', invoice.vendor_id)
      .gte('period_end', period.period_start)
      .lte('period_end', period.period_end)
      .order('period_end', { ascending: true })
      .order('sort_order_snapshot', { ascending: true })
      .order('created_at', { ascending: true }),
    admin
      .from('oj_recurring_charge_instances')
      .select(`
        id,
        vendor_id,
        recurring_charge_id,
        period_yyyymm,
        period_start,
        period_end,
        description_snapshot,
        amount_ex_vat_snapshot,
        vat_rate_snapshot,
        sort_order_snapshot,
        status,
        invoice_id,
        created_at,
        recurring_charge:oj_vendor_recurring_charges(is_active),
        invoice:invoices(id, invoice_number, status)
      `)
      .eq('invoice_id', invoice.id)
      .order('period_end', { ascending: true })
      .order('sort_order_snapshot', { ascending: true })
      .order('created_at', { ascending: true }),
  ])

  if (settingsError) return { eligible: false, error: settingsError.message, sourceInvoice: invoice, period }
  if (entriesError) return { eligible: false, error: entriesError.message, sourceInvoice: invoice, period }
  if (olderEntriesError) return { eligible: false, error: olderEntriesError.message, sourceInvoice: invoice, period }
  if (activeChargesError) return { eligible: false, error: activeChargesError.message, sourceInvoice: invoice, period }
  if (recurringInstancesError) return { eligible: false, error: recurringInstancesError.message, sourceInvoice: invoice, period }
  if (sourceRecurringError) return { eligible: false, error: sourceRecurringError.message, sourceInvoice: invoice, period }

  const warnings: string[] = []
  if ((olderUnbilledEntries || []).length > 0) {
    warnings.push(`${olderUnbilledEntries!.length} older unbilled OJ entr${olderUnbilledEntries!.length === 1 ? 'y is' : 'ies are'} excluded because this reissue is month-only.`)
  }

  const includedEntries: any[] = []
  const excludedEntries: PreviewEntry[] = (olderUnbilledEntries || []).map((entry) =>
    toPreviewEntry(entry, settings, 'Older unbilled item outside this invoice month')
  )
  for (const entry of entries || []) {
    const linkedInvoiceId = entry.invoice_id ? String(entry.invoice_id) : null
    const linkedStatus = String((entry as any).invoice?.status || '')
    if (entry.billable === false) {
      excludedEntries.push(toPreviewEntry(entry, settings, 'Non-billable'))
    } else if (entry.status === 'paid') {
      excludedEntries.push(toPreviewEntry(entry, settings, 'Paid OJ entry'))
    } else if (linkedInvoiceId && linkedInvoiceId !== invoice.id) {
      excludedEntries.push(toPreviewEntry(entry, settings, linkedStatus === 'void' ? 'Linked to another invoice' : 'Linked to another active invoice'))
    } else {
      includedEntries.push(entry)
    }
  }

  const dueChargePeriods = new Map<string, Omit<Period, 'label'>>()
  const virtualRecurringInstances: VirtualRecurringInstance[] = []
  const allRecurringInstances = new Map<string, any>()
  for (const instance of [...(recurringInstances || []), ...(sourceRecurringInstances || [])]) {
    allRecurringInstances.set(String(instance.id), instance)
  }
  const existingByChargePeriod = new Set(
    [...allRecurringInstances.values()].map((instance: any) => `${instance.recurring_charge_id}:${instance.period_yyyymm}`)
  )

  for (const charge of activeCharges || []) {
    if (charge.is_active === false) continue
    const chargePeriod = getRecurringChargePeriod(String(charge.frequency || 'monthly'), period)
    if (!chargePeriod) continue
    dueChargePeriods.set(`${charge.id}:${chargePeriod.period_yyyymm}`, chargePeriod)
    const existingKey = `${charge.id}:${chargePeriod.period_yyyymm}`
    if (existingByChargePeriod.has(existingKey)) continue
    const virtualId = `virtual:${charge.id}:${chargePeriod.period_yyyymm}`
    const virtual = {
      id: virtualId,
      vendor_id: invoice.vendor_id,
      recurring_charge_id: String(charge.id),
      period_yyyymm: chargePeriod.period_yyyymm,
      period_start: chargePeriod.period_start,
      period_end: chargePeriod.period_end,
      description_snapshot: String(charge.description || ''),
      amount_ex_vat_snapshot: roundMoney(Number(charge.amount_ex_vat || 0)),
      vat_rate_snapshot: Number(charge.vat_rate || 0),
      sort_order_snapshot: Number(charge.sort_order || 0),
      status: 'unbilled',
      invoice_id: null,
      created_at: charge.created_at,
      recurring_charge: { is_active: true },
      invoice: null,
    }
    allRecurringInstances.set(virtualId, virtual)
    virtualRecurringInstances.push({
      vendor_id: invoice.vendor_id,
      recurring_charge_id: String(charge.id),
      period_yyyymm: chargePeriod.period_yyyymm,
      period_start: chargePeriod.period_start,
      period_end: chargePeriod.period_end,
      description_snapshot: String(charge.description || ''),
      amount_ex_vat_snapshot: roundMoney(Number(charge.amount_ex_vat || 0)),
      vat_rate_snapshot: Number(charge.vat_rate || 0),
      sort_order_snapshot: Number(charge.sort_order || 0),
    })
  }

  const includedRecurring: any[] = []
  const excludedRecurring: PreviewRecurring[] = []
  for (const instance of allRecurringInstances.values()) {
    const key = `${instance.recurring_charge_id}:${instance.period_yyyymm}`
    const linkedInvoiceId = instance.invoice_id ? String(instance.invoice_id) : null
    const chargeActive = instance.recurring_charge?.is_active !== false
    if (!chargeActive) {
      excludedRecurring.push(toPreviewRecurring(instance, 'Recurring charge disabled'))
    } else if (!dueChargePeriods.has(key)) {
      excludedRecurring.push(toPreviewRecurring(instance, 'Not due in this invoice month'))
    } else if (instance.status === 'paid') {
      excludedRecurring.push(toPreviewRecurring(instance, 'Paid recurring charge'))
    } else if (linkedInvoiceId && linkedInvoiceId !== invoice.id) {
      excludedRecurring.push(toPreviewRecurring(instance, 'Linked to another active invoice'))
    } else {
      includedRecurring.push(instance)
    }
  }

  const replacementInvoiceNumber = options?.replacementInvoiceNumber || invoice.invoice_number
  let revision
  try {
    revision = buildOjInvoiceRevision({
      invoice: { ...invoice, invoice_number: replacementInvoiceNumber },
      settings,
      entries: includedEntries as OjInvoiceRevisionEntry[],
      recurringInstances: includedRecurring as OjInvoiceRevisionRecurringInstance[],
      revisedAtIso: new Date().toISOString(),
    })
  } catch (error) {
    return {
      eligible: false,
      error: error instanceof Error && error.message.includes('no billable')
        ? 'No billable OJ Projects items found for this invoice month.'
        : error instanceof Error ? error.message : 'Failed to build OJ invoice preview',
      sourceInvoice: invoice,
      period,
      warnings,
    }
  }

  return {
    eligible: true,
    mode,
    actionLabel: actionLabelForMode(mode, invoice.status),
    sourceInvoice: invoice,
    period,
    includedEntries: includedEntries.map((entry) => toPreviewEntry(entry, settings)),
    includedRecurring: includedRecurring.map((instance) => toPreviewRecurring(instance)),
    excludedEntries,
    excludedRecurring,
    warnings,
    lineItems: revision.lineItems,
    totals: {
      subtotalBeforeInvoiceDiscount: revision.totals.subtotalBeforeInvoiceDiscount,
      invoiceDiscountAmount: revision.totals.invoiceDiscountAmount,
      vatAmount: revision.totals.vatAmount,
      totalAmount: revision.totals.totalAmount,
    },
    invoiceNotes: revision.notes,
    internalNotes: revision.internalNotes,
    virtualRecurringInstances,
  }
}

export async function getOjInvoiceReissuePreview(invoiceId: string): Promise<OjInvoiceReissuePreview> {
  const hasInvoicePermission = await checkUserPermission('invoices', 'view')
  const hasOjPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasInvoicePermission || !hasOjPermission) {
    return { eligible: false, error: 'You do not have permission to preview OJ invoice reissues' }
  }

  if (!invoiceId) return { eligible: false, error: 'Invoice ID is required' }
  return buildReissuePreview(invoiceId)
}

export async function reissueOjInvoice(formData: FormData) {
  const hasInvoicePermission = await checkUserPermission('invoices', 'edit')
  const hasOjPermission = await checkUserPermission('oj_projects', 'edit')
  if (!hasInvoicePermission || !hasOjPermission) {
    return { error: 'You do not have permission to reissue OJ invoices' }
  }

  const invoiceId = String(formData.get('invoiceId') || '')
  if (!invoiceId) return { error: 'Invoice ID is required' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const firstPreview = await buildReissuePreview(invoiceId)
  if (!firstPreview.eligible) return { error: firstPreview.error }

  const replacementInvoiceNumber = firstPreview.mode === 'replacement' ? await generateInvoiceNumber(admin) : firstPreview.sourceInvoice.invoice_number
  const directPreview = await buildReissuePreview(invoiceId, { replacementInvoiceNumber })
  if (!directPreview.eligible) return { error: directPreview.error }

  const invoiceData = {
    invoice_number: replacementInvoiceNumber,
    vendor_id: directPreview.sourceInvoice.vendor_id,
    invoice_date: directPreview.sourceInvoice.invoice_date,
    due_date: directPreview.sourceInvoice.due_date,
    reference: directPreview.sourceInvoice.reference || `OJ Projects ${directPreview.period.period_yyyymm}`,
    invoice_discount_percentage: directPreview.sourceInvoice.invoice_discount_percentage || 0,
    subtotal_amount: directPreview.totals.subtotalBeforeInvoiceDiscount,
    discount_amount: directPreview.totals.invoiceDiscountAmount,
    vat_amount: directPreview.totals.vatAmount,
    total_amount: directPreview.totals.totalAmount,
    notes: directPreview.mode === 'replacement'
      ? `Replacement for ${directPreview.sourceInvoice.status === 'void' ? 'voided' : 'voided source'} invoice ${directPreview.sourceInvoice.invoice_number}.\n\n${directPreview.invoiceNotes}`
      : directPreview.invoiceNotes,
    internal_notes: `${directPreview.internalNotes}\n\n[OJ_PROJECTS_REISSUE ${new Date().toISOString()}] ${directPreview.mode === 'rebuild_draft' ? 'Draft rebuilt' : `Replacement draft created from ${directPreview.sourceInvoice.invoice_number}`} for ${directPreview.period.label}.`,
  }

  const { data: result, error } = await (admin as any).rpc('reissue_oj_invoice_transaction', {
    p_source_invoice_id: invoiceId,
    p_mode: directPreview.mode,
    p_invoice_data: invoiceData,
    p_line_items: directPreview.lineItems,
    p_entry_ids: directPreview.includedEntries.map((entry) => entry.id),
    p_recurring_instance_ids: directPreview.includedRecurring
      .filter((instance) => !instance.is_virtual)
      .map((instance) => instance.id),
    p_virtual_recurring_instances: directPreview.virtualRecurringInstances || [],
  })

  if (error) return { error: error.message || 'Failed to reissue OJ invoice' }

  const invoice = (result as any)?.invoice
  if (!invoice?.id || !invoice?.invoice_number) return { error: 'Reissue completed but returned an invalid invoice response' }

  await logAuditEvent({
    user_id: user?.id,
    user_email: user?.email,
    operation_type: 'update',
    resource_type: 'invoice',
    resource_id: invoiceId,
    operation_status: 'success',
    old_values: { invoice_number: directPreview.sourceInvoice.invoice_number, status: directPreview.sourceInvoice.status },
    new_values: { invoice_number: invoice.invoice_number, status: invoice.status, mode: directPreview.mode },
    additional_info: {
      action: 'oj_monthly_invoice_reissue',
      period: directPreview.period.period_yyyymm,
      included_entries: directPreview.includedEntries.length,
      included_recurring: directPreview.includedRecurring.length,
    },
  })

  revalidatePath('/invoices')
  revalidatePath(`/invoices/${invoiceId}`)
  revalidatePath(`/invoices/${invoice.id}`)
  revalidatePath('/oj-projects')
  revalidatePath('/oj-projects/entries')
  revalidateTag('dashboard')

  return {
    success: true as const,
    mode: directPreview.mode,
    invoice_id: String(invoice.id),
    invoice_number: String(invoice.invoice_number),
    period_label: directPreview.period.label,
  }
}
