import { describe, expect, it } from 'vitest'
import { getFinalRecurringCoverage } from '../recurring-proration'

const october = { period_start: '2026-10-01', period_end: '2026-10-31', period_yyyymm: '2026-10' }

describe('getFinalRecurringCoverage', () => {
  it('includes the final service day and rounds ex VAT to pennies', () => {
    expect(getFinalRecurringCoverage('monthly', october, 100, '2026-10-15')).toEqual({
      start: '2026-10-01', end: '2026-10-15', amountExVat: 48.39,
      fullDays: 31, billableDays: 15, isProrated: true,
    })
    expect(getFinalRecurringCoverage('monthly', october, 31, '2026-10-01')?.amountExVat).toBe(1)
  })

  it('retains a full charge with no end date, at period end or beyond coverage', () => {
    for (const end of [undefined, null, '2026-10-31', '2027-01-01']) {
      expect(getFinalRecurringCoverage('monthly', october, 100, end)).toMatchObject({
        end: '2026-10-31', amountExVat: 100, billableDays: 31, isProrated: false,
      })
    }
  })

  it('does not create a charge for service after the end date', () => {
    expect(getFinalRecurringCoverage('monthly', october, 100, '2026-09-30')).toBeNull()
  })

  it('uses the whole quarterly coverage as the denominator', () => {
    expect(getFinalRecurringCoverage('quarterly', october, 920, '2026-11-15')).toEqual({
      start: '2026-10-01', end: '2026-11-15', amountExVat: 460,
      fullDays: 92, billableDays: 46, isProrated: true,
    })
  })

  it('uses annual coverage across a leap year', () => {
    const january = { period_start: '2028-01-01', period_end: '2028-01-31', period_yyyymm: '2028-01' }
    expect(getFinalRecurringCoverage('annually', january, 366, '2028-02-29')).toMatchObject({
      fullDays: 366, billableDays: 60, amountExVat: 60,
    })
  })

  it('counts leap February and London clock changes as whole calendar days', () => {
    const february = { period_start: '2028-02-01', period_end: '2028-02-29', period_yyyymm: '2028-02' }
    expect(getFinalRecurringCoverage('monthly', february, 29, '2028-02-28')?.amountExVat).toBe(28)
    const march = { period_start: '2026-03-01', period_end: '2026-03-31', period_yyyymm: '2026-03' }
    expect(getFinalRecurringCoverage('monthly', march, 31, '2026-03-30')?.billableDays).toBe(30)
    expect(getFinalRecurringCoverage('monthly', october, 31, '2026-10-26')?.billableDays).toBe(26)
  })

  it('allows a zero charge', () => {
    expect(getFinalRecurringCoverage('monthly', october, 0, '2026-10-15')?.amountExVat).toBe(0)
  })

  it.each(['2026-02-30', '2026-13-01', '2026-00-01', '04/10/2026', '', '2026-10-04T12:00:00Z'])(
    'rejects invalid end date %s rather than rolling it over', (end) => {
      expect(() => getFinalRecurringCoverage('monthly', october, 100, end)).toThrow('Invalid recurring charge end date')
    },
  )

  it('rejects invalid billing dates and reversed ranges', () => {
    expect(() => getFinalRecurringCoverage('monthly', { ...october, period_start: '2026-02-30' }, 100)).toThrow()
    expect(() => getFinalRecurringCoverage('quarterly', { ...october, period_end: '2026-09-30' }, 100)).toThrow()
  })

  it.each([NaN, Infinity, -Infinity, -1])('rejects invalid amount %s', (amount) => {
    expect(() => getFinalRecurringCoverage('monthly', october, amount)).toThrow('finite non-negative')
  })
})
