import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/paypal', () => ({ refundPayPalPayment: vi.fn() }))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { refundPayPalPayment } from '@/lib/paypal'
import { processEventRefund, recordManualEventRefund } from '@/lib/events/manage-booking'
import { argsOf, createRecordingSupabase, type RecordedQuery } from '../mocks/recordingSupabase'

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

  // The balance check and the refund rows are one database transaction (review finding on PR 277),
  // record_manual_event_refund_v01, whose locking and replay the Postgres harness proves. Here: the
  // app sends it everything and reads its answer back, and never writes refund rows itself.
  function setUp(answer: unknown) {
    return createRecordingSupabase({ rpc: () => ({ data: answer, error: null }) })
  }

  it('records the refund in one database call with the key, method and who recorded it', async () => {
    const db = setUp({ status: 'succeeded', amount: 45 })

    const result = await recordManualEventRefund(db.client as never, {
      bookingId: 'booking-1', amount: 45, method: 'cash', reason: 'staff_manual_refund',
      idempotencyKey: 'staff-manual-refund:booking-1:req-1', recordedBy: 'manager-1', note: 'Handed back at the bar',
      metadata: { max_refundable: 45 },
    })

    expect(result).toEqual({ status: 'succeeded', amount: 45, currency: 'GBP', reason: undefined })
    expect(db.rpc).toHaveBeenCalledWith('record_manual_event_refund_v01', {
      p_booking_id: 'booking-1', p_amount: 45, p_method: 'cash', p_reason: 'staff_manual_refund',
      p_idempotency_key: 'staff-manual-refund:booking-1:req-1', p_recorded_by: 'manager-1', p_note: 'Handed back at the bar',
      p_metadata: { max_refundable: 45 },
    })
    expect(db.queries).toEqual([])
    expect(refundPayPalPayment).not.toHaveBeenCalled()
  })

  it('passes back a replay and a short refund as the database answered', async () => {
    expect(await recordManualEventRefund(setUp({ status: 'succeeded', amount: '45.00', reason: 'idempotent_replay' }).client as never, {
      bookingId: 'booking-1', amount: 45, method: 'card_terminal', reason: 'staff_manual_refund', idempotencyKey: 'k', recordedBy: null,
    })).toEqual({ status: 'succeeded', amount: 45, currency: 'GBP', reason: 'idempotent_replay' })
    expect(await recordManualEventRefund(setUp({ status: 'manual_required', amount: 15, reason: 'partial_refund_only' }).client as never, {
      bookingId: 'booking-1', amount: 45, method: 'cash', reason: 'staff_manual_refund', idempotencyKey: 'k2', recordedBy: null,
    })).toMatchObject({ status: 'manual_required', amount: 15, reason: 'partial_refund_only' })
  })

  it('records nothing for a zero amount', async () => {
    const db = setUp(null)
    expect(await recordManualEventRefund(db.client as never, {
      bookingId: 'booking-1', amount: 0, method: 'cash', reason: 'staff_manual_refund', idempotencyKey: 'k3', recordedBy: null,
    })).toEqual({ status: 'none', amount: 0, currency: 'GBP' })
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('throws when the database call fails, so the dialog says the refund was not recorded', async () => {
    const db = createRecordingSupabase({ rpc: () => ({ data: null, error: { message: 'deadlock detected' } }) })
    await expect(recordManualEventRefund(db.client as never, {
      bookingId: 'booking-1', amount: 45, method: 'cash', reason: 'staff_manual_refund', idempotencyKey: 'k4', recordedBy: null,
    })).rejects.toMatchObject({ message: 'deadlock detected' })
  })
})
