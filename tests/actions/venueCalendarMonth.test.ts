import { beforeEach, describe, expect, it, vi } from 'vitest'

const { checkUserPermission, canViewCalendarNotes, getCalendarEvents, readers, getUser } = vi.hoisted(() => {
  const ok = <T,>(data: T[]) => ({ status: 'ok' as const, data })
  return {
    checkUserPermission: vi.fn(),
    canViewCalendarNotes: vi.fn(),
    getCalendarEvents: vi.fn(),
    getUser: vi.fn(),
    readers: {
      readPrivateBookingsInRange: vi.fn(async () => ok([{ id: 'pb-1', status: 'completed' }])),
      readBalanceDues: vi.fn(async () => ok([{ id: 'bal-1', settled: true }])),
      readBirthdays: vi.fn(async () => ok([])),
      readSpecialHours: vi.fn(async () => ok([])),
      readCalendarNotesInRange: vi.fn(async () => ok([])),
      readParkingInRange: vi.fn(async () => ok([{ id: 'park-1', status: 'expired' }])),
      readMarketingSends: vi.fn(async () => ok([])),
      readCoversByDate: vi.fn(async () => ok([{ date: '2026-03-07', covers: 40, hireGuests: 25 }])),
      readStaffByDate: vi.fn(async () => ok([{ date: '2026-03-07', staff: ['Sam'] }])),
      readTextMessagesByDate: vi.fn(async () => ok([{ date: '2026-03-07', total: 3, promotional: 2, service: 1, failed: 0 }])),
    },
  }
})

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ auth: { getUser } })) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission }))
vi.mock('@/app/actions/calendar-notes', () => ({ canViewCalendarNotes }))
vi.mock('@/services/events', () => ({ EventService: { getCalendarEvents } }))
vi.mock('@/lib/events/series-data', () => ({ loadSeriesOccurrencesInRange: vi.fn(async () => []) }))
vi.mock('@/lib/calendar/datasets', () => ({
  ...readers,
  denied: () => ({ status: 'denied', data: [] }),
}))

import { getVenueCalendarMonth } from '@/app/actions/venue-calendar'

function eventRow(overrides: Record<string, unknown>) {
  return {
    id: 'e1',
    name: 'Quiz',
    date: '2026-03-05',
    time: '19:00',
    event_status: 'scheduled',
    hero_image_url: null,
    poster_image_url: 'https://example.test/poster.jpg',
    thumbnail_image_url: null,
    brief: '  ',
    short_description: null,
    long_description: 'All about it',
    booked_count: 12,
    ...overrides,
  }
}

describe('getVenueCalendarMonth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    checkUserPermission.mockResolvedValue(true)
    canViewCalendarNotes.mockResolvedValue(true)
    getCalendarEvents.mockResolvedValue([])
  })

  it('refuses a month outside the calendar range without reading anything', async () => {
    const result = await getVenueCalendarMonth({ month: '2019-01' })
    expect(result.error).toBe('Choose a month from 2024 onwards')
    expect(getUser).not.toHaveBeenCalled()
  })

  it('refuses a signed-out caller', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    expect(await getVenueCalendarMonth({ month: '2026-03' })).toEqual({ error: 'Unauthorized' })
  })

  it('reads the whole grid for the month, past items included, whatever their status', async () => {
    getCalendarEvents.mockResolvedValue([eventRow({})])
    const result = await getVenueCalendarMonth({ month: '2026-03' })

    // March 2026 runs Sunday 1 to Tuesday 31: the grid is Monday 23 Feb to Sunday 5 April.
    expect(getCalendarEvents).toHaveBeenCalledWith({ dateFrom: '2026-02-23', dateTo: '2026-04-05' })
    expect(readers.readPrivateBookingsInRange).toHaveBeenCalledWith(expect.anything(), '2026-02-23', '2026-04-05')
    expect(readers.readParkingInRange).toHaveBeenCalledWith(
      expect.anything(),
      '2026-02-23T00:00:00.000Z',
      '2026-04-05T23:00:00.000Z',
    )

    expect(result.data?.events).toEqual([
      expect.objectContaining({ id: 'e1', bookedSeatsCount: 12, hasImage: true, hasBrief: false, hasDescription: true }),
    ])
    expect(result.data?.privateBookings).toEqual([{ id: 'pb-1', status: 'completed' }])
    expect(result.data?.balanceDueDates).toEqual([{ id: 'bal-1', settled: true }])
    expect(result.data?.parkingBookings).toEqual([{ id: 'park-1', status: 'expired' }])
    expect(result.data?.dailyOps).toEqual({
      coversByDate: { '2026-03-07': 40 },
      hireGuestsByDate: { '2026-03-07': 25 },
      staffByDate: { '2026-03-07': ['Sam'] },
    })
    expect(result.data?.textMessages).toEqual([{ date: '2026-03-07', total: 3, promotional: 2, service: 1, failed: 0 }])
    expect(readers.readTextMessagesByDate).toHaveBeenCalledWith(
      expect.anything(),
      '2026-02-23T00:00:00.000Z',
      '2026-04-05T23:00:00.000Z',
    )
    expect(result.data?.warnings).toEqual([])
  })

  it('leaves out past drafts but keeps future drafts', async () => {
    getCalendarEvents.mockResolvedValue([
      eventRow({ id: 'old-draft', date: '2024-02-01', event_status: 'draft' }),
      eventRow({ id: 'old-held', date: '2024-02-02', event_status: 'scheduled' }),
      eventRow({ id: 'future-draft', date: '2099-01-01', event_status: 'draft' }),
    ])
    const result = await getVenueCalendarMonth({ month: '2024-02' })
    expect(result.data?.events.map((e) => e.id)).toEqual(['old-held', 'future-draft'])
  })

  it('leaves each layer empty, unread, for a user who may not see it', async () => {
    checkUserPermission.mockImplementation(async (module: string, action: string) => {
      if (module === 'events' && action === 'view') return true
      if (module === 'private_bookings' && action === 'view') return true
      return false
    })
    canViewCalendarNotes.mockResolvedValue(false)

    const result = await getVenueCalendarMonth({ month: '2026-03' })

    expect(readers.readPrivateBookingsInRange).toHaveBeenCalled()
    // Balances need view_pricing as well, because the marker shows the amount.
    expect(readers.readBalanceDues).not.toHaveBeenCalled()
    expect(readers.readParkingInRange).not.toHaveBeenCalled()
    expect(readers.readMarketingSends).not.toHaveBeenCalled()
    expect(readers.readCalendarNotesInRange).not.toHaveBeenCalled()
    expect(readers.readCoversByDate).not.toHaveBeenCalled()
    expect(readers.readStaffByDate).not.toHaveBeenCalled()
    // Texts need messages:view.
    expect(readers.readTextMessagesByDate).not.toHaveBeenCalled()
    expect(result.data?.textMessages).toEqual([])
    expect(result.data?.balanceDueDates).toEqual([])
    expect(result.data?.warnings).toEqual([])
  })

  it('turns a failed layer into a warning, never an error or a quiet empty month', async () => {
    readers.readParkingInRange.mockResolvedValueOnce({ status: 'failed', data: [], message: 'Parking bookings could not be loaded.' } as never)
    getCalendarEvents.mockRejectedValueOnce(new Error('timeout'))

    const result = await getVenueCalendarMonth({ month: '2026-03' })

    expect(result.error).toBeUndefined()
    expect(result.data?.parkingBookings).toEqual([])
    expect(result.data?.warnings).toEqual(
      expect.arrayContaining(['Events could not be loaded.', 'Parking bookings could not be loaded.']),
    )
  })
})
