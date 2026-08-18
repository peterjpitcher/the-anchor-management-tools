/**
 * The Work Record: what work was done, what it was worth, and which invoice
 * charged it.
 *
 * Pure. Takes rows in, returns the shape of the document, touches no database
 * and produces no HTML, so the arithmetic can be tested directly rather than
 * inferred from a PDF.
 *
 * **Why this cannot group by month.** Under a monthly cap one month's work is
 * charged across several invoices. Golden Barrels logged 28.25 hours in January
 * 2026 and they landed on five different invoices. Grouping by month and calling
 * that "the invoice" would be a lie, so the linkage is per entry, via
 * `oj_entries.invoice_id`.
 *
 * **Why every invoice needs a carry-forward line.** A capped invoice never sums
 * from the work attached to it. Verified across all Golden Barrels invoices: the
 * gap between the invoice and its work ranges from GBP 1.67 to GBP 416.67. The
 * document states that gap explicitly, or it contradicts the invoice it is
 * describing.
 */

import { getEntryCharge, getRecurringCharge } from '@/lib/oj-projects/charges'
import { roundMoney } from '@/lib/oj-projects/utils'

export interface WorkRecordEntry {
  id: string
  entry_date: string
  entry_type: string
  description: string | null
  duration_minutes_rounded: number | null
  miles: number | null
  amount_ex_vat_snapshot: number | null
  hourly_rate_ex_vat_snapshot: number | null
  mileage_rate_snapshot: number | null
  vat_rate_snapshot: number | null
  billable: boolean
  status: string
  invoice_id: string | null
  /** Set when a monthly cap cut an entry in two; both halves share the parent. */
  split_from_entry_id?: string | null
  project?: { project_code: string | null; project_name: string | null } | null
  work_type_name_snapshot?: string | null
}

export interface WorkRecordRecurring {
  invoice_id: string | null
  description_snapshot: string | null
  amount_ex_vat_snapshot: number | null
  vat_rate_snapshot: number | null
}

export interface WorkRecordInvoice {
  id: string
  invoice_number: string
  invoice_date: string
  status: string
  total_amount: number
}

export interface WorkRecordLine {
  date: string
  project: string
  description: string
  quantity: string
  hours: number
  /** Only populated when the caller asks for values. */
  exVat: number
  /** Set when this line is one half of a cap split, for the "of which" note. */
  splitNote?: string
}

export interface WorkRecordInvoiceBlock {
  invoiceNumber: string
  invoiceDate: string
  status: string
  settled: boolean
  lines: WorkRecordLine[]
  hours: number
  workExVat: number
  recurringExVat: number
  recurringLabels: string[]
  /** Invoice total ex VAT, less the work and recurring charges on it. */
  carriedForwardExVat: number
  invoiceExVat: number
  invoiceIncVat: number
}

export interface WorkRecordProjectRow {
  project: string
  entries: number
  hours: number
}

export interface WorkRecordCarryForwardRow {
  month: string
  hours: number
  invoiceNumbers: string[]
  uninvoicedHours: number
}

export interface WorkRecord {
  totalHours: number
  projectCount: number
  projects: WorkRecordProjectRow[]
  carryForward: WorkRecordCarryForwardRow[]
  invoiceBlocks: WorkRecordInvoiceBlock[]
  notYetCharged: WorkRecordLine[]
  notYetChargedHours: number
  /** Settled work whose invoice reference was never recorded. Hidden when empty. */
  settledWithoutInvoice: WorkRecordLine[]
  settledWithoutInvoiceHours: number
  /** Every invoice block closed. False blocks generation rather than printing a contradiction. */
  reconciles: boolean
}

function projectLabel(entry: WorkRecordEntry): string {
  const name = entry.project?.project_name || 'Unassigned'
  const code = entry.project?.project_code
  return code ? `${code} ${name}` : name
}

function entryHours(entry: WorkRecordEntry): number {
  return roundMoney(Number(entry.duration_minutes_rounded || 0) / 60)
}

function quantityLabel(entry: WorkRecordEntry): string {
  if (entry.entry_type === 'time') return `${entryHours(entry).toFixed(2)} h`
  if (entry.entry_type === 'mileage') return `${Number(entry.miles || 0).toFixed(2)} mi`
  return '-'
}

function monthLabel(isoDate: string): string {
  const [year, month] = String(isoDate).split('-')
  const at = new Date(Date.UTC(Number(year), Number(month) - 1, 1))
  return at.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function toLine(entry: WorkRecordEntry, settings: any, splitPartners: Map<string, WorkRecordEntry[]>): WorkRecordLine {
  const line: WorkRecordLine = {
    date: entry.entry_date,
    project: projectLabel(entry),
    // Internal notes are deliberately not read here. Only the client-facing
    // description reaches the document.
    description: entry.description || entry.work_type_name_snapshot || 'Work carried out',
    quantity: quantityLabel(entry),
    hours: entryHours(entry),
    exVat: getEntryCharge(entry, settings).exVat,
  }

  // A cap split leaves two identical-looking rows. Without saying so, the pair
  // reads as double billing on an entry-level document.
  const parentId = entry.split_from_entry_id || entry.id
  const family = splitPartners.get(parentId)
  if (family && family.length > 1) {
    const whole = roundMoney(family.reduce((acc, part) => acc + entryHours(part), 0))
    line.splitNote = `${whole.toFixed(2)} h in total, of which ${line.hours.toFixed(2)} h on this invoice`
  }

  return line
}

export function buildWorkRecord(input: {
  entries: WorkRecordEntry[]
  recurring: WorkRecordRecurring[]
  invoices: WorkRecordInvoice[]
  settings: any
}): WorkRecord {
  // Only billable work is a client's business. Non-billable time is ours.
  const entries = input.entries.filter((e) => e.billable !== false)

  const splitPartners = new Map<string, WorkRecordEntry[]>()
  for (const entry of entries) {
    const parentId = entry.split_from_entry_id || entry.id
    splitPartners.set(parentId, [...(splitPartners.get(parentId) || []), entry])
  }

  const invoiceById = new Map(input.invoices.map((i) => [i.id, i]))

  const projects = new Map<string, WorkRecordProjectRow>()
  for (const entry of entries) {
    const key = projectLabel(entry)
    const row = projects.get(key) || { project: key, entries: 0, hours: 0 }
    row.entries += 1
    row.hours = roundMoney(row.hours + entryHours(entry))
    projects.set(key, row)
  }

  const months = new Map<string, { hours: number; invoices: Set<string>; uninvoiced: number }>()
  for (const entry of entries) {
    const key = String(entry.entry_date).slice(0, 7)
    const row = months.get(key) || { hours: 0, invoices: new Set<string>(), uninvoiced: 0 }
    row.hours = roundMoney(row.hours + entryHours(entry))
    const invoice = entry.invoice_id ? invoiceById.get(entry.invoice_id) : null
    if (invoice) row.invoices.add(invoice.invoice_number)
    else row.uninvoiced = roundMoney(row.uninvoiced + entryHours(entry))
    months.set(key, row)
  }

  const invoiceBlocks: WorkRecordInvoiceBlock[] = []
  for (const invoice of input.invoices) {
    const invoiceEntries = entries.filter((e) => e.invoice_id === invoice.id)
    const invoiceRecurring = input.recurring.filter((r) => r.invoice_id === invoice.id)
    if (invoiceEntries.length === 0 && invoiceRecurring.length === 0) continue

    const lines = invoiceEntries.map((e) => toLine(e, input.settings, splitPartners))
    const workExVat = roundMoney(lines.reduce((acc, l) => acc + l.exVat, 0))
    // Recurring charges live in their own table. Omit them and no invoice adds up.
    const recurringExVat = roundMoney(
      invoiceRecurring.reduce((acc, r) => acc + getRecurringCharge(r).exVat, 0)
    )

    const vatRate = Number(input.settings?.vat_rate ?? 20)
    const invoiceIncVat = roundMoney(Number(invoice.total_amount || 0))
    const invoiceExVat = roundMoney(invoiceIncVat / (1 + vatRate / 100))

    invoiceBlocks.push({
      invoiceNumber: invoice.invoice_number,
      invoiceDate: invoice.invoice_date,
      status: invoice.status,
      settled: invoice.status === 'paid',
      lines,
      hours: roundMoney(lines.reduce((acc, l) => acc + l.hours, 0)),
      workExVat,
      recurringExVat,
      recurringLabels: invoiceRecurring.map((r) => r.description_snapshot || 'Recurring charge'),
      // Whatever the invoice charged beyond the work on it: under a cap, money
      // paid against work carried forward from an earlier month.
      carriedForwardExVat: roundMoney(invoiceExVat - workExVat - recurringExVat),
      invoiceExVat,
      invoiceIncVat,
    })
  }

  const notYetCharged = entries
    .filter((e) => !e.invoice_id && e.status === 'unbilled')
    .map((e) => toLine(e, input.settings, splitPartners))

  // Settled work with no invoice reference recorded. Real for historic rows that
  // predate the billing engine, so it is stated rather than silently dropped.
  const settledWithoutInvoice = entries
    .filter((e) => !e.invoice_id && e.status !== 'unbilled')
    .map((e) => toLine(e, input.settings, splitPartners))

  const sumHours = (lines: WorkRecordLine[]) => roundMoney(lines.reduce((acc, l) => acc + l.hours, 0))

  return {
    totalHours: roundMoney(entries.reduce((acc, e) => acc + entryHours(e), 0)),
    projectCount: projects.size,
    projects: [...projects.values()].sort((a, b) => b.hours - a.hours),
    carryForward: [...months.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, row]) => ({
        month: monthLabel(`${key}-01`),
        hours: row.hours,
        invoiceNumbers: [...row.invoices].sort(),
        uninvoicedHours: row.uninvoiced,
      })),
    invoiceBlocks,
    notYetCharged,
    notYetChargedHours: sumHours(notYetCharged),
    settledWithoutInvoice,
    settledWithoutInvoiceHours: sumHours(settledWithoutInvoice),
    // Every block must account for its invoice to the penny. The account
    // statement prints a mismatch on the page; this document must not, so a
    // failure blocks generation instead.
    reconciles: invoiceBlocks.every(
      (b) => Math.abs(b.workExVat + b.recurringExVat + b.carriedForwardExVat - b.invoiceExVat) < 0.005
    ),
  }
}
