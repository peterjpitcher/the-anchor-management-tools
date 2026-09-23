import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { handleRefundEvent } from '@/lib/paypal-refund-webhook'

/**
 * A refund is two writes: the refund row, then the booking summary. The row goes first, so a
 * failure in between left a refunded booking reading as paid, and the retry used to see a
 * completed refund and skip the repair for good. Recovery has to converge, not acknowledge.
 */

type Row = Record<string, any>

function refundEvent(overrides: Row = {}): Row {
  return {
    id: 'WH-REFUND-1',
    event_type: 'PAYMENT.CAPTURE.REFUNDED',
    resource: {
      id: 'REFUND-1',
      status: 'COMPLETED',
      amount: { value: '100.00', currency_code: 'GBP' },
      links: [{ rel: 'up', href: 'https://api-m.paypal.com/v2/payments/captures/CAPTURE-1' }],
      ...overrides,
    },
  }
}

/**
 * Minimal Supabase stand-in. Each `from(table)` call returns a chainable builder; terminal
 * calls resolve with whatever the table's script says.
 */
function makeSupabase(script: {
  existingRefund?: Row | null
  completedRefundRows?: Row[]
}) {
  const bookingUpdates: Row[] = []
  const refundUpdates: Row[] = []
  const refundInserts: Row[] = []

  function builder(table: string): any {
    const state: Row = { table, filters: {} }
    const chain: any = {
      select(columns?: string) {
        state.columns = columns
        return chain
      },
      eq(column: string, value: unknown) {
        state.filters[column] = value
        return chain
      },
      update(values: Row) {
        state.update = values
        if (table === 'payment_refunds') refundUpdates.push(values)
        else bookingUpdates.push({ table, values })
        return chain
      },
      insert(values: Row) {
        if (table === 'payment_refunds') refundInserts.push(values)
        return Promise.resolve({ error: null })
      },
      async maybeSingle() {
        if (table === 'payment_refunds') {
          return { data: script.existingRefund ?? null, error: null }
        }
        return { data: { id: 'source-1', deposit_amount: 100 }, error: null }
      },
      // A select with no maybeSingle resolves to the list (the completed-refund sum).
      then(resolve: (value: unknown) => unknown) {
        if (table === 'payment_refunds' && state.columns === 'amount') {
          return Promise.resolve({ data: script.completedRefundRows ?? [], error: null }).then(resolve)
        }
        return Promise.resolve({ data: null, error: null }).then(resolve)
      },
    }
    return chain
  }

  return {
    client: { from: vi.fn((table: string) => builder(table)) } as any,
    bookingUpdates,
    refundUpdates,
    refundInserts,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('handleRefundEvent recovery', () => {
  it('reconverges the booking when a completed refund is redelivered', async () => {
    const supabase = makeSupabase({
      existingRefund: {
        id: 'refund-row-1',
        source_type: 'table_booking',
        source_id: 'booking-1',
        status: 'completed',
        paypal_status: 'COMPLETED',
        original_amount: 100,
      },
      completedRefundRows: [{ amount: 100 }],
    })

    await handleRefundEvent(supabase.client, refundEvent(), 'table_booking')

    // It must NOT write the refund row again, and it must repair the booking.
    expect(supabase.refundUpdates).toHaveLength(0)
    expect(supabase.refundInserts).toHaveLength(0)
    expect(supabase.bookingUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'table_bookings',
          values: expect.objectContaining({ deposit_refund_status: 'refunded' }),
        }),
      ]),
    )
  })

  it('converges to partially_refunded when only part of the deposit came back', async () => {
    const supabase = makeSupabase({
      existingRefund: {
        id: 'refund-row-1',
        source_type: 'private_booking',
        source_id: 'booking-2',
        status: 'completed',
        paypal_status: 'COMPLETED',
        original_amount: 100,
      },
      completedRefundRows: [{ amount: 40 }],
    })

    await handleRefundEvent(supabase.client, refundEvent(), 'private_booking')

    expect(supabase.bookingUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'private_bookings',
          values: expect.objectContaining({ deposit_refund_status: 'partially_refunded' }),
        }),
      ]),
    )
  })

  it('still marks an outstanding refund completed on first delivery', async () => {
    const supabase = makeSupabase({
      existingRefund: {
        id: 'refund-row-1',
        source_type: 'private_booking',
        source_id: 'booking-3',
        status: 'pending',
        paypal_status: 'PENDING',
        original_amount: 100,
      },
      completedRefundRows: [{ amount: 100 }],
    })

    await handleRefundEvent(supabase.client, refundEvent(), 'private_booking')

    expect(supabase.refundUpdates).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'completed' })]),
    )
  })
})
