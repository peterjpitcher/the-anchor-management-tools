import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    ;(refundPayPalPayment as unknown as vi.Mock).mockResolvedValue({
      refundId: 'RFD-123',
      status: 'COMPLETED',
      amount: '10.00',
    })
    ;(recordAnalyticsEvent as unknown as vi.Mock).mockResolvedValue(undefined)

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

    const insert = vi.fn().mockResolvedValue({ error: null })
    const supabase = {
      from: vi
        .fn()
        .mockReturnValueOnce(paymentLookup)
        .mockReturnValueOnce(existingRefundLookup)
        .mockReturnValueOnce(allRefundsLookup)
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
})
