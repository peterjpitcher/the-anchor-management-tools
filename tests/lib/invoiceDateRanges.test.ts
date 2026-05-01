import { describe, expect, it } from 'vitest'
import { getCurrentQuarterDateRange } from '@/lib/invoices/date-ranges'

describe('invoice date ranges', () => {
  it('returns the current quarter start and end dates', () => {
    expect(getCurrentQuarterDateRange(new Date('2026-05-01T12:00:00Z'))).toEqual({
      startDate: '2026-04-01',
      endDate: '2026-06-30',
    })
  })
})
