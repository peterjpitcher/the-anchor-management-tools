/**
 * Where a client's account stands today: what has been invoiced and not paid,
 * and what has been done and not yet invoiced.
 *
 * Pure. Rows in, figures out, so the account statement, the Work Record and the
 * client drawer all state the same position from one piece of arithmetic. Three
 * separate sums is how the statement came to show GBP 2,000 owed while the
 * drawer showed GBP 4,292 for the same client on the same day.
 *
 * **Invoiced on account.** A client on a flat monthly amount is invoiced that
 * amount whether or not the work attached to the invoice adds up to it. The
 * difference is money invoiced with no work behind it yet. It has to come off
 * the work still to be invoiced, or the client is asked for it twice: Golden
 * Barrels had GBP 214.18 ex VAT invoiced this way by October 2026, GBP 157.92
 * of it on INV-003WC alone, while the 16 hour entry it should have reduced
 * stayed wholly unbilled.
 *
 * All figures are inc VAT, because they sit beside invoice totals, which are.
 */

import { getEntryCharge, moneyIncVat } from '@/lib/oj-projects/charges'

/** The billing run's own invoices carry this reference prefix. */
const ENGINE_REFERENCE_PREFIX = 'oj projects '

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export interface PositionEntry {
  entry_type: string
  duration_minutes_rounded: number | null
  miles: number | null
  amount_ex_vat_snapshot: number | null
  hourly_rate_ex_vat_snapshot: number | null
  mileage_rate_snapshot: number | null
  vat_rate_snapshot: number | null
  billable: boolean
  status: string
  invoice_id: string | null
}

export interface PositionRecurring {
  status: string
  invoice_id: string | null
  amount_ex_vat_snapshot: number | null
  vat_rate_snapshot: number | null
  /** False when the charge behind it has been switched off; the run will never bill it. */
  charge_active?: boolean | null
}

export interface PositionInvoice {
  id: string
  status: string
  total_amount: number | null
  paid_amount: number | null
  reference?: string | null
  is_fixed_price?: boolean | null
}

export interface AccountPosition {
  /** Every invoice the client has been sent. */
  invoicedTotal: number
  paidTotal: number
  /** Sent and not fully paid, before credit notes. */
  invoicedUnpaid: number
  unpaidInvoiceCount: number
  notYetInvoicedTime: number
  notYetInvoicedMileage: number
  notYetInvoicedOneOff: number
  notYetInvoicedRecurring: number
  /** The four above, before anything already invoiced on account. */
  notYetInvoicedGross: number
  /** Invoiced by the billing run with no work attached. Never negative. */
  invoicedOnAccount: number
  /** What is genuinely still to be invoiced. Never negative. */
  notYetInvoicedNet: number
}

/** An invoice whose total the billing run set, so it need not equal the work on it. */
export function isEngineInvoice(invoice: Pick<PositionInvoice, 'reference' | 'is_fixed_price'>): boolean {
  if (invoice.is_fixed_price === true) return false
  return String(invoice.reference || '').trim().toLowerCase().startsWith(ENGINE_REFERENCE_PREFIX)
}

function recurringIncVat(instance: PositionRecurring, settings: any): number {
  const exVat = roundMoney(Number(instance.amount_ex_vat_snapshot || 0))
  const vatRate =
    typeof instance.vat_rate_snapshot === 'number'
      ? instance.vat_rate_snapshot
      : Number(settings?.vat_rate ?? 20)
  return moneyIncVat(exVat, vatRate)
}

export function buildAccountPosition(input: {
  entries: PositionEntry[]
  recurring: PositionRecurring[]
  /** Sent invoices only: no drafts, voids or write-offs. */
  invoices: PositionInvoice[]
  settings: any
}): AccountPosition {
  const entries = input.entries.filter((e) => e.billable !== false)

  let invoicedTotal = 0
  let paidTotal = 0
  let invoicedUnpaid = 0
  let unpaidInvoiceCount = 0
  for (const invoice of input.invoices) {
    const total = Number(invoice.total_amount || 0)
    const paid = Number(invoice.paid_amount || 0)
    invoicedTotal = roundMoney(invoicedTotal + total)
    paidTotal = roundMoney(paidTotal + Math.min(paid, total))
    const outstanding = roundMoney(Math.max(total - paid, 0))
    if (invoice.status !== 'paid' && outstanding > 0) {
      invoicedUnpaid = roundMoney(invoicedUnpaid + outstanding)
      unpaidInvoiceCount += 1
    }
  }

  let notYetInvoicedTime = 0
  let notYetInvoicedMileage = 0
  let notYetInvoicedOneOff = 0
  for (const entry of entries) {
    if (entry.status !== 'unbilled') continue
    const { incVat } = getEntryCharge(entry, input.settings)
    if (entry.entry_type === 'time') notYetInvoicedTime = roundMoney(notYetInvoicedTime + incVat)
    else if (entry.entry_type === 'mileage') notYetInvoicedMileage = roundMoney(notYetInvoicedMileage + incVat)
    else if (entry.entry_type === 'one_off') notYetInvoicedOneOff = roundMoney(notYetInvoicedOneOff + incVat)
  }

  const notYetInvoicedRecurring = roundMoney(
    input.recurring
      .filter((r) => r.status === 'unbilled' && r.charge_active !== false)
      .reduce((acc, r) => acc + recurringIncVat(r, input.settings), 0)
  )

  // Summed across every engine invoice and only then floored, so an invoice
  // that carries more work than it charged (which is how a balance on account
  // gets used up) offsets the ones that charged more than they carried.
  let onAccount = 0
  for (const invoice of input.invoices) {
    if (!isEngineInvoice(invoice)) continue
    const attachedEntries = entries
      .filter((e) => e.invoice_id === invoice.id)
      .reduce((acc, e) => acc + getEntryCharge(e, input.settings).incVat, 0)
    const attachedRecurring = input.recurring
      .filter((r) => r.invoice_id === invoice.id)
      .reduce((acc, r) => acc + recurringIncVat(r, input.settings), 0)
    onAccount += Number(invoice.total_amount || 0) - attachedEntries - attachedRecurring
  }

  const notYetInvoicedGross = roundMoney(
    notYetInvoicedTime + notYetInvoicedMileage + notYetInvoicedOneOff + notYetInvoicedRecurring
  )
  // Capped at the work it can be set against. Anything beyond that would be a
  // credit owed to the client, which is a credit note's job to state, not this.
  const invoicedOnAccount = roundMoney(Math.min(Math.max(onAccount, 0), notYetInvoicedGross))

  return {
    invoicedTotal,
    paidTotal,
    invoicedUnpaid,
    unpaidInvoiceCount,
    notYetInvoicedTime,
    notYetInvoicedMileage,
    notYetInvoicedOneOff,
    notYetInvoicedRecurring,
    notYetInvoicedGross,
    invoicedOnAccount,
    notYetInvoicedNet: roundMoney(notYetInvoicedGross - invoicedOnAccount),
  }
}

/** The not-yet-invoiced part of the position, as the statement prints it. */
export interface StatementPosition {
  /** London calendar date the figures are true for. */
  asAt: string
  notYetInvoicedWork: number
  notYetInvoicedCharges: number
  invoicedOnAccount: number
  notYetInvoicedNet: number
  monthlyCapIncVat: number | null
}

export function toStatementPosition(
  position: AccountPosition,
  asAt: string,
  monthlyCapIncVat: number | null
): StatementPosition {
  return {
    asAt,
    notYetInvoicedWork: roundMoney(
      position.notYetInvoicedTime + position.notYetInvoicedMileage + position.notYetInvoicedOneOff
    ),
    notYetInvoicedCharges: position.notYetInvoicedRecurring,
    invoicedOnAccount: position.invoicedOnAccount,
    notYetInvoicedNet: position.notYetInvoicedNet,
    monthlyCapIncVat,
  }
}

export interface ForecastRow {
  /** First of the month the invoice is raised, YYYY-MM-DD. */
  invoiceDate: string
  amount: number
  /** The part of `amount` that is that month's own regular charges. */
  monthlyCharges: number
  remainingAfter: number
}

export interface InvoiceForecast {
  rows: ForecastRow[]
  /** True when the balance is not cleared within the months shown. */
  truncated: boolean
}

function addMonths(isoDate: string, months: number): string {
  const [year, month] = isoDate.split('-').map(Number)
  const at = new Date(Date.UTC(year, month - 1 + months, 1))
  return at.toISOString().slice(0, 10)
}

/** The first of the month after `todayIso`: when the next billing run raises its invoice. */
export function nextInvoiceDate(todayIso: string): string {
  return addMonths(`${todayIso.slice(0, 7)}-01`, 1)
}

/**
 * The invoices still to come if no new work is logged and each one is paid.
 *
 * Regular monthly charges are counted every month because they are certain;
 * leaving them out, as the note on the invoices themselves does, shows the
 * balance clearing a month or two sooner than it will.
 */
export function buildInvoiceForecast(input: {
  /** What is still to be invoiced today, inc VAT. */
  startingBalance: number
  monthlyCapIncVat: number
  /** Regular monthly charges added on each future invoice, inc VAT. */
  monthlyChargesIncVat: number
  firstInvoiceDate: string
  maxMonths?: number
}): InvoiceForecast {
  const cap = roundMoney(Number(input.monthlyCapIncVat || 0))
  const monthly = roundMoney(Math.max(Number(input.monthlyChargesIncVat || 0), 0))
  const maxMonths = input.maxMonths ?? 24
  let remaining = roundMoney(Math.max(Number(input.startingBalance || 0), 0))

  const rows: ForecastRow[] = []
  if (cap <= 0 || remaining <= 0) return { rows, truncated: false }

  for (let month = 0; month < maxMonths; month += 1) {
    const due = roundMoney(remaining + monthly)
    const amount = roundMoney(Math.min(cap, due))
    remaining = roundMoney(due - amount)
    rows.push({
      invoiceDate: addMonths(input.firstInvoiceDate, month),
      amount,
      monthlyCharges: roundMoney(Math.min(monthly, amount)),
      remainingAfter: remaining,
    })
    if (remaining <= 0) return { rows, truncated: false }
  }

  return { rows, truncated: true }
}
