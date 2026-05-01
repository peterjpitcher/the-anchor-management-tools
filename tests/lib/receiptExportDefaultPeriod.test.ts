import { describe, expect, it } from 'vitest'
import { getLastCompletedQuarter } from '@/lib/receipts/export/default-period'

describe('getLastCompletedQuarter', () => {
  it('uses the previous year Q4 during Q1', () => {
    expect(getLastCompletedQuarter(new Date('2026-01-01T12:00:00Z'))).toEqual({
      year: 2025,
      quarter: 4,
    })
  })

  it('uses Q1 while the current date is in Q2', () => {
    expect(getLastCompletedQuarter(new Date('2026-05-01T12:00:00Z'))).toEqual({
      year: 2026,
      quarter: 1,
    })
  })

  it('uses Q2 while the current date is in Q3', () => {
    expect(getLastCompletedQuarter(new Date('2026-07-15T12:00:00Z'))).toEqual({
      year: 2026,
      quarter: 2,
    })
  })

  it('uses Q3 while the current date is in Q4', () => {
    expect(getLastCompletedQuarter(new Date('2026-12-31T12:00:00Z'))).toEqual({
      year: 2026,
      quarter: 3,
    })
  })
})
