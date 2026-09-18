import { describe, expect, it } from 'vitest'
import { compare, describeChange, hasMinimumHistory, trend, weeklyAverage } from '@/lib/insights/compare'
import { clip, formatDateWithYear, formatDayDate, formatMoney, formatPercent, joinWithAnd, formatWeekday, plural } from '@/lib/insights/format'

describe('insights comparisons', () => {
  it('calls out a change only when both the percentage and the floor are met', () => {
    expect(compare(24, 18, 5)).toMatchObject({ kind: 'up', notable: true })
    expect(compare(2, 1, 5)).toMatchObject({ kind: 'steady', notable: false })
    expect(compare(10, 12, 5)).toMatchObject({ kind: 'steady' })
    expect(compare(10, 20, 5)).toMatchObject({ kind: 'down', notable: true, change: -0.5, diff: -10 })
  })

  it('never divides by zero', () => {
    expect(compare(0, 0, 5)).toMatchObject({ kind: 'none', change: null })
    expect(compare(6, 0, 5)).toMatchObject({ kind: 'new', change: null, notable: true })
    expect(compare(2, 0, 5)).toMatchObject({ kind: 'new', notable: false })
    expect(compare(5, null, 5)).toMatchObject({ kind: 'no_history', notable: false })
    expect(() => compare(Number.NaN, 1, 1)).toThrow()
  })

  it('judges the trend on 4-week against 13-week weekly averages', () => {
    expect(trend(71, 58, 15)).toBe('steady') // 22% but only 13 covers a week apart
    expect(trend(80, 58, 15)).toBe('growing')
    expect(trend(40, 58, 15)).toBe('declining')
    expect(trend(null, 58, 15)).toBe('no_history')
  })

  it('works out weekly averages from the window length', () => {
    expect(weeklyAverage(56, { start: '2026-08-21', end: '2026-09-17', days: 28 })).toBe(14)
  })

  it('checks minimum history against the collection start', () => {
    expect(hasMinimumHistory('2026-08-16', '2026-06-19')).toBe(false)
    expect(hasMinimumHistory('2026-08-16', '2026-08-21')).toBe(true)
    expect(hasMinimumHistory(null, '2026-08-21')).toBe(false)
  })

  it('describes comparisons in plain words', () => {
    expect(describeChange(compare(22, 20, 1), 'the 4-week average')).toBe('in line with the 4-week average')
    expect(describeChange(compare(24, 20, 1), 'the 4-week average')).toBe('up 20% on the 4-week average')
    expect(describeChange(compare(30, 20, 1), 'the 4-week average')).toBe('up 50% on the 4-week average')
    expect(describeChange(compare(10, 20, 1), 'last week')).toBe('down 50% on last week')
    expect(describeChange(compare(3, null, 1), 'the 13-week average')).toBe('not enough history yet for the 13-week average')
  })
})

describe('insights formatting', () => {
  it('formats money, percentages, dates and plurals', () => {
    expect(formatMoney(1234.5)).toBe('£1,235')
    expect(formatMoney(1234.5, { pence: true })).toBe('£1,234.50')
    expect(() => formatMoney(Number.NaN)).toThrow()
    expect(formatPercent(0.183)).toBe('18%')
    expect(formatDayDate('2026-09-24')).toBe('Thu 24 Sep')
    expect(formatDateWithYear('2026-09-24')).toBe('24 Sep 2026')
    expect(formatWeekday('2026-09-27')).toBe('Sunday')
    expect(plural(1, 'booking')).toBe('1 booking')
    expect(plural(3, 'party', 'parties')).toBe('3 parties')
    expect(joinWithAnd(['Tue', 'Wed', 'Thu'])).toBe('Tue, Wed and Thu')
  })

  it('clips long text on a word boundary', () => {
    expect(clip('The food was cold and the wait was very long indeed', 30)).toBe('The food was cold and the...')
    expect(clip('Short', 30)).toBe('Short')
  })
})
