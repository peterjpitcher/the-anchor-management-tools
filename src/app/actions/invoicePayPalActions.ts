'use server'

/**
 * Letting a customer pay an invoice by PayPal.
 *
 * Modelled directly on the private booking deposit flow: staff either copy a
 * link or send one, the customer lands on a signed public page, and the money
 * can arrive back by four independent routes (customer return, webhook,
 * reconciliation cron, or a staff-side retry).
 *
 * The rule that makes that safe is that no path writes the payment itself.
 * They all call `record_invoice_paypal_payment_atomic`, which keys on PayPal's
 * capture id and recalculates the invoice from its payment rows, so a race
 * between the webhook and the customer's browser records the money once.
 */

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { logger } from '@/lib/logger'
import { getErrorMessage } from '@/lib/errors'
import {
  PAYPAL_DEFAULT_CURRENCY,
  createSimplePayPalOrder,
  getPayPalOrder,
} from '@/lib/paypal'
import { generateInvoiceToken, verifyInvoiceToken } from '@/lib/invoices/invoice-token'
import { sendInvoicePaymentLinkEmail } from '@/lib/email/invoice-payment-emails'
import { resolveVendorInvoiceRecipients } from '@/lib/invoice-recipients'
import { invoicePaymentCustomId } from '@/lib/invoices/paypal-custom-id'
import { settleInvoicePayPalOrder } from '@/lib/invoices/paypal-capture'

/** Statuses where asking the customer for money is legitimate. */
const PAYABLE_STATUSES = new Set(['sent', 'overdue', 'partially_paid'])

type PayableInvoice = {
  id: string
  invoice_number: string
  status: string
  total_amount: number
  paid_amount: number
  due_date: string
  vendor_id: string
  paypal_order_id: string | null
  sent_at: string | null
  updated_at: string | null
  vendor: { name: string | null; email: string | null } | null
}

const INVOICE_COLUMNS =
  'id, invoice_number, status, total_amount, paid_amount, due_date, vendor_id, paypal_order_id, sent_at, updated_at, vendor:invoice_vendors(name, email)'

function outstanding(invoice: { total_amount: number; paid_amount: number }): number {
  // Rounded to the penny: PayPal will not accept more precision, and a floating
  // point tail would make the amount check below fail against itself.
  return Math.round((Number(invoice.total_amount || 0) - Number(invoice.paid_amount || 0)) * 100) / 100
}

/** Why this invoice cannot be paid online, or null when it can. */
export async function describeUnpayable(invoice: PayableInvoice | null): Promise<string | null> {
  if (!invoice) return 'That invoice could not be found.'
  if (invoice.status === 'void') return 'This invoice has been cancelled, so there is nothing to pay.'
  if (invoice.status === 'written_off') return 'This invoice has been written off, so there is nothing to pay.'
  if (invoice.status === 'paid') return 'This invoice is already paid in full. Thank you.'
  // A draft that has demonstrably reached the customer is payable. The manual
  // send flips the status to `sent` immediately after the email goes out, and
  // that flip can fail while the email has already landed; refusing here would
  // hand that customer a dead link for money they genuinely owe. `sent_at` is
  // the authoritative delivery record, so it is what this trusts.
  if (invoice.status === 'draft' && !invoice.sent_at) {
    return 'This invoice has not been issued yet.'
  }
  if (invoice.status !== 'draft' && !PAYABLE_STATUSES.has(invoice.status)) {
    return 'This invoice cannot be paid online.'
  }
  if (outstanding(invoice) <= 0) return 'There is nothing left to pay on this invoice.'
  return null
}

async function loadInvoice(invoiceId: string): Promise<PayableInvoice | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('invoices')
    .select(INVOICE_COLUMNS)
    .eq('id', invoiceId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    logger.error('[InvoicePayPal] Failed to load invoice', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { invoiceId },
    })
    return null
  }

  return (data as unknown as PayableInvoice | null) ?? null
}

function orderAmount(order: any): number | null {
  const raw = order?.purchase_units?.[0]?.amount?.value
  const amount = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN
  return Number.isFinite(amount) ? amount : null
}

function orderCurrency(order: any): string | null {
  const raw = order?.purchase_units?.[0]?.amount?.currency_code
  return typeof raw === 'string' && raw.trim() ? raw.trim().toUpperCase() : null
}

function approveUrl(order: any): string | null {
  const links = Array.isArray(order?.links) ? order.links : []
  const link =
    links.find((c: any) => c?.rel === 'payer-action') || links.find((c: any) => c?.rel === 'approve')
  return typeof link?.href === 'string' && link.href.trim() ? link.href : null
}

function amountsMatch(actual: number, expected: number): boolean {
  return Math.round(actual * 100) === Math.round(expected * 100)
}

function orderBelongsToInvoice(order: any, invoiceId: string): boolean {
  const unit = order?.purchase_units?.[0]
  return unit?.reference_id === invoiceId
    && unit?.custom_id === invoicePaymentCustomId(invoiceId)
}

function isReusable(order: any): boolean {
  return ['CREATED', 'PAYER_ACTION_REQUIRED', 'APPROVED'].includes(order?.status)
    && approveUrl(order) !== null
}

function portalUrl(token: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://management.orangejelly.co.uk'
  return `${appUrl}/invoice-portal/${token}`
}

/**
 * Reuse an in-flight order when it still matches, otherwise open a new one.
 *
 * Reuse is checked against the live order rather than trusted from our column:
 * the amount can have moved since (a part payment recorded by hand), and paying
 * a stale amount is worse than issuing a new link.
 */
async function ensurePayPalOrder(
  invoice: PayableInvoice,
  returnUrl: string,
  cancelUrl: string,
): Promise<{ approveUrl: string; orderId: string } | { error: string }> {
  const admin = createAdminClient()
  const due = outstanding(invoice)

  if (invoice.paypal_order_id) {
    try {
      const existing = await getPayPalOrder(invoice.paypal_order_id)
      if (!orderBelongsToInvoice(existing, invoice.id)) {
        return { error: 'The previous payment reference does not match this invoice. Please contact us before paying again.' }
      }
      if (existing?.status === 'COMPLETED') {
        const recovered = await settleInvoicePayPalOrder(invoice, invoice.paypal_order_id, 'portal', existing)
        if (recovered.error) return { error: recovered.error }
        return { error: 'Your previous payment has been recorded. Reload to see the updated balance before paying again.' }
      }
      if (existing?.purchase_units?.some((unit: { payments?: { captures?: unknown[] } }) => unit.payments?.captures?.length)) {
        return { error: 'Your previous payment is still being checked. Please contact us before paying again.' }
      }
      const amount = orderAmount(existing)
      const url = approveUrl(existing)

      if (
        isReusable(existing)
        && orderBelongsToInvoice(existing, invoice.id)
        && amount !== null
        && amountsMatch(amount, due)
        && orderCurrency(existing) === PAYPAL_DEFAULT_CURRENCY
        && url
      ) {
        return { approveUrl: url, orderId: invoice.paypal_order_id }
      }

      if (!['CREATED', 'PAYER_ACTION_REQUIRED', 'APPROVED', 'VOIDED'].includes(existing?.status)) {
        return { error: 'Your previous payment is still being checked. Please contact us before paying again.' }
      }
      if (existing.status === 'APPROVED') {
        return { error: 'Your previous payment needs checking. Please contact us before paying again.' }
      }

      // Keep the previous reference until a replacement order is attached by
      // the conditional update below. Failed creation leaves it recoverable.
    } catch (error) {
      logger.error('[InvoicePayPal] Could not verify the existing order', {
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: { invoiceId: invoice.id, orderId: invoice.paypal_order_id },
      })
      return { error: 'We could not check your previous payment. Please try again shortly before paying again.' }
    }
  }

  try {
    // Salted with updated_at so two clicks in the same state collapse to one
    // order, while a genuine change (a part payment) produces a new one.
    const generation = (invoice.updated_at || 'initial').replace(/[^0-9]/g, '').slice(0, 17) || 'initial'

    const result = await createSimplePayPalOrder({
      customId: invoicePaymentCustomId(invoice.id),
      reference: invoice.id,
      description: `Invoice ${invoice.invoice_number}`.slice(0, 127),
      amount: due,
      returnUrl,
      cancelUrl,
      currency: PAYPAL_DEFAULT_CURRENCY,
      brandName: 'The Anchor',
      requestId: `inv-pay-${invoice.id}-${generation}`,
    })

    // Conditional on the invoice still being unsettled, so a payment that
    // landed while PayPal was thinking cannot be overwritten with a live order.
    const { data: claimed, error: claimError } = await admin
      .from('invoices')
      .update({ paypal_order_id: result.orderId, updated_at: new Date().toISOString() })
      .eq('id', invoice.id)
      .eq('updated_at', invoice.updated_at)
      .eq('paid_amount', invoice.paid_amount)
      .eq('total_amount', invoice.total_amount)
      .not('status', 'in', '("void","written_off","paid")')
      .select('id')
      .maybeSingle()

    if (claimError || !claimed) {
      logger.error('[InvoicePayPal] Could not attach the order to the invoice', {
        error: claimError instanceof Error ? claimError : new Error(String(claimError)),
        metadata: { invoiceId: invoice.id, orderId: result.orderId },
      })
      return { error: 'This invoice changed while the link was being created. Reload and try again.' }
    }

    return result
  } catch (error) {
    logger.error('[InvoicePayPal] Failed to create a PayPal order', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { invoiceId: invoice.id },
    })
    return { error: 'PayPal would not create a payment for this invoice. Try again shortly.' }
  }
}

/* ------------------------------------------------------------------ *
 * Staff facing
 * ------------------------------------------------------------------ */

/**
 * The copyable link. Returns the portal URL, never a raw PayPal URL: PayPal
 * approval links expire in hours, and a staff member pasting one into WhatsApp
 * has no idea it has gone stale. The portal page mints a fresh one on demand.
 */
export async function getInvoicePortalLink(
  invoiceId: string,
): Promise<{ url?: string; invoiceNumber?: string; error?: string }> {
  try {
    if (!(await checkUserPermission('invoices', 'view'))) {
      return { error: 'You do not have permission to view invoices' }
    }

    const invoice = await loadInvoice(invoiceId)
    const unpayable = await describeUnpayable(invoice)
    if (unpayable) return { error: unpayable }

    return { url: portalUrl(generateInvoiceToken(invoiceId)), invoiceNumber: invoice!.invoice_number }
  } catch (error) {
    logger.error('[InvoicePayPal] Failed to build the portal link', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { invoiceId },
    })
    return { error: getErrorMessage(error) }
  }
}

/**
 * Email the customer a payment link.
 *
 * Sends two routes on purpose, as the deposit email does: a PayPal link they
 * can press now, and the portal link that still works after the PayPal one
 * expires.
 */
export async function sendInvoicePaymentLink(
  invoiceId: string,
): Promise<{ success?: boolean; sentTo?: string; error?: string }> {
  try {
    if (!(await checkUserPermission('invoices', 'edit'))) {
      return { error: 'You do not have permission to send invoices' }
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const invoice = await loadInvoice(invoiceId)
    const unpayable = await describeUnpayable(invoice)
    if (unpayable) return { error: unpayable }

    const admin = createAdminClient()
    const recipients = await resolveVendorInvoiceRecipients(
      admin,
      invoice!.vendor_id,
      invoice!.vendor?.email,
    )

    if ('error' in recipients) return { error: recipients.error }
    if (!recipients.to) {
      return { error: 'This customer has no email address on their billing record.' }
    }

    const token = generateInvoiceToken(invoiceId)
    const url = portalUrl(token)

    const order = await ensurePayPalOrder(invoice!, `${url}?payment_pending=1`, url)
    if ('error' in order) return { error: order.error }

    // Unlike a receipt, this email IS the payment request, so a failure has to
    // reach the operator rather than being logged and forgotten.
    const delivery = await sendInvoicePaymentLinkEmail({
      to: recipients.to,
      cc: recipients.cc,
      invoiceNumber: invoice!.invoice_number,
      customerName: invoice!.vendor?.name ?? null,
      amountDue: outstanding(invoice!),
      dueDate: invoice!.due_date,
      paypalApproveUrl: order.approveUrl,
      portalUrl: url,
    })

    await logAuditEvent({
      user_id: user?.id,
      operation_type: 'send',
      resource_type: 'invoice',
      resource_id: invoiceId,
      operation_status: delivery.success ? 'success' : 'failure',
      new_values: {
        action: 'paypal_payment_link_sent',
        invoice_number: invoice!.invoice_number,
        amount_due: outstanding(invoice!),
        recipient: recipients.to,
        email_error: delivery.error ?? null,
      },
    })

    revalidatePath(`/invoices/${invoiceId}`)

    if (!delivery.success) {
      // The order is left in place deliberately: it is still payable from the
      // portal link, so a failed email does not strand the customer.
      return { error: delivery.error ?? 'The email could not be sent.' }
    }

    return { success: true, sentTo: recipients.to }
  } catch (error) {
    logger.error('[InvoicePayPal] Failed to send the payment link', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { invoiceId },
    })
    return { error: getErrorMessage(error) }
  }
}

/* ------------------------------------------------------------------ *
 * Customer facing, authorised by the signed token
 * ------------------------------------------------------------------ */

/**
 * Mint a fresh PayPal link from the portal page.
 *
 * Deliberately triggered by a button press rather than on page load: email
 * scanners open links, and creating a payment order because a spam filter
 * looked at the message is not something to do by accident.
 */
export async function createInvoicePaymentOrderByToken(
  token: string,
): Promise<{ approveUrl?: string; error?: string }> {
  try {
    const invoiceId = verifyInvoiceToken(token)
    if (!invoiceId) return { error: 'This payment link has expired. Ask us for a new one.' }

    const invoice = await loadInvoice(invoiceId)
    const unpayable = await describeUnpayable(invoice)
    if (unpayable) return { error: unpayable }

    const url = portalUrl(token)
    const order = await ensurePayPalOrder(invoice!, `${url}?payment_pending=1`, url)
    if ('error' in order) return { error: order.error }

    await createAdminClient()
      .from('audit_logs')
      .insert({
        operation_type: 'paypal_order_created',
        resource_type: 'invoice',
        resource_id: invoiceId,
        operation_status: 'success',
        additional_info: {
          action: 'invoice_paypal_order_created_via_portal',
          invoice_number: invoice!.invoice_number,
          amount_due: outstanding(invoice!),
          order_id: order.orderId,
        },
      })

    return { approveUrl: order.approveUrl }
  } catch (error) {
    logger.error('[InvoicePayPal] Portal order creation failed', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return { error: getErrorMessage(error) }
  }
}

/**
 * Capture on the customer's return from PayPal.
 *
 * The amount is re-read from PayPal and checked against what is actually
 * outstanding before any money moves, so a link that went stale between
 * creation and approval cannot take the wrong sum.
 */
export async function captureInvoicePaymentByToken(
  token: string,
  paypalOrderId: string,
): Promise<{ success?: boolean; alreadyRecorded?: boolean; error?: string }> {
  try {
    const invoiceId = verifyInvoiceToken(token)
    if (!invoiceId) return { error: 'This payment link has expired. Ask us for a new one.' }

    const invoice = await loadInvoice(invoiceId)
    if (!invoice) return { error: 'That invoice could not be found.' }

    return await settleInvoicePayPalOrder(invoice, paypalOrderId, 'portal')

  } catch (error) {
    logger.error('[InvoicePayPal] Portal capture failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { paypalOrderId },
    })
    return { error: 'We could not confirm that payment. Please contact us before paying again.' }
  }
}
