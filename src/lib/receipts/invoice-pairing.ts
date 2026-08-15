/**
 * Reference-free pairing of inward bank payments to invoices.
 *
 * Most customer payments quote the invoice number in the bank narrative, and
 * those are handled by the reference matcher. A meaningful minority do not:
 * the narrative is just the payer's short bank name (e.g. "CRICKETERS
 * CRICKETERS"). This module pairs those on vendor + amount + date instead.
 *
 * The bar for an automatic pair is deliberately high. We only pair when
 * exactly one invoice for that vendor can explain the payment. Anything
 * ambiguous is left alone for a human, because silently attaching a payment
 * to the wrong invoice is far more expensive than leaving it pending.
 */

export const PAIRING_MONEY_EPSILON = 0.005

/** A payment can land slightly before the invoice is dated (payment on account). */
export const PAIRING_DAYS_BEFORE_INVOICE = 7

/** How long after the invoice date a payment can still be considered the same bill. */
export const PAIRING_DAYS_AFTER_INVOICE = 120

/** Invoice states that can never be paired: the bill was cancelled. */
const UNPAIRABLE_INVOICE_STATUSES = new Set(['void', 'written_off', 'draft'])

export type PairableInvoice = {
  id: string
  invoiceNumber: string
  invoiceDate: string
  status: string | null
  totalAmount: number
  paidAmount: number
}

export type PairableTransaction = {
  id: string
  transactionDate: string
  amount: number
}

export type PairingBasis = 'total' | 'outstanding'

export type PairingCandidate = {
  invoice: PairableInvoice
  basis: PairingBasis
  dayGap: number
}

export type InvoicePairingResult =
  | {
      outcome: 'paired'
      candidate: PairingCandidate
      /** How many invoices could have explained this payment. */
      candidateCount: number
      /** True when more than one matched and the oldest-owing rule chose. */
      viaTiebreak: boolean
    }
  | { outcome: 'no_candidate' }
  | { outcome: 'ambiguous'; candidates: PairingCandidate[] }

export type PairingOptions = {
  daysBeforeInvoice?: number
  daysAfterInvoice?: number
  /** Invoice ids already claimed by another payment in this run. */
  claimedInvoiceIds?: ReadonlySet<string>
}

function toUtcDays(isoDate: string): number | null {
  // Bank and invoice dates are plain calendar dates, so compare them as such.
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate ?? '')
  if (!match) return null
  const [, year, month, day] = match
  const time = Date.UTC(Number(year), Number(month) - 1, Number(day))
  return Number.isFinite(time) ? time / 86_400_000 : null
}

function amountsMatch(left: number, right: number): boolean {
  return Math.abs(left - right) < PAIRING_MONEY_EPSILON
}

function outstandingOf(invoice: PairableInvoice): number {
  return Math.max(0, invoice.totalAmount - invoice.paidAmount)
}

/**
 * Decide whether a single invoice could explain this payment, and on what basis.
 * Returns null when the invoice is not a candidate at all.
 */
export function evaluateInvoiceCandidate(
  transaction: PairableTransaction,
  invoice: PairableInvoice,
  options: PairingOptions = {}
): PairingCandidate | null {
  if (UNPAIRABLE_INVOICE_STATUSES.has((invoice.status ?? '').toLowerCase())) return null
  if (options.claimedInvoiceIds?.has(invoice.id)) return null
  if (!(transaction.amount > 0)) return null
  if (!(invoice.totalAmount > 0)) return null

  const transactionDay = toUtcDays(transaction.transactionDate)
  const invoiceDay = toUtcDays(invoice.invoiceDate)
  if (transactionDay === null || invoiceDay === null) return null

  const dayGap = transactionDay - invoiceDay
  const daysBefore = options.daysBeforeInvoice ?? PAIRING_DAYS_BEFORE_INVOICE
  const daysAfter = options.daysAfterInvoice ?? PAIRING_DAYS_AFTER_INVOICE
  if (dayGap < -daysBefore || dayGap > daysAfter) return null

  if (amountsMatch(transaction.amount, invoice.totalAmount)) {
    return { invoice, basis: 'total', dayGap }
  }

  const outstanding = outstandingOf(invoice)
  if (outstanding > 0 && amountsMatch(transaction.amount, outstanding)) {
    return { invoice, basis: 'outstanding', dayGap }
  }

  return null
}

/**
 * A candidate the payment could actually have been settling: the invoice was
 * still owing money, and it already existed on the day the money arrived.
 *
 * Both halves matter. An invoice that is already paid in full is not a debt
 * this payment can clear, and an invoice dated after the payment did not exist
 * to be paid. Without the date half, a June payment gets applied to a July
 * invoice purely because July is the only one still outstanding.
 */
function isSettleable(candidate: PairingCandidate): boolean {
  return outstandingOf(candidate.invoice) > 0 && candidate.dayGap >= 0
}

function oldestFirst(left: PairingCandidate, right: PairingCandidate): number {
  const byDate = left.invoice.invoiceDate.localeCompare(right.invoice.invoiceDate)
  if (byDate !== 0) return byDate
  // Same date: pick deterministically so repeat runs agree with each other.
  return left.invoice.invoiceNumber.localeCompare(right.invoice.invoiceNumber)
}

/**
 * Pair a payment against a vendor's invoices.
 *
 * One match is the pair. Several matches are settled the way a bookkeeper
 * would: the payment clears the oldest invoice still owing. Vendors who bill
 * the same amount every month (Kier at 2520, Golden Barrels at 500) always
 * produce several identical-looking candidates, and the bank narrative carries
 * nothing that can separate them.
 *
 * When several match but none of them is actually settleable, the payment is
 * explaining an already-closed bank line rather than clearing a debt. There is
 * no convention to lean on there, so it stays ambiguous for a human.
 */
export function pairInvoiceByAmountAndDate(
  transaction: PairableTransaction,
  invoices: readonly PairableInvoice[],
  options: PairingOptions = {}
): InvoicePairingResult {
  const candidates = invoices
    .map((invoice) => evaluateInvoiceCandidate(transaction, invoice, options))
    .filter((candidate): candidate is PairingCandidate => candidate !== null)

  if (candidates.length === 0) return { outcome: 'no_candidate' }

  if (candidates.length === 1) {
    return { outcome: 'paired', candidate: candidates[0], candidateCount: 1, viaTiebreak: false }
  }

  const settleable = candidates.filter(isSettleable).sort(oldestFirst)
  if (settleable.length === 0) return { outcome: 'ambiguous', candidates }

  return {
    outcome: 'paired',
    candidate: settleable[0],
    candidateCount: candidates.length,
    viaTiebreak: true,
  }
}
