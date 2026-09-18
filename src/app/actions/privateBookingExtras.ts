'use server'

import { createHash, randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from './rbac'
import { logAuditEvent } from './audit'
import { getErrorMessage } from '@/lib/errors'
import { formatDateFull, getTodayIsoDate } from '@/lib/dateUtils'
import { invoiceBalanceDue, invoiceIssuedCreditTotal } from '@/lib/invoices/balance'
import { COMPANY_DETAILS } from '@/lib/company-details'
import { sendInvoiceEmail } from '@/lib/microsoft-graph'
import { invoiceCanOfferPayPal, invoicePortalUrl } from '@/lib/invoices/payment-link-footer'
import { storeContractSnapshot } from '@/lib/private-bookings/contract-lifecycle'
import { requirePrivateBookingBillingAdmin, loadInvoiceForSending } from '@/lib/private-bookings/invoice-access'
import {
  allocatedPaymentSchema, calculateExtraChargeTotals, extraChargeDraftSchema,
  type AllocatedBookingPaymentInput, type BillingActionResult, type ExtraChargeBatch,
  type ExtraChargePreview, type IssueExtraChargeInput, type PrivateBookingBilling,
  type SaveExtraChargeInput,
} from '@/lib/private-bookings/extra-charges'

const uuid = z.string().uuid()
const BILLING_ERRORS: Record<string, string> = {
  stale_charge_batch: 'This draft has changed. Reload it before saving or issuing.',
  booking_not_eligible_for_extras: 'Extra charges require an invoiced, confirmed or completed booking.',
  booking_not_found: 'Booking not found.',
  charge_batch_not_found: 'This charge batch could not be found.',
  charge_batch_not_issued: 'This batch has not been issued.',
  original_invoice_not_collectible: 'Review the original invoice before adding extra charges.',
  extras_total_must_be_positive: 'The additional invoice must have a positive total.',
  select_current_or_future_due_date: 'Select a due date today or later.',
  allocation_exceeds_invoice_balance: 'An allocation exceeds that invoice balance. Refresh the balances and try again.',
  allocation_total_mismatch: 'The invoice allocations must equal the payment received.',
  invoice_not_on_booking: 'An invoice does not belong to this booking.',
  invoice_has_real_payments: 'This invoice has payments. Resolve a credit or refund before cancelling it.',
  invoice_not_payable: 'This invoice is not available for payment.',
  booking_not_payable: 'This booking is not available for payment.',
  receipt_idempotency_conflict: 'This payment reference was already recorded with different details. Reload before recording another payment.',
  permission_denied: 'You do not have permission to do this.',
  invalid_extra_line: 'Check the descriptions, quantities, prices, discounts and VAT on each line.',
}


async function requireBillingView(): Promise<{ userId: string }> {
  const session = await createClient()
  const { data: { user } } = await session.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  if (!await checkUserPermission('private_bookings', 'view', user.id) || !await checkUserPermission('private_bookings', 'view_pricing', user.id)) throw new Error('Insufficient permissions')
  return { userId: user.id }
}

async function requireBillingAdmin(): Promise<{ userId: string }> {
  const gate = await requirePrivateBookingBillingAdmin()
  if ('error' in gate) throw new Error(gate.error)
  return gate
}

async function callBillingRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await createAdminClient().rpc(name, args)
  if (error) throw new Error(BILLING_ERRORS[error.message] ?? error.message)
  if (data == null) throw new Error('The billing update returned no result. Reload before retrying.')
  return data as T
}

function invalidate(bookingId: string): void {
  revalidatePath(`/private-bookings/${bookingId}`)
  revalidatePath(`/private-bookings/${bookingId}/items`)
  revalidatePath('/private-bookings')
  revalidatePath('/invoices')
}

async function audit(actorId: string, bookingId: string, action: string, resourceId: string, values: Record<string, unknown> = {}): Promise<void> {
  await logAuditEvent({ user_id: actorId, operation_type: 'update', resource_type: 'private_booking_billing', resource_id: resourceId, operation_status: values.sent === false ? 'failure' : 'success', new_values: { booking_id: bookingId, action, ...values } })
}

async function loadBatch(bookingId: string, batchId: string): Promise<ExtraChargeBatch> {
  uuid.parse(bookingId)
  uuid.parse(batchId)
  const { data, error } = await createAdminClient().from('private_booking_charge_batches').select('*').eq('booking_id', bookingId).eq('id', batchId).single()
  if (error || !data) throw new Error('This charge batch could not be loaded.')
  return data as ExtraChargeBatch
}

async function buildPreview(bookingId: string, batchId: string): Promise<ExtraChargePreview> {
  const batch = await loadBatch(bookingId, batchId)
  const { data: booking, error } = await createAdminClient().from('private_bookings').select('id, invoice_id, contact_email, status').eq('id', bookingId).single()
  if (error || !booking) throw new Error('Booking not found.')
  if (!booking.invoice_id) throw new Error('Create the original invoice before adding extra charges.')
  if (!['confirmed', 'completed'].includes(booking.status)) throw new Error('Extra charges require a confirmed or completed booking.')
  const original = await loadInvoiceForSending(booking.invoice_id)
  if (!original || ['void', 'written_off'].includes(original.status)) throw new Error('The original invoice is unavailable. Review the booking billing first.')
  const recipientEmail = String(booking.contact_email ?? '').trim()
  const paypalEnabled = original.vendor?.paypal_payments_enabled === true
  const sourceHash = createHash('sha256').update(JSON.stringify({ batch, recipientEmail, vendorId: original.vendor_id, paypalEnabled })).digest('hex')
  return { batch, totals: calculateExtraChargeTotals(batch.lines), recipientEmail, paypalEnabled, sourceHash }
}

export async function getPrivateBookingBilling(bookingId: string): Promise<BillingActionResult<{ data: PrivateBookingBilling }>> {
  try {
    await requireBillingView()
    uuid.parse(bookingId)
    const db = createAdminClient()
    const [batchResult, linkResult] = await Promise.all([
      db.from('private_booking_charge_batches').select('*').eq('booking_id', bookingId).order('created_at'),
      db.from('private_booking_invoices').select('invoice_id, kind, invoice:invoices(*, vendor:invoice_vendors(paypal_payments_enabled), credits:credit_notes(status, amount_inc_vat))').eq('booking_id', bookingId).order('created_at'),
    ])
    if (batchResult.error) throw new Error(batchResult.error.message)
    if (linkResult.error) throw new Error(linkResult.error.message)
    type LinkedInvoice = { invoice_id: string; kind: 'original' | 'supplementary'; invoice: { credits?: Array<{ status: string; amount_inc_vat: number | string }>; id: string; invoice_number: string; status: string; invoice_date: string; due_date: string; total_amount: number; paid_amount: number; sent_at: string | null; deleted_at: string | null; vendor: { paypal_payments_enabled: boolean | null } | null } }
    const links = (linkResult.data ?? []) as unknown as LinkedInvoice[]
    const ids = links.map(link => link.invoice_id)
    const logs = ids.length ? await db.from('invoice_email_logs').select('invoice_id, status, sent_at').in('invoice_id', ids).order('sent_at', { ascending: false }) : { data: [], error: null }
    if (logs.error) throw new Error(logs.error.message)
    const invoices = links.filter(link => link.invoice && !link.invoice.deleted_at).map(link => {
      const invoice = link.invoice
      const latest = (logs.data ?? []).find(log => log.invoice_id === invoice.id)
      const batch = ((batchResult.data ?? []) as ExtraChargeBatch[]).find(row => row.invoice_id === invoice.id)
      return {
        id: invoice.id, invoice_number: invoice.invoice_number, kind: link.kind,
        status: invoice.status, invoice_date: invoice.invoice_date, due_date: invoice.due_date,
        total_amount: Number(invoice.total_amount), paid_amount: Number(invoice.paid_amount),
        balance: invoiceBalanceDue(invoice),
        credit_amount: invoiceIssuedCreditTotal(invoice),
        sent_at: invoice.sent_at, paypalEnabled: invoice.vendor?.paypal_payments_enabled === true,
        paymentUrl: invoiceCanOfferPayPal(invoice) ? invoicePortalUrl(invoice.id) : null,
        deliveryState: batch?.delivery_state ?? (latest?.status === 'failed' ? 'failed' as const : invoice.sent_at ? 'sent' as const : 'not_sent' as const),
      }
    })
    const collectible = invoices.filter(invoice => !['void', 'written_off'].includes(invoice.status))
    return { data: {
      batches: (batchResult.data ?? []) as ExtraChargeBatch[], invoices,
      supplementaryTotal: Math.round(collectible.filter(invoice => invoice.kind === 'supplementary').reduce((sum, invoice) => sum + invoice.total_amount, 0) * 100) / 100,
      creditsTotal: Math.round(collectible.reduce((sum, invoice) => sum + invoice.credit_amount, 0) * 100) / 100,
      collectibleBalance: Math.round(collectible.reduce((sum, invoice) => sum + invoice.balance, 0) * 100) / 100,
    } }
  } catch (error) { return { error: getErrorMessage(error) } }
}

export async function savePrivateBookingExtras(input: SaveExtraChargeInput): Promise<BillingActionResult<{ batch: ExtraChargeBatch }>> {
  try {
    const actor = await requireBillingAdmin()
    const parsed = extraChargeDraftSchema.parse(input)
    if (parsed.dueDate < getTodayIsoDate()) throw new Error('Select a due date today or later.')
    const batch = await callBillingRpc<ExtraChargeBatch>('save_private_booking_charge_batch', {
      p_booking_id: parsed.bookingId, p_batch_id: parsed.batchId ?? randomUUID(), p_expected_revision: parsed.expectedRevision ?? 0,
      p_lines: parsed.lines.map((line, index) => ({ ...line, display_order: index })), p_due_date: parsed.dueDate, p_reference: parsed.reference || null, p_actor_id: actor.userId,
    })
    await audit(actor.userId, parsed.bookingId, 'save_draft', batch.id)
    invalidate(parsed.bookingId)
    return { batch }
  } catch (error) { return { error: getErrorMessage(error) } }
}

export async function deletePrivateBookingExtras(bookingId: string, batchId: string, expectedRevision: number): Promise<BillingActionResult<{ success: true }>> {
  try {
    const actor = await requireBillingAdmin()
    uuid.parse(bookingId); uuid.parse(batchId)
    z.number().int().positive().parse(expectedRevision)
    await callBillingRpc('discard_private_booking_charge_batch', { p_booking_id: bookingId, p_batch_id: batchId, p_expected_revision: expectedRevision })
    await audit(actor.userId, bookingId, 'discard_draft', batchId)
    invalidate(bookingId)
    return { success: true }
  } catch (error) { return { error: getErrorMessage(error) } }
}

export async function previewPrivateBookingExtras(bookingId: string, batchId: string): Promise<BillingActionResult<{ preview: ExtraChargePreview }>> {
  try {
    await requireBillingAdmin()
    return { preview: await buildPreview(bookingId, batchId) }
  } catch (error) { return { error: getErrorMessage(error) } }
}

async function deliverExtraInvoice(bookingId: string, invoiceId: string, actorId: string, resend = false): Promise<{ sent: boolean; warning?: string }> {
  const db = createAdminClient()
  const { data: link, error: linkError } = await db.from('private_booking_invoices').select('kind').eq('booking_id', bookingId).eq('invoice_id', invoiceId).single()
  if (linkError || link?.kind !== 'supplementary') throw new Error('This additional invoice does not belong to this booking.')
  const invoice = await loadInvoiceForSending(invoiceId)
  if (!invoice || ['void', 'written_off'].includes(invoice.status)) throw new Error('This invoice is no longer available to send.')
  const { data: booking, error } = await db.from('private_bookings').select('contact_email').eq('id', bookingId).single()
  if (error || !booking) throw new Error('Booking not found.')
  const recipient = z.string().email().parse(String(booking.contact_email ?? '').trim())
  const subject = `Additional invoice ${invoice.invoice_number} from ${COMPANY_DETAILS.legalName}`
  const body = `Hello,\n\nYour invoice for the additional charges agreed for your private booking is attached.\n\nInvoice total: £${Number(invoice.total_amount).toFixed(2)}\nPayments received: £${Number(invoice.paid_amount).toFixed(2)}\n${invoiceIssuedCreditTotal(invoice) > 0 ? `Credits: £${invoiceIssuedCreditTotal(invoice).toFixed(2)}\n` : ''}Balance due: £${invoiceBalanceDue(invoice).toFixed(2)}\nDue date: ${formatDateFull(invoice.due_date)}\n${invoice.reference ? `Reference: ${invoice.reference}\n` : ''}\nThis invoice covers these additional charges only. Your original invoice remains separate.\n\nIf anything looks wrong, please reply to this email.\n\nMany thanks,\n${COMPANY_DETAILS.legalName}`
  const claim = await callBillingRpc<{ claimed: boolean; state: string; claim_id?: string }>('claim_private_booking_extra_delivery', {
    p_booking_id: bookingId, p_invoice_id: invoiceId, p_actor_id: actorId, p_resend: resend,
  })
  if (!claim.claimed) {
    if (claim.state === 'sent') return { sent: true }
    return { sent: false, warning: claim.state === 'failed'
      ? 'The previous email failed. Use Resend on this invoice to retry delivery.'
      : 'Email delivery is already being processed or needs checking. Do not send another copy until its outcome is confirmed.' }
  }
  if (!claim.claim_id) throw new Error('Delivery claim is missing. The invoice has not been sent.')
  const delivery = await sendInvoiceEmail(invoice, recipient, subject, body)
  try {
    await callBillingRpc('finish_private_booking_extra_delivery', { p_booking_id: bookingId, p_invoice_id: invoiceId, p_claim_id: claim.claim_id, p_sent: delivery.success, p_error: delivery.error ?? null })
  } catch (finishError) {
    console.error('Additional invoice delivery outcome could not be saved', getErrorMessage(finishError))
    return { sent: delivery.success, warning: 'The email delivery outcome could not be saved. Check delivery before trying to send again.' }
  }
  const { error: logError } = await db.from('invoice_email_logs').insert({ invoice_id: invoiceId, sent_to: recipient, sent_by: actorId, subject, body, status: delivery.success ? 'sent' : 'failed', error_message: delivery.error ?? null, message_id: delivery.messageId ?? null })
  if (!delivery.success) return { sent: false, warning: delivery.error || 'Invoice created but email failed. Use resend on this invoice.' }
  const { error: stampError } = await db.from('invoices').update({ sent_at: new Date().toISOString(), sent_to: recipient }).eq('id', invoiceId)
  let archiveWarning: string | undefined
  if (delivery.pdfBuffer) {
    try {
      await storeContractSnapshot(db, {
        bookingId,
        // Each claimed delivery is an independent immutable snapshot, including resends.
        version: 1,
        fileName: `invoice-${invoice.invoice_number}-${claim.claim_id}.pdf`,
        content: delivery.pdfBuffer,
        mimeType: 'application/pdf',
        documentType: 'invoice',
        strict: true,
        generatedBy: actorId,
        metadata: {
          snapshot_schema_version: 1,
          delivery_claim_id: claim.claim_id,
          invoice_id: invoiceId,
          invoice_number: invoice.invoice_number,
          total_amount: invoice.total_amount,
          paid_amount: invoice.paid_amount,
          credits_total: invoiceIssuedCreditTotal(invoice),
          supplementary: true,
          sent_to: recipient,
          message_id: delivery.messageId ?? null,
        },
      })
    } catch (archiveError) {
      console.error('Additional invoice archive failed', getErrorMessage(archiveError))
      archiveWarning = 'Email sent, but its PDF could not be archived. Do not resend just to repair the archive.'
    }
  }
  return { sent: true, warning: [
    stampError || logError ? 'Email sent, but its delivery record could not be fully saved. Check before resending.' : undefined,
    archiveWarning,
  ].filter(Boolean).join(' ') || undefined }
}

export async function issuePrivateBookingExtras(input: IssueExtraChargeInput): Promise<BillingActionResult<{ invoiceId: string; invoiceNumber: string; sent: boolean; warning?: string }>> {
  try {
    const actor = await requireBillingAdmin()
    const preview = await buildPreview(input.bookingId, input.batchId)
    if (preview.batch.status === 'void') throw new Error('This batch has been discarded or cancelled.')
    if (preview.batch.status === 'draft') {
      if (preview.sourceHash !== input.sourceHash || preview.batch.revision !== input.expectedRevision) throw new Error('The draft or billing details changed. Preview the invoice again.')
      if (preview.batch.due_date < getTodayIsoDate()) throw new Error('Select a due date today or later.')
      if (preview.totals.totalAmount <= 0) throw new Error('An additional invoice must have a positive total.')
      z.string().email().parse(preview.recipientEmail)
      if (!preview.paypalEnabled && !input.allowWithoutOnlinePayment) throw new Error('Online payment is disabled for this customer. Explicitly choose to issue without a payment link.')
    }
    const issued = await callBillingRpc<{ created: boolean; invoice: { credits?: Array<{ status: string; amount_inc_vat: number | string }>; id: string; invoice_number: string; sent_at: string | null } }>('issue_private_booking_charge_batch', { p_booking_id: input.bookingId, p_batch_id: input.batchId, p_expected_revision: input.expectedRevision, p_actor_id: actor.userId })
    // A repeated confirmation never creates another invoice or resends one already delivered.
    let delivery: { sent: boolean; warning?: string }
    try {
      delivery = issued.invoice.sent_at ? { sent: true } : await deliverExtraInvoice(input.bookingId, issued.invoice.id, actor.userId)
    } catch (deliveryError) {
      delivery = { sent: false, warning: `Invoice created. Delivery could not be completed: ${getErrorMessage(deliveryError)}` }
    }
    await audit(actor.userId, input.bookingId, issued.created ? 'issue_extra_invoice' : 'retry_extra_invoice', issued.invoice.id, { sent: delivery.sent, email_error: delivery.warning ?? null })
    invalidate(input.bookingId)
    return { invoiceId: issued.invoice.id, invoiceNumber: issued.invoice.invoice_number, ...delivery }
  } catch (error) { return { error: getErrorMessage(error) } }
}

export async function resendPrivateBookingExtraInvoice(bookingId: string, invoiceId: string): Promise<BillingActionResult<{ sent: boolean; warning?: string }>> {
  try {
    const actor = await requireBillingAdmin()
    uuid.parse(bookingId); uuid.parse(invoiceId)
    const delivery = await deliverExtraInvoice(bookingId, invoiceId, actor.userId, true)
    await audit(actor.userId, bookingId, 'resend_extra_invoice', invoiceId, { sent: delivery.sent, email_error: delivery.warning ?? null })
    invalidate(bookingId)
    return delivery
  } catch (error) { return { error: getErrorMessage(error) } }
}

export async function cancelPrivateBookingExtraInvoice(bookingId: string, invoiceId: string, reason: string): Promise<BillingActionResult<{ success: true }>> {
  try {
    const actor = await requireBillingAdmin()
    uuid.parse(bookingId); uuid.parse(invoiceId)
    const trimmed = z.string().trim().min(1).max(2000).parse(reason)
    const { data: batch, error } = await createAdminClient().from('private_booking_charge_batches').select('id').eq('booking_id', bookingId).eq('invoice_id', invoiceId).single()
    if (error || !batch) throw new Error('This additional invoice does not belong to this booking.')
    await callBillingRpc('cancel_private_booking_charge_batch', { p_booking_id: bookingId, p_batch_id: batch.id, p_reason: trimmed, p_actor_id: actor.userId })
    await audit(actor.userId, bookingId, 'cancel_extra_invoice', invoiceId, { reason: trimmed })
    invalidate(bookingId)
    return { success: true }
  } catch (error) { return { error: getErrorMessage(error) } }
}

export async function recordPrivateBookingInvoicePayment(input: AllocatedBookingPaymentInput): Promise<BillingActionResult<{ success: true; receiptId: string }>> {
  try {
    const session = await createClient()
    const { data: { user } } = await session.auth.getUser()
    if (!user) throw new Error('Unauthorized')
    if (!await checkUserPermission('private_bookings', 'manage_deposits', user.id)) throw new Error('Insufficient permissions')
    const parsed = allocatedPaymentSchema.parse(input)
    if (parsed.paymentDate > getTodayIsoDate()) throw new Error('The received date cannot be in the future.')
    const recorded = await callBillingRpc<{ receipt_id: string }>('record_private_booking_allocated_payment', {
      p_booking_id: parsed.bookingId, p_receipt_id: parsed.receiptId, p_payment_date: parsed.paymentDate, p_amount: parsed.amount,
      p_method: parsed.method, p_reference: parsed.reference || null, p_notes: parsed.notes || null,
      p_allocations: parsed.allocations.map(row => ({ invoice_id: row.invoiceId, amount: row.amount })), p_actor_id: user.id,
    })
    await audit(user.id, parsed.bookingId, 'record_allocated_payment', recorded.receipt_id, { amount: parsed.amount, payment_date: parsed.paymentDate })
    invalidate(parsed.bookingId)
    return { success: true, receiptId: recorded.receipt_id }
  } catch (error) { return { error: getErrorMessage(error) } }
}
