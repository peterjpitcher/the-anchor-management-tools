import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/paypal', () => ({ refundPayPalPayment: vi.fn() }))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { refundPayPalPayment } from '@/lib/paypal'
import { processEventRefund, recordManualEventRefund } from '@/lib/events/manage-booking'
import { argsOf, called, createRecordingSupabase, type RecordedQuery } from '../mocks/recordingSupabase'

function containsArg(query: RecordedQuery, key: string): boolean {
  return argsOf(query, 'contains').some((args) => typeof args[1] === 'object' && args[1] !== null && key in (args[1] as object))
}

describe('processEventRefund when nothing is left to refund (BK-136)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reports a success of nothing, not a refund needing staff follow-up', async () => {
    const db = createRecordingSupabase({
      tables: {
        payments: (query) => {
          if (containsArg(query, 'idempotency_key')) return { data: [], error: null }
          if (containsArg(query, 'source_payment_id')) return { data: [{ amount: 40 }], error: null }
          return { data: [{ id: 'payment-1', amount: 40, currency: 'GBP', paypal_capture_id: 'CAP-1' }], error: null }
        },
      },
    })

    const result = await processEventRefund(db.client as never, {
      bookingId: 'booking-1', customerId: 'customer-1', eventId: 'event-1', amount: 40, reason: 'event_cancelled',
      sourcePaymentId: 'payment-1', metadata: { idempotency_key: 'event-cancelled-refund:payment-1' },
    })

    expect(result).toEqual({ status: 'succeeded', amount: 0, currency: 'GBP', reason: 'nothing_left_to_refund' })
    expect(refundPayPalPayment).not.toHaveBeenCalled()
  })
})

describe('recordManualEventRefund (BK-135)', () => {
  beforeEach(() => vi.clearAllMocks())

  function setUp(options: { prior?: unknown[]; payments: unknown[]; refundedSoFar?: number }) {
    return createRecordingSupabase({
      tables: {
        payments: (query) => {
          if (called(query, 'insert') || called(query, 'update')) return { data: null, error: null }
          if (containsArg(query, 'idempotency_key')) return { data: options.prior ?? [], error: null }
          if (containsArg(query, 'source_payment_id')) return { data: options.refundedSoFar ? [{ amount: options.refundedSoFar }] : [], error: null }
          return { data: options.payments, error: null }
        },
      },
    })
  }

  const inserts = (db: ReturnType<typeof createRecordingSupabase>) =>
    db.queries.filter((q) => q.table === 'payments' && called(q, 'insert')).map((q) => argsOf(q, 'insert')[0][0] as Record<string, unknown>)
  const updates = (db: ReturnType<typeof createRecordingSupabase>) =>
    db.queries.filter((q) => q.table === 'payments' && called(q, 'update')).map((q) => argsOf(q, 'update')[0][0] as Record<string, unknown>)

  it('records a cash refund against the bar payment and marks the payment refunded', async () => {
    const db = setUp({ payments: [{ id: 'payment-cash', amount: 45, currency: 'GBP' }] })

    const result = await recordManualEventRefund(db.client as never, {
      bookingId: 'booking-1', amount: 45, method: 'cash', reason: 'staff_manual_refund',
      idempotencyKey: 'staff-manual-refund:booking-1:req-1', recordedBy: 'manager-1', note: 'Handed back at the bar',
    })

    expect(result).toEqual({ status: 'succeeded', amount: 45, currency: 'GBP', reason: undefined })
    expect(inserts(db)).toEqual([expect.objectContaining({
      event_booking_id: 'booking-1', charge_type: 'refund', payment_provider: 'manual', payment_method: 'cash', amount: 45, status: 'refunded',
      metadata: expect.objectContaining({ source_payment_id: 'payment-cash', recorded_by: 'manager-1', idempotency_key: 'staff-manual-refund:booking-1:req-1' }),
    })])
    expect(updates(db)).toEqual([expect.objectContaining({ status: 'refunded' })])
    expect(refundPayPalPayment).not.toHaveBeenCalled()
  })

  it('marks a part refund on a card payment as partially refunded', async () => {
    const db = setUp({ payments: [{ id: 'payment-card', amount: 90, currency: 'GBP' }] })

    await recordManualEventRefund(db.client as never, {
      bookingId: 'booking-1', amount: 45, method: 'card_terminal', reason: 'staff_manual_refund', idempotencyKey: 'k-2', recordedBy: 'manager-1',
    })

    expect(inserts(db)[0]).toMatchObject({ payment_method: 'card_terminal', amount: 45 })
    expect(updates(db)).toEqual([expect.objectContaining({ status: 'partially_refunded' })])
  })

  it('never records more than the bar payment still holds', async () => {
    const db = setUp({ payments: [{ id: 'payment-cash', amount: 45, currency: 'GBP' }], refundedSoFar: 30 })

    const result = await recordManualEventRefund(db.client as never, {
      bookingId: 'booking-1', amount: 45, method: 'cash', reason: 'staff_manual_refund', idempotencyKey: 'k-3', recordedBy: 'manager-1',
    })

    expect(result).toMatchObject({ status: 'manual_required', amount: 15, reason: 'partial_refund_only' })
    expect(inserts(db)[0]).toMatchObject({ amount: 15 })
  })

  it('replays an earlier record with the same key instead of recording twice', async () => {
    const db = setUp({ prior: [{ id: 'refund-1', amount: 45, currency: 'GBP', status: 'refunded' }], payments: [{ id: 'payment-cash', amount: 45 }] })

    const result = await recordManualEventRefund(db.client as never, {
      bookingId: 'booking-1', amount: 45, method: 'cash', reason: 'staff_manual_refund', idempotencyKey: 'k-4', recordedBy: 'manager-1',
    })

    expect(result).toMatchObject({ status: 'succeeded', amount: 45, reason: 'idempotent_replay' })
    expect(inserts(db)).toEqual([])
  })

  it('says so when the booking has no bar payment to refund', async () => {
    const db = setUp({ payments: [] })

    const result = await recordManualEventRefund(db.client as never, {
      bookingId: 'booking-1', amount: 40, method: 'cash', reason: 'staff_manual_refund', idempotencyKey: 'k-5', recordedBy: 'manager-1',
    })

    expect(result).toMatchObject({ status: 'manual_required', reason: 'no_bar_payment_to_refund' })
    expect(inserts(db)).toEqual([])
  })
})
