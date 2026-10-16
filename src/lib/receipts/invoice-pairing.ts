/**
 * What to do with a customer's bank payment that quotes no invoice number.
 *
 * Most customer payments quote the invoice number and are matched by it. Some carry only the
 * payer's bank name ("CRICKETERS CRICKETERS", "KIER SERVICES LTD"), so they are matched on the
 * customer, the amount and the date. The rules, agreed with the owner on 16 October 2026: one
 * payment can settle one invoice or several, but an invoice is normally settled by one payment.
 *
 * 1. A payment already entered by hand on the customer's invoices may already record this money:
 *    one entry of the same amount, or one day's entries adding up to it, within a week of the
 *    bank date. When exactly one fits, and no other bank payment from the customer could be it,
 *    the bank payment is linked to it and nothing new is recorded.
 * 2. Otherwise, when exactly one invoice still owing, or exactly one set of them, adds up to the
 *    payment and already existed on the day it arrived, the payment is recorded against it.
 * 3. Anything else goes to a person: several entries or invoices that fit equally well (Kier and
 *    Golden Barrels bill the same amount every month), or nothing that fits exactly. Guessing is
 *    how a payment lands on the wrong invoice and a paid invoice gets chased.
 *
 * Pure: no database access. Money is compared in pence.
 */

/** How far either side of the bank date a hand-entered payment can be dated and still be it. */
export const ENTRY_WINDOW_DAYS = 7

/**
 * How old an invoice can be and still take a payment automatically, and still be shown to the
 * person deciding. An older invoice still showing as owed may well have been paid some other way.
 */
export const RECENT_INVOICE_DAYS = 120

/** Above this many invoices owing, sets of them are not searched: too many combinations to trust. */
export const MAX_SET_SEARCH_INVOICES = 12

/** Invoices that can never take a payment: cancelled, or never sent. */
const UNPAYABLE_STATUSES = new Set(['void', 'written_off', 'draft'])

export type CustomerInvoice = {
  id: string
  invoiceNumber: string
  invoiceDate: string
  status: string | null
  totalAmount: number
  /** Issued credit notes against the invoice. */
  creditedAmount: number
  /** Payments already entered against the invoice. */
  paidAmount: number
}

/** A payment entered against one of the customer's invoices, not yet linked to a bank line. */
export type EnteredPayment = {
  id: string
  invoiceId: string
  paymentDate: string
  amount: number
}

export type CustomerBankPayment = {
  id: string
  date: string
  amount: number
}

export type InvoiceAllocation = { invoice: CustomerInvoice; amount: number }

export type ReviewReason =
  | 'several_entries_fit'
  | 'entry_fits_another_payment'
  | 'several_invoices_fit'
  | 'no_exact_fit'

export type CustomerPaymentDecision =
  | { kind: 'link'; entries: EnteredPayment[] }
  | { kind: 'record'; allocations: InvoiceAllocation[] }
  | {
      kind: 'review'
      reason: ReviewReason
      entryOptions: EnteredPayment[][]
      invoiceOptions: InvoiceAllocation[][]
      /** The customer's invoices from around the payment, paid or not, for the person deciding. */
      recentInvoices: CustomerInvoice[]
    }
  | { kind: 'none' }

function pence(value: number): number {
  return Math.round(Number(value) * 100)
}

function dayNumber(isoDate: string): number | null {
  // Bank, invoice and payment dates are plain calendar dates, so compare them as such.
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate ?? '')
  if (!match) return null
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isFinite(time) ? time / 86_400_000 : null
}

/** Days from `from` to `to`, or null when either is not a date. */
function daysBetween(from: string, to: string): number | null {
  const start = dayNumber(from)
  const end = dayNumber(to)
  return start === null || end === null ? null : end - start
}

/** What the customer still owes on an invoice, after credit notes and entered payments. */
export function outstandingOf(invoice: CustomerInvoice): number {
  return Math.max(0, pence(invoice.totalAmount) - pence(invoice.creditedAmount) - pence(invoice.paidAmount)) / 100
}

function payable(invoice: CustomerInvoice): boolean {
  return !UNPAYABLE_STATUSES.has((invoice.status ?? '').toLowerCase())
}

function oldestFirst(left: CustomerInvoice, right: CustomerInvoice): number {
  return left.invoiceDate.localeCompare(right.invoiceDate) || left.invoiceNumber.localeCompare(right.invoiceNumber)
}

/** Every set of at least `minSize` items whose amounts, in pence, add up to `target`. */
function setsAddingUpTo<T>(items: T[], amountOf: (item: T) => number, target: number, minSize: number): T[][] {
  const found: T[][] = []
  const chosen: T[] = []
  const walk = (start: number, sum: number) => {
    if (sum === target) {
      if (chosen.length >= minSize) found.push([...chosen])
      return
    }
    if (sum > target) return
    for (let index = start; index < items.length; index += 1) {
      chosen.push(items[index])
      walk(index + 1, sum + amountOf(items[index]))
      chosen.pop()
    }
  }
  walk(0, 0)
  return found
}

function within(days: number | null, limit: number): boolean {
  return days !== null && Math.abs(days) <= limit
}

/** Entered payments that could be this bank payment: one of the same amount, or one day's set adding up to it. */
function entryOptionsFor(payment: CustomerBankPayment, entries: EnteredPayment[]): EnteredPayment[][] {
  const target = pence(payment.amount)
  const near = entries.filter((entry) => within(daysBetween(payment.date, entry.paymentDate), ENTRY_WINDOW_DAYS))

  const singles = near.filter((entry) => pence(entry.amount) === target).map((entry) => [entry])

  // One bank payment entered as several, one per invoice, on the same day.
  const byDay = new Map<string, EnteredPayment[]>()
  for (const entry of near) byDay.set(entry.paymentDate, [...(byDay.get(entry.paymentDate) ?? []), entry])
  const splits = [...byDay.values()]
    .filter((day) => day.length > 1)
    .flatMap((day) => setsAddingUpTo(day, (entry) => pence(entry.amount), target, 2))

  return [...singles, ...splits]
}

/** Whether another of the customer's bank payments could equally be these entries. */
function fitsAnotherPayment(option: EnteredPayment[], others: CustomerBankPayment[]): boolean {
  const total = option.reduce((sum, entry) => sum + pence(entry.amount), 0)
  return others.some(
    (other) =>
      pence(other.amount) === total &&
      option.every((entry) => within(daysBetween(other.date, entry.paymentDate), ENTRY_WINDOW_DAYS))
  )
}

/**
 * Recent invoices still owing that existed on the payment date, alone or as a set adding up to
 * the payment.
 */
function invoiceOptionsFor(payment: CustomerBankPayment, invoices: CustomerInvoice[]): InvoiceAllocation[][] {
  const target = pence(payment.amount)
  const owing = invoices
    .filter((invoice) => {
      const age = daysBetween(invoice.invoiceDate, payment.date)
      return payable(invoice) && outstandingOf(invoice) > 0 && age !== null && age >= 0 && age <= RECENT_INVOICE_DAYS
    })
    .sort(oldestFirst)

  const allocation = (invoice: CustomerInvoice): InvoiceAllocation => ({ invoice, amount: outstandingOf(invoice) })
  const singles = owing.filter((invoice) => pence(outstandingOf(invoice)) === target).map((invoice) => [allocation(invoice)])
  const sets =
    owing.length <= MAX_SET_SEARCH_INVOICES
      ? setsAddingUpTo(owing, (invoice) => pence(outstandingOf(invoice)), target, 2).map((set) => set.map(allocation))
      : []

  return [...singles, ...sets]
}

/**
 * Decides what to do with one bank payment from a customer.
 *
 * @param entries payments entered against the customer's invoices that no bank line is linked to yet
 * @param otherPayments the customer's other bank payments that are not matched to anything yet
 */
export function decideCustomerPayment(
  payment: CustomerBankPayment,
  invoices: CustomerInvoice[],
  entries: EnteredPayment[],
  otherPayments: CustomerBankPayment[]
): CustomerPaymentDecision {
  if (!(payment.amount > 0)) return { kind: 'none' }

  const recentInvoices = invoices
    .filter((invoice) => {
      const age = daysBetween(invoice.invoiceDate, payment.date)
      return payable(invoice) && age !== null && age >= -ENTRY_WINDOW_DAYS && age <= RECENT_INVOICE_DAYS
    })
    .sort(oldestFirst)

  const entryOptions = entryOptionsFor(payment, entries)
  if (entryOptions.length === 1) {
    if (!fitsAnotherPayment(entryOptions[0], otherPayments.filter((other) => other.id !== payment.id))) {
      return { kind: 'link', entries: entryOptions[0] }
    }
    return { kind: 'review', reason: 'entry_fits_another_payment', entryOptions, invoiceOptions: [], recentInvoices }
  }
  if (entryOptions.length > 1) {
    return { kind: 'review', reason: 'several_entries_fit', entryOptions, invoiceOptions: [], recentInvoices }
  }

  const invoiceOptions = invoiceOptionsFor(payment, invoices)
  if (invoiceOptions.length === 1) return { kind: 'record', allocations: invoiceOptions[0] }
  if (invoiceOptions.length > 1) {
    return { kind: 'review', reason: 'several_invoices_fit', entryOptions: [], invoiceOptions, recentInvoices }
  }

  if (recentInvoices.length) {
    return { kind: 'review', reason: 'no_exact_fit', entryOptions: [], invoiceOptions: [], recentInvoices }
  }
  return { kind: 'none' }
}
