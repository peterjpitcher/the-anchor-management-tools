import { describe, expect, it } from 'vitest'
import {
  buildDefaultInvoiceEmailBody,
  buildDefaultInvoiceEmailSubject,
  buildDefaultQuoteEmailBody,
  buildDefaultQuoteEmailSubject,
} from '@/lib/invoices/email-drafts'

/**
 * The live defect these guard against: the email dialogs built their draft text
 * with a `useState` initialiser, which runs once. Both modals are rendered with
 * an `isOpen` prop rather than mounted on demand, so the text kept whatever the
 * document totalled when the page first loaded.
 *
 * Rebuilding INV-003WC from GBP 460.50 to GBP 500.00 on 2026-08-17 left the
 * email body still offering the client GBP 460.50, with a GBP 500.00 PDF
 * attached. Caught before sending.
 *
 * The builders are now pure and exported, so the body can be asserted to follow
 * the current document rather than a captured one.
 */

const invoice = {
  id: 'inv-1',
  invoice_number: 'INV-003WC',
  total_amount: 460.5,
  due_date: '2026-07-08',
  notes: null,
  vendor: { id: 'v-1', name: 'Golden Barrels Limited', contact_name: null },
} as any

const quote = {
  id: 'q-1',
  quote_number: 'QTE-001',
  total_amount: 1200,
  valid_until: '2026-09-30',
  notes: null,
  vendor: { id: 'v-1', name: 'Golden Barrels Limited', contact_name: null },
} as any

describe('invoice email draft text', () => {
  it('quotes the amount it is given', () => {
    expect(buildDefaultInvoiceEmailBody(invoice)).toContain('Amount Due: £460.50')
  })

  it('follows the invoice when the total changes, rather than keeping the old figure', () => {
    const rebuilt = { ...invoice, total_amount: 500 }
    const body = buildDefaultInvoiceEmailBody(rebuilt)

    expect(body).toContain('Amount Due: £500.00')
    expect(body).not.toContain('460.50')
  })

  it('names the invoice in the subject', () => {
    expect(buildDefaultInvoiceEmailSubject(invoice)).toBe(
      'Invoice INV-003WC from Orange Jelly Limited'
    )
  })

  it('addresses the client by contact name when there is one', () => {
    const withContact = { ...invoice, vendor: { ...invoice.vendor, contact_name: 'Mihiir' } }
    expect(buildDefaultInvoiceEmailBody(withContact)).toContain('Hi Mihiir,')
  })
})

describe('quote email draft text', () => {
  it('follows the quote when the total changes', () => {
    const revised = { ...quote, total_amount: 1500 }
    const body = buildDefaultQuoteEmailBody(revised)

    expect(body).toContain('Total Amount: £1500.00')
    expect(body).not.toContain('1200.00')
  })

  it('names the quote in the subject', () => {
    expect(buildDefaultQuoteEmailSubject(quote)).toBe('Quote QTE-001 from Orange Jelly Limited')
  })
})
