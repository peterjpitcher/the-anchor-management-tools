import { describe, expect, it } from 'vitest'

import { hasPayrollVariance, validatePayrollPeriodRange } from './payroll-guards'

describe('hasPayrollVariance', () => {
  it('flags past planned shifts with no clocked time as variance', () => {
    expect(hasPayrollVariance(6, null, '2026-06-23', '2026-06-24')).toBe(true)
  })

  it('does not flag today or future planned shifts with no clocked time', () => {
    expect(hasPayrollVariance(6, null, '2026-06-24', '2026-06-24')).toBe(false)
    expect(hasPayrollVariance(6, null, '2026-06-25', '2026-06-24')).toBe(false)
  })

  it('uses the half-hour tolerance when actual time exists', () => {
    expect(hasPayrollVariance(6, 5.5, '2026-06-23', '2026-06-24')).toBe(false)
    expect(hasPayrollVariance(6, 5.49, '2026-06-23', '2026-06-24')).toBe(true)
  })
})

describe('validatePayrollPeriodRange', () => {
  it('rejects invalid date values', () => {
    expect(validatePayrollPeriodRange('2026-6-01', '2026-06-30')).toBe('Payroll period dates must be valid YYYY-MM-DD dates')
  })

  it('rejects an end date before the start date', () => {
    expect(validatePayrollPeriodRange('2026-06-30', '2026-06-01')).toBe('Payroll period end date must be on or after the start date')
  })

  it('allows a same-day or forward period', () => {
    expect(validatePayrollPeriodRange('2026-06-01', '2026-06-01')).toBeNull()
    expect(validatePayrollPeriodRange('2026-06-01', '2026-06-30')).toBeNull()
  })
})
