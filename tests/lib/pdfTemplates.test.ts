import { describe, expect, it } from 'vitest'

/**
 * Characterisation cover for the invoice and quote PDF templates, which had none.
 *
 * These two files produce documents that go to customers, and they share about a
 * hundred lines of identical CSS. Shared markup that is copied rather than imported
 * drifts: a change to the brand styling lands on invoices and quietly misses quotes.
 * Before extracting that CSS, these snapshots pin the rendered output so the
 * extraction can be proved to change nothing at all.
 *
 * They keep earning their place afterwards, because nothing else exercises these
 * templates and a broken invoice PDF is only noticed by the person receiving it.
 */

import { generateCompactInvoiceHTML } from '@/lib/invoice-template-compact'
import { generateCompactQuoteHTML } from '@/lib/quote-template-compact'

const VENDOR = {
  id: 'vendor-1',
  // Every free-text field carries characters that must be escaped, so reverting any
  // single escapeHtml call fails a test rather than passing on bland fixture data.
  name: 'Acme & Sons <Supplies> Ltd',
  contact_name: "Dana O'Fox",
  email: 'dana@acme.example',
  phone: '01784 123456',
  address: '1 High Street\nStanwell Moor\nTW19 6AQ',
  vat_number: 'GB123<456>789',
}

const LINE_ITEMS = [
  { id: 'li-1', description: 'Beer & wine <house>', quantity: 3, unit_price: 25.5, discount_percentage: 10, vat_rate: 20 },
  { id: 'li-2', description: "Bar snacks, O'Brien's", quantity: 1, unit_price: 40, discount_percentage: 0, vat_rate: 20 },
]

const INVOICE: any = {
  id: 'inv-1',
  invoice_number: 'INV-2026-0001',
  invoice_date: '2026-08-01',
  due_date: '2026-08-31',
  reference: 'PO-4417 <urgent> & rush',
  status: 'sent',
  subtotal_amount: 108.85,
  discount_amount: 7.65,
  vat_amount: 21.77,
  total_amount: 130.62,
  paid_amount: 0,
  invoice_discount_percentage: 0,
  notes: "Thanks for your custom & O'Brien's <regards>",
  vendor: VENDOR,
  line_items: LINE_ITEMS,
  payments: [],
}

const QUOTE: any = {
  id: 'q-1',
  quote_number: 'QT-2026-0001',
  quote_date: '2026-08-01',
  valid_until: '2026-09-01',
  reference: 'Enquiry 88 <urgent> & rush',
  status: 'sent',
  subtotal_amount: 108.85,
  discount_amount: 7.65,
  vat_amount: 21.77,
  total_amount: 130.62,
  quote_discount_percentage: 0,
  notes: "Valid 30 days & O'Brien's <regards>",
  vendor: VENDOR,
  line_items: LINE_ITEMS,
}

describe('invoice PDF template', () => {
  it('renders a stable document', () => {
    expect(generateCompactInvoiceHTML({ invoice: INVOICE })).toMatchSnapshot()
  })

  it('renders a credit note variant', () => {
    // Not cast to any: CreditNoteDetails is camelCase, and a cast here would have
    // hidden a wrong fixture behind a runtime crash rather than a type error.
    expect(
      generateCompactInvoiceHTML({
        invoice: INVOICE,
        documentKind: 'credit_note',
        creditNote: {
          creditNoteNumber: 'CN-2026-0001',
          amountExVat: 100,
          vatRate: 20,
          amountIncVat: 120,
          reason: 'Goods returned',
        },
      })
    ).toMatchSnapshot()
  })

  it('escapes customer-supplied text rather than emitting raw markup', () => {
    const html = generateCompactInvoiceHTML({ invoice: INVOICE })

    expect(html).toContain('&lt;house&gt;')
    expect(html).not.toContain('<house>')
  })
})

describe('quote PDF template', () => {
  it('renders a stable document', () => {
    expect(generateCompactQuoteHTML({ quote: QUOTE })).toMatchSnapshot()
  })

  it('escapes customer-supplied text rather than emitting raw markup', () => {
    const html = generateCompactQuoteHTML({ quote: QUOTE })

    expect(html).toContain('&lt;house&gt;')
    expect(html).not.toContain('<house>')
  })
})

describe('the two templates agree on shared styling', () => {
  const invoice = generateCompactInvoiceHTML({ invoice: INVOICE })
  const quote = generateCompactQuoteHTML({ quote: QUOTE })

  const styleOf = (html: string) => html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? ''
  const rulesOf = (css: string) =>
    new Map(
      [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selector, body]) => [
        selector.trim().replace(/\s+/g, ' '),
        body.trim().replace(/\s+/g, ' '),
      ])
    )

  /**
   * `.logo` already differs and is left alone deliberately: the invoice caps the logo
   * at 90px and the quote at 150px, so the same logo prints two thirds larger on a
   * quote. That is drift of exactly the kind this test exists to catch, but picking a
   * winner changes how customer documents look, so it wants a decision rather than a
   * quiet edit. Everything else must agree.
   */
  const KNOWN_DIVERGENT = ['.logo']

  it('renders the same declarations for every selector both documents use', () => {
    const invoiceRules = rulesOf(styleOf(invoice))
    const quoteRules = rulesOf(styleOf(quote))

    const shared = [...invoiceRules.keys()].filter((selector) => quoteRules.has(selector))
    expect(shared.length).toBeGreaterThan(10)

    // Where both documents style the same thing, they must style it identically.
    // This is the drift the shared stylesheet exists to prevent.
    const divergent = shared
      .filter((selector) => invoiceRules.get(selector) !== quoteRules.get(selector))
      .filter((selector) => !KNOWN_DIVERGENT.includes(selector))
    expect(divergent).toEqual([])
  })

  it('still reports the known logo divergence, so it cannot be forgotten', () => {
    const invoiceRules = rulesOf(styleOf(invoice))
    const quoteRules = rulesOf(styleOf(quote))

    expect(invoiceRules.get('.logo')).toContain('max-width: 90px')
    expect(quoteRules.get('.logo')).toContain('max-width: 150px')
  })
})
