import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@/lib/paypal', () => ({
  refundPayPalPayment: vi.fn(),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { refundPayPalPayment } from '@/lib/paypal'
import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { processEventRefund } from '@/lib/events/manage-booking'
import { createFakeSupabase } from '../helpers/fakeSupabase'

function chain(final: unknown, methods: string[]) {
  const obj: Record<string, unknown> = { ...(final as Record<string, unknown>) }
  for (const method of methods) {
    obj[method] = vi.fn().mockReturnValue(obj)
  }
  obj.maybeSingle = vi.fn().mockResolvedValue(final)
  return obj
}

describe('processEventRefund', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refunds event ticket payments through PayPal captures', async () => {
    ;(refundPayPalPayment as unknown as Mock).mockResolvedValue({
      refundId: 'RFD-123',
      status: 'COMPLETED',
      amount: '10.00',
    })
    ;(recordAnalyticsEvent as unknown as Mock).mockResolvedValue(undefined)

    const paymentLookup = chain(
      {
        data: [{
          id: 'payment-1',
          amount: 20,
          currency: 'GBP',
          paypal_capture_id: 'CAPTURE-123',
        }],
        error: null,
      },
      ['select', 'eq', 'in', 'not', 'order']
    )

    const existingRefundLookup = chain(
      { data: [], error: null },
      ['select', 'eq', 'contains', 'in', 'order']
    )

    const allRefundsLookup = chain(
      { data: [], error: null },
      ['select', 'eq', 'contains', 'in']
    )

    const updatePayment = chain(
      { data: null, error: null },
      ['update', 'eq']
    )

    // No webhook delivery has recorded this refund yet.
    const webhookRowLookup = chain(
      { data: null, error: null },
      ['select', 'eq', 'contains', 'limit']
    )

    const insert = vi.fn().mockResolvedValue({ error: null })
    const supabase = {
      from: vi
        .fn()
        .mockReturnValueOnce(paymentLookup)
        .mockReturnValueOnce(existingRefundLookup)
        .mockReturnValueOnce(allRefundsLookup)
        .mockReturnValueOnce(webhookRowLookup)
        .mockReturnValueOnce({ insert })
        .mockReturnValueOnce(updatePayment),
    }

    const result = await processEventRefund(supabase as any, {
      bookingId: 'booking-1',
      customerId: 'customer-1',
      eventId: 'event-1',
      amount: 10,
      reason: 'event_cancel_full',
    })

    expect(result).toMatchObject({
      status: 'succeeded',
      amount: 10,
      currency: 'GBP',
      paypalRefundId: 'RFD-123',
    })
    expect(refundPayPalPayment).toHaveBeenCalledWith(
      'CAPTURE-123',
      10,
      'event-refund-booking-1-payment-1-event_cancel_full-1000',
      'GBP'
    )
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      event_booking_id: 'booking-1',
      charge_type: 'refund',
      payment_provider: 'paypal',
      payment_method: 'paypal',
      amount: 10,
      status: 'refunded',
      metadata: expect.objectContaining({
        source_payment_id: 'payment-1',
        source_paypal_capture_id: 'CAPTURE-123',
        paypal_refund_id: 'RFD-123',
      }),
    }))
  })

  it('adopts the row the webhook recorded when it lands before the staff write, rather than recording twice', async () => {
    const db = createFakeSupabase({
      payments: [{
        id: 'payment-1',
        event_booking_id: 'booking-1',
        charge_type: 'prepaid_event',
        payment_provider: 'paypal',
        amount: 20,
        currency: 'GBP',
        status: 'succeeded',
        paypal_capture_id: 'CAPTURE-123',
        metadata: {},
        created_at: '2026-09-01T10:00:00.000Z',
      }],
    })

    // PayPal answers, and its webhook for the same refund is recorded before this path writes.
    ;(refundPayPalPayment as unknown as Mock).mockImplementation(async () => {
      db.tables.payments.push({
        id: 'webhook-row',
        event_booking_id: 'booking-1',
        charge_type: 'refund',
        payment_provider: 'paypal',
        amount: 10,
        currency: 'GBP',
        status: 'refunded',
        metadata: {
          source_payment_id: 'payment-1',
          paypal_refund_id: 'RFD-777',
          reason: 'paypal_dashboard_refund',
          initiated_by_type: 'system',
        },
      })
      return { refundId: 'RFD-777', status: 'COMPLETED', amount: '10.00' }
    })

    const result = await processEventRefund(db as any, {
      bookingId: 'booking-1',
      customerId: 'customer-1',
      eventId: 'event-1',
      amount: 10,
      reason: 'staff_manual_refund',
      metadata: { idempotency_key: 'staff-manual-refund:booking-1' },
    })

    const refundRows = db.tables.payments.filter((row) => row.charge_type === 'refund')
    expect(result).toMatchObject({ status: 'succeeded', amount: 10, paypalRefundId: 'RFD-777' })
    expect(refundRows).toHaveLength(1)
    expect(refundRows[0]).toMatchObject({
      id: 'webhook-row',
      metadata: expect.objectContaining({
        paypal_refund_id: 'RFD-777',
        reason: 'staff_manual_refund',
        idempotency_key: 'staff-manual-refund:booking-1',
        initiated_by_type: 'staff',
        recorded_first_by: 'paypal_webhook',
      }),
    })
    expect(db.tables.payments.find((row) => row.id === 'payment-1')?.status).toBe('partially_refunded')
    // The webhook raised the analytics event when it recorded the refund.
    expect(recordAnalyticsEvent).not.toHaveBeenCalled()
  })
})
