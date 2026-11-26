import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/google-calendar', () => ({ getOAuth2Client: vi.fn() }))

import {
  buildEventSeriesCalendarBody,
  generateEventSeriesCalendarEventId,
} from '@/lib/google-calendar-event-series'
import type { EventSeriesWithSkips } from '@/lib/events/series-data'

const darts: EventSeriesWithSkips = {
  id: 'series-1', name: 'Ladies Darts Night', slug: 'ladies-darts-night', categoryId: null, weekday: 4,
  startTime: '19:00', endTime: '22:00', startsOn: '2026-11-27', endsOn: null,
  shortDescription: 'A friendly night of darts for women.', pagePath: '/ladies-darts-night', isFree: true,
  audienceNote: 'Women only.', skipWhenClosed: true, status: 'active', googleCalendarEventId: null,
  createdAt: '', updatedAt: '',
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
})
