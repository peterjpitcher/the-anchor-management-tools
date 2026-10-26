import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/table-bookings/bookings', () => ({
  sendTableBookingCancelledSmsIfAllowed: vi.fn().mockResolvedValue({ status: 'sent', channel: 'email', fallbackUsed: false, error: null }),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/cron/alerting', () => ({
  reportCronFailure: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/table-bookings/paypal-deposit-reconcile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/table-bookings/paypal-deposit-reconcile')>()),
  reconcileTableDepositOrder: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendTableBookingCancelledSmsIfAllowed } from '@/lib/table-bookings/bookings'
import { logAuditEvent } from '@/app/actions/audit'
import { reconcileTableDepositOrder } from '@/lib/table-bookings/paypal-deposit-reconcile'
import { GET } from '@/app/api/cron/table-booking-deposit-timeout/route'

/**
 * BK-113: a lapsed table deposit hold is cancelled by this cron and only this cron, every five
 * minutes, ten minutes after the hold ends, with one audit row and one notice that says the
 * deposit was not paid in time, and never when PayPal shows the guest paid.
 */

function createBuilder(response: { data: unknown; error: unknown }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> & {
    then?: Promise<{ data: unknown; error: unknown }>['then']
  } = {} as any

  for (const method of ['select', 'eq', 'not', 'lte', 'limit', 'update', 'is', 'or']) {
    builder[method] = vi.fn(() => builder)
  }

  builder.then = (resolve, reject) => Promise.resolve(response).then(resolve, reject)
  return builder
}

function lapsedBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-2',
    customer_id: 'customer-2',
    booking_reference: 'TB-2',
    booking_date: '2026-07-25',
    booking_time: '18:00',
    booking_type: 'regular',
    status: 'pending_payment',
    hold_expires_at: '2026-07-24T11:40:00.000Z',
    payment_status: 'pending',
    paypal_deposit_order_id: null,
    paypal_deposit_capture_id: null,
    party_size: 16,
    deposit_amount: 160,
    deposit_amount_locked: null,
    deposit_waived: false,
    ...overrides,
  }
}

/** The candidate select, then (if it gets that far) the cancel, the hold row and the payment row. */
function wireDb(row: Record<string, unknown>) {
  const selectBuilder = createBuilder({ data: [row], error: null })
  const bookingUpdateBuilder = createBuilder({ data: [{ id: row.id, payment_status: 'pending' }], error: null })
  const holdUpdateBuilder = createBuilder({ data: [{ id: 'hold-1' }], error: null })
  const paymentUpdateBuilder = createBuilder({ data: [{ id: 'payment-1' }], error: null })
  const builders = [selectBuilder, bookingUpdateBuilder, holdUpdateBuilder, paymentUpdateBuilder]
  const supabase = {
    from: vi.fn((table: string) => {
      const next = builders.shift()
      if (!next) throw new Error(`Unexpected table call: ${table}`)
      return next
    }),
  }
  ;(createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(supabase)
  return { supabase, selectBuilder, bookingUpdateBuilder, holdUpdateBuilder, paymentUpdateBuilder }
}

async function run() {
  const response = await GET(new Request('http://localhost/api/cron/table-booking-deposit-timeout') as any)
  return { status: response.status, payload: await response.json() }
}

describe('table booking deposit timeout cron', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-24T12:00:00.000Z'))
    ;(authorizeCronRequest as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ authorized: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('only looks at holds that ended more than ten minutes ago, and leaves one inside the grace', async () => {
    const { supabase, selectBuilder } = wireDb(lapsedBooking({ hold_expires_at: '2026-07-24T11:55:00.000Z' }))

    const { status, payload } = await run()

    expect(status).toBe(200)
    expect(payload).toEqual({ cancelled: 0 })
    expect(selectBuilder.lte).toHaveBeenCalledWith('hold_expires_at', '2026-07-24T11:50:00.000Z')
    expect(supabase.from).toHaveBeenCalledTimes(1)
    expect(sendTableBookingCancelledSmsIfAllowed).not.toHaveBeenCalled()
    expect(logAuditEvent).not.toHaveBeenCalled()
  })

  it('cancels a lapsed hold once, with one audit row and one notice saying the deposit was not paid in time', async () => {
    const { bookingUpdateBuilder, holdUpdateBuilder, paymentUpdateBuilder } = wireDb(lapsedBooking())

    const { status, payload } = await run()

    expect(status).toBe(200)
    expect(payload).toEqual({ cancelled: 1 })
    expect(bookingUpdateBuilder.update).toHaveBeenCalledTimes(1)
    expect(bookingUpdateBuilder.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'cancelled',
      cancelled_by: 'system',
      cancellation_reason: 'payment_hold_expired',
      hold_expires_at: null,
    }))
    expect(bookingUpdateBuilder.eq).toHaveBeenCalledWith('status', 'pending_payment')
    expect(bookingUpdateBuilder.is).toHaveBeenCalledWith('paypal_deposit_capture_id', null)
    expect(bookingUpdateBuilder.or).toHaveBeenCalledWith('payment_status.is.null,payment_status.eq.pending,payment_status.eq.failed')
    expect(holdUpdateBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'expired' }))
    expect(paymentUpdateBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
    expect(logAuditEvent).toHaveBeenCalledTimes(1)
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'table_booking.auto_cancelled',
      resource_id: 'booking-2',
    }))
    expect(sendTableBookingCancelledSmsIfAllowed).toHaveBeenCalledTimes(1)
    expect(sendTableBookingCancelledSmsIfAllowed).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      tableBookingId: 'booking-2',
      refundResult: { refunded: false, reason: 'hold_expired' },
    }))
    // A booking with no PayPal order has nothing to check.
    expect(reconcileTableDepositOrder).not.toHaveBeenCalled()
  })

  it('records a deposit PayPal took instead of cancelling the booking', async () => {
    vi.mocked(reconcileTableDepositOrder).mockResolvedValueOnce({ outcome: 'recorded', amountGbp: 160, wasCancelled: false })
    const { bookingUpdateBuilder } = wireDb(lapsedBooking({ paypal_deposit_order_id: 'ORDER-1' }))

    const { payload } = await run()

    expect(payload).toEqual({ cancelled: 0, paidAfterAll: 1 })
    expect(reconcileTableDepositOrder).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'booking-2' }), { source: 'deposit_timeout' })
    expect(bookingUpdateBuilder.update).not.toHaveBeenCalled()
    expect(sendTableBookingCancelledSmsIfAllowed).not.toHaveBeenCalled()
  })

  it('never cancels a booking whose PayPal money is waiting for a person', async () => {
    vi.mocked(reconcileTableDepositOrder).mockResolvedValueOnce({ outcome: 'needs_attention' })
    const { bookingUpdateBuilder } = wireDb(lapsedBooking({ paypal_deposit_order_id: 'ORDER-1' }))

    const { payload } = await run()

    expect(payload).toEqual({ cancelled: 0 })
    expect(bookingUpdateBuilder.update).not.toHaveBeenCalled()
    expect(sendTableBookingCancelledSmsIfAllowed).not.toHaveBeenCalled()
  })

  it('cancels when PayPal shows nothing paid', async () => {
    vi.mocked(reconcileTableDepositOrder).mockResolvedValueOnce({ outcome: 'not_paid' })
    wireDb(lapsedBooking({ paypal_deposit_order_id: 'ORDER-1' }))

    const { payload } = await run()

    expect(payload).toEqual({ cancelled: 1 })
    expect(sendTableBookingCancelledSmsIfAllowed).toHaveBeenCalledTimes(1)
  })

  it('waits for PayPal when it cannot be read, but not for more than two hours', async () => {
    vi.mocked(reconcileTableDepositOrder).mockResolvedValue({ outcome: 'lookup_failed' })

    wireDb(lapsedBooking({ paypal_deposit_order_id: 'ORDER-1' }))
    expect((await run()).payload).toEqual({ cancelled: 0, deferred: 1 })

    wireDb(lapsedBooking({ paypal_deposit_order_id: 'ORDER-1', hold_expires_at: '2026-07-24T09:30:00.000Z' }))
    expect((await run()).payload).toEqual({ cancelled: 1 })
  })
})
