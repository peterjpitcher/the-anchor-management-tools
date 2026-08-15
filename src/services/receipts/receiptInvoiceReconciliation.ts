import { createAdminClient } from '@/lib/supabase/admin'
import type {
  ReceiptClassificationSignal,
  ReceiptExpenseCategory,
  ReceiptTransaction,
  ReceiptTransactionLog,
} from '@/types/database'
import type { AdminClient } from './types'
import { normalizeVendorInput } from './receiptHelpers'
import { normalizeReceiptVendorKey } from './vendorInsights'
import {
  recordReceiptClassificationSignals,
  resolveReceiptVendorId,
} from './receiptGovernance'
import {
  pairInvoiceByAmountAndDate,
  type PairableInvoice,
  type PairingCandidate,
} from '@/lib/receipts/invoice-pairing'

const INVOICE_NUMBER_PATTERN = /\bINV-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/gi
const MONEY_EPSILON = 0.01

/**
 * Statuses the reference-free pass is allowed to touch. A payment that is
 * already `completed` has a receipt attached and must not be downgraded, and
 * `no_receipt_required` is already closed.
 */
const PAIRABLE_TRANSACTION_STATUSES = ['pending', 'cant_find'] as const

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
  /** Inward payments with no invoice number in the narrative that we tried to pair. */
  referenceFreeReviewed: number
  /** Of those, how many were paired on vendor + amount + date. */
  referenceFreePaired: number
  /** Of those, how many matched several invoices and were settled oldest-first. */
  referenceFreeTiebroken: number
  /** Matched several invoices with none settleable, so left for a human. */
  referenceFreeAmbiguous: number
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
  let query = supabase
    .from('receipt_transactions')
    .select('*')
    .not('amount_in', 'is', null)
    .gt('amount_in', 0)
    .ilike('details', '%INV-%')
    .order('transaction_date', { ascending: false })

  if (transactionIds?.length) {
    query = query.in('id', transactionIds)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`Failed to load invoice payment receipt transactions: ${error.message}`)
  }

  return (data ?? []) as ReceiptTransaction[]
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

async function ensureReceiptVendorLinkedToInvoiceVendor(
  supabase: AdminClient,
  vendorName: string | null | undefined,
  invoiceVendorId: string | null | undefined
): Promise<string | null> {
  const receiptVendorId = await resolveReceiptVendorId(supabase, vendorName)
  if (!receiptVendorId || !invoiceVendorId) return receiptVendorId

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

  return receiptVendorId
}

async function findExistingPaymentForTransaction(
  supabase: AdminClient,
  transactionId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('receipt_invoice_matches')
    .select('invoice_payment_id')
    .eq('receipt_transaction_id', transactionId)
    .not('invoice_payment_id', 'is', null)
    .limit(1)

  if (error) {
    console.warn('Failed to check existing receipt invoice match payment', error)
    return null
  }

  return (data?.[0]?.invoice_payment_id as string | undefined) ?? null
}

async function recordInvoicePayment(
  supabase: AdminClient,
  transaction: ReceiptTransaction,
  invoice: InvoiceRow,
  amount: number
): Promise<string | null> {
  const existingPaymentId = await findExistingPaymentForTransaction(supabase, transaction.id)
  if (existingPaymentId) return existingPaymentId

  const { data, error } = await supabase.rpc('record_invoice_payment_transaction', {
    p_payment_data: {
      invoice_id: invoice.id,
      payment_date: transaction.transaction_date,
      amount,
      payment_method: 'bank_transfer',
      reference: transaction.details,
      notes: `Auto-matched from receipt transaction ${transaction.id}`,
    },
  })

  if (error) {
    throw new Error(`Failed to record invoice payment for ${invoice.invoice_number}: ${error.message}`)
  }

  return (data as { id?: string } | null)?.id ?? null
}

async function upsertInvoiceMatch(
  supabase: AdminClient,
  params: {
    transaction: ReceiptTransaction
    invoiceNumber: string
    invoice: InvoiceRow | null
    invoicePaymentId: string | null
    status: InvoicePaymentMatchStatus
    amountMatch: boolean
    payload?: Record<string, unknown>
  }
): Promise<void> {
  const amount = receiptTransactionAmount(params.transaction)
  const { error } = await supabase
    .from('receipt_invoice_matches')
    .upsert({
      receipt_transaction_id: params.transaction.id,
      invoice_id: params.invoice?.id ?? null,
      invoice_payment_id: params.invoicePaymentId,
      invoice_number: params.invoiceNumber,
      match_status: params.status,
      amount_match: params.amountMatch,
      transaction_date: params.transaction.transaction_date,
      matched_amount: amount,
      invoice_total_amount: params.invoice ? moneyValue(params.invoice.total_amount) : null,
      invoice_paid_amount_before: params.invoice ? moneyValue(params.invoice.paid_amount) : null,
      matched_at: new Date().toISOString(),
      payload: params.payload ?? {},
    }, { onConflict: 'receipt_transaction_id,invoice_number' })

  if (error) {
    throw new Error(`Failed to upsert receipt invoice match: ${error.message}`)
  }
}

async function updateReceiptTransactionFromInvoice(
  supabase: AdminClient,
  transaction: ReceiptTransaction,
  invoice: InvoiceRow,
  receiptVendorId: string | null,
  status: InvoicePaymentMatchStatus
): Promise<{ statusUpdated: boolean; classificationUpdated: boolean }> {
  const now = new Date().toISOString()
  const vendorName = normalizeVendorInput(invoice.vendor?.name ?? null)
  const updates: Record<string, unknown> = {}
  const statusUpdated = transaction.status !== 'no_receipt_required'
  const classificationUpdated = Boolean(
    vendorName &&
    (
      transaction.vendor_name !== vendorName ||
      transaction.vendor_id !== receiptVendorId ||
      transaction.vendor_source !== 'rule'
    )
  )

  if (statusUpdated) {
    updates.status = 'no_receipt_required'
    updates.receipt_required = false
    updates.marked_by = null
    updates.marked_by_email = null
    updates.marked_by_name = null
    updates.marked_at = now
    updates.marked_method = 'invoice_reconciliation'
    updates.auto_completed_reason = `invoice_payment:${invoice.invoice_number}`
  } else if (transaction.receipt_required) {
    updates.receipt_required = false
  }

  if (classificationUpdated && vendorName) {
    updates.vendor_name = vendorName
    updates.vendor_id = receiptVendorId
    updates.vendor_source = 'rule'
    updates.vendor_rule_id = null
    updates.vendor_updated_at = now
  }

  if (!Object.keys(updates).length) {
    return { statusUpdated: false, classificationUpdated: false }
  }

  updates.updated_at = now

  const { error } = await supabase
    .from('receipt_transactions')
    .update(updates)
    .eq('id', transaction.id)

  if (error) {
    throw new Error(`Failed to update receipt transaction from invoice match: ${error.message}`)
  }

  const logs: Array<Omit<ReceiptTransactionLog, 'id'>> = []
  if (statusUpdated) {
    logs.push({
      transaction_id: transaction.id,
      previous_status: transaction.status,
      new_status: 'no_receipt_required',
      action_type: 'invoice_reconciliation',
      note: `Matched invoice payment ${invoice.invoice_number}`,
      performed_by: null,
      rule_id: null,
      performed_at: now,
    })
  }

  if (classificationUpdated && vendorName) {
    logs.push({
      transaction_id: transaction.id,
      previous_status: transaction.status,
      new_status: statusUpdated ? 'no_receipt_required' : transaction.status,
      action_type: 'invoice_classification',
      note: `Vendor updated from invoice ${invoice.invoice_number}: ${vendorName}`,
      performed_by: null,
      rule_id: null,
      performed_at: now,
    })
  }

  if (logs.length) {
    const { error: logError } = await supabase.from('receipt_transaction_logs').insert(logs)
    if (logError) {
      console.error('Failed to record invoice reconciliation receipt logs', logError)
    }
  }

  const signals: Array<Omit<ReceiptClassificationSignal, 'id'>> = []
  if (statusUpdated || classificationUpdated) {
    signals.push({
      transaction_id: transaction.id,
      source: 'system',
      signal_type: 'invoice_reconciliation',
      prior_vendor_id: transaction.vendor_id ?? null,
      new_vendor_id: classificationUpdated ? receiptVendorId : transaction.vendor_id ?? null,
      prior_vendor_name: transaction.vendor_name,
      new_vendor_name: classificationUpdated ? vendorName : transaction.vendor_name,
      prior_expense_category: transaction.expense_category,
      new_expense_category: transaction.expense_category as ReceiptExpenseCategory | null,
      prior_status: transaction.status,
      new_status: statusUpdated ? 'no_receipt_required' : transaction.status,
      rule_id: null,
      ai_confidence: null,
      performed_by: null,
      performed_at: now,
      payload: {
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        match_status: status,
      },
    })
  }

  await recordReceiptClassificationSignals(supabase, signals)

  return { statusUpdated, classificationUpdated }
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
  let query = supabase
    .from('receipt_transactions')
    .select('*')
    .not('amount_in', 'is', null)
    .gt('amount_in', 0)
    .not('details', 'ilike', '%INV-%')
    .in('status', PAIRABLE_TRANSACTION_STATUSES as unknown as string[])
    .order('transaction_date', { ascending: false })

  if (transactionIds?.length) {
    query = query.in('id', transactionIds)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`Failed to load reference-free receipt transactions: ${error.message}`)
  }

  return (data ?? []) as ReceiptTransaction[]
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
  const { data, error } = await supabase
    .from('receipt_invoice_matches')
    .select('invoice_id')
    .not('invoice_id', 'is', null)

  if (error) {
    console.warn('Failed to load claimed invoice ids', error)
    return new Set()
  }

  return new Set(
    ((data ?? []) as Array<{ invoice_id: string | null }>)
      .map((row) => row.invoice_id)
      .filter((id): id is string => Boolean(id))
  )
}

async function runReferenceFreePairingPass(
  supabase: AdminClient,
  summary: ReconciliationSummary,
  options: { transactionIds?: string[] }
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
    })
    claimedInvoiceIds.add(result.candidate.invoice.id)
  }
}

async function applyReferenceFreePair(
  supabase: AdminClient,
  summary: ReconciliationSummary,
  transaction: ReceiptTransaction,
  candidate: PairingCandidate,
  amount: number,
  provenance: { candidateCount: number; viaTiebreak: boolean }
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
  const receiptVendorId = await ensureReceiptVendorLinkedToInvoiceVendor(
    supabase,
    invoice.vendor?.name ?? null,
    invoice.vendor_id
  )

  const updateResult = await updateReceiptTransactionFromInvoice(
    supabase,
    transaction,
    invoice,
    receiptVendorId,
    'vendor_amount_matched'
  )

  if (updateResult.statusUpdated) summary.statusUpdated += 1
  if (updateResult.classificationUpdated) summary.classificationUpdated += 1

  await upsertInvoiceMatch(supabase, {
    transaction,
    invoiceNumber: invoice.invoice_number,
    invoice,
    invoicePaymentId: null,
    status: 'vendor_amount_matched',
    amountMatch: true,
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
} = {}): Promise<ReconciliationSummary> {
  const supabase = createAdminClient()
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
    referenceFreeReviewed: 0,
    referenceFreePaired: 0,
    referenceFreeTiebroken: 0,
    referenceFreeAmbiguous: 0,
    samples: [],
  }

  for (const transaction of transactions) {
    const refs = refsByTransaction.get(transaction.id) ?? []
    if (!refs.length) continue

    summary.withInvoiceReference += 1

    for (const invoiceNumber of refs) {
      const invoice = invoiceByNumber.get(invoiceNumber) ?? null
      const amount = receiptTransactionAmount(transaction)

      if (!invoice) {
        summary.missingInvoice += 1
        await upsertInvoiceMatch(supabase, {
          transaction,
          invoiceNumber,
          invoice: null,
          invoicePaymentId: null,
          status: 'missing_invoice',
          amountMatch: false,
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
      const exactAmountMatch = moneyMatches(amount, invoiceTotal)
      const outstandingAmountMatch = moneyMatches(amount, outstanding)
      const amountCanBePayment = amount > 0 && amount <= outstanding + MONEY_EPSILON
      const amountMatch = exactAmountMatch || outstandingAmountMatch || amountCanBePayment

      let status: InvoicePaymentMatchStatus = refs.length > 1 ? 'multiple_invoice_refs' : 'matched'
      let invoicePaymentId: string | null = null

      if (isPaidStatus(invoice.status) || outstanding <= MONEY_EPSILON) {
        status = amountMatch ? 'already_paid' : 'amount_mismatch'
        if (status === 'already_paid') summary.alreadyPaid += 1
      } else if (!amountCanBePayment) {
        status = 'amount_mismatch'
      } else if (options.recordPayments !== false) {
        invoicePaymentId = await recordInvoicePayment(supabase, transaction, invoice, amount)
        status = 'payment_recorded'
        summary.paymentsRecorded += 1
      }

      if (status === 'amount_mismatch') summary.amountMismatch += 1

      const receiptVendorId = await ensureReceiptVendorLinkedToInvoiceVendor(
        supabase,
        invoice.vendor?.name ?? null,
        invoice.vendor_id
      )
      const updateResult = await updateReceiptTransactionFromInvoice(
        supabase,
        transaction,
        invoice,
        receiptVendorId,
        status
      )

      if (updateResult.statusUpdated) summary.statusUpdated += 1
      if (updateResult.classificationUpdated) summary.classificationUpdated += 1

      await upsertInvoiceMatch(supabase, {
        transaction,
        invoiceNumber,
        invoice,
        invoicePaymentId,
        status,
        amountMatch,
        payload: {
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
        },
      })

      summary.matched += 1
      if (summary.samples.length < 20) {
        summary.samples.push({ transactionId: transaction.id, invoiceNumber, status, details: transaction.details, amount })
      }
    }
  }

  // Second pass: payments whose narrative never carried an invoice number.
  // Runs after the reference pass so that anything already explained by a
  // quoted invoice number has claimed its invoice first.
  await runReferenceFreePairingPass(supabase, summary, { transactionIds: options.transactionIds })

  return summary
}
