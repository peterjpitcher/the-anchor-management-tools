import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  getTodayIsoDate,
  toLocalIsoDate,
  formatDateInLondon,
  formatTime12Hour,
  formatDate,
  formatDateFull,
  formatDateDdMmmmYyyy,
  formatDateTime,
  formatDateWithTimeForSms,
} from '../dateUtils'

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// getTodayIsoDate
// ---------------------------------------------------------------------------

describe('getTodayIsoDate', () => {
  it('should return a string in YYYY-MM-DD format', () => {
    const result = getTodayIsoDate()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('should return the date matching faked system clock', () => {
    // Fake the clock to a known UTC time: 2025-06-15T12:00:00Z
    // getTodayIsoDate adjusts by the runtime timezone offset, so we verify
    // structural correctness and that it reflects the faked "now".
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'))
    const result = getTodayIsoDate()
    // Must be a valid date string; the exact value depends on the host TZ
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // The year must be 2025
    expect(result.startsWith('2025-')).toBe(true)
  })

  it('should return a string that can be parsed back to a valid date', () => {
    const result = getTodayIsoDate()
    const parsed = new Date(result)
    expect(isNaN(parsed.getTime())).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// toLocalIsoDate
// ---------------------------------------------------------------------------

describe('toLocalIsoDate', () => {
  it('should return a YYYY-MM-DD string', () => {
    const result = toLocalIsoDate(new Date('2025-06-15T12:00:00Z'))
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('should preserve the same date when given a UTC noon timestamp', () => {
    // UTC noon on 2025-06-15 is 15 Jun in all timezones from UTC-11 to UTC+11
    const result = toLocalIsoDate(new Date('2025-06-15T12:00:00Z'))
    expect(result).toBe('2025-06-15')
  })

  it('should handle a Date constructed from an ISO string', () => {
    const d = new Date('2024-01-01T00:00:00Z')
    const result = toLocalIsoDate(d)
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('should not mutate the original Date object', () => {
    const original = new Date('2025-06-15T12:00:00Z')
    const originalTime = original.getTime()
    toLocalIsoDate(original)
    expect(original.getTime()).toBe(originalTime)
  })
})

// ---------------------------------------------------------------------------
// formatDateInLondon
// ---------------------------------------------------------------------------

describe('formatDateInLondon', () => {
  it('should format a UTC date as a London-timezone date string', () => {
    // 2025-12-25T12:00:00Z is Christmas Day in London
    const result = formatDateInLondon('2025-12-25T12:00:00Z')
    expect(result).toContain('25')
    expect(result).toContain('12')
    expect(result).toContain('2025')
  })

  it('should respect custom Intl.DateTimeFormatOptions', () => {
    const result = formatDateInLondon('2025-06-15T12:00:00Z', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    expect(result).toContain('2025')
    expect(result.length).toBeGreaterThan(10) // Should be verbose
  })

  it('should use en-GB locale by default', () => {
    // en-GB formats day before month: "15/06/2025" or "15 June 2025"
    const result = formatDateInLondon('2025-06-15T12:00:00Z')
    // en-GB default short format puts day first: "15/06/2025"
    expect(result).toMatch(/^15/)
  })

  it('should use the provided locale override', () => {
    const result = formatDateInLondon('2025-06-15T12:00:00Z', undefined, 'en-US')
    // en-US short format: "6/15/2025"
    expect(result).toContain('6')
    expect(result).toContain('15')
    expect(result).toContain('2025')
  })

  it('should accept a Date object as input', () => {
    const d = new Date('2025-06-15T12:00:00Z')
    const result = formatDateInLondon(d)
    expect(result).toMatch(/^\d/)
  })

  describe('BST/GMT boundary handling', () => {
    it('should display the correct London date for a timestamp just before BST starts (2026-03-29)', () => {
      // Clocks go forward 2026-03-29 at 01:00 UTC (01:00 GMT → 02:00 BST)
      // 00:30 UTC on 29 Mar 2026 is still 29 Mar in London (GMT, not yet BST)
      const result = formatDateInLondon('2026-03-29T00:30:00Z', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
      expect(result).toContain('29')
      expect(result).toContain('March')
      expect(result).toContain('2026')
    })

    it('should display the correct London date during BST', () => {
      // 2025-07-01T12:00:00Z is 01:00 pm BST (UTC+1)
      const result = formatDateInLondon('2025-07-01T12:00:00Z', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
      expect(result).toContain('1')
      expect(result).toContain('July')
      expect(result).toContain('2025')
    })

    it('should display the correct London date for a timestamp just before clocks go back (2025-10-26)', () => {
      // Clocks go back 2025-10-26 at 02:00 BST (01:00 UTC)
      // 00:30 UTC is still 26 Oct in London at BST (01:30 BST)
      const result = formatDateInLondon('2025-10-26T00:30:00Z', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
      expect(result).toContain('26')
      expect(result).toContain('October')
      expect(result).toContain('2025')
    })
  })
})

// ---------------------------------------------------------------------------
// formatTime12Hour
// ---------------------------------------------------------------------------

describe('formatTime12Hour', () => {
  it('should return "TBC" for null input', () => {
    expect(formatTime12Hour(null)).toBe('TBC')
  })

  it('should format midnight as "12am"', () => {
    expect(formatTime12Hour('00:00')).toBe('12am')
  })

  it('should format noon as "12pm"', () => {
    expect(formatTime12Hour('12:00')).toBe('12pm')
  })

  it('should format morning hours correctly (no minutes)', () => {
    expect(formatTime12Hour('07:00')).toBe('7am')
  })

  it('should format evening hours correctly (no minutes)', () => {
    expect(formatTime12Hour('19:00')).toBe('7pm')
  })

  it('should format a time with minutes correctly (morning)', () => {
    expect(formatTime12Hour('07:30')).toBe('7:30am')
  })

  it('should format a time with minutes correctly (afternoon)', () => {
    expect(formatTime12Hour('13:45')).toBe('1:45pm')
  })

  it('should pad minutes to two digits', () => {
    expect(formatTime12Hour('09:05')).toBe('9:05am')
  })

  it('should format 11pm correctly', () => {
    expect(formatTime12Hour('23:00')).toBe('11pm')
  })

  it('should format 11:59pm correctly', () => {
    expect(formatTime12Hour('23:59')).toBe('11:59pm')
  })

  it('should format 1am correctly', () => {
    expect(formatTime12Hour('01:00')).toBe('1am')
  })

  it('should return the original string for an invalid time format', () => {
    expect(formatTime12Hour('invalid')).toBe('invalid')
  })
})

// ---------------------------------------------------------------------------
// formatDate (legacy US format)
// ---------------------------------------------------------------------------

describe('formatDate', () => {
  it('should format as "Month Day, Year" in US style', () => {
    // 2025-01-15 in London is January 15 2025
    const result = formatDate('2025-01-15T12:00:00Z')
    expect(result).toContain('January')
    expect(result).toContain('15')
    expect(result).toContain('2025')
  })

  it('should accept a Date object', () => {
    const d = new Date('2025-06-01T12:00:00Z')
    const result = formatDate(d)
    expect(result).toContain('2025')
  })
})

// ---------------------------------------------------------------------------
// formatDateFull
// ---------------------------------------------------------------------------

describe('formatDateFull', () => {
  it('should return "To be confirmed" for null input', () => {
    expect(formatDateFull(null)).toBe('To be confirmed')
  })

  it('should include the weekday, day, month, and year', () => {
    // 2025-12-25 is a Thursday
    const result = formatDateFull('2025-12-25T12:00:00Z')
    expect(result).toContain('Thursday')
    expect(result).toContain('25')
    expect(result).toContain('December')
    expect(result).toContain('2025')
  })
})

// ---------------------------------------------------------------------------
// formatDateDdMmmmYyyy
// ---------------------------------------------------------------------------

describe('formatDateDdMmmmYyyy', () => {
  it('should return an empty string for null input', () => {
    expect(formatDateDdMmmmYyyy(null)).toBe('')
  })

  it('should return an empty string for undefined input', () => {
    expect(formatDateDdMmmmYyyy(undefined)).toBe('')
  })

  it('should format as "DD Month YYYY"', () => {
    const result = formatDateDdMmmmYyyy('2025-06-15T12:00:00Z')
    expect(result).toContain('15')
    expect(result).toContain('June')
    expect(result).toContain('2025')
  })
})

// ---------------------------------------------------------------------------
// formatDateTime
// ---------------------------------------------------------------------------

describe('formatDateTime', () => {
  it('should include date and time components', () => {
    // 2025-06-15T14:30:00Z = 15:30 BST in London
    const result = formatDateTime('2025-06-15T14:30:00Z')
    expect(result).toContain('2025')
    expect(result).toMatch(/\d{2}:\d{2}/) // HH:MM present
  })

  it('should accept a Date object', () => {
    const d = new Date('2025-06-15T14:30:00Z')
    const result = formatDateTime(d)
    expect(result).toContain('2025')
  })
})

// ---------------------------------------------------------------------------
// formatDateWithTimeForSms
// ---------------------------------------------------------------------------

describe('formatDateWithTimeForSms', () => {
  it('should return just the date string when time is not provided', () => {
    const result = formatDateWithTimeForSms('2025-12-25T12:00:00Z')
    // Should contain the day and month name but no "at"
    expect(result).not.toContain('at')
    expect(result).toContain('25')
    expect(result).toContain('December')
  })

  it('should include "at" and the formatted time when time is provided', () => {
    const result = formatDateWithTimeForSms('2025-12-25T12:00:00Z', '19:30')
    expect(result).toContain('at')
    expect(result).toContain('7:30pm')
  })

  it('should handle null time the same as no time', () => {
    const result = formatDateWithTimeForSms('2025-12-25T12:00:00Z', null)
    expect(result).not.toContain('at')
  })

  it('should include the weekday in the output', () => {
    // 2025-12-25 is Thursday
    const result = formatDateWithTimeForSms('2025-12-25T12:00:00Z', '12:00')
    expect(result).toContain('Thursday')
  })
})
