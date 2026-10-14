import crypto from 'crypto'

/**
 * A fingerprint of what a quote says: its lines, its figures, its notes and its dates.
 *
 * A client accepts the quote they were shown. The total alone does not say whether it is still
 * that quote: a description or a note can change while the total stays the same. This is taken
 * when the quote is sent for acceptance and again when the acceptance arrives, and the quote is
 * only marked accepted if the two match.
 *
 * Pure, and free of the quote template, so the completion hook can use it without loading the
 * PDF code.
 */
export interface QuoteContentForFingerprint {
  quote_number?: string | null
  quote_date?: string | null
  valid_until?: string | null
  reference?: string | null
  notes?: string | null
  vendor_id?: string | null
  quote_discount_percentage?: number | string | null
  subtotal_amount?: number | string | null
  discount_amount?: number | string | null
  vat_amount?: number | string | null
  total_amount?: number | string | null
  line_items?: Array<{
    description?: string | null
    quantity?: number | string | null
    unit_price?: number | string | null
    discount_percentage?: number | string | null
    vat_rate?: number | string | null
    total_amount?: number | string | null
  }> | null
}

/**
 * The database hands numbers back as numbers or as strings ("1200.00"); both mean one amount.
 * An empty amount is nought: the quote screens read it that way, and a quote read through them
 * must fingerprint the same as the row read straight from the table.
 */
function amount(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return (0).toFixed(4)
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toFixed(4) : String(value)
}

const text = (value: string | null | undefined): string => (value ?? '').trim()

export function quoteContentFingerprint(quote: QuoteContentForFingerprint): string {
  const lines = (quote.line_items ?? [])
    .map((line) => [
      text(line.description),
      amount(line.quantity),
      amount(line.unit_price),
      amount(line.discount_percentage),
      amount(line.vat_rate),
      amount(line.total_amount),
    ])
    // The database returns lines in no promised order. Their order is not part of the quote.
    .map((line) => JSON.stringify(line))
    .sort()
  const canonical = JSON.stringify({
    number: text(quote.quote_number),
    date: text(quote.quote_date).slice(0, 10),
    validUntil: text(quote.valid_until).slice(0, 10),
    reference: text(quote.reference),
    notes: text(quote.notes),
    vendor: text(quote.vendor_id),
    discountPercentage: amount(quote.quote_discount_percentage),
    subtotal: amount(quote.subtotal_amount),
    discount: amount(quote.discount_amount),
    vat: amount(quote.vat_amount),
    total: amount(quote.total_amount),
    lines,
  })
  return crypto.createHash('sha256').update(canonical, 'utf-8').digest('hex')
}
