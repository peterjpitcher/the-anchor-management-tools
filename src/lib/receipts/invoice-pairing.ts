/**
 * What to do with a customer's bank payment that quotes no invoice number, or quotes one with
 * nothing left to pay that it did not settle.
 *
 * Most customer payments quote the invoice number and are matched by it. Some carry only the
 * payer's bank name ("CRICKETERS CRICKETERS", "KIER SERVICES LTD"), and some quote an old invoice
 * every month (ASE Associates' standing order quotes its May 2026 invoice), so they are matched on
 * the customer, the amount and the date. The owner's rule (16 October 2026): one payment can settle
 * one invoice or several, but an invoice is normally settled by one payment, and be careful.
 * So only the plainest cases are settled automatically and everything else goes to a person:
 *
 * 1. A bank-transfer payment already entered by hand on the customer's invoices, of the same
 *    amount and dated within a week, is linked to this bank payment when it is the only entry that
 *    fits and no other bank payment from the customer could be it. Nothing is recorded twice.
 * 2. Any other unlinked entry of the same amount, from a month before to two months after, could
 *    be this money entered late or early: a person decides.
 * 3. When exactly one recent invoice still owing, and existing on the payment date, is for exactly
 *    this amount, and no other bank payment already points at it, the payment is recorded on it.
 * 4. Everything else goes to a person, with the options that fitted: several entries or invoices
 *    (Kier and Golden Barrels bill the same amount every month), one payment covering a set of
 *    invoices, an invoice another payment points at, or nothing that fits exactly. Guessing is how
 *    a payment lands on the wrong invoice and a paid invoice gets chased.
 * 5. A payment quoting an invoice that may still be its money (paid around the same time, so this
 *    may be one part of it, or written off) is settled automatically only against that invoice.
 *
 * Pure: no database access. Money is compared in pence.
 */

/** How far either side of the bank date a hand-entered payment can be dated and be linked to it. */
export const ENTRY_WINDOW_DAYS = 7

/** An unlinked entry of the same amount this far before the bank date could still be this money. */
export const LOOSE_ENTRY_DAYS_BEFORE = 30

/** An unlinked entry of the same amount this far after the bank date could still be this money. */
export const LOOSE_ENTRY_DAYS_AFTER = 60

/**
 * How old an invoice can be and still take a payment automatically, and still be shown to the
 * person deciding. An older invoice still showing as owed may well have been paid some other way.
 */
export const RECENT_INVOICE_DAYS = 120

/** Above this many invoices owing, or entries on one day, combinations are not searched. */
export const MAX_SET_SEARCH_ITEMS = 12

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

/** A bank-transfer payment entered against one of the customer's invoices, not linked to a bank line. */
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
  | 'entries_split_payment'
  | 'entry_may_be_this_payment'
  | 'several_invoices_fit'
  | 'set_of_invoices_fits'
  | 'invoice_claimed_by_another_payment'
  | 'too_many_invoices_owing'
  | 'no_exact_fit'
  /** The invoice the payment quoted was paid around the same time: this may be part of that money. */
  | 'quoted_invoice_paid_nearby'
  /** The invoice the payment quoted was written off: this may be paying that debt. */
  | 'quoted_invoice_written_off'

/**
 * For a payment quoting an invoice with nothing left to pay that may still be that invoice's
 * money: it is only settled automatically against that invoice's own entry, and anything else
 * goes to a person for this reason.
 */
export type QuotedInvoiceCaution = { invoiceId: string; reason: ReviewReason }

export type CustomerPaymentDecision =
  | { kind: 'link'; entry: EnteredPayment }
  | { kind: 'record'; allocation: InvoiceAllocation }
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

function within(days: number | null, before: number, after: number): boolean {
  return days !== null && days >= -before && days <= after
}

/** Entries dated within a week that could be this bank payment: one of the same amount, or one day's set adding up to it. */
function entryOptionsFor(payment: CustomerBankPayment, entries: EnteredPayment[]): EnteredPayment[][] {
  const target = pence(payment.amount)
  const near = entries.filter((entry) => within(daysBetween(payment.date, entry.paymentDate), ENTRY_WINDOW_DAYS, ENTRY_WINDOW_DAYS))

  const singles = near.filter((entry) => pence(entry.amount) === target).map((entry) => [entry])

  // One bank payment entered as several, one per invoice, on the same day.
  const byDay = new Map<string, EnteredPayment[]>()
  for (const entry of near) byDay.set(entry.paymentDate, [...(byDay.get(entry.paymentDate) ?? []), entry])
  const splits = [...byDay.values()]
    .filter((day) => day.length > 1 && day.length <= MAX_SET_SEARCH_ITEMS)
    .flatMap((day) => setsAddingUpTo(day, (entry) => pence(entry.amount), target, 2))

  return [...singles, ...splits]
}

/** Whether another of the customer's bank payments could equally be this entry. */
function fitsAnotherPayment(entry: EnteredPayment, others: CustomerBankPayment[]): boolean {
  return others.some(
    (other) =>
      pence(other.amount) === pence(entry.amount) &&
      within(daysBetween(other.date, entry.paymentDate), ENTRY_WINDOW_DAYS, ENTRY_WINDOW_DAYS)
  )
}

/**
 * Decides what to do with one bank payment from a customer.
 *
 * @param entries bank-transfer payments entered on the customer's invoices that no bank line is linked to
 * @param otherPayments the customer's other bank payments that no entered payment accounts for, whether
 *   or not they are matched otherwise or fall in a filed period: any of them could be an entry's money
 * @param claimedInvoiceIds invoices another bank payment already points at
 * @param caution for a payment quoting an invoice with nothing left to pay that may still be that
 *   invoice's money: a link or record against any other invoice is offered to a person instead
 */
export function decideCustomerPayment(
  payment: CustomerBankPayment,
  invoices: CustomerInvoice[],
  entries: EnteredPayment[],
  otherPayments: CustomerBankPayment[],
  claimedInvoiceIds: ReadonlySet<string> = new Set(),
  caution: QuotedInvoiceCaution | null = null
): CustomerPaymentDecision {
  if (!(payment.amount > 0)) return { kind: 'none' }

  const recentInvoices = invoices
    .filter((invoice) => {
      const age = daysBetween(invoice.invoiceDate, payment.date)
      return payable(invoice) && within(age, ENTRY_WINDOW_DAYS, RECENT_INVOICE_DAYS)
    })
    .sort(oldestFirst)
  const review = (reason: ReviewReason, entryOptions: EnteredPayment[][], invoiceOptions: InvoiceAllocation[][]): CustomerPaymentDecision => ({
    kind: 'review',
    reason,
    entryOptions,
    invoiceOptions,
    recentInvoices,
  })
  const settle = (decision: Extract<CustomerPaymentDecision, { kind: 'link' | 'record' }>): CustomerPaymentDecision => {
    const invoiceId = decision.kind === 'link' ? decision.entry.invoiceId : decision.allocation.invoice.id
    if (!caution || invoiceId === caution.invoiceId) return decision
    return decision.kind === 'link'
      ? review(caution.reason, [[decision.entry]], [])
      : review(caution.reason, [], [[decision.allocation]])
  }

  const others = otherPayments.filter((other) => other.id !== payment.id)
  const entryOptions = entryOptionsFor(payment, entries)
  if (entryOptions.length === 1 && entryOptions[0].length === 1) {
    const [entry] = entryOptions[0]
    if (fitsAnotherPayment(entry, others)) return review('entry_fits_another_payment', entryOptions, [])
    // Another payment pointing at the entry's invoice may own the entry, even one this customer
    // lookup cannot see (filed under another vendor, or none).
    if (claimedInvoiceIds.has(entry.invoiceId)) return review('invoice_claimed_by_another_payment', entryOptions, [])
    return settle({ kind: 'link', entry })
  }
  if (entryOptions.length === 1) return review('entries_split_payment', entryOptions, [])
  if (entryOptions.length > 1) return review('several_entries_fit', entryOptions, [])

  // An entry of the same amount further away may be this money, entered late or early.
  const target = pence(payment.amount)
  const looseEntries = entries.filter(
    (entry) =>
      pence(entry.amount) === target &&
      within(daysBetween(payment.date, entry.paymentDate), LOOSE_ENTRY_DAYS_BEFORE, LOOSE_ENTRY_DAYS_AFTER)
  )
  if (looseEntries.length) return review('entry_may_be_this_payment', looseEntries.map((entry) => [entry]), [])

  const owing = invoices
    .filter((invoice) => {
      const age = daysBetween(invoice.invoiceDate, payment.date)
      return payable(invoice) && outstandingOf(invoice) > 0 && within(age, 0, RECENT_INVOICE_DAYS)
    })
    .sort(oldestFirst)
  const allocation = (invoice: CustomerInvoice): InvoiceAllocation => ({ invoice, amount: outstandingOf(invoice) })
  const singles = owing.filter((invoice) => pence(outstandingOf(invoice)) === target).map((invoice) => [allocation(invoice)])

  if (owing.length > MAX_SET_SEARCH_ITEMS) {
    // Too many owing to rule out a combination, so not even a single exact fit is recorded.
    return singles.length ? review('too_many_invoices_owing', [], singles) : review('no_exact_fit', [], [])
  }

  const sets = setsAddingUpTo(owing, (invoice) => pence(outstandingOf(invoice)), target, 2).map((set) => set.map(allocation))
  const options = [...singles, ...sets]

  if (options.length === 1 && options[0].length === 1) {
    return claimedInvoiceIds.has(options[0][0].invoice.id)
      ? review('invoice_claimed_by_another_payment', [], options)
      : settle({ kind: 'record', allocation: options[0][0] })
  }
  if (options.length === 1) return review('set_of_invoices_fits', [], options)
  if (options.length > 1) return review('several_invoices_fit', [], options)

  return recentInvoices.length ? review('no_exact_fit', [], []) : { kind: 'none' }
}
