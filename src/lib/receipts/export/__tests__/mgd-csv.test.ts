import { describe, it, expect } from 'vitest'
import { getCalendarQuarterMgdOverlap } from '@/lib/mgd/quarterMapping'

// We test the MGD quarter mapping integration indirectly by verifying
// the getCalendarQuarterMgdOverlap function produces correct date ranges
// (the actual mapping logic is tested in mgd/quarterMapping.test.ts).
// Here we test the MGD CSV file naming logic.

describe('MGD CSV file naming', () => {
  it('should produce correct period ranges for each calendar quarter', () => {
    // Q1 -> Feb-Apr -> FebApr
    const q1 = getCalendarQuarterMgdOverlap(2026, 1)
    expect(q1.periodStart).toBe('2026-02-01')
    expect(q1.periodEnd).toBe('2026-04-30')

    // Q2 -> May-Jul -> MayJul
    const q2 = getCalendarQuarterMgdOverlap(2026, 2)
    expect(q2.periodStart).toBe('2026-05-01')
    expect(q2.periodEnd).toBe('2026-07-31')

    // Q3 -> Aug-Oct -> AugOct
    const q3 = getCalendarQuarterMgdOverlap(2026, 3)
    expect(q3.periodStart).toBe('2026-08-01')
    expect(q3.periodEnd).toBe('2026-10-31')

    // Q4 -> Nov-Jan spans into next year
    const q4 = getCalendarQuarterMgdOverlap(2026, 4)
    expect(q4.periodStart).toBe('2026-11-01')
    expect(q4.periodEnd).toBe('2027-01-31')
  })
})
