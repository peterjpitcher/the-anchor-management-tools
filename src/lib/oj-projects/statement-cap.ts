/**
 * The monthly cap top-up for statement-mode OJ clients.
 *
 * A statement-mode client on a monthly cap is billed a flat amount every month
 * while they still owe anything, rather than being billed for whatever work
 * happened to fit. The invoice carries a single "Account balance payment" line,
 * and this tops that line up so the invoice lands exactly on the target.
 *
 * This used to live only in the billing cron, so the invoice-reissue path
 * rebuilt a capped invoice from its linked items alone and silently dropped it
 * below the contracted monthly amount. Reissuing Golden Barrels' June 2026
 * invoice turned GBP 500.00 into GBP 460.50 that way. Both callers now share
 * this one implementation.
 */

import { calculateInvoiceTotals, type InvoiceTotalsResult } from '@/lib/invoiceCalculations'
import { roundMoney } from '@/lib/oj-projects/utils'
import { DEFAULT_HOURLY_RATE_EX_VAT, DEFAULT_MILEAGE_RATE, resolveRate } from '@/lib/oj-projects/rates'

export type StatementCapLineItem = {
  catalog_item_id?: string | null
  description: string
  quantity: number
  unit_price: number
  discount_percentage: number
  vat_rate: number
}

const ACCOUNT_BALANCE_PREFIX = 'Account balance payment'

function moneyIncVat(exVat: number, vatRate: number): number {
  return roundMoney(exVat + roundMoney(exVat * (vatRate / 100)))
}

type StatementCapClient = { from: (table: string) => any }

/** Last day of the month named in an "OJ Projects YYYY-MM" reference. */
function periodEndFromReference(reference: string | null | undefined, fallbackDate: string): string {
  const match = String(reference || '').match(/OJ Projects\s+(\d{4})-(\d{2})/i)
  const year = match ? Number(match[1]) : Number(String(fallbackDate).slice(0, 4))
  const month = match ? Number(match[2]) : Number(String(fallbackDate).slice(5, 7))
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return fallbackDate
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}

function entryIncVat(entry: any, settings: any): number {
  if (entry?.entry_type === 'mileage') {
    // Mileage is a disbursement and is billed zero-rated.
    const rate = resolveRate(entry.mileage_rate_snapshot, settings?.mileage_rate, DEFAULT_MILEAGE_RATE)
    return roundMoney(Number(entry.miles || 0) * rate)
  }

  const vatRate = Number(entry?.vat_rate_snapshot ?? settings?.vat_rate ?? 20)
  const exVat =
    entry?.entry_type === 'one_off'
      ? roundMoney(Number(entry.amount_ex_vat_snapshot || 0))
      : roundMoney(
          (Number(entry?.duration_minutes_rounded || 0) / 60) *
            resolveRate(entry?.hourly_rate_ex_vat_snapshot, settings?.hourly_rate_ex_vat, DEFAULT_HOURLY_RATE_EX_VAT)
        )
  return moneyIncVat(exVat, vatRate)
}

function recurringIncVat(instance: any): number {
  const exVat = roundMoney(Number(instance?.amount_ex_vat_snapshot || 0))
  return moneyIncVat(exVat, Number(instance?.vat_rate_snapshot || 0))
}

/**
 * What a statement-mode capped invoice must total when it is rebuilt.
 *
 * The client is billed a flat monthly amount while they owe anything, so the
 * answer is the cap, unless the entire remaining debt is smaller than the cap.
 * Returns null when the client is not on a statement cap, in which case the
 * invoice is simply the sum of its items.
 *
 * The balance is measured AS AT this invoice's own date. A rebuild can target
 * any past month, and by then later invoices may already be with the client.
 * Counting those would top this invoice up against a debt another invoice is
 * already collecting, billing the same money twice. That is why the invoice
 * query is bounded by `invoiceDate` and excludes the invoice being rebuilt.
 */
export async function computeStatementCapTargetIncVat(input: {
  client: StatementCapClient
  vendorId: string
  invoiceId: string
  invoiceDate: string
  reference: string | null | undefined
  settings: any
  linkedEntries: any[]
  linkedRecurringInstances: any[]
}): Promise<number | null> {
  const { settings } = input
  const isCapped = settings?.billing_mode === 'cap' && Boolean(settings?.statement_mode)
  const cap = Number(settings?.monthly_cap_inc_vat ?? 0)
  if (!isCapped || !Number.isFinite(cap) || cap <= 0) return null

  const periodEnd = periodEndFromReference(input.reference, input.invoiceDate)

  const linkedTotal = roundMoney(
    (input.linkedEntries || [])
      .filter((entry) => entry?.billable !== false)
      .reduce((acc, entry) => acc + entryIncVat(entry, settings), 0) +
      (input.linkedRecurringInstances || []).reduce((acc, instance) => acc + recurringIncVat(instance), 0)
  )

  const [unbilledEntries, unbilledRecurring, earlierInvoices] = await Promise.all([
    input.client
      .from('oj_entries')
      .select('entry_type, duration_minutes_rounded, miles, hourly_rate_ex_vat_snapshot, vat_rate_snapshot, mileage_rate_snapshot, amount_ex_vat_snapshot')
      .eq('vendor_id', input.vendorId)
      .eq('status', 'unbilled')
      .eq('billable', true)
      .lte('entry_date', periodEnd)
      .limit(10000),
    input.client
      .from('oj_recurring_charge_instances')
      .select('amount_ex_vat_snapshot, vat_rate_snapshot, recurring_charge:oj_vendor_recurring_charges(is_active)')
      .eq('vendor_id', input.vendorId)
      .eq('status', 'unbilled')
      .lte('period_end', periodEnd)
      .limit(10000),
    input.client
      .from('invoices')
      .select('id, total_amount, paid_amount')
      .eq('vendor_id', input.vendorId)
      .is('deleted_at', null)
      .ilike('reference', 'OJ Projects %')
      .not('status', 'in', '(paid,void,written_off,draft)')
      .lte('invoice_date', input.invoiceDate)
      .neq('id', input.invoiceId)
      .limit(10000),
  ])

  if (unbilledEntries.error) throw new Error(unbilledEntries.error.message)
  if (unbilledRecurring.error) throw new Error(unbilledRecurring.error.message)
  if (earlierInvoices.error) throw new Error(earlierInvoices.error.message)

  const unbilledTotal = roundMoney(
    (unbilledEntries.data || []).reduce((acc: number, entry: any) => acc + entryIncVat(entry, settings), 0) +
      (unbilledRecurring.data || [])
        .filter((instance: any) => instance?.recurring_charge?.is_active !== false)
        .reduce((acc: number, instance: any) => acc + recurringIncVat(instance), 0)
  )

  const earlierOutstanding = roundMoney(
    (earlierInvoices.data || []).reduce(
      (acc: number, invoice: any) =>
        acc + Math.max(Number(invoice.total_amount || 0) - Number(invoice.paid_amount || 0), 0),
      0
    )
  )

  return roundMoney(Math.min(cap, roundMoney(linkedTotal + unbilledTotal + earlierOutstanding)))
}

export function statementCapLineLabel(vatRate: number): string {
  return vatRate === 0
    ? `${ACCOUNT_BALANCE_PREFIX} (zero-rated)`
    : `${ACCOUNT_BALANCE_PREFIX} (${vatRate}% VAT)`
}

/**
 * The ex-VAT amount whose inc-VAT value lands on `targetIncVat`.
 *
 * Stepped rather than divided, because rounding each way at two decimal places
 * means a straight division can miss the target by a penny.
 */
export function computeExVatForTargetIncVat(
  targetIncVat: number,
  vatRate: number
): { exVat: number; incVat: number } | null {
  const safeTarget = roundMoney(Number(targetIncVat) || 0)
  if (!Number.isFinite(safeTarget) || safeTarget <= 0) return null
  const divisor = 1 + vatRate / 100
  if (!Number.isFinite(divisor) || divisor <= 0) return null

  let exVat = roundMoney(safeTarget / divisor)
  let incVat = moneyIncVat(exVat, vatRate)

  let guard = 0
  while (incVat < safeTarget - 0.009 && guard < 500) {
    exVat = roundMoney(exVat + 0.01)
    incVat = moneyIncVat(exVat, vatRate)
    guard += 1
  }
  if (incVat - safeTarget > 0.009) {
    exVat = roundMoney(exVat - 0.01)
    incVat = moneyIncVat(exVat, vatRate)
  }

  if (exVat <= 0) return null
  return { exVat, incVat }
}

/**
 * Raises the account-balance line until the invoice totals `targetIncVat`.
 *
 * Only ever tops up. An invoice already at or above the target is returned
 * untouched, so this cannot reduce what has been billed.
 */
export function applyStatementCapTopUp<T extends StatementCapLineItem>(input: {
  lineItems: T[]
  totals: InvoiceTotalsResult
  targetIncVat: number
  vatRate: number
}): { lineItems: T[]; totals: InvoiceTotalsResult } {
  let totals = input.totals
  const target = roundMoney(Number(input.targetIncVat))
  if (!Number.isFinite(target) || target <= 0) return { lineItems: input.lineItems, totals }

  let diff = roundMoney(target - Number(totals.totalAmount))
  if (!Number.isFinite(diff) || diff <= 0.009) return { lineItems: input.lineItems, totals }

  const vatRate = Number(input.vatRate || 0)

  let existingIndex = input.lineItems.findIndex(
    (item) => item.vat_rate === vatRate && item.description.startsWith(ACCOUNT_BALANCE_PREFIX)
  )

  if (existingIndex < 0) {
    input.lineItems.push({
      catalog_item_id: null,
      description: statementCapLineLabel(vatRate),
      quantity: 1,
      unit_price: 0,
      discount_percentage: 0,
      vat_rate: vatRate,
    } as T)
    existingIndex = input.lineItems.length - 1
  }

  const adjustment = computeExVatForTargetIncVat(diff, vatRate)
  if (!adjustment) return { lineItems: input.lineItems, totals }

  const existing = input.lineItems[existingIndex]
  input.lineItems[existingIndex] = {
    ...existing,
    unit_price: roundMoney(Number(existing.unit_price || 0) + adjustment.exVat),
  }

  totals = calculateInvoiceTotals(input.lineItems as StatementCapLineItem[], 0)
  diff = roundMoney(target - Number(totals.totalAmount))

  if (Math.abs(diff) > 0.009) {
    let guard = 0
    while (Math.abs(diff) > 0.009 && guard < 500) {
      const step = diff > 0 ? 0.01 : -0.01
      const current = input.lineItems[existingIndex]
      input.lineItems[existingIndex] = {
        ...current,
        unit_price: roundMoney(Number(current.unit_price || 0) + step),
      }
      totals = calculateInvoiceTotals(input.lineItems as StatementCapLineItem[], 0)
      diff = roundMoney(target - Number(totals.totalAmount))
      guard += 1
    }
  }

  return { lineItems: input.lineItems, totals }
}
