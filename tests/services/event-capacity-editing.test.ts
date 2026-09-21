import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { EventService, eventSchema, type CreateEventInput } from '@/services/events'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

const base: CreateEventInput = { name: 'Fixture event', date: '2099-09-25', time: '19:00', event_status: 'draft', is_free: true, payment_mode: 'free' }

function clientFor(current: Record<string, unknown> | null, activeBookings = 0) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'Fixture stops before mutation' } })
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: current, error: null }),
    in: vi.fn().mockResolvedValue({ count: activeBookings, error: null }),
  }
  const from = vi.fn(() => chain)
  vi.mocked(createClient).mockResolvedValue({ from, rpc } as unknown as SupabaseClient)
  return { rpc, from }
}

describe('event capacity editing guards', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['table', 'communal'] as const)('ignores manual/category seating limits when creating %s events', async (booking_mode) => {
    const { rpc } = clientFor(null)
    await expect(EventService.createEvent({ ...base, booking_mode, capacity: 500, seated_capacity: 200 })).rejects.toThrow('Failed to create event')
    expect(rpc).toHaveBeenCalledWith('create_event_transaction', expect.objectContaining({
      p_event_data: expect.objectContaining({ capacity: null, seated_capacity: null }),
    }))
    if (booking_mode === 'communal') expect(rpc.mock.calls[0][1].p_event_data.standing_capacity).toBe(0)
  })

  it('retains manual general admission limits', async () => {
    const { rpc } = clientFor(null)
    await expect(EventService.createEvent({ ...base, booking_mode: 'general', capacity: 75 })).rejects.toThrow('Failed to create event')
    expect(rpc.mock.calls[0][1].p_event_data.capacity).toBe(75)
  })

  it('rejects creating mixed events before any booking mutation', async () => {
    const { rpc } = clientFor(null)
    await expect(EventService.createEvent({ ...base, booking_mode: 'mixed' })).rejects.toThrow('Mixed booking mode')
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each(['table', 'communal', 'mixed'] as const)('preserves historic manual limits during %s edits and sends standing atomically', async (booking_mode) => {
    const { rpc } = clientFor({ ...base, id: 'event', booking_mode, capacity: 60, seated_capacity: 40 })
    await expect(EventService.updateEvent('event', { capacity: 900, seated_capacity: 900, standing_capacity: 0 })).rejects.toThrow('Failed to update event')
    const payload = rpc.mock.calls[0][1].p_event_data
    expect(payload).not.toHaveProperty('capacity')
    expect(payload).not.toHaveProperty('seated_capacity')
    expect(payload.standing_capacity).toBe(0)
  })

  it('does not turn a legacy null standing limit into zero on unrelated edits', async () => {
    const { rpc } = clientFor({ ...base, id: 'event', booking_mode: 'communal', standing_capacity: null })
    await expect(EventService.updateEvent('event', { name: 'Updated name' })).rejects.toThrow('Failed to update event')
    expect(rpc.mock.calls[0][1].p_event_data).not.toHaveProperty('standing_capacity')
  })

  it('defaults standing tickets to zero when an unbooked event changes to communal seating', async () => {
    const { rpc } = clientFor({ ...base, id: 'event', booking_mode: 'table', capacity: 60 })
    await expect(EventService.updateEvent('event', { booking_mode: 'communal' })).rejects.toThrow('Failed to update event')
    expect(rpc.mock.calls[0][1].p_event_data.standing_capacity).toBe(0)
  })

  it.each(['general', 'communal'] as const)('blocks table to %s when active bookings exist', async (booking_mode) => {
    const { rpc } = clientFor({ ...base, id: 'event', booking_mode: 'table' }, 1)
    await expect(EventService.updateEvent('event', { booking_mode })).rejects.toThrow('Cannot change booking mode')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects changing another mode to mixed but allows an existing mixed event to stay mixed', async () => {
    const first = clientFor({ ...base, id: 'event', booking_mode: 'table' })
    await expect(EventService.updateEvent('event', { booking_mode: 'mixed' })).rejects.toThrow('Mixed booking mode')
    expect(first.rpc).not.toHaveBeenCalled()
    const second = clientFor({ ...base, id: 'event', booking_mode: 'mixed' })
    await expect(EventService.updateEvent('event', { booking_mode: 'mixed', capacity: 75 })).rejects.toThrow('Failed to update event')
    expect(second.rpc.mock.calls[0][1].p_event_data.booking_mode).toBe('mixed')
    expect(second.rpc.mock.calls[0][1].p_event_data).not.toHaveProperty('capacity')
  })

  it.each([
    ['standing_capacity_below_bookings', 'The standing ticket limit cannot be lower than the standing tickets already reserved.'],
    ['event_mode_has_active_bookings', 'Cannot change booking mode while this event has active bookings.'],
  ])('explains the database rejection %s', async (message, expected) => {
    const { rpc } = clientFor({ ...base, id: 'event', booking_mode: 'communal' })
    rpc.mockResolvedValue({ data: null, error: { message } })
    await expect(EventService.updateEvent('event', { standing_capacity: 0 })).rejects.toThrow(expected)
  })

  it('validates whole standing tickets, including zero', () => {
    expect(eventSchema.partial().safeParse({ standing_capacity: 0 }).success).toBe(true)
    expect(eventSchema.partial().safeParse({ standing_capacity: -1 }).success).toBe(false)
    expect(eventSchema.partial().safeParse({ standing_capacity: 1.5 }).success).toBe(false)
    expect(eventSchema.partial().safeParse({ standing_capacity: 'not a number' }).success).toBe(false)
  })
})
