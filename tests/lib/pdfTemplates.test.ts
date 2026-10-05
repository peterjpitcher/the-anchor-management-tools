import { afterEach, describe, expect, it, vi } from 'vitest'

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
import { generateStatementHTML } from '@/lib/oj-statement'
import { LOGO_MAX_WIDTH_PX } from '@/lib/pdf/document-chrome'
import { buildStatementAgeing } from '@/lib/oj-projects/statement-ageing'
import { renderMileageReportHtml } from '@/lib/mileage/report/template'
import { buildMileageReport } from '@/lib/mileage/report/model'
import { parseMileageReportDataset } from '@/lib/mileage/report/dataset'
import { quarterPeriod } from '@/lib/mileage/periods'
import { buildDatasetJson } from '../fixtures/mileage/reportDataset'

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
  it('preserves original charges and itemises issued credits in the remaining balance', () => {
    const html = generateCompactInvoiceHTML({ invoice: { ...INVOICE, paid_amount: 20, credits: [{ status: 'issued', amount_inc_vat: 30 }] } })
    expect(html).toContain('Credits Applied')
    expect(html).toContain('£130.62')
    expect(html).toContain('£80.62')
  })

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

describe('long notes on invoices and quotes', () => {
  // Notes that could never split left most of the first page empty and, once they filled a
  // page, pushed the footer onto a page of its own.
  const LONG_NOTES = Array.from({ length: 40 }, (_, i) => `Work item ${i + 1} & <detail>`).join('\n')

  it('lets them run onto the next page instead of keeping the box whole', () => {
    for (const html of [
      generateCompactInvoiceHTML({ invoice: { ...INVOICE, notes: LONG_NOTES } }),
      generateCompactQuoteHTML({ quote: { ...QUOTE, notes: LONG_NOTES } }),
    ]) {
      expect(html).toContain('<div class="notes-section notes-section-long">')
      expect(html).not.toContain('notes-section keep-together')
    }
  })

  it('still keeps short notes in one piece', () => {
    for (const html of [generateCompactInvoiceHTML({ invoice: INVOICE }), generateCompactQuoteHTML({ quote: QUOTE })]) {
      expect(html).toContain('<div class="notes-section keep-together">')
    }
  })

  it('never leaves fewer than six note lines on either side of the break', () => {
    const css = generateCompactInvoiceHTML({ invoice: INVOICE }).match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? ''
    const rule = css.match(/\.notes-section-long p \{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toContain('orphans: 6;')
    expect(rule).toContain('widows: 6;')
  })
})

/**
 * Every customer financial document must join this registry and render its
 * chrome through `@/lib/pdf/document-chrome`. Comparing declarations catches
 * drift after the fact; the registry is what makes a new document opt IN rather
 * than silently sit outside the check.
 */
const STATEMENT: any = {
  vendorName: "Acme & Sons <Supplies> Ltd",
  periodFrom: '2026-06-01',
  periodTo: '2026-08-31',
  openingBalance: 500,
  transactions: [
    { date: '2026-06-10', description: 'Invoice INV-2026-0001 & <co>', reference: 'INV-2026-0001', debit: 250.5, credit: null, balance: 750.5 },
    { date: '2026-07-02', description: "Payment received, O'Brien's", reference: 'INV-2026-0001', debit: null, credit: 120.25, balance: 630.25 },
  ],
  closingBalance: 630.25,
}

const DOCUMENTS = [
  { name: 'invoice', html: generateCompactInvoiceHTML({ invoice: INVOICE }) },
  { name: 'quote', html: generateCompactQuoteHTML({ quote: QUOTE }) },
  { name: 'statement', html: generateStatementHTML(STATEMENT) },
  {
    name: 'mileage report',
    html: renderMileageReportHtml(
      buildMileageReport(parseMileageReportDataset(buildDatasetJson()), { period: quarterPeriod(2026, 2), driverId: null })
    ),
  },
]

describe('the registered document templates agree on shared styling', () => {
  const styleOf = (html: string) => html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? ''
  const rulesOf = (css: string) =>
    new Map(
      [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selector, body]) => [
        selector.trim().replace(/\s+/g, ' '),
        body.trim().replace(/\s+/g, ' '),
      ])
    )

  const ruleSets = DOCUMENTS.map((doc) => ({ name: doc.name, rules: rulesOf(styleOf(doc.html)) }))

  it('renders the same declarations for every selector any two documents share', () => {
    const divergent: string[] = []

    for (let i = 0; i < ruleSets.length; i++) {
      for (let j = i + 1; j < ruleSets.length; j++) {
        const a = ruleSets[i]
        const b = ruleSets[j]
        for (const [selector, declarations] of a.rules) {
          if (!b.rules.has(selector)) continue
          if (b.rules.get(selector) !== declarations) {
            divergent.push(`${selector} differs between ${a.name} and ${b.name}`)
          }
        }
      }
    }

    // No exception list on purpose. The shared chrome is now the single source
    // for these rules, so any divergence means a template stopped using it.
    expect(divergent).toEqual([])
  })

  it('caps the logo at the same size on every document', () => {
    for (const { name, rules } of ruleSets) {
      expect(rules.get('.logo'), name).toContain(`max-width: ${LOGO_MAX_WIDTH_PX}px`)
    }
  })

  it('gives every document the shared legal footer', () => {
    for (const doc of DOCUMENTS) {
      expect(doc.html, doc.name).toContain('Company Reg:')
      expect(doc.html, doc.name).toContain('VAT:')
      // "Phone", never "Mobile": the number comes from the environment and in production it
      // is a landline. See the block at the foot of this file.
      expect(doc.html, doc.name).toContain('Phone: 07990587315')
      expect(doc.html, doc.name).not.toContain('Mobile:')
    }
  })

  it('declares a language and a title on every document', () => {
    for (const doc of DOCUMENTS) {
      expect(doc.html, doc.name).toContain('<html lang="en">')
      expect(doc.html, doc.name).toMatch(/<title>.+<\/title>/)
    }
  })
})

describe('statement template', () => {
  const html = generateStatementHTML(STATEMENT)

  it('escapes customer-supplied text rather than emitting raw markup', () => {
    expect(html).toContain('&lt;Supplies&gt;')
    expect(html).not.toContain('<Supplies>')
    expect(html).toContain('&amp;')
  })

  it('shows the client how to pay, quoting their name as the reference', () => {
    expect(html).toContain('How to Pay')
    expect(html).toContain('Sort Code:')
    expect(html).toContain('as the payment reference')
  })

  it('says nothing about unbilled work', () => {
    // A statement records what has been billed. The old template carried a note
    // about work in progress, which the owner removed from the contract.
    expect(html).not.toMatch(/unbilled/i)
    expect(html).not.toMatch(/work in progress/i)
  })

  it('closes the balance exactly once, so it cannot read as a page subtotal', () => {
    // The closing balance used to sit in a `tfoot`, which Chromium may repeat on
    // every page of a long statement.
    expect(html.match(/Closing Balance/g)).toHaveLength(1)
    expect(html).not.toContain('<tfoot>')
  })

  it('repeats the column header across pages and keeps rows whole', () => {
    const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? ''
    expect(css).toContain('display: table-header-group')
    expect(css).toContain('page-break-inside: avoid')
  })

  it('associates table headers with their columns', () => {
    expect(html).toContain('<th scope="col">Date</th>')
  })

  it('states an empty period rather than rendering a bare table', () => {
    const empty = generateStatementHTML({ ...STATEMENT, transactions: [] })
    expect(empty).toContain('No transactions in this period.')
  })

  it('marks a credit balance rather than printing it as a debt', () => {
    const credit = generateStatementHTML({ ...STATEMENT, closingBalance: -120.5 })
    expect(credit).toContain('£120.50 credit')
  })
})

describe('statement ageing strip', () => {
  const ageing = buildStatementAgeing(
    [
      { dueDate: '2026-08-08', remaining: 500 },
      { dueDate: '2026-07-08', remaining: 130.25 },
    ],
    '2026-08-31'
  )

  const html = generateStatementHTML({ ...STATEMENT, ageing, closingBalance: ageing.netTotal })

  it('labels the buckets as overdue, not as bare day counts', () => {
    // Bare "30 / 60 / 90" is the ambiguity that lets two readers disagree about
    // whether a figure means age or lateness.
    expect(html).toContain('Aged by days overdue')
    expect(html).toContain('Not yet due')
    expect(html).toContain('1 to 30 days')
    expect(html).toContain('Over 90 days')
  })

  it('states the as-at date, which is the period end rather than today', () => {
    expect(html).toContain('as at 31 Aug 2026')
  })

  it('prints the reconciliation so the reader can check it', () => {
    expect(html).toContain('equals the closing balance of')
    expect(html).not.toContain('do not agree')
  })

  it('warns on the document itself when the figures do not reconcile', () => {
    const broken = generateStatementHTML({ ...STATEMENT, ageing, closingBalance: 999 })
    expect(broken).toContain('do not agree, so please contact us before paying')
  })

  it('names the credit separately when the client has one', () => {
    const withCredit = buildStatementAgeing(
      [
        { dueDate: '2026-07-08', remaining: 500 },
        { dueDate: '2026-06-08', remaining: -75.25 },
      ],
      '2026-08-31'
    )
    const out = generateStatementHTML({
      ...STATEMENT,
      ageing: withCredit,
      closingBalance: withCredit.netTotal,
    })

    expect(out).toContain('less credit £75.25')
  })

  it('omits the strip entirely when no ageing is supplied', () => {
    expect(generateStatementHTML(STATEMENT)).not.toContain('Aged by days overdue')
  })
})

/**
 * Production holds the office landline in COMPANY_CONTACT_PHONE, written without spaces. Until
 * 5 October 2026 every invoice therefore printed "Mobile: 01753682707" directly above
 * "Office: 01753 682 707": one number twice, once under the wrong label. The fixtures above
 * run with the variable unset, so they never saw it.
 */
describe('the contact number, when it is the office number', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function renderAsProduction(): Promise<{ invoice: string; quote: string }> {
    vi.stubEnv('COMPANY_CONTACT_PHONE', '01753682707')
    vi.resetModules()
    const invoiceTemplate = await import('@/lib/invoice-template-compact')
    const quoteTemplate = await import('@/lib/quote-template-compact')
    return {
      invoice: invoiceTemplate.generateCompactInvoiceHTML({ invoice: INVOICE }),
      quote: quoteTemplate.generateCompactQuoteHTML({ quote: QUOTE }),
    }
  }

  it('prints it once in the invoice payment box, labelled Phone', async () => {
    const { invoice } = await renderAsProduction()
    expect(invoice).toContain([
      '          <p>For payment queries:</p>',
      '          <p>Contact: Peter Pitcher</p>',
      '          <p>Phone: 01753682707</p>',
      '          <p>Email: ',
    ].join('\n'))
    expect(invoice).not.toContain('Mobile:')
    expect(invoice).not.toContain('<p>Office:')
  })

  it('gives the quote one phone line, not two with the same number', async () => {
    const { quote } = await renderAsProduction()
    expect(quote).toContain('<p>• Call Peter Pitcher on 01753682707</p>')
    expect(quote).not.toContain('Call our office on')
    expect(quote).not.toContain('directly on')
  })

  it('leaves it off the last footer line, which follows the office number', async () => {
    const { invoice, quote } = await renderAsProduction()
    for (const html of [invoice, quote]) {
      expect(html).toContain('<p>Contact: Peter Pitcher</p>\n  </div>')
      expect(html).not.toContain('Mobile:')
    }
  })
})
