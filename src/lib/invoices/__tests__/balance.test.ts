import { describe, expect, it } from 'vitest'
import { invoiceBalanceDue, invoiceIssuedCreditTotal } from '../balance'

const invoice = { total_amount: 120, paid_amount: 20, credits: [{ status: 'issued', amount_inc_vat: 30 }, { status: 'draft', amount_inc_vat: 15 }, { status: 'void', amount_inc_vat: 10 }] }
describe('issued invoice credit balances', () => {
  it('deducts only issued credit notes without altering original charges', () => {
    expect(invoiceBalanceDue(invoice)).toBe(70)
    expect(invoiceIssuedCreditTotal(invoice)).toBe(30)
    expect(invoice.total_amount).toBe(120)
  })
  it('keeps excess receipts as credit rather than a negative payment request', () => {
    expect(invoiceBalanceDue({ ...invoice, paid_amount: 110 })).toBe(0)
  })
  it('rejects invalid amounts instead of offering an incorrect payment link', () => {
    expect(() => invoiceBalanceDue({ total_amount: 'invalid' })).toThrow('invalid amount')
    expect(() => invoiceBalanceDue({ ...invoice, credits: [{ status: 'issued', amount_inc_vat: -5 }] })).toThrow('invalid amount')
  })
})
