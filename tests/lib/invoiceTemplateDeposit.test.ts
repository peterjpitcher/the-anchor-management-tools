import { describe, expect, it } from 'vitest'

/**
 * Cover for the two things a private-booking invoice has to get right about money
 * the customer has already handed over.
 *
 * 1. A part-paid invoice must ask for the balance, not the whole total again. These
 *    invoices are frequently born with payments already attached, so the plain
 *    invoice view (not just the receipt) has to be able to show a balance.
 * 2. A deposit is not an invoice line and is not a discount. Held separately it is
 *    refundable and belongs to nobody's total; deducted it is already counted once
 *    as a payment. Either way, letting the deposit figure leak into the totals block
 *    either double-counts it or under-bills the customer, and the mistake only
 *    surfaces when someone pays the wrong amount.
 */

import { generateCompactInvoiceHTML } from '@/lib/invoice-template-compact'
import type { InvoiceWithDetails } from '@/types/invoices'

// Deliberately non-colliding figures: subtotal 950, VAT 190, total 1140, deposit 250.
// No two of them share a formatted string, so an assertion that the deposit is absent
// from the totals cannot pass by accident.
const SUBTOTAL = 950
const VAT = 190
const TOTAL = 1140
const DEPOSIT = 250

function makeInvoice(overrides: Partial<InvoiceWithDetails> = {}): InvoiceWithDetails {
  return {
    id: 'inv-test-1',
    invoice_number: 'INV-TEST-0001',
    vendor_id: 'vendor-test-1',
    invoice_date: '2026-08-01',
    due_date: '2026-08-31',
    reference: 'PB-TEST-1',
    status: 'sent',
    invoice_discount_percentage: 0,
    subtotal_amount: SUBTOTAL,
    discount_amount: 0,
    vat_amount: VAT,
    total_amount: TOTAL,
    paid_amount: 0,
    created_at: '2026-08-01T09:00:00.000Z',
    updated_at: '2026-08-01T09:00:00.000Z',
    vendor: {
      id: 'vendor-test-1',
      // Fake name carrying characters that must be escaped, so a dropped escapeHtml
      // call fails here rather than shipping broken markup to a customer.
      name: 'Test Customer & Co <Ltd>',
      contact_name: 'Test Booker',
      email: 'test.customer@example.com',
      phone: '01784 000000',
      address: '1 Test Lane\nStanwell Moor\nTW19 6AQ',
      payment_terms: 30,
      is_active: true,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    line_items: [
      {
        id: 'li-test-1',
        invoice_id: 'inv-test-1',
        description: 'Private booking room hire',
        quantity: 1,
        unit_price: SUBTOTAL,
        discount_percentage: 0,
        vat_rate: 20,
        subtotal_amount: SUBTOTAL,
        discount_amount: 0,
        vat_amount: VAT,
        total_amount: TOTAL,
        created_at: '2026-08-01T09:00:00.000Z',
      },
    ],
    payments: [],
    ...overrides,
  }
}

/**
 * Pull out the totals block by matching div depth from the opening tag.
 * Searching the whole document would prove nothing: the deposit panel is also in
 * the page, so only an exact slice of the summary can show the figure is absent
 * from the totals.
 */
function extractSummarySection(html: string): string {
  const openTag = '<div class="summary-section">'
  const start = html.indexOf(openTag)
  expect(start).toBeGreaterThan(-1)

  let depth = 0
  let cursor = start
  const tagPattern = /<div\b|<\/div>/g
  tagPattern.lastIndex = start

  let match = tagPattern.exec(html)
  while (match) {
    depth += match[0] === '</div>' ? -1 : 1
    if (depth === 0) {
      cursor = match.index + match[0].length
      break
    }
    match = tagPattern.exec(html)
  }

  expect(depth).toBe(0)
  return html.slice(start, cursor)
}

describe('generateCompactInvoiceHTML totals block', () => {
  it('shows only a Total Due row when nothing has been paid', () => {
    const html = generateCompactInvoiceHTML({ invoice: makeInvoice({ paid_amount: 0 }) })
    const summary = extractSummarySection(html)

    expect(summary).toMatch(/Total Due<\/span>\s*<span>£1140\.00<\/span>/)
    expect(summary).not.toContain('Invoice Total')
    expect(summary).not.toContain('Payments Received')
    expect(summary).not.toContain('Balance Due')
  })

  it('shows total, payments and balance when part of the invoice is already paid', () => {
    const html = generateCompactInvoiceHTML({
      invoice: makeInvoice({ paid_amount: 250, status: 'partially_paid' }),
    })
    const summary = extractSummarySection(html)

    expect(summary).toMatch(/Invoice Total<\/span>\s*<span>£1140\.00<\/span>/)
    expect(summary).toMatch(/Payments Received<\/span>\s*<span>-£250\.00<\/span>/)
    expect(summary).toMatch(/Balance Due<\/span>\s*<span>£890\.00<\/span>/)
    // Asking for the full total again is the failure this branch exists to stop.
    expect(summary).not.toContain('Total Due')
  })

  it('never asks for a negative balance when the invoice is overpaid', () => {
    const html = generateCompactInvoiceHTML({
      invoice: makeInvoice({ paid_amount: 1200, status: 'paid' }),
    })
    const summary = extractSummarySection(html)

    expect(summary).toMatch(/Balance Due<\/span>\s*<span>£0\.00<\/span>/)
    expect(summary).not.toContain('-£60.00')
  })
})

describe('generateCompactInvoiceHTML deposit notice', () => {
  it('says a separately held deposit is refundable and not part of the amount due', () => {
    const html = generateCompactInvoiceHTML({
      invoice: makeInvoice(),
      deposit: { amount: DEPOSIT, paidOn: '2026-08-04', method: 'bank_transfer', treatment: 'held_separately' },
    })

    expect(html).toContain('Your Deposit')
    expect(html).toContain('Booking and damage deposit of £250.00')
    expect(html).toContain('held separately from the event price')
    expect(html).toContain('refunded within 48 hours after your event')
    expect(html).toContain('It is not part of the amount due above.')
    expect(html).not.toContain('applied to the invoice above')
  })

  it('says a deducted deposit has been applied to the invoice', () => {
    const html = generateCompactInvoiceHTML({
      invoice: makeInvoice({ paid_amount: DEPOSIT, status: 'partially_paid' }),
      deposit: { amount: DEPOSIT, paidOn: '2026-08-04', method: 'bank_transfer', treatment: 'deducted' },
    })

    expect(html).toContain('Your Deposit')
    expect(html).toContain('This has been applied to the invoice above and is included in the payments received.')
    expect(html).not.toContain('held separately from the event price')
  })

  it('renders the payment date when the deposit was paid on a known day', () => {
    const html = generateCompactInvoiceHTML({
      invoice: makeInvoice(),
      deposit: { amount: DEPOSIT, paidOn: '2026-08-04', method: 'bank_transfer', treatment: 'held_separately' },
    })

    expect(html).toContain('received on Tuesday, 4 August 2026')
  })

  it('omits the date entirely when paidOn is null, without leaking placeholder text', () => {
    const html = generateCompactInvoiceHTML({
      invoice: makeInvoice(),
      deposit: { amount: DEPOSIT, paidOn: null, method: 'bank_transfer', treatment: 'held_separately' },
    })

    expect(html).toContain('Booking and damage deposit of £250.00 by Bank Transfer.')
    expect(html).not.toContain('received on')
    // A customer-facing PDF that prints "null" or "Invalid Date" is worse than
    // printing nothing, so guard the rendered strings directly.
    expect(html).not.toContain('null')
    expect(html).not.toContain('Invalid Date')
    expect(html).not.toContain('To be confirmed')
  })

  it('renders the payment method, escaped, when one is known', () => {
    const html = generateCompactInvoiceHTML({
      invoice: makeInvoice(),
      deposit: { amount: DEPOSIT, paidOn: '2026-08-04', method: 'cash_&_cheque', treatment: 'held_separately' },
    })

    expect(html).toContain('by Cash &amp; Cheque.')
    expect(html).not.toContain('by Cash & Cheque.')
  })

  it('omits the method when none is recorded', () => {
    const html = generateCompactInvoiceHTML({
      invoice: makeInvoice(),
      deposit: { amount: DEPOSIT, paidOn: '2026-08-04', method: null, treatment: 'held_separately' },
    })

    expect(html).toContain('Booking and damage deposit of £250.00 received on Tuesday, 4 August 2026.')
    expect(html).not.toContain(' by ')
    expect(html).not.toContain('null')
  })

  it('renders no deposit panel when no deposit is passed', () => {
    const html = generateCompactInvoiceHTML({ invoice: makeInvoice() })

    expect(html).not.toContain('Your Deposit')
    expect(html).not.toContain('Booking and damage deposit')
  })

  it('renders no deposit panel for a zero deposit', () => {
    const html = generateCompactInvoiceHTML({
      invoice: makeInvoice(),
      deposit: { amount: 0, paidOn: '2026-08-04', method: 'bank_transfer', treatment: 'held_separately' },
    })

    expect(html).not.toContain('Your Deposit')
    expect(html).not.toContain('£0.00')
  })

  it('keeps the deposit figure out of the totals block', () => {
    // Nothing is paid here, so £250.00 has no legitimate reason to appear in the
    // summary. If it ever does, the deposit has been folded into a total and the
    // customer is being billed the wrong amount.
    const html = generateCompactInvoiceHTML({
      invoice: makeInvoice({ paid_amount: 0 }),
      deposit: { amount: DEPOSIT, paidOn: '2026-08-04', method: 'bank_transfer', treatment: 'held_separately' },
    })
    const summary = extractSummarySection(html)

    expect(html).toContain('Booking and damage deposit of £250.00')
    // Proves the slice really is just the totals block: if the helper ran past the
    // matching close tag, the assertions below would be testing the whole document.
    expect(summary).not.toContain('Your Deposit')
    expect(summary).not.toContain('Card Payments')
    expect(summary.length).toBeLessThan(html.length / 4)
    expect(summary).not.toContain('250')
    expect(summary).not.toContain('Deposit')
    expect(summary).toMatch(/Total Due<\/span>\s*<span>£1140\.00<\/span>/)
    expect(summary).toMatch(/Subtotal<\/span>\s*<span>£950\.00<\/span>/)
    expect(summary).toMatch(/VAT<\/span>\s*<span>£190\.00<\/span>/)
  })

  it('keeps a deducted deposit out of the totals beyond the single payments row', () => {
    // The deducted case is the dangerous one: the deposit is already counted as a
    // payment, so a second appearance in the totals would credit it twice.
    const html = generateCompactInvoiceHTML({
      invoice: makeInvoice({ paid_amount: DEPOSIT, status: 'partially_paid' }),
      deposit: { amount: DEPOSIT, paidOn: '2026-08-04', method: 'bank_transfer', treatment: 'deducted' },
    })
    const summary = extractSummarySection(html)

    expect(summary.match(/£250\.00/g)).toHaveLength(1)
    expect(summary).toMatch(/Balance Due<\/span>\s*<span>£890\.00<\/span>/)
  })
})

describe('generateCompactInvoiceHTML payment information', () => {
  it('offers card payment on request rather than claiming a surcharge', () => {
    const html = generateCompactInvoiceHTML({ invoice: makeInvoice() })

    // Consumer card surcharges are restricted in the UK, so the old wording was a
    // claim the business cannot make.
    expect(html).not.toContain('Subject to additional fees')
    expect(html).toContain('<strong>Card Payments:</strong> Available on request')
  })
})

describe('generateCompactInvoiceHTML receipt mode', () => {
  it('still shows an Outstanding Balance on a remittance advice', () => {
    const html = generateCompactInvoiceHTML({
      invoice: makeInvoice({ paid_amount: DEPOSIT, status: 'partially_paid' }),
      documentKind: 'remittance_advice',
    })
    const summary = extractSummarySection(html)

    expect(summary).toMatch(/Invoice Total<\/span>\s*<span>£1140\.00<\/span>/)
    expect(summary).toMatch(/Total Paid<\/span>\s*<span>£250\.00<\/span>/)
    expect(summary).toMatch(/Outstanding Balance<\/span>\s*<span>£890\.00<\/span>/)
    expect(summary).not.toContain('Balance Due')
    expect(summary).not.toContain('Payments Received')
  })

  it('still shows the deposit notice on a remittance advice without touching its totals', () => {
    const html = generateCompactInvoiceHTML({
      invoice: makeInvoice({ paid_amount: DEPOSIT, status: 'partially_paid' }),
      documentKind: 'remittance_advice',
      deposit: { amount: DEPOSIT, paidOn: '2026-08-04', method: 'bank_transfer', treatment: 'deducted' },
    })
    const summary = extractSummarySection(html)

    expect(html).toContain('Your Deposit')
    expect(summary.match(/£250\.00/g)).toHaveLength(1)
    expect(summary).toMatch(/Outstanding Balance<\/span>\s*<span>£890\.00<\/span>/)
  })
})
