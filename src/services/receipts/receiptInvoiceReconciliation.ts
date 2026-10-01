import { createAdminClient } from '@/lib/supabase/admin'
import type {
  ReceiptClassificationSignal,
  ReceiptExpenseCategory,
  ReceiptTransaction,
} from '@/types/database'
import type { AdminClient } from './types'
import { normalizeVendorInput } from './receiptHelpers'
import { normalizeReceiptVendorKey } from './vendorInsights'
import { recordReceiptClassificationSignals } from './receiptGovernance'
import { resolveReceiptVendor } from './receiptVendors'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { enqueueMissingInvoiceAttachments } from './receiptInvoiceFiles'
import {
  pairInvoiceByAmountAndDate,
  type PairableInvoice,
  type PairingCandidate,
} from '@/lib/receipts/invoice-pairing'

const INVOICE_NUMBER_PATTERN = /\bINV-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/gi
const MONEY_EPSILON = 0.01

/**
 * Statuses invoice pairing is allowed to move to "no receipt required". A payment that is
 * already `completed` has a receipt attached and must not be downgraded, and
 * `no_receipt_required` is already closed. Both passes follow this. The reference-free pass
 * also only looks at these payments; the reference pass still records a match for a closed
 * payment, without touching its status. `apply_receipt_invoice_match` enforces the same list
 * under a row lock, so the two must be changed together.
 */
const PAIRABLE_TRANSACTION_STATUSES = ['pending', 'cant_find'] as const

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

type InvoiceRow = {
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
  /** Inward payments with no invoice number in the narrative that we tried to pair. */
  referenceFreeReviewed: number
  /** Of those, how many were paired on vendor + amount + date. */
  referenceFreePaired: number
  /** Of those, how many matched several invoices and were settled oldest-first. */
  referenceFreeTiebroken: number
  /** Matched several invoices with none settleable, so left for a human. */
  referenceFreeAmbiguous: number
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
async function ensureReceiptVendorLinkedToInvoiceVendor(
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
async function applyInvoiceMatch(
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
        p_matched_amount: receiptTransactionAmount(transaction),
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
 * Inward payments that carry no invoice number in the bank narrative and are
 * still waiting on a receipt. These are the rows the reference matcher can
 * never help with.
 */
async function fetchReferenceFreeCandidates(
  supabase: AdminClient,
  transactionIds?: string[]
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
        .in('status', PAIRABLE_TRANSACTION_STATUSES as unknown as string[])
        .order('transaction_date', { ascending: false })
        .order('id', { ascending: true })

      if (transactionIds?.length) {
        query = query.in('id', transactionIds)
      }
      return query.range(from, to)
    },
    { label: 'reference-free receipt transactions' }
  )
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

  const filters: string[] = []
  if (vendorIds.size) filters.push(`id.in.(${[...vendorIds].join(',')})`)
  if (vendorKeys.size) {
    const quoted = [...vendorKeys].map((key) => `"${key.replace(/"/g, '\\"')}"`)
    filters.push(`vendor_key.in.(${quoted.join(',')})`)
  }

  const { data, error } = await supabase
    .from('receipt_vendors')
    .select('id, vendor_key, invoice_vendor_id')
    .not('invoice_vendor_id', 'is', null)
    .or(filters.join(','))

  if (error) {
    console.warn('Failed to resolve invoice vendors for reference-free pairing', error)
    return new Map()
  }

  const byId = new Map<string, string>()
  const byKey = new Map<string, string>()
  for (const row of (data ?? []) as Array<{ id: string; vendor_key: string | null; invoice_vendor_id: string | null }>) {
    if (!row.invoice_vendor_id) continue
    byId.set(row.id, row.invoice_vendor_id)
    if (row.vendor_key) byKey.set(row.vendor_key, row.invoice_vendor_id)
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

async function loadInvoicesForVendors(
  supabase: AdminClient,
  invoiceVendorIds: string[]
): Promise<Map<string, PairableInvoice[]>> {
  const uniqueIds = [...new Set(invoiceVendorIds)]
  if (!uniqueIds.length) return new Map()

  const { data, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, invoice_date, status, total_amount, paid_amount, vendor_id')
    .in('vendor_id', uniqueIds)
    .is('deleted_at', null)

  if (error) {
    throw new Error(`Failed to load invoices for reference-free pairing: ${error.message}`)
  }

  const byVendor = new Map<string, PairableInvoice[]>()
  for (const row of (data ?? []) as Array<InvoiceRow & { invoice_date: string; vendor_id: string | null }>) {
    if (!row.vendor_id) continue
    const invoice: PairableInvoice = {
      id: row.id,
      invoiceNumber: row.invoice_number,
      invoiceDate: row.invoice_date,
      status: row.status,
      totalAmount: moneyValue(row.total_amount),
      paidAmount: moneyValue(row.paid_amount),
    }
    byVendor.set(row.vendor_id, [...(byVendor.get(row.vendor_id) ?? []), invoice])
  }

  return byVendor
}

/**
 * Invoices already spoken for by another receipt transaction. Without this a
 * single invoice could be paired to two different payments of the same value.
 */
async function loadClaimedInvoiceIds(supabase: AdminClient): Promise<Set<string>> {
  // Paged, and a failure throws. An empty set here would mean "no invoice is spoken for", and
  // the pass would then pair a second payment to an invoice that already has one.
  const rows = await fetchAllRows<{ invoice_id: string | null }>(
    (from, to) =>
      supabase
        .from('receipt_invoice_matches')
        .select('invoice_id')
        .not('invoice_id', 'is', null)
        .order('id', { ascending: true })
        .range(from, to),
    { label: 'claimed invoice ids' }
  )

  return new Set(rows.map((row) => row.invoice_id).filter((id): id is string => Boolean(id)))
}

async function runReferenceFreePairingPass(
  supabase: AdminClient,
  summary: ReconciliationSummary,
  options: { transactionIds?: string[]; initiatedBy: string | null }
): Promise<void> {
  const transactions = await fetchReferenceFreeCandidates(supabase, options.transactionIds)
  if (!transactions.length) return

  const invoiceVendorByTransaction = await resolveInvoiceVendorIds(supabase, transactions)
  if (!invoiceVendorByTransaction.size) return

  const invoicesByVendor = await loadInvoicesForVendors(
    supabase,
    [...invoiceVendorByTransaction.values()]
  )
  const claimedInvoiceIds = await loadClaimedInvoiceIds(supabase)

  // Oldest first, so that when two payments could both explain an invoice the
  // earlier one claims it and the later one is reported as unmatched instead.
  const ordered = [...transactions].sort((left, right) =>
    left.transaction_date.localeCompare(right.transaction_date)
  )

  for (const transaction of ordered) {
    const invoiceVendorId = invoiceVendorByTransaction.get(transaction.id)
    if (!invoiceVendorId) continue

    const invoices = invoicesByVendor.get(invoiceVendorId) ?? []
    if (!invoices.length) continue

    summary.referenceFreeReviewed += 1

    const amount = receiptTransactionAmount(transaction)
    const result = pairInvoiceByAmountAndDate(
      { id: transaction.id, transactionDate: transaction.transaction_date, amount },
      invoices,
      { claimedInvoiceIds }
    )

    if (result.outcome === 'no_candidate') continue

    if (result.outcome === 'ambiguous') {
      summary.referenceFreeAmbiguous += 1
      if (summary.samples.length < 20) {
        summary.samples.push({
          transactionId: transaction.id,
          invoiceNumber: result.candidates.map((candidate) => candidate.invoice.invoiceNumber).join(', '),
          status: 'vendor_amount_ambiguous',
          details: transaction.details,
          amount,
        })
      }
      continue
    }

    if (result.viaTiebreak) summary.referenceFreeTiebroken += 1

    await applyReferenceFreePair(supabase, summary, transaction, result.candidate, amount, {
      candidateCount: result.candidateCount,
      viaTiebreak: result.viaTiebreak,
    }, options.initiatedBy)
    claimedInvoiceIds.add(result.candidate.invoice.id)
  }
}

async function applyReferenceFreePair(
  supabase: AdminClient,
  summary: ReconciliationSummary,
  transaction: ReceiptTransaction,
  candidate: PairingCandidate,
  amount: number,
  provenance: { candidateCount: number; viaTiebreak: boolean },
  initiatedBy: string | null
): Promise<void> {
  const { data, error } = await supabase
    .from('invoices')
    .select('*, vendor:invoice_vendors(id, name)')
    .eq('id', candidate.invoice.id)
    .single()

  if (error || !data) {
    console.warn('Failed to reload invoice for reference-free pairing', error)
    return
  }

  const invoice = data as InvoiceRow
  const receiptVendor = await ensureReceiptVendorLinkedToInvoiceVendor(
    supabase,
    invoice.vendor?.name ?? null,
    invoice.vendor_id
  )

  const updateResult = await applyInvoiceMatch(supabase, {
    transaction,
    invoiceNumber: invoice.invoice_number,
    invoice,
    invoicePaymentId: null,
    status: 'vendor_amount_matched',
    amountMatch: true,
    allowStatusChange: true,
    receiptVendor,
    initiatedBy,
    payload: {
      match_method: 'vendor_amount',
      match_basis: candidate.basis,
      day_gap: candidate.dayGap,
      // Recorded so a tiebroken match can be told apart from a unique one
      // later: several invoices fitted and the oldest-still-owing rule chose.
      candidate_count: provenance.candidateCount,
      via_oldest_unpaid_tiebreak: provenance.viaTiebreak,
      invoice_status_before: invoice.status,
      invoice_total: moneyValue(invoice.total_amount),
      invoice_paid_before: moneyValue(invoice.paid_amount),
    },
  })

  if (updateResult.statusUpdated) summary.statusUpdated += 1
  if (updateResult.classificationUpdated) summary.classificationUpdated += 1

  summary.referenceFreePaired += 1
  summary.matched += 1
  if (summary.samples.length < 20) {
    summary.samples.push({
      transactionId: transaction.id,
      invoiceNumber: invoice.invoice_number,
      status: 'vendor_amount_matched',
      details: transaction.details,
      amount,
    })
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
  const paymentByInvoice = await loadExistingPaymentsByInvoice(
    supabase,
    [...invoiceByNumber.values()].map((invoice) => invoice.id)
  )

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
    referenceFreePaired: 0,
    referenceFreeTiebroken: 0,
    referenceFreeAmbiguous: 0,
    overAllocated: 0,
    attachmentsQueued: 0,
    samples: [],
  }

  for (const transaction of transactions) {
    const refs = refsByTransaction.get(transaction.id) ?? []
    if (!refs.length) continue

    summary.withInvoiceReference += 1

    // One bank payment quoting several invoices cannot be split by guesswork: each invoice
    // would otherwise be offered the whole amount. Record what was quoted and leave the
    // payment, and the invoice ledger, for a person.
    const quotesSeveralInvoices = refs.length > 1
    if (quotesSeveralInvoices) summary.multipleInvoiceRefs += 1

    for (const invoiceNumber of refs) {
      const invoice = invoiceByNumber.get(invoiceNumber) ?? null
      const amount = receiptTransactionAmount(transaction)

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
      const outstanding = Math.max(0, invoiceTotal - paidBefore)
      const matchPayload = {
        invoice_status_before: invoice.status,
        invoice_total: invoiceTotal,
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

      const exactAmountMatch = moneyMatches(amount, invoiceTotal)
      const outstandingAmountMatch = moneyMatches(amount, outstanding)
      const amountCanBePayment = amount > 0 && amount <= outstanding + MONEY_EPSILON
      const amountMatch = exactAmountMatch || outstandingAmountMatch || amountCanBePayment
      const mayRecordPayment = options.recordPayments !== false

      let status: StoredInvoiceMatchStatus = 'matched'
      let recordPayment = false

      if (isPaidStatus(invoice.status) || outstanding <= MONEY_EPSILON) {
        status = amountMatch ? 'already_paid' : 'amount_mismatch'
        if (status === 'already_paid') summary.alreadyPaid += 1
      } else if (!amountCanBePayment) {
        status = 'amount_mismatch'
      } else if (mayRecordPayment) {
        status = 'payment_recorded'
        recordPayment = true
      }

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
  }

  // Second pass: payments whose narrative never carried an invoice number.
  // Runs after the reference pass so that anything already explained by a
  // quoted invoice number has claimed its invoice first.
  await runReferenceFreePairingPass(supabase, summary, { transactionIds: options.transactionIds, initiatedBy })

  // Every payment matched to a real invoice gets a copy of that invoice attached (spec 10.6).
  // One pass queues them all: the matches just made, and those made before invoices were
  // attached. A failure here does not undo the matching: the next run tries again.
  try {
    summary.attachmentsQueued += await enqueueMissingInvoiceAttachments(supabase)
  } catch (attachError) {
    console.error('Failed to queue invoice copies for existing matches', attachError)
  }

  return summary
}
