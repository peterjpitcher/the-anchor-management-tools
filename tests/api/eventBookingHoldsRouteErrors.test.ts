import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/google-calendar-events', () => ({
  syncPubOpsEventCalendarByEventId: vi.fn().mockResolvedValue({
    state: 'updated',
    eventId: 'event-1',
    googleEventId: 'google-event-id',
  }),
}))

import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncPubOpsEventCalendarByEventId } from '@/lib/google-calendar-events'
import { GET } from '@/app/api/cron/event-booking-holds/route'

describe('event booking holds route error payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a generic 500 payload when pending booking load fails', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })

    const limit = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'sensitive pending bookings diagnostics' },
    })
    const lte = vi.fn().mockReturnValue({ limit })
    const not = vi.fn().mockReturnValue({ lte })
    const eq = vi.fn().mockReturnValue({ not })
    const select = vi.fn().mockReturnValue({ eq })

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'bookings') {
          return { select }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    const response = await GET(new Request('http://localhost/api/cron/event-booking-holds') as any)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toEqual({ success: false, error: 'Failed to process hold expiry' })
  })

  it('syncs Pub Ops calendar entries for events with expired booking holds', async () => {
    ;(authorizeCronRequest as unknown as vi.Mock).mockReturnValue({ authorized: true })

    const responses = [
      { data: [{ id: 'booking-1', event_id: 'event-1' }], error: null },
      { data: [{ id: 'booking-1', event_id: 'event-1' }], error: null },
      { data: [{ id: 'hold-1' }], error: null },
      { data: null, error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ]

    const supabase = {
      from: vi.fn(() => {
        const builder: Record<string, vi.Mock> & {
          then?: Promise<{ data: unknown; error: unknown }>['then']
        } = {} as any
        const resolveNext = () => Promise.resolve(responses.shift() ?? { data: [], error: null })

        for (const method of ['select', 'eq', 'not', 'lte', 'limit', 'update', 'in', 'neq']) {
          builder[method] = vi.fn(() => builder)
        }
        builder.maybeSingle = vi.fn(resolveNext)
        builder.then = (resolve, reject) => resolveNext().then(resolve, reject)
        return builder
      }),
    }

    ;(createAdminClient as unknown as vi.Mock).mockReturnValue(supabase)

    const response = await GET(new Request('http://localhost/api/cron/event-booking-holds') as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      success: true,
      expiredPendingBookings: 1,
      expiredPaymentHolds: 1,
    })
    expect(syncPubOpsEventCalendarByEventId).toHaveBeenCalledWith(
      supabase,
      'event-1',
      { context: 'event_booking_hold_expired' },
    )
  })
})
