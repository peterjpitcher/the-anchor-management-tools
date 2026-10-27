import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fakeSupabase'

const state = vi.hoisted(() => ({ db: null as unknown as FakeSupabase }))

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(() => ({ authorized: true })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => state.db),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock('@/lib/messaging/flags', () => ({
  isMessagingFlagOn: vi.fn(async () => true),
}))

vi.mock('@/lib/private-bookings/messenger', () => ({
  sendPrivateBookingMessage: vi.fn(async () => ({ success: true, sent: true, channel: 'email' })),
}))

vi.mock('@/lib/paypal', () => ({
  getPayPalOrder: vi.fn(),
  isPayPalOrderNotFoundError: vi.fn(() => false),
}))

vi.mock('@/services/private-bookings', () => ({
  finalizeDepositPayment: vi.fn(async () => ({ success: true })),
}))

import { logAuditEvent } from '@/app/actions/audit'
import { logger } from '@/lib/logger'
import { getPayPalOrder, isPayPalOrderNotFoundError } from '@/lib/paypal'
import { sendPrivateBookingMessage } from '@/lib/private-bookings/messenger'
import { finalizeDepositPayment } from '@/services/private-bookings'
import { GET } from '@/app/api/cron/private-bookings-expire-holds/route'

// 07:00 in London on Wednesday 21 October 2026, an hour after the job's 06:00 UTC slot.
const NOW = new Date('2026-10-21T06:00:00.000Z')
const LAPSED = '2026-10-20T22:59:59.000Z'

function draft(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: 'draft',
    customer_id: 'customer-1',
    customer_first_name: 'Alex',
    customer_name: 'Alex Smith',
    contact_phone: '+447700900123',
    contact_email: 'alex@example.com',
    event_type: 'Birthday party',
    event_date: '2026-12-12',
    start_time: '19:00:00',
    end_time: '23:00:00',
    end_time_next_day: false,
    guest_count: 40,
    hold_expiry: LAPSED,
    deposit_amount: 250,
    deposit_paid_date: null,
    deposit_confirmed_at: '2026-10-01T10:00:00.000Z',
    paypal_deposit_order_id: null,
    internal_notes: null,
    date_tbd: false,
    calendar_event_id: null,
    created_at: '2026-10-01T10:00:00.000Z',
    ...overrides,
  }
}

function seed(bookings: Record<string, unknown>[], queue: Record<string, unknown>[] = []) {
  state.db = createFakeSupabase({
    private_bookings: bookings,
    private_booking_sms_queue: queue,
  })
}

function bookingRow(id: string): Record<string, any> {
  return state.db.tables.private_bookings.find((row) => row.id === id) as Record<string, any>
}

async function run() {
  const response = await GET(new Request('http://localhost/api/cron/private-bookings-expire-holds') as any)
  return { response, body: await response.json() }
}

describe('private bookings expire-holds cron', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('cancels a lapsed hold, audits it and tells the guest', async () => {
    seed([draft('booking-expired-1')])

    const { response, body } = await run()

    expect(response.status).toBe(200)
    expect(body.cancelled).toBe(1)
    expect(bookingRow('booking-expired-1')).toMatchObject({ status: 'cancelled', cancellation_reason: 'Deposit hold expired' })
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'update',
      resource_type: 'private_booking',
      resource_id: 'booking-expired-1',
      operation_status: 'success',
      additional_info: expect.objectContaining({
        action: 'expire_booking_hold',
        actor: 'system_cron',
      }),
    }))
    expect(vi.mocked(sendPrivateBookingMessage).mock.calls.map(([input]) => input.sms.trigger_type)).toEqual(['booking_expired'])
  })

  it('cancels the waiting texts with a payload the queue table accepts', async () => {
    seed([draft('booking-expired-1')], [
      { id: 'q1', booking_id: 'booking-expired-1', status: 'pending' },
      { id: 'q2', booking_id: 'booking-expired-1', status: 'sent' },
    ])

    await run()

    // The queue table has no updated_at column; naming one made PostgREST reject the update.
    const queue = Object.fromEntries(state.db.tables.private_booking_sms_queue.map((row) => [row.id, row]))
    expect(queue.q1).toEqual({ id: 'q1', booking_id: 'booking-expired-1', status: 'cancelled' })
    expect(queue.q2.status).toBe('sent')
  })

  it('logs the queue error instead of dropping it', async () => {
    seed([draft('booking-expired-1')])
    state.db.failures.push({ table: 'private_booking_sms_queue', op: 'update', error: { code: 'PGRST204', message: 'column missing' } })

    const { response } = await run()

    expect(response.status).toBe(200)
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to cancel queued texts for a cancelled private booking',
      expect.objectContaining({
        metadata: expect.objectContaining({ bookingId: 'booking-expired-1', code: 'PGRST204' }),
      })
    )
  })

  // BK-063: the job cancelled a booking whose guest had just paid through PayPal, and told them
  // their hold had lapsed. The PayPal order is now read first.
  describe('a lapsed hold with a PayPal order', () => {
    it('records a deposit PayPal has taken instead of cancelling the booking', async () => {
      seed([draft('paid-at-the-wire', { paypal_deposit_order_id: 'ORDER-1' })])
      vi.mocked(getPayPalOrder).mockResolvedValueOnce({
        status: 'COMPLETED',
        purchase_units: [{ payments: { captures: [{ id: 'CAPTURE-1', status: 'COMPLETED', amount: { value: '250.00', currency_code: 'GBP' } }] } }],
      } as never)

      const { body } = await run()

      expect(body.cancelled).toBe(0)
      expect(body.kept).toEqual([{ id: 'paid-at-the-wire', reason: 'deposit_recorded' }])
      expect(finalizeDepositPayment).toHaveBeenCalledWith({
        bookingId: 'paid-at-the-wire',
        amount: 250,
        method: 'paypal',
        paypalCaptureId: 'CAPTURE-1',
      })
      expect(bookingRow('paid-at-the-wire').status).toBe('draft')
      expect(sendPrivateBookingMessage).not.toHaveBeenCalled()
    })

    it.each([
      ['an approved payment the sweep will take', { status: 'APPROVED' }, 'payment_in_progress'],
      ['a capture PayPal is holding', { status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'C', status: 'PENDING' }] } }] }, 'payment_in_progress'],
    ])('keeps the hold for %s', async (_label, order, reason) => {
      seed([draft('paying', { paypal_deposit_order_id: 'ORDER-1' })])
      vi.mocked(getPayPalOrder).mockResolvedValueOnce(order as never)

      const { body } = await run()

      expect(body.kept).toEqual([{ id: 'paying', reason }])
      expect(bookingRow('paying').status).toBe('draft')
      expect(finalizeDepositPayment).not.toHaveBeenCalled()
    })

    it('keeps the hold until tomorrow when PayPal cannot be asked', async () => {
      seed([draft('unknown', { paypal_deposit_order_id: 'ORDER-1' })])
      vi.mocked(getPayPalOrder).mockRejectedValueOnce(new Error('PayPal timed out'))

      const { body } = await run()

      expect(body.kept).toEqual([{ id: 'unknown', reason: 'payment_unknown' }])
      expect(bookingRow('unknown').status).toBe('draft')
    })

    it('cancels as before when the order was never paid or no longer exists', async () => {
      seed([
        draft('never-paid', { paypal_deposit_order_id: 'ORDER-1' }),
        draft('gone', { paypal_deposit_order_id: 'ORDER-2' }),
      ])
      vi.mocked(getPayPalOrder)
        .mockResolvedValueOnce({ status: 'CREATED' } as never)
        .mockRejectedValueOnce(Object.assign(new Error('not found'), { status: 404 }))
      vi.mocked(isPayPalOrderNotFoundError).mockReturnValueOnce(true)

      const { body } = await run()

      expect(body.cancelled).toBe(2)
      expect(bookingRow('never-paid').status).toBe('cancelled')
      expect(bookingRow('gone').status).toBe('cancelled')
    })
  })
})
