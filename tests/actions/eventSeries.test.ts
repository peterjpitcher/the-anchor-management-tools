import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fakeSupabase'

/**
 * Repeating events (spec docs/superpowers/specs/2026-11-26-repeating-events.md, section 7):
 * events:manage to change, events:view to see, a skip must fall on the weekday, a date made into a
 * full event can only come back by deleting that event, and every change is audited.
 */

const state = vi.hoisted(() => ({
  db: null as unknown,
  user: { id: 'manager-1', email: 'boss@example.test' } as { id: string; email: string } | null,
  allowed: true,
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.db }))
vi.mock('@/lib/supabase/current-user', () => ({ getCurrentUser: async () => ({ user: state.user, error: null }) }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn(async () => state.allowed) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn(async () => undefined) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/google-calendar-event-series', () => ({
  syncEventSeriesCalendarEntry: vi.fn(async () => ({ state: 'updated', seriesId: 'x', googleEventId: 'aes' })),
}))
vi.mock('@/lib/dateUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dateUtils')>()),
  getTodayIsoDate: () => '2026-11-26',
}))

import {
  createEventSeries,
  endEventSeries,
  markEventSeriesDateReplaced,
  skipEventSeriesDate,
  unskipEventSeriesDate,
  updateEventSeries,
  type EventSeriesInput,
} from '@/app/actions/event-series'
import { logAuditEvent } from '@/app/actions/audit'
import { checkUserPermission } from '@/app/actions/rbac'
import { syncEventSeriesCalendarEntry } from '@/lib/google-calendar-event-series'

const SERIES = '6b1c2b8e-1d5a-4a4f-9c1e-2f3a4b5c6d7e'
const EVENT = '7c2d3c9f-2e6b-4b5a-8d2f-3a4b5c6d7e8f'

const seriesRow = {
  id: SERIES, name: 'Ladies Darts Night', slug: 'ladies-darts-night', category_id: null, weekday: 4,
  start_time: '19:00:00', end_time: '22:00:00', starts_on: '2026-12-03', ends_on: null,
  short_description: 'A friendly night of darts for women.', page_path: '/ladies-darts-night', is_free: true,
  audience_note: null, skip_when_closed: true, status: 'active', google_calendar_event_id: null,
  created_at: '2026-11-26T00:00:00Z', updated_at: '2026-11-26T00:00:00Z',
}

const input: EventSeriesInput = {
  name: 'Ladies Darts Night', slug: 'ladies-darts-night', categoryId: null, weekday: 4, startTime: '19:00',
  endTime: '22:00', startsOn: '2026-12-03', endsOn: null, shortDescription: 'A friendly night of darts for women.',
  pagePath: '/ladies-darts-night', isFree: true, audienceNote: null, skipWhenClosed: true,
}

function seed(skips: Array<Record<string, unknown>> = []): FakeSupabase {
  const db = createFakeSupabase({
    event_series: [{ ...seriesRow }],
    event_series_skips: skips.map((s, i) => ({ id: `skip-${i}`, series_id: SERIES, reason: null, replaced_by_event_id: null, ...s })),
    events: [{ id: EVENT, date: '2027-01-14' }],
  })
  state.db = db
  return db
}

beforeEach(() => {
  vi.clearAllMocks()
  state.allowed = true
  state.user = { id: 'manager-1', email: 'boss@example.test' }
})

describe('permissions', () => {
  it('refuses a change without events:manage and writes nothing', async () => {
    const db = seed()
    state.allowed = false
    const result = await skipEventSeriesDate({ seriesId: SERIES, date: '2026-12-24', reason: null })
    expect(result).toEqual({ error: 'Insufficient permissions' })
    expect(checkUserPermission).toHaveBeenCalledWith('events', 'manage', 'manager-1')
    expect(db.tables.event_series_skips).toHaveLength(0)
  })

  it('refuses a signed-out caller', async () => {
    seed()
    state.user = null
    expect(await createEventSeries(input)).toEqual({ error: 'Unauthorized' })
  })
})

describe('createEventSeries', () => {
  it('validates the form', async () => {
    seed()
    expect((await createEventSeries({ ...input, startTime: '7pm' })).error).toBe('Use a time like 19:00')
    expect((await createEventSeries({ ...input, pagePath: 'ladies' })).error).toBe('The page must start with "/"')
    expect((await createEventSeries({ ...input, endsOn: '2026-11-01' })).error).toBe('The last date is before the first')
  })

  it('creates an active series, audits it and syncs the calendar', async () => {
    const db = createFakeSupabase({ event_series: [], event_series_skips: [] })
    state.db = db
    const result = await createEventSeries(input)
    expect(result.success).toBe(true)
    expect(db.tables.event_series[0]).toMatchObject({ status: 'active', weekday: 4, start_time: '19:00', created_by: 'manager-1' })
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ operation_type: 'create', resource_type: 'event_series' }))
    expect(syncEventSeriesCalendarEntry).toHaveBeenCalled()
  })
})

describe('skipEventSeriesDate', () => {
  it('refuses a date that is not on the series weekday', async () => {
    const db = seed()
    const result = await skipEventSeriesDate({ seriesId: SERIES, date: '2026-12-25', reason: null })
    expect(result).toEqual({ error: 'That date is not on the day this night runs' })
    expect(db.tables.event_series_skips).toHaveLength(0)
  })

  it('skips a Thursday with a reason and audits it', async () => {
    const db = seed()
    const result = await skipEventSeriesDate({ seriesId: SERIES, date: '2026-12-24', reason: 'Christmas Eve' })
    expect(result.success).toBe(true)
    expect(db.tables.event_series_skips[0]).toMatchObject({ skip_date: '2026-12-24', reason: 'Christmas Eve' })
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ operation_type: 'skip_date' }))
  })

  it('refuses the same date twice', async () => {
    seed([{ skip_date: '2026-12-24' }])
    expect(await skipEventSeriesDate({ seriesId: SERIES, date: '2026-12-24', reason: null })).toEqual({ error: 'That date is already skipped' })
  })
})

describe('unskipEventSeriesDate', () => {
  it('undoes a hand skip', async () => {
    const db = seed([{ skip_date: '2026-12-24' }])
    const result = await unskipEventSeriesDate({ seriesId: SERIES, date: '2026-12-24' })
    expect(result.success).toBe(true)
    expect(db.tables.event_series_skips).toHaveLength(0)
  })

  it('will not undo a date that is now a full event', async () => {
    const db = seed([{ skip_date: '2027-01-14', replaced_by_event_id: EVENT }])
    const result = await unskipEventSeriesDate({ seriesId: SERIES, date: '2027-01-14' })
    expect(result.error).toMatch(/Delete that event/)
    expect(db.tables.event_series_skips).toHaveLength(1)
  })
})

describe('updateEventSeries', () => {
  it('refuses a weekday change while dates ahead are skipped on the old day', async () => {
    seed([{ skip_date: '2026-12-24' }])
    const result = await updateEventSeries(SERIES, { ...input, weekday: 5 })
    expect(result.error).toMatch(/Undo the skipped dates/)
  })
})

describe('endEventSeries', () => {
  it('sets a future last date and keeps it running until then', async () => {
    const db = seed()
    await endEventSeries({ seriesId: SERIES, lastDate: '2027-03-25' })
    expect(db.tables.event_series[0]).toMatchObject({ ends_on: '2027-03-25', status: 'active' })
  })

  it('ends it now when the last date has passed', async () => {
    const db = seed()
    db.tables.event_series[0].starts_on = '2026-01-01'
    await endEventSeries({ seriesId: SERIES, lastDate: '2026-11-19' })
    expect(db.tables.event_series[0]).toMatchObject({ ends_on: '2026-11-19', status: 'ended' })
  })
})

describe('markEventSeriesDateReplaced', () => {
  it('takes the date out of the run with the new event recorded against it', async () => {
    const db = seed()
    const result = await markEventSeriesDateReplaced({ seriesId: SERIES, date: '2027-01-14', eventId: EVENT })
    expect(result.success).toBe(true)
    expect(db.tables.event_series_skips[0]).toMatchObject({ skip_date: '2027-01-14', replaced_by_event_id: EVENT })
  })

  it('leaves the night in the run when the new event was saved on another date', async () => {
    const db = seed()
    db.tables.events[0].date = '2027-01-21'
    const result = await markEventSeriesDateReplaced({ seriesId: SERIES, date: '2027-01-14', eventId: EVENT })
    expect(result.error).toContain('unchanged')
    expect(db.tables.event_series_skips).toHaveLength(0)
  })
})

describe('details (migration 20261127121431)', () => {
  const details = {
    price: null, brief: 'Social darts, no tournament.', performerName: null, performerType: null,
    metaTitle: 'Ladies Darts Night | Thursdays, Stanwell Moor', metaDescription: null,
    longDescription: 'Para one.\n\nPara two.', highlights: ['Free to play', '', ' Beginners welcome '],
    primaryKeywords: ['ladies darts night'], secondaryKeywords: [], localSeoKeywords: ['stanwell moor'],
    imageAltText: null, accessibilityNotes: null, facebookEventName: null, facebookEventDescription: null,
    gbpEventTitle: null, gbpEventDescription: null, socialCopyWhatsapp: 'See you Thursday',
  }

  it('saves the details, trimming blank highlights, and never writes a picture column', async () => {
    const db = seed()
    db.tables.event_series[0].square_image_url = 'https://x/storage/v1/object/public/event-images/event-series/a/square/1_p.jpg'
    const result = await updateEventSeries(SERIES, { ...input, details })
    expect(result.success).toBe(true)
    const row = db.tables.event_series[0]
    expect(row).toMatchObject({
      brief: 'Social darts, no tournament.',
      meta_title: 'Ladies Darts Night | Thursdays, Stanwell Moor',
      highlights: ['Free to play', 'Beginners welcome'],
      primary_keywords: ['ladies darts night'],
      social_copy_whatsapp: 'See you Thursday',
      price: null,
    })
    expect(row.square_image_url).toBe('https://x/storage/v1/object/public/event-images/event-series/a/square/1_p.jpg')
  })

  it('keeps the stored details when a save sends none', async () => {
    const db = seed()
    db.tables.event_series[0].long_description = 'Kept'
    expect((await updateEventSeries(SERIES, input)).success).toBe(true)
    expect(db.tables.event_series[0].long_description).toBe('Kept')
  })

  it('needs a price for a paid night, and stores none for a free one', async () => {
    const db = seed()
    expect((await updateEventSeries(SERIES, { ...input, isFree: false, details })).error).toBe('Enter the ticket price, or tick Free')
    expect((await updateEventSeries(SERIES, { ...input, isFree: false, details: { ...details, price: 5 } })).success).toBe(true)
    expect(db.tables.event_series[0]).toMatchObject({ is_free: false, price: 5 })
    expect((await updateEventSeries(SERIES, { ...input, isFree: true, details: { ...details, price: 5 } })).success).toBe(true)
    expect(db.tables.event_series[0]).toMatchObject({ is_free: true, price: null })
  })

  it('refuses a meta description over 500 characters', async () => {
    seed()
    const result = await updateEventSeries(SERIES, { ...input, details: { ...details, metaDescription: 'x'.repeat(501) } })
    expect(result.error).toBe('Use 500 characters or fewer')
  })
})
