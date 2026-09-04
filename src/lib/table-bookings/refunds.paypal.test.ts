import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * CANCELLING A BOOKING MUST RETURN THE GUEST'S DEPOSIT, WHOEVER TOOK IT.
 *
 * Deposits moved from Stripe to PayPal. PayPal writes nothing to `payments`: the capture is
 * recorded on the booking as `paypal_deposit_capture_id` + `deposit_amount_locked`. This
 * function only ever read the Stripe ledger, so from that day it returned `no_deposit` for
 * every real deposit, the money stayed with the venue, and because `no_deposit` is also what
 * a deposit-free booking returns, the cancellation text said nothing about it at all.
 *
 * The last Stripe deposit was 2026-03-14. Everything since has been PayPal.
 */

const refundPayPalPayment = vi.fn()
const logAuditEvent = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/paypal', () => ({
  PAYPAL_DEFAULT_CURRENCY: 'GBP',
  refundPayPalPayment: (...args: unknown[]) => refundPayPalPayment(...args),
}))
vi.mock('@/lib/payments/stripe', () => ({ createStripeRefund: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/services/audit', () => ({
  AuditService: { logAuditEvent: (...args: unknown[]) => logAuditEvent(...args) },
}))

type BookingRow = Record<string, unknown> | null

let bookingRow: BookingRow
let paymentRow: Record<string, unknown> | null
const bookingUpdates: Record<string, unknown>[] = []

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table === 'payments') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: paymentRow, error: null }) }) }),
            }),
          }),
        }
      }
      // table_bookings
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: bookingRow, error: null }) }),
        }),
        update: (values: Record<string, unknown>) => {
          bookingUpdates.push(values)
          return { eq: async () => ({ error: null }) }
        },
      }
    },
  }),
}))

const { refundTableBookingDeposit } = await import('./refunds')

/** 30 days out, so the sliding tier is a full refund and the maths is unambiguous. */
function farFutureDate(): Date {
  const d = new Date()
  d.setDate(d.getDate() + 30)
  return d
}

beforeEach(() => {
  vi.clearAllMocks()
  bookingUpdates.length = 0
  paymentRow = null
  bookingRow = null
  refundPayPalPayment.mockResolvedValue({
    refundId: 'REF123',
    status: 'COMPLETED',
    amount: '150.00',
    currency: 'GBP',
  })
})

describe('refundTableBookingDeposit, PayPal deposits', () => {
  it('refunds a PayPal deposit that has no Stripe payment row at all', async () => {
    bookingRow = {
      paypal_deposit_capture_id: 'CAP-1',
      deposit_amount_locked: 150,
      deposit_amount: null,
      payment_status: 'completed',
      deposit_refund_status: null,
      booking_date: null,
      deposit_refund_cutoff_days: null,
      booking_period_code: null,
    }

    const result = await refundTableBookingDeposit('booking-1', farFutureDate())

    expect(refundPayPalPayment).toHaveBeenCalledTimes(1)
    expect(refundPayPalPayment.mock.calls[0][0]).toBe('CAP-1')
    expect(refundPayPalPayment.mock.calls[0][1]).toBe(150)
    expect(result).toMatchObject({ refunded: true, amountPence: 15000, tier: 'full' })
  })

  it('reconciles payment_status as well as deposit_refund_status', async () => {
    bookingRow = {
      paypal_deposit_capture_id: 'CAP-1',
      deposit_amount_locked: 150,
      deposit_amount: null,
      payment_status: 'completed',
      deposit_refund_status: null,
      booking_date: null,
      deposit_refund_cutoff_days: null,
      booking_period_code: null,
    }

    await refundTableBookingDeposit('booking-1', farFutureDate())

    // Leaving payment_status at 'completed' made a refunded booking still read as paid.
    expect(bookingUpdates).toHaveLength(1)
    expect(bookingUpdates[0]).toMatchObject({
      deposit_refund_status: 'refunded',
      payment_status: 'refunded',
    })
  })

  it('uses a deterministic idempotency key so a retried cancellation cannot refund twice', async () => {
    bookingRow = {
      paypal_deposit_capture_id: 'CAP-1',
      deposit_amount_locked: 150,
      deposit_amount: null,
      payment_status: 'completed',
      deposit_refund_status: null,
      booking_date: null,
      deposit_refund_cutoff_days: null,
      booking_period_code: null,
    }

    await refundTableBookingDeposit('booking-1', farFutureDate())
    await refundTableBookingDeposit('booking-1', farFutureDate())

    expect(refundPayPalPayment.mock.calls[0][2]).toBe(refundPayPalPayment.mock.calls[1][2])
  })

  it('reports money owed, not "no deposit", when the PayPal refund fails', async () => {
    refundPayPalPayment.mockRejectedValue(new Error('PayPal 422'))
    bookingRow = {
      paypal_deposit_capture_id: 'CAP-1',
      deposit_amount_locked: 150,
      deposit_amount: null,
      payment_status: 'completed',
      deposit_refund_status: null,
      booking_date: null,
      deposit_refund_cutoff_days: null,
      booking_period_code: null,
    }

    const result = await refundTableBookingDeposit('booking-1', farFutureDate())

    expect(result).toMatchObject({
      refunded: false,
      reason: 'refund_failed',
      depositOwed: true,
      amountOwedPence: 15000,
    })
    // A human has to know money is outstanding.
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ operation_type: 'table_booking.refund_failed_deposit_owed' }),
    )
  })

  it('still reports no_deposit for a booking that genuinely never paid one', async () => {
    bookingRow = {
      paypal_deposit_capture_id: null,
      deposit_amount_locked: null,
      deposit_amount: null,
      payment_status: null,
      deposit_refund_status: null,
      booking_date: null,
      deposit_refund_cutoff_days: null,
      booking_period_code: null,
    }

    const result = await refundTableBookingDeposit('booking-1', farFutureDate())

    expect(result).toEqual({ refunded: false, reason: 'no_deposit' })
    expect(refundPayPalPayment).not.toHaveBeenCalled()
  })

  it('does not refund twice when the deposit is already refunded', async () => {
    bookingRow = {
      paypal_deposit_capture_id: 'CAP-1',
      deposit_amount_locked: 150,
      deposit_amount: null,
      payment_status: 'refunded',
      deposit_refund_status: 'refunded',
      booking_date: null,
      deposit_refund_cutoff_days: null,
      booking_period_code: null,
    }

    const result = await refundTableBookingDeposit('booking-1', farFutureDate())

    expect(result).toEqual({ refunded: false, reason: 'already_refunded' })
    expect(refundPayPalPayment).not.toHaveBeenCalled()
  })

  it('honours a seasonal cutoff the guest was shown, over the sliding tier', async () => {
    const bookingDate = new Date()
    bookingDate.setDate(bookingDate.getDate() + 5)
    bookingRow = {
      paypal_deposit_capture_id: 'CAP-1',
      deposit_amount_locked: 200,
      deposit_amount: null,
      payment_status: 'completed',
      deposit_refund_status: null,
      booking_date: bookingDate.toISOString().slice(0, 10),
      // Promised a full refund up to 14 days out; 5 days out is inside it, so nothing.
      deposit_refund_cutoff_days: 14,
      booking_period_code: 'XMAS',
    }

    const result = await refundTableBookingDeposit('booking-1', bookingDate)

    expect(result).toEqual({ refunded: false, reason: 'zero_tier' })
    expect(refundPayPalPayment).not.toHaveBeenCalled()
  })

  it('treats a capture with an unreadable amount as money owed, not as no deposit', async () => {
    bookingRow = {
      paypal_deposit_capture_id: 'CAP-1',
      deposit_amount_locked: null,
      deposit_amount: null,
      payment_status: 'completed',
      deposit_refund_status: null,
      booking_date: null,
      deposit_refund_cutoff_days: null,
      booking_period_code: null,
    }

    const result = await refundTableBookingDeposit('booking-1', farFutureDate())

    expect(result).toMatchObject({ refunded: false, reason: 'refund_failed', depositOwed: true })
  })
})
