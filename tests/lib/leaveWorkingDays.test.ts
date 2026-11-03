import { describe, expect, it } from 'vitest'
import {
  countAllowanceDays,
  countRequestDays,
  formatHolidayDays,
  getHolidayEntitlement,
  getHolidayYear,
  getHolidayYearBounds,
  getLeaveDates,
  getUntakenHoliday,
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

describe('getHolidayEntitlement', () => {
  // The live holiday year starts on 1 January. 2026 has 365 days.
  const year2026 = { holidayYear: 2026, startMonth: 1, startDay: 1, allowance: 25 }

  it('gives the whole allowance to someone employed all year', () => {
    const result = getHolidayEntitlement({ ...year2026, employmentStartDate: '2024-03-01', employmentEndDate: null })
    expect(result).toEqual({
      entitlement: 25,
      fullAllowance: 25,
      proRated: false,
      employedFrom: '2026-01-01',
      employedTo: '2026-12-31',
    })
  })

  it('scales the allowance for a starter by the days left in the year', () => {
    // 1 October to 31 December is 92 of 365 days: 25 x 92 / 365 = 6.30
    const result = getHolidayEntitlement({ ...year2026, employmentStartDate: '2026-10-01' })
    expect(result.entitlement).toBe(6.3)
    expect(result.proRated).toBe(true)
    expect(result.employedFrom).toBe('2026-10-01')
  })

  it('scales the allowance for a leaver up to and including their last working day', () => {
    // 1 January to 28 October is 301 of 365 days: 25 x 301 / 365 = 20.62
    const result = getHolidayEntitlement({ ...year2026, employmentStartDate: '2025-05-01', employmentEndDate: '2026-10-28' })
    expect(result.entitlement).toBe(20.6)
    expect(result.employedTo).toBe('2026-10-28')
  })

  it('scales for someone who starts and leaves in the same year', () => {
    // 1 March to 31 August is 184 days: 25 x 184 / 365 = 12.60
    const result = getHolidayEntitlement({ ...year2026, employmentStartDate: '2026-03-01', employmentEndDate: '2026-08-31' })
    expect(result.entitlement).toBe(12.6)
  })

  it('gives nothing for a year they were not employed in', () => {
    const result = getHolidayEntitlement({ ...year2026, employmentStartDate: '2027-02-01' })
    expect(result).toMatchObject({ entitlement: 0, employedFrom: null, employedTo: null })
  })

  it('uses a holiday year that does not start on 1 January', () => {
    // A year starting 6 April 2026 ends 5 April 2027 (365 days); leaving 5 October 2026 is 183 days.
    const result = getHolidayEntitlement({
      allowance: 28,
      holidayYear: 2026,
      startMonth: 4,
      startDay: 6,
      employmentEndDate: '2026-10-05',
    })
    expect(result.entitlement).toBe(14)
  })

  it('treats a negative allowance as none', () => {
    expect(getHolidayEntitlement({ ...year2026, allowance: -3 }).entitlement).toBe(0)
  })
})

describe('getUntakenHoliday', () => {
  it('is the entitlement less the days taken', () => {
    expect(getUntakenHoliday(20.6, 12)).toBe(8.6)
  })

  it('is negative when they took more than they had earned', () => {
    expect(getUntakenHoliday(6.3, 8)).toBe(-1.7)
  })
})

describe('formatHolidayDays', () => {
  it('says day for exactly one and days otherwise', () => {
    expect(formatHolidayDays(1)).toBe('1 day')
    expect(formatHolidayDays(0.5)).toBe('0.5 days')
    expect(formatHolidayDays(14.44)).toBe('14.4 days')
    expect(formatHolidayDays(0)).toBe('0 days')
  })
})
