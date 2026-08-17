import { describe, expect, it } from 'vitest'

/**
 * These functions decide how many hours the rota report says people worked, on both
 * the screen and the printed PDF. Until now each surface carried its own byte-identical
 * copy, so they agreed by luck rather than by construction.
 *
 * The cases below are the ones that would silently produce wrong hours: the Sunday
 * boundary when finding the start of a week, the two mornings a year the UK clocks
 * change, and a session that is still clocked in.
 */

import {
  isIsoDate,
  toIsoDate,
  addDaysIso,
  addWeeksIso,
  mondayOfWeekIso,
  weekLabel,
  actualHours,
  roundHours,
  generateWeeks,
} from '@/lib/rota/hours-report'

describe('isIsoDate', () => {
  it('accepts a plain calendar date', () => {
    expect(isIsoDate('2026-08-17')).toBe(true)
  })

  it.each([undefined, null, '', '17/08/2026', '2026-8-17', '2026-08-17T00:00:00Z'])(
    'rejects %p', (value) => {
      expect(isIsoDate(value as string | null | undefined)).toBe(false)
    }
  )
})

describe('mondayOfWeekIso', () => {
  it('returns the same day when given a Monday', () => {
    expect(mondayOfWeekIso('2026-08-17')).toBe('2026-08-17')
  })

  it('walks back to Monday from midweek', () => {
    expect(mondayOfWeekIso('2026-08-20')).toBe('2026-08-17')
  })

  it('treats Sunday as the END of its week, not the start', () => {
    // Sunday is day 0, so naive arithmetic jumps forward a week here and every
    // Sunday shift lands in the wrong week's total.
    expect(mondayOfWeekIso('2026-08-23')).toBe('2026-08-17')
  })

  it('is unaffected by the spring clock change', () => {
    // Clocks go forward on Sunday 29 March 2026. Local-time arithmetic loses an hour
    // across this boundary and can roll the date back a day.
    expect(mondayOfWeekIso('2026-03-29')).toBe('2026-03-23')
    expect(mondayOfWeekIso('2026-03-30')).toBe('2026-03-30')
  })

  it('is unaffected by the autumn clock change', () => {
    // Clocks go back on Sunday 25 October 2026.
    expect(mondayOfWeekIso('2026-10-25')).toBe('2026-10-19')
    expect(mondayOfWeekIso('2026-10-26')).toBe('2026-10-26')
  })
})

describe('addDaysIso and addWeeksIso', () => {
  it('crosses a month boundary', () => {
    expect(addDaysIso('2026-08-31', 1)).toBe('2026-09-01')
  })

  it('crosses a year boundary', () => {
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('handles the leap day', () => {
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('goes backwards', () => {
    expect(addDaysIso('2026-09-01', -1)).toBe('2026-08-31')
  })

  it('crosses both clock changes without drifting a day', () => {
    expect(addDaysIso('2026-03-28', 1)).toBe('2026-03-29')
    expect(addDaysIso('2026-03-29', 1)).toBe('2026-03-30')
    expect(addDaysIso('2026-10-24', 1)).toBe('2026-10-25')
    expect(addDaysIso('2026-10-25', 1)).toBe('2026-10-26')
  })

  it('adds whole weeks', () => {
    expect(addWeeksIso('2026-08-17', 2)).toBe('2026-08-31')
  })
})

describe('actualHours', () => {
  it('measures a completed session', () => {
    expect(actualHours({ clock_in_at: '2026-08-17T09:00:00Z', clock_out_at: '2026-08-17T17:30:00Z' }))
      .toBeCloseTo(8.5, 5)
  })

  it('counts a session still clocked in as zero rather than as running', () => {
    // Counting an open session as "now minus clock-in" would make the report grow
    // while someone reads it, and inflate hours for anyone who forgot to clock out.
    expect(actualHours({ clock_in_at: '2026-08-17T09:00:00Z', clock_out_at: null })).toBe(0)
  })

  it('returns zero rather than NaN when clock_out_at is missing entirely', () => {
    // A null clock-out happens to survive the arithmetic, because new Date(null) is
    // the epoch and Math.max clamps the negative result to zero. An UNDEFINED one does
    // not: new Date(undefined) is Invalid Date, the subtraction yields NaN, and
    // Math.max(0, NaN) is NaN, which would render as a blank or "NaN" hours cell.
    // That is what the explicit guard is actually for.
    const missing = { clock_in_at: '2026-08-17T09:00:00Z' } as { clock_in_at: string; clock_out_at: string | null }

    expect(actualHours(missing)).toBe(0)
    expect(Number.isNaN(actualHours(missing))).toBe(false)
  })

  it('never returns negative hours when the pair is out of order', () => {
    expect(actualHours({ clock_in_at: '2026-08-17T17:00:00Z', clock_out_at: '2026-08-17T09:00:00Z' })).toBe(0)
  })

  it('measures an overnight session across midnight', () => {
    expect(actualHours({ clock_in_at: '2026-08-17T22:00:00Z', clock_out_at: '2026-08-18T02:00:00Z' }))
      .toBeCloseTo(4, 5)
  })

  it('measures a shift spanning the autumn clock change in real elapsed time', () => {
    // 00:00 to 03:00 UTC is three real hours regardless of what the wall clock did.
    expect(actualHours({ clock_in_at: '2026-10-25T00:00:00Z', clock_out_at: '2026-10-25T03:00:00Z' }))
      .toBeCloseTo(3, 5)
  })
})

describe('roundHours', () => {
  it.each([
    [8.44, 8.4],
    [8.45, 8.5],
    [8.449, 8.4],
    [0, 0],
  ])('rounds %p to %p', (input, expected) => {
    expect(roundHours(input)).toBe(expected)
  })
})

describe('generateWeeks', () => {
  it('returns each week start inclusive of both ends', () => {
    expect(generateWeeks('2026-08-17', '2026-08-31')).toEqual(['2026-08-17', '2026-08-24', '2026-08-31'])
  })

  it('snaps a midweek range onto week starts', () => {
    expect(generateWeeks('2026-08-19', '2026-08-26')).toEqual(['2026-08-17', '2026-08-24'])
  })

  it('returns a single week when both dates share one', () => {
    expect(generateWeeks('2026-08-18', '2026-08-20')).toEqual(['2026-08-17'])
  })

  it('spans the spring clock change without skipping or repeating a week', () => {
    expect(generateWeeks('2026-03-23', '2026-04-06')).toEqual(['2026-03-23', '2026-03-30', '2026-04-06'])
  })
})

describe('toIsoDate and weekLabel', () => {
  it('formats a date as a plain calendar day', () => {
    expect(toIsoDate(new Date('2026-08-17T23:30:00Z'))).toBe('2026-08-17')
  })

  it('labels a week start for a British reader', () => {
    expect(weekLabel('2026-08-17')).toBe('17 Aug')
  })
})
