import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORK_HISTORY_DAYS,
  buildWorkHistorySeries,
  getWorkHistoryDateRange,
  getWorkHistoryRange,
  parseWorkHistoryDays,
} from '../date-ranges'

describe('parseWorkHistoryDays', () => {
  it('accepts the offered windows, as numbers or query strings', () => {
    expect(parseWorkHistoryDays(30)).toBe(30)
    expect(parseWorkHistoryDays('90')).toBe(90)
    expect(parseWorkHistoryDays('365')).toBe(365)
  })

  it('falls back to the default for anything else', () => {
    expect(parseWorkHistoryDays(undefined)).toBe(DEFAULT_WORK_HISTORY_DAYS)
    expect(parseWorkHistoryDays('all')).toBe(DEFAULT_WORK_HISTORY_DAYS)
    expect(parseWorkHistoryDays('7')).toBe(DEFAULT_WORK_HISTORY_DAYS)
    expect(parseWorkHistoryDays(-30)).toBe(DEFAULT_WORK_HISTORY_DAYS)
  })
})

describe('getWorkHistoryRange', () => {
  it('pairs each window with its bucket size', () => {
    expect(getWorkHistoryRange(30).granularity).toBe('day')
    expect(getWorkHistoryRange(90).granularity).toBe('week')
    expect(getWorkHistoryRange(365).granularity).toBe('month')
  })
})

describe('getWorkHistoryDateRange', () => {
  it('ends today and counts today as one of the days', () => {
    expect(getWorkHistoryDateRange(30, '2026-08-09')).toEqual({
      startDate: '2026-07-11',
      endDate: '2026-08-09',
    })
  })

  it('crosses a year boundary without drifting', () => {
    expect(getWorkHistoryDateRange(365, '2026-08-09')).toEqual({
      startDate: '2025-08-10',
      endDate: '2026-08-09',
    })
  })

  it('crosses the spring DST change without losing a day', () => {
    // 29 March 2026 is when London clocks go forward.
    expect(getWorkHistoryDateRange(30, '2026-04-05')).toEqual({
      startDate: '2026-03-07',
      endDate: '2026-04-05',
    })
  })
})

describe('buildWorkHistorySeries', () => {
  it('gives one bar per day and keeps the quiet days visible', () => {
    const series = buildWorkHistorySeries(
      [
        { date: '2026-08-03', hours: 1.5 },
        { date: '2026-08-03', hours: 2 },
        { date: '2026-08-05', hours: 0.25 },
      ],
      { startDate: '2026-08-03', endDate: '2026-08-05', granularity: 'day' },
    )

    expect(series).toEqual([
      { day: '3 Aug', amount: 3.5 },
      { day: '4 Aug', amount: 0 },
      { day: '5 Aug', amount: 0.25 },
    ])
  })

  it('totals weeks from Monday and labels them week commencing', () => {
    const series = buildWorkHistorySeries(
      [
        { date: '2026-07-28', hours: 2 }, // Tuesday, week commencing 27 July
        { date: '2026-08-02', hours: 1 }, // Sunday, same week
        { date: '2026-08-03', hours: 4 }, // Monday, next week
      ],
      { startDate: '2026-07-27', endDate: '2026-08-09', granularity: 'week' },
    )

    expect(series).toEqual([
      { day: 'w/c 27 Jul', amount: 3 },
      { day: 'w/c 3 Aug', amount: 4 },
    ])
  })

  it('totals calendar months across a year boundary', () => {
    const series = buildWorkHistorySeries(
      [
        { date: '2025-12-30', hours: 3 },
        { date: '2026-01-05', hours: 2 },
        { date: '2026-01-20', hours: 1 },
      ],
      { startDate: '2025-12-01', endDate: '2026-02-28', granularity: 'month' },
    )

    expect(series).toEqual([
      { day: 'Dec 25', amount: 3 },
      { day: 'Jan 26', amount: 3 },
      { day: 'Feb 26', amount: 0 },
    ])
  })

  it('ignores points outside the window and non-positive hours', () => {
    const series = buildWorkHistorySeries(
      [
        { date: '2026-08-01', hours: 5 }, // before the window
        { date: '2026-08-10', hours: 5 }, // after the window
        { date: '2026-08-04', hours: 0 },
        { date: '2026-08-04', hours: Number.NaN },
        { date: '2026-08-04', hours: 1.25 },
      ],
      { startDate: '2026-08-03', endDate: '2026-08-04', granularity: 'day' },
    )

    expect(series).toEqual([
      { day: '3 Aug', amount: 0 },
      { day: '4 Aug', amount: 1.25 },
    ])
  })

  it('returns nothing when the window is invalid', () => {
    expect(buildWorkHistorySeries([], { startDate: 'nonsense', endDate: '2026-08-04', granularity: 'day' })).toEqual([])
    expect(buildWorkHistorySeries([], { startDate: '2026-08-04', endDate: '2026-08-03', granularity: 'day' })).toEqual([])
  })
})
