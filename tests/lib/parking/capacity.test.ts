import { describe, expect, it } from 'vitest'

import { buildParkingAvailabilitySlots } from '@/lib/parking/capacity'

const CAPACITY = 10

describe('buildParkingAvailabilitySlots', () => {
  it('builds daily availability using overlapping bookings', () => {
    const start = new Date('2025-11-01T09:00:00Z')
    const end = new Date('2025-11-02T18:00:00Z')

    const bookings = [
      {
        start_at: '2025-11-01T08:00:00Z',
        end_at: '2025-11-01T20:00:00Z'
      },
      {
        start_at: '2025-11-03T09:00:00Z',
        end_at: '2025-11-03T10:00:00Z'
      }
    ]

    const slots = buildParkingAvailabilitySlots(start, end, 'day', bookings, CAPACITY)

    expect(slots).toHaveLength(2)
    expect(slots[0]).toMatchObject({
      start_at: '2025-11-01T00:00:00.000Z',
      end_at: '2025-11-01T23:59:59.999Z',
      reserved: 1,
      remaining: CAPACITY - 1,
      capacity: CAPACITY
    })
    expect(slots[1]).toMatchObject({
      start_at: '2025-11-02T00:00:00.000Z',
      end_at: '2025-11-02T23:59:59.999Z',
      reserved: 0,
      remaining: CAPACITY,
      capacity: CAPACITY
    })
  })

  it('builds hourly availability with oversubscribed slots', () => {
    const start = new Date('2025-11-01T09:25:00Z')
    const end = new Date('2025-11-01T11:10:00Z')

    const bookings = [
      { start_at: '2025-11-01T09:00:00Z', end_at: '2025-11-01T10:00:00Z' },
      { start_at: '2025-11-01T09:30:00Z', end_at: '2025-11-01T11:30:00Z' },
      { start_at: '2025-11-01T10:45:00Z', end_at: '2025-11-01T12:00:00Z' }
    ]

    const slots = buildParkingAvailabilitySlots(start, end, 'hour', bookings, 2)

    expect(slots).toHaveLength(3)
    expect(slots[0]).toMatchObject({
      start_at: '2025-11-01T09:00:00.000Z',
      end_at: '2025-11-01T10:00:00.000Z',
      reserved: 2,
      remaining: 0,
      capacity: 2
    })
    expect(slots[1]).toMatchObject({
      start_at: '2025-11-01T10:00:00.000Z',
      end_at: '2025-11-01T11:00:00.000Z',
      reserved: 3,
      remaining: -1,
      capacity: 2
    })
    expect(slots[2]).toMatchObject({
      start_at: '2025-11-01T11:00:00.000Z',
      end_at: '2025-11-01T12:00:00.000Z',
      reserved: 2,
      remaining: 0,
      capacity: 2
    })
  })
})
