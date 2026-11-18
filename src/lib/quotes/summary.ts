import type { QuoteStatus } from '@/types/invoices'

/** The four figures at the top of the Quotes page. */
export type QuoteSummary = {
  total_pending: number
  total_expired: number
  total_accepted: number
  draft_badge: number
}

/** The stored fields the summary reads from each quote row. */
export type QuoteSummaryRow = {
  status: QuoteStatus | string
  total_amount: number | string | null
  valid_until: string
}

export function moneyOrZero(value: number | string | null | undefined): number {
  const amount = Number(value ?? 0)
  return Number.isFinite(amount) ? amount : 0
}

export function emptyQuoteSummary(): QuoteSummary {
  return { total_pending: 0, total_expired: 0, total_accepted: 0, draft_badge: 0 }
}

/**
 * Totals the Quotes page summary from STORED rows, before any display mapping.
 *
 * A `sent` quote whose `valid_until` is before `today` (a London `YYYY-MM-DD`) counts as expired,
 * the same rule the list uses to show it as expired. A row stored as `expired` adds nothing, as
 * it never has: pass raw rows, not rows already relabelled for the list, or those lapsed quotes
 * and stored-expired quotes become indistinguishable.
 */
export function summariseQuotes(rows: readonly QuoteSummaryRow[], today: string): QuoteSummary {
  const summary = emptyQuoteSummary()
  for (const quote of rows) {
    if (quote.status === 'draft') {
      summary.draft_badge++
    } else if (quote.status === 'sent') {
      const amount = moneyOrZero(quote.total_amount)
      if (quote.valid_until < today) {
        summary.total_expired += amount
      } else {
        summary.total_pending += amount
      }
    } else if (quote.status === 'accepted') {
      summary.total_accepted += moneyOrZero(quote.total_amount)
    }
  }
  return summary
}

/** A sent quote past its validity date is shown as expired. */
export function displayQuoteStatus(status: QuoteStatus, validUntil: string, today: string): QuoteStatus {
  return status === 'sent' && validUntil < today ? 'expired' : status
}
