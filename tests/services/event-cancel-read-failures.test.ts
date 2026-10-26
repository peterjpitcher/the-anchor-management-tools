import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('@/lib/email/event-ticket-emails', () => ({
  sendEventBookingCancelledEmail: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('@/lib/events/manage-booking', () => ({ processEventRefund: vi.fn() }))
vi.mock('@/lib/events/payment-alerts', () => ({ alertEventPaymentNeedsAPerson: vi.fn().mockResolvedValue(undefined) }))

import { EventService } from '@/services/events'
import { processEventRefund } from '@/lib/events/manage-booking'
import { alertEventPaymentNeedsAPerson } from '@/lib/events/payment-alerts'
import { sendEventBookingCancelledEmail } from '@/lib/email/event-ticket-emails'
import { sendSMS } from '@/lib/twilio'

/**
 * Cancelling a whole event read its bookings and then their payments without checking either
 * read for an error (BK-025, customer bookings review of 24 October 2026). A failed bookings read
 * looked like "no bookings"; a failed payments read cancelled everyone, refunded nobody, told
 * guests nothing about their money and still reported success, and a re-run could not find them.
 */

type Call = { table: string; method: string; args: unknown[] }

function db(rowsByTable: Record<string, unknown[]>, failingRead?: string) {
  const calls: Call[] = []
  const from = vi.fn((table: string) => {
    const own: Call[] = []
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'update', 'insert', 'eq', 'in', 'is', 'order', 'limit', 'maybeSingle', 'single']) {
      chain[method] = (...args: unknown[]) => {
        const call = { table, method, args }
        calls.push(call)
        own.push(call)
        return chain
      }
    }
    chain.then = (resolve: (value: unknown) => unknown) => {
      const isRead = !own.some((call) => call.method === 'update' || call.method === 'insert')
      const result = isRead && table === failingRead
        ? { data: null, error: { message: 'canceling statement due to statement timeout', code: '57014' } }
        : { data: rowsByTable[table] ?? [], error: null }
      return Promise.resolve(result).then(resolve)
    }
    return chain
  })
  return { client: { from } as never, calls }
}

const params = { eventId: 'event-1', eventName: 'Quiz Night', eventDate: '2026-11-20', eventTime: '19:00', cancelledBy: 'user-1' }

function booking(id: string, status = 'confirmed') {
  return {
    id,
    customer_id: `customer-${id}`,
    seats: 2,
    status,
    customers: { id: `customer-${id}`, first_name: 'Sam', mobile_number: '+447700900001', sms_status: 'active' },
  }
}

const bookingUpdates = (calls: Call[]) => calls.filter((call) => call.table === 'bookings' && call.method === 'update')

describe('whole-event cancellation when a read fails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(processEventRefund).mockResolvedValue({ status: 'succeeded', amount: 40, currency: 'GBP' })
  })
  afterEach(() => vi.restoreAllMocks())

  it('fails the job, cancelling and messaging nobody, when the payments cannot be read', async () => {
    const { client, calls } = db({ bookings: [booking('booking-1'), booking('booking-2')] }, 'payments')

    await expect(EventService.cancelEventBookings({ ...params, supabase: client })).rejects.toThrow(/payments/)

    expect(bookingUpdates(calls)).toEqual([])
    expect(processEventRefund).not.toHaveBeenCalled()
    expect(sendEventBookingCancelledEmail).not.toHaveBeenCalled()
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('fails the job, rather than treating it as an event with no bookings, when the bookings cannot be read', async () => {
    const { client, calls } = db({}, 'bookings')

    await expect(EventService.cancelEventBookings({ ...params, supabase: client })).rejects.toThrow(/bookings/)

    expect(calls.some((call) => call.method === 'update')).toBe(false)
    expect(sendEventBookingCancelledEmail).not.toHaveBeenCalled()
  })
})

describe('whole-event cancellation refunds', () => {
  beforeEach(() => vi.clearAllMocks())

  it('refunds each paid booking straight after cancelling it, with a key per payment', async () => {
    vi.mocked(processEventRefund).mockResolvedValue({ status: 'succeeded', amount: 40, currency: 'GBP' })
    const { client, calls } = db({
      bookings: [booking('booking-1')],
      payments: [{ id: 'payment-1', event_booking_id: 'booking-1', amount: 40, status: 'succeeded' }],
    })

    const result = await EventService.cancelEventBookings({ ...params, supabase: client })

    expect(result).toMatchObject({ bookingsCancelled: 1, refundsProcessed: 1 })
    expect(processEventRefund).toHaveBeenCalledWith(client, expect.objectContaining({
      bookingId: 'booking-1',
      sourcePaymentId: 'payment-1',
      metadata: expect.objectContaining({ idempotency_key: 'event-cancelled-refund:payment-1' }),
    }))
    const cancelIndex = calls.findIndex((call) => call.table === 'bookings' && call.method === 'update')
    expect(cancelIndex).toBeGreaterThanOrEqual(0)
    expect(alertEventPaymentNeedsAPerson).not.toHaveBeenCalled()
  })

  it('tells a manager when a refund does not go through', async () => {
    vi.mocked(processEventRefund).mockResolvedValue({ status: 'failed', amount: 40, currency: 'GBP', reason: 'paypal_refund_failed' })
    const { client } = db({
      bookings: [booking('booking-1')],
      payments: [{ id: 'payment-1', event_booking_id: 'booking-1', amount: 40, status: 'succeeded' }],
    })

    const result = await EventService.cancelEventBookings({ ...params, supabase: client })

    expect(result.refundsFailed).toBe(1)
    expect(alertEventPaymentNeedsAPerson).toHaveBeenCalledTimes(1)
    expect(alertEventPaymentNeedsAPerson).toHaveBeenCalledWith(client, expect.objectContaining({ bookingId: 'booking-1', kind: 'refund_failed' }))
  })

  it('also refunds a booking that expired after PayPal took the money (BK-018), and leaves unpaid expired ones alone', async () => {
    vi.mocked(processEventRefund).mockResolvedValue({ status: 'succeeded', amount: 40, currency: 'GBP' })
    const { client, calls } = db({
      bookings: [booking('booking-paid', 'expired'), booking('booking-unpaid', 'expired')],
      payments: [{ id: 'payment-1', event_booking_id: 'booking-paid', amount: 40, status: 'succeeded' }],
    })

    const result = await EventService.cancelEventBookings({ ...params, supabase: client })

    expect(result.bookingsCancelled).toBe(1)
    expect(vi.mocked(processEventRefund).mock.calls.map((call) => call[1].bookingId)).toEqual(['booking-paid'])
    const cancelledIds = calls
      .filter((call) => call.table === 'bookings' && call.method === 'eq' && call.args[0] === 'id')
      .map((call) => call.args[1])
    expect(cancelledIds).toEqual(['booking-paid'])
    expect(vi.mocked(sendEventBookingCancelledEmail).mock.calls.map((call) => call[1].bookingId)).toEqual(['booking-paid'])
  })
})
