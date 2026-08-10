import { beforeEach, describe, expect, it, vi } from 'vitest'

// The library calls google.calendar('v3') at module load, so these have to exist
// before the mock factory runs.
const { listMock, deleteMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  deleteMock: vi.fn(),
}))

vi.mock('googleapis', () => ({
  google: {
    calendar: () => ({
      events: {
        list: listMock,
        delete: deleteMock,
        update: vi.fn(),
        insert: vi.fn(),
      },
    }),
  },
}))

vi.mock('@/lib/google-calendar', () => ({
  getOAuth2Client: vi.fn(async () => ({})),
}))

import {
  buildPubOpsEventCalendarEntry,
  generatePubOpsEventCalendarEventId,
  sweepOrphanedPubOpsEventCalendarEntries,
} from '@/lib/google-calendar-events'

const LIVE_EVENT_ID = '11111111-1111-4111-8111-111111111111'
const DELETED_EVENT_ID = '22222222-2222-4222-8222-222222222222'

function supabaseReturning(ids: string[], error: unknown = null) {
  const range = vi.fn(async (from: number) =>
    from === 0 ? { data: ids.map((id) => ({ id })), error } : { data: [], error }
  )
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        order: vi.fn(() => ({ range })),
      })),
    })),
  } as any
}

function calendarEntry(googleEventId: string, summary: string) {
  return {
    id: googleEventId,
    summary,
    start: { dateTime: '2026-09-01T19:00:00+01:00' },
    extendedProperties: { private: { source: 'anchor_event_booking_aggregate' } },
  }
}

function baseEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: LIVE_EVENT_ID,
    name: 'Quiz Night',
    date: '2026-09-16',
    time: '19:00',
    start_datetime: '2026-09-16T18:00:00+00:00',
    end_time: null,
    duration_minutes: 150,
    booking_url: null,
    capacity: null,
    event_status: 'scheduled',
    ...overrides,
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY = '{"client_email":"test","private_key":"test"}'
  listMock.mockResolvedValue({ data: { items: [], nextPageToken: null } })
  deleteMock.mockResolvedValue({})
})

describe('buildPubOpsEventCalendarEntry draft labelling', () => {
  it('prefixes draft events so they are not read as confirmed', () => {
    const entry = buildPubOpsEventCalendarEntry({
      event: baseEvent({ event_status: 'draft' }),
      bookings: [],
    })

    expect(entry.shouldDelete).toBe(false)
    if (entry.shouldDelete) return
    expect(entry.requestBody.summary).toBe('[DRAFT] Quiz Night - 0 seats booked')
  })

  it('leaves scheduled events unprefixed', () => {
    const entry = buildPubOpsEventCalendarEntry({
      event: baseEvent({ event_status: 'scheduled' }),
      bookings: [],
    })

    expect(entry.shouldDelete).toBe(false)
    if (entry.shouldDelete) return
    expect(entry.requestBody.summary).toBe('Quiz Night - 0 seats booked')
  })
})

describe('sweepOrphanedPubOpsEventCalendarEntries', () => {
  it('deletes entries whose event row has gone and keeps the rest', async () => {
    const liveId = generatePubOpsEventCalendarEventId(LIVE_EVENT_ID)
    const orphanId = generatePubOpsEventCalendarEventId(DELETED_EVENT_ID)
    listMock.mockResolvedValue({
      data: {
        items: [calendarEntry(liveId, 'Quiz Night'), calendarEntry(orphanId, 'Live at The Anchor')],
        nextPageToken: null,
      },
    })

    const result = await sweepOrphanedPubOpsEventCalendarEntries(supabaseReturning([LIVE_EVENT_ID]))

    expect(result.state).toBe('completed')
    expect(result.deleted).toBe(1)
    expect(result.orphans.map((orphan) => orphan.googleEventId)).toEqual([orphanId])
    expect(deleteMock).toHaveBeenCalledTimes(1)
    expect(deleteMock.mock.calls[0][0].eventId).toBe(orphanId)
  })

  it('ignores calendar entries this sync does not own', async () => {
    listMock.mockResolvedValue({
      data: {
        items: [
          { id: 'ncmthrjuq8l78ebpg2cdh1lbh6', summary: 'Stocktake', start: {} },
          { id: 'acn8434fe892f0f9462be942bffcc4f7e45266a1d4179fd3409', summary: 'National Prosecco Day', start: {} },
        ],
        nextPageToken: null,
      },
    })

    const result = await sweepOrphanedPubOpsEventCalendarEntries(supabaseReturning([LIVE_EVENT_ID]))

    expect(result.state).toBe('completed')
    expect(result.scanned).toBe(0)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('aborts without deleting when the events table comes back empty', async () => {
    listMock.mockResolvedValue({
      data: { items: [calendarEntry(generatePubOpsEventCalendarEventId(LIVE_EVENT_ID), 'Quiz Night')], nextPageToken: null },
    })

    const result = await sweepOrphanedPubOpsEventCalendarEntries(supabaseReturning([]))

    expect(result.state).toBe('aborted')
    expect(result.reason).toBe('no_events_loaded')
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('aborts without deleting when most of the calendar looks orphaned', async () => {
    const items = Array.from({ length: 12 }, (_, index) =>
      calendarEntry(
        generatePubOpsEventCalendarEventId(`3333333${index}-3333-4333-8333-333333333333`),
        `Ghost ${index}`
      )
    )
    listMock.mockResolvedValue({ data: { items, nextPageToken: null } })

    const result = await sweepOrphanedPubOpsEventCalendarEntries(supabaseReturning([LIVE_EVENT_ID]))

    expect(result.state).toBe('aborted')
    expect(result.reason).toBe('orphan_ratio_exceeded')
    expect(result.orphans).toHaveLength(12)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('reports orphans without deleting them on a dry run', async () => {
    const orphanId = generatePubOpsEventCalendarEventId(DELETED_EVENT_ID)
    listMock.mockResolvedValue({
      data: {
        items: [
          calendarEntry(generatePubOpsEventCalendarEventId(LIVE_EVENT_ID), 'Quiz Night'),
          calendarEntry(orphanId, 'Live at The Anchor'),
        ],
        nextPageToken: null,
      },
    })

    const result = await sweepOrphanedPubOpsEventCalendarEntries(supabaseReturning([LIVE_EVENT_ID]), {
      dryRun: true,
    })

    expect(result.state).toBe('completed')
    expect(result.deleted).toBe(0)
    expect(result.orphans).toHaveLength(1)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('treats an already-missing entry as cleared', async () => {
    const orphanId = generatePubOpsEventCalendarEventId(DELETED_EVENT_ID)
    listMock.mockResolvedValue({
      data: {
        items: [
          calendarEntry(generatePubOpsEventCalendarEventId(LIVE_EVENT_ID), 'Quiz Night'),
          calendarEntry(orphanId, 'Live at The Anchor'),
        ],
        nextPageToken: null,
      },
    })
    deleteMock.mockRejectedValue({ status: 404 })

    const result = await sweepOrphanedPubOpsEventCalendarEntries(supabaseReturning([LIVE_EVENT_ID]))

    expect(result.state).toBe('completed')
    expect(result.deleted).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('skips entirely when Google auth is not configured', async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY
    delete process.env.GOOGLE_CLIENT_ID
    delete process.env.GOOGLE_CLIENT_SECRET
    delete process.env.GOOGLE_REFRESH_TOKEN

    const result = await sweepOrphanedPubOpsEventCalendarEntries(supabaseReturning([LIVE_EVENT_ID]))

    expect(result.state).toBe('skipped')
    expect(result.reason).toBe('calendar_not_configured')
    expect(listMock).not.toHaveBeenCalled()
  })
})
