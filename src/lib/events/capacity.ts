import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'

export interface EventCapacityFields {
  resolved_capacity: number | null
  resolved_seated_capacity: number | null
  resolved_standing_capacity: number | null
  seated_remaining: number | null
  standing_remaining: number | null
  capacity_unavailable: boolean
}

export interface EventCapacitySnapshot {
  event_id: string
  capacity: number | null
  communal_seated_capacity: number | null
  standing_capacity: number | null
  seated_remaining: number | null
  standing_remaining: number | null
  seats_remaining: number | null
  total_remaining: number | null
  is_full: boolean
}

/** Keep stored event limits separate from time-dependent physical availability. */
export async function attachEventCapacity<T extends { id: string }>(
  client: SupabaseClient,
  events: T[],
): Promise<Array<T & EventCapacityFields>> {
  if (events.length === 0) return []
  const byId = new Map<string, EventCapacitySnapshot>()
  try {
    const { data, error } = await client.rpc('get_event_capacity_snapshot_v05', {
      p_event_ids: events.map(event => event.id),
    })
    if (error) throw error
    for (const row of (data ?? []) as EventCapacitySnapshot[]) byId.set(row.event_id, row)
  } catch (error) {
    logger.error('Unable to load event seating availability', {
      error: error instanceof Error ? error : new Error('Event capacity query failed'),
    })
  }
  return events.map(event => {
    const row = byId.get(event.id)
    return {
      ...event,
      resolved_capacity: row?.capacity ?? null,
      resolved_seated_capacity: row?.communal_seated_capacity ?? row?.capacity ?? null,
      resolved_standing_capacity: row?.standing_capacity ?? null,
      seated_remaining: row?.seated_remaining ?? null,
      standing_remaining: row?.standing_remaining ?? null,
      capacity_unavailable: !row,
    }
  })
}
