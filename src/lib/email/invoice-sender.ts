/**
 * Who an invoice, receipt or quote comes from.
 *
 * THE OWNER DECIDED THIS ON 28 AUGUST 2026, recorded at
 * `src/app/actions/privateBookingInvoice.ts:489`: every invoice goes out from Orange Jelly
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
