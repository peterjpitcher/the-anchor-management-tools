import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

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
import { logger } from '@/lib/logger'

// Supabase hands back at most 1,000 rows per request and reports no error when it
// cuts a result short. Live on 16 September 2026 the 500-event page the calendar and
// the transfer list ask for covers 130 events and 1,303 short links, so the click
// counts were already being built from an arbitrary 1,000 of them.
const LINK_ROW_COUNT = 1303
const EVENT_IDS = ['event-1', 'event-2'] as const

type RangeCall = [number, number]
type LinkRow = { metadata: { event_id: string }; click_count: number }
type EventRow = Record<string, unknown>

function buildLinkRows(): LinkRow[] {
  return Array.from({ length: LINK_ROW_COUNT }, (_, index) => ({
    metadata: { event_id: EVENT_IDS[index % EVENT_IDS.length] },
    click_count: 1 + (index % 5),
  }))
}

function expectedClicksFor(rows: LinkRow[], eventId: string): number {
  return rows
    .filter((row) => row.metadata.event_id === eventId)
    .reduce((sum, row) => sum + row.click_count, 0)
}

// The events read itself is already paged by the caller's page and pageSize, so it
// ends at .range() exactly as it does today.
function createEventsClient(eventRows: EventRow[]): SupabaseClient {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.gte = vi.fn(() => chain)
  chain.lte = vi.fn(() => chain)
  chain.or = vi.fn(() => chain)
  chain.order = vi.fn(() => chain)
  chain.range = vi.fn(() =>
    Promise.resolve({ data: eventRows, count: eventRows.length, error: null })
  )

  return { from: vi.fn(() => chain) } as unknown as SupabaseClient
}

// The link read now ends at .range(), which serves the requested slice and records
// the window it was asked for.
function createLinkClient(options: {
  rows: LinkRow[]
  rangeCalls: RangeCall[]
  pageError?: { message: string }
}): ReturnType<typeof createAdminClient> {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  chain.select = vi.fn(() => chain)
  chain.or = vi.fn(() => chain)
  chain.order = vi.fn(() => chain)
  chain.range = vi.fn((from: number, to: number) => {
    options.rangeCalls.push([from, to])
    if (options.pageError) return Promise.resolve({ data: null, error: options.pageError })
    return Promise.resolve({ data: options.rows.slice(from, to + 1), error: null })
  })

  return { from: vi.fn(() => chain) } as unknown as ReturnType<typeof createAdminClient>
}

function buildEventRows(): EventRow[] {
  return EVENT_IDS.map((id, index) => ({
    id,
    name: `Event ${index + 1}`,
    date: '2026-10-0' + (index + 1),
    capacity: 100,
    bookings: [],
  }))
}

describe('EventService.getEvents link clicks', () => {
  let loggedErrors: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    loggedErrors = vi.spyOn(logger, 'error').mockImplementation(() => {})
    vi.mocked(createClient).mockResolvedValue(createEventsClient(buildEventRows()))
  })

  afterEach(() => {
    loggedErrors.mockRestore()
  })

  it('counts every short link past the 1,000-row cap into the per-event totals', async () => {
    const rows = buildLinkRows()
    const rangeCalls: RangeCall[] = []
    vi.mocked(createAdminClient).mockReturnValue(createLinkClient({ rows, rangeCalls }))

    const result = await EventService.getEvents({ pageSize: 500 })

    expect(rangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ])
    expect(result.events.map((event) => event.link_clicks)).toEqual([
      expectedClicksFor(rows, 'event-1'),
      expectedClicksFor(rows, 'event-2'),
    ])
    expect(result.events.reduce((sum, event) => sum + event.link_clicks, 0)).toBe(
      rows.reduce((sum, row) => sum + row.click_count, 0)
    )
  })

  it('leaves the counts at zero and keeps the events list when the link read fails', async () => {
    const rangeCalls: RangeCall[] = []
    vi.mocked(createAdminClient).mockReturnValue(
      createLinkClient({
        rows: buildLinkRows(),
        rangeCalls,
        pageError: { message: 'statement timeout' },
      })
    )

    const result = await EventService.getEvents({ pageSize: 500 })

    expect(result.events).toHaveLength(EVENT_IDS.length)
    expect(result.events.map((event) => event.link_clicks)).toEqual([0, 0])
    expect(loggedErrors).toHaveBeenCalledWith(
      'Error fetching event link clicks',
      expect.objectContaining({
        error: expect.objectContaining({ message: expect.stringContaining('statement timeout') }),
      })
    )
  })
})
