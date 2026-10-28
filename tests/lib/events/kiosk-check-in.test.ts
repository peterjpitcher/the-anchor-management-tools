import { describe, expect, it } from 'vitest'
import { kioskAmountDue, kioskGreetingName, kioskPaymentDue, kioskPaymentDueMessage, kioskWalkInBlock } from '@/lib/events/kiosk-check-in'

const required = [{ id: '33333333-3333-4333-8333-333333333333', label: 'Any allergies?', type: 'text', required: true }]

describe('kiosk rules (BK-032, BK-202, owner decision D12)', () => {
  it('greets by first name and initial only', () => {
    expect(kioskGreetingName('Sam', 'Lee')).toBe('Sam L.')
    expect(kioskGreetingName('Sam', null)).toBe('Sam')
    expect(kioskGreetingName(null, null)).toBe('there')
  })
  it('holds check-in only for an unpaid booking on a night paid in advance', () => {
    expect(kioskPaymentDue({ payment_mode: 'prepaid' }, { status: 'pending_payment' })).toBe(true)
    expect(kioskPaymentDue({ payment_mode: 'prepaid' }, { status: 'confirmed' })).toBe(false)
    expect(kioskPaymentDue({ payment_mode: 'cash_only' }, { status: 'pending_payment' })).toBe(false)
  })
  it('says what is due, and still reads without an amount', () => {
    expect(kioskPaymentDueMessage(80)).toBe("Payment due: £80.00. Please see the bar and we'll check you in.")
    expect(kioskPaymentDueMessage(null)).not.toMatch(/NaN|undefined|£0/)
    expect(kioskAmountDue([{ quantity: 2, unit_price: '12.50' }])).toBe(25)
    expect(kioskAmountDue([])).toBeNull()
  })
  it('books walk-ins only on nights that neither take payment in advance nor ask required questions', () => {
    expect(kioskWalkInBlock({ payment_mode: 'prepaid' })).toContain('paid for in advance')
    expect(kioskWalkInBlock({ payment_mode: 'cash_only', collect_guest_details: true, booking_questions: required })).toContain('few details')
    expect(kioskWalkInBlock({ payment_mode: 'cash_only', collect_guest_details: false, booking_questions: required })).toBeNull()
    expect(kioskWalkInBlock({ payment_mode: 'free' })).toBeNull()
  })
})
