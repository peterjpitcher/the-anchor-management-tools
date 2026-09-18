import { describe, expect, it } from 'vitest'
import { buildBookingReceipt, receiptDate, type BookingReceiptInput } from '@/lib/private-bookings/booking-receipt'
import { renderBookingReceiptHTML } from '@/lib/private-bookings/booking-receipt-pdf'

export function receiptFixture(): BookingReceiptInput {
  return { bookingId: 'booking', reference: 'booking', customer: 'Test customer', eventDate: '2026-09-18', generatedAt: '2026-09-18T12:00:00Z', invoices: [{ id: 'original', number: 'INV-1', date: '2026-09-17', status: 'paid', total: 120, paid: 120, discount: 0, rounding: 0, lines: [{ description: 'Venue hire', quantity: 1, net: 100, discount: 0, vat: 20, gross: 120 }] }], payments: [{ id: 'payment', date: '2026-09-18', amount: 120, method: 'bank_transfer', purpose: 'Invoice INV-1', reference: null, recordedDate: false }], refunds: [], credits: [], deposit: { received: 0, applied: 0, refunded: 0, held: 0 }, draftCount: 0, openDispute: false, unresolvedReasons: [] }
}
describe('consolidated booking receipt', () => {
  it('counts a split receipt once against two invoices', () => {
    const input = receiptFixture()
    input.invoices.push({ ...input.invoices[0], id: 'extra', number: 'INV-2' })
    input.payments[0].amount = 240
    const model = buildBookingReceipt(input)
    expect(model.kind).toBe('final_receipt')
    expect(model.totals.receipts).toBe(240)
    expect(model.payments).toHaveLength(1)
  })
  it('does not let one invoice overpayment settle another', () => {
    const input = receiptFixture()
    input.invoices[0].paid = 240
    input.invoices.push({ ...input.invoices[0], id: 'extra', number: 'INV-2', paid: 0 })
    input.payments[0].amount = 240
    const model = buildBookingReceipt(input)
    expect(model.kind).toBe('payment_statement')
    expect(model.totals.balanceDue).toBe(120)
    expect(model.totals.creditBalance).toBe(120)
  })
  it('counts deducted deposit once', () => {
    const input = receiptFixture()
    input.payments[0].amount = 100
    input.payments.push({ ...input.payments[0], id: 'deposit', amount: 20, purpose: 'Deposit', date: '2026-08-01' })
    input.deposit = { received: 20, applied: 20, refunded: 0, held: 0 }
    const model = buildBookingReceipt(input)
    expect(model.kind).toBe('final_receipt')
    expect(model.totals.receipts).toBe(120)
    expect(model.payments[0].id).toBe('deposit')
  })
  it('requires completed dated deposit refunds', () => {
    const input = receiptFixture()
    input.payments.push({ ...input.payments[0], id: 'deposit', amount: 20 })
    input.deposit = { received: 20, applied: 0, refunded: 0, held: 20 }
    expect(buildBookingReceipt(input).kind).toBe('payment_statement')
    input.refunds = [{ id: 'refund', sourceId: 'booking', amount: 20, status: 'pending', date: null, purpose: 'Deposit refund' }]
    expect(buildBookingReceipt(input).totals.refunds).toBe(0)
    input.refunds[0] = { ...input.refunds[0], status: 'completed', date: '2026-09-19' }
    input.deposit.refunded = 20; input.deposit.held = 0
    expect(buildBookingReceipt(input).kind).toBe('final_receipt')
    input.refunds[0].date = null
    expect(() => buildBookingReceipt(input)).toThrow('completion date')
  })
  it.each(['draft', 'dispute', 'written-off', 'unresolved'])('blocks a final label for %s', reason => {
    const input = receiptFixture()
    if (reason === 'draft') input.draftCount = 1
    if (reason === 'dispute') input.openDispute = true
    if (reason === 'written-off') input.invoices[0].status = 'written_off'
    if (reason === 'unresolved') input.unresolvedReasons = ['Unresolved retained deposit']
    expect(buildBookingReceipt(input).kind).toBe('payment_statement')
  })
  it('subtracts credits without claiming they are cash', () => {
    const input = receiptFixture()
    input.credits = [{ id: 'credit', number: 'CN-1', invoiceId: 'original', amount: 20, date: '2026-09-18', reason: 'Agreed reduction' }]
    input.invoices[0].paid = 100; input.payments[0].amount = 100
    const model = buildBookingReceipt(input)
    expect(model.kind).toBe('final_receipt')
    expect(model.totals.receipts).toBe(100)
  })
  it('rejects missing allocations, duplicate cash, invalid dates and penny mismatches', () => {
    const input = receiptFixture()
    input.payments[0].amount = 119.99
    expect(() => buildBookingReceipt(input)).toThrow('Payment history')
    input.payments[0].amount = 120; input.payments.push(input.payments[0])
    expect(() => buildBookingReceipt(input)).toThrow('more than once')
    input.payments.pop(); input.payments[0].date = 'invalid'
    expect(() => buildBookingReceipt(input)).toThrow('invalid date')
    input.payments[0].date = '2026-09-18'; input.invoices[0].lines[0].gross = 119.99
    expect(() => buildBookingReceipt(input)).toThrow('charge details')
  })
  it('uses London dates across midnight and preserves date-only records', () => {
    expect(receiptDate('2026-07-01T23:30:00Z')).toBe('2026-07-02')
    expect(receiptDate('2026-07-01')).toBe('2026-07-01')
  })
  it('escapes long descriptions and renders source dates without invalid placeholders', () => {
    const input = receiptFixture()
    input.invoices[0].lines[0].description = '<script>alert("x")</script> ' + 'A long charge description '.repeat(60)
    const html = renderBookingReceiptHTML(buildBookingReceipt(input), 3)
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('18 Sept 2026')
    expect(html).toContain('Version 3')
    expect(html).not.toMatch(/undefined|NaN|Invalid Date/)
  })
})
