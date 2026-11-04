import { describe, expect, it } from 'vitest'
import {
  countAllowanceDays,
  countRequestDays,
  getHolidayYear,
  getHolidayYearBounds,
  getLeaveDates,
  isCountedLeaveDay,
} from '@/lib/leave/working-days'

const holiday = (leave_date: string) => ({ leave_date, consumes_allowance: true })
const unavailable = (leave_date: string) => ({ leave_date, consumes_allowance: false })

describe('countAllowanceDays', () => {
  it('counts weekends, because a pub trades at the weekend', () => {
    // 25 and 26 July 2026 are a Saturday and a Sunday. Under the old rule these were free.
    const days = getLeaveDates('2026-07-24', '2026-07-27').map(holiday)
    expect(countAllowanceDays(days)).toBe(4)
  })

  it('counts every calendar day of a range', () => {
    expect(countAllowanceDays(getLeaveDates('2026-07-20', '2026-07-24').map(holiday))).toBe(5)
  })

  it('ignores days whose leave type does not consume allowance', () => {
    const days = [
      ...getLeaveDates('2026-07-20', '2026-07-24').map(holiday),
      ...getLeaveDates('2026-08-01', '2026-08-31').map(unavailable),
    ]
    expect(countAllowanceDays(days)).toBe(5)
  })

  it('treats a missing leave type as allowance consuming, matching the column default', () => {
    expect(isCountedLeaveDay({ leave_date: '2026-07-20' })).toBe(true)
    expect(isCountedLeaveDay({ leave_date: '2026-07-20', consumes_allowance: null })).toBe(true)
    expect(isCountedLeaveDay({ leave_date: '2026-07-20', consumes_allowance: false })).toBe(false)
  })

  it('returns zero for no rows', () => {
    expect(countAllowanceDays([])).toBe(0)
  })
})

describe('countRequestDays', () => {
  it('measures the length of a booking inclusive of both ends', () => {
    expect(countRequestDays('2026-07-24', '2026-07-27')).toBe(4)
    expect(countRequestDays('2026-07-24', '2026-07-24')).toBe(1)
  })
})

describe('getHolidayYear', () => {
  it('names the year by the calendar year the holiday year starts in', () => {
    expect(getHolidayYear('2026-04-06', 4, 6)).toBe(2026)
    expect(getHolidayYear('2026-04-05', 4, 6)).toBe(2025)
    expect(getHolidayYear('2026-12-31', 4, 6)).toBe(2026)
  })

  it('handles a January holiday year, which is what is configured in production', () => {
    expect(getHolidayYear('2026-01-01', 1, 1)).toBe(2026)
    expect(getHolidayYear('2025-12-31', 1, 1)).toBe(2025)
  })
})

describe('getHolidayYearBounds', () => {
  it('returns the inclusive bounds of a January holiday year', () => {
    expect(getHolidayYearBounds(2026, 1, 1)).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    })
  })

  it('returns the inclusive bounds of an April holiday year', () => {
    expect(getHolidayYearBounds(2026, 4, 6)).toEqual({
      startDate: '2026-04-06',
      endDate: '2027-04-05',
    })
  })
})

describe('a request that spans the holiday year boundary', () => {
  // The bug this replaces: leave_requests.holiday_year is derived from the start date, so a
  // 28 December to 3 January request was charged wholly to the year it began in. Counting
  // dated rows charges each day to the year it actually falls in.
  const days = getLeaveDates('2026-12-28', '2027-01-03').map(holiday)

  it('splits across both years', () => {
    const firstYear = getHolidayYearBounds(2026, 1, 1)
    const secondYear = getHolidayYearBounds(2027, 1, 1)

    const inFirst = days.filter(d => d.leave_date >= firstYear.startDate && d.leave_date <= firstYear.endDate)
    const inSecond = days.filter(d => d.leave_date >= secondYear.startDate && d.leave_date <= secondYear.endDate)

    expect(countAllowanceDays(inFirst)).toBe(4)
    expect(countAllowanceDays(inSecond)).toBe(3)
    expect(countAllowanceDays(days)).toBe(7)
  })
})
