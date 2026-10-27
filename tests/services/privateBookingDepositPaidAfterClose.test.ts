import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

/**
 * BK-063 (customer bookings review, 24 October 2026): PayPal can take a deposit for a private
 * booking that has been cancelled, when the guest still had the checkout or the emailed link open,
 * or when the hold-expiry job cancelled it as they paid. finalizeDepositPayment used to throw, so
 * the money sat in PayPal with nothing on the booking, nobody was told, and the webhook answered
 * 500 so PayPal retried for days. It is now recorded on the booking for refunding and a manager
 * is told, once.
 */

type Row = Record<string, unknown>

const state = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.client }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => state.client }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/google-calendar', () => ({
  syncCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  isCalendarConfigured: vi.fn(() => false),
}))
vi.mock('@/lib/money-alerts', () => ({
  alertMoneyNeedsAPerson: vi.fn(async () => ({ sent: true, duplicate: false })),
  formatPounds: (amount: number) => `£${amount.toFixed(2)}`,
}))
vi.mock('@/lib/private-bookings/messenger', () => ({
  sendPrivateBookingMessage: vi.fn(async () => ({ success: true, sent: true })),
}))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))

import { alertMoneyNeedsAPerson } from '@/lib/money-alerts'
import { sendPrivateBookingMessage } from '@/lib/private-bookings/messenger'
import { finalizeDepositPayment, recordDeposit } from '@/services/private-bookings/payments'

const BOOKING = '44444444-4444-4444-8444-444444444444'

let db: FakeDb

function bookingRow(extra: Row = {}): Row {
  return {
    id: BOOKING,
    status: 'cancelled',
    cancelled_at: '2026-10-20T09:00:00.000Z',
    customer_first_name: 'Sam',
    customer_name: 'Sam Example',
    contact_email: 'sam@example.com',
    event_date: '2026-12-05',
    deposit_amount: 250,
    deposit_paid_date: null,
    deposit_payment_method: null,
    paypal_deposit_capture_id: null,
    paypal_deposit_order_id: 'ORDER-1',
    hold_expiry: '2026-10-19T23:59:59.000Z',
    ...extra,
  }
}

function seed(extra: Row = {}) {
  db = createFakeDb({
    private_bookings: [bookingRow(extra)],
    private_bookings_with_details: [{ id: BOOKING, calculated_total: 1000, gross_total: 1200 }],
    private_booking_audit: [],
  })
  state.client = db.client
}

describe('a PayPal deposit captured for a closed private booking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('records it on the booking for refunding and tells a manager, without throwing', async () => {
    seed()

    const result = await finalizeDepositPayment({
      bookingId: BOOKING,
      amount: 250,
      method: 'paypal',
      paypalCaptureId: 'CAPTURE-LATE',
    })

    expect(result).toEqual({ success: true, paidAfterClose: true })
    const [booking] = db.rows('private_bookings')
    expect(booking.status).toBe('cancelled')
    expect(booking.paypal_deposit_capture_id).toBe('CAPTURE-LATE')
    expect(booking.deposit_payment_method).toBe('paypal')
    expect(booking.deposit_paid_date).toEqual(expect.any(String))
    // The hold and the cancellation are left exactly as they were.
    expect(booking.hold_expiry).toBe('2026-10-19T23:59:59.000Z')
    expect(booking.cancelled_at).toBe('2026-10-20T09:00:00.000Z')

    expect(alertMoneyNeedsAPerson).toHaveBeenCalledTimes(1)
    expect(alertMoneyNeedsAPerson).toHaveBeenCalledWith(
      db.client,
      expect.objectContaining({
        domain: 'private_bookings',
        bookingId: BOOKING,
        kind: 'deposit_paid_after_close',
        onceKey: 'money-alert:private_bookings:deposit_paid_after_close:CAPTURE-LATE',
        title: 'A private hire deposit of £250.00 was paid after the booking was cancelled',
      }),
    )
    expect(db.rows('private_booking_audit')).toEqual([
      expect.objectContaining({ booking_id: BOOKING, action: 'deposit_paid_after_close' }),
    ])
    // Nothing reaches the guest: the booking is cancelled.
    expect(sendPrivateBookingMessage).not.toHaveBeenCalled()
  })

  it('treats the same capture arriving again as already recorded, with no second alert', async () => {
    seed({ deposit_paid_date: '2026-10-20T10:00:00.000Z', deposit_payment_method: 'paypal', paypal_deposit_capture_id: 'CAPTURE-LATE' })

    const result = await finalizeDepositPayment({ bookingId: BOOKING, amount: 250, method: 'paypal', paypalCaptureId: 'CAPTURE-LATE' })

    expect(result).toEqual({ success: true, alreadyRecorded: true, paidAfterClose: true })
    expect(alertMoneyNeedsAPerson).not.toHaveBeenCalled()
  })

  it('does not write a second capture over a deposit the booking already holds, and says so', async () => {
    seed({ deposit_paid_date: '2026-10-01T10:00:00.000Z', deposit_payment_method: 'cash' })

    const result = await finalizeDepositPayment({ bookingId: BOOKING, amount: 250, method: 'paypal', paypalCaptureId: 'CAPTURE-SECOND' })

    expect(result).toEqual({ success: true, paidAfterClose: true, alreadyRecorded: true })
    expect(db.rows('private_bookings')[0].deposit_payment_method).toBe('cash')
    expect(db.rows('private_bookings')[0].paypal_deposit_capture_id).toBeNull()
    expect(alertMoneyNeedsAPerson).toHaveBeenCalledWith(
      db.client,
      expect.objectContaining({ summary: expect.stringContaining('may be a second payment') }),
    )
  })

  it('still refuses a deposit recorded by hand on a cancelled booking', async () => {
    seed()

    await expect(recordDeposit(BOOKING, 250, 'cash', 'user-1')).rejects.toThrow(
      'Cannot record a deposit on a cancelled or completed booking',
    )
    expect(db.rows('private_bookings')[0].deposit_paid_date).toBeNull()
    expect(alertMoneyNeedsAPerson).not.toHaveBeenCalled()
  })
})
