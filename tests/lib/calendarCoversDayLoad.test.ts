import { describe, expect, it, vi } from 'vitest'

/**
 * Review BK-075: the calendar counted every table booking, so an event's tables counted, its
 * shared-seating and general admission tickets did not, and a night full of a private party read as
 * empty. It now shows the day load's covers, with private-hire guests as their own figure.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/services/day-load', () => ({ loadDayLoads: vi.fn() }))

import { readCoversByDate } from '@/lib/calendar/datasets'
import { loadDayLoads } from '@/services/day-load'

describe('calendar covers', () => {
  it('shows covers and private-hire guests per day, from the shared day load', async () => {
    vi.mocked(loadDayLoads).mockResolvedValue(new Map([
      ['2026-11-20', { date: '2026-11-20', covers: 0, privateHireGuests: 0 }],
      ['2026-11-21', { date: '2026-11-21', covers: 0, privateHireGuests: 120 }],
      ['2026-11-22', { date: '2026-11-22', covers: 46, privateHireGuests: 0 }],
    ]) as never)
    const client = {} as never

    const result = await readCoversByDate(client, '2026-11-20', '2026-11-22')

    expect(loadDayLoads).toHaveBeenCalledWith('2026-11-20', '2026-11-22', { db: client, withHours: false })
    expect(result).toEqual({
      status: 'ok',
      data: [
        { date: '2026-11-21', covers: 0, hireGuests: 120 },
        { date: '2026-11-22', covers: 46, hireGuests: 0 },
      ],
    })
  })

  it('reports a failed read instead of an empty calendar', async () => {
    vi.mocked(loadDayLoads).mockRejectedValue(new Error('timeout'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await readCoversByDate({} as never, '2026-11-20', '2026-11-22')

    expect(result).toMatchObject({ status: 'failed' })
  })
})
