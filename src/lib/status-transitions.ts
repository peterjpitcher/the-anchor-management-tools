import type { InvoiceStatus, QuoteStatus } from '@/types/invoices'

const ALLOWED_INVOICE_STATUS_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  draft: ['draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void', 'written_off'],
  sent: ['sent', 'partially_paid', 'paid', 'overdue', 'void', 'written_off'],
  partially_paid: ['partially_paid', 'paid', 'overdue', 'void', 'written_off'],
  overdue: ['overdue', 'sent', 'partially_paid', 'paid', 'void', 'written_off'],
  paid: ['paid'],
  void: ['void'],
  written_off: ['written_off'],
}

const ALLOWED_QUOTE_STATUS_TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
  draft: ['draft', 'sent', 'accepted', 'rejected', 'expired'],
  sent: ['sent', 'accepted', 'rejected', 'expired'],
  accepted: ['accepted'],
  rejected: ['rejected'],
  expired: ['expired', 'sent', 'accepted', 'rejected'],
}

export function isInvoiceStatusTransitionAllowed(
  fromStatus: InvoiceStatus,
  toStatus: InvoiceStatus
): boolean {
  const allowed = ALLOWED_INVOICE_STATUS_TRANSITIONS[fromStatus]
  return Array.isArray(allowed) && allowed.includes(toStatus)
}

export function isQuoteStatusTransitionAllowed(fromStatus: QuoteStatus, toStatus: QuoteStatus): boolean {
  const allowed = ALLOWED_QUOTE_STATUS_TRANSITIONS[fromStatus]
  return Array.isArray(allowed) && allowed.includes(toStatus)
}
