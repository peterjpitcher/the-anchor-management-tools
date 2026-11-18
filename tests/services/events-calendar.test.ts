import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { EventService } from '@/services/events'
import { buildEventBookingStats } from '@/lib/events/stats'

type Chain = Record<string, ReturnType<typeof vi.fn>>

function createCalendarClient(rows: Record<string, unknown>[], error: unknown = null): { client: SupabaseClient; chain: Chain } {
  const chain: Chain = {}
  chain.select = vi.fn(() => chain)
  chain.gte = vi.fn(() => chain)
  chain.lte = vi.fn(() => chain)
  let orders = 0
  chain.order = vi.fn(() => {
    orders += 1
    return orders >= 2 ? Promise.resolve({ data: error ? null : rows, error }) : chain
  })
  return { client: { from: vi.fn(() => chain) } as unknown as SupabaseClient, chain }
}

const bookings = [
  { seats: 3, status: 'confirmed' },
  { seats: 4, status: 'pending_payment', hold_expires_at: '2099-01-01T00:00:00Z' },
  { seats: 5, status: 'pending_payment', hold_expires_at: '2000-01-01T00:00:00Z' },
  { seats: 6, status: 'cancelled' },
  { seats: 2, status: 'confirmed', is_reminder_only: true },
  { seats: 1, status: 'no_show' },
]

describe('EventService.getCalendarEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads only the calendar columns for the window, with no link or capacity reads', async () => {
    const { client, chain } = createCalendarClient([
      { id: 'e1', name: 'Quiz', date: '2026-12-03', time: '19:00', bookings },
    ])
    vi.mocked(createClient).mockResolvedValue(client)

    const rows = await EventService.getCalendarEvents({ dateFrom: '2025-11-01', dateTo: '2027-11-30' })

    const selected = chain.select.mock.calls[0][0] as string
    expect(selected).not.toContain('*')
    expect(selected).toContain('bookings:bookings(seats, status, is_reminder_only, hold_expires_at)')
    expect(chain.gte).toHaveBeenCalledWith('date', '2025-11-01')
    expect(chain.lte).toHaveBeenCalledWith('date', '2027-11-30')
    expect(createAdminClient).not.toHaveBeenCalled()

    // Same figure getEvents reports: totalSeats from the embedded bookings.
    expect(rows[0].booked_count).toBe(buildEventBookingStats({}, bookings, []).totalSeats)
    expect(rows[0].booked_count).toBe(8)
    expect(rows[0]).not.toHaveProperty('bookings')
  })

  it('throws when the read fails', async () => {
    const { client } = createCalendarClient([], { message: 'boom' })
    vi.mocked(createClient).mockResolvedValue(client)

    await expect(EventService.getCalendarEvents({ dateFrom: '2026-01-01', dateTo: '2026-12-31' })).rejects.toThrow(
      'Failed to fetch events',
    )
  })
})
