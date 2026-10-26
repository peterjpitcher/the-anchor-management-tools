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
        // No same-reason lookup any more: earlier refunds with the same reason no longer count
        // as this one done (BK-024).
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

  it.each([
    ['lands', null, undefined],
    [
      'fails',
      { message: 'permission denied for table payments', code: '42501' },
      'The refund went through, but the original payment was not updated to show it. Do not refund again: tell the developer so the payment record can be corrected.',
    ],
  ] as const)(
    'still reports a refund PayPal made as succeeded when marking the original payment refunded %s',
    async (_label, updateError, staffWarning) => {
      ;(refundPayPalPayment as unknown as Mock).mockResolvedValue({
        refundId: 'RFD-123',
        status: 'COMPLETED',
        amount: '10.00',
      })
      ;(recordAnalyticsEvent as unknown as Mock).mockResolvedValue(undefined)
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      const paymentLookup = chain(
        { data: [{ id: 'payment-1', amount: 20, currency: 'GBP', paypal_capture_id: 'CAPTURE-123' }], error: null },
        ['select', 'eq', 'in', 'not', 'order']
      )
      const allRefundsLookup = chain({ data: [], error: null }, ['select', 'eq', 'contains', 'in'])
      const webhookRowLookup = chain({ data: null, error: null }, ['select', 'eq', 'contains', 'limit'])
      const updatePayment = chain({ data: null, error: updateError }, ['update', 'eq'])
      const insert = vi.fn().mockResolvedValue({ error: null })
      const supabase = {
        from: vi
          .fn()
          .mockReturnValueOnce(paymentLookup)
          // No same-reason lookup any more (BK-024).
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
      consoleError.mockRestore()

      // Never a failure: PayPal has the money back with the guest, and "failed" invites a second refund.
      expect(result).toMatchObject({ status: 'succeeded', amount: 10, paypalRefundId: 'RFD-123' })
      expect(result.staffWarning).toBe(staffWarning)
      expect(updatePayment.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'partially_refunded' }))
      // The failed write did not fall into the catch, which would record a second refund row.
      expect(insert).toHaveBeenCalledTimes(1)
    }
  )

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

  it('adopts the webhook row when it lands between the look and the insert, which the unique index refuses', async () => {
    const db = createFakeSupabase(
      {
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
      },
      {
        // payments_paypal_refund_id_unique
        unique: {
          payments: (row) => (row.charge_type === 'refund' ? row.metadata?.paypal_refund_id : undefined),
        },
      }
    )
    ;(refundPayPalPayment as unknown as Mock).mockResolvedValue({
      refundId: 'RFD-888',
      status: 'COMPLETED',
      amount: '10.00',
    })

    // The webhook records the refund after the staff path looked for it and before it inserts.
    const from = db.from
    db.from = (name: string) => {
      const query = from(name)
      if (name !== 'payments') return query
      const insert = query.insert
      query.insert = (payload: Record<string, unknown>) => {
        if (payload?.charge_type === 'refund') {
          db.tables.payments.push({
            id: 'webhook-row',
            event_booking_id: 'booking-1',
            charge_type: 'refund',
            payment_provider: 'paypal',
            amount: 10,
            currency: 'GBP',
            status: 'refunded',
            metadata: { source_payment_id: 'payment-1', paypal_refund_id: 'RFD-888', initiated_by_type: 'system' },
          })
        }
        return insert(payload)
      }
      return query
    }

    const result = await processEventRefund(db as any, {
      bookingId: 'booking-1',
      customerId: 'customer-1',
      eventId: 'event-1',
      amount: 10,
      reason: 'staff_manual_refund',
    })

    const refundRows = db.tables.payments.filter((row) => row.charge_type === 'refund')
    expect(result).toMatchObject({ status: 'succeeded', amount: 10, paypalRefundId: 'RFD-888' })
    expect(refundRows).toHaveLength(1)
    expect(refundRows[0]).toMatchObject({
      id: 'webhook-row',
      metadata: expect.objectContaining({
        reason: 'staff_manual_refund',
        initiated_by_type: 'staff',
        recorded_first_by: 'paypal_webhook',
      }),
    })
    expect(recordAnalyticsEvent).not.toHaveBeenCalled()
  })

  // BK-024: a second refund with the same reason on the same booking counted the first as itself
  // already done, so it replayed without calling PayPal and still reported success.
  describe('more than one refund on a booking', () => {
    function paidBooking() {
      return createFakeSupabase({
        payments: [{
          id: 'payment-1',
          event_booking_id: 'booking-1',
          charge_type: 'prepaid_event',
          payment_provider: 'paypal',
          amount: 160,
          currency: 'GBP',
          status: 'succeeded',
          paypal_capture_id: 'CAPTURE-160',
          metadata: {},
          created_at: '2026-09-01T10:00:00.000Z',
        }],
      })
    }

    function refundsTo(db: ReturnType<typeof createFakeSupabase>) {
      let n = 0
      ;(refundPayPalPayment as unknown as Mock).mockImplementation(async (_capture: string, amount: number) => {
        n++
        return { refundId: `RFD-${n}`, status: 'COMPLETED', amount: amount.toFixed(2) }
      })
      ;(recordAnalyticsEvent as unknown as Mock).mockResolvedValue(undefined)
      return () => db.tables.payments.filter((row) => row.charge_type === 'refund')
    }

    it('makes two PayPal refunds totalling £80 for two £40 manual refunds on a £160 capture', async () => {
      const db = paidBooking()
      const refundRows = refundsTo(db)

      for (const requestId of ['request-a', 'request-b']) {
        const result = await processEventRefund(db as any, {
          bookingId: 'booking-1',
          customerId: 'customer-1',
          eventId: 'event-1',
          amount: 40,
          reason: 'staff_manual_refund',
          metadata: { idempotency_key: `staff-manual-refund:booking-1:${requestId}` },
        })
        expect(result).toMatchObject({ status: 'succeeded', amount: 40 })
      }

      expect(refundPayPalPayment).toHaveBeenCalledTimes(2)
      // Two different PayPal request ids, or PayPal would answer the second with the first.
      const requestIds = (refundPayPalPayment as unknown as Mock).mock.calls.map((call) => call[2])
      expect(new Set(requestIds).size).toBe(2)
      expect(refundRows().reduce((sum, row) => sum + Number(row.amount), 0)).toBe(80)
      expect(db.tables.payments.find((row) => row.id === 'payment-1')?.status).toBe('partially_refunded')
    })

    it('replays, without calling PayPal again, a repeat of the same refund request', async () => {
      const db = paidBooking()
      const refundRows = refundsTo(db)
      const input = {
        bookingId: 'booking-1',
        customerId: 'customer-1',
        eventId: 'event-1',
        amount: 40,
        reason: 'staff_manual_refund',
        metadata: { idempotency_key: 'staff-manual-refund:booking-1:request-a' },
      }

      await processEventRefund(db as any, input)
      const repeat = await processEventRefund(db as any, input)

      expect(repeat).toMatchObject({ status: 'succeeded', amount: 40, reason: 'idempotent_replay' })
      expect(refundPayPalPayment).toHaveBeenCalledTimes(1)
      expect(refundRows()).toHaveLength(1)
    })

    it('refunds both of two seat reductions in the same refund band', async () => {
      const db = paidBooking()
      const refundRows = refundsTo(db)

      for (const change of ['4-3', '3-2']) {
        await processEventRefund(db as any, {
          bookingId: 'booking-1',
          customerId: 'customer-1',
          eventId: 'event-1',
          amount: 40,
          reason: 'seat_reduction_full',
          metadata: { idempotency_key: `guest-seat-reduction:booking-1:${change}:${change}-request` },
        })
      }

      expect(refundPayPalPayment).toHaveBeenCalledTimes(2)
      expect(refundRows()).toHaveLength(2)
    })

    it('never refunds more than is left on the capture', async () => {
      const db = paidBooking()
      refundsTo(db)

      await processEventRefund(db as any, {
        bookingId: 'booking-1', customerId: 'customer-1', eventId: 'event-1', amount: 150,
        reason: 'staff_manual_refund', metadata: { idempotency_key: 'k-1' },
      })
      const second = await processEventRefund(db as any, {
        bookingId: 'booking-1', customerId: 'customer-1', eventId: 'event-1', amount: 40,
        reason: 'staff_manual_refund', metadata: { idempotency_key: 'k-2' },
      })

      expect((refundPayPalPayment as unknown as Mock).mock.calls[1][1]).toBe(10)
      expect(second).toMatchObject({ status: 'manual_required', amount: 10, reason: 'partial_refund_only' })
    })
  })
})

