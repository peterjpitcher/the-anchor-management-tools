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
const alertTableDepositNeedsAPerson = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/table-bookings/deposit-alerts', () => ({
  alertTableDepositNeedsAPerson: (...args: unknown[]) => alertTableDepositNeedsAPerson(...args),
}))

type BookingRow = Record<string, unknown> | null

let bookingRow: BookingRow
let paymentRow: Record<string, unknown> | null
const bookingUpdates: Record<string, unknown>[] = []

/*
 * The guest manage link and the confirm-booking "no" answer have no session. Under RLS the anon
 * role sees no table_bookings or payments rows, so a session-client read finds nothing. That is
 * what made a paid deposit read as no deposit (BK-002). The session client here behaves exactly
 * so; if the refund code ever reads through it again, every test that expects a refund fails.
 */
const sessionReads: string[] = []
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => {
      sessionReads.push(table)
      const empty = { data: null, error: null }
      const chain: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'in', 'update']) chain[method] = () => chain
      chain.maybeSingle = async () => empty
      return chain
    },
  }),
}))

// The service-role client reads and writes everything: the deposit on the booking, the Stripe
// ledger and payment_refunds.
const refundRowInserts: Record<string, unknown>[] = []
const refundRowUpdates: { values: Record<string, unknown>; paypalRefundId: unknown }[] = []
let refundInsertError: { code?: string; message: string } | null = null
/** The completed and pending payment_refunds rows already on the booking. */
let ledgerRows: { amount: number; status: 'completed' | 'pending' }[] = []
let ledgerReadError: { message: string } | null = null

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
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
      if (table === 'table_bookings') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: bookingRow, error: null }) }),
          }),
          update: (values: Record<string, unknown>) => {
            bookingUpdates.push(values)
            return { eq: async () => ({ error: null }) }
          },
        }
      }
      // payment_refunds
      return {
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
  sessionReads.length = 0
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

  it('refunds a guest cancelling through their own link, who has no logged-in session', async () => {
    // BK-002: the guest paths have no session, and RLS shows the anon role nothing, so the deposit
    // read empty and was kept. The deposit must be found without the caller's session at all.
    bookingRow = {
      paypal_deposit_capture_id: 'CAP-GUEST',
      deposit_amount_locked: 160,
      deposit_amount: null,
      payment_status: 'completed',
      deposit_refund_status: null,
      booking_date: null,
      deposit_refund_cutoff_days: null,
      booking_period_code: null,
    }

    const result = await refundTableBookingDeposit('booking-1', farFutureDate())

    expect(result).toMatchObject({ refunded: true, amountPence: 16000, tier: 'full' })
    expect(refundPayPalPayment.mock.calls[0][0]).toBe('CAP-GUEST')
    expect(sessionReads).toEqual([])
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

    expect(result).toEqual({ refunded: false, reason: 'seasonal_cutoff', cutoffDays: 14 })
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
    // BK-114: the guest is owed money, so a manager is told, once.
    expect(alertTableDepositNeedsAPerson).toHaveBeenCalledTimes(1)
    expect(alertTableDepositNeedsAPerson).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      bookingId: 'booking-1',
      kind: 'refund_failed',
      amountGbp: 150,
    }))
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

/**
 * WHO CANCELLED DECIDES THE RULE (BK-046, owner decision D7).
 *
 * A pub cancellation applied the guest's own terms: half back three to six days out, nothing
 * inside three days or inside a Christmas cutoff. The pub's cancellation now refunds in full, and
 * a manager may choose the amount, capped at what is still held.
 */
describe('refundTableBookingDeposit, who cancelled', () => {
  function daysOut(days: number): Date {
    const d = new Date()
    d.setDate(d.getDate() + days)
    return d
  }

  function paidBooking(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      paypal_deposit_capture_id: 'CAP-1',
      payment_method: 'paypal',
      deposit_amount_locked: 160,
      deposit_amount: null,
      payment_status: 'completed',
      deposit_refund_status: null,
      booking_date: null,
      deposit_refund_cutoff_days: null,
      booking_period_code: null,
      ...overrides,
    }
  }

  it('refunds the whole deposit when the pub cancels inside 3 days, where the guest would get nothing', async () => {
    bookingRow = paidBooking()

    const result = await refundTableBookingDeposit('booking-1', daysOut(1), { cancelledBy: 'venue' })

    expect(result).toMatchObject({ refunded: true, amountPence: 16000, tier: 'full', cancelledBy: 'venue' })
    expect(refundPayPalPayment).toHaveBeenCalledWith('CAP-1', 160, 'tbl-paypal-refund-booking-1-venue', 'GBP')
  })

  it('refunds the whole deposit when the pub cancels a Christmas booking inside its cutoff', async () => {
    const bookingDate = daysOut(3)
    bookingRow = paidBooking({
      booking_date: bookingDate.toISOString().slice(0, 10),
      deposit_refund_cutoff_days: 7,
      booking_period_code: 'christmas-2026',
    })

    const result = await refundTableBookingDeposit('booking-1', bookingDate, { cancelledBy: 'venue' })

    expect(result).toMatchObject({ refunded: true, amountPence: 16000, tier: 'full', cancelledBy: 'venue' })
  })

  it('still applies the guest terms when the guest asked', async () => {
    bookingRow = paidBooking()

    const result = await refundTableBookingDeposit('booking-1', daysOut(1), { cancelledBy: 'guest' })

    expect(result).toEqual({ refunded: false, reason: 'zero_tier' })
    expect(refundPayPalPayment).not.toHaveBeenCalled()
  })

  it('refunds only the rest when part has already gone back', async () => {
    bookingRow = paidBooking()
    ledgerRows = [{ amount: 60, status: 'completed' }]

    const result = await refundTableBookingDeposit('booking-1', daysOut(1), { cancelledBy: 'venue' })

    expect(result).toMatchObject({ refunded: true, amountPence: 10000, alreadyReturnedPence: 6000, cancelledBy: 'venue' })
  })

  it("refunds a manager's chosen amount, whatever the rule says", async () => {
    bookingRow = paidBooking()

    const result = await refundTableBookingDeposit('booking-1', daysOut(1), { cancelledBy: 'guest', managerAmountGbp: 40 })

    expect(result).toMatchObject({ refunded: true, amountPence: 4000, tier: 'chosen' })
    expect(refundPayPalPayment).toHaveBeenCalledWith('CAP-1', 40, 'tbl-paypal-refund-booking-1-chosen-4000', 'GBP')
    expect(refundRowInserts[0]).toMatchObject({ amount: 40, reason: 'Booking cancelled: a manager chose the refund' })
  })

  it("caps a manager's amount at what the guest paid", async () => {
    bookingRow = paidBooking()

    const result = await refundTableBookingDeposit('booking-1', daysOut(30), { managerAmountGbp: 500 })

    expect(result).toMatchObject({ refunded: true, amountPence: 16000, tier: 'full' })
  })

  // The booking page offers what is still held, so the chosen amount is this refund, not a
  // lifetime total with earlier refunds taken off again.
  it("refunds the manager's chosen amount on top of an earlier part refund", async () => {
    ledgerRows = [{ amount: 60, status: 'completed' }]
    bookingRow = paidBooking({ payment_status: 'partial_refund', deposit_refund_status: 'partially_refunded' })

    const result = await refundTableBookingDeposit('booking-1', daysOut(1), { managerAmountGbp: 100 })

    expect(refundPayPalPayment).toHaveBeenCalledWith('CAP-1', 100, 'tbl-paypal-refund-booking-1-chosen-10000-after-6000', 'GBP')
    expect(result).toMatchObject({ refunded: true, amountPence: 10000, alreadyReturnedPence: 6000 })
    expect(bookingUpdates[0]).toMatchObject({ deposit_refund_status: 'refunded' })
  })

  it('refunds a chosen amount no bigger than what was already returned', async () => {
    ledgerRows = [{ amount: 60, status: 'completed' }]
    bookingRow = paidBooking({ payment_status: 'partial_refund', deposit_refund_status: 'partially_refunded' })

    const result = await refundTableBookingDeposit('booking-1', daysOut(1), { managerAmountGbp: 60 })

    expect(refundPayPalPayment.mock.calls[0][1]).toBe(60)
    expect(result).toMatchObject({ refunded: true, amountPence: 6000, tier: 'chosen' })
  })

  it('caps a chosen amount at what is still held after an earlier refund', async () => {
    ledgerRows = [{ amount: 60, status: 'completed' }]
    bookingRow = paidBooking({ payment_status: 'partial_refund', deposit_refund_status: 'partially_refunded' })

    const result = await refundTableBookingDeposit('booking-1', daysOut(1), { managerAmountGbp: 160 })

    expect(refundPayPalPayment.mock.calls[0][1]).toBe(100)
    expect(result).toMatchObject({ refunded: true, amountPence: 10000 })
  })
})

/**
 * A DEPOSIT TAKEN IN CASH IS OWED BACK, NOT IGNORED (BK-041, owner decision D19).
 *
 * record_table_cash_deposit_v05 writes a payments row with no provider id and marks the booking
 * cash and paid. The refund code looked only for Stripe and PayPal, decided there was no deposit,
 * and nobody was prompted to hand the money back.
 */
describe('refundTableBookingDeposit, cash deposits', () => {
  function cashBooking(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      paypal_deposit_capture_id: null,
      payment_method: 'cash',
      deposit_amount_locked: 160,
      deposit_amount: 160,
      payment_status: 'completed',
      deposit_refund_status: null,
      booking_date: null,
      deposit_refund_cutoff_days: null,
      booking_period_code: null,
      ...overrides,
    }
  }

  it('says what is owed in cash, tells a manager and writes an action-needed row', async () => {
    paymentRow = { id: 'pay-1', amount: 160, stripe_payment_intent_id: null, status: 'succeeded' }
    bookingRow = cashBooking()

    const result = await refundTableBookingDeposit('booking-1', farFutureDate())

    expect(result).toEqual({ refunded: false, reason: 'cash_refund_due', depositOwed: true, amountOwedPence: 16000 })
    expect(refundPayPalPayment).not.toHaveBeenCalled()
    expect(alertTableDepositNeedsAPerson).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bookingId: 'booking-1', kind: 'cash_refund_due', amountGbp: 160 }),
    )
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_type: 'table_booking.cash_refund_due',
        additional_info: expect.objectContaining({ amount_gbp: 160, action_needed: expect.stringContaining('£160.00') }),
      }),
    )
  })

  it('follows the guest terms: half back 3 to 6 days out', async () => {
    paymentRow = { id: 'pay-1', amount: 160, stripe_payment_intent_id: null, status: 'succeeded' }
    bookingRow = cashBooking()
    const d = new Date()
    d.setDate(d.getDate() + 4)

    const result = await refundTableBookingDeposit('booking-1', d)

    expect(result).toMatchObject({ reason: 'cash_refund_due', amountOwedPence: 8000 })
  })

  it('owes the whole cash deposit when the pub cancels', async () => {
    paymentRow = { id: 'pay-1', amount: 160, stripe_payment_intent_id: null, status: 'succeeded' }
    bookingRow = cashBooking()
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)

    const result = await refundTableBookingDeposit('booking-1', tomorrow, { cancelledBy: 'venue' })

    expect(result).toEqual({
      refunded: false,
      reason: 'cash_refund_due',
      depositOwed: true,
      amountOwedPence: 16000,
      cancelledBy: 'venue',
    })
  })

  it('finds a cash deposit from the booking alone when the ledger row is missing', async () => {
    bookingRow = cashBooking()

    const result = await refundTableBookingDeposit('booking-1', farFutureDate())

    expect(result).toMatchObject({ reason: 'cash_refund_due', amountOwedPence: 16000 })
  })

  it('takes off cash already handed back', async () => {
    paymentRow = { id: 'pay-1', amount: 160, stripe_payment_intent_id: null, status: 'succeeded' }
    bookingRow = cashBooking({ payment_status: 'partial_refund' })
    ledgerRows = [{ amount: 100, status: 'completed' }]

    const result = await refundTableBookingDeposit('booking-1', farFutureDate())

    expect(result).toMatchObject({ reason: 'cash_refund_due', amountOwedPence: 6000 })
  })

  it("owes a manager's chosen cash amount on top of cash already handed back", async () => {
    paymentRow = { id: 'pay-1', amount: 160, stripe_payment_intent_id: null, status: 'succeeded' }
    bookingRow = cashBooking({ payment_status: 'partial_refund' })
    ledgerRows = [{ amount: 100, status: 'completed' }]

    const result = await refundTableBookingDeposit('booking-1', farFutureDate(), { managerAmountGbp: 40 })

    expect(result).toMatchObject({ reason: 'cash_refund_due', amountOwedPence: 4000 })
  })

  it('owes nothing when the cash has all been handed back', async () => {
    bookingRow = cashBooking({ payment_status: 'refunded' })

    const result = await refundTableBookingDeposit('booking-1', farFutureDate())

    expect(result).toEqual({ refunded: false, reason: 'already_refunded' })
    expect(alertTableDepositNeedsAPerson).not.toHaveBeenCalled()
  })

  it('leaves a booking with no deposit as no deposit', async () => {
    bookingRow = cashBooking({ payment_method: null, payment_status: null, deposit_amount_locked: null, deposit_amount: null })

    const result = await refundTableBookingDeposit('booking-1', farFutureDate())

    expect(result).toEqual({ refunded: false, reason: 'no_deposit' })
    expect(alertTableDepositNeedsAPerson).not.toHaveBeenCalled()
  })
})

// BK-047 (owner decision D19): a deposit PayPal took after the booking was cancelled goes back in
// full, whatever the guest's own terms would have said.
describe('refundTableBookingDeposit, paid after cancellation', () => {
  it('refunds the whole capture inside 3 days and labels the refund', async () => {
    bookingRow = {
      paypal_deposit_capture_id: 'CAP-LATE',
      payment_method: 'paypal',
      deposit_amount_locked: 60,
      deposit_amount: 60,
      payment_status: 'completed',
      deposit_refund_status: null,
      booking_date: null,
      deposit_refund_cutoff_days: 7,
      booking_period_code: 'christmas-2026',
    }

    const result = await refundTableBookingDeposit('booking-1', new Date(), { paidAfterCancellation: true })

    expect(result).toMatchObject({ refunded: true, amountPence: 6000, tier: 'full' })
    expect(refundPayPalPayment).toHaveBeenCalledWith('CAP-LATE', 60, 'tbl-paypal-refund-booking-1-late', 'GBP')
    expect(refundRowInserts[0]).toMatchObject({ reason: 'Paid after the booking was cancelled: refunded in full', amount: 60 })
    expect(bookingUpdates[0]).toMatchObject({ deposit_refund_status: 'refunded', payment_status: 'refunded' })
  })
})
