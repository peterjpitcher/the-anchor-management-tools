import 'server-only'

import { generateInvoiceToken } from './invoice-token'

/**
 * The "pay online" block appended to invoice emails.
 *
 * SERVER ONLY. It mints a signed token, so it must never be pulled into a
 * client bundle. That is why it does not live in `email-drafts.ts`, which the
 * email dialog imports in the browser: the draft the operator edits is composed
 * client-side, and this is appended afterwards, on the server, at send time.
 *
 * Only the portal link goes in, never a PayPal approve URL. PayPal approval
 * links stop working a few hours after they are made, and an invoice email can
 * sit unread for days, so baking one in would hand most customers a dead
 * button. The portal page mints a fresh PayPal order when they press Pay.
 *
 * Bodies are sent as plain text, so this is plain text.
 */

/** Statuses where there is genuinely nothing to collect. */
const UNCOLLECTABLE = new Set(['void', 'written_off', 'paid'])

export type PaymentLinkInvoice = {
  id: string
  status?: string | null
  total_amount?: number | string | null
  paid_amount?: number | string | null
}

export function invoiceHasBalanceToCollect(invoice: PaymentLinkInvoice): boolean {
  if (UNCOLLECTABLE.has(String(invoice.status ?? ''))) return false
  const total = Number(invoice.total_amount ?? 0) || 0
  const paid = Math.max(0, Number(invoice.paid_amount ?? 0) || 0)
  return Math.round((total - paid) * 100) / 100 > 0
}

export function invoicePortalUrl(invoiceId: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://management.orangejelly.co.uk'
  return `${appUrl}/invoice-portal/${generateInvoiceToken(invoiceId)}`
}

/**
 * Returns the block to append, or '' when the invoice has nothing outstanding.
 *
 * A `draft` invoice is included on purpose: every caller appends this to the
 * email that is issuing or chasing the invoice, and the status flip to `sent`
 * happens either side of the send. Excluding drafts would silently drop the
 * link from the 07:00 auto-send, which is the very run that issues most of them.
 */
export function buildInvoicePaymentLinkFooter(invoice: PaymentLinkInvoice): string {
  if (!invoiceHasBalanceToCollect(invoice)) return ''

  return `

Prefer to pay online? You can pay by card or PayPal here:
${invoicePortalUrl(invoice.id)}

Bank transfer is still fine if you'd rather - just reply and I'll send the details.`
}

/** Appends the block to a body, leaving the body alone when there is nothing to collect. */
export function withInvoicePaymentLink(body: string, invoice: PaymentLinkInvoice): string {
  const footer = buildInvoicePaymentLinkFooter(invoice)
  return footer ? `${body}${footer}` : body
}
