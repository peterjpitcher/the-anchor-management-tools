import { beforeEach, describe, expect, it, vi } from 'vitest'

// The FOH walk-in override inserts into `table_bookings` directly instead of going through
// create_table_booking_core_v06, which is the only place that ever wrote an outside_reservations
// row. An outside walk-in therefore held nothing: the garden could be handed out any number of
// times and availability went on saying yes. It now calls sync_outside_reservation explicitly,
// because the reconciling trigger fires on UPDATE only (by design, see
// 20260802000008_outside_reservation_sync.sql).

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn(),
}))

vi.mock('@/lib/sms/customers', () => ({
  ensureCustomerForPhone: vi.fn(),
}))

vi.mock('@/lib/table-bookings/bookings', () => ({
  alignTablePaymentHoldToScheduledSend: vi.fn(),
  createTablePaymentToken: vi.fn(),
  mapTableBookingBlockedReason: vi.fn(() => 'no_table'),
  sendManagerTableBookingCreatedEmailIfAllowed: vi.fn(async () => ({ sent: true })),
  sendTableBookingCreatedSmsIfAllowed: vi.fn(async () => ({ sent: true })),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
}))

import { requireFohPermission } from '@/lib/foh/api-auth'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { logger } from '@/lib/logger'
import { POST } from '@/app/api/foh/bookings/route'

function makeThenable(result: any) {
  const builder: any = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    in: vi.fn(() => builder),
    lt: vi.fn(() => builder),
    gt: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    update: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    single: vi.fn(() => Promise.resolve(result)),
    then: (onFulfilled: any, onRejected: any) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  }
  return builder
}

// The staff RPC refuses on hours, which is exactly what sends a walk-in down the override path.
function buildSupabase(options: { syncError?: { message: string } } = {}) {
  const rpc = vi.fn((fn: string) => {
    if (fn === 'create_table_booking_staff_v06') {
      return Promise.resolve({
        data: { state: 'blocked', reason: 'outside_hours' },
        error: null,
      })
    }
    if (fn === 'reserve_high_chairs') {
      return Promise.resolve({ data: 1, error: null })
    }
    if (fn === 'sync_outside_reservation') {
      return Promise.resolve({ data: null, error: options.syncError ?? null })
    }
    return Promise.resolve({ data: null, error: null })
  })

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'table_bookings') {
        return {
          insert: vi.fn(() =>
            makeThenable({
              data: { id: 'tb-outside-1', booking_reference: 'TB-OUTSIDE' },
              error: null,
            })
          ),
          select: vi.fn(() => makeThenable({ data: [], error: null })),
          update: vi.fn(() => makeThenable({ data: null, error: null })),
          delete: vi.fn(() => makeThenable({ data: null, error: null })),
        }
      }
      return makeThenable({ data: [], error: null })
    }),
    rpc,
  }

  return { supabase, rpc }
}

function outsideWalkInRequest() {
  const request = new Request('http://localhost/api/foh/bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      phone: '+447700900222',
      walk_in: true,
      date: '2026-02-16',
      time: '12:00',
      party_size: 4,
      purpose: 'drinks',
      outside_seating: true,
      high_chair_count: 1,
    }),
  })
  return Object.assign(request, { nextUrl: new URL(request.url) })
}

describe('FOH outside walk-in override', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(ensureCustomerForPhone as unknown as vi.Mock).mockResolvedValue({
      customerId: 'customer-1',
      resolutionError: undefined,
    })
  })

  it('records the outside table the booking occupies', async () => {
    const { supabase, rpc } = buildSupabase()
    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      userId: 'user-1',
      supabase,
    })

    const response = await POST(outsideWalkInRequest() as any)
    const payload = await response.json()

    expect(response.status).toBe(201)
    // Outside holds no indoor table, so there is no table name to report.
    expect(payload.data).toEqual(
      expect.objectContaining({
        state: 'confirmed',
        table_booking_id: 'tb-outside-1',
        table_name: null,
      })
    )

    expect(rpc).toHaveBeenCalledWith('sync_outside_reservation', {
      p_table_booking_id: 'tb-outside-1',
    })

    // The chair is a separate pool from the seat, and both are claimed.
    expect(rpc).toHaveBeenCalledWith(
      'reserve_high_chairs',
      expect.objectContaining({ p_booking_id: 'tb-outside-1', p_requested: 1 })
    )
  })

  it('never turns a walk-in away when the reservation row cannot be written', async () => {
    const { supabase, rpc } = buildSupabase({ syncError: { message: 'db down' } })
    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      userId: 'user-1',
      supabase,
    })

    const response = await POST(outsideWalkInRequest() as any)
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload.data).toEqual(expect.objectContaining({ state: 'confirmed' }))
    expect(rpc).toHaveBeenCalledWith('sync_outside_reservation', {
      p_table_booking_id: 'tb-outside-1',
    })
    expect(logger.warn).toHaveBeenCalledWith(
      'sync_outside_reservation failed for outside walk-in override',
      expect.objectContaining({
        metadata: expect.objectContaining({ tableBookingId: 'tb-outside-1', error: 'db down' }),
      })
    )
  })

  it('leaves an indoor walk-in alone', async () => {
    const { rpc } = buildSupabase()
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'tables') {
          return makeThenable({
            data: [{ id: 'table-1', table_number: '1', name: 'A', capacity: 4, is_bookable: true }],
            error: null,
          })
        }
        if (table === 'table_bookings') {
          return {
            insert: vi.fn(() =>
              makeThenable({ data: { id: 'tb-inside-1', booking_reference: 'TB-IN' }, error: null })
            ),
            select: vi.fn(() => makeThenable({ data: [], error: null })),
            update: vi.fn(() => makeThenable({ data: null, error: null })),
            delete: vi.fn(() => makeThenable({ data: null, error: null })),
          }
        }
        if (table === 'booking_table_assignments') {
          return {
            select: vi.fn(() => makeThenable({ data: [], error: null })),
            insert: vi.fn(() => makeThenable({ data: null, error: null })),
            delete: vi.fn(() => makeThenable({ data: null, error: null })),
          }
        }
        return makeThenable({ data: [], error: null })
      }),
      rpc,
    }

    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      userId: 'user-1',
      supabase,
    })

    const request = new Request('http://localhost/api/foh/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        phone: '+447700900333',
        walk_in: true,
        date: '2026-02-16',
        time: '12:00',
        party_size: 2,
        purpose: 'drinks',
      }),
    })

    await POST(Object.assign(request, { nextUrl: new URL(request.url) }) as any)

    const syncCalls = rpc.mock.calls.filter((call) => call[0] === 'sync_outside_reservation')
    expect(syncCalls).toHaveLength(0)
  })
})
