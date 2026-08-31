/**
 * Default subject and body for the invoice and quote email dialogs.
 *
 * Pure and kept out of the modals on purpose. Both dialogs are rendered with an
 * `isOpen` prop rather than mounted on demand, so a `useState` initialiser runs
 * exactly once and the draft text used to keep whatever the document totalled
 * when the page first loaded. Rebuilding INV-003WC from GBP 460.50 to GBP 500.00
 * on 2026-08-17 left the email body still offering the client the old figure,
 * with the new one on the attached PDF.
 *
 * Living here means the text can be tested against a changing document without
 * dragging in React or the Supabase browser client.
 */

import type { InvoiceWithDetails, QuoteWithDetails } from '@/types/invoices'

function greetingName(vendor: { contact_name?: string | null; name?: string | null } | null | undefined): string {
  return vendor?.contact_name || vendor?.name || 'there'
}

export function buildDefaultInvoiceEmailSubject(invoice: InvoiceWithDetails): string {
  return `Invoice ${invoice.invoice_number} from Orange Jelly Limited`
}

export function buildDefaultInvoiceEmailBody(invoice: InvoiceWithDetails): string {
  // An invoice can already be part-paid before it is emailed: a private booking
  // carries its deposit across as a payment, and any invoice can be chased after
  // a payment on account. Quoting total_amount then asks for money the customer
  // has already sent, which reads as though we lost it. Only the outstanding
  // figure is ever presented as what is owed.
  const total = Number(invoice.total_amount) || 0
  const paid = Math.max(0, Number(invoice.paid_amount) || 0)
  const outstanding = Math.max(0, total - paid)

  const amountLines = paid > 0
    ? `Invoice total: £${total.toFixed(2)}
Payments received: £${paid.toFixed(2)}
Balance due: £${outstanding.toFixed(2)}`
    : `Amount Due: £${total.toFixed(2)}`

  return `Hi ${greetingName(invoice.vendor)},

I hope you're doing well!

Please find attached invoice ${invoice.invoice_number} with the following details:

${amountLines}
Due Date: ${new Date(invoice.due_date).toLocaleDateString('en-GB')}

${invoice.notes ? `${invoice.notes}\n\n` : ''}If you have any questions or need anything at all, just let me know - I'm always happy to help!

Many thanks,
Peter Pitcher
Orange Jelly Limited
07990587315

P.S. The invoice is attached as a PDF for easy viewing and printing.`
}

export function buildDefaultQuoteEmailSubject(quote: QuoteWithDetails): string {
  return `Quote ${quote.quote_number} from Orange Jelly Limited`
}

export function buildDefaultQuoteEmailBody(quote: QuoteWithDetails): string {
  return `Hi ${greetingName(quote.vendor)},

Thanks for getting in touch!

I've attached quote ${quote.quote_number} for your review:

Total Amount: £${quote.total_amount.toFixed(2)}
Quote Valid Until: ${new Date(quote.valid_until).toLocaleDateString('en-GB')}

${quote.notes ? `${quote.notes}\n\n` : ''}Please take your time to review everything, and don't hesitate to reach out if you have any questions or would like to discuss anything.

Looking forward to hearing from you!

Best wishes,
Peter Pitcher
Orange Jelly Limited
07990587315

P.S. The quote is attached as a PDF for your convenience.`
}
