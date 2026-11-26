import { describe, expect, it } from 'vitest'
import {
  describeOccurrenceLine,
  describeSeriesSchedule,
  isSeriesWeekday,
  nextSeriesOccurrence,
  resolveSeriesOccurrences,
  type EventSeriesRule,
  type EventSeriesSkip,
} from '@/lib/events/series'

const darts: EventSeriesRule = {
  id: 'series-1',
  weekday: 4,
  startTime: '19:00:00',
  endTime: '22:00:00',
  startsOn: '2026-01-01',
  endsOn: null,
  status: 'active',
  skipWhenClosed: true,
}

const christmasSkips: EventSeriesSkip[] = [
  { skipDate: '2026-12-24', reason: 'Christmas Eve', replacedByEventId: null },
  { skipDate: '2026-12-31', reason: "New Year's Eve", replacedByEventId: null },
]

describe('resolveSeriesOccurrences', () => {
  it('a Wednesday at 23:30 UTC in July is Thursday 00:30 in London, so next is that Thursday', () => {
    const next = nextSeriesOccurrence(darts, [], [], new Date('2026-07-15T23:30:00Z'))
    expect(next?.date).toBe('2026-07-16')
    expect(next?.startsAt).toBe('2026-07-16T18:00:00.000Z')
  })

  it('counts today until the end time has passed', () => {
    expect(nextSeriesOccurrence(darts, [], [], new Date('2026-12-10T21:59:00Z'))?.date).toBe('2026-12-10')
    expect(nextSeriesOccurrence(darts, [], [], new Date('2026-12-10T22:00:00Z'))?.date).toBe('2026-12-17')
    // From 10pm on 3 December until 10pm on the 10th, the 10th is next (spec section 13).
    expect(nextSeriesOccurrence(darts, christmasSkips, [], new Date('2026-12-03T22:00:00Z'))?.date).toBe('2026-12-10')
  })

  it('keeps 19:00 London on the Thursdays either side of both clock changes', () => {
    const { occurrences } = resolveSeriesOccurrences(darts, [], [], '2026-03-19', '2026-11-05')
    const byDate = new Map(occurrences.map((o) => [o.date, o]))
    // Clocks go forward Sunday 29 March 2026, back Sunday 25 October 2026.
    expect(byDate.get('2026-03-26')?.startsAt).toBe('2026-03-26T19:00:00.000Z')
    expect(byDate.get('2026-04-02')?.startsAt).toBe('2026-04-02T18:00:00.000Z')
    expect(byDate.get('2026-10-22')?.startsAt).toBe('2026-10-22T18:00:00.000Z')
    expect(byDate.get('2026-10-29')?.startsAt).toBe('2026-10-29T19:00:00.000Z')
    for (const o of occurrences) {
      expect(o.startTime).toBe('19:00')
      expect(o.endTime).toBe('22:00')
    }
  })

  it('skips 24 and 31 December 2026 by hand and runs on 7 January 2027', () => {
    const { occurrences, skipped } = resolveSeriesOccurrences(darts, christmasSkips, [], '2026-12-17', '2027-01-07')
    expect(occurrences.map((o) => o.date)).toEqual(['2026-12-17', '2027-01-07'])
    expect(skipped).toEqual([
      { date: '2026-12-24', kind: 'manual', reason: 'Christmas Eve', replacedByEventId: null },
      { date: '2026-12-31', kind: 'manual', reason: "New Year's Eve", replacedByEventId: null },
    ])
  })

  it('skips a Thursday closed in special hours and reports it as closed, not manual', () => {
    const { occurrences, skipped } = resolveSeriesOccurrences(
      darts,
      [],
      [{ date: '2026-12-10', isClosed: true }],
      '2026-12-10',
      '2026-12-10'
    )
    expect(occurrences).toEqual([])
    expect(skipped).toEqual([{ date: '2026-12-10', kind: 'closed', reason: null, replacedByEventId: null }])
  })

  it('still runs on a Thursday when only the kitchen is closed', () => {
    const { occurrences } = resolveSeriesOccurrences(
      darts,
      [],
      [{ date: '2026-12-10', isClosed: false }],
      '2026-12-10',
      '2026-12-10'
    )
    expect(occurrences.map((o) => o.date)).toEqual(['2026-12-10'])
  })

  it('ignores a closure when skip_when_closed is off', () => {
    const { occurrences } = resolveSeriesOccurrences(
      { ...darts, skipWhenClosed: false },
      [],
      [{ date: '2026-12-10', isClosed: true }],
      '2026-12-10',
      '2026-12-10'
    )
    expect(occurrences).toHaveLength(1)
  })

  it('includes ends_on when it is a Thursday, and returns nothing after it', () => {
    const ending = { ...darts, endsOn: '2027-01-14' }
    expect(resolveSeriesOccurrences(ending, [], [], '2027-01-14', '2027-01-14').occurrences).toHaveLength(1)
    expect(resolveSeriesOccurrences(ending, [], [], '2027-01-15', '2027-03-01').occurrences).toEqual([])
  })

  it('starts no earlier than starts_on', () => {
    const { occurrences } = resolveSeriesOccurrences({ ...darts, startsOn: '2026-12-03' }, [], [], '2026-11-01', '2026-12-10')
    expect(occurrences.map((o) => o.date)).toEqual(['2026-12-03', '2026-12-10'])
  })

  it('returns nothing for a paused or ended series', () => {
    expect(resolveSeriesOccurrences({ ...darts, status: 'paused' }, [], [], '2026-12-01', '2026-12-31').occurrences).toEqual([])
    expect(resolveSeriesOccurrences({ ...darts, status: 'ended' }, [], [], '2026-12-01', '2026-12-31').occurrences).toEqual([])
  })

  it('ends a night past midnight on the next day', () => {
    const late = { ...darts, startTime: '21:00', endTime: '01:00' }
    const { occurrences } = resolveSeriesOccurrences(late, [], [], '2026-12-10', '2026-12-10')
    expect(occurrences[0].endsAt).toBe('2026-12-11T01:00:00.000Z')
    // Still "next" at 00:30 on the Friday.
    expect(nextSeriesOccurrence(late, [], [], new Date('2026-12-11T00:30:00Z'))?.date).toBe('2026-12-10')
  })
})

describe('replaced dates', () => {
  it('reports a date made into a full event as replaced, not manual', () => {
    const { occurrences, skipped } = resolveSeriesOccurrences(
      darts,
      [{ skipDate: '2027-01-14', reason: null, replacedByEventId: 'event-9' }],
      [],
      '2027-01-14',
      '2027-01-14'
    )
    expect(occurrences).toEqual([])
    expect(skipped).toEqual([{ date: '2027-01-14', kind: 'replaced', reason: null, replacedByEventId: 'event-9' }])
  })
})

describe('isSeriesWeekday', () => {
  it('refuses a skip date that is not on the weekday', () => {
    expect(isSeriesWeekday(darts, '2026-12-24')).toBe(true)
    expect(isSeriesWeekday(darts, '2026-12-25')).toBe(false)
    expect(isSeriesWeekday(darts, 'not-a-date')).toBe(false)
  })
})

describe('labels', () => {
  it('derives the day name from the weekday', () => {
    expect(describeSeriesSchedule(darts)).toBe('Every Thursday, 7pm to 10pm')
    expect(describeSeriesSchedule({ weekday: 1, startTime: '19:30', endTime: '00:00' })).toBe('Every Monday, 7:30pm to midnight')
    expect(describeOccurrenceLine('Ladies Darts Night', { startTime: '19:00', endTime: '22:00' })).toBe('Ladies Darts Night, 7pm to 10pm')
  })
})
