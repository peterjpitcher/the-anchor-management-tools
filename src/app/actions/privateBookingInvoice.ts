'use server'

/**
 * Raise and send an invoice for a private booking.
 *
 * The transactional work all happens inside
 * `create_private_booking_invoice_atomic`. This file is the boundary around
 * it: authorisation, loading the booking, resolving the billing party, running
 * the mapper, sending the email, and recording what happened.
 *
 * Two things here are deliberate and easy to undo by accident:
 *
 * 1. **Only super_admins may invoice.** `checkUserPermission` cannot express
 *    that, because managers already hold `invoices.create` and
 *    `private_bookings.edit`, so every obvious permission pair passes for them.
 *    The role has to be read explicitly.
 *
 * 2. **Delivery is `sent_at`, never `status`.** An invoice created with
 *    payments on it is born `partially_paid` or `paid`, and `invoices.status`
 *    holds payment state and delivery state in one mutually exclusive column.
 *    Stamping it `'sent'` would erase the payment state.
 */

import { revalidatePath } from 'next/cache'
import { createHash } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from './audit'
import { getErrorMessage } from '@/lib/errors'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { COMPANY_DETAILS } from '@/lib/company-details'
import { isGraphConfigured, sendInvoiceEmail } from '@/lib/microsoft-graph'
import {
  InvoiceMappingError,
  mapBookingToInvoice,
  type MappedInvoiceLine,
} from '@/lib/private-bookings/invoice-mapper'
import { toNum } from '@/lib/private-bookings/item-labels'
import { storeContractSnapshot } from '@/lib/private-bookings/contract-lifecycle'
import { formatDateFull } from '@/lib/dateUtils'
import type { InvoiceWithDetails } from '@/types/invoices'
import type { PrivateBookingWithDetails } from '@/types/private-bookings'
import { DEFAULT_PAYMENT_TERMS_DAYS } from '@/lib/vendors/paymentTerms'

export type DepositTreatment = 'held_separately' | 'deducted'

export interface InvoicePreviewLine {
  description: string
  quantity: number
  unitPrice: number
  discountPercentage: number
  vatRate: number
  lineTotal: number
}

export interface InvoiceDepositContext {
  amount: number
  paidOn: string | null
  method: string | null
  waived: boolean
}

export interface PrivateBookingInvoicePreview {
  bookingId: string
  customerName: string
  recipientEmail: string
  lines: InvoicePreviewLine[]
  subtotal: number
  vatAmount: number
  invoiceTotal: number
  paymentsReceived: number
  /** Balance when the deposit is held separately (the contract default). */
  balanceHoldingDeposit: number
  /** Balance when the deposit is applied to this invoice. */
  balanceDeductingDeposit: number
  deposit: InvoiceDepositContext | null
  /** True when applying the deposit would overpay the invoice. */
  depositWouldOverpay: boolean
  suggestedReference: string
  dueDate: string
  warnings: string[]
  /** Binds a confirmation to the data it was shown for. */
  sourceHash: string
  previousTreatment: DepositTreatment | null
}

type ActionResult<T> =
  | ({ error: string; blocked?: boolean } & Partial<T>)
  | ({ error?: undefined; blocked?: undefined } & T)

/**
 * Errors that mean "this booking cannot be invoiced as it stands", as opposed
 * to "that attempt failed, try again".
 *
 * The dialog disables its send button on these, because retrying changes
 * nothing until the booking itself is fixed. Everything else stays retryable:
 * a failed email or a dropped connection must not strip the operator of the
 * one button that would recover it.
 */
const BLOCKING_ERROR_CODES = new Set([
  'booking_not_found',
  'private_booking_invoice_missing_or_deleted',
  'booking_not_confirmed',
  'booking_cancelled',
  'booking_date_tbd',
  'booking_has_no_priced_items',
  'booking_payments_exceed_invoice_total',
  'invoice_total_reconciliation_failed',
  'permission_denied',
  'booking_not_invoiced',
  'invoice_has_real_payments',
  'cancel_reason_required',
])

/** Maps a raised code to its copy, and says whether it blocks outright. */
function describeBlockingError(code: string): { error: string; blocked: boolean } {
  return {
    error: ERROR_COPY[code] ?? code,
    blocked: BLOCKING_ERROR_CODES.has(code),
  }
}

/** Codes the database raises, mapped to something a person can act on. */
const ERROR_COPY: Record<string, string> = {
  booking_not_found: 'That booking could not be found.',
  private_booking_invoice_missing_or_deleted:
    'This booking is linked to an invoice that has been deleted. Unlink it before invoicing again.',
  booking_not_confirmed: 'Only confirmed bookings can be invoiced.',
  booking_cancelled: 'This booking has been cancelled.',
  booking_date_tbd: 'Set a date for this booking before invoicing it.',
  booking_has_no_priced_items: 'Add priced items to this booking before invoicing it.',
  booking_payments_exceed_invoice_total:
    'The deposit and payments received exceed the invoice total. This booking is owed a refund, not an invoice.',
  invoice_total_reconciliation_failed:
    'The invoice lines do not add up to the booking total, so nothing was created. This needs a look before invoicing.',
  invalid_deposit_treatment: 'Choose how the deposit should be treated.',
  permission_denied: 'You do not have permission to do that.',
  booking_not_invoiced: 'This booking has no invoice to cancel.',
  invoice_has_real_payments:
    'A payment has been received against this invoice, so it cannot be cancelled. Issue a credit note instead.',
  cancel_reason_required: 'Give a reason for cancelling this invoice.',
}

function describeDatabaseError(message: string): { error: string; blocked: boolean } {
  for (const code of Object.keys(ERROR_COPY)) {
    if (message.includes(code)) return describeBlockingError(code)
  }
  // An unrecognised database error is treated as retryable: it may well be a
  // dropped connection, and locking the operator out of the send button on
  // something transient is worse than letting them try again.
  return { error: message, blocked: false }
}

/**
 * Super admin only. Copied from the checklists actions, which are the newest
 * and most repeated version of this check in the codebase.
 */
async function requireSuperAdmin(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: 'Unauthorized' }

  const db = createAdminClient()
  const { data, error } = await (db.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: Array<{ role_name?: string }> | null; error: unknown }>)('get_user_roles', {
    p_user_id: user.id,
  })

  if (error) {
    console.error('[PrivateBookingInvoice] Failed to verify caller roles', error)
    return { error: 'Failed to verify permissions' }
  }

  if (!(data ?? []).some(row => row.role_name === 'super_admin')) {
    return { error: 'Only super admins can raise a booking invoice.' }
  }

  return { userId: user.id }
}

/**
 * Whether to show the invoice button at all.
 *
 * UI visibility is a courtesy, never the guard: every action re-checks the
 * role server-side. This exists so a manager is not shown a button that will
 * always refuse them.
 */
export async function currentUserCanInvoicePrivateBookings(): Promise<boolean> {
  const gate = await requireSuperAdmin()
  return !('error' in gate)
}

function bookingCustomerName(booking: PrivateBookingWithDetails): string {
  const full = (booking.customer_full_name || '').trim()
  if (full) return full
  const parts = [booking.customer_first_name, booking.customer_last_name].filter(Boolean)
  if (parts.length > 0) return parts.join(' ').trim()
  return (booking.customer_name || '').trim() || 'Customer'
}

/**
 * A stable fingerprint of everything that is billed or printed, so a
 * confirmation can be rejected if the booking moved underneath it. Covers more
 * than the total on purpose: a swap of two items at the same price changes the
 * invoice without changing the amount.
 */
function computeSourceHash(booking: PrivateBookingWithDetails): string {
  const items = (booking.items ?? [])
    .slice()
    .sort((a, b) => (toNum(a.display_order) ?? 0) - (toNum(b.display_order) ?? 0))
    .map(i =>
      [
        i.id,
        i.item_type,
        i.description,
        toNum(i.quantity),
        toNum(i.unit_price),
        i.discount_type,
        toNum(i.discount_value),
        toNum(i.vat_rate),
        toNum(i.line_total),
      ].join('|'),
    )

  const payload = [
    booking.id,
    booking.contact_email ?? '',
    booking.customer_id ?? '',
    booking.event_date,
    booking.discount_type ?? '',
    toNum(booking.discount_amount) ?? 0,
    toNum(booking.deposit_amount) ?? 0,
    booking.deposit_paid_date ?? '',
    String(booking.deposit_waived ?? false),
    ...items,
    ...(booking.payments ?? []).map(p => `${p.id}|${toNum(p.amount)}`),
  ].join('\n')

  return createHash('sha256').update(payload).digest('hex').slice(0, 32)
}

/**
 * Find or create the invoice_vendors row for this booking's customer.
 *
 * Matching is on `customer_id` only. `invoice_vendors` has exactly one
 * constraint, its primary key, so email is neither unique nor case-normalised
 * and can never be an upsert key. A booking with no customer record gets a
 * fresh vendor row rather than risking a wrong match on a shared address.
 */
async function resolveInvoiceVendor(
  booking: PrivateBookingWithDetails,
): Promise<{ vendorId: string } | { error: string }> {
  const db = createAdminClient()
  const name = bookingCustomerName(booking)
  const email = (booking.contact_email || '').trim() || null
  const phone = (booking.contact_phone || '').trim() || null

  if (booking.customer_id) {
    const { data: existing, error: lookupError } = await db
      .from('invoice_vendors')
      .select('id')
      .eq('customer_id', booking.customer_id)
      .maybeSingle()

    if (lookupError) {
      console.error('[PrivateBookingInvoice] Vendor lookup failed', lookupError)
      return { error: 'Could not look up the billing record for this customer.' }
    }

    if (existing?.id) {
      // Refresh contact details but never the name: renaming a shared vendor
      // would silently restate historical invoices that point at it.
      await db
        .from('invoice_vendors')
        .update({ email, phone, updated_at: new Date().toISOString() })
        .eq('id', existing.id)

      return { vendorId: existing.id }
    }
  }

  const { data: created, error: insertError } = await db
    .from('invoice_vendors')
    .insert({
      name,
      contact_name: name,
      email,
      phone,
      customer_id: booking.customer_id ?? null,
      // The booking's own balance_due_date drives this invoice's due date, so
      // these terms only matter if the customer is invoiced normally later.
      // Net-7 to match the house default rather than leaving them on 0.
      payment_terms: DEFAULT_PAYMENT_TERMS_DAYS,
      notes: 'Created automatically from a private booking.',
    })
    .select('id')
    .single()

  if (insertError || !created) {
    console.error('[PrivateBookingInvoice] Vendor create failed', insertError)
    return { error: 'Could not create a billing record for this customer.' }
  }

  return { vendorId: created.id }
}

async function loadBooking(bookingId: string): Promise<PrivateBookingWithDetails | null> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('private_bookings')
    .select(
      `*,
       customer:customers(id, first_name, last_name, email, mobile_number),
       items:private_booking_items(*, space:venue_spaces(*), package:catering_packages(*), vendor:vendors(*)),
       payments:private_booking_payments(*)`,
    )
    .order('display_order', { ascending: true, foreignTable: 'private_booking_items' })
    .order('created_at', { ascending: true, foreignTable: 'private_booking_payments' })
    .eq('id', bookingId)
    .maybeSingle()

  if (error) {
    console.error('[PrivateBookingInvoice] Failed to load booking', error)
    return null
  }

  return (data as PrivateBookingWithDetails | null) ?? null
}

function depositContext(booking: PrivateBookingWithDetails): InvoiceDepositContext | null {
  const amount = toNum(booking.deposit_amount) ?? 0
  if (booking.deposit_waived) {
    return { amount, paidOn: null, method: null, waived: true }
  }
  if (!booking.deposit_paid_date || amount <= 0) return null
  return {
    amount,
    paidOn: booking.deposit_paid_date,
    method: booking.deposit_payment_method ?? null,
    waived: false,
  }
}

function suggestedReference(booking: PrivateBookingWithDetails): string {
  const name = bookingCustomerName(booking)
  const eventType = (booking.event_type || '').trim()
  const date = booking.event_date ? formatDateFull(booking.event_date) : ''
  const head = eventType ? `${name} ${eventType}` : name
  return date ? `${head}, ${date}` : head
}

/** due_date must never land in the past: 15 of 19 priced bookings already have. */
function resolveDueDate(booking: PrivateBookingWithDetails, today: string): string {
  const due = booking.balance_due_date
  if (!due) return today
  return due > today ? due : today
}

/**
 * Everything the confirmation dialog needs, with both deposit outcomes priced
 * so the operator sees the consequence before choosing.
 */
export async function previewPrivateBookingInvoice(
  bookingId: string,
): Promise<ActionResult<{ preview: PrivateBookingInvoicePreview }>> {
  try {
    const gate = await requireSuperAdmin()
    if ('error' in gate) return { error: gate.error }

    const booking = await loadBooking(bookingId)
    if (!booking) return describeBlockingError('booking_not_found')

    const mapped = mapBookingToInvoice({
      items: booking.items ?? [],
      discount_type: booking.discount_type ?? null,
      discount_amount: toNum(booking.discount_amount),
    })

    const paymentsReceived = (booking.payments ?? []).reduce(
      (sum, p) => sum + (toNum(p.amount) ?? 0),
      0,
    )
    const deposit = depositContext(booking)
    const applicableDeposit = deposit && !deposit.waived ? deposit.amount : 0
    const invoiceTotal = mapped.totals.total_amount
    const today = getTodayIsoDate()

    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

    return {
      preview: {
        bookingId,
        customerName: bookingCustomerName(booking),
        recipientEmail: (booking.contact_email || '').trim(),
        lines: mapped.lineItems.map(line => ({
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unit_price,
          discountPercentage: line.discount_percentage,
          vatRate: line.vat_rate,
          lineTotal: round2(line.quantity * line.unit_price * (1 - line.discount_percentage / 100)),
        })),
        subtotal: mapped.totals.subtotal_amount,
        vatAmount: mapped.totals.vat_amount,
        invoiceTotal,
        paymentsReceived: round2(paymentsReceived),
        balanceHoldingDeposit: round2(Math.max(0, invoiceTotal - paymentsReceived)),
        balanceDeductingDeposit: round2(
          Math.max(0, invoiceTotal - paymentsReceived - applicableDeposit),
        ),
        deposit,
        depositWouldOverpay: round2(paymentsReceived + applicableDeposit) > invoiceTotal,
        suggestedReference: suggestedReference(booking),
        dueDate: resolveDueDate(booking, today),
        warnings: mapped.warnings,
        sourceHash: computeSourceHash(booking),
        previousTreatment:
          (booking.invoice_deposit_treatment as DepositTreatment | undefined) ?? null,
      },
    }
  } catch (error) {
    if (error instanceof InvoiceMappingError) {
      return describeBlockingError(error.code)
    }
    console.error('[PrivateBookingInvoice] Preview failed', error)
    return { error: getErrorMessage(error) }
  }
}

/**
 * Fetch the complete invoice for rendering. Deliberately not
 * `InvoiceService.getInvoiceById`: that runs on the cookie client, and it does
 * not order line items, so the PDF could print them in a different order each
 * time it is generated.
 */
async function loadInvoiceForSending(invoiceId: string): Promise<InvoiceWithDetails | null> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('invoices')
    .select(`*, vendor:invoice_vendors(*), line_items:invoice_line_items(*), payments:invoice_payments(*)`)
    .order('display_order', { ascending: true, foreignTable: 'invoice_line_items' })
    .order('payment_date', { ascending: true, foreignTable: 'invoice_payments' })
    .eq('id', invoiceId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error || !data) {
    console.error('[PrivateBookingInvoice] Failed to load invoice for sending', error)
    return null
  }

  return data as unknown as InvoiceWithDetails
}

interface SendOutcome {
  sent: boolean
  error?: string
}

async function deliverInvoice(
  invoice: InvoiceWithDetails,
  recipient: string,
  booking: PrivateBookingWithDetails,
  treatment: DepositTreatment,
  actorId: string,
): Promise<SendOutcome> {
  if (!isGraphConfigured()) {
    return { sent: false, error: 'Email is not configured, so the invoice was not sent.' }
  }

  const db = createAdminClient()
  const deposit = depositContext(booking)
  const outstanding = Math.max(0, invoice.total_amount - invoice.paid_amount)

  const depositSentence = (() => {
    if (!deposit || deposit.waived) return ''
    const paidOn = deposit.paidOn ? formatDateFull(deposit.paidOn) : null
    if (treatment === 'deducted') {
      return `\nYour deposit of £${deposit.amount.toFixed(2)}${paidOn ? ` received on ${paidOn}` : ''} has been applied to this invoice.\n`
    }
    return `\nYour booking and damage deposit of £${deposit.amount.toFixed(2)}${paidOn ? ` received on ${paidOn}` : ''} is held separately and will be refunded within 48 hours after your event, less any documented deductions. It is not part of the amount below.\n`
  })()

  // Owner decision 2026-08-28: every invoice goes out from Orange Jelly
  // Limited, the official business name, and nothing else. The venue is named
  // in the body only as a description of the booking, never as the sender.
  const subject = `Invoice ${invoice.invoice_number} from ${COMPANY_DETAILS.legalName}`
  const body = `Hi ${bookingCustomerName(booking)},

Thanks again for booking with us. Your invoice for ${booking.event_date ? formatDateFull(booking.event_date) : 'your event'} is attached.

Invoice total: £${invoice.total_amount.toFixed(2)}
Payments received: £${invoice.paid_amount.toFixed(2)}
Balance due: £${outstanding.toFixed(2)}
Due date: ${formatDateFull(invoice.due_date)}${invoice.reference ? `\nReference: ${invoice.reference}` : ''}
${depositSentence}
If anything looks wrong, just reply to this email and we will sort it out.

Many thanks,
${COMPANY_DETAILS.legalName}`

  const result = await sendInvoiceEmail(invoice, recipient, subject, body, undefined, undefined, {
    // Snapshotted at issue: a later refund must not rewrite what the customer
    // was already sent.
    deposit:
      deposit && !deposit.waived
        ? {
            amount: deposit.amount,
            paidOn: deposit.paidOn,
            method: deposit.method,
            treatment,
          }
        : undefined,
  })

  await db.from('invoice_email_logs').insert({
    invoice_id: invoice.id,
    sent_to: recipient,
    sent_by: actorId,
    subject,
    body,
    status: result.success ? 'sent' : 'failed',
    error_message: result.success ? null : result.error ?? 'Unknown error',
    message_id: result.messageId ?? null,
  })

  if (!result.success) {
    return { sent: false, error: result.error ?? 'The email could not be sent.' }
  }

  // Archive the exact bytes the customer received. Regenerating later would
  // produce a different document after any edit to the booking, the vendor or
  // the template, and VAT records have to be kept for six years.
  if (result.pdfBuffer) {
    await storeContractSnapshot(db, {
      bookingId: booking.id,
      version: 1,
      fileName: `invoice-${invoice.invoice_number}.pdf`,
      content: result.pdfBuffer,
      mimeType: 'application/pdf',
      documentType: 'invoice',
      generatedBy: actorId,
      metadata: {
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        total_amount: invoice.total_amount,
        paid_amount: invoice.paid_amount,
        deposit_treatment: treatment,
        sent_to: recipient,
        message_id: result.messageId ?? null,
      },
    })
  }

  const sentAt = new Date().toISOString()

  // Delivery is recorded on sent_at, never by overwriting status: this invoice
  // may legitimately already be 'partially_paid' or 'paid', and those values
  // are mutually exclusive with 'sent' in the same column.
  await db.from('invoices').update({ sent_at: sentAt, sent_to: recipient }).eq('id', invoice.id)

  // Keep the legacy status mirror honest for the no-payments case, where
  // 'draft' would otherwise persist after the customer already had the
  // invoice. The conditional eq() means an invoice born 'partially_paid' or
  // 'paid' is left exactly as it is.
  await db
    .from('invoices')
    .update({ status: 'sent' })
    .eq('id', invoice.id)
    .eq('status', 'draft')
  await db
    .from('private_bookings')
    .update({ invoice_sent_at: sentAt })
    .eq('id', booking.id)

  return { sent: true }
}

export interface GenerateInvoiceInput {
  bookingId: string
  depositTreatment: DepositTreatment
  reference?: string
  /** From the preview. Rejects the send if the booking changed since. */
  sourceHash?: string
}

export async function generatePrivateBookingInvoice(
  input: GenerateInvoiceInput,
): Promise<ActionResult<{ invoiceId: string; invoiceNumber: string; sent: boolean; warning?: string }>> {
  try {
    const gate = await requireSuperAdmin()
    if ('error' in gate) return { error: gate.error }

    if (input.depositTreatment !== 'held_separately' && input.depositTreatment !== 'deducted') {
      return { error: ERROR_COPY.invalid_deposit_treatment }
    }

    const booking = await loadBooking(input.bookingId)
    if (!booking) return describeBlockingError('booking_not_found')

    const recipient = (booking.contact_email || '').trim()
    if (!recipient) {
      return { error: 'Add an email address to this booking before invoicing it.' }
    }

    if (input.sourceHash && input.sourceHash !== computeSourceHash(booking)) {
      return {
        error: 'This booking changed while the invoice was on screen. Review the figures again.',
      }
    }

    const mapped = mapBookingToInvoice({
      items: booking.items ?? [],
      discount_type: booking.discount_type ?? null,
      discount_amount: toNum(booking.discount_amount),
    })

    const vendor = await resolveInvoiceVendor(booking)
    if ('error' in vendor) return { error: vendor.error }

    const today = getTodayIsoDate()
    const db = createAdminClient()

    const { data: rpcResult, error: rpcError } = await (db.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: { created: boolean; invoice: Record<string, unknown> } | null; error: { message: string } | null }>)(
      'create_private_booking_invoice_atomic',
      {
        p_booking_id: input.bookingId,
        p_invoice_date: today,
        p_due_date: resolveDueDate(booking, today),
        p_reference: (input.reference ?? '').trim() || suggestedReference(booking),
        p_deposit_treatment: input.depositTreatment,
        p_line_items: mapped.lineItems as unknown as MappedInvoiceLine[],
        p_totals: { ...mapped.totals, vendor_id: vendor.vendorId },
        p_actor_id: gate.userId,
      },
    )

    if (rpcError || !rpcResult) {
      const described = describeDatabaseError(rpcError?.message ?? 'Could not create the invoice.')
      console.error('[PrivateBookingInvoice] RPC failed', rpcError)
      return described
    }

    const invoiceId = String(rpcResult.invoice.id)
    const invoiceNumber = String(rpcResult.invoice.invoice_number)

    const invoice = await loadInvoiceForSending(invoiceId)
    if (!invoice) {
      return {
        error: `Invoice ${invoiceNumber} was created but could not be loaded to send. Retry sending from the booking.`,
      }
    }

    const delivery = await deliverInvoice(
      invoice,
      recipient,
      booking,
      input.depositTreatment,
      gate.userId,
    )

    await logAuditEvent({
      user_id: gate.userId,
      operation_type: rpcResult.created ? 'create' : 'send',
      resource_type: 'private_booking_invoice',
      resource_id: invoiceId,
      operation_status: delivery.sent ? 'success' : 'failure',
      new_values: {
        booking_id: input.bookingId,
        invoice_number: invoiceNumber,
        total_amount: invoice.total_amount,
        paid_amount: invoice.paid_amount,
        deposit_treatment: input.depositTreatment,
        recipient,
        created: rpcResult.created,
        email_error: delivery.error ?? null,
      },
    })

    revalidatePath(`/private-bookings/${input.bookingId}`)
    revalidatePath('/private-bookings')
    revalidatePath('/invoices')

    return {
      invoiceId,
      invoiceNumber,
      sent: delivery.sent,
      warning: delivery.error,
    }
  } catch (error) {
    if (error instanceof InvoiceMappingError) {
      return describeBlockingError(error.code)
    }
    console.error('[PrivateBookingInvoice] Generate failed', error)
    return { error: getErrorMessage(error) }
  }
}

/**
 * Resend an invoice whose email failed. Creates nothing: the atomic function
 * is idempotent and this path does not call it at all.
 */
export async function retryPrivateBookingInvoiceEmail(
  bookingId: string,
): Promise<ActionResult<{ sent: true }>> {
  try {
    const gate = await requireSuperAdmin()
    if ('error' in gate) return { error: gate.error }

    const booking = await loadBooking(bookingId)
    if (!booking) return describeBlockingError('booking_not_found')
    if (!booking.invoice_id) return { error: 'This booking has no invoice to send.' }

    const recipient = (booking.contact_email || '').trim()
    if (!recipient) return { error: 'Add an email address to this booking first.' }

    const invoice = await loadInvoiceForSending(booking.invoice_id)
    if (!invoice) return describeBlockingError('private_booking_invoice_missing_or_deleted')

    const treatment =
      (booking.invoice_deposit_treatment as DepositTreatment | undefined) ?? 'held_separately'

    const delivery = await deliverInvoice(invoice, recipient, booking, treatment, gate.userId)

    await logAuditEvent({
      user_id: gate.userId,
      operation_type: 'send',
      resource_type: 'private_booking_invoice',
      resource_id: invoice.id,
      operation_status: delivery.sent ? 'success' : 'failure',
      new_values: { booking_id: bookingId, retry: true, email_error: delivery.error ?? null },
    })

    revalidatePath(`/private-bookings/${bookingId}`)

    if (!delivery.sent) return { error: delivery.error ?? 'The email could not be sent.' }
    return { sent: true }
  } catch (error) {
    console.error('[PrivateBookingInvoice] Retry failed', error)
    return { error: getErrorMessage(error) }
  }
}

/**
 * Cancel a booking's invoice so a corrected one can be raised.
 *
 * The booked items change after invoicing more often than the original design
 * allowed for, and until this existed there was no way back: the atomic
 * generate RPC short circuits on `private_bookings.invoice_id`, so a second
 * press returned the original invoice rather than a corrected one.
 *
 * This voids the invoice and releases the booking in one database call, so a
 * failure can never leave a live invoice unlinked or a void one still attached.
 * The deposit is untouched on the booking and is re-applied when the
 * replacement invoice is generated.
 *
 * A real payment blocks this outright. Money received against an invoice is
 * resolved with a credit note, never by voiding the invoice underneath it.
 */
export async function cancelPrivateBookingInvoice(
  bookingId: string,
  reason: string,
): Promise<ActionResult<{ voided: boolean; invoiceNumber: string | null }>> {
  try {
    const gate = await requireSuperAdmin()
    if ('error' in gate) return { error: gate.error }

    const trimmedReason = (reason ?? '').trim()
    if (!trimmedReason) {
      return { error: 'Give a reason for cancelling this invoice.' }
    }

    const booking = await loadBooking(bookingId)
    if (!booking) return describeBlockingError('booking_not_found')
    if (!booking.invoice_id) return { error: 'This booking has no invoice to cancel.' }

    const previousInvoiceId = booking.invoice_id
    const db = createAdminClient()

    const { data: rpcResult, error: rpcError } = await (db.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{
      data: { unlinked: boolean; voided: boolean; invoice_number: string | null } | null
      error: { message: string } | null
    }>)('cancel_private_booking_invoice_atomic', {
      p_booking_id: bookingId,
      p_reason: trimmedReason,
      p_actor_id: gate.userId,
    })

    if (rpcError || !rpcResult) {
      const described = describeDatabaseError(rpcError?.message ?? 'Could not cancel the invoice.')
      console.error('[PrivateBookingInvoice] Cancel RPC failed', rpcError)
      return described
    }

    await logAuditEvent({
      user_id: gate.userId,
      operation_type: 'update',
      resource_type: 'private_booking_invoice',
      resource_id: previousInvoiceId,
      operation_status: 'success',
      new_values: {
        booking_id: bookingId,
        action: 'cancel_and_unlink',
        invoice_number: rpcResult.invoice_number,
        voided: rpcResult.voided,
        reason: trimmedReason,
      },
    })

    revalidatePath(`/private-bookings/${bookingId}`)
    revalidatePath('/private-bookings')
    revalidatePath('/invoices')
    revalidatePath(`/invoices/${previousInvoiceId}`)

    return { voided: rpcResult.voided, invoiceNumber: rpcResult.invoice_number }
  } catch (error) {
    console.error('[PrivateBookingInvoice] Cancel failed', error)
    return { error: getErrorMessage(error) }
  }
}
