/**
 * Customer payments stored for a person to confirm, and carrying out what they choose.
 *
 * The matcher (receiptInvoiceReconciliation.ts) stores a customer payment for a person when
 * several invoices, or several payments already entered, fit it equally well, or nothing fits
 * exactly. Nothing is recorded until a person picks one of the options stored with it, and
 * nothing else can be recorded from here: a choice is carried out the way the matcher would
 * carry it out, through the same database functions, or not at all.
 *
 * @requires Callers check 'receipts.manage', and 'invoices.edit' to record a payment.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { formatCurrency } from '@/lib/format'
import type { ReceiptTransaction } from '@/types/database'
import type { AdminClient } from './types'
import { chunkArray } from './receiptHelpers'
import {
  applyInvoiceMatch,
  ensureReceiptVendorLinkedToInvoiceVendor,
  loadCreditedByInvoice,
  type InvoiceRow,
} from './receiptInvoiceReconciliation'

/** An invoice in an option: for "record", the amount to record; for "link", the payment already entered. */
export type ConfirmationPart = {
  invoiceId: string
  invoiceNumber: string | null
  amount: number
  /** The entered payment, for a "link" option. */
  paymentId: string | null
  /** The invoice date ("record") or the entered payment's date ("link"). */
  date: string | null
}

export type ConfirmationOption = {
  /** Its place in the stored options: the only thing a person sends back. */
  index: number
  kind: 'record' | 'link'
  parts: ConfirmationPart[]
}

export type CustomerPaymentToConfirm = {
  matchId: string
  transactionId: string
  date: string
  details: string
  amount: number
  vendorName: string | null
  /** Why it was stored: several_invoices_fit, several_entries_fit, entry_fits_another_payment, no_exact_fit, over_allocated or error. */
  reason: string
  error: string | null
  options: ConfirmationOption[]
  recentInvoices: Array<{
    invoiceId: string
    invoiceNumber: string
    invoiceDate: string
    status: string | null
    total: number
    outstanding: number
  }>
}

type StoredMatch = {
  id: string
  receipt_transaction_id: string
  invoice_number: string
  match_status: string
  payload: Record<string, unknown> | null
  matched_at?: string | null
}

const MONEY_EPSILON = 0.005
const ALREADY_DEALT_WITH = 'This payment has already been dealt with.'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : []
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function money(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

/** The options stored with a match, numbered as stored. */
export function readConfirmationOptions(payload: Record<string, unknown> | null): ConfirmationOption[] {
  return asArray(asRecord(payload).options).flatMap((option, index): ConfirmationOption[] => {
    if (option.kind === 'record') {
      const parts = asArray(option.allocations).map((part) => ({
        invoiceId: String(part.invoice_id ?? ''),
        invoiceNumber: text(part.invoice_number),
        amount: money(part.amount),
        paymentId: null,
        date: text(part.invoice_date),
      }))
      return parts.length && parts.every((part) => part.invoiceId) ? [{ index, kind: 'record', parts }] : []
    }
    if (option.kind === 'link') {
      const parts = asArray(option.entries).map((part) => ({
        invoiceId: String(part.invoice_id ?? ''),
        invoiceNumber: text(part.invoice_number),
        amount: money(part.amount),
        paymentId: text(part.payment_id),
        date: text(part.payment_date),
      }))
      return parts.length && parts.every((part) => part.invoiceId && part.paymentId) ? [{ index, kind: 'link', parts }] : []
    }
    return []
  })
}

function reasonOf(payload: Record<string, unknown>): string {
  if (payload.over_allocated) return 'over_allocated'
  return text(payload.review_reason) ?? 'error'
}

/** Payments waiting for a person, newest first. */
export async function loadCustomerPaymentsToConfirm(): Promise<CustomerPaymentToConfirm[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('receipt_invoice_matches')
    .select('id, receipt_transaction_id, invoice_number, match_status, payload, matched_at')
    .eq('match_status', 'review_required')
    .order('matched_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(`Failed to load the payments to confirm: ${error.message}`)

  const waiting = ((data ?? []) as StoredMatch[]).filter((match) => !asRecord(match.payload).dismissed_at)
  if (!waiting.length) return []

  const lines = new Map<string, Pick<ReceiptTransaction, 'id' | 'transaction_date' | 'details' | 'amount_in' | 'amount_out' | 'vendor_name'>>()
  for (const chunk of chunkArray([...new Set(waiting.map((match) => match.receipt_transaction_id))], 100)) {
    const { data: rows, error: lineError } = await supabase
      .from('receipt_transactions')
      .select('id, transaction_date, details, amount_in, amount_out, vendor_name')
      .in('id', chunk)
    if (lineError) throw new Error(`Failed to load the payments to confirm: ${lineError.message}`)
    for (const row of rows ?? []) lines.set(row.id, row)
  }

  return waiting
    .flatMap((match): CustomerPaymentToConfirm[] => {
      const line = lines.get(match.receipt_transaction_id)
      if (!line) return []
      const payload = asRecord(match.payload)
      return [
        {
          matchId: match.id,
          transactionId: line.id,
          date: line.transaction_date,
          details: line.details,
          amount: money(line.amount_in ?? line.amount_out),
          vendorName: line.vendor_name ?? null,
          reason: reasonOf(payload),
          error: text(payload.error),
          options: readConfirmationOptions(payload),
          recentInvoices: asArray(payload.recent_invoices).map((invoice) => ({
            invoiceId: String(invoice.invoice_id ?? ''),
            invoiceNumber: String(invoice.invoice_number ?? ''),
            invoiceDate: String(invoice.invoice_date ?? ''),
            status: text(invoice.status),
            total: money(invoice.total),
            outstanding: money(invoice.outstanding),
          })),
        },
      ]
    })
    .sort((left, right) => right.date.localeCompare(left.date))
}

async function loadWaitingMatch(supabase: AdminClient, matchId: string): Promise<StoredMatch | { error: string }> {
  const { data, error } = await supabase
    .from('receipt_invoice_matches')
    .select('id, receipt_transaction_id, invoice_number, match_status, payload')
    .eq('id', matchId)
    .maybeSingle()
  if (error) return { error: 'The payment could not be loaded. Nothing was changed.' }
  const match = data as StoredMatch | null
  if (!match || match.match_status !== 'review_required' || asRecord(match.payload).dismissed_at) {
    return { error: ALREADY_DEALT_WITH }
  }
  return match
}

/** Checks every part of a choice before anything is written, so it is carried out whole or not at all. */
async function checkChoice(
  supabase: AdminClient,
  option: ConfirmationOption,
  invoices: Map<string, InvoiceRow>
): Promise<string | null> {
  for (const part of option.parts) {
    const invoice = invoices.get(part.invoiceId)
    if (!invoice) return `Invoice ${part.invoiceNumber ?? part.invoiceId} no longer exists. Nothing was recorded.`
    if (invoice.status === 'void' || invoice.status === 'written_off') {
      return `${invoice.invoice_number} has been cancelled. Nothing was recorded.`
    }
  }

  if (option.kind === 'record') {
    const credited = await loadCreditedByInvoice(supabase, option.parts.map((part) => part.invoiceId))
    for (const part of option.parts) {
      const invoice = invoices.get(part.invoiceId) as InvoiceRow
      const owed = Math.max(0, Math.max(0, money(invoice.total_amount) - (credited.get(invoice.id) ?? 0)) - money(invoice.paid_amount))
      if (part.amount > owed + MONEY_EPSILON) {
        return `${invoice.invoice_number} now owes ${formatCurrency(owed)}, less than ${formatCurrency(part.amount)}. Nothing was recorded.`
      }
    }
    return null
  }

  const paymentIds = option.parts.map((part) => part.paymentId as string)
  const { data: entered, error } = await supabase
    .from('invoice_payments')
    .select('id, invoice_id, amount')
    .in('id', paymentIds)
  if (error) return 'The payments entered on the invoices could not be read. Nothing was changed.'
  const { data: linked, error: linkError } = await supabase
    .from('receipt_invoice_matches')
    .select('id, invoice_payment_id')
    .in('invoice_payment_id', paymentIds)
    .limit(paymentIds.length)
  if (linkError) return 'The payments entered on the invoices could not be read. Nothing was changed.'
  if ((linked ?? []).length) return 'A payment entered on the invoice is already linked to another bank payment. Nothing was changed.'
  for (const part of option.parts) {
    const entry = ((entered ?? []) as Array<{ id: string; invoice_id: string; amount: number | string }>).find(
      (row) => row.id === part.paymentId
    )
    if (!entry || entry.invoice_id !== part.invoiceId || Math.abs(money(entry.amount) - part.amount) > MONEY_EPSILON) {
      return 'A payment entered on the invoice has changed since this was stored. Nothing was changed.'
    }
  }
  return null
}

/**
 * Carries out one of the options stored with a payment: records it against the invoices in the
 * option, or links it to the payments already entered on them.
 */
export async function performConfirmCustomerPayment(input: {
  matchId: string
  optionIndex: number
  userId: string
}): Promise<{ success: true; invoiceNumbers: string[] } | { error: string }> {
  const supabase = createAdminClient()
  const match = await loadWaitingMatch(supabase, input.matchId)
  if ('error' in match) return match

  const option = readConfirmationOptions(match.payload).find((candidate) => candidate.index === input.optionIndex)
  if (!option) return { error: 'That choice is not one of the options for this payment. Nothing was recorded.' }

  const { data: transaction, error: transactionError } = await supabase
    .from('receipt_transactions')
    .select('*')
    .eq('id', match.receipt_transaction_id)
    .maybeSingle()
  if (transactionError || !transaction) return { error: 'The bank payment could not be loaded. Nothing was recorded.' }

  const { data: invoiceRows, error: invoiceError } = await supabase
    .from('invoices')
    .select('*, vendor:invoice_vendors(id, name)')
    .in('id', option.parts.map((part) => part.invoiceId))
    .is('deleted_at', null)
  if (invoiceError) return { error: 'The invoices could not be loaded. Nothing was recorded.' }
  const invoices = new Map(((invoiceRows ?? []) as InvoiceRow[]).map((invoice) => [invoice.id, invoice]))

  const problem = await checkChoice(supabase, option, invoices)
  if (problem) return { error: problem }

  const invoiceNumbers: string[] = []
  for (const part of option.parts) {
    const invoice = invoices.get(part.invoiceId) as InvoiceRow
    const receiptVendor = await ensureReceiptVendorLinkedToInvoiceVendor(supabase, invoice.vendor?.name ?? null, invoice.vendor_id)
    const result = await applyInvoiceMatch(supabase, {
      transaction: transaction as ReceiptTransaction,
      invoiceNumber: invoice.invoice_number,
      invoice,
      invoicePaymentId: option.kind === 'link' ? part.paymentId : null,
      status: option.kind === 'link' ? 'matched' : 'payment_recorded',
      amountMatch: true,
      allowStatusChange: true,
      receiptVendor,
      initiatedBy: input.userId,
      matchedAmount: part.amount,
      recordPaymentAmount: option.kind === 'record' ? part.amount : undefined,
      payload: { match_method: 'confirmed_by_person', review_match_id: match.id, option_index: option.index },
    })
    if (result.overAllocated) {
      return {
        error: `The bank payment has nothing left to record against ${invoice.invoice_number}.${
          invoiceNumbers.length ? ` ${invoiceNumbers.join(' and ')} ${invoiceNumbers.length === 1 ? 'was' : 'were'} recorded.` : ' Nothing was recorded.'
        }`,
      }
    }
    invoiceNumbers.push(invoice.invoice_number)
  }

  // Finished with: remove the stored match, unless a new match with its invoice number replaced it.
  const { error: removeError } = await supabase
    .from('receipt_invoice_matches')
    .delete()
    .eq('id', match.id)
    .eq('match_status', 'review_required')
  if (removeError) console.error('Failed to remove a confirmed customer payment from the list:', removeError.message)

  return { success: true, invoiceNumbers }
}

/** Takes a payment off the list: it was not an invoice payment, or it was dealt with by hand. */
export async function performDismissCustomerPayment(input: {
  matchId: string
  userId: string
}): Promise<{ success: true } | { error: string }> {
  const supabase = createAdminClient()
  const match = await loadWaitingMatch(supabase, input.matchId)
  if ('error' in match) return match

  const { data, error } = await supabase
    .from('receipt_invoice_matches')
    .update({ payload: { ...asRecord(match.payload), dismissed_at: new Date().toISOString(), dismissed_by: input.userId } })
    .eq('id', match.id)
    .eq('match_status', 'review_required')
    .select('id')
  if (error) return { error: 'The payment could not be updated. Try again.' }
  if (!data?.length) return { error: ALREADY_DEALT_WITH }

  const { data: transaction } = await supabase
    .from('receipt_transactions')
    .select('id, status')
    .eq('id', match.receipt_transaction_id)
    .maybeSingle()
  if (transaction) {
    const { error: logError } = await supabase.from('receipt_transaction_logs').insert({
      transaction_id: transaction.id,
      previous_status: transaction.status,
      new_status: transaction.status,
      action_type: 'customer_payment_set_aside',
      note: 'Taken off the customer payments to confirm: not an invoice payment, or dealt with by hand.',
      performed_by: input.userId,
    })
    if (logError) console.error('Failed to record a customer payment set aside:', logError.message)
  }

  return { success: true }
}
