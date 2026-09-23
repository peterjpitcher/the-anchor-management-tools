import { beforeEach, describe, expect, it, vi } from 'vitest'
import { routePayPalEvent } from '@/lib/paypal-webhook-router'

/**
 * PayPal delivers every event on the account to every registered webhook, so the URL an event
 * arrives on says nothing about whose it is. Everything depends on routing from the payload,
 * and on refusing to guess.
 *
 * The two failures this prevents are both real. The table-bookings route had no routing at all
 * and logged "success" for five captures that were really invoices and private bookings. The
 * parking route would have thrown on any capture that was not a parking booking, which with
 * PayPal retrying for three days means throwing forever.
 */

type TableScript = Record<string, Array<Record<string, any>>>

/** Minimal Supabase stand-in: each table answers with whatever the script holds. */
function makeSupabase(script: TableScript) {
  const seen: string[] = []

  const client = {
    from: vi.fn((table: string): any => {
      seen.push(table)
      const filters: Record<string, unknown> = {}
      const chain: any = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters[column] = value
          return chain
        },
        contains: (column: string, value: Record<string, unknown>) => {
          filters[column] = value
          return chain
        },
        limit: () => chain,
        maybeSingle: async () => {
          const rows = script[table] ?? []
          const match = rows.find((row) =>
            Object.entries(filters).every(([column, value]) => {
              if (column === 'metadata') {
                const wanted = value as Record<string, unknown>
                return Object.entries(wanted).every(([k, v]) => row.metadata?.[k] === v)
              }
              return row[column] === value
            }),
          )
          return { data: match ?? null, error: null }
        },
      }
      return chain
    }),
  }

  return { client: client as any, seen }
}

function capture(customId: string | null, orderId: string | null = null, eventType = 'PAYMENT.CAPTURE.COMPLETED') {
  const resource: Record<string, any> = {}
  if (customId !== null) resource.custom_id = customId
  if (orderId !== null) resource.supplementary_data = { related_ids: { order_id: orderId } }
  return { id: 'WH-1', event_type: eventType, resource }
}

function refund(refundId: string, captureId: string | null = null) {
  const resource: Record<string, any> = { id: refundId, status: 'COMPLETED' }
  if (captureId) {
    resource.links = [{ rel: 'up', href: `https://api-m.paypal.com/v2/payments/captures/${captureId}` }]
  }
  return { id: 'WH-R1', event_type: 'PAYMENT.CAPTURE.REFUNDED', resource }
}

const TABLE_UUID = '11111111-1111-4111-8111-111111111111'
const PARKING_UUID = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('routing a capture by custom_id prefix', () => {
  it.each([
    ['inv-pay-abc', 'invoices', 'abc'],
    ['pb-deposit-def', 'private_bookings', 'def'],
    ['event_booking:ghi', 'event_bookings', 'ghi'],
  ])('routes %s to %s without touching the database', async (customId, domain, key) => {
    const supabase = makeSupabase({})

    const decision = await routePayPalEvent(supabase.client, capture(customId))

    expect(decision).toMatchObject({ domain, key, via: 'custom_id_prefix' })
    expect(supabase.seen).toHaveLength(0)
  })

  it('does not route a prefix with no id after it', async () => {
    const supabase = makeSupabase({})
    const decision = await routePayPalEvent(supabase.client, capture('pb-deposit-'))
    expect(decision.domain).toBeNull()
  })
})

describe('routing a bare UUID custom_id', () => {
  // Table bookings and parking BOTH use a bare booking UUID, so a prefix cannot tell them apart.
  it('finds a table booking', async () => {
    const supabase = makeSupabase({ table_bookings: [{ id: TABLE_UUID }] })

    const decision = await routePayPalEvent(supabase.client, capture(TABLE_UUID))

    expect(decision).toMatchObject({ domain: 'table_bookings', key: TABLE_UUID, via: 'custom_id_lookup' })
  })

  it('falls through to parking when no table booking has that id', async () => {
    const supabase = makeSupabase({ table_bookings: [], parking_bookings: [{ id: PARKING_UUID }] })

    const decision = await routePayPalEvent(supabase.client, capture(PARKING_UUID))

    expect(decision).toMatchObject({ domain: 'parking', key: PARKING_UUID, via: 'custom_id_lookup' })
  })

  it('refuses to guess when a UUID matches neither', async () => {
    const supabase = makeSupabase({ table_bookings: [], parking_bookings: [] })

    const decision = await routePayPalEvent(supabase.client, capture(TABLE_UUID))

    expect(decision.domain).toBeNull()
  })
})

describe('routing by order id when there is no usable custom_id', () => {
  it('finds a table booking by its deposit order id', async () => {
    const supabase = makeSupabase({
      table_bookings: [{ id: TABLE_UUID, paypal_deposit_order_id: 'ORDER-1' }],
    })

    const decision = await routePayPalEvent(supabase.client, capture(null, 'ORDER-1'))

    expect(decision).toMatchObject({ domain: 'table_bookings', key: TABLE_UUID, via: 'order_id' })
  })

  it('finds an event booking through its payments row', async () => {
    const supabase = makeSupabase({
      table_bookings: [],
      payments: [{
        event_booking_id: 'booking-9',
        paypal_order_id: 'ORDER-2',
        payment_provider: 'paypal',
        charge_type: 'prepaid_event',
      }],
    })

    const decision = await routePayPalEvent(supabase.client, capture(null, 'ORDER-2'))

    expect(decision).toMatchObject({ domain: 'event_bookings', key: 'booking-9', via: 'order_id' })
  })
})

describe('events that are not ours', () => {
  it('reports an unplaceable capture rather than handing it to a domain', async () => {
    // This is the case that used to reach the table-booking and parking handlers.
    const supabase = makeSupabase({ table_bookings: [], parking_bookings: [], payments: [] })

    const decision = await routePayPalEvent(supabase.client, capture('someone-elses-reference', 'ORDER-X'))

    expect(decision).toMatchObject({ domain: null, via: 'unrouted' })
  })

  it('reports an event type nothing handles', async () => {
    const supabase = makeSupabase({})

    const decision = await routePayPalEvent(supabase.client, capture('pb-deposit-x', null, 'CHECKOUT.ORDER.APPROVED'))

    expect(decision).toMatchObject({ domain: null, via: 'unrouted' })
  })
})

describe('routing a refund', () => {
  it('uses the stored source_type on an existing refund row', async () => {
    const supabase = makeSupabase({
      payment_refunds: [{ paypal_refund_id: 'REF-1', source_type: 'parking', source_id: 'park-1' }],
    })

    const decision = await routePayPalEvent(supabase.client, refund('REF-1'))

    expect(decision).toMatchObject({ domain: 'parking', key: 'park-1', via: 'refund_lookup' })
  })

  it('finds an event ticket refund, which lives in payments rather than payment_refunds', async () => {
    const supabase = makeSupabase({
      payment_refunds: [],
      payments: [{
        event_booking_id: 'booking-4',
        charge_type: 'refund',
        metadata: { paypal_refund_id: 'REF-2' },
      }],
    })

    const decision = await routePayPalEvent(supabase.client, refund('REF-2'))

    expect(decision).toMatchObject({ domain: 'event_bookings', key: 'booking-4', via: 'refund_lookup' })
  })

  it('finds the booking that owns the refunded capture when the refund is new to us', async () => {
    // A refund raised in the PayPal dashboard: nothing of ours references it yet.
    const supabase = makeSupabase({
      payment_refunds: [],
      payments: [],
      private_bookings: [],
      table_bookings: [{ id: TABLE_UUID, paypal_deposit_capture_id: 'CAPTURE-7' }],
    })

    const decision = await routePayPalEvent(supabase.client, refund('REF-3', 'CAPTURE-7'))

    expect(decision).toMatchObject({ domain: 'table_bookings', key: TABLE_UUID, via: 'refund_lookup' })
  })

  it('reports a refund for a capture no booking of ours owns', async () => {
    const supabase = makeSupabase({
      payment_refunds: [], payments: [], private_bookings: [], table_bookings: [], parking_booking_payments: [],
    })

    const decision = await routePayPalEvent(supabase.client, refund('REF-4', 'CAPTURE-UNKNOWN'))

    expect(decision.domain).toBeNull()
  })
})
