import { describe, expect, it } from 'vitest'
import {
  keepStoredTimeWhenUnchanged,
  londonWallClockOnNextDate,
  londonWallClockToInstant,
  resolveClockOutInstant,
  resolvePremiumBoundaryIso,
} from '@/lib/timeclock/session-times'

const iso = (instant: Date | null) => instant?.toISOString() ?? null

describe('londonWallClockToInstant', () => {
  it('reads an ordinary time in BST and in GMT', () => {
    expect(iso(londonWallClockToInstant('2026-09-12', '20:00'))).toBe('2026-09-12T19:00:00.000Z')
    expect(iso(londonWallClockToInstant('2026-12-12', '20:00'))).toBe('2026-12-12T20:00:00.000Z')
  })

  describe('Sunday 28 March 2027, when 01:00 to 01:59 does not exist', () => {
    it.each([
      // Typed, stored (UTC), as the clock shows it.
      ['00:59', '2027-03-28T00:59:00.000Z'], // 00:59 GMT
      ['01:00', '2027-03-28T01:00:00.000Z'], // read as 01:00 GMT, shown as 02:00 BST
      ['01:30', '2027-03-28T01:30:00.000Z'], // read as 01:30 GMT, shown as 02:30 BST
      ['01:59', '2027-03-28T01:59:00.000Z'], // read as 01:59 GMT, shown as 02:59 BST
      ['02:00', '2027-03-28T01:00:00.000Z'], // 02:00 BST
    ])('reads %s forwards, as %s', (typed, stored) => {
      expect(iso(londonWallClockToInstant('2027-03-28', typed))).toBe(stored)
    })
  })

  describe('Sunday 25 October 2026, when 01:00 to 01:59 happens twice', () => {
    it.each([
      ['00:59', '2026-10-24T23:59:00.000Z'], // 00:59 BST
      ['01:00', '2026-10-25T01:00:00.000Z'], // the second 01:00, GMT
      ['01:30', '2026-10-25T01:30:00.000Z'], // the second 01:30, GMT
      ['02:00', '2026-10-25T02:00:00.000Z'], // 02:00 GMT
    ])('reads %s as the later one, %s', (typed, stored) => {
      expect(iso(londonWallClockToInstant('2026-10-25', typed))).toBe(stored)
    })
  })

  it.each([
    ['2026-02-30', '20:00'],
    ['2026-09-12', '24:00'],
    ['2026-09-12', '12:60'],
    ['2026-09-12', '9:00'],
    ['', '20:00'],
  ])('is null for %s %s', (date, time) => {
    expect(londonWallClockToInstant(date, time)).toBeNull()
  })
})

describe('londonWallClockOnNextDate', () => {
  it('finds the next London date on the calendar, across both clock changes', () => {
    expect(iso(londonWallClockOnNextDate('2026-10-24', '02:00'))).toBe('2026-10-25T02:00:00.000Z')
    expect(iso(londonWallClockOnNextDate('2027-03-27', '02:00'))).toBe('2027-03-28T01:00:00.000Z')
    expect(iso(londonWallClockOnNextDate('2026-12-31', '01:00'))).toBe('2027-01-01T01:00:00.000Z')
  })
})

describe('resolveClockOutInstant', () => {
  const clockIn = new Date('2026-09-12T19:00:00.000Z') // 20:00 BST on Saturday 12 September

  it('keeps a clock-out after the clock-in on the work date', () => {
    expect(iso(resolveClockOutInstant('2026-09-12', '23:30', clockIn))).toBe('2026-09-12T22:30:00.000Z')
  })

  it('moves a clock-out at or before the clock-in to the next London date', () => {
    expect(iso(resolveClockOutInstant('2026-09-12', '20:00', clockIn))).toBe('2026-09-13T19:00:00.000Z')
    expect(iso(resolveClockOutInstant('2026-09-12', '01:15', clockIn))).toBe('2026-09-13T00:15:00.000Z')
  })

  it('is null for a time that is not on the clock', () => {
    expect(resolveClockOutInstant('2026-09-12', '25:00', clockIn)).toBeNull()
  })
})

describe('resolvePremiumBoundaryIso', () => {
  it.each([
    // Work date, clock-in, boundary, stored. The old screen added 24 hours to the same time on
    // the work date, which gave 01:00 GMT on 25 October and 03:00 BST on 28 March.
    ['2026-09-12', '20:00', '02:00', '2026-09-13T01:00:00.000Z'],
    ['2026-10-24', '20:00', '02:00', '2026-10-25T02:00:00.000Z'],
    ['2027-03-27', '20:00', '02:00', '2027-03-28T01:00:00.000Z'],
    // A boundary after the clock-in stays on the work date.
    ['2026-10-24', '20:00', '23:00', '2026-10-24T22:00:00.000Z'],
    // A boundary at the clock-in is the start of the shift, not the next day.
    ['2026-10-24', '20:00', '20:00', '2026-10-24T19:00:00.000Z'],
  ])('%s from %s, a boundary at %s is %s', (workDate, clockIn, boundary, stored) => {
    expect(resolvePremiumBoundaryIso(workDate, clockIn, boundary)).toBe(stored)
  })

  it('is null when blank', () => {
    expect(resolvePremiumBoundaryIso('2026-10-24', '20:00', '')).toBeNull()
  })
})

describe('keepStoredTimeWhenUnchanged', () => {
  it('keeps the stored instant, seconds and all, when it shows the same date and minute', () => {
    const resolved = new Date('2026-09-12T19:02:00.000Z')
    expect(iso(keepStoredTimeWhenUnchanged(resolved, '2026-09-12T19:02:41.000Z'))).toBe('2026-09-12T19:02:41.000Z')
  })

  it('keeps the first 01:12 on 25 October when the form sends back "01:12"', () => {
    const resolved = londonWallClockToInstant('2026-10-25', '01:12')! // the second 01:12
    expect(iso(keepStoredTimeWhenUnchanged(resolved, '2026-10-25T00:12:09.000Z'))).toBe('2026-10-25T00:12:09.000Z')
  })

  it('uses the typed time when the minute or the date changed', () => {
    const resolved = new Date('2026-09-12T19:03:00.000Z')
    expect(iso(keepStoredTimeWhenUnchanged(resolved, '2026-09-12T19:02:41.000Z'))).toBe('2026-09-12T19:03:00.000Z')
    const nextDay = new Date('2026-09-13T19:02:00.000Z')
    expect(iso(keepStoredTimeWhenUnchanged(nextDay, '2026-09-12T19:02:41.000Z'))).toBe('2026-09-13T19:02:00.000Z')
  })

  it('uses the typed time when nothing usable is stored', () => {
    const resolved = new Date('2026-09-12T19:02:00.000Z')
    expect(iso(keepStoredTimeWhenUnchanged(resolved, null))).toBe('2026-09-12T19:02:00.000Z')
    expect(iso(keepStoredTimeWhenUnchanged(resolved, 'not a time'))).toBe('2026-09-12T19:02:00.000Z')
  })
})
