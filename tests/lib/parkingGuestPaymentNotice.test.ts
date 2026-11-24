import { describe, expect, it } from 'vitest'
import { buildParkingBalanceNotice, buildParkingPaymentNotice, canRetryParkingPayment } from '@/app/parking/guest/[id]/paymentNotice'
import type { ParkingBooking } from '@/types/parking'

const booking = {
  id: 'booking-1',
  reference: 'PAR-1',
  status: 'pending_payment',
  payment_status: 'pending',
  calculated_price: 20,
  override_price: null,
  payment_due_at: '2026-07-01T12:00:00.000Z',
} as ParkingBooking

describe('parking guest payment notice', () => {
  it('shows explicit errors for failed return query states', () => {
    expect(buildParkingPaymentNotice('pending', 'missing_parameters')).toMatchObject({
      tone: 'error',
      title: 'Payment could not be checked',
    })
    expect(buildParkingPaymentNotice('pending', 'not_found')).toMatchObject({
      tone: 'error',
      title: 'Payment could not be matched',
    })
  })

  it('does not describe pending payment as confirmed', () => {
    expect(buildParkingPaymentNotice('pending')).toMatchObject({
      tone: 'warning',
      title: 'Payment needed',
    })
  })

  it('allows retry only for active pending or failed payment bookings before the due date', () => {
    const now = new Date('2026-06-30T12:00:00.000Z')

    expect(canRetryParkingPayment(booking, now)).toBe(true)
    expect(canRetryParkingPayment({ ...booking, payment_status: 'failed' }, now)).toBe(true)
    expect(canRetryParkingPayment({ ...booking, status: 'confirmed' }, now)).toBe(false)
    expect(canRetryParkingPayment({ ...booking, payment_due_at: '2026-06-29T12:00:00.000Z' }, now)).toBe(false)
  })
})

describe('buildParkingBalanceNotice (a confirmed booking owing extra)', () => {
  it('shows what is still to pay, ahead of the plain "Payment received"', () => {
    const notice = buildParkingBalanceNotice(30)
    expect(notice).toMatchObject({ tone: 'warning', title: '£30.00 still to pay' })
    expect(notice?.message).toContain('£30.00')
  })

  it('shows nothing when nothing is owed', () => {
    expect(buildParkingBalanceNotice(0)).toBeNull()
    expect(buildParkingBalanceNotice(-5)).toBeNull()
  })

  it('explains a retired link and still names what is owed now', () => {
    const notice = buildParkingBalanceNotice(15, 'amount_changed')
    expect(notice?.title).toBe('The amount has changed')
    expect(notice?.message).toContain('£15.00 still to pay')
  })
})
