import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  getLondonDateIso: vi.fn(() => '2026-02-16'),
}))

vi.mock('@/lib/sms/customers', () => ({
  ensureCustomerForPhone: vi.fn(),
}))

vi.mock('@/lib/table-bookings/bookings', () => ({
  alignTablePaymentHoldToScheduledSend: vi.fn(),
  createTablePaymentToken: vi.fn(),
  mapTableBookingBlockedReason: vi.fn(() => 'no_table'),
  sendManagerTableBookingCreatedEmailIfAllowed: vi.fn(),
  sendTableBookingCreatedSmsIfAllowed: vi.fn(),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
}))

import { requireFohPermission } from '@/lib/foh/api-auth'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { logger } from '@/lib/logger'
import { POST } from '@/app/api/foh/bookings/route'
import {
  FOH_BOOKING_CLIENT_CONTRACT,
  FOH_BOOKING_CLIENT_HEADER,
} from '@/lib/foh/booking-client-contract'

function makeThenable(result: any) {
  const builder: any = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    in: vi.fn(() => builder),
    lt: vi.fn(() => builder),
    gt: vi.fn(() => builder),
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

describe('FOH bookings walk-in override cleanup guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('logs cleanup failures and cancels orphan booking when manual walk-in override cannot claim tables', async () => {
    ;(ensureCustomerForPhone as unknown as vi.Mock).mockResolvedValue({
      customerId: 'customer-1',
      resolutionError: undefined,
    })

    const tableBookingsUpdate = vi.fn(() =>
      makeThenable({
        data: { id: 'tb-1' },
        error: null,
      })
    )

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'tables') {
          return makeThenable({
            data: [
              {
                id: 'table-1',
                table_number: '1',
                name: 'A',
                capacity: 4,
                is_bookable: true,
              },
            ],
            error: null,
          })
        }

        if (table === 'table_join_links') {
          return makeThenable({ data: [], error: null })
        }

        if (table === 'event_communal_seat_allocations') {
          // TP-01: the override allocator now excludes communal-event tables.
          return makeThenable({ data: [], error: null })
        }

        if (table === 'booking_table_assignments') {
          return {
            select: vi.fn(() =>
              makeThenable({
                data: [],
                error: null,
              })
            ),
            insert: vi.fn(() =>
              makeThenable({
                data: null,
                error: { code: '23P01', message: 'table_assignment_overlap' },
              })
            ),
            delete: vi.fn(() =>
              makeThenable({
                data: null,
                error: { message: 'db down' },
              })
            ),
          }
        }

        if (table === 'table_bookings') {
          return {
            insert: vi.fn(() =>
              makeThenable({
                data: { id: 'tb-1', booking_reference: 'TB-WTEST' },
                error: null,
              })
            ),
            delete: vi.fn(() =>
              makeThenable({
                data: null,
                error: { message: 'db down' },
              })
            ),
            update: tableBookingsUpdate,
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc: vi.fn((fn: string) => {
        if (fn === 'create_table_booking_staff_v06') {
          return Promise.resolve({
            data: {
              state: 'blocked',
              reason: 'outside_hours',
            },
            error: null,
          })
        }

        if (fn === 'is_table_blocked_by_private_booking_v05') {
          return Promise.resolve({ data: false, error: null })
        }

        throw new Error(`Unexpected rpc: ${fn}`)
      }),
    }

    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      userId: 'user-1',
      supabase,
    })

    const request = new Request('http://localhost/api/foh/bookings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [FOH_BOOKING_CLIENT_HEADER]: FOH_BOOKING_CLIENT_CONTRACT,
      },
      body: JSON.stringify({
        customer_mode: 'phone',
        phone: '+447700900111',
        walk_in: true,
        date: '2026-02-16',
        time: '12:00',
        party_size: 2,
        purpose: 'food',
      }),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          state: 'blocked',
          reason: 'no_table',
        }),
      })
    )

    expect(tableBookingsUpdate).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      'Walk-in override cleanup failed after table assignment race',
      expect.objectContaining({
        metadata: expect.objectContaining({
          tableBookingId: 'tb-1',
          errors: expect.arrayContaining([
            'booking_table_assignments_delete:db down',
            'table_bookings_delete:db down',
          ]),
        }),
      })
    )
  })

  it('passes a kitchen-hours refusal of the fallback insert through, and removes the made-up walk-in customer', async () => {
    // The guard raises on the raw insert too, and the fallback rethrows the PostgREST error
    // object as it is. That object is not an Error, which is why it used to be logged as
    // "Unknown walk-in override error" and answered with a generic 500.
    const kitchenNotServing = {
      code: '22023',
      message: 'The kitchen is not serving at 21:30 on 16 Feb 2026. Please choose a time inside a food service.',
      details: null,
      hint: null,
    }

    const customerDeleteBuilder = makeThenable({ data: null, error: null })
    const customersDelete = vi.fn(() => customerDeleteBuilder)

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'customers') {
          return {
            insert: vi.fn(() => makeThenable({ data: { id: 'walk-in-1' }, error: null })),
            delete: customersDelete,
          }
        }
        if (table === 'tables') {
          return makeThenable({
            data: [{ id: 'table-1', table_number: '1', name: 'A', capacity: 4, is_bookable: true }],
            error: null,
          })
        }
        if (table === 'table_join_links' || table === 'event_communal_seat_allocations' || table === 'bookings') {
          return makeThenable({ data: [], error: null })
        }
        if (table === 'booking_table_assignments') {
          return { select: vi.fn(() => makeThenable({ data: [], error: null })) }
        }
        if (table === 'table_bookings') {
          return {
            insert: vi.fn(() => makeThenable({ data: null, error: kitchenNotServing })),
            // The tidy-up's check that no booking refers to the customer.
            select: vi.fn(() => makeThenable({ data: [], error: null })),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc: vi.fn((fn: string) => {
        if (fn === 'create_table_booking_staff_v06') {
          return Promise.resolve({ data: { state: 'blocked', reason: 'outside_hours' }, error: null })
        }
        if (fn === 'is_table_blocked_by_private_booking_v05') {
          return Promise.resolve({ data: false, error: null })
        }
        throw new Error(`Unexpected rpc: ${fn}`)
      }),
    }

    ;(requireFohPermission as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      userId: 'user-1',
      supabase,
    })

    const request = new Request('http://localhost/api/foh/bookings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [FOH_BOOKING_CLIENT_HEADER]: FOH_BOOKING_CLIENT_CONTRACT,
      },
      body: JSON.stringify({
        customer_mode: 'anonymous',
        walk_in: true,
        walk_in_guest_name: 'Walk in',
        date: '2026-02-16',
        time: '21:30',
        party_size: 2,
        purpose: 'food',
      }),
    })

    const nextRequestLike = Object.assign(request, { nextUrl: new URL(request.url) })
    const response = await POST(nextRequestLike as any)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: kitchenNotServing.message })
    expect(customersDelete).toHaveBeenCalledTimes(1)
    expect(customerDeleteBuilder.eq).toHaveBeenCalledWith('id', 'walk-in-1')
  })
})
