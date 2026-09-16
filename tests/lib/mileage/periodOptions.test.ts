import { describe, expect, it } from 'vitest'
import { financialYearOptions, quarterOptions, taxYearOptions } from '@/lib/mileage/period-options'

describe('period options', () => {
  it('lists the quarters that overlap the dates, newest first', () => {
    expect(quarterOptions('2025-11-20', '2026-04-02').map((option) => option.value)).toEqual(['2026-Q2', '2026-Q1', '2025-Q4'])
    expect(quarterOptions('2026-04-01', '2026-06-30')[0].label).toBe('Q2 2026: 1 April to 30 June 2026')
  })

  it('lists financial years, newest first', () => {
    expect(financialYearOptions('2024-01-01', '2026-09-15').map((option) => option.value)).toEqual(['FY2026', 'FY2025', 'FY2024'])
  })

  it('puts 5 April in the tax year that started the year before', () => {
    expect(taxYearOptions('2024-01-01', '2026-04-05').map((option) => option.value)).toEqual(['TY2025-26', 'TY2024-25', 'TY2023-24'])
    expect(taxYearOptions('2026-04-06', '2026-04-06').map((option) => option.period.from)).toEqual(['2026-04-06'])
  })

  it('returns no quarters for an empty range', () => {
    expect(quarterOptions('2026-07-01', '2026-06-30')).toEqual([])
  })
})
