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
}))

vi.mock('@/lib/sms/customers', () => ({
  ensureCustomerForPhone: vi.fn(),
}))

vi.mock('@/lib/table-bookings/bookings', () => ({
  alignTableCardCaptureHoldToScheduledSend: vi.fn(),
  createTableCardCaptureToken: vi.fn(),
  mapTableBookingBlockedReason: vi.fn(() => 'no_table'),
  sendManagerTableBookingCreatedEmailIfAllowed: vi.fn(),
  sendSundayPreorderLinkSmsIfAllowed: vi.fn(),
  sendTableBookingCreatedSmsIfAllowed: vi.fn(),
}))

vi.mock('@/lib/table-bookings/sunday-preorder', () => ({
  saveSundayPreorderByBookingId: vi.fn(),
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
        if (fn === 'create_table_booking_v05') {
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
      },
      body: JSON.stringify({
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
})

