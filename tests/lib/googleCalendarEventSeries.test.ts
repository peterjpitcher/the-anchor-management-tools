import { describe, expect, it, vi } from 'vitest'

const seriesData = vi.hoisted(() => ({
  loadEventSeries: vi.fn(),
  loadSeriesClosedDays: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      // endFinishedRuns: no run has passed its last date in these tests.
      select: () => ({ eq: () => ({ lt: async () => ({ data: [], error: null }) }) }),
    }),
  }),
}))
vi.mock('@/lib/google-calendar', () => ({ getOAuth2Client: vi.fn(async () => ({})) }))
vi.mock('@/lib/events/series-data', () => seriesData)
// No test reaches Google: every calendar call fails at once.
vi.mock('googleapis', () => ({
  google: {
    calendar: () => ({
      events: new Proxy({}, { get: () => async () => { throw new Error('no network in tests') } }),
    }),
  },
}))

import {
  buildEventSeriesCalendarBody,
  generateEventSeriesCalendarEventId,
  isRunFinished,
  syncAllEventSeriesCalendarEntries,
} from '@/lib/google-calendar-event-series'
import type { EventSeriesWithSkips } from '@/lib/events/series-data'

const darts: EventSeriesWithSkips = {
  id: 'series-1', name: 'Ladies Darts Night', slug: 'ladies-darts-night', categoryId: null, weekday: 4,
  startTime: '19:00', endTime: '22:00', startsOn: '2026-11-27', endsOn: null,
  shortDescription: 'A friendly night of darts for women.', pagePath: '/ladies-darts-night', isFree: true,
  audienceNote: 'Women only.', skipWhenClosed: true, status: 'active', googleCalendarEventId: null,
  createdAt: '', updatedAt: '',
  details: {
    brief: null, performerName: null, performerType: null, price: null, metaTitle: null, metaDescription: null,
    longDescription: null, highlights: [], primaryKeywords: [], secondaryKeywords: [], localSeoKeywords: [],
    imageAltText: null, accessibilityNotes: null, facebookEventName: null, facebookEventDescription: null,
    gbpEventTitle: null, gbpEventDescription: null, socialCopyWhatsapp: null,
  },
  images: { square: null, landscape: null, social: null, story: null, printPoster: null },
  skips: [
    { skipDate: '2026-12-24', reason: 'Christmas Eve', replacedByEventId: null },
    { skipDate: '2026-12-31', reason: "New Year's Eve", replacedByEventId: null },
  ],
}

describe('buildEventSeriesCalendarBody', () => {
  it('is one weekly entry from the first Thursday, with each skipped date excluded', () => {
    const body = buildEventSeriesCalendarBody(darts, [], '2026-11-26')
    expect(body?.start).toEqual({ dateTime: '2026-12-03T19:00:00', timeZone: 'Europe/London' })
    expect(body?.end).toEqual({ dateTime: '2026-12-03T22:00:00', timeZone: 'Europe/London' })
    expect(body?.recurrence).toEqual([
      'RRULE:FREQ=WEEKLY;BYDAY=TH',
      'EXDATE;TZID=Europe/London:20261224T190000,20261231T190000',
    ])
  })

  it('uses an id the events orphan sweep (aev ids) never touches', () => {
    const id = generateEventSeriesCalendarEventId('series-1')
    expect(id).toMatch(/^aes[0-9a-f]{48}$/)
    expect(id).not.toMatch(/^aev[0-9a-f]{48}$/)
  })

  it('excludes a Thursday the pub is closed, and ends on the last date', () => {
    const body = buildEventSeriesCalendarBody(
      { ...darts, skips: [], endsOn: '2027-03-25' },
      [{ date: '2027-01-07', isClosed: true }, { date: '2027-01-14', isClosed: false }],
      '2026-11-26'
    )
    expect(body?.recurrence).toEqual([
      'RRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20270325T235959Z',
      'EXDATE;TZID=Europe/London:20270107T190000',
    ])
  })

  it('changes its content hash only when the entry changes', () => {
    const a = buildEventSeriesCalendarBody(darts, [], '2026-11-26')
    const b = buildEventSeriesCalendarBody(darts, [], '2026-11-27')
    const c = buildEventSeriesCalendarBody({ ...darts, skips: [] }, [], '2026-11-26')
    expect(a?.extendedProperties.private.contentHash).toBe(b?.extendedProperties.private.contentHash)
    expect(a?.extendedProperties.private.contentHash).not.toBe(c?.extendedProperties.private.contentHash)
  })

  it('removes the entry while paused or ended', () => {
    expect(buildEventSeriesCalendarBody({ ...darts, status: 'paused' }, [], '2026-11-26')).toBeNull()
    expect(buildEventSeriesCalendarBody({ ...darts, status: 'ended' }, [], '2026-11-26')).toBeNull()
  })

  it('keeps a closure exclusion once its date has passed', () => {
    // Sync on 1 February 2027: the 7 January closure is in the past but still in the recurrence.
    const body = buildEventSeriesCalendarBody(
      { ...darts, skips: [] },
      [{ date: '2027-01-07', isClosed: true }],
      '2027-02-01'
    )
    expect(body?.recurrence).toContain('EXDATE;TZID=Europe/London:20270107T190000')
  })
})

describe('isRunFinished', () => {
  const evening = { endsOn: '2027-03-25', startTime: '19:00', endTime: '22:00' }
  const overnight = { endsOn: '2027-03-25', startTime: '21:00', endTime: '01:00' }

  it('ends an evening run the day after its last date', () => {
    expect(isRunFinished(evening, '2027-03-25', new Date('2027-03-25T23:00:00Z'))).toBe(false)
    expect(isRunFinished(evening, '2027-03-26', new Date('2027-03-26T00:05:00Z'))).toBe(true)
  })

  it('keeps an overnight run going until its last night closes', () => {
    // 00:30 GMT on Friday 26 March: Thursday's 9pm to 1am night is still on.
    expect(isRunFinished(overnight, '2027-03-26', new Date('2027-03-26T00:30:00Z'))).toBe(false)
    expect(isRunFinished(overnight, '2027-03-26', new Date('2027-03-26T01:00:00Z'))).toBe(true)
  })

  it('reads the closing time in London across the clock change', () => {
    // Last night Thursday 1 April 2027 (BST): 1am London on Friday is 00:00 UTC.
    const bst = { ...overnight, endsOn: '2027-04-01' }
    expect(isRunFinished(bst, '2027-04-02', new Date('2027-04-01T23:59:00Z'))).toBe(false)
    expect(isRunFinished(bst, '2027-04-02', new Date('2027-04-02T00:00:00Z'))).toBe(true)
  })
})

describe('syncAllEventSeriesCalendarEntries', () => {
  it('reads closures from the first run date, not from today', async () => {
    vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_KEY', '{}')
    // A run that began before today (the test pins no clock, so pick a date long past).
    seriesData.loadEventSeries.mockResolvedValue([{ ...darts, startsOn: '2025-11-06' }])
    seriesData.loadSeriesClosedDays.mockResolvedValue([])
    try {
      await syncAllEventSeriesCalendarEntries()
    } catch {
      // The calendar client fails by design; only the closure range matters here.
    } finally {
      vi.unstubAllEnvs()
    }
    expect(seriesData.loadSeriesClosedDays).toHaveBeenCalledTimes(1)
    expect(seriesData.loadSeriesClosedDays.mock.calls[0][1]).toBe('2025-11-06')
  })
})
