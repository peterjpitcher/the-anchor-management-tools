import { invoiceBalanceDue, invoiceIssuedCreditTotal, type InvoiceBalanceInput } from '@/lib/invoices/balance'
import {
  buildChaseEmail,
  buildInvoiceEmail,
  buildPrivateHireInvoiceEmail,
  firstNameFrom,
  type InvoiceEmailDraft,
} from '@/lib/invoices/email-copy'
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
 *
 * The invoice and chase wording itself lives in `email-copy.ts`. This file only
 * turns an invoice record into the figures that wording needs, so the dialog in
 * the browser and the send on the server cannot work the balance out two ways.
 */

import type { InvoiceWithDetails, QuoteWithDetails } from '@/types/invoices'

// Quote emails only, left as it was. Invoice and chase emails never fall back to the company
// name: they greet a first name resolved on the server, or "Hi there".
function greetingName(vendor: { contact_name?: string | null; name?: string | null } | null | undefined): string {
  return vendor?.contact_name || vendor?.name || 'there'
}

/** Statuses where there is genuinely nothing to collect. */
const UNCOLLECTABLE = new Set(['void', 'written_off', 'paid'])

export type PaymentLinkInvoice = InvoiceBalanceInput & {
  id: string
  status?: string | null
  total_amount?: number | string | null
  paid_amount?: number | string | null
  vendor?: { paypal_payments_enabled?: boolean | null } | null
}

export function invoiceHasBalanceToCollect(invoice: PaymentLinkInvoice): boolean {
  if (UNCOLLECTABLE.has(String(invoice.status ?? ''))) return false
  return invoiceBalanceDue(invoice) > 0
}

/**
 * Whether an email about this invoice will carry the pay online P.S.
 *
 * Lives here, not in `payment-link-footer.ts`, because the send dialogs ask the same
 * question in the browser to tell staff the P.S. is coming, and that file is server only
 * (it signs the link token). The server appends the link using this same answer, so what
 * the dialog promises and what the customer receives cannot drift apart.
 */
export function invoiceCanOfferPayPal(invoice: PaymentLinkInvoice): boolean {
  return invoice.vendor?.paypal_payments_enabled === true
    && invoiceHasBalanceToCollect(invoice)
}

/** Shown under the message box in the send dialogs when `invoiceCanOfferPayPal` is true. */
export const PAY_ONLINE_POSTSCRIPT_NOTE = 'A pay online link will be added as a P.S.'

/**
 * The invoice email as it stands before anyone edits it.
 *
 * `firstName` comes from `resolveInvoiceGreetingName` on the server. It is a person's first
 * name or nothing, never the company name: with nothing, the email opens "Hi there".
 *
 * An invoice can already be part-paid before it is emailed: a private booking
 * carries its deposit across as a payment, and any invoice can be chased after
 * a payment on account. Quoting total_amount then asks for money the customer
 * has already sent, which reads as though we lost it. Only the outstanding
 * figure is ever presented as what is owed.
 */
export function buildDefaultInvoiceEmailDraft(
  invoice: InvoiceWithDetails,
  firstName?: string | null,
  /**
   * Set when the invoice belongs to a private booking. A private hire customer has only ever
   * dealt with The Anchor, so a resend from the invoice page uses the private hire wording,
   * which names the booking. The deposit line is left out: this dialog does not know how the
   * deposit was treated, and it must never guess.
   */
  privateHire?: { eventDate: string | null } | null,
): InvoiceEmailDraft {
  if (privateHire) {
    return buildPrivateHireInvoiceEmail({
      firstName,
      invoiceNumber: invoice.invoice_number,
      eventDate: privateHire.eventDate,
      reference: invoice.reference,
      dueDate: invoice.due_date,
      total: Number(invoice.total_amount) || 0,
      paid: Math.max(0, Number(invoice.paid_amount) || 0),
      credits: invoiceIssuedCreditTotal(invoice),
      balance: invoiceBalanceDue(invoice),
    })
  }

  return buildInvoiceEmail({
    firstName,
    invoiceNumber: invoice.invoice_number,
    reference: invoice.reference,
    dueDate: invoice.due_date,
    total: Number(invoice.total_amount) || 0,
    paid: Math.max(0, Number(invoice.paid_amount) || 0),
    credits: invoiceIssuedCreditTotal(invoice),
    balance: invoiceBalanceDue(invoice),
  })
}

export function buildDefaultInvoiceEmailSubject(invoice: InvoiceWithDetails): string {
  return buildDefaultInvoiceEmailDraft(invoice).subject
}

export function buildDefaultInvoiceEmailBody(invoice: InvoiceWithDetails, firstName?: string | null): string {
  return buildDefaultInvoiceEmailDraft(invoice, firstName).body
}

/**
 * Whole days between the due date and today, both as calendar dates (YYYY-MM-DD).
 *
 * Counted between two dates, never two instants. The chase dialog used to subtract
 * `new Date(due_date)` from `new Date()` in the browser, so the count depended on the time
 * of day and the laptop's time zone, and could disagree with the figure the server then
 * checked. Pass `getTodayIsoDate()` for today, which is the London date on both sides.
 * Returns 0 for a date that cannot be read rather than printing "NaN days overdue".
 */
export function invoiceDaysOverdue(dueDate: string | null | undefined, todayIso: string): number {
  const dueMs = Date.parse(`${String(dueDate ?? '').slice(0, 10)}T00:00:00.000Z`)
  const todayMs = Date.parse(`${String(todayIso ?? '').slice(0, 10)}T00:00:00.000Z`)
  if (Number.isNaN(dueMs) || Number.isNaN(todayMs)) return 0
  return Math.floor((todayMs - dueMs) / (1000 * 60 * 60 * 24))
}

export interface ChaseEmailDraftContext {
  /** From `resolveInvoiceGreetingName`. Nothing means "Hi there". */
  firstName?: string | null
  /** Today's London date, from `getTodayIsoDate()`. */
  todayIso: string
  /**
   * The event date of the private booking this invoice belongs to, when it belongs to one.
   * A private hire customer has only ever dealt with The Anchor, so the chase names their
   * booking: without it the email is a demand from a company they have never heard of.
   */
  bookingEventDate?: string | null
}

/** The chase email as it stands before the owner edits it. */
export function buildDefaultChaseEmailDraft(
  invoice: InvoiceWithDetails,
  context: ChaseEmailDraftContext,
): InvoiceEmailDraft {
  return buildChaseEmail({
    firstName: context.firstName,
    invoiceNumber: invoice.invoice_number,
    balance: invoiceBalanceDue(invoice),
    credits: invoiceIssuedCreditTotal(invoice),
    dueDate: invoice.due_date,
    daysOverdue: invoiceDaysOverdue(invoice.due_date, context.todayIso),
    bookingAtTheAnchorOn: context.bookingEventDate,
  })
}

/** The fields on a private booking that can name its customer. */
export interface BookingGreetingSource {
  customer_first_name?: string | null
  customer_full_name?: string | null
  /** Deprecated on the booking, but still the only name on some older ones. */
  customer_name?: string | null
  /**
   * The linked guest record. PostgREST hands an embedded row back as an object or as a
   * one-element array depending on how it reads the relationship, so both are accepted.
   */
  customer?: { first_name?: string | null } | Array<{ first_name?: string | null }> | null
}

/**
 * The first name to greet a private hire customer by, or null for "Hi there".
 *
 * The booking's own first name where it holds one, then the linked guest record's, used as
 * they are stored. A first name is only cut out of a full name when that is all there is.
 * One function for the booking invoice, the additional invoice and the booking receipt, so
 * the same customer is not "Hi Sam" on one and "Hello" on the next.
 */
export function bookingGreetingName(booking: BookingGreetingSource | null | undefined): string | null {
  if (!booking) return null
  const guestRecord = Array.isArray(booking.customer) ? booking.customer[0] : booking.customer
  return (booking.customer_first_name || '').trim()
    || (guestRecord?.first_name || '').trim()
    || firstNameFrom(booking.customer_full_name)
    || firstNameFrom(booking.customer_name)
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
