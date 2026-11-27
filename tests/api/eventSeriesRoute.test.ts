import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

const state = vi.hoisted(() => ({ db: null as unknown, permissions: [] as string[] }))

vi.mock('@/lib/api/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/auth')>('@/lib/api/auth')
  return {
    ...actual,
    withApiAuth: vi.fn(
      async (handler: (request: Request, apiKey: unknown) => Promise<Response>, permissions: string[], request?: Request) => {
        state.permissions = permissions
        return handler(request || new Request('http://localhost/api/event-series'), { id: 'test-key' })
      }
    ),
  }
})
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.db }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/dateUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dateUtils')>()),
  getTodayIsoDate: () => '2026-11-26',
}))

import { GET } from '@/app/api/event-series/route'
import { NextRequest } from 'next/server'

const base = {
  id: 'series-1', name: 'Ladies Darts Night', slug: 'ladies-darts-night', category_id: null, weekday: 4,
  start_time: '19:00:00', end_time: '22:00:00', starts_on: '2026-12-03', ends_on: null,
  short_description: 'A friendly night of darts for women.', page_path: '/ladies-darts-night', is_free: true,
  audience_note: 'Women only.', skip_when_closed: true, status: 'active', google_calendar_event_id: null,
  created_at: '2026-11-26T00:00:00Z', updated_at: '2026-11-26T00:00:00Z',
}

async function call() {
  const response = await GET(new NextRequest('http://localhost/api/event-series'))
  return { status: response.status, body: await response.json() }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-26T12:00:00Z'))
})

describe('GET /api/event-series', () => {
  it('needs read:events and returns the active series in camelCase with the next 8 weeks', async () => {
    state.db = createFakeSupabase({
      event_series: [base],
      event_series_skips: [
        { id: 's1', series_id: 'series-1', skip_date: '2026-12-24', reason: 'Christmas Eve', replaced_by_event_id: null },
        { id: 's2', series_id: 'series-1', skip_date: '2026-12-31', reason: "New Year's Eve", replaced_by_event_id: null },
        { id: 's3', series_id: 'series-1', skip_date: '2027-01-14', reason: null, replaced_by_event_id: 'event-9' },
      ],
      special_hours: [{ date: '2027-01-07', is_closed: true }],
    })
    const { status, body } = await call()
    expect(status).toBe(200)
    expect(state.permissions).toEqual(['read:events'])
    const [darts] = body.data.series
    expect(darts).toMatchObject({
      slug: 'ladies-darts-night', weekday: 4, startTime: '19:00', endTime: '22:00', isFree: true,
      pagePath: '/ladies-darts-night', audienceNote: 'Women only.', endsOn: null,
    })
    expect(darts.nextOccurrence.date).toBe('2026-12-03')
    expect(darts.occurrences.map((o: { date: string }) => o.date)).toEqual(['2026-12-03', '2026-12-10', '2026-12-17'])
    // The replaced date (a full event that week) is not named; manual and closed skips are.
    expect(darts.skippedDates).toEqual([
      { date: '2026-12-24', kind: 'manual' },
      { date: '2026-12-31', kind: 'manual' },
      { date: '2027-01-07', kind: 'closed' },
    ])
    expect(JSON.stringify(darts)).not.toContain('Christmas Eve')
  })

  it('sends the customer-facing details and web pictures, and keeps staff tools out', async () => {
    state.db = createFakeSupabase({
      event_series: [{
        ...base, meta_title: 'Ladies Darts Night | Thursdays', long_description: 'Para.', highlights: ['Free to play'],
        brief: 'STAFF ONLY brief', primary_keywords: ['ladies darts night'], facebook_event_name: 'FB name',
        social_copy_whatsapp: 'WA copy', square_image_url: 'https://x/sq.jpg', landscape_image_url: 'https://x/ls.jpg',
        social_image_url: null, story_image_url: 'https://x/story.jpg', print_poster_url: 'https://x/a4.pdf', price: null,
      }],
      event_series_skips: [],
    })
    const { body } = await call()
    const [darts] = body.data.series
    expect(darts).toMatchObject({
      metaTitle: 'Ladies Darts Night | Thursdays', longDescription: 'Para.', highlights: ['Free to play'], price: null,
      images: { square: 'https://x/sq.jpg', landscape: 'https://x/ls.jpg', social: null },
    })
    const text = JSON.stringify(darts)
    for (const secret of ['STAFF ONLY brief', 'FB name', 'WA copy', 'story.jpg', 'a4.pdf', 'ladies darts night"']) {
      expect(text).not.toContain(secret)
    }
  })

  it('leaves out paused and ended series, and an active one with no date left', async () => {
    state.db = createFakeSupabase({
      event_series: [
        { ...base, id: 'p', slug: 'paused', status: 'paused' },
        { ...base, id: 'e', slug: 'ended', status: 'ended' },
        { ...base, id: 'over', slug: 'over', starts_on: '2026-01-01', ends_on: '2026-11-19' },
      ],
      event_series_skips: [],
      special_hours: [],
    })
    const { body } = await call()
    expect(body.data.series).toEqual([])
  })

  it('answers 500 when the database read fails', async () => {
    state.db = {
      from: () => ({
        select: () => ({ order: () => ({ in: async () => ({ data: null, error: { message: 'boom' } }) }) }),
      }),
    }
    const { status } = await call()
    expect(status).toBe(500)
  })
})
