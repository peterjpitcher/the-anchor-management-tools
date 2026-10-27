import { describe, expect, it } from 'vitest'
import { resolveOnlineIncomeRange } from './online-income-range'

describe('online income date range', () => {
  it('opens on this month so far', () => {
    expect(resolveOnlineIncomeRange(null, null, '2026-10-26')).toEqual({ from: '2026-10-01', to: '2026-10-26', adjusted: false })
  })

  it('keeps real dates in order', () => {
    expect(resolveOnlineIncomeRange('2026-01-01', '2026-03-31', '2026-10-26')).toEqual({ from: '2026-01-01', to: '2026-03-31', adjusted: false })
  })

  it('falls back to this month for dates it cannot use', () => {
    const fallback = { from: '2026-10-01', to: '2026-10-26', adjusted: true }
    expect(resolveOnlineIncomeRange('2026-03-31', '2026-01-01', '2026-10-26')).toEqual(fallback)
    expect(resolveOnlineIncomeRange('2026-02-30', '2026-03-01', '2026-10-26')).toEqual(fallback)
    expect(resolveOnlineIncomeRange('2024-01-01', '2026-01-01', '2026-10-26')).toEqual(fallback)
    expect(resolveOnlineIncomeRange('2026-01-01', null, '2026-10-26')).toEqual(fallback)
  })
})
