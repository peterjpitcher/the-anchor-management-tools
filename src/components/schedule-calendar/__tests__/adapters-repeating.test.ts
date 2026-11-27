import { describe, expect, it } from 'vitest'
import { repeatingEventToEntry } from '../adapters'
import { entryTooltipText } from '../tooltip-text'

describe('repeatingEventToEntry', () => {
  const night = { seriesId: 'series-1', name: 'Ladies Darts Night', date: '2026-12-10', startTime: '19:00', endTime: '22:00' }

  it('draws a night lighter, as an event, and carries the repeating event it opens', () => {
    const entry = repeatingEventToEntry(night)
    expect(entry).toMatchObject({
      id: 'series:series-1:2026-12-10',
      kind: 'event',
      title: 'Ladies Darts Night',
      subtitle: 'Repeats weekly',
      onClickHref: null,
      muted: true,
      seriesId: 'series-1',
      endsNextDay: false,
    })
    expect(entry.end.getTime() - entry.start.getTime()).toBe(3 * 60 * 60 * 1000)
  })

  it('says it has no bookings rather than "0 booked"', () => {
    const text = entryTooltipText(repeatingEventToEntry(night))
    expect(text).toContain('Repeating event: Ladies Darts Night')
    expect(text).toContain('Repeats weekly, no bookings')
    expect(text).not.toContain('0 booked')
  })

  it('ends the next day when the night runs past midnight', () => {
    const entry = repeatingEventToEntry({ ...night, startTime: '21:00', endTime: '01:00' })
    expect(entry.endsNextDay).toBe(true)
    expect(entry.end > entry.start).toBe(true)
  })
})
