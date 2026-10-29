import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/money-alerts', () => ({
  alertMoneyNeedsAPerson: vi.fn().mockResolvedValue({ sent: true, duplicate: false }),
  formatPounds: (amount: number) => `£${amount.toFixed(2)}`,
}))

import { alertMoneyNeedsAPerson } from '@/lib/money-alerts'
import { alertEventRefundRequest, loadOpenEventRefundRequests, resolveEventRefundRequestRow } from '@/lib/events/refund-requests'
import { argsOf, createRecordingSupabase } from '../mocks/recordingSupabase'

// Owner decision D7: refunds owed after a staff change wait for a manager.

describe('event refund requests', () => {
  beforeEach(() => vi.clearAllMocks())

  it('closes only an open request on this booking', async () => {
    const db = createRecordingSupabase({ tables: { event_booking_refund_requests: () => ({ data: [{ id: 'request-1' }], error: null }) } })

    const closed = await resolveEventRefundRequestRow(db.client as never, {
      requestId: 'request-1', bookingId: 'booking-1', status: 'refunded', amount: 30.004, resolvedBy: 'manager-1', note: 'Agreed on the phone',
    })

    expect(closed).toBe(true)
    const query = db.queries[0]
    expect(argsOf(query, 'update')[0][0]).toMatchObject({ status: 'refunded', resolved_amount: 30, resolved_by: 'manager-1', resolution_note: 'Agreed on the phone' })
    expect(argsOf(query, 'eq')).toEqual([['id', 'request-1'], ['event_booking_id', 'booking-1'], ['status', 'open']])
  })

  it('reports a request already decided', async () => {
    const db = createRecordingSupabase({ tables: { event_booking_refund_requests: () => ({ data: [], error: null }) } })
    expect(await resolveEventRefundRequestRow(db.client as never, { requestId: 'r', bookingId: 'b', status: 'no_refund', amount: 0, resolvedBy: null })).toBe(false)
  })

  it('groups open requests by booking', async () => {
    const db = createRecordingSupabase({
      tables: {
        event_booking_refund_requests: () => ({
          data: [
            { id: 'r1', event_booking_id: 'b1', kind: 'guest_removed', amount: '40.00', created_at: '2026-10-28T10:00:00Z' },
            { id: 'r2', event_booking_id: 'b1', kind: 'ticket_type_changed', amount: '20.00', created_at: '2026-10-28T11:00:00Z' },
          ],
          error: null,
        }),
      },
    })
    const byBooking = await loadOpenEventRefundRequests(db.client as never, ['b1', 'b2'])
    expect(byBooking.get('b1')?.map((r) => [r.id, r.amount])).toEqual([['r1', 40], ['r2', 20]])
    expect(byBooking.has('b2')).toBe(false)
  })

  it('alerts the manager once per request with ids and amounts only', async () => {
    await alertEventRefundRequest({} as never, {
      requestId: 'request-1', bookingId: 'booking-1', eventId: 'event-1', eventName: 'Tinsel and Tipples', kind: 'guest_removed', amount: 40, pricePaid: 40,
    })
    expect(alertMoneyNeedsAPerson).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      domain: 'event_bookings', bookingId: 'booking-1', onceKey: 'money-alert:event_bookings:refund_request:request-1', path: '/events/event-1',
    }))
    const alert = vi.mocked(alertMoneyNeedsAPerson).mock.calls[0][1]
    expect(alert.summary).toContain('Nothing has been refunded yet.')
    expect(alert.title).toContain('£40.00')
  })
})
