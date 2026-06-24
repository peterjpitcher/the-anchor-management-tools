import { describe, expect, it } from 'vitest'
import {
  countLeaveAllowanceDays,
  getCountedLeaveDates,
  normalizeNonWorkingWeekdays,
} from '@/lib/leave/working-days'

describe('leave working day helpers', () => {
  it('excludes Saturdays and Sundays from allowance counts', () => {
    expect(getCountedLeaveDates('2026-07-24', '2026-07-27')).toEqual([
      '2026-07-24',
      '2026-07-27',
    ])
    expect(countLeaveAllowanceDays('2026-07-24', '2026-07-27')).toBe(2)
  })

  it('excludes employee-specific non-working weekdays', () => {
    expect(getCountedLeaveDates('2026-07-20', '2026-07-24', [2, 4])).toEqual([
      '2026-07-20',
      '2026-07-22',
      '2026-07-24',
    ])
  })

  it('normalizes unsafe weekday input', () => {
    expect(normalizeNonWorkingWeekdays([5, '2', 0, 7, 5, 'bad'])).toEqual([2, 5])
  })
})
