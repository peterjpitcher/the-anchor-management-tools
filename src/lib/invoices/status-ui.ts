/**
 * How invoice and quote statuses look on staff screens: the DS Badge tone and the words.
 *
 * Before 18 September 2026 each screen had its own copy and they disagreed: /oj-projects
 * showed an overdue invoice in amber with the raw value "partially_paid", while /invoices
 * showed it in red as "Overdue". Render every status chip as
 *   <Badge tone={invoiceStatusTone(status)} dot>{invoiceStatusLabel(status)}</Badge>
 * so the same invoice looks the same everywhere.
 */

type StatusBadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

// Maps rather than object literals, so a status such as "constructor" can never
// resolve to an inherited Object property.
const INVOICE_STATUS_TONES = new Map<string, StatusBadgeTone>([
  ['draft', 'neutral'],
  ['sent', 'info'],
  ['partially_paid', 'warning'],
  ['part_paid', 'warning'],
  ['paid', 'success'],
  ['overdue', 'danger'],
  ['void', 'neutral'],
  ['cancelled', 'neutral'],
  ['written_off', 'neutral'],
  ['credited', 'primary'],
  ['credit_note', 'primary'],
])

const QUOTE_STATUS_TONES = new Map<string, StatusBadgeTone>([
  ['draft', 'neutral'],
  ['sent', 'info'],
  ['accepted', 'success'],
  ['rejected', 'danger'],
  ['expired', 'neutral'],
])

/**
 * Sentence case with spaces, the wording the invoice list has always shown ("Partially paid").
 * Tolerates a missing status from loosely typed rows rather than throwing mid-render.
 */
function statusWords(status: string): string {
  const words = String(status ?? '').replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function invoiceStatusTone(status: string): StatusBadgeTone {
  return INVOICE_STATUS_TONES.get(status) ?? 'neutral'
}

export function invoiceStatusLabel(status: string): string {
  return statusWords(status)
}

export function quoteStatusTone(status: string): StatusBadgeTone {
  return QUOTE_STATUS_TONES.get(status) ?? 'neutral'
}

export function quoteStatusLabel(status: string): string {
  return statusWords(status)
}
