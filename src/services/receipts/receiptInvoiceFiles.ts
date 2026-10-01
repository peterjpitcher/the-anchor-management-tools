/**
 * Attaching a copy of one of our own invoices to the bank payment that settled it (spec 10.6).
 *
 * A payment matched to an invoice used to be marked "no receipt required" and left with nothing
 * on it: the accountant had to go and find the invoice. The invoice is now rendered with the
 * generator the invoices section uses, stored with the receipts, and added to the payment by
 * `attach_receipt_invoice_file`, which also marks the payment completed.
 *
 * The copy is taken when the match is made. "Refresh invoice copy" renders it again.
 *
 * @requires Run by the job queue, or by a caller that has verified 'receipts.manage'.
 */

import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { jobQueue } from '@/lib/unified-job-queue'
import type { InvoiceWithDetails } from '@/types/invoices'
import type { ReceiptFile } from '@/types/database'
import { loadReceiptSettings } from './receiptSettings'
import { RECEIPT_BUCKET, type AdminClient } from './types'

/** Match statuses that name a real invoice. Pinned to `delete_receipt_file` in the database. */
export const INVOICE_ATTACH_MATCH_STATUSES = [
  'matched',
  'payment_recorded',
  'already_paid',
  'amount_mismatch',
  'vendor_amount_matched',
] as const

/** At most this many missing copies are queued by one reconciliation run. */
const BACKFILL_CAP = 200

export type InvoiceAttachOutcome =
  | 'attached'
  | 'refreshed'
  | 'already_attached'
  | 'locked'
  | 'transaction_not_found'
  | 'invoice_not_found'

export type InvoiceAttachResult = {
  outcome: InvoiceAttachOutcome
  receipt?: ReceiptFile
  /** True when the payment was marked completed by this attachment. */
  statusUpdated?: boolean
}

type Renderer = (invoice: InvoiceWithDetails) => Promise<Buffer>

async function renderWithInvoiceGenerator(invoice: InvoiceWithDetails): Promise<Buffer> {
  // Loaded here, not at the top: the generator pulls in a headless browser, which nothing else
  // in the receipts services needs.
  const { generateInvoicePDF } = await import('@/lib/pdf-generator')
  return generateInvoicePDF(invoice)
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_+|_+$/g, '') || 'invoice'
}

/** The name shown on the payment and used in the export. */
export function invoiceCopyFileName(invoiceNumber: string): string {
  return `Invoice ${invoiceNumber.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').trim() || 'copy'}.pdf`
}

async function removeObject(supabase: AdminClient, path: string, why: string): Promise<void> {
  const { error } = await supabase.storage.from(RECEIPT_BUCKET).remove([path])
  if (error) {
    // Nothing references it, so the storage sweep will find it. Say so in the meantime.
    console.error(`Could not remove an invoice copy (${why})`, { path, error })
  }
}

/**
 * Renders the invoice, stores the copy and adds it to the payment.
 *
 * Throws when the invoice cannot be rendered or stored, so the job that called it is retried.
 * Until it succeeds the payment stays "no receipt required" with the invoice number as its
 * reason, which is a valid state.
 */
export async function performAttachInvoiceToReceipt(input: {
  transactionId: string
  invoiceId: string
  /** Swap the stored copy for a fresh one ("Refresh invoice copy"). */
  replace?: boolean
  initiatedBy?: string | null
  /** For tests. */
  render?: Renderer
}): Promise<InvoiceAttachResult> {
  const supabase = createAdminClient()
  const client = supabase as any
  const replace = Boolean(input.replace)

  const [{ data: transaction, error: transactionError }, { data: existing, error: existingError }, settings] =
    await Promise.all([
      supabase.from('receipt_transactions').select('id, transaction_date').eq('id', input.transactionId).maybeSingle(),
      client
        .from('receipt_files')
        .select('*')
        .eq('transaction_id', input.transactionId)
        .eq('invoice_id', input.invoiceId)
        .maybeSingle(),
      loadReceiptSettings(supabase),
    ])

  if (transactionError) {
    throw new Error(`Failed to load the payment for an invoice copy: ${transactionError.message}`)
  }
  if (existingError) {
    throw new Error(`Failed to check for an existing invoice copy: ${existingError.message}`)
  }
  if (!transaction) {
    return { outcome: 'transaction_not_found' }
  }

  // Decided before the invoice is rendered, so a job that has nothing to do costs one read.
  if (existing && !replace) {
    return { outcome: 'already_attached', receipt: existing as ReceiptFile }
  }
  if (!existing && settings.lockDate && transaction.transaction_date <= settings.lockDate) {
    return { outcome: 'locked' }
  }

  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .select('*, vendor:invoice_vendors(*), line_items:invoice_line_items(*), payments:invoice_payments(*)')
    .order('display_order', { ascending: true, foreignTable: 'invoice_line_items' })
    .eq('id', input.invoiceId)
    .is('deleted_at', null)
    .maybeSingle()

  if (invoiceError) {
    throw new Error(`Failed to load the invoice for a copy: ${invoiceError.message}`)
  }
  if (!invoice) {
    return { outcome: 'invoice_not_found' }
  }

  const invoiceNumber = String((invoice as { invoice_number?: string }).invoice_number ?? '')
  const pdf = await (input.render ?? renderWithInvoiceGenerator)(invoice as unknown as InvoiceWithDetails)
  if (!pdf?.length) {
    throw new Error(`The invoice ${invoiceNumber} rendered as an empty file`)
  }

  const storagePath = `${transaction.transaction_date.substring(0, 4)}/invoice_${safeSegment(invoiceNumber)}_${input.transactionId}_${Date.now()}.pdf`
  const { error: uploadError } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .upload(storagePath, pdf, { upsert: false, contentType: 'application/pdf' })
  if (uploadError) {
    throw new Error(`Failed to store the copy of invoice ${invoiceNumber}: ${uploadError.message}`)
  }

  const { data, error } = await client.rpc('attach_receipt_invoice_file', {
    p_transaction_id: input.transactionId,
    p_invoice_id: input.invoiceId,
    p_invoice_number: invoiceNumber,
    p_storage_path: storagePath,
    p_file_name: invoiceCopyFileName(invoiceNumber),
    p_file_size_bytes: pdf.length,
    p_content_hash: createHash('sha256').update(pdf).digest('hex'),
    p_replace: replace,
    p_initiated_by: input.initiatedBy ?? null,
  })

  if (error || !data) {
    await removeObject(supabase, storagePath, 'the attachment failed')
    throw new Error(`Failed to attach invoice ${invoiceNumber}: ${error?.message ?? 'no result'}`)
  }

  const outcome = data.outcome as InvoiceAttachOutcome
  const receipt = (data.receipt ?? undefined) as ReceiptFile | undefined

  if (outcome === 'attached') {
    return { outcome, receipt, statusUpdated: Boolean(data.status_updated) }
  }

  if (outcome === 'refreshed') {
    if (typeof data.old_storage_path === 'string' && data.old_storage_path) {
      await removeObject(supabase, data.old_storage_path, 'it was replaced by a fresh copy')
    }
    return { outcome, receipt }
  }

  // Someone else attached it first, the period was locked in the meantime, or the payment has
  // gone: the copy just stored belongs to nothing.
  await removeObject(supabase, storagePath, `the payment did not take it (${outcome})`)
  if (outcome === 'already_attached' || outcome === 'locked' || outcome === 'transaction_not_found') {
    return { outcome, receipt }
  }
  throw new Error(`Failed to attach invoice ${invoiceNumber}: unexpected outcome ${String(outcome)}`)
}

/** Queues the attachment. A failure to queue is not fatal: the next reconciliation run finds it. */
export async function enqueueInvoiceAttachment(transactionId: string, invoiceId: string): Promise<boolean> {
  try {
    const result = await jobQueue.enqueue(
      'attach_invoice_to_receipt',
      { transactionId, invoiceId },
      { priority: -10, unique: `receipts:attach_invoice:${transactionId}:${invoiceId}` }
    )
    if (!result.success) {
      console.error('Failed to queue an invoice copy', { transactionId, invoiceId, error: result.error })
    }
    return Boolean(result.success)
  } catch (error) {
    console.error('Failed to queue an invoice copy', { transactionId, invoiceId, error })
    return false
  }
}

/**
 * Queues a copy for every payment matched to a real invoice that does not have one yet. This is
 * what covers the payments matched before invoices were attached, and any attachment that
 * failed to queue.
 */
export async function enqueueMissingInvoiceAttachments(supabase: AdminClient): Promise<number> {
  const client = supabase as any
  const [matches, attached, settings] = await Promise.all([
    fetchAllRows<{ receipt_transaction_id: string; invoice_id: string; transaction_date: string }>(
      (from, to) =>
        client
          .from('receipt_invoice_matches')
          .select('receipt_transaction_id, invoice_id, transaction_date')
          .not('invoice_id', 'is', null)
          .in('match_status', INVOICE_ATTACH_MATCH_STATUSES as unknown as string[])
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'invoice matches for attachment' }
    ),
    fetchAllRows<{ transaction_id: string; invoice_id: string }>(
      (from, to) =>
        client
          .from('receipt_files')
          .select('transaction_id, invoice_id')
          .not('invoice_id', 'is', null)
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'attached invoice copies' }
    ),
    loadReceiptSettings(supabase),
  ])

  const have = new Set(attached.map((file) => `${file.transaction_id}:${file.invoice_id}`))
  const seen = new Set<string>()
  let queued = 0

  for (const match of matches) {
    if (queued >= BACKFILL_CAP) break
    const key = `${match.receipt_transaction_id}:${match.invoice_id}`
    if (have.has(key) || seen.has(key)) continue
    seen.add(key)
    // A locked payment is left alone, so there is nothing to queue for it.
    if (settings.lockDate && match.transaction_date <= settings.lockDate) continue
    if (await enqueueInvoiceAttachment(match.receipt_transaction_id, match.invoice_id)) queued += 1
  }

  return queued
}

/** "Refresh invoice copy" on an attached file: render the invoice again and swap the copy. */
export async function performRefreshInvoiceCopy(
  userId: string,
  fileId: string
): Promise<{ success?: boolean; error?: string; receipt?: ReceiptFile }> {
  const supabase = createAdminClient()
  const { data: file, error } = await (supabase as any)
    .from('receipt_files')
    .select('id, transaction_id, invoice_id, source')
    .eq('id', fileId)
    .maybeSingle()

  if (error) {
    console.error('Failed to load a file for an invoice refresh', error)
    return { error: 'The file could not be loaded.' }
  }
  if (!file) {
    return { error: 'That file no longer exists.' }
  }
  if (file.source !== 'invoice' || !file.invoice_id) {
    return { error: 'Only a copy of one of our invoices can be refreshed.' }
  }

  try {
    const result = await performAttachInvoiceToReceipt({
      transactionId: file.transaction_id,
      invoiceId: file.invoice_id,
      replace: true,
      initiatedBy: userId,
    })
    if (result.outcome === 'invoice_not_found') {
      return { error: 'The invoice has been deleted, so the copy cannot be refreshed. The stored copy is unchanged.' }
    }
    if (result.outcome !== 'refreshed' || !result.receipt) {
      return { error: 'The copy could not be refreshed. The stored copy is unchanged.' }
    }
    return { success: true, receipt: result.receipt }
  } catch (refreshError) {
    console.error('Failed to refresh an invoice copy', refreshError)
    return { error: 'The copy could not be refreshed. The stored copy is unchanged.' }
  }
}
