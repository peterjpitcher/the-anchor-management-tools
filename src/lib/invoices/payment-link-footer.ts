import 'server-only'

import { payOnlinePostscript } from './email-copy'
import { invoiceCanOfferPayPal, type PaymentLinkInvoice } from './email-drafts'
import { generateInvoiceToken } from './invoice-token'
import { getAppUrl } from '@/lib/env'

/**
 * The "pay online" P.S. appended to invoice emails.
 *
 * SERVER ONLY. It mints a signed token, so it must never be pulled into a
 * client bundle. That is why it does not live in `email-drafts.ts`, which the
 * email dialog imports in the browser: the draft the operator edits is composed
 * client-side, and this is appended afterwards, on the server, at send time.
 * The question "will this email get one?" needs no token, so that check does
 * live in `email-drafts.ts` and is re-exported here for the server callers.
 *
 * Only the portal link goes in, never a PayPal approve URL. PayPal approval
 * links stop working a few hours after they are made, and an invoice email can
 * sit unread for days, so baking one in would hand most customers a dead
 * button. The portal page mints a fresh PayPal order when they press Pay.
 *
 * Bodies are sent as plain text, so this is plain text.
 */

export { invoiceCanOfferPayPal, invoiceHasBalanceToCollect, type PaymentLinkInvoice } from './email-drafts'

export function invoicePortalUrl(invoiceId: string): string {
  return `${getAppUrl()}/invoice-portal/${generateInvoiceToken(invoiceId)}`
}

/**
 * Returns the block to append, or '' when the vendor or balance is ineligible.
 *
 * It is a P.S. after the sign-off, in the same voice as the email above it. It used to be
 * a separate block ending "Bank transfer is still fine if you'd rather - just reply and
 * I'll send the details", which was untrue: the bank details are printed on every invoice.
 *
 * A `draft` invoice is included on purpose: every caller appends this to the
 * email that is issuing or chasing the invoice, and the status flip to `sent`
 * happens either side of the send. Excluding drafts would silently drop the
 * link from the automatic runs, which issue most of them.
 */
export function buildInvoicePaymentLinkFooter(invoice: PaymentLinkInvoice): string {
  if (!invoiceCanOfferPayPal(invoice)) return ''

  return `\n\n${payOnlinePostscript(invoicePortalUrl(invoice.id))}`
}

/** Appends the P.S. to a body, leaving the body alone when there is nothing to collect. */
export function withInvoicePaymentLink(body: string, invoice: PaymentLinkInvoice): string {
  const footer = buildInvoicePaymentLinkFooter(invoice)
  return footer ? `${body}${footer}` : body
}
