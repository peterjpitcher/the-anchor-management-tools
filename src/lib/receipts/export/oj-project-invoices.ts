import type { Archiver } from 'archiver'
import Papa from 'papaparse'
import type { InvoiceWithDetails } from '@/types/invoices'
import { closePdfBrowser, createPdfBrowser, generateInvoicePDF } from '@/lib/pdf-generator'
import { createAdminClient } from '@/lib/supabase/admin'

type SupabaseAdminClient = ReturnType<typeof createAdminClient>

export type OjProjectInvoiceForExport = InvoiceWithDetails & {
  payments?: Array<NonNullable<InvoiceWithDetails['payments']>[number]>
}

export async function loadOjProjectInvoicesPaidInQuarter(
  supabase: SupabaseAdminClient,
  startDate: string,
  endDate: string
): Promise<OjProjectInvoiceForExport[]> {
  const invoiceIds = await loadOjProjectInvoiceIdsPaidInQuarter(supabase, startDate, endDate)
  if (!invoiceIds.length) return []

  const { data, error } = await supabase
    .from('invoices')
    .select(`
      *,
      vendor:invoice_vendors(*),
      line_items:invoice_line_items(*),
      payments:invoice_payments(*)
    `)
    .in('id', invoiceIds)
    .is('deleted_at', null)
    .in('status', ['paid', 'partially_paid'])
    .order('invoice_date', { ascending: true })
    .order('invoice_number', { ascending: true })

  if (error) {
    console.error('Failed to fetch OJ Projects invoices for receipts export:', error)
    throw new Error('Failed to load OJ Projects invoices for export.')
  }

  const byRequestedOrder = new Map(invoiceIds.map((id, index) => [id, index]))
  return ((data ?? []) as OjProjectInvoiceForExport[]).sort((a, b) => {
    const aIndex = byRequestedOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER
    const bIndex = byRequestedOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER
    if (aIndex !== bIndex) return aIndex - bIndex
    return a.invoice_number.localeCompare(b.invoice_number)
  })
}

export async function appendOjProjectInvoices(
  archive: Archiver,
  invoices: OjProjectInvoiceForExport[],
  period: { year: number; quarter: number; startDate: string; endDate: string }
) {
  if (!invoices.length) return

  archive.append(buildOjProjectInvoiceSummaryCsv(invoices, period), {
    name: `OJ_Project_Invoices_Q${period.quarter}_${period.year}.csv`,
  })

  const browser = await createPdfBrowser()
  try {
    for (const [index, invoice] of invoices.entries()) {
      const pdfBuffer = await generateInvoicePDF(invoice, { browser })
      archive.append(pdfBuffer, { name: buildOjProjectInvoiceFileName(invoice, index) })
    }
  } finally {
    await closePdfBrowser(browser)
  }
}

export function buildOjProjectInvoiceSummaryCsv(
  invoices: OjProjectInvoiceForExport[],
  period: { year: number; quarter: number; startDate: string; endDate: string }
): Buffer {
  const summaryRows: string[][] = [
    ['Quarter', `Q${period.quarter} ${period.year}`],
    ['Generated at', new Date().toISOString()],
    ['Total OJ Projects invoices', String(invoices.length)],
    ['Total invoice value (GBP)', formatCurrency(invoices.reduce((sum, invoice) => sum + (invoice.total_amount ?? 0), 0))],
    ['Total paid value (GBP)', formatCurrency(invoices.reduce((sum, invoice) => sum + (invoice.paid_amount ?? 0), 0))],
    [],
  ]

  const headerRow = [
    'Invoice number',
    'Invoice date',
    'Vendor',
    'Reference',
    'Status',
    'Total (GBP)',
    'Paid (GBP)',
    'Payments in quarter',
  ]

  const dataRows = invoices.map((invoice) => {
    const payments = (invoice.payments ?? [])
      .filter((payment) => payment.payment_date >= period.startDate && payment.payment_date <= period.endDate)
      .sort((a, b) => a.payment_date.localeCompare(b.payment_date))
      .map((payment) => `${payment.payment_date}: ${formatCurrency(payment.amount ?? 0)}`)
      .join('; ')

    return [
      escapeCsvCell(invoice.invoice_number ?? ''),
      formatDate(invoice.invoice_date),
      escapeCsvCell(invoice.vendor?.name ?? ''),
      escapeCsvCell(invoice.reference ?? ''),
      friendlyInvoiceStatus(invoice.status),
      (invoice.total_amount ?? 0).toFixed(2),
      (invoice.paid_amount ?? 0).toFixed(2),
      payments,
    ]
  })

  const csv = Papa.unparse([...summaryRows, headerRow, ...dataRows], { newline: '\n' })
  return Buffer.from(`\ufeff${csv}`, 'utf-8')
}

async function loadOjProjectInvoiceIdsPaidInQuarter(
  supabase: SupabaseAdminClient,
  startDate: string,
  endDate: string
): Promise<string[]> {
  const paidAtEndExclusive = toExclusiveEndTimestamp(endDate)

  const [
    paymentInvoiceIds,
    entryPaidAtInvoiceIds,
    recurringPaidAtInvoiceIds,
  ] = await Promise.all([
    loadInvoiceIdsFromPaymentsInRange(supabase, startDate, endDate),
    loadLinkedInvoiceIdsPaidAtInRange(supabase, 'oj_entries', startDate, paidAtEndExclusive),
    loadLinkedInvoiceIdsPaidAtInRange(supabase, 'oj_recurring_charge_instances', startDate, paidAtEndExclusive),
  ])

  const ojLinkedPaymentInvoiceIds = await filterOjProjectInvoiceIds(supabase, paymentInvoiceIds)

  return uniqueStrings([
    ...ojLinkedPaymentInvoiceIds,
    ...entryPaidAtInvoiceIds,
    ...recurringPaidAtInvoiceIds,
  ])
}

async function loadInvoiceIdsFromPaymentsInRange(
  supabase: SupabaseAdminClient,
  startDate: string,
  endDate: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from('invoice_payments')
    .select('invoice_id')
    .gte('payment_date', startDate)
    .lte('payment_date', endDate)
    .order('payment_date', { ascending: true })

  if (error) {
    console.error('Failed to fetch paid invoice ids for receipts export:', error)
    throw new Error('Failed to load invoice payments for export.')
  }

  return uniqueStrings((data ?? []).map((row: { invoice_id?: string | null }) => row.invoice_id))
}

async function loadLinkedInvoiceIdsPaidAtInRange(
  supabase: SupabaseAdminClient,
  table: 'oj_entries' | 'oj_recurring_charge_instances',
  startDate: string,
  endExclusiveIso: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from(table)
    .select('invoice_id')
    .not('invoice_id', 'is', null)
    .gte('paid_at', `${startDate}T00:00:00.000Z`)
    .lt('paid_at', endExclusiveIso)

  if (error) {
    console.error(`Failed to fetch ${table} paid invoice ids for receipts export:`, error)
    throw new Error('Failed to load OJ Projects paid invoices for export.')
  }

  return uniqueStrings((data ?? []).map((row: { invoice_id?: string | null }) => row.invoice_id))
}

async function filterOjProjectInvoiceIds(
  supabase: SupabaseAdminClient,
  invoiceIds: string[]
): Promise<string[]> {
  const candidateIds = uniqueStrings(invoiceIds)
  if (!candidateIds.length) return []

  const [entryResult, recurringResult] = await Promise.all([
    supabase
      .from('oj_entries')
      .select('invoice_id')
      .in('invoice_id', candidateIds),
    supabase
      .from('oj_recurring_charge_instances')
      .select('invoice_id')
      .in('invoice_id', candidateIds),
  ])

  if (entryResult.error) {
    console.error('Failed to filter OJ Projects entry invoice ids for receipts export:', entryResult.error)
    throw new Error('Failed to load OJ Projects linked invoices for export.')
  }

  if (recurringResult.error) {
    console.error('Failed to filter OJ Projects recurring invoice ids for receipts export:', recurringResult.error)
    throw new Error('Failed to load OJ Projects linked invoices for export.')
  }

  return uniqueStrings([
    ...(entryResult.data ?? []).map((row: { invoice_id?: string | null }) => row.invoice_id),
    ...(recurringResult.data ?? []).map((row: { invoice_id?: string | null }) => row.invoice_id),
  ])
}

function buildOjProjectInvoiceFileName(invoice: Pick<InvoiceWithDetails, 'id' | 'invoice_number'>, index: number) {
  const uniqueSegment = sanitizePathSegment(invoice.id ?? `invoice-${index + 1}`, `invoice-${index + 1}`)
  const invoiceNumber = sanitizeZipFilename(invoice.invoice_number ?? `invoice-${index + 1}`, `invoice-${index + 1}`)
  return `oj-projects/invoices/${uniqueSegment}_${invoiceNumber}.pdf`
}

function escapeCsvCell(value: string): string {
  if (!value || typeof value !== 'string') return value
  if (['=', '+', '-', '@'].includes(value[0])) {
    return '\t' + value
  }
  return value
}

function friendlyInvoiceStatus(status: InvoiceWithDetails['status']) {
  switch (status) {
    case 'partially_paid':
      return 'Partially paid'
    case 'paid':
      return 'Paid'
    case 'overdue':
      return 'Overdue'
    case 'sent':
      return 'Sent'
    case 'void':
      return 'Void'
    case 'written_off':
      return 'Written off'
    default:
      return 'Draft'
  }
}

function formatDate(value: string) {
  if (!value) return ''
  return new Date(value).toLocaleDateString('en-GB', { timeZone: 'UTC' })
}

function formatCurrency(value: number) {
  return value.toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)))
}

function toExclusiveEndTimestamp(endDate: string): string {
  const date = new Date(`${endDate}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString()
}

function sanitizeZipFilename(value: string, fallback = 'invoice.pdf'): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned || fallback
}

function sanitizePathSegment(value: string, fallback: string): string {
  let cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\.+/g, '.')
    .trim()

  cleaned = cleaned.replace(/^\.+/, '').replace(/\.+$/, '')

  return cleaned || fallback
}
