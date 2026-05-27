import { createAdminClient } from '@/lib/supabase/admin'
import type {
  ReceiptClassificationSignal,
  ReceiptExpenseCategory,
  ReceiptTransaction,
  ReceiptTransactionLog,
} from '@/types/database'
import type { AdminClient } from './types'
import { normalizeVendorInput } from './receiptHelpers'
import {
  recordReceiptClassificationSignals,
  resolveReceiptVendorId,
} from './receiptGovernance'

const INVOICE_NUMBER_PATTERN = /\bINV-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/gi
const MONEY_EPSILON = 0.01

type InvoicePaymentMatchStatus =
  | 'matched'
  | 'payment_recorded'
  | 'already_paid'
  | 'missing_invoice'
  | 'multiple_invoice_refs'
  | 'amount_mismatch'
  | 'review_required'

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

  return summary
}
