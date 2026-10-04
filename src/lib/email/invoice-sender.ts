/**
 * Who an invoice, receipt or quote comes from.
 *
 * THE OWNER DECIDED THIS ON 28 AUGUST 2026, recorded in `deliverInvoice` in
 * `src/app/actions/privateBookingInvoice.ts`: every invoice goes out from Orange Jelly
 * Limited, the official business name, and nothing else. The venue is named in the body only
 * as a description of the booking, never as the sender.
 *
 * WHAT WAS ACTUALLY HAPPENING. `sendInvoiceEmail` and `sendQuoteEmail` in
 * `microsoft-graph.ts` call `sendEmail` with no provider and no from, so with Resend
 * configured they inherited `EMAIL_FROM_ADDRESS`, which is the venue's identity. All 80
 * invoices and receipts in the 120 days to 12 September 2026 went out as "The Anchor", each
 * one signed off as Orange Jelly Limited in the body. The body and the sender contradicted
 * each other on every single one.
 *
 * WHY THE FALLBACK ONLY CHANGES THE DISPLAY NAME. A Resend `from` has to be on a domain
 * verified with Resend. `EMAIL_FROM_ADDRESS` already is, so reusing its address with Orange
 * Jelly's name in front presents the right sender with no deliverability risk and without
 * this file inventing a mailbox that may not exist. Set `INVOICE_EMAIL_FROM_ADDRESS` to a
 * verified Orange Jelly address to use that instead.
 *
 * The Microsoft Graph path needs nothing here: `MICROSOFT_USER_EMAIL` is already the Orange
 * Jelly mailbox, and `sendEmail` uses it by default.
 */

import { COMPANY_DETAILS } from '@/lib/company-details'
import { invoiceEmailProvider } from '@/lib/invoices/release-switches'

function readTrimmed(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : undefined
}

/** The bare address out of `Name <addr@example.com>`, or the value itself when it is bare. */
function addressPart(sender: string): string {
  const angled = sender.match(/<([^<>]+)>/)
  return (angled?.[1] ?? sender).trim()
}

/**
 * The `from` an invoice, receipt or quote should carry.
 *
 * Returns undefined when nothing is configured, which leaves `sendEmail` on exactly the
 * behaviour it has today rather than failing a send over a display name.
 */
export function invoiceSenderIdentity(): string | undefined {
  const configured = readTrimmed('INVOICE_EMAIL_FROM_ADDRESS')
  if (configured) return configured

  const venueSender = readTrimmed('EMAIL_FROM_ADDRESS')
  if (!venueSender) return undefined

  return `${COMPANY_DETAILS.legalName} <${addressPart(venueSender)}>`
}

/**
 * Where a reply to an invoice should go.
 *
 * `EMAIL_REPLY_TO` is the venue manager's mailbox, which is the wrong desk for a question
 * about a VAT invoice. Falls back to the Graph mailbox, which is the Orange Jelly address
 * these documents have always been sent from, and then to undefined so `sendEmail` keeps its
 * current behaviour.
 */
export function invoiceReplyToAddress(): string | undefined {
  return readTrimmed('INVOICE_EMAIL_REPLY_TO') ?? readTrimmed('MICROSOFT_USER_EMAIL')
}

/**
 * The provider pin on its own, to spread into a `sendEmail` call.
 *
 * Every invoice email since 25 June 2026 has left from `noreply@auth.orangejelly.co.uk`
 * rather than the Orange Jelly mailbox: a side effect of the communications logging change,
 * not a decision. `INVOICE_EMAIL_PROVIDER=graph` puts them back on the mailbox, so they sit
 * in its Sent Items and a reply comes straight back.
 *
 * Returns an EMPTY object while the switch is off, never `{ provider: undefined }`, so a
 * send made with the switch unset is exactly the send it was before this existed.
 *
 * Use this alone only where the sender and reply-to are deliberately left as they are (the
 * client statement). Everything else wants `invoiceEmailRouting`.
 */
export function invoiceProviderPin(): { provider?: 'graph' } {
  const provider = invoiceEmailProvider()
  return provider ? { provider } : {}
}

/**
 * Who an invoice email is from, where a reply goes and which provider carries it: the three
 * things every invoice, chase and receipt must agree on. One helper so a new sender cannot
 * take the identity and forget the pin, which is how the mailbox was lost in June.
 *
 * `from` only matters on the Resend route. Microsoft Graph sends as the mailbox itself and
 * ignores it, so it is safe to pass on both.
 */
export function invoiceEmailRouting(): { from: string | undefined; replyTo: string | undefined; provider?: 'graph' } {
  return {
    from: invoiceSenderIdentity(),
    replyTo: invoiceReplyToAddress(),
    ...invoiceProviderPin(),
  }
}
