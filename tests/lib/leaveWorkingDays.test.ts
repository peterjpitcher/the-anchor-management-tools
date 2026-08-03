import { describe, expect, it } from 'vitest'
import {
  countLeaveAllowanceDays,
  getCountedLeaveDates,
  getHolidayYear,
  normalizeNonWorkingWeekdays,
} from '@/lib/leave/working-days'

describe('leave working day helpers', () => {
  it('excludes Saturdays and Sundays from allowance counts', () => {
    expect(getCountedLeaveDates('2026-07-24', '2026-07-27')).toEqual([
      '2026-07-24',
      '2026-07-27',
    ])
    expect(countLeaveAllowanceDays('2026-07-24', '2026-07-27')).toBe(2)
  })

  it('excludes employee-specific non-working weekdays', () => {
    expect(getCountedLeaveDates('2026-07-20', '2026-07-24', [2, 4])).toEqual([
      '2026-07-20',
      '2026-07-22',
      '2026-07-24',
    ])
  })

  it('normalizes unsafe weekday input', () => {
    expect(normalizeNonWorkingWeekdays([5, '2', 0, 7, 5, 'bad'])).toEqual([2, 5])
  })
})

describe('getHolidayYear', () => {
  // The Anchor's holiday year starts on 1 April.
  const APRIL = 4
  const FIRST = 1

  it('names the year by the calendar year the holiday year starts in', () => {
    expect(getHolidayYear('2026-04-01', APRIL, FIRST)).toBe(2026)
    expect(getHolidayYear('2026-12-31', APRIL, FIRST)).toBe(2026)
    expect(getHolidayYear('2027-03-31', APRIL, FIRST)).toBe(2026)
  })

  it('treats the first day of the holiday year as inside it, not the previous one', () => {
    // The boundary is where a locally-built Date slipped a day and answered 2025.
    expect(getHolidayYear('2026-04-01', APRIL, FIRST)).toBe(2026)
    expect(getHolidayYear('2026-03-31', APRIL, FIRST)).toBe(2025)
  })

  it('handles a holiday year that does not start on the first of a month', () => {
    expect(getHolidayYear('2026-09-05', 9, 6)).toBe(2025)
    expect(getHolidayYear('2026-09-06', 9, 6)).toBe(2026)
  })
})
