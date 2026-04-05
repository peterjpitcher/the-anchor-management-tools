import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/dateUtils', () => ({
  getTodayIsoDate: () => '2026-03-15',
}))

import {
  getMgdQuarter,
  getCurrentMgdQuarter,
  getAllMgdQuarters,
  getCalendarQuarterMgdOverlap,
} from './quarterMapping'

// ---------------------------------------------------------------------------
// getMgdQuarter
// ---------------------------------------------------------------------------

describe('getMgdQuarter', () => {
  describe('Feb-Apr quarter', () => {
    it('maps February to Feb-Apr', () => {
      const result = getMgdQuarter(new Date(2026, 1, 1)) // Feb 1
      expect(result).toEqual({
        periodStart: '2026-02-01',
        periodEnd: '2026-04-30',
        label: 'Feb 2026 \u2014 Apr 2026',
      })
    })

    it('maps March to Feb-Apr', () => {
      const result = getMgdQuarter(new Date(2026, 2, 15)) // Mar 15
      expect(result.periodStart).toBe('2026-02-01')
      expect(result.periodEnd).toBe('2026-04-30')
    })

    it('maps April to Feb-Apr', () => {
      const result = getMgdQuarter(new Date(2026, 3, 30)) // Apr 30
      expect(result.periodStart).toBe('2026-02-01')
      expect(result.periodEnd).toBe('2026-04-30')
    })
  })

  describe('May-Jul quarter', () => {
    it('maps May to May-Jul', () => {
      const result = getMgdQuarter(new Date(2026, 4, 1)) // May 1
      expect(result.periodStart).toBe('2026-05-01')
      expect(result.periodEnd).toBe('2026-07-31')
    })

    it('maps July to May-Jul', () => {
      const result = getMgdQuarter(new Date(2026, 6, 31)) // Jul 31
      expect(result.periodStart).toBe('2026-05-01')
      expect(result.periodEnd).toBe('2026-07-31')
    })
  })

  describe('Aug-Oct quarter', () => {
    it('maps August to Aug-Oct', () => {
      const result = getMgdQuarter(new Date(2026, 7, 1)) // Aug 1
      expect(result.periodStart).toBe('2026-08-01')
      expect(result.periodEnd).toBe('2026-10-31')
    })

    it('maps October to Aug-Oct', () => {
      const result = getMgdQuarter(new Date(2026, 9, 31)) // Oct 31
      expect(result.periodStart).toBe('2026-08-01')
      expect(result.periodEnd).toBe('2026-10-31')
    })
  })

  describe('Nov-Jan quarter', () => {
    it('maps November to Nov-Jan (cross-year)', () => {
      const result = getMgdQuarter(new Date(2025, 10, 1)) // Nov 1 2025
      expect(result).toEqual({
        periodStart: '2025-11-01',
        periodEnd: '2026-01-31',
        label: 'Nov 2025 \u2014 Jan 2026',
      })
    })

    it('maps December to Nov-Jan (cross-year)', () => {
      const result = getMgdQuarter(new Date(2025, 11, 25)) // Dec 25 2025
      expect(result.periodStart).toBe('2025-11-01')
      expect(result.periodEnd).toBe('2026-01-31')
    })

    it('maps January to PREVIOUS year Nov-Jan', () => {
      const result = getMgdQuarter(new Date(2026, 0, 15)) // Jan 15 2026
      expect(result).toEqual({
        periodStart: '2025-11-01',
        periodEnd: '2026-01-31',
        label: 'Nov 2025 \u2014 Jan 2026',
      })
    })

    it('maps January 1 to previous year Nov-Jan', () => {
      const result = getMgdQuarter(new Date(2026, 0, 1)) // Jan 1 2026
      expect(result.periodStart).toBe('2025-11-01')
      expect(result.periodEnd).toBe('2026-01-31')
    })

    it('maps January 31 (boundary) to previous year Nov-Jan', () => {
      const result = getMgdQuarter(new Date(2026, 0, 31)) // Jan 31 2026
      expect(result.periodStart).toBe('2025-11-01')
      expect(result.periodEnd).toBe('2026-01-31')
    })
  })

  describe('boundary dates', () => {
    it('Feb 1 is in Feb-Apr', () => {
      expect(getMgdQuarter(new Date(2026, 1, 1)).periodStart).toBe('2026-02-01')
    })

    it('Apr 30 is in Feb-Apr', () => {
      expect(getMgdQuarter(new Date(2026, 3, 30)).periodEnd).toBe('2026-04-30')
    })

    it('May 1 is in May-Jul', () => {
      expect(getMgdQuarter(new Date(2026, 4, 1)).periodStart).toBe('2026-05-01')
    })

    it('Jul 31 is in May-Jul', () => {
      expect(getMgdQuarter(new Date(2026, 6, 31)).periodEnd).toBe('2026-07-31')
    })

    it('Aug 1 is in Aug-Oct', () => {
      expect(getMgdQuarter(new Date(2026, 7, 1)).periodStart).toBe('2026-08-01')
    })

    it('Oct 31 is in Aug-Oct', () => {
      expect(getMgdQuarter(new Date(2026, 9, 31)).periodEnd).toBe('2026-10-31')
    })

    it('Nov 1 is in Nov-Jan', () => {
      expect(getMgdQuarter(new Date(2026, 10, 1)).periodStart).toBe('2026-11-01')
    })

    it('Jan 31 is in previous Nov-Jan', () => {
      expect(getMgdQuarter(new Date(2027, 0, 31)).periodEnd).toBe('2027-01-31')
    })
  })
})

// ---------------------------------------------------------------------------
// getCurrentMgdQuarter
// ---------------------------------------------------------------------------

describe('getCurrentMgdQuarter', () => {
  it('returns the correct quarter for the mocked current date (2026-03-15)', () => {
    const result = getCurrentMgdQuarter()
    expect(result.periodStart).toBe('2026-02-01')
    expect(result.periodEnd).toBe('2026-04-30')
  })
})

// ---------------------------------------------------------------------------
// getAllMgdQuarters
// ---------------------------------------------------------------------------

describe('getAllMgdQuarters', () => {
  it('returns 4 quarters per year', () => {
    const result = getAllMgdQuarters(2025, 2025)
    expect(result).toHaveLength(4)
  })

  it('returns 8 quarters for 2 years', () => {
    const result = getAllMgdQuarters(2025, 2026)
    expect(result).toHaveLength(8)
  })

  it('quarters are in chronological order by period_start', () => {
    const result = getAllMgdQuarters(2025, 2025)
    expect(result[0].periodStart).toBe('2025-02-01')
    expect(result[1].periodStart).toBe('2025-05-01')
    expect(result[2].periodStart).toBe('2025-08-01')
    expect(result[3].periodStart).toBe('2025-11-01')
  })

  it('Nov quarter spans into next year', () => {
    const result = getAllMgdQuarters(2025, 2025)
    expect(result[3].periodEnd).toBe('2026-01-31')
  })
})

// ---------------------------------------------------------------------------
// getCalendarQuarterMgdOverlap
// ---------------------------------------------------------------------------

describe('getCalendarQuarterMgdOverlap', () => {
  it('Q1 maps to Feb-Apr', () => {
    const result = getCalendarQuarterMgdOverlap(2026, 1)
    expect(result).toEqual({
      periodStart: '2026-02-01',
      periodEnd: '2026-04-30',
    })
  })

  it('Q2 maps to May-Jul', () => {
    const result = getCalendarQuarterMgdOverlap(2026, 2)
    expect(result).toEqual({
      periodStart: '2026-05-01',
      periodEnd: '2026-07-31',
    })
  })

  it('Q3 maps to Aug-Oct', () => {
    const result = getCalendarQuarterMgdOverlap(2026, 3)
    expect(result).toEqual({
      periodStart: '2026-08-01',
      periodEnd: '2026-10-31',
    })
  })

  it('Q4 maps to Nov-Jan (cross-year)', () => {
    const result = getCalendarQuarterMgdOverlap(2026, 4)
    expect(result).toEqual({
      periodStart: '2026-11-01',
      periodEnd: '2027-01-31',
    })
  })
})
