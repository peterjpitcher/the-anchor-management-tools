import { describe, expect, it } from 'vitest'
import {
  buildEventArrivalLine,
  formatEventDateLondon,
  formatEventDateShortLondon,
  formatEventTimeLondon,
  formatEventWhenCompactLondon,
  formatEventWhenLondon,
  formatWallClockTime,
  resolveEventStartIso,
} from '../event-when'

/**
 * These run in both the London and the UTC suite. Every expectation is the London answer, so a
 * pass in one zone and a fail in the other is exactly the defect this module exists to stop.
 */
describe('event when', () => {
  describe('resolveEventStartIso', () => {
    it('keeps a stored instant as it is', () => {
      expect(resolveEventStartIso({ start_datetime: '2026-09-16T18:00:00.000Z' }))
        .toBe('2026-09-16T18:00:00.000Z')
    })

    it('reads a date and time as a London wall clock in British Summer Time', () => {
      expect(resolveEventStartIso({ date: '2026-09-16', time: '19:00:00' }))
        .toBe('2026-09-16T18:00:00.000Z')
    })

    it('reads a date and time as a London wall clock in GMT', () => {
      expect(resolveEventStartIso({ date: '2026-11-20', time: '19:00:00' }))
        .toBe('2026-11-20T19:00:00.000Z')
    })

    it('resolves the hour the clocks go back to its first occurrence', () => {
      // 25 October 2026: 1am happens twice, and 1am means the first one.
      expect(resolveEventStartIso({ date: '2026-10-25', time: '01:00' }))
        .toBe('2026-10-25T00:00:00.000Z')
    })

    it('resolves the hour the clocks skip to the instant the clock passes it', () => {
      // 29 March 2026: 01:30 never shows, and the clock jumps at 01:00 GMT.
      expect(resolveEventStartIso({ date: '2026-03-29', time: '01:30' }))
        .toBe('2026-03-29T01:00:00.000Z')
    })

    it('returns null rather than an invalid instant', () => {
      expect(resolveEventStartIso({ date: '2026-02-30', time: '19:00' })).toBeNull()
      expect(resolveEventStartIso({})).toBeNull()
      expect(resolveEventStartIso(null)).toBeNull()
    })
  })

  describe('formatting', () => {
    it('writes the house date shape with no comma', () => {
      expect(formatEventDateLondon('2026-09-16T18:00:00.000Z')).toBe('Wednesday 16 September 2026')
    })

    it('drops the year for a subject line', () => {
      expect(formatEventDateShortLondon('2026-09-16T18:00:00.000Z')).toBe('Wednesday 16 September')
    })

    it('writes the London clock time, not the server clock time', () => {
      expect(formatEventTimeLondon('2026-09-16T18:00:00.000Z')).toBe('7pm')
      expect(formatEventTimeLondon('2026-11-20T19:00:00.000Z')).toBe('7pm')
      expect(formatEventTimeLondon('2026-11-01T00:15:00.000Z')).toBe('12:15am')
    })

    it('joins the date and time the way every guest email reads', () => {
      expect(formatEventWhenLondon('2026-09-16T18:00:00.000Z'))
        .toBe('Wednesday 16 September 2026 at 7pm')
    })

    it('abbreviates the same answer for a text message', () => {
      expect(formatEventWhenCompactLondon('2026-09-16T18:00:00.000Z')).toBe('Wed 16 Sep at 7pm')
      expect(formatEventWhenCompactLondon('2026-11-20T19:00:00.000Z')).toBe('Fri 20 Nov at 7pm')
    })

    it('turns a stored time column into a spoken time', () => {
      expect(formatWallClockTime('18:30:00')).toBe('6:30pm')
      expect(formatWallClockTime('19:00')).toBe('7pm')
      expect(formatWallClockTime('00:00')).toBe('12am')
      expect(formatWallClockTime('12:00')).toBe('12pm')
      expect(formatWallClockTime('')).toBeNull()
      expect(formatWallClockTime('25:00')).toBeNull()
    })

    it('returns null for everything it cannot read, rather than Invalid Date', () => {
      expect(formatEventDateLondon(null)).toBeNull()
      expect(formatEventWhenLondon('not a date')).toBeNull()
      expect(formatEventTimeLondon(undefined)).toBeNull()
    })
  })

  describe('buildEventArrivalLine', () => {
    it('uses the approved arrival wording', () => {
      expect(buildEventArrivalLine({ doorsTime: '18:30:00', startIso: '2026-09-16T18:00:00.000Z' }))
        .toBe('Arrive from 6:30pm for a 7pm start.')
    })

    it('says "an" before eight and eleven', () => {
      expect(buildEventArrivalLine({ doorsTime: '19:00:00', startIso: '2026-09-18T19:00:00.000Z' }))
        .toBe('Arrive from 7pm for an 8pm start.')
    })

    it('gives the arrival time alone when the start is unknown', () => {
      expect(buildEventArrivalLine({ doorsTime: '18:30:00', startIso: null }))
        .toBe('Arrive from 6:30pm.')
    })

    it('invents nothing when the event carries no arrival time', () => {
      expect(buildEventArrivalLine({ doorsTime: null, startIso: '2026-09-16T18:00:00.000Z' })).toBeNull()
    })

    it('never says doors, which is banned wording', () => {
      const line = buildEventArrivalLine({ doorsTime: '18:30:00', startIso: '2026-09-16T18:00:00.000Z' })
      expect(line?.toLowerCase()).not.toContain('doors')
    })
  })
})
