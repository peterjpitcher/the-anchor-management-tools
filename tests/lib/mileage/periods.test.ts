import { describe, expect, it } from 'vitest'
import {
  customPeriod,
  daysBetween,
  describePeriod,
  financialYearPeriod,
  formatLongDate,
  lastCompletedQuarter,
  quarterPeriod,
  taxYearPeriod,
} from '@/lib/mileage/periods'

describe('report periods', () => {
  it('describes a quarter of the financial year', () => {
    expect(quarterPeriod(2026, 3)).toEqual({
      kind: 'quarter',
      from: '2026-07-01',
      to: '2026-09-30',
      label: 'Q3 2026: 1 July to 30 September 2026',
      fileLabel: '2026-Q3',
    })
  })

  it('describes the financial year as January to December', () => {
    expect(financialYearPeriod(2026)).toEqual({
      kind: 'financial_year',
      from: '2026-01-01',
      to: '2026-12-31',
      label: 'Financial year 2026: 1 January to 31 December 2026',
      fileLabel: 'FY2026',
    })
  })

  it('describes a tax year from 6 April', () => {
    expect(taxYearPeriod(2026)).toEqual({
      kind: 'tax_year',
      from: '2026-04-06',
      to: '2027-04-05',
      label: 'Tax year 2026/27: 6 April 2026 to 5 April 2027',
      fileLabel: 'TY2026-27',
    })
    expect(taxYearPeriod(2099).fileLabel).toBe('TY2099-00')
  })

  it('recognises each named period from its dates and treats the rest as custom', () => {
    expect(describePeriod('2026-04-01', '2026-06-30').kind).toBe('quarter')
    expect(describePeriod('2025-01-01', '2025-12-31').kind).toBe('financial_year')
    expect(describePeriod('2025-04-06', '2026-04-05').kind).toBe('tax_year')
    expect(describePeriod('2024-01-01', '2026-09-30')).toEqual(customPeriod('2024-01-01', '2026-09-30'))
    expect(customPeriod('2024-01-01', '2026-09-30')).toMatchObject({
      label: '1 January 2024 to 30 September 2026',
      fileLabel: '2024-01-01_to_2026-09-30',
    })
  })

  it('finds the last completed quarter from a London date', () => {
    expect(lastCompletedQuarter('2026-10-01').fileLabel).toBe('2026-Q3')
    expect(lastCompletedQuarter('2026-09-30').fileLabel).toBe('2026-Q2')
    expect(lastCompletedQuarter('2026-01-15').fileLabel).toBe('2025-Q4')
  })

  it('formats dates without a weekday or a timezone', () => {
    expect(formatLongDate('2026-04-05')).toBe('5 April 2026')
  })

  it('counts days across leap years and clock changes', () => {
    expect(daysBetween('2024-01-01', '2026-09-30')).toBe(1003)
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
    expect(daysBetween('2026-09-30', '2026-09-30')).toBe(0)
  })
})
