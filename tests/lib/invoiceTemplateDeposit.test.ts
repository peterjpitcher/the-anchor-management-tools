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

import { COMPANY_DETAILS } from '@/lib/company-details'
import { generateCompactInvoiceHTML } from '@/lib/invoice-template-compact'
import { invoiceCanOfferPayPal } from '@/lib/invoices/payment-link-footer'
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
      paypal_payments_enabled: false,
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
    expect(summary).not.toContain('Payment Information')
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

const PAY_ONLINE_LINE = '<p><strong>Pay online:</strong> use the link in your invoice email</p>'

/** A copy of the fixture's client with online payment switched on or off. */
function vendorWith(overrides: Partial<NonNullable<InvoiceWithDetails['vendor']>>): NonNullable<InvoiceWithDetails['vendor']> {
  return { ...makeInvoice().vendor!, ...overrides }
}

describe('generateCompactInvoiceHTML payment information', () => {
  it('makes no claim about card surcharges or card payment on request', () => {
    const html = generateCompactInvoiceHTML({ invoice: makeInvoice() })

    // Consumer card surcharges are restricted in the UK, so the old wording was a
    // claim the business cannot make.
    expect(html).not.toContain('Subject to additional fees')
    // "Available on request" promised something nobody had set up. A client either has
    // online payment, and is told how to use it, or the line is not there.
    expect(html).not.toContain('Card Payments')
    expect(html).not.toContain('Available on request')
  })

  it('tells a client with online payment to use the link in their email, while there is something to pay', () => {
    const unpaid = generateCompactInvoiceHTML({
      invoice: makeInvoice({ vendor: vendorWith({ paypal_payments_enabled: true }) }),
    })
    const partPaid = generateCompactInvoiceHTML({
      invoice: makeInvoice({ vendor: vendorWith({ paypal_payments_enabled: true }), paid_amount: DEPOSIT, status: 'partially_paid' }),
    })

    expect(unpaid).toContain(PAY_ONLINE_LINE)
    expect(partPaid).toContain(PAY_ONLINE_LINE)
    expect(unpaid).not.toContain('Card Payments')
  })

  it('prints no online payment line for a client without it', () => {
    const switchedOff = generateCompactInvoiceHTML({ invoice: makeInvoice({ vendor: vendorWith({ paypal_payments_enabled: false }) }) })
    const noClient = generateCompactInvoiceHTML({ invoice: makeInvoice({ vendor: undefined }) })

    expect(switchedOff).not.toContain('Pay online')
    expect(noClient).not.toContain('Pay online')
  })

  it('prints no line, rather than guessing, when the caller did not load the client setting', () => {
    // Some callers select a handful of client columns. A missing flag is not a yes.
    const { paypal_payments_enabled: _flag, ...vendorWithoutFlag } = vendorWith({})
    const html = generateCompactInvoiceHTML({
      invoice: makeInvoice({ vendor: vendorWithoutFlag as InvoiceWithDetails['vendor'] }),
    })

    expect(html).not.toContain('Pay online')
  })

  it('prints no online payment line once there is nothing left to pay', () => {
    const enabled = vendorWith({ paypal_payments_enabled: true })
    const paid = generateCompactInvoiceHTML({ invoice: makeInvoice({ vendor: enabled, paid_amount: TOTAL, status: 'paid' }) })
    const credited = generateCompactInvoiceHTML({
      invoice: makeInvoice({ vendor: enabled, credits: [{ status: 'issued', amount_inc_vat: TOTAL }] }),
    })
    const voided = generateCompactInvoiceHTML({ invoice: makeInvoice({ vendor: enabled, status: 'void' }) })
    const writtenOff = generateCompactInvoiceHTML({ invoice: makeInvoice({ vendor: enabled, status: 'written_off' }) })

    for (const html of [paid, credited, voided, writtenOff]) {
      expect(html).not.toContain('Pay online')
    }
  })

  it('prints no online payment line on a credit note or a receipt', () => {
    const invoice = makeInvoice({ vendor: vendorWith({ paypal_payments_enabled: true }), paid_amount: DEPOSIT, status: 'partially_paid' })
    const creditNote = generateCompactInvoiceHTML({
      invoice,
      documentKind: 'credit_note',
      creditNote: { creditNoteNumber: 'CN-TEST-0001', amountExVat: 100, vatRate: 20, amountIncVat: 120, reason: 'Test credit' },
    })
    const receipt = generateCompactInvoiceHTML({ invoice, documentKind: 'remittance_advice' })

    expect(creditNote).not.toContain('Pay online')
    expect(receipt).not.toContain('Pay online')
    // The receipt layout is untouched: it never had a payment information block.
    expect(receipt).not.toContain('Payment Information')
    expect(receipt).toContain('Receipt Details')
  })

  // The line says "use the link in your invoice email", so it must appear exactly when the
  // email carries that link. `invoiceCanOfferPayPal` is the rule the email uses; the template
  // restates it because that module is server-only. This holds the two in step.
  it('appears exactly when the invoice email carries a pay link', () => {
    const statuses: InvoiceWithDetails['status'][] = ['draft', 'sent', 'overdue', 'partially_paid', 'paid', 'void', 'written_off']
    const cases: InvoiceWithDetails[] = []
    for (const status of statuses) {
      for (const enabled of [true, false]) {
        for (const paid_amount of [0, DEPOSIT, TOTAL]) {
          for (const credits of [undefined, [{ status: 'issued', amount_inc_vat: TOTAL - DEPOSIT }], [{ status: 'void', amount_inc_vat: TOTAL }]]) {
            cases.push(makeInvoice({ status, paid_amount, credits, vendor: vendorWith({ paypal_payments_enabled: enabled }) }))
          }
        }
      }
    }

    expect(cases).toHaveLength(126)
    for (const invoice of cases) {
      const printed = generateCompactInvoiceHTML({ invoice }).includes(PAY_ONLINE_LINE)
      expect({ status: invoice.status, paid: invoice.paid_amount, credits: invoice.credits, printed })
        .toEqual({ status: invoice.status, paid: invoice.paid_amount, credits: invoice.credits, printed: invoiceCanOfferPayPal(invoice) })
    }
    // Both answers occur, so the loop above is not agreeing on a constant.
    expect(cases.some((invoice) => invoiceCanOfferPayPal(invoice))).toBe(true)
    expect(cases.some((invoice) => !invoiceCanOfferPayPal(invoice))).toBe(true)
  })

  it('leaves the bank details, and the contact lines beside them, exactly as they were', () => {
    const bankBlock = [
      '        <div class="payment-method">',
      '          <h4>Bank Transfer</h4>',
      `          <p><strong>Bank:</strong> ${COMPANY_DETAILS.bank.name}</p>`,
      `          <p><strong>Account Name:</strong> ${COMPANY_DETAILS.bank.accountName}</p>`,
      `          <p><strong>Sort Code:</strong> ${COMPANY_DETAILS.bank.sortCode}</p>`,
      `          <p><strong>Account: </strong> ${COMPANY_DETAILS.bank.accountNumber}</p>`,
      '          <p><strong>Reference:</strong> INV-TEST-0001</p>',
      '        </div>',
    ].join('\n')
    const contactLines = [
      '          <p>For payment queries or to arrange card payment:</p>',
      '          <p>Contact: ',
    ].join('\n')

    const withoutOnline = generateCompactInvoiceHTML({ invoice: makeInvoice() })
    const withOnline = generateCompactInvoiceHTML({ invoice: makeInvoice({ vendor: vendorWith({ paypal_payments_enabled: true }) }) })

    for (const html of [withoutOnline, withOnline]) {
      expect(html).toContain(bankBlock)
      expect(html).toContain(contactLines)
      expect(html).toContain(`<p>Office: ${COMPANY_DETAILS.phone}</p>`)
      expect(html).toContain(`<p>Email: ${COMPANY_DETAILS.email}</p>`)
      expect(html.match(/<h4>Bank Transfer<\/h4>/g)).toHaveLength(1)
    }
    // The fixture would pass with blank details, so pin that the real ones are there.
    for (const detail of Object.values(COMPANY_DETAILS.bank)) {
      expect(detail).not.toBe('')
    }
  })
})

/** The value printed in the Terms box of the invoice header. */
function termsOf(html: string): string {
  const match = /<span class="meta-label">Terms<\/span>\s*<span class="meta-value">([^<]*)<\/span>/.exec(html)
  expect(match).not.toBeNull()
  return match![1]
}

/** The value printed in the Due Date box beside it. */
function dueDateOf(html: string): string {
  const match = /<span class="meta-label">Due Date<\/span>\s*<span class="meta-value">([^<]*)<\/span>/.exec(html)
  expect(match).not.toBeNull()
  return match![1]
}

function termsFor(invoice_date: string, due_date: string, overrides: Partial<InvoiceWithDetails> = {}): string {
  return termsOf(generateCompactInvoiceHTML({ invoice: makeInvoice({ invoice_date, due_date, ...overrides }) }))
}

// These run under Europe/London (`npm test`) and under UTC (`npm run test:utc`). The terms are
// counted from the two date strings, so every figure below must be the same in both.
describe('generateCompactInvoiceHTML terms box', () => {
  it('says "Due on receipt" when the invoice is due the day it is dated', () => {
    expect(termsFor('2026-10-05', '2026-10-05')).toBe('Due on receipt')
  })

  it('counts the days between the invoice date and the due date', () => {
    expect(termsFor('2026-10-05', '2026-10-06')).toBe('1 day')
    expect(termsFor('2026-10-05', '2026-10-07')).toBe('2 days')
    expect(termsFor('2026-10-05', '2026-10-12')).toBe('7 days')
    expect(termsFor('2026-08-01', '2026-08-31')).toBe('30 days')
    expect(termsFor('2026-12-20', '2027-01-19')).toBe('30 days')
    expect(termsFor('2028-02-01', '2028-03-02')).toBe('30 days')
  })

  it('prints this invoice\'s own terms, not the standing terms on the client record', () => {
    // The fault this replaced: a client on 7 day terms, invoiced and due the same day, was
    // told "7 days" beside a due date of today.
    expect(termsFor('2026-10-05', '2026-10-05', { vendor: vendorWith({ payment_terms: 7 }) })).toBe('Due on receipt')
    expect(termsFor('2026-10-05', '2026-10-12', { vendor: vendorWith({ payment_terms: 30 }) })).toBe('7 days')
    // No standing terms used to print "30 days" whatever the dates said.
    expect(termsFor('2026-10-05', '2026-10-19', { vendor: vendorWith({ payment_terms: undefined }) })).toBe('14 days')
    expect(termsFor('2026-10-05', '2026-10-19', { vendor: undefined })).toBe('14 days')
  })

  it('counts calendar days across both clock changes', () => {
    // Sunday 25 October 2026 lasts 25 hours in London, Sunday 29 March 2026 only 23. Counting
    // elapsed hours in local time gets one of these wrong.
    expect(termsFor('2026-10-20', '2026-10-27')).toBe('7 days')
    expect(termsFor('2026-10-24', '2026-10-25')).toBe('1 day')
    expect(termsFor('2026-10-25', '2026-10-26')).toBe('1 day')
    expect(termsFor('2026-03-25', '2026-04-01')).toBe('7 days')
    expect(termsFor('2026-03-28', '2026-03-29')).toBe('1 day')
    expect(termsFor('2026-03-29', '2026-03-30')).toBe('1 day')
  })

  it('prints the plain due date when the due date is before the invoice date', () => {
    const html = generateCompactInvoiceHTML({ invoice: makeInvoice({ invoice_date: '2026-08-01', due_date: '2026-07-25' }) })

    expect(termsOf(html)).toBe(dueDateOf(html))
    expect(termsOf(html)).toContain('25 July 2026')
    expect(termsOf(html)).not.toMatch(/days?$/)
  })

  it('prints the plain due date when the invoice date is missing or is not a real date', () => {
    for (const invoice_date of ['', 'not-a-date', '2026-02-31']) {
      const html = generateCompactInvoiceHTML({ invoice: makeInvoice({ invoice_date, due_date: '2026-08-31' }) })
      expect(termsOf(html)).toContain('31 August 2026')
    }
  })

  it('prints a dash, never a guess or "Invalid Date", when there is no usable due date', () => {
    for (const due_date of ['', 'not-a-date']) {
      const html = generateCompactInvoiceHTML({ invoice: makeInvoice({ invoice_date: '2026-08-01', due_date }) })
      expect(termsOf(html)).toBe('-')
    }
  })

  it('is not printed on a receipt or a credit note, whose fourth box says something else', () => {
    const receipt = generateCompactInvoiceHTML({ invoice: makeInvoice(), documentKind: 'remittance_advice' })
    const creditNote = generateCompactInvoiceHTML({
      invoice: makeInvoice(),
      documentKind: 'credit_note',
      creditNote: { creditNoteNumber: 'CN-TEST-0001', amountExVat: 100, vatRate: 20, amountIncVat: 120, reason: 'Test credit' },
    })

    expect(receipt).not.toContain('<span class="meta-label">Terms</span>')
    expect(receipt).toContain('<span class="meta-label">Payment Ref</span>')
    expect(creditNote).not.toContain('<span class="meta-label">Terms</span>')
    expect(creditNote).toContain('<span class="meta-label">VAT Rate</span>')
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
