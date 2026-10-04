/**
 * How to read a row of `email_messages` that is saved against an invoice.
 *
 * PURE: no database, no clock. The reminder job uses it to decide whether a client has been
 * emailed recently, and the invoice page uses it to decide what to show as email history, so
 * the two can never disagree about what counts as an email to the customer.
 */

interface InvoiceEmailRecord {
  subject?: string | null
  status?: string | null
  metadata?: unknown
}

/** `metadata` as a plain object, whatever was stored. Never throws. */
export function emailMetadata(row: Pick<InvoiceEmailRecord, 'metadata'>): Record<string, unknown> {
  const value = row.metadata
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/**
 * True for the owner alerts the old reminder job saved against the invoice as if they were
 * customer emails.
 *
 * Recognised by HOW they were saved, never by who they went to: the old job sent them through
 * the invoice sender with a subject in square brackets ("[First Reminder] Invoice ...") and an
 * invoice number rewritten to start "REMINDER:". A genuine invoice email to the Orange Jelly
 * mailbox has neither, so it still counts and still shows.
 */
export function isInternalInvoiceAlert(row: InvoiceEmailRecord): boolean {
  const subject = String(row.subject ?? '').trimStart()
  const invoiceNumber = emailMetadata(row).invoice_number
  return subject.startsWith('[') && typeof invoiceNumber === 'string' && invoiceNumber.startsWith('REMINDER:')
}

/** Statuses that mean the email never left, or came straight back. */
const NOT_ACCEPTED_STATUSES = new Set(['failed', 'bounced', 'suppressed'])

/**
 * True when the row is an email to the customer that was accepted for sending. Failed, bounced
 * and suppressed rows do not count, and nor do the old internal alerts: none of those is
 * something the customer received from us.
 */
export function countsAsCustomerInvoiceEmail(row: InvoiceEmailRecord): boolean {
  const status = String(row.status ?? '').toLowerCase()
  if (NOT_ACCEPTED_STATUSES.has(status)) return false
  return !isInternalInvoiceAlert(row)
}
