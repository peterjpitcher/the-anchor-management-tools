import { describe, it, expect, beforeEach } from 'vitest'
import {
  buildInvoicePaymentLinkFooter,
  invoiceHasBalanceToCollect,
  withInvoicePaymentLink,
} from '../payment-link-footer'
import { verifyInvoiceToken } from '../invoice-token'

const INVOICE_ID = '7f06990b-7636-4d72-b610-460168da18ec'

beforeEach(() => {
  process.env.PRIVATE_BOOKING_TOKEN_SECRET = 'test-secret'
  process.env.NEXT_PUBLIC_APP_URL = 'https://management.orangejelly.co.uk'
})

function invoice(overrides: Record<string, unknown> = {}) {
  return { id: INVOICE_ID, status: 'sent', total_amount: 975.6, paid_amount: 0, ...overrides }
}

describe('invoiceHasBalanceToCollect', () => {
  it.each(['void', 'written_off', 'paid'])('is false for a %s invoice', (status) => {
    expect(invoiceHasBalanceToCollect(invoice({ status }))).toBe(false)
  })

  it.each(['draft', 'sent', 'overdue', 'partially_paid'])('is true for a %s invoice with a balance', (status) => {
    expect(invoiceHasBalanceToCollect(invoice({ status }))).toBe(true)
  })

  it('is false once payments cover the total, whatever the status says', () => {
    expect(invoiceHasBalanceToCollect(invoice({ total_amount: 500, paid_amount: 500 }))).toBe(false)
  })

  it('handles the numeric strings Supabase returns for numeric columns', () => {
    expect(invoiceHasBalanceToCollect(invoice({ total_amount: '975.60', paid_amount: '250.00' }))).toBe(true)
    expect(invoiceHasBalanceToCollect(invoice({ total_amount: '250.00', paid_amount: '250.00' }))).toBe(false)
  })
})

describe('buildInvoicePaymentLinkFooter', () => {
  it('embeds a portal link that verifies back to this invoice', () => {
    const footer = buildInvoicePaymentLinkFooter(invoice())
    const url = footer.match(/https:\/\/\S+/)?.[0]
    expect(url).toBeDefined()

    const token = url!.split('/invoice-portal/')[1]
    expect(verifyInvoiceToken(token)).toBe(INVOICE_ID)
  })

  it('never embeds a raw PayPal URL, which would be dead within hours', () => {
    const footer = buildInvoicePaymentLinkFooter(invoice())
    // Naming PayPal in the copy is wanted, so the customer knows what to
    // expect. Linking to paypal.com is not: that URL expires long before the
    // email is read. Every link must point at our own portal.
    const urls = footer.match(/https?:\/\/\S+/g) ?? []
    expect(urls.length).toBeGreaterThan(0)
    for (const url of urls) {
      expect(url).not.toMatch(/paypal\.com/i)
      expect(url).toContain('/invoice-portal/')
    }
  })

  it('returns nothing when there is no balance to collect', () => {
    expect(buildInvoicePaymentLinkFooter(invoice({ status: 'paid' }))).toBe('')
    expect(buildInvoicePaymentLinkFooter(invoice({ status: 'void' }))).toBe('')
  })
})

describe('withInvoicePaymentLink', () => {
  it('appends to the body without disturbing what the operator wrote', () => {
    const body = 'Hi Kim,\n\nPlease find attached invoice INV-003WK.'
    const result = withInvoicePaymentLink(body, invoice())
    expect(result.startsWith(body)).toBe(true)
    expect(result).toContain('/invoice-portal/')
  })

  it('leaves the body exactly alone when nothing is owed', () => {
    const body = 'Hi Kim,\n\nThanks for your payment.'
    expect(withInvoicePaymentLink(body, invoice({ status: 'paid' }))).toBe(body)
  })
})
