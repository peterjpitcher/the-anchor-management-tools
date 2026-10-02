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

// payment_refunds is service-role only, so the ledger row goes through the admin client.
const refundRowInserts: Record<string, unknown>[] = []
const refundRowUpdates: { values: Record<string, unknown>; paypalRefundId: unknown }[] = []
let refundInsertError: { code?: string; message: string } | null = null
/** The completed and pending payment_refunds rows already on the booking. */
let ledgerRows: { amount: number; status: 'completed' | 'pending' }[] = []
let ledgerReadError: { message: string } | null = null

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            in: async () => ({ data: ledgerReadError ? null : ledgerRows, error: ledgerReadError }),
          }),
        }),
      }),
      insert: async (values: Record<string, unknown>) => {
        refundRowInserts.push(values)
        return { error: refundInsertError }
      },
      update: (values: Record<string, unknown>) => ({
        eq: async (_column: string, paypalRefundId: unknown) => {
          refundRowUpdates.push({ values, paypalRefundId })
          return { error: null }
        },
      }),
    }),
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
  refundRowInserts.length = 0
  refundRowUpdates.length = 0
  refundInsertError = null
  ledgerRows = []
  ledgerReadError = null
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

/**
 * THE REFUND GOES IN THE LEDGER WHEN IT IS MADE.
 *
 * `payment_refunds` is what the booking page's Refund History and the staff refund dialog read. A
 * cancellation refund wrote nothing to it: the row only arrived later, if the PayPal webhook was
 * delivered, and labelled as a refund made in the PayPal dashboard. Until then the ledger said the
 * whole deposit was still held.
 */
describe('refundTableBookingDeposit, the refund ledger', () => {
  function paidBooking(): BookingRow {
    return {
      paypal_deposit_capture_id: 'CAP-1',
      deposit_amount_locked: 150,
      deposit_amount: null,
      payment_status: 'completed',
      deposit_refund_status: null,
      booking_date: null,
      deposit_refund_cutoff_days: null,
      booking_period_code: null,
    }
  }

  /** Four days out: the sliding tier returns half. */
  function fourDaysOut(): Date {
    const d = new Date()
    d.setDate(d.getDate() + 4)
    return d
  }

  it('records a full refund against the booking, with the PayPal refund id', async () => {
    bookingRow = paidBooking()

    await refundTableBookingDeposit('booking-1', farFutureDate())

    expect(refundRowInserts).toHaveLength(1)
    expect(refundRowInserts[0]).toMatchObject({
      source_type: 'table_booking',
      source_id: 'booking-1',
      paypal_capture_id: 'CAP-1',
      paypal_refund_id: 'REF123',
      paypal_status: 'COMPLETED',
      refund_method: 'paypal',
      amount: 150,
      original_amount: 150,
      status: 'completed',
      initiated_by: null,
      initiated_by_type: 'system',
    })
    expect(refundRowInserts[0].completed_at).toEqual(expect.any(String))
    expect(refundRowInserts[0].reason).toMatch(/cancelled/i)
  })

  it('records a half refund as half of what was paid', async () => {
    bookingRow = paidBooking()

    const result = await refundTableBookingDeposit('booking-1', fourDaysOut())

    expect(result).toMatchObject({ refunded: true, amountPence: 7500, tier: 'half' })
    expect(refundRowInserts).toHaveLength(1)
    expect(refundRowInserts[0]).toMatchObject({ amount: 75, original_amount: 150, status: 'completed' })
  })

  it('records a refund PayPal has not settled yet as pending', async () => {
    refundPayPalPayment.mockResolvedValue({ refundId: 'REF123', status: 'PENDING', amount: '150.00', currency: 'GBP' })
    bookingRow = paidBooking()

    await refundTableBookingDeposit('booking-1', farFutureDate())

    expect(refundRowInserts[0]).toMatchObject({ status: 'pending', paypal_status: 'PENDING', completed_at: null })
  })

  it('writes nothing to the ledger when PayPal refuses the refund', async () => {
    refundPayPalPayment.mockRejectedValue(new Error('PayPal 422'))
    bookingRow = paidBooking()

    await refundTableBookingDeposit('booking-1', farFutureDate())

    expect(refundRowInserts).toHaveLength(0)
  })

  it('still reports the refund when the ledger write fails, because the money has gone back', async () => {
    refundInsertError = { code: '42501', message: 'permission denied' }
    bookingRow = paidBooking()

    const result = await refundTableBookingDeposit('booking-1', farFutureDate())

    expect(result).toMatchObject({ refunded: true, amountPence: 15000, refundId: 'REF123' })
    // The booking is still reconciled, and a person is told the ledger is short.
    expect(bookingUpdates[0]).toMatchObject({ payment_status: 'refunded' })
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ operation_type: 'table_booking.refund_paypal_success_ledger_failed' }),
    )
  })

  it('keeps the one row when the PayPal webhook recorded the refund first, and names it correctly', async () => {
    // One PayPal refund id is one row (unique index). Losing that race is not a failure.
    refundInsertError = { code: '23505', message: 'duplicate key value violates unique constraint' }
    bookingRow = paidBooking()

    const result = await refundTableBookingDeposit('booking-1', farFutureDate())

    expect(result).toMatchObject({ refunded: true })
    expect(refundRowUpdates).toHaveLength(1)
    expect(refundRowUpdates[0].paypalRefundId).toBe('REF123')
    expect(refundRowUpdates[0].values.reason).toMatch(/cancelled/i)
    expect(logAuditEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ operation_type: 'table_booking.refund_paypal_success_ledger_failed' }),
    )
  })
})

/**
 * CANCELLING A BOOKING STAFF HAVE ALREADY PART REFUNDED.
 *
 * The cancellation asked PayPal for the whole entitlement whatever had already gone back. PayPal
 * refused anything past what was left on the capture, and the guest was told we owed them the full
 * figure. The guest is due their entitlement less what they have already had.
 */
describe('refundTableBookingDeposit, after a staff part refund', () => {
  function paidBooking(overrides: Record<string, unknown> = {}): BookingRow {
    return {
      paypal_deposit_capture_id: 'CAP-1',
      deposit_amount_locked: 150,
      deposit_amount: null,
      payment_status: 'partial_refund',
      deposit_refund_status: 'partially_refunded',
      booking_date: null,
      deposit_refund_cutoff_days: null,
      booking_period_code: null,
      ...overrides,
    }
  }

  /** Four days out: the sliding tier returns half. */
  function fourDaysOut(): Date {
    const d = new Date()
    d.setDate(d.getDate() + 4)
    return d
  }

  it('refunds the rest of a full entitlement, not the whole deposit again', async () => {
    ledgerRows = [{ amount: 50, status: 'completed' }]
    bookingRow = paidBooking()

    const result = await refundTableBookingDeposit('booking-1', farFutureDate())

    expect(refundPayPalPayment.mock.calls[0][1]).toBe(100)
    expect(result).toMatchObject({ refunded: true, amountPence: 10000, tier: 'full', alreadyReturnedPence: 5000 })
    expect(refundRowInserts[0]).toMatchObject({ amount: 100, original_amount: 150 })
    // £50 then £100 is the whole £150, so the booking reads as refunded, not part refunded.
    expect(bookingUpdates[0]).toMatchObject({ deposit_refund_status: 'refunded', payment_status: 'refunded' })
  })

  it('refunds what is left of a half entitlement', async () => {
    ledgerRows = [{ amount: 50, status: 'completed' }]
    bookingRow = paidBooking()

    const result = await refundTableBookingDeposit('booking-1', fourDaysOut())

    // Half of £150 is £75, and £50 has gone back already.
    expect(refundPayPalPayment.mock.calls[0][1]).toBe(25)
    expect(result).toMatchObject({ refunded: true, amountPence: 2500, tier: 'half', alreadyReturnedPence: 5000 })
    expect(bookingUpdates[0]).toMatchObject({ deposit_refund_status: 'partially_refunded', payment_status: 'partial_refund' })
  })

  it('sends nothing when the guest has already had what they are due', async () => {
    ledgerRows = [{ amount: 100, status: 'completed' }]
    bookingRow = paidBooking()

    const result = await refundTableBookingDeposit('booking-1', fourDaysOut())

    expect(result).toEqual({ refunded: false, reason: 'already_refunded' })
    expect(refundPayPalPayment).not.toHaveBeenCalled()
    expect(refundRowInserts).toHaveLength(0)
  })

  it('counts a refund still settling at PayPal, so the same money is not sent twice', async () => {
    ledgerRows = [{ amount: 150, status: 'pending' }]
    bookingRow = paidBooking({ payment_status: 'completed', deposit_refund_status: null })

    const result = await refundTableBookingDeposit('booking-1', farFutureDate())

    expect(result).toEqual({ refunded: false, reason: 'already_refunded' })
    expect(refundPayPalPayment).not.toHaveBeenCalled()
  })

  it('refuses to guess when the refunds already made cannot be read', async () => {
    ledgerReadError = { message: 'schema cache' }
    bookingRow = paidBooking()

    const result = await refundTableBookingDeposit('booking-1', farFutureDate())

    // Not "no deposit" and not a refund: a person has to look, and the guest is told we will be in touch.
    expect(result).toEqual({ refunded: false, reason: 'terms_unreadable' })
    expect(refundPayPalPayment).not.toHaveBeenCalled()
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ operation_type: 'table_booking.refund_ledger_unreadable' }),
    )
  })

  it('says nothing about earlier refunds when there were none', async () => {
    bookingRow = paidBooking({ payment_status: 'completed', deposit_refund_status: null })

    const result = await refundTableBookingDeposit('booking-1', farFutureDate())

    expect(refundPayPalPayment.mock.calls[0][1]).toBe(150)
    expect(result).toMatchObject({ refunded: true, amountPence: 15000, tier: 'full' })
    expect(result).not.toHaveProperty('alreadyReturnedPence')
  })
})
