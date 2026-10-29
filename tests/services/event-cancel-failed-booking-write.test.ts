import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn().mockResolvedValue({ success: true }) }))
vi.mock('@/lib/email/event-ticket-emails', () => ({
  sendEventBookingCancelledEmail: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('@/lib/events/manage-booking', () => ({ processEventRefund: vi.fn() }))

import { EventService, describeUncancelledBookings } from '@/services/events'
import { processEventRefund } from '@/lib/events/manage-booking'
import { sendEventBookingCancelledEmail } from '@/lib/email/event-ticket-emails'
import { sendSMS } from '@/lib/twilio'
import { logger } from '@/lib/logger'

/**
 * Cancelling an event cancels each booking, then refunds and tells the guest. When a booking's
 * cancel write failed, the guest was still refunded, emailed and texted that it was cancelled
 * while the booking stayed confirmed. The owner's decision: skip that booking and count it.
 */

type Call = { table: string; method: string; args: unknown[] }

/**
 * A Supabase stand-in that records every chained call. A bookings update aimed at
 * `failingBookingId` resolves with an error; every other chain resolves to its table's rows.
 */
function recordingDb(rowsByTable: Record<string, unknown[]>, failingBookingId: string) {
  const calls: Call[] = []
  const from = vi.fn((table: string) => {
    const own: Call[] = []
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'update', 'insert', 'eq', 'in', 'order', 'limit', 'maybeSingle', 'single']) {
      chain[method] = (...args: unknown[]) => {
        const call = { table, method, args }
        calls.push(call)
        own.push(call)
        return chain
      }
    }
    chain.then = (resolve: (value: unknown) => unknown) => {
      // The refunds read is the payments table filtered to refund rows (BK-136): its own rows.
      const rowsKey = table === 'payments' && own.some((call) => call.method === 'eq' && call.args[0] === 'charge_type' && call.args[1] === 'refund')
        ? 'refunds'
        : table
      const isFailingCancel =
        table === 'bookings' &&
        own.some((call) => call.method === 'update') &&
        own.some((call) => call.method === 'eq' && call.args[0] === 'id' && call.args[1] === failingBookingId)
      const result = isFailingCancel
        ? { data: null, error: { message: 'permission denied for table bookings', code: '42501' } }
        : { data: rowsByTable[rowsKey] ?? [], error: null }
      return Promise.resolve(result).then(resolve)
    }
    return chain
  })
  return { db: { from } as never, calls }
}

/** The booking ids a table's updates were scoped to through `.eq(column, id)`. */
function updatedFor(calls: Call[], table: string, column: string): unknown[] {
  return calls
    .filter((call) => call.table === table && call.method === 'eq' && call.args[0] === column)
    .map((call) => call.args[1])
}

const params = {
  eventId: 'event-1',
  eventName: 'Quiz Night',
  eventDate: '2026-10-20',
  eventTime: '19:00',
  cancelledBy: 'user-1',
}

function booking(id: string, customerId: string) {
  return {
    id,
    customer_id: customerId,
    seats: 2,
    status: 'confirmed',
    customers: { id: customerId, first_name: 'Sam', mobile_number: '+447700900001', sms_status: 'active' },
  }
}

describe('event cancellation when a booking cannot be cancelled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(processEventRefund).mockResolvedValue({ status: 'succeeded', amount: 20 } as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not refund, email, text or release anything for the booking whose cancel write failed', async () => {
    const { db, calls } = recordingDb(
      {
        bookings: [booking('booking-bad', 'customer-bad'), booking('booking-good', 'customer-good')],
        payments: [
          { id: 'payment-bad', event_booking_id: 'booking-bad', amount: 20, status: 'succeeded' },
          { id: 'payment-good', event_booking_id: 'booking-good', amount: 20, status: 'succeeded' },
        ],
      },
      'booking-bad',
    )

    const result = await EventService.cancelEventBookings({ ...params, supabase: db })

    expect(result.bookingsCancelled).toBe(1)
    expect(result.bookingsFailed).toBe(1)
    expect(result.failedBookingIds).toEqual(['booking-bad'])

    // Refund: only the good booking.
    const refundedBookings = vi.mocked(processEventRefund).mock.calls.map((call) => call[1].bookingId)
    expect(refundedBookings).toEqual(['booking-good'])
    expect(result.refundsProcessed).toBe(1)

    // Email and SMS: only the good booking's guest.
    const emailed = vi.mocked(sendEventBookingCancelledEmail).mock.calls.map((call) => call[1].bookingId)
    expect(emailed).toEqual(['booking-good'])
    const texted = vi.mocked(sendSMS).mock.calls.map((call) => (call[2] as { customerId: string }).customerId)
    expect(texted).toEqual(['customer-good'])
    expect(result.customersNotified).toBe(1)

    // Holds and linked table bookings: only the good booking.
    expect(updatedFor(calls, 'booking_holds', 'event_booking_id')).toEqual(['booking-good'])
    expect(updatedFor(calls, 'table_bookings', 'event_booking_id')).toEqual(['booking-good'])

    // The waitlist and the event itself are still closed.
    expect(calls.some((call) => call.table === 'waitlist_entries' && call.method === 'update')).toBe(true)
    expect(calls.some((call) => call.table === 'waitlist_offers' && call.method === 'update')).toBe(true)
    expect(updatedFor(calls, 'events', 'id')).toEqual(['event-1'])

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('left bookings uncancelled'),
      expect.objectContaining({
        metadata: expect.objectContaining({ eventId: 'event-1', bookingsFailed: 1, failedBookingIds: ['booking-bad'] }),
      }),
    )
  })

  it('reports nothing failed when every booking is cancelled', async () => {
    const { db } = recordingDb(
      { bookings: [booking('booking-good', 'customer-good')], payments: [] },
      'no-such-booking',
    )

    const result = await EventService.cancelEventBookings({ ...params, supabase: db })

    expect(result).toMatchObject({ bookingsCancelled: 1, bookingsFailed: 0, failedBookingIds: [] })
    expect(describeUncancelledBookings(result.bookingsFailed)).toBeNull()
  })
})

describe('describeUncancelledBookings', () => {
  it('tells staff how many bookings were left and what to do, in the singular and plural', () => {
    expect(describeUncancelledBookings(1)).toBe(
      '1 booking could not be cancelled and its guest was not told. Cancel it individually from the event page.',
    )
    expect(describeUncancelledBookings(2)).toBe(
      '2 bookings could not be cancelled and their guests were not told. Cancel them individually from the event page.',
    )
    expect(describeUncancelledBookings(0)).toBeNull()
  })
})
