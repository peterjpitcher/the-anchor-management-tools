import { describe, expect, it } from 'vitest'
import { eventToSchema } from './schema'

describe('eventToSchema', () => {
  it('uses the stored UTC instant for a London event during BST', () => {
    const schema = eventToSchema({
      id: 'event-1',
      name: 'Music Bingo',
      slug: 'music-bingo-2026-07-17',
      date: '2026-07-17',
      time: '19:00',
      end_time: '23:00',
      start_datetime: '2026-07-17T18:00:00+00:00',
      event_status: 'scheduled',
      price: 5,
      price_per_seat: 5,
      is_free: false,
    })

    expect(schema.startDate).toBe('2026-07-17T18:00:00.000Z')
    expect(schema.endDate).toBe('2026-07-17T22:00:00.000Z')
    expect(schema.offers?.price).toBe('5')
  })

  it('converts London wall time when start_datetime is unavailable', () => {
    const schema = eventToSchema({
      id: 'event-2',
      name: 'Summer Event',
      slug: 'summer-event',
      date: '2026-07-17',
      time: '19:00',
      event_status: 'scheduled',
      price: 5,
      is_free: false,
    })

    expect(schema.startDate).toBe('2026-07-17T18:00:00.000Z')
  })
})

describe('eventToSchema offers.validFrom', () => {
  const baseEvent = {
    id: 'event-3',
    name: 'Music Bingo',
    slug: 'music-bingo-2026-07-17',
    date: '2026-07-17',
    time: '19:00',
    start_datetime: '2026-07-17T18:00:00+00:00',
    event_status: 'scheduled',
    price: 5,
    is_free: false,
  }

  it('uses the event creation time, so it is stable across requests', () => {
    const schema = eventToSchema({ ...baseEvent, created_at: '2026-05-02T09:15:00+00:00' })
    expect(schema.offers?.validFrom).toBe('2026-05-02T09:15:00.000Z')
  })

  it('returns the same value on repeated calls', () => {
    // Regression guard. validFrom used to be new Date().toISOString(), so the
    // website served a different value on every crawl of the same event and
    // the field told search engines nothing.
    const a = eventToSchema({ ...baseEvent, created_at: '2026-05-02T09:15:00+00:00' })
    const b = eventToSchema({ ...baseEvent, created_at: '2026-05-02T09:15:00+00:00' })
    expect(a.offers?.validFrom).toBe(b.offers?.validFrom)
  })

  it('omits validFrom rather than guessing when created_at is missing', () => {
    const schema = eventToSchema(baseEvent)
    expect(schema.offers?.validFrom).toBeUndefined()
  })

  it('omits validFrom when created_at is unparseable', () => {
    const schema = eventToSchema({ ...baseEvent, created_at: 'not-a-date' })
    expect(schema.offers?.validFrom).toBeUndefined()
  })

  it('never emits a validFrom at or after the current moment for a past event', () => {
    const schema = eventToSchema({ ...baseEvent, created_at: '2026-05-02T09:15:00+00:00' })
    expect(new Date(schema.offers!.validFrom!).getTime()).toBeLessThan(Date.now())
  })
})
