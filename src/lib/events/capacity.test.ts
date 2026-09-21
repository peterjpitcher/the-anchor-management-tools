import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { attachEventCapacity } from './capacity'

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))

describe('event physical availability', () => {
  it('keeps historical limits separate and batches the live availability read', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ event_id: 'event', capacity: 49, communal_seated_capacity: 39, standing_capacity: 10, seated_remaining: 0, standing_remaining: 7 }], error: null })
    const result = await attachEventCapacity({ rpc } as unknown as SupabaseClient, [{ id: 'event', capacity: 100 }])
    expect(rpc).toHaveBeenCalledWith('get_event_capacity_snapshot_v05', { p_event_ids: ['event'] })
    expect(result[0]).toMatchObject({ capacity: 100, resolved_capacity: 49, resolved_seated_capacity: 39, resolved_standing_capacity: 10, seated_remaining: 0, standing_remaining: 7, capacity_unavailable: false })
  })

  it.each([{ data: null, error: { message: 'offline' } }, { data: [], error: null }])('does not fall back to a stored capacity on failure or a missing row', async response => {
    const rpc = vi.fn().mockResolvedValue(response)
    const [event] = await attachEventCapacity({ rpc } as unknown as SupabaseClient, [{ id: 'event', capacity: 100 }])
    expect(event).toMatchObject({ capacity: 100, resolved_capacity: null, seated_remaining: null, capacity_unavailable: true })
  })

  it('preserves a resolved zero rather than treating it as unlimited', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ event_id: 'event', capacity: 0, seated_remaining: 0, standing_capacity: 0 }], error: null })
    const [event] = await attachEventCapacity({ rpc } as unknown as SupabaseClient, [{ id: 'event', capacity: 100 }])
    expect(event.resolved_capacity).toBe(0)
    expect(event.capacity_unavailable).toBe(false)
  })
})
