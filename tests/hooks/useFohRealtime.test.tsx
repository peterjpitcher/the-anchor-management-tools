import { renderHook } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The front-of-house screen watches the floor-plan tables live. customers, private_bookings and
 * private_booking_items were taken off the live feed (spec D1, 18 November 2026) because the
 * Realtime polling for them was the largest single cost on the database. These tests pin the
 * exact set of watched tables, and that the 60-second poll still picks up everything else.
 */

import { useFohRealtime } from '@/app/(authenticated)/table-bookings/foh/hooks/useFohRealtime'

type ChangeFilter = { event: string; schema: string; table: string; filter?: string }

function makeSupabase() {
  const subscriptions: ChangeFilter[] = []
  const handlers: Array<() => void> = []
  const channel = {
    on: vi.fn((_type: string, filter: ChangeFilter, handler: () => void) => {
      subscriptions.push(filter)
      handlers.push(handler)
      return channel
    }),
    subscribe: vi.fn(() => channel),
  }
  const client = {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(),
  }
  return { client: client as unknown as SupabaseClient, raw: client, subscriptions, handlers }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useFohRealtime', () => {
  it('subscribes only to the five floor-plan tables', () => {
    const { client, subscriptions } = makeSupabase()
    const reloadSchedule = vi.fn().mockResolvedValue(undefined)

    renderHook(() => useFohRealtime({ supabase: client, date: '2026-11-18', isDragging: false, reloadSchedule }))

    expect(subscriptions.map((s) => s.table).sort()).toEqual([
      'booking_table_assignments',
      'table_areas',
      'table_bookings',
      'tables',
      'venue_space_table_areas',
    ])
    for (const dropped of ['customers', 'private_bookings', 'private_booking_items']) {
      expect(subscriptions.some((s) => s.table === dropped)).toBe(false)
    }
    expect(subscriptions.find((s) => s.table === 'table_bookings')?.filter).toBe('booking_date=eq.2026-11-18')
  })

  it('reloads on the 60-second poll without any realtime event', async () => {
    const { client } = makeSupabase()
    const reloadSchedule = vi.fn().mockResolvedValue(undefined)

    renderHook(() => useFohRealtime({ supabase: client, date: '2026-11-18', isDragging: false, reloadSchedule }))

    await vi.advanceTimersByTimeAsync(59_000)
    expect(reloadSchedule).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000 + 500)
    expect(reloadSchedule).toHaveBeenCalledTimes(1)
    expect(reloadSchedule).toHaveBeenCalledWith({ requestedDate: '2026-11-18', surfaceError: false })
  })

  it('reloads shortly after a floor-plan change and removes the channel on unmount', async () => {
    const { client, raw, handlers } = makeSupabase()
    const reloadSchedule = vi.fn().mockResolvedValue(undefined)

    const { unmount } = renderHook(() =>
      useFohRealtime({ supabase: client, date: '2026-11-18', isDragging: false, reloadSchedule })
    )

    handlers[0]()
    await vi.advanceTimersByTimeAsync(500)
    expect(reloadSchedule).toHaveBeenCalledTimes(1)

    unmount()
    expect(raw.removeChannel).toHaveBeenCalledTimes(1)
  })
})
