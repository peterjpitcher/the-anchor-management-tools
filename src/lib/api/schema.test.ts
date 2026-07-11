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
