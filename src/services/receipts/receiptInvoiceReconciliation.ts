import { createAdminClient } from '@/lib/supabase/admin'
import type {
  ReceiptClassificationSignal,
  ReceiptExpenseCategory,
  ReceiptTransaction,
} from '@/types/database'
import type { AdminClient } from './types'
import { chunkArray, normalizeVendorInput } from './receiptHelpers'
import { normalizeReceiptVendorKey } from './vendorInsights'
import { recordReceiptClassificationSignals } from './receiptGovernance'
import { resolveReceiptVendor } from './receiptVendors'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { shiftIsoDate } from '@/lib/dateUtils'
import { enqueueMissingInvoiceAttachments } from './receiptInvoiceFiles'
import {
  decideCustomerPayment,
  LOOSE_ENTRY_DAYS_AFTER,
  LOOSE_ENTRY_DAYS_BEFORE,
  outstandingOf,
  type CustomerBankPayment,
  type CustomerInvoice,
  type CustomerPaymentDecision,
  type EnteredPayment,
  type QuotedInvoiceCaution,
} from '@/lib/receipts/invoice-pairing'
import { loadReceiptSettings } from './receiptSettings'

const INVOICE_NUMBER_PATTERN = /\bINV-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/gi
const MONEY_EPSILON = 0.01

/**
 * A match moves a payment to "no receipt required" only from pending or "can't find": a
 * `completed` payment has a receipt and must not be downgraded, and `no_receipt_required` is
 * already closed. `apply_receipt_invoice_match` decides that under a row lock. Both passes match
 * a closed payment to its invoice all the same; only its status is left alone. Kier's payment of
 * 3 September 2026 was closed by a rule before it could be matched, and its invoice was chased.
 */

/** Every status that can be stored on a match. Pinned to the CHECK constraint by a parity test. */
export const STORED_INVOICE_MATCH_STATUSES = [
  'matched',
  'payment_recorded',
  'already_paid',
  'missing_invoice',
  'multiple_invoice_refs',
  'amount_mismatch',
  'review_required',
  'vendor_amount_matched',
] as const

type InvoicePaymentMatchStatus =
  | 'matched'
  | 'payment_recorded'
  | 'already_paid'
  | 'missing_invoice'
  | 'multiple_invoice_refs'
  | 'amount_mismatch'
  | 'review_required'
  | 'vendor_amount_matched'
  | 'vendor_amount_ambiguous'

export type InvoiceRow = {
  id: string
  invoice_number: string
  vendor_id: string | null
  status: string | null
  total_amount: number | string | null
  paid_amount: number | string | null
  vendor?: {
    id: string
    name: string | null
  } | null
}

type InvoicePaymentRow = {
  id: string
  invoice_id: string
  amount: number | string
  payment_date: string
  reference: string | null
}

type ReconciliationSummary = {
  reviewed: number
  withInvoiceReference: number
  matched: number
  paymentsRecorded: number
  alreadyPaid: number
  missingInvoice: number
  amountMismatch: number
  statusUpdated: number
  classificationUpdated: number
  /** Payments quoting more than one invoice number: recorded for a person, nothing applied. */
  multipleInvoiceRefs: number
  /** Customer payments with no invoice number that were looked at. */
  referenceFreeReviewed: number
  /** Of those, linked to a payment already entered by hand on the invoice. */
  referenceFreeLinked: number
  /** Of those, recorded against the one invoice, or the one set of invoices, they settle. */
  referenceFreeRecorded: number
  /** Of those, stored for a person to confirm: several fitted, or nothing fitted exactly. */
  referenceFreeForReview: number
  /**
   * Payments quoting an invoice with nothing left to pay that are not the payment that settled
   * it, matched as payments with no invoice number. Of those, linked to a payment entered by hand.
   */
  quotedSettledLinked: number
  /** Of those, recorded against the one invoice they settle. */
  quotedSettledRecorded: number
  /** Of those, stored for a person to confirm. */
  quotedSettledForReview: number
  /** Payments that failed part way and were stored for a person instead. */
  failedForReview: number
  /** The bank payment's amount was already spoken for by other invoices: left for a person. */
  overAllocated: number
  /** Invoice copies queued to be attached to their payments. */
  attachmentsQueued: number
  samples: Array<{
    transactionId: string
    invoiceNumber: string
    status: InvoicePaymentMatchStatus
    details: string
    amount: number
  }>
}

function extractInvoiceNumbers(details: string | null | undefined): string[] {
  const matches = [...(details ?? '').matchAll(INVOICE_NUMBER_PATTERN)]
    .map((match) => match[0].toUpperCase())
  return [...new Set(matches)]
}

function moneyValue(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function receiptTransactionAmount(transaction: ReceiptTransaction): number {
  return moneyValue(transaction.amount_in ?? transaction.amount_total ?? transaction.amount_out)
}

function moneyMatches(left: number, right: number): boolean {
  return Math.abs(left - right) < MONEY_EPSILON
}

function isPaidStatus(status: string | null | undefined): boolean {
  return status === 'paid' || status === 'void' || status === 'written_off'
}

/**
 * What the ledger will accept on an invoice: the total less issued credit notes, less what is
 * paid. Using the bare total offered more than that, the ledger refused, and the whole run failed.
 */
function amountLeftToPay(invoice: InvoiceRow, credited: number): number {
  return Math.max(0, Math.max(0, moneyValue(invoice.total_amount) - credited) - moneyValue(invoice.paid_amount))
}

/** Whether a payment of this amount fits an invoice: its total, what is left on it, or part of that. */
function amountFitsInvoice(amount: number, invoice: InvoiceRow, credited: number): boolean {
  const outstanding = amountLeftToPay(invoice, credited)
  return (
    moneyMatches(amount, moneyValue(invoice.total_amount)) ||
    moneyMatches(amount, outstanding) ||
    (amount > 0 && amount <= outstanding + MONEY_EPSILON)
  )
}

/**
 * Whether a payment of this amount is what the invoice asked for: as above, or its total less
 * credit notes, which is what a customer pays on a credited invoice.
 */
function paysInvoiceInFull(amount: number, invoice: InvoiceRow, credited: number): boolean {
  return amountFitsInvoice(amount, invoice, credited) || moneyMatches(amount, Math.max(0, moneyValue(invoice.total_amount) - credited))
}

/** A cancelled or written-off invoice was settled by no payment, whatever it quotes. */
function isCancelledStatus(status: string | null | undefined): boolean {
  return status === 'void' || status === 'written_off'
}

async function fetchCandidateTransactions(
  supabase: AdminClient,
  transactionIds?: string[]
): Promise<ReceiptTransaction[]> {
  // Paged: one request returns at most 1,000 rows and says nothing when it stops there.
  const rows = await fetchAllRows<ReceiptTransaction>(
    (from, to) => {
      let query = supabase
        .from('receipt_transactions')
        .select('*')
        .not('amount_in', 'is', null)
        .gt('amount_in', 0)
        .ilike('details', '%INV-%')
        .order('transaction_date', { ascending: false })
        .order('id', { ascending: true })

      if (transactionIds?.length) {
        query = query.in('id', transactionIds)
      }
      return query.range(from, to)
    },
    { label: 'invoice payment receipt transactions' }
  )
  return rows
}

async function loadInvoicesByNumber(
  supabase: AdminClient,
  invoiceNumbers: string[]
): Promise<Map<string, InvoiceRow>> {
  const uniqueNumbers = [...new Set(invoiceNumbers.map((number) => number.toUpperCase()))]
  if (!uniqueNumbers.length) return new Map()

  const { data, error } = await supabase
    .from('invoices')
    .select('*, vendor:invoice_vendors(id, name)')
    .in('invoice_number', uniqueNumbers)
    .is('deleted_at', null)

  if (error) {
    throw new Error(`Failed to load invoices for receipt reconciliation: ${error.message}`)
  }

  return new Map(((data ?? []) as InvoiceRow[]).map((invoice) => [
    invoice.invoice_number.toUpperCase(),
    invoice,
  ]))
}

async function loadExistingPaymentsByInvoice(
  supabase: AdminClient,
  invoiceIds: string[]
): Promise<Map<string, InvoicePaymentRow[]>> {
  const uniqueInvoiceIds = [...new Set(invoiceIds)]
  if (!uniqueInvoiceIds.length) return new Map()

  const { data, error } = await supabase
    .from('invoice_payments')
    .select('id, invoice_id, amount, payment_date, reference')
    .in('invoice_id', uniqueInvoiceIds)

  if (error) {
    throw new Error(`Failed to load invoice payments for receipt reconciliation: ${error.message}`)
  }

  const byInvoice = new Map<string, InvoicePaymentRow[]>()
  for (const payment of (data ?? []) as InvoicePaymentRow[]) {
    byInvoice.set(payment.invoice_id, [...(byInvoice.get(payment.invoice_id) ?? []), payment])
  }
  return byInvoice
}

type LinkedReceiptVendor = { id: string; name: string }

/**
 * The receipts vendor for an invoicing customer, created if this is the first time it is seen.
 * A lookup failure leaves the payment's vendor alone: the match itself is still recorded.
 */
export async function ensureReceiptVendorLinkedToInvoiceVendor(
  supabase: AdminClient,
  vendorName: string | null | undefined,
  invoiceVendorId: string | null | undefined
): Promise<LinkedReceiptVendor | null> {
  const normalizedName = normalizeVendorInput(vendorName ?? null)
  if (!normalizedName) return null

  let vendor: Awaited<ReturnType<typeof resolveReceiptVendor>>
  try {
    vendor = await resolveReceiptVendor(supabase, { name: normalizedName }, { create: true, origin: 'invoice' })
  } catch (error) {
    console.warn('Failed to resolve receipt vendor for an invoice match', error)
    return null
  }
  if (!vendor) return null

  const receiptVendorId = vendor.id
  const linked: LinkedReceiptVendor = { id: vendor.id, name: vendor.canonicalName }
  if (!invoiceVendorId) return linked

  const { error } = await supabase
    .from('receipt_vendors')
    .update({ invoice_vendor_id: invoiceVendorId })
    .eq('id', receiptVendorId)
    .or(`invoice_vendor_id.is.null,invoice_vendor_id.eq.${invoiceVendorId}`)

  if (error) {
    console.warn('Failed to link receipt vendor to invoice vendor', {
      receiptVendorId,
      invoiceVendorId,
      error,
    })
  }

  return linked
}

type StoredInvoiceMatchStatus = (typeof STORED_INVOICE_MATCH_STATUSES)[number]

/**
 * Stores the match and updates the payment in one database transaction
 * (`apply_receipt_invoice_match`). The function decides, with the payment row locked, whether
 * the status may move and whether the vendor may be written, so a payment a person closed,
 * reopened or named by hand is left as they left it.
 */
export async function applyInvoiceMatch(
  supabase: AdminClient,
  params: {
    transaction: ReceiptTransaction
    invoiceNumber: string
    invoice: InvoiceRow | null
    invoicePaymentId: string | null
    status: StoredInvoiceMatchStatus
    amountMatch: boolean
    payload?: Record<string, unknown>
    /** False for matches a person has to review: several invoice numbers, or no such invoice. */
    allowStatusChange: boolean
    /** The receipts vendor for the invoice's customer. Null when it could not be resolved. */
    receiptVendor: LinkedReceiptVendor | null
    initiatedBy: string | null
    /**
     * Record this much of the bank payment against the invoice, in the same database
     * transaction as the match. The status stored is then `payment_recorded`.
     */
    recordPaymentAmount?: number
    /** The part of the bank payment this match accounts for, when one payment covers several invoices. */
    matchedAmount?: number
  }
): Promise<{
  statusUpdated: boolean
  classificationUpdated: boolean
  /** A ledger entry was written by this call (false on a retry that found one). */
  paymentRecorded: boolean
  /** The bank payment has no amount left to give this invoice. Nothing was stored. */
  overAllocated?: { available: number; allocated: number; requested: number }
}> {
  const { transaction, invoice } = params
  // The payment takes the vendor's own name, so it reads the same as every other payment of theirs.
  const vendorName = params.allowStatusChange
    ? params.receiptVendor?.name ?? normalizeVendorInput(invoice?.vendor?.name ?? null)
    : null

  // With a payment to record, one function writes the ledger entry, the match and the bank
  // payment together (`record_receipt_invoice_payment`). They used to be two calls: a failure
  // between them, then a retry, could record the money twice.
  const recording = params.recordPaymentAmount !== undefined && invoice !== null
  const { data, error } = recording
    ? await (supabase as any).rpc('record_receipt_invoice_payment', {
        p_transaction_id: transaction.id,
        p_invoice_id: invoice.id,
        p_invoice_number: params.invoiceNumber,
        p_amount: params.recordPaymentAmount,
        p_amount_match: params.amountMatch,
        p_invoice_total: moneyValue(invoice.total_amount),
        p_invoice_paid_before: moneyValue(invoice.paid_amount),
        p_payload: params.payload ?? {},
        p_vendor_id: vendorName ? params.receiptVendor?.id ?? null : null,
        p_vendor_name: vendorName,
        p_initiated_by: params.initiatedBy,
      })
    : await (supabase as any).rpc('apply_receipt_invoice_match', {
        p_transaction_id: transaction.id,
        p_invoice_id: invoice?.id ?? null,
        p_invoice_number: params.invoiceNumber,
        p_invoice_payment_id: params.invoicePaymentId,
        p_match_status: params.status,
        p_amount_match: params.amountMatch,
        p_matched_amount: params.matchedAmount ?? receiptTransactionAmount(transaction),
        p_invoice_total: invoice ? moneyValue(invoice.total_amount) : null,
        p_invoice_paid_before: invoice ? moneyValue(invoice.paid_amount) : null,
        p_payload: params.payload ?? {},
        p_allow_status_change: params.allowStatusChange,
        p_vendor_id: vendorName ? params.receiptVendor?.id ?? null : null,
        p_vendor_name: vendorName,
        p_initiated_by: params.initiatedBy,
      })

  if (error) {
    throw new Error(
      recording
        ? `Failed to record invoice payment for ${params.invoiceNumber}: ${error.message}`
        : `Failed to apply receipt invoice match: ${error.message}`
    )
  }

  const result = (data ?? {}) as {
    outcome?: string
    status_updated?: boolean
    vendor_updated?: boolean
    payment_recorded?: boolean
    available?: number | string
    allocated?: number | string
    requested?: number | string
    previous_status?: ReceiptTransaction['status']
  }

  if (result.outcome === 'over_allocated') {
    return {
      statusUpdated: false,
      classificationUpdated: false,
      paymentRecorded: false,
      overAllocated: {
        available: moneyValue(result.available),
        allocated: moneyValue(result.allocated),
        requested: moneyValue(result.requested),
      },
    }
  }

  if (result.outcome !== 'applied') {
    throw new Error(`Failed to apply receipt invoice match: ${result.outcome ?? 'no result'}`)
  }

  const statusUpdated = Boolean(result.status_updated)
  const classificationUpdated = Boolean(result.vendor_updated)

  if (invoice && (statusUpdated || classificationUpdated)) {
    const priorStatus = result.previous_status ?? transaction.status
    const signals: Array<Omit<ReceiptClassificationSignal, 'id'>> = [{
      transaction_id: transaction.id,
      source: 'system',
      signal_type: 'invoice_reconciliation',
      prior_vendor_id: transaction.vendor_id ?? null,
      new_vendor_id: classificationUpdated ? params.receiptVendor?.id ?? null : transaction.vendor_id ?? null,
      prior_vendor_name: transaction.vendor_name,
      new_vendor_name: classificationUpdated ? vendorName : transaction.vendor_name,
      prior_expense_category: transaction.expense_category,
      new_expense_category: transaction.expense_category as ReceiptExpenseCategory | null,
      prior_status: priorStatus,
      new_status: statusUpdated ? 'no_receipt_required' : priorStatus,
      rule_id: null,
      ai_confidence: null,
      performed_by: params.initiatedBy,
      performed_at: new Date().toISOString(),
      payload: {
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        match_status: params.status,
        prior_vendor_source: transaction.vendor_source,
      },
    }]
    await recordReceiptClassificationSignals(supabase, signals)
  }

  return { statusUpdated, classificationUpdated, paymentRecorded: Boolean(result.payment_recorded) }
}

/**
 * Customer payments with no invoice number in the bank narrative, whatever their receipt status:
 * a rule may already have closed one as "no receipt required", and it still has to settle an
 * invoice. Payments on or before the lock date belong to filed periods and are left alone.
 */
async function fetchReferenceFreeCandidates(
  supabase: AdminClient,
  transactionIds: string[] | undefined,
  lockDate: string | null
): Promise<ReceiptTransaction[]> {
  // Paged, on a unique order: one request returns at most 1,000 rows and says nothing when it
  // stops there.
  return fetchAllRows<ReceiptTransaction>(
    (from, to) => {
      let query = supabase
        .from('receipt_transactions')
        .select('*')
        .not('amount_in', 'is', null)
        .gt('amount_in', 0)
        .not('details', 'ilike', '%INV-%')
        .order('transaction_date', { ascending: false })
        .order('id', { ascending: true })

      if (lockDate) query = query.gt('transaction_date', lockDate)
      if (transactionIds?.length) {
        query = query.in('id', transactionIds)
      }
      return query.range(from, to)
    },
    { label: 'reference-free receipt transactions' }
  )
}

/** Which of these bank payments already have a match of any kind, including one waiting for a person. */
async function loadMatchedTransactionIds(supabase: AdminClient, transactionIds: string[]): Promise<Set<string>> {
  const matched = new Set<string>()
  for (const chunk of chunkArray([...new Set(transactionIds)], 100)) {
    const rows = await fetchAllRows<{ receipt_transaction_id: string }>(
      (from, to) =>
        supabase
          .from('receipt_invoice_matches')
          .select('id, receipt_transaction_id')
          .in('receipt_transaction_id', chunk)
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'matches for these payments' }
    )
    for (const row of rows) matched.add(row.receipt_transaction_id)
  }
  return matched
}

/** Issued credit notes per invoice: they reduce what the customer owes. */
export async function loadCreditedByInvoice(supabase: AdminClient, invoiceIds: string[]): Promise<Map<string, number>> {
  const credited = new Map<string, number>()
  for (const chunk of chunkArray([...new Set(invoiceIds)], 100)) {
    const rows = await fetchAllRows<{ invoice_id: string; amount_inc_vat: number | string | null }>(
      (from, to) =>
        supabase
          .from('credit_notes')
          .select('id, invoice_id, amount_inc_vat')
          .in('invoice_id', chunk)
          .eq('status', 'issued')
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'credit notes for invoice reconciliation' }
    )
    for (const row of rows) credited.set(row.invoice_id, (credited.get(row.invoice_id) ?? 0) + moneyValue(row.amount_inc_vat))
  }
  return credited
}

/**
 * Bank narratives use the payer's short name ("CRICKETERS"), never the invoice
 * vendor's legal name ("Barons Pubs"). The bridge between the two is the
 * receipt vendor record, which the reference matcher already links to an
 * invoice vendor whenever it resolves a payment.
 */
async function resolveInvoiceVendorIds(
  supabase: AdminClient,
  transactions: ReceiptTransaction[]
): Promise<Map<string, string>> {
  const vendorIds = new Set<string>()
  const vendorKeys = new Set<string>()

  for (const transaction of transactions) {
    if (transaction.vendor_id) {
      vendorIds.add(transaction.vendor_id)
      continue
    }
    const key = normalizeReceiptVendorKey(normalizeVendorInput(transaction.vendor_name))
    if (key) vendorKeys.add(key)
  }

  if (!vendorIds.size && !vendorKeys.size) return new Map()

  // In chunks, so a long run never builds a filter too long for one request. A failure stops
  // the run: an empty answer would read as "no customer payments" and skip them all quietly.
  const byId = new Map<string, string>()
  const byKey = new Map<string, string>()
  const record = (rows: Array<{ id: string; vendor_key: string | null; invoice_vendor_id: string | null }>) => {
    for (const row of rows) {
      if (!row.invoice_vendor_id) continue
      byId.set(row.id, row.invoice_vendor_id)
      if (row.vendor_key) byKey.set(row.vendor_key, row.invoice_vendor_id)
    }
  }
  for (const chunk of chunkArray([...vendorIds], 100)) {
    const { data, error } = await supabase
      .from('receipt_vendors')
      .select('id, vendor_key, invoice_vendor_id')
      .not('invoice_vendor_id', 'is', null)
      .in('id', chunk)
    if (error) throw new Error(`Failed to find the customers for these payments: ${error.message}`)
    record((data ?? []) as Array<{ id: string; vendor_key: string | null; invoice_vendor_id: string | null }>)
  }
  for (const chunk of chunkArray([...vendorKeys], 100)) {
    const { data, error } = await supabase
      .from('receipt_vendors')
      .select('id, vendor_key, invoice_vendor_id')
      .not('invoice_vendor_id', 'is', null)
      .in('vendor_key', chunk)
    if (error) throw new Error(`Failed to find the customers for these payments: ${error.message}`)
    record((data ?? []) as Array<{ id: string; vendor_key: string | null; invoice_vendor_id: string | null }>)
  }

  const result = new Map<string, string>()
  for (const transaction of transactions) {
    const direct = transaction.vendor_id ? byId.get(transaction.vendor_id) : undefined
    if (direct) {
      result.set(transaction.id, direct)
      continue
    }
    const key = normalizeReceiptVendorKey(normalizeVendorInput(transaction.vendor_name))
    const viaKey = key ? byKey.get(key) : undefined
    if (viaKey) result.set(transaction.id, viaKey)
  }

  return result
}

/**
 * The invoice number a match waiting for a person is filed under. Matches are unique per bank
 * payment and invoice number, so filing it under a real invoice let the first payment recorded
 * against that invoice overwrite it, and the rest of a person's choice dropped off the list.
 */
export const REVIEW_MATCH_KEY = 'REVIEW'

/** Everything needed to decide one customer's payments: their invoices, entries and other money. */
type CustomerBook = {
  invoices: CustomerInvoice[]
  rowById: Map<string, InvoiceRow>
  /** Bank-transfer payments entered against their invoices that no bank line is linked to yet. */
  entries: EnteredPayment[]
  /** Their bank payments that no entered payment accounts for, matched otherwise or not, filed or not. */
  others: CustomerBankPayment[]
  /** Their invoices bank payments already point at, and which payments. */
  claims: Map<string, Set<string>>
}

/**
 * The invoices a bank payment other than this one already points at. A payment's own match does
 * not count against it: a payment quoting a credited invoice it paid in full points at it already.
 */
function invoicesClaimedByOthers(book: CustomerBook, transactionId: string): Set<string> {
  const claimed = new Set<string>()
  for (const [invoiceId, payments] of book.claims) {
    if ([...payments].some((payment) => payment !== transactionId)) claimed.add(invoiceId)
  }
  return claimed
}

function addClaim(book: CustomerBook, invoiceId: string, transactionId: string): void {
  book.claims.set(invoiceId, new Set([...(book.claims.get(invoiceId) ?? []), transactionId]))
}

type EnteredPaymentRow = {
  id: string
  invoice_id: string
  payment_date: string
  amount: number | string
  payment_method: string | null
  source_kind: string | null
}

/** Which of these bank payments an entered payment already accounts for. */
async function loadLinesLinkedToEntries(supabase: AdminClient, transactionIds: string[]): Promise<Set<string>> {
  const linked = new Set<string>()
  for (const chunk of chunkArray([...new Set(transactionIds)], 100)) {
    const rows = await fetchAllRows<{ receipt_transaction_id: string }>(
      (from, to) =>
        supabase
          .from('receipt_invoice_matches')
          .select('id, receipt_transaction_id')
          .in('receipt_transaction_id', chunk)
          .not('invoice_payment_id', 'is', null)
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'bank payments linked to an entered payment' }
    )
    for (const row of rows) linked.add(row.receipt_transaction_id)
  }
  return linked
}

async function loadCustomerBook(
  supabase: AdminClient,
  invoiceVendorId: string,
  payments: ReceiptTransaction[]
): Promise<CustomerBook> {
  const rows = await fetchAllRows<InvoiceRow & { invoice_date: string }>(
    (from, to) =>
      supabase
        .from('invoices')
        .select('*, vendor:invoice_vendors(id, name)')
        .eq('vendor_id', invoiceVendorId)
        .is('deleted_at', null)
        .order('invoice_date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'customer invoices for reconciliation' }
  )
  const invoiceIds = rows.map((row) => row.id)
  const credited = await loadCreditedByInvoice(supabase, invoiceIds)

  const entered: EnteredPaymentRow[] = []
  for (const chunk of chunkArray(invoiceIds, 100)) {
    entered.push(
      ...(await fetchAllRows<EnteredPaymentRow>(
        (from, to) =>
          supabase
            .from('invoice_payments')
            .select('id, invoice_id, payment_date, amount, payment_method, source_kind')
            .in('invoice_id', chunk)
            .order('id', { ascending: true })
            .range(from, to),
        { label: 'payments entered on customer invoices' }
      ))
    )
  }

  // An entry another bank line already accounts for cannot be this payment too.
  const linked = new Set<string>()
  for (const chunk of chunkArray(entered.map((entry) => entry.id), 100)) {
    const matches = await fetchAllRows<{ invoice_payment_id: string | null }>(
      (from, to) =>
        supabase
          .from('receipt_invoice_matches')
          .select('id, invoice_payment_id')
          .in('invoice_payment_id', chunk)
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'entries already linked to a bank payment' }
    )
    for (const match of matches) if (match.invoice_payment_id) linked.add(match.invoice_payment_id)
  }

  const paidByInvoice = new Map<string, number>()
  for (const entry of entered) paidByInvoice.set(entry.invoice_id, (paidByInvoice.get(entry.invoice_id) ?? 0) + moneyValue(entry.amount))

  const invoices: CustomerInvoice[] = rows.map((row) => ({
    id: row.id,
    invoiceNumber: row.invoice_number,
    invoiceDate: row.invoice_date,
    status: row.status,
    totalAmount: moneyValue(row.total_amount),
    creditedAmount: credited.get(row.id) ?? 0,
    paidAmount: paidByInvoice.get(row.id) ?? 0,
  }))

  // Only a bank transfer arrives as a bank payment from the customer: cash, cards, cheques and
  // PayPal reach the account some other way, if at all.
  const entries: EnteredPayment[] = entered
    .filter(
      (entry) =>
        !linked.has(entry.id) &&
        entry.source_kind !== 'paypal' &&
        (!entry.payment_method || entry.payment_method === 'bank_transfer')
    )
    .map((entry) => ({ id: entry.id, invoiceId: entry.invoice_id, paymentDate: entry.payment_date, amount: moneyValue(entry.amount) }))

  // Invoices another bank payment already points at: a second payment on one goes to a person.
  const claims = new Map<string, Set<string>>()
  for (const chunk of chunkArray(invoiceIds, 100)) {
    const rows = await fetchAllRows<{ invoice_id: string | null; receipt_transaction_id: string }>(
      (from, to) =>
        supabase
          .from('receipt_invoice_matches')
          .select('id, invoice_id, receipt_transaction_id')
          .in('invoice_id', chunk)
          .neq('match_status', 'review_required')
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'invoices other payments point at' }
    )
    for (const row of rows) {
      if (row.invoice_id) claims.set(row.invoice_id, new Set([...(claims.get(row.invoice_id) ?? []), row.receipt_transaction_id]))
    }
  }

  // The customer's other bank payments around these dates that no entered payment accounts for,
  // whether matched some other way or in a filed period: an entry one of them could equally be is
  // linked to none of them. A quoted-reference payment marked "already paid" is one of these.
  const { data: vendorRows, error: vendorError } = await supabase
    .from('receipt_vendors')
    .select('id')
    .eq('invoice_vendor_id', invoiceVendorId)
    .limit(100)
  if (vendorError) throw new Error(`Failed to read the customer's receipt vendors: ${vendorError.message}`)
  const receiptVendorIds = ((vendorRows ?? []) as Array<{ id: string }>).map((row) => row.id)

  const dates = payments.map((payment) => payment.transaction_date).sort()
  const windowStart = shiftIsoDate(dates[0], -14) ?? dates[0]
  const windowEnd = shiftIsoDate(dates[dates.length - 1], 14) ?? dates[dates.length - 1]
  const nearby = receiptVendorIds.length
    ? await fetchAllRows<{ id: string; transaction_date: string; amount_in: number | string | null }>(
        (from, to) => {
          const query = supabase
            .from('receipt_transactions')
            .select('id, transaction_date, amount_in')
            .in('vendor_id', receiptVendorIds)
            .gt('amount_in', 0)
            .gte('transaction_date', windowStart)
            .lte('transaction_date', windowEnd)
            .order('transaction_date', { ascending: true })
            .order('id', { ascending: true })
          return query.range(from, to)
        },
        { label: "the customer's bank payments nearby" }
      )
    : []
  const nearbyLinked = await loadLinesLinkedToEntries(supabase, nearby.map((row) => row.id))
  const others = new Map<string, CustomerBankPayment>()
  for (const row of nearby) {
    if (!nearbyLinked.has(row.id)) others.set(row.id, { id: row.id, date: row.transaction_date, amount: moneyValue(row.amount_in) })
  }
  for (const payment of payments) {
    others.set(payment.id, { id: payment.id, date: payment.transaction_date, amount: receiptTransactionAmount(payment) })
  }

  return {
    invoices,
    rowById: new Map(rows.map((row) => [row.id, row])),
    entries,
    others: [...others.values()],
    claims,
  }
}

type ReviewDecision = Extract<CustomerPaymentDecision, { kind: 'review' }>

/**
 * Stores a customer payment for a person to confirm, with every option that fitted and the
 * customer's recent invoices. The match carries no invoice id, so it claims no invoice, is left
 * out of the accountant's pack and gets no invoice copy; its invoice number is only the likeliest
 * candidate, so the match can be found.
 */
async function storeCustomerPaymentForReview(
  supabase: AdminClient,
  transaction: ReceiptTransaction,
  decision: ReviewDecision,
  book: CustomerBook,
  initiatedBy: string | null,
  /** More for the person deciding, such as the invoice number the payment quoted. */
  context: Record<string, unknown> = {}
): Promise<void> {
  const numberOf = (invoiceId: string) => book.rowById.get(invoiceId)?.invoice_number ?? null

  await applyInvoiceMatch(supabase, {
    transaction,
    invoiceNumber: REVIEW_MATCH_KEY,
    invoice: null,
    invoicePaymentId: null,
    status: 'review_required',
    amountMatch: false,
    allowStatusChange: false,
    receiptVendor: null,
    initiatedBy,
    payload: {
      ...context,
      review_reason: decision.reason,
      options: [
        ...decision.entryOptions.map((option) => ({
          kind: 'link',
          entries: option.map((entry) => ({
            payment_id: entry.id,
            invoice_id: entry.invoiceId,
            invoice_number: numberOf(entry.invoiceId),
            payment_date: entry.paymentDate,
            amount: entry.amount,
          })),
        })),
        ...decision.invoiceOptions.map((option) => ({
          kind: 'record',
          allocations: option.map((part) => ({
            invoice_id: part.invoice.id,
            invoice_number: part.invoice.invoiceNumber,
            invoice_date: part.invoice.invoiceDate,
            amount: part.amount,
          })),
        })),
      ],
      recent_invoices: decision.recentInvoices.map((invoice) => ({
        invoice_id: invoice.id,
        invoice_number: invoice.invoiceNumber,
        invoice_date: invoice.invoiceDate,
        status: invoice.status,
        total: invoice.totalAmount,
        outstanding: outstandingOf(invoice),
      })),
    },
  })
}

/** What to do with one customer payment, from the customer's invoices, entries and other payments. */
function decideForBook(
  transaction: ReceiptTransaction,
  book: CustomerBook,
  caution: QuotedInvoiceCaution | null = null
): CustomerPaymentDecision {
  return decideCustomerPayment(
    { id: transaction.id, date: transaction.transaction_date, amount: receiptTransactionAmount(transaction) },
    book.invoices,
    book.entries,
    book.others,
    invoicesClaimedByOthers(book, transaction.id),
    caution
  )
}

/** The invoice number a decision files the payment's match under. */
function decidedInvoiceNumber(decision: Exclude<CustomerPaymentDecision, { kind: 'none' }>, book: CustomerBook): string | null {
  if (decision.kind === 'review') return REVIEW_MATCH_KEY
  const invoiceId = decision.kind === 'link' ? decision.entry.invoiceId : decision.allocation.invoice.id
  return book.rowById.get(invoiceId)?.invoice_number ?? null
}

/** Carries out a decision about one customer payment: a link, a recorded payment, or a match for a person. */
async function carryOutCustomerDecision(
  supabase: AdminClient,
  summary: ReconciliationSummary,
  transaction: ReceiptTransaction,
  decision: Exclude<CustomerPaymentDecision, { kind: 'none' }>,
  book: CustomerBook,
  initiatedBy: string | null,
  reviewContext: Record<string, unknown> = {}
): Promise<void> {
  const amount = receiptTransactionAmount(transaction)

  if (decision.kind === 'review') {
    await storeCustomerPaymentForReview(supabase, transaction, decision, book, initiatedBy, reviewContext)
    if (summary.samples.length < 20) {
      summary.samples.push({ transactionId: transaction.id, invoiceNumber: '', status: 'review_required', details: transaction.details, amount })
    }
    return
  }

  if (decision.kind === 'link') {
    const { entry } = decision
    const invoice = book.rowById.get(entry.invoiceId)
    if (!invoice) throw new Error(`Invoice ${entry.invoiceId} for an entered payment was not loaded`)
    const receiptVendor = await ensureReceiptVendorLinkedToInvoiceVendor(supabase, invoice.vendor?.name ?? null, invoice.vendor_id)
    const result = await applyInvoiceMatch(supabase, {
      transaction,
      invoiceNumber: invoice.invoice_number,
      invoice,
      invoicePaymentId: entry.id,
      status: 'matched',
      amountMatch: true,
      allowStatusChange: true,
      receiptVendor,
      initiatedBy,
      matchedAmount: entry.amount,
      payload: { match_method: 'entered_payment', entered_payment_id: entry.id, entered_payment_date: entry.paymentDate },
    })
    if (result.statusUpdated) summary.statusUpdated += 1
    if (result.classificationUpdated) summary.classificationUpdated += 1
    book.entries = book.entries.filter((candidate) => candidate.id !== entry.id)
    addClaim(book, entry.invoiceId, transaction.id)
    summary.matched += 1
    if (summary.samples.length < 20) {
      summary.samples.push({ transactionId: transaction.id, invoiceNumber: invoice.invoice_number, status: 'matched', details: transaction.details, amount })
    }
    return
  }

  const { allocation } = decision
  const invoice = book.rowById.get(allocation.invoice.id)
  if (!invoice) throw new Error(`Invoice ${allocation.invoice.invoiceNumber} was not loaded`)
  const receiptVendor = await ensureReceiptVendorLinkedToInvoiceVendor(supabase, invoice.vendor?.name ?? null, invoice.vendor_id)
  const result = await applyInvoiceMatch(supabase, {
    transaction,
    invoiceNumber: invoice.invoice_number,
    invoice,
    invoicePaymentId: null,
    status: 'payment_recorded',
    amountMatch: true,
    allowStatusChange: true,
    receiptVendor,
    initiatedBy,
    recordPaymentAmount: allocation.amount,
    payload: {
      match_method: 'customer_amount_date',
      invoice_total: allocation.invoice.totalAmount,
      invoice_credited: allocation.invoice.creditedAmount,
      invoice_outstanding_before: allocation.amount,
    },
  })
  if (result.overAllocated) {
    throw new Error(`The bank payment has nothing left to record against ${invoice.invoice_number}`)
  }
  if (result.paymentRecorded) summary.paymentsRecorded += 1
  if (result.statusUpdated) summary.statusUpdated += 1
  if (result.classificationUpdated) summary.classificationUpdated += 1
  // The invoice now owes less and has a payment, and a later payment in this run must see that.
  allocation.invoice.paidAmount += allocation.amount
  addClaim(book, allocation.invoice.id, transaction.id)
  book.others = book.others.filter((other) => other.id !== transaction.id)
  summary.matched += 1
  if (summary.samples.length < 20) {
    summary.samples.push({ transactionId: transaction.id, invoiceNumber: invoice.invoice_number, status: 'payment_recorded', details: transaction.details, amount })
  }
}

/**
 * Customer payments that quote no invoice number, matched by the rules in invoice-pairing.ts:
 * linked to a payment already entered by hand, recorded against the one invoice or set of
 * invoices they settle, or stored for a person. A payment already matched, or waiting for a
 * person, is not looked at again.
 */
async function runReferenceFreePass(
  supabase: AdminClient,
  summary: ReconciliationSummary,
  failures: string[],
  options: { transactionIds?: string[]; initiatedBy: string | null }
): Promise<void> {
  const { lockDate } = await loadReceiptSettings(supabase)
  const candidates = await fetchReferenceFreeCandidates(supabase, options.transactionIds, lockDate)
  if (!candidates.length) return

  const matched = await loadMatchedTransactionIds(supabase, candidates.map((transaction) => transaction.id))
  const open = candidates.filter((transaction) => !matched.has(transaction.id))
  if (!open.length) return

  const customerByTransaction = await resolveInvoiceVendorIds(supabase, open)
  const byCustomer = new Map<string, ReceiptTransaction[]>()
  for (const transaction of open) {
    const customer = customerByTransaction.get(transaction.id)
    if (customer) byCustomer.set(customer, [...(byCustomer.get(customer) ?? []), transaction])
  }

  for (const [invoiceVendorId, payments] of byCustomer) {
    // Oldest first, so that an earlier payment settles an invoice before a later one looks at it.
    const ordered = [...payments].sort(
      (left, right) => left.transaction_date.localeCompare(right.transaction_date) || left.id.localeCompare(right.id)
    )
    const book = await loadCustomerBook(supabase, invoiceVendorId, ordered)
    for (const transaction of ordered) {
      summary.referenceFreeReviewed += 1
      try {
        const decision = decideForBook(transaction, book)
        if (decision.kind === 'none') continue
        await carryOutCustomerDecision(supabase, summary, transaction, decision, book, options.initiatedBy)
        if (decision.kind === 'link') summary.referenceFreeLinked += 1
        else if (decision.kind === 'record') summary.referenceFreeRecorded += 1
        else summary.referenceFreeForReview += 1
      } catch (error) {
        await storeFailureForReview(supabase, summary, failures, transaction, REVIEW_MATCH_KEY, error, options.initiatedBy)
      }
    }
  }
}

/**
 * A payment that failed part way is stored for a person, with the reason, and the run goes on
 * with the others. Only when even that cannot be stored is the failure kept, so the run ends in
 * an error and the job is retried.
 */
async function storeFailureForReview(
  supabase: AdminClient,
  summary: ReconciliationSummary,
  failures: string[],
  transaction: ReceiptTransaction,
  invoiceNumber: string,
  error: unknown,
  initiatedBy: string | null
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  console.error('Invoice reconciliation failed for a payment:', { transactionId: transaction.id, message })
  try {
    await applyInvoiceMatch(supabase, {
      transaction,
      invoiceNumber,
      invoice: null,
      invoicePaymentId: null,
      status: 'review_required',
      amountMatch: false,
      allowStatusChange: false,
      receiptVendor: null,
      initiatedBy,
      payload: { review_reason: 'error', error: message },
    })
    summary.failedForReview += 1
  } catch {
    failures.push(message)
  }
}

type StoredMatchRow = {
  id: string
  receipt_transaction_id: string
  invoice_id: string | null
  invoice_number: string
  match_status: string
  invoice_payment_id: string | null
  transaction_date: string
  payload: Record<string, unknown> | null
}

const STORED_MATCH_COLUMNS = 'id, receipt_transaction_id, invoice_id, invoice_number, match_status, invoice_payment_id, transaction_date, payload'

/** A match waiting for a person that a person has taken off the list. */
function isSetAside(match: StoredMatchRow): boolean {
  return match.match_status === 'review_required' && Boolean(match.payload?.dismissed_at)
}

/** Every match held for these bank payments, whatever its status. */
async function loadMatchesOfPayments(supabase: AdminClient, transactionIds: string[]): Promise<StoredMatchRow[]> {
  const rows: StoredMatchRow[] = []
  for (const chunk of chunkArray([...new Set(transactionIds)], 100)) {
    rows.push(
      ...(await fetchAllRows<StoredMatchRow>(
        (from, to) =>
          supabase
            .from('receipt_invoice_matches')
            .select(STORED_MATCH_COLUMNS)
            .in('receipt_transaction_id', chunk)
            .order('id', { ascending: true })
            .range(from, to),
        { label: 'matches of these payments' }
      ))
    )
  }
  return rows
}

/** Every match held against these invoices, from any bank payment. */
async function loadMatchesOnInvoices(supabase: AdminClient, invoiceIds: string[]): Promise<StoredMatchRow[]> {
  const rows: StoredMatchRow[] = []
  for (const chunk of chunkArray([...new Set(invoiceIds)], 100)) {
    rows.push(
      ...(await fetchAllRows<StoredMatchRow>(
        (from, to) =>
          supabase
            .from('receipt_invoice_matches')
            .select(STORED_MATCH_COLUMNS)
            .in('invoice_id', chunk)
            .order('id', { ascending: true })
            .range(from, to),
        { label: 'matches on the quoted invoices' }
      ))
    )
  }
  return rows
}

/**
 * Matches already settled, as "payment id|INVOICE NUMBER": a recorded payment or a link to an
 * entered one. Working those out again stored "amount mismatch" over a part payment the run had
 * itself recorded.
 */
function settledMatchKeys(rows: StoredMatchRow[]): Set<string> {
  return new Set(
    rows
      .filter((row) => row.match_status === 'payment_recorded' || row.match_status === 'matched')
      .map((row) => `${row.receipt_transaction_id}|${row.invoice_number.toUpperCase()}`)
  )
}

/**
 * Matches that say a bank payment was the invoice's money. "Amount mismatch" and "several invoice
 * numbers" only say the payment quoted it, which says nothing about who paid it.
 */
const SETTLING_STATUSES = new Set(['matched', 'payment_recorded', 'already_paid', 'vendor_amount_matched'])

/**
 * The bank payment that settled each invoice: the first by date that a match says was its money,
 * or, in this run, that quotes only that invoice for an amount that fits it. From the matches held
 * and the run's own payments, so the answer does not depend on the order they are read in. Only
 * that payment can be the one that settled an invoice it quotes for the right amount.
 */
function settlingPaymentForEachInvoice(
  held: StoredMatchRow[],
  transactions: ReceiptTransaction[],
  refsByTransaction: Map<string, string[]>,
  invoiceByNumber: Map<string, InvoiceRow>,
  creditedByInvoice: Map<string, number>
): Map<string, string> {
  const first = new Map<string, { date: string; id: string }>()
  const consider = (invoiceId: string, date: string, id: string) => {
    const current = first.get(invoiceId)
    if (!current || date < current.date || (date === current.date && id < current.id)) first.set(invoiceId, { date, id })
  }
  for (const row of held) {
    if (row.invoice_id && SETTLING_STATUSES.has(row.match_status)) {
      consider(row.invoice_id, row.transaction_date, row.receipt_transaction_id)
    }
  }
  for (const transaction of transactions) {
    const refs = refsByTransaction.get(transaction.id) ?? []
    // A payment quoting several invoices is split by a person, so it settles none on its own here.
    if (refs.length !== 1) continue
    const invoice = invoiceByNumber.get(refs[0])
    if (invoice && paysInvoiceInFull(receiptTransactionAmount(transaction), invoice, creditedByInvoice.get(invoice.id) ?? 0)) {
      consider(invoice.id, transaction.transaction_date, transaction.id)
    }
  }
  return new Map([...first].map(([invoiceId, payment]) => [invoiceId, payment.id]))
}

/** A payment quoting an invoice with nothing left to pay, which is not the payment that settled it. */
type QuotedSettledPayment = {
  transaction: ReceiptTransaction
  invoiceNumber: string
  invoice: InvoiceRow
  /** The match stored before this rule, and still stored when nothing else fits. */
  fallbackStatus: 'already_paid' | 'amount_mismatch'
  amountMatch: boolean
  matchPayload: Record<string, unknown>
  /** Set when the payment may still be the quoted invoice's money (cautionForQuotedInvoice). */
  caution: QuotedInvoiceCaution | null
}

/**
 * Whether a payment quoting an invoice with nothing left to pay may still be that invoice's
 * money: the invoice was written off, or a payment was entered on it, by any method, from a month
 * before to two months after this one. A customer paying one invoice in two transfers, entered by
 * hand as one sum, is the case: the second transfer must not be recorded on another invoice.
 */
function cautionForQuotedInvoice(
  invoice: InvoiceRow,
  transaction: ReceiptTransaction,
  entered: InvoicePaymentRow[]
): QuotedInvoiceCaution | null {
  if (invoice.status === 'written_off') return { invoiceId: invoice.id, reason: 'quoted_invoice_written_off' }
  const from = shiftIsoDate(transaction.transaction_date, -LOOSE_ENTRY_DAYS_BEFORE)
  const to = shiftIsoDate(transaction.transaction_date, LOOSE_ENTRY_DAYS_AFTER)
  const nearby = entered.some((payment) => Boolean(from && to && payment.payment_date >= from && payment.payment_date <= to))
  return nearby ? { invoiceId: invoice.id, reason: 'quoted_invoice_paid_nearby' } : null
}

type ReferencedPaymentContext = {
  transaction: ReceiptTransaction
  refs: string[]
  invoiceByNumber: Map<string, InvoiceRow>
  paymentByInvoice: Map<string, InvoicePaymentRow[]>
  creditedByInvoice: Map<string, number>
  settledMatches: Set<string>
  recordPayments: boolean
  initiatedBy: string | null
  /** Payments on or before this date are in filed periods and are matched as they always were. */
  lockDate: string | null
  /** The bank payment that settled each invoice, by invoice id (settlingPaymentForEachInvoice). */
  settlingPaymentByInvoice: Map<string, string>
  /** Collects the payments decided after this pass by `settlePaymentsQuotingSettledInvoices`. */
  quotingSettled: QuotedSettledPayment[]
}

/** One bank payment that quotes one or more invoice numbers. */
async function reconcileReferencedPayment(
  supabase: AdminClient,
  summary: ReconciliationSummary,
  context: ReferencedPaymentContext
): Promise<void> {
  const { transaction, refs, invoiceByNumber, paymentByInvoice, creditedByInvoice, settledMatches, initiatedBy } = context

  // One bank payment quoting several invoices cannot be split by guesswork: each invoice
  // would otherwise be offered the whole amount. Record what was quoted and leave the
  // payment, and the invoice ledger, for a person.
  const quotesSeveralInvoices = refs.length > 1
  if (quotesSeveralInvoices) summary.multipleInvoiceRefs += 1

  for (const invoiceNumber of refs) {
    const invoice = invoiceByNumber.get(invoiceNumber) ?? null
    const amount = receiptTransactionAmount(transaction)

    if (settledMatches.has(`${transaction.id}|${invoiceNumber}`)) {
      summary.matched += 1
      continue
    }

    if (!invoice) {
      summary.missingInvoice += 1
      await applyInvoiceMatch(supabase, {
        transaction,
        invoiceNumber,
        invoice: null,
        invoicePaymentId: null,
        status: 'missing_invoice',
        amountMatch: false,
        allowStatusChange: false,
        receiptVendor: null,
        initiatedBy,
        payload: { details: transaction.details },
      })
      if (summary.samples.length < 20) {
        summary.samples.push({ transactionId: transaction.id, invoiceNumber, status: 'missing_invoice', details: transaction.details, amount })
      }
      continue
    }

    const invoiceTotal = moneyValue(invoice.total_amount)
    const paidBefore = moneyValue(invoice.paid_amount)
    const credited = creditedByInvoice.get(invoice.id) ?? 0
    const outstanding = amountLeftToPay(invoice, credited)
    const matchPayload = {
      invoice_status_before: invoice.status,
      invoice_total: invoiceTotal,
      invoice_credited: credited,
      invoice_paid_before: paidBefore,
      invoice_outstanding_before: outstanding,
      existing_payments: (paymentByInvoice.get(invoice.id) ?? []).map((payment) => ({
        id: payment.id,
        amount: moneyValue(payment.amount),
        payment_date: payment.payment_date,
        reference: payment.reference,
      })),
    }

    if (quotesSeveralInvoices) {
      await applyInvoiceMatch(supabase, {
        transaction,
        invoiceNumber,
        invoice,
        invoicePaymentId: null,
        status: 'multiple_invoice_refs',
        amountMatch: false,
        allowStatusChange: false,
        receiptVendor: null,
        initiatedBy,
        payload: { ...matchPayload, quoted_invoice_numbers: refs },
      })
      if (summary.samples.length < 20) {
        summary.samples.push({ transactionId: transaction.id, invoiceNumber, status: 'multiple_invoice_refs', details: transaction.details, amount })
      }
      continue
    }

    const amountCanBePayment = amount > 0 && amount <= outstanding + MONEY_EPSILON
    // The same test decides which payment settled an invoice (settlingPaymentForEachInvoice).
    const amountMatch = amountFitsInvoice(amount, invoice, credited)

    let status: StoredInvoiceMatchStatus = 'matched'
    let recordPayment = false
    let storedAmountMatch = amountMatch

    if (isPaidStatus(invoice.status) || outstanding <= MONEY_EPSILON) {
      const paidInFull = paysInvoiceInFull(amount, invoice, credited)
      const closedStatus = paidInFull ? ('already_paid' as const) : ('amount_mismatch' as const)
      // Nothing is left to pay. Unless this is the payment that settled the invoice, it may be
      // paying another of the customer's invoices: ASE Associates' standing order quotes its May
      // invoice every month. Outside filed periods it is decided after this pass, as a payment
      // with no invoice number. A cancelled or written-off invoice was settled by no payment.
      const settledByThisPayment =
        paidInFull && !isCancelledStatus(invoice.status) && context.settlingPaymentByInvoice.get(invoice.id) === transaction.id
      const filed = Boolean(context.lockDate && transaction.transaction_date <= context.lockDate)
      if (!settledByThisPayment && !filed && invoice.vendor_id) {
        context.quotingSettled.push({
          transaction,
          invoiceNumber,
          invoice,
          fallbackStatus: closedStatus,
          amountMatch: paidInFull,
          matchPayload,
          caution: cautionForQuotedInvoice(invoice, transaction, paymentByInvoice.get(invoice.id) ?? []),
        })
        continue
      }
      status = closedStatus
      storedAmountMatch = paidInFull
    } else if (!amountCanBePayment) {
      status = 'amount_mismatch'
    } else if (context.recordPayments) {
      status = 'payment_recorded'
      recordPayment = true
    }

    await storeReferencedMatch(supabase, summary, {
      transaction,
      invoiceNumber,
      invoice,
      status,
      amountMatch: storedAmountMatch,
      recordPayment,
      matchPayload,
      initiatedBy,
    })
  }
}

/** Stores the match for an invoice a payment quotes, recording the payment on the invoice when it pays it. */
async function storeReferencedMatch(
  supabase: AdminClient,
  summary: ReconciliationSummary,
  params: {
    transaction: ReceiptTransaction
    invoiceNumber: string
    invoice: InvoiceRow
    status: StoredInvoiceMatchStatus
    amountMatch: boolean
    recordPayment: boolean
    matchPayload: Record<string, unknown>
    initiatedBy: string | null
  }
): Promise<void> {
  const { transaction, invoiceNumber, invoice, amountMatch, recordPayment, matchPayload, initiatedBy } = params
  const amount = receiptTransactionAmount(transaction)
  let status = params.status

  if (status === 'already_paid') summary.alreadyPaid += 1
  if (status === 'amount_mismatch') summary.amountMismatch += 1

  const receiptVendor = await ensureReceiptVendorLinkedToInvoiceVendor(
    supabase,
    invoice.vendor?.name ?? null,
    invoice.vendor_id
  )

  let updateResult = await applyInvoiceMatch(supabase, {
    transaction,
    invoiceNumber,
    invoice,
    invoicePaymentId: null,
    status,
    amountMatch,
    allowStatusChange: true,
    receiptVendor,
    initiatedBy,
    payload: matchPayload,
    recordPaymentAmount: recordPayment ? amount : undefined,
  })

  if (updateResult.overAllocated) {
    // The bank payment has already paid other invoices in full. Nothing is recorded on the
    // ledger; the match is stored for a person to look at and the payment is left alone.
    summary.overAllocated += 1
    status = 'review_required'
    updateResult = await applyInvoiceMatch(supabase, {
      transaction,
      invoiceNumber,
      invoice,
      invoicePaymentId: null,
      status,
      amountMatch: false,
      allowStatusChange: false,
      receiptVendor: null,
      initiatedBy,
      payload: { ...matchPayload, over_allocated: updateResult.overAllocated },
    })
  } else if (updateResult.paymentRecorded) {
    summary.paymentsRecorded += 1
  }

  if (updateResult.statusUpdated) summary.statusUpdated += 1
  if (updateResult.classificationUpdated) summary.classificationUpdated += 1

  summary.matched += 1
  if (summary.samples.length < 20) {
    summary.samples.push({ transactionId: transaction.id, invoiceNumber, status, details: transaction.details, amount })
  }
}

/**
 * What a payment may hold against the invoice it quoted from before it was decided this way: the
 * old "already paid" or "amount mismatch", or a failed attempt left for a person. None of them is
 * true once the payment is filed under the invoice it paid, and a failed attempt left waiting
 * would also hold the client's reminders.
 */
const SUPERSEDED_QUOTED_STATUSES = ['already_paid', 'amount_mismatch', 'review_required']

/**
 * Removes the match a payment holds against the invoice it quoted, once it is filed under the
 * invoice it paid. Only that row, and only while it still says what it said. A failure leaves it
 * in place and the next run tries again.
 */
async function removeQuotedSettledMatch(supabase: AdminClient, match: StoredMatchRow): Promise<void> {
  const { error } = await supabase
    .from('receipt_invoice_matches')
    .delete()
    .eq('id', match.id)
    .in('match_status', SUPERSEDED_QUOTED_STATUSES)
    .is('invoice_payment_id', null)
    .is('payload->>dismissed_at', null)
  if (error) {
    console.error('Failed to remove a match against the invoice a payment quoted', { matchId: match.id, error })
  }
}

/**
 * Payments quoting an invoice with nothing left to pay, which are not the payment that settled it,
 * decided as customer payments with no invoice number (invoice-pairing.ts): linked to a payment
 * entered by hand, recorded against the one invoice they settle, or stored for a person with the
 * invoice they quoted. ASE Associates' standing order quotes its May invoice every month; each
 * month's payment was stored as "amount mismatch" against it, and the month's invoice was marked
 * paid only because the owner entered every payment by hand. When nothing fits at all, the match
 * is stored against the quoted invoice as it always was. A payer known to be another customer, and
 * a payment that may still be the quoted invoice's own money (cautionForQuotedInvoice), go to a
 * person rather than onto another invoice.
 */
async function settlePaymentsQuotingSettledInvoices(
  supabase: AdminClient,
  summary: ReconciliationSummary,
  failures: string[],
  payments: QuotedSettledPayment[],
  matchesByPayment: Map<string, StoredMatchRow[]>,
  initiatedBy: string | null
): Promise<void> {
  const payerByPayment = await resolveInvoiceVendorIds(supabase, payments.map((payment) => payment.transaction))
  const byCustomer = new Map<string, Array<{ payment: QuotedSettledPayment; quotedMatch: StoredMatchRow | undefined }>>()

  for (const payment of payments) {
    const { transaction, invoiceNumber } = payment
    const customer = payment.invoice.vendor_id
    if (!customer) continue
    const held = matchesByPayment.get(transaction.id) ?? []
    // What the payment holds against the quoted invoice from before: removed once it is filed
    // elsewhere. Never one a person has taken off the list.
    const quotedMatch = held.find(
      (match) =>
        match.invoice_number.toUpperCase() === invoiceNumber &&
        SUPERSEDED_QUOTED_STATUSES.includes(match.match_status) &&
        !match.invoice_payment_id &&
        !isSetAside(match)
    )

    try {
      // Decided by an earlier run: linked, recorded, or waiting for a person under another invoice.
      if (held.some((match) => match.invoice_number.toUpperCase() !== invoiceNumber)) {
        if (quotedMatch) await removeQuotedSettledMatch(supabase, quotedMatch)
        continue
      }
      // A person already took it off the list.
      if (held.some((match) => match.invoice_number.toUpperCase() === invoiceNumber && isSetAside(match))) continue

      // The quoted invoice says whose payment it is, unless the payer is known to be someone else:
      // a payment quoting another customer's invoice number by mistake goes to a person, with its
      // own vendor and status left as they are, so later runs still see who paid it.
      const payer = payerByPayment.get(transaction.id)
      if (payer && payer !== customer) {
        await applyInvoiceMatch(supabase, {
          transaction,
          invoiceNumber,
          invoice: null,
          invoicePaymentId: null,
          status: 'review_required',
          amountMatch: false,
          allowStatusChange: false,
          receiptVendor: null,
          initiatedBy,
          payload: {
            ...payment.matchPayload,
            review_reason: 'payer_is_another_customer',
            quoted_invoice_number: invoiceNumber,
            quoted_invoice_status: payment.invoice.status,
            payer_invoice_vendor_id: payer,
          },
        })
        summary.quotedSettledForReview += 1
        continue
      }
    } catch (error) {
      await storeFailureForReview(supabase, summary, failures, transaction, invoiceNumber, error, initiatedBy)
      continue
    }

    byCustomer.set(customer, [...(byCustomer.get(customer) ?? []), { payment, quotedMatch }])
  }

  for (const [invoiceVendorId, group] of byCustomer) {
    // Oldest first, so that an earlier payment settles an invoice before a later one looks at it.
    const ordered = [...group].sort(
      (left, right) =>
        left.payment.transaction.transaction_date.localeCompare(right.payment.transaction.transaction_date) ||
        left.payment.transaction.id.localeCompare(right.payment.transaction.id)
    )
    const book = await loadCustomerBook(supabase, invoiceVendorId, ordered.map((item) => item.payment.transaction))

    for (const { payment, quotedMatch } of ordered) {
      const { transaction, invoiceNumber } = payment
      try {
        const decision = decideForBook(transaction, book, payment.caution)
        if (decision.kind === 'none') {
          await storeReferencedMatch(supabase, summary, {
            transaction,
            invoiceNumber,
            invoice: payment.invoice,
            status: payment.fallbackStatus,
            amountMatch: payment.amountMatch,
            recordPayment: false,
            matchPayload: payment.matchPayload,
            initiatedBy,
          })
          continue
        }

        await carryOutCustomerDecision(supabase, summary, transaction, decision, book, initiatedBy, {
          quoted_invoice_number: invoiceNumber,
          quoted_invoice_status: payment.invoice.status,
        })
        if (decision.kind === 'link') summary.quotedSettledLinked += 1
        else if (decision.kind === 'record') summary.quotedSettledRecorded += 1
        else summary.quotedSettledForReview += 1

        // A payment linked to the quoted invoice's own entry is stored under that invoice's number,
        // which replaced the old match; anything filed elsewhere leaves the old match to remove.
        if (quotedMatch && decidedInvoiceNumber(decision, book)?.toUpperCase() !== invoiceNumber) {
          await removeQuotedSettledMatch(supabase, quotedMatch)
        }
      } catch (error) {
        await storeFailureForReview(supabase, summary, failures, transaction, invoiceNumber, error, initiatedBy)
      }
    }
  }
}

export async function performReconcileReceiptInvoicePayments(options: {
  transactionIds?: string[]
  recordPayments?: boolean
  /** The user whose import started this run, recorded on the log rows it writes. */
  initiatedBy?: string | null
} = {}): Promise<ReconciliationSummary> {
  const supabase = createAdminClient()
  const initiatedBy = options.initiatedBy ?? null
  const transactions = await fetchCandidateTransactions(supabase, options.transactionIds)
  const refsByTransaction = new Map<string, string[]>()
  const invoiceNumbers = new Set<string>()

  for (const transaction of transactions) {
    const refs = extractInvoiceNumbers(transaction.details)
    refsByTransaction.set(transaction.id, refs)
    refs.forEach((ref) => invoiceNumbers.add(ref))
  }

  const invoiceByNumber = await loadInvoicesByNumber(supabase, [...invoiceNumbers])
  const invoiceIds = [...invoiceByNumber.values()].map((invoice) => invoice.id)
  const paymentByInvoice = await loadExistingPaymentsByInvoice(supabase, invoiceIds)
  const creditedByInvoice = await loadCreditedByInvoice(supabase, invoiceIds)
  const referencedIds = transactions
    .filter((transaction) => (refsByTransaction.get(transaction.id) ?? []).length)
    .map((transaction) => transaction.id)
  const heldMatches = await loadMatchesOfPayments(supabase, referencedIds)
  const settledMatches = settledMatchKeys(heldMatches)
  const matchesByPayment = new Map<string, StoredMatchRow[]>()
  for (const match of heldMatches) {
    matchesByPayment.set(match.receipt_transaction_id, [...(matchesByPayment.get(match.receipt_transaction_id) ?? []), match])
  }
  const settlingPaymentByInvoice = settlingPaymentForEachInvoice(
    await loadMatchesOnInvoices(supabase, invoiceIds),
    transactions,
    refsByTransaction,
    invoiceByNumber,
    creditedByInvoice
  )
  const { lockDate } = referencedIds.length ? await loadReceiptSettings(supabase) : { lockDate: null }
  const quotingSettled: QuotedSettledPayment[] = []

  const summary: ReconciliationSummary = {
    reviewed: transactions.length,
    withInvoiceReference: 0,
    matched: 0,
    paymentsRecorded: 0,
    alreadyPaid: 0,
    missingInvoice: 0,
    amountMismatch: 0,
    statusUpdated: 0,
    classificationUpdated: 0,
    multipleInvoiceRefs: 0,
    referenceFreeReviewed: 0,
    referenceFreeLinked: 0,
    referenceFreeRecorded: 0,
    referenceFreeForReview: 0,
    quotedSettledLinked: 0,
    quotedSettledRecorded: 0,
    quotedSettledForReview: 0,
    failedForReview: 0,
    overAllocated: 0,
    attachmentsQueued: 0,
    samples: [],
  }
  const failures: string[] = []

  for (const transaction of transactions) {
    const refs = refsByTransaction.get(transaction.id) ?? []
    if (!refs.length) continue
    summary.withInvoiceReference += 1
    try {
      await reconcileReferencedPayment(supabase, summary, {
        transaction,
        refs,
        invoiceByNumber,
        paymentByInvoice,
        creditedByInvoice,
        settledMatches,
        recordPayments: options.recordPayments !== false,
        initiatedBy,
        lockDate,
        settlingPaymentByInvoice,
        quotingSettled,
      })
    } catch (error) {
      await storeFailureForReview(supabase, summary, failures, transaction, refs[0], error, initiatedBy)
    }
  }

  // Payments quoting an invoice with nothing left to pay that they did not settle: after every
  // quoted invoice has been dealt with, so they see the invoices as the reference pass left them.
  if (quotingSettled.length) {
    await settlePaymentsQuotingSettledInvoices(supabase, summary, failures, quotingSettled, matchesByPayment, initiatedBy)
  }

  // Second pass: payments whose narrative never carried an invoice number. Runs after the
  // reference pass so that anything a quoted invoice number explains is settled first.
  await runReferenceFreePass(supabase, summary, failures, { transactionIds: options.transactionIds, initiatedBy })

  // Every payment matched to a real invoice gets a copy of that invoice attached (spec 10.6).
  // One pass queues them all: the matches just made, and those made before invoices were
  // attached. A failure here does not undo the matching: the next run tries again.
  try {
    summary.attachmentsQueued += await enqueueMissingInvoiceAttachments(supabase)
  } catch (attachError) {
    console.error('Failed to queue invoice copies for existing matches', attachError)
  }

  if (failures.length) {
    // Nothing could be stored for these, not even for a person: fail, so the job is retried.
    // What did work is settled and is not done again.
    throw new Error(`Failed to reconcile ${failures.length} ${failures.length === 1 ? 'payment' : 'payments'}: ${failures[0]}`)
  }

  return summary
}
