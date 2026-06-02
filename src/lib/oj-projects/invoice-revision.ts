import { calculateInvoiceTotals, type InvoiceTotalsResult } from '@/lib/invoiceCalculations'
import type { InvoiceLineItemInput } from '@/types/invoices'

type RevisionInvoice = {
  invoice_number: string
  invoice_date: string
  due_date: string
  reference: string | null
  notes: string | null
  internal_notes: string | null
  invoice_discount_percentage: number | null
}

type RevisionSettings = {
  hourly_rate_ex_vat?: number | null
  mileage_rate?: number | null
  vat_rate?: number | null
  statement_mode?: boolean | null
}

type RevisionProject = {
  project_code?: string | null
  project_name?: string | null
}

export type OjInvoiceRevisionEntry = {
  id: string
  entry_type: string | null
  entry_date: string
  project_id: string | null
  project?: RevisionProject | null
  duration_minutes_rounded: number | null
  miles: number | null
  hourly_rate_ex_vat_snapshot: number | null
  vat_rate_snapshot: number | null
  mileage_rate_snapshot: number | null
  amount_ex_vat_snapshot: number | null
  billable: boolean | null
  description: string | null
  work_type_name_snapshot?: string | null
  work_type?: { name?: string | null } | null
}

export type OjInvoiceRevisionRecurringInstance = {
  id: string
  period_yyyymm: string | null
  description_snapshot: string
  amount_ex_vat_snapshot: number
  vat_rate_snapshot: number
  sort_order_snapshot?: number | null
}

export type OjInvoiceRevisionResult = {
  lineItems: InvoiceLineItemInput[]
  totals: InvoiceTotalsResult
  notes: string
  internalNotes: string
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function moneyIncVat(exVat: number, vatRate: number): number {
  return roundMoney(roundMoney(exVat) * (1 + Number(vatRate || 0) / 100))
}

function projectLabel(project: RevisionProject | null | undefined): string {
  const code = project?.project_code ? String(project.project_code) : ''
  const name = project?.project_name ? String(project.project_name) : ''
  if (code && name) return `${code} - ${name}`
  return code || name || 'Project'
}

function formatPeriodLabel(periodYyyymm: string | null | undefined): string {
  const raw = String(periodYyyymm || '')
  const qMatch = raw.match(/^(\d{4})-Q(\d)$/)
  if (qMatch) return `Q${qMatch[2]} ${qMatch[1]}`
  if (/^\d{4}$/.test(raw)) return raw
  return raw.match(/^\d{4}-\d{2}/)?.[0] || raw
}

function periodFromReference(reference: string | null | undefined): string {
  return String(reference || '').match(/\d{4}(?:-\d{2}|-Q\d)?/)?.[0] || ''
}

function getEntryCharge(entry: OjInvoiceRevisionEntry, settings: RevisionSettings) {
  if (entry.entry_type === 'mileage') {
    const miles = Number(entry.miles || 0)
    const rate = Number(entry.mileage_rate_snapshot ?? settings.mileage_rate ?? 0.55)
    const exVat = roundMoney(miles * rate)
    return { exVat, vatRate: 0, incVat: exVat }
  }

  if (entry.entry_type === 'one_off') {
    const exVat = roundMoney(Number(entry.amount_ex_vat_snapshot || 0))
    const vatRate = Number(entry.vat_rate_snapshot ?? settings.vat_rate ?? 20)
    return { exVat, vatRate, incVat: moneyIncVat(exVat, vatRate) }
  }

  const minutes = Number(entry.duration_minutes_rounded || 0)
  const rate = Number(entry.hourly_rate_ex_vat_snapshot ?? settings.hourly_rate_ex_vat ?? 75)
  const vatRate = Number(entry.vat_rate_snapshot ?? settings.vat_rate ?? 20)
  const exVat = roundMoney((minutes / 60) * rate)
  return { exVat, vatRate, incVat: moneyIncVat(exVat, vatRate) }
}

function getRecurringCharge(instance: OjInvoiceRevisionRecurringInstance) {
  const exVat = roundMoney(Number(instance.amount_ex_vat_snapshot || 0))
  const vatRate = Number(instance.vat_rate_snapshot || 0)
  return { exVat, vatRate, incVat: moneyIncVat(exVat, vatRate) }
}

function buildStatementLineItems(input: {
  recurringInstances: OjInvoiceRevisionRecurringInstance[]
  entries: OjInvoiceRevisionEntry[]
  settings: RevisionSettings
}): InvoiceLineItemInput[] {
  const vatGroups = new Map<number, number>()
  const addGroup = (vatRate: number, exVat: number) => {
    if (!Number.isFinite(exVat) || exVat <= 0) return
    const key = Number(vatRate || 0)
    vatGroups.set(key, roundMoney((vatGroups.get(key) || 0) + exVat))
  }

  for (const instance of input.recurringInstances) {
    const charge = getRecurringCharge(instance)
    addGroup(charge.vatRate, charge.exVat)
  }
  for (const entry of input.entries) {
    const charge = getEntryCharge(entry, input.settings)
    addGroup(charge.vatRate, charge.exVat)
  }

  return [...vatGroups.entries()]
    .sort(([a], [b]) => b - a)
    .map(([vatRate, exVat]) => ({
      catalog_item_id: undefined,
      description: vatRate === 0 ? 'Account balance payment (zero-rated)' : `Account balance payment (${vatRate}% VAT)`,
      quantity: 1,
      unit_price: roundMoney(exVat),
      discount_percentage: 0,
      vat_rate: vatRate,
    }))
}

function buildDetailedLineItems(input: {
  recurringInstances: OjInvoiceRevisionRecurringInstance[]
  entries: OjInvoiceRevisionEntry[]
  settings: RevisionSettings
  periodYyyymm: string
}): InvoiceLineItemInput[] {
  const lineItems: InvoiceLineItemInput[] = []

  for (const instance of input.recurringInstances) {
    const periodLabel = formatPeriodLabel(instance.period_yyyymm)
    const description =
      periodLabel && periodLabel !== input.periodYyyymm
        ? `${instance.description_snapshot} (${periodLabel})`
        : instance.description_snapshot

    lineItems.push({
      catalog_item_id: undefined,
      description,
      quantity: 1,
      unit_price: roundMoney(Number(instance.amount_ex_vat_snapshot || 0)),
      discount_percentage: 0,
      vat_rate: Number(instance.vat_rate_snapshot || 0),
    })
  }

  const oneOffEntries = input.entries.filter((entry) => entry.entry_type === 'one_off')
  for (const entry of oneOffEntries) {
    const exVat = roundMoney(Number(entry.amount_ex_vat_snapshot || 0))
    const desc = entry.description ? ` - ${String(entry.description).replace(/\s+/g, ' ').trim()}` : ''
    lineItems.push({
      catalog_item_id: undefined,
      description: `${projectLabel(entry.project)}${desc}`,
      quantity: 1,
      unit_price: exVat,
      discount_percentage: 0,
      vat_rate: Number(entry.vat_rate_snapshot ?? input.settings.vat_rate ?? 20),
    })
  }

  const mileageEntries = input.entries.filter((entry) => entry.entry_type === 'mileage')
  if (mileageEntries.length > 0) {
    const totalMiles = mileageEntries.reduce((acc, entry) => acc + Number(entry.miles || 0), 0)
    const rates = new Set(
      mileageEntries.map((entry) => Number(entry.mileage_rate_snapshot ?? input.settings.mileage_rate ?? 0.55))
    )

    if (rates.size === 1) {
      const rate = [...rates][0]
      lineItems.push({
        catalog_item_id: undefined,
        description: `Mileage (${totalMiles.toFixed(2)} miles @ GBP ${rate.toFixed(3)}/mile)`,
        quantity: roundMoney(totalMiles),
        unit_price: roundMoney(rate),
        discount_percentage: 0,
        vat_rate: 0,
      })
    } else {
      const totalExVat = mileageEntries.reduce((acc, entry) => acc + getEntryCharge(entry, input.settings).exVat, 0)
      lineItems.push({
        catalog_item_id: undefined,
        description: `Mileage (${totalMiles.toFixed(2)} miles)`,
        quantity: 1,
        unit_price: roundMoney(totalExVat),
        discount_percentage: 0,
        vat_rate: 0,
      })
    }
  }

  const timeByProjectVat = new Map<string, { project: RevisionProject | null | undefined; vatRate: number; entries: OjInvoiceRevisionEntry[] }>()
  for (const entry of input.entries.filter((item) => item.entry_type === 'time')) {
    const vatRate = Number(entry.vat_rate_snapshot ?? input.settings.vat_rate ?? 20)
    const key = `${entry.project_id || 'project'}:${vatRate}`
    const bucket = timeByProjectVat.get(key) || { project: entry.project, vatRate, entries: [] }
    bucket.entries.push(entry)
    timeByProjectVat.set(key, bucket)
  }

  for (const bucket of timeByProjectVat.values()) {
    const totalMinutes = bucket.entries.reduce((acc, entry) => acc + Number(entry.duration_minutes_rounded || 0), 0)
    const totalHours = totalMinutes / 60
    const totalExVat = bucket.entries.reduce((acc, entry) => acc + getEntryCharge(entry, input.settings).exVat, 0)

    lineItems.push({
      catalog_item_id: undefined,
      description: `${projectLabel(bucket.project)} (${totalHours.toFixed(2)}h)`,
      quantity: 1,
      unit_price: roundMoney(totalExVat),
      discount_percentage: 0,
      vat_rate: bucket.vatRate,
    })
  }

  return lineItems
}

function buildRevisionNotes(input: {
  invoice: RevisionInvoice
  recurringInstances: OjInvoiceRevisionRecurringInstance[]
  entries: OjInvoiceRevisionEntry[]
  revisedAtIso: string
}): string {
  const lines: string[] = []
  const period = periodFromReference(input.invoice.reference)
  lines.push('OJ Projects timesheet')
  if (period) lines.push(`Billing period: ${formatPeriodLabel(period)}`)
  lines.push(`Invoice ${input.invoice.invoice_number} revised ${input.revisedAtIso.slice(0, 10)}`)
  lines.push('Rounding: time is rounded up to 15 minutes per entry')

  if (input.recurringInstances.length > 0) {
    lines.push('')
    lines.push('Recurring charges')
    for (const instance of input.recurringInstances) {
      lines.push(`- ${instance.description_snapshot}: GBP ${roundMoney(Number(instance.amount_ex_vat_snapshot || 0)).toFixed(2)} ex VAT`)
    }
  }

  const timeEntries = input.entries.filter((entry) => entry.entry_type === 'time')
  if (timeEntries.length > 0) {
    lines.push('')
    lines.push('Time')
    for (const entry of timeEntries) {
      const hours = Number(entry.duration_minutes_rounded || 0) / 60
      const workType = entry.work_type_name_snapshot || entry.work_type?.name || 'Unspecified'
      const desc = entry.description ? ` - ${String(entry.description).replace(/\s+/g, ' ').trim()}` : ''
      lines.push(`- ${entry.entry_date} - ${projectLabel(entry.project)} - ${hours.toFixed(2)}h - ${workType}${desc}`)
    }
  }

  const mileageEntries = input.entries.filter((entry) => entry.entry_type === 'mileage')
  if (mileageEntries.length > 0) {
    lines.push('')
    lines.push('Mileage')
    for (const entry of mileageEntries) {
      const desc = entry.description ? ` - ${String(entry.description).replace(/\s+/g, ' ').trim()}` : ''
      lines.push(`- ${entry.entry_date} - ${projectLabel(entry.project)} - ${Number(entry.miles || 0).toFixed(2)} miles${desc}`)
    }
  }

  const oneOffEntries = input.entries.filter((entry) => entry.entry_type === 'one_off')
  if (oneOffEntries.length > 0) {
    lines.push('')
    lines.push('One-off charges')
    for (const entry of oneOffEntries) {
      const desc = entry.description ? ` - ${String(entry.description).replace(/\s+/g, ' ').trim()}` : ''
      lines.push(`- ${entry.entry_date} - ${projectLabel(entry.project)} - GBP ${roundMoney(Number(entry.amount_ex_vat_snapshot || 0)).toFixed(2)} ex VAT${desc}`)
    }
  }

  return lines.join('\n')
}

function appendRevisionInternalNote(existingNotes: string | null | undefined, invoiceNumber: string, revisedAtIso: string): string {
  const note = `[OJ_PROJECTS_REVISED ${revisedAtIso}] Invoice ${invoiceNumber} recalculated from linked OJ Projects items for reissue.`
  return existingNotes ? `${existingNotes}\n\n${note}` : note
}

export function getOjInvoiceRevisionBlockReason(
  invoice: { status?: string | null; paid_amount?: number | null } | null | undefined,
  paymentCount = 0
): string | null {
  if (!invoice) return 'Invoice not found'
  const status = String(invoice.status || '')
  if (['paid', 'partially_paid', 'void', 'written_off'].includes(status)) {
    return 'Only unpaid active invoices can be revised from OJ Projects entries'
  }
  if (Number(invoice.paid_amount || 0) > 0 || paymentCount > 0) {
    return 'Cannot revise an invoice after a payment has been recorded'
  }
  return null
}

export function buildOjInvoiceRevision(input: {
  invoice: RevisionInvoice
  settings: RevisionSettings | null | undefined
  recurringInstances: OjInvoiceRevisionRecurringInstance[]
  entries: OjInvoiceRevisionEntry[]
  revisedAtIso: string
}): OjInvoiceRevisionResult {
  const settings = input.settings || {}
  const billableEntries = input.entries.filter((entry) => entry.billable !== false)
  const periodYyyymm = periodFromReference(input.invoice.reference)
  const statementMode = Boolean(settings.statement_mode) || String(input.invoice.internal_notes || '').includes('Statement mode')

  const lineItems = statementMode
    ? buildStatementLineItems({
        recurringInstances: input.recurringInstances,
        entries: billableEntries,
        settings,
      })
    : buildDetailedLineItems({
        recurringInstances: input.recurringInstances,
        entries: billableEntries,
        settings,
        periodYyyymm,
      })

  if (lineItems.length === 0) {
    throw new Error('Cannot revise invoice because no billable OJ Projects items remain')
  }

  const totals = calculateInvoiceTotals(lineItems, Number(input.invoice.invoice_discount_percentage || 0))
  const notes = buildRevisionNotes({
    invoice: input.invoice,
    recurringInstances: input.recurringInstances,
    entries: billableEntries,
    revisedAtIso: input.revisedAtIso,
  })
  const internalNotes = appendRevisionInternalNote(
    input.invoice.internal_notes,
    input.invoice.invoice_number,
    input.revisedAtIso
  )

  return { lineItems, totals, notes, internalNotes }
}
