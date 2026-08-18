import { describe, it, expect } from 'vitest'
import { addDaysIso, daysUntil, URGENT_UNFILLED_HORIZON_DAYS } from '@/lib/rota/unfilled-shifts'

describe('unfilled shift date maths', () => {
  it('counts zero days for a shift today', () => {
    expect(daysUntil('2026-08-18', '2026-08-18')).toBe(0)
  })

  it('counts one day for tomorrow', () => {
    expect(daysUntil('2026-08-18', '2026-08-19')).toBe(1)
  })

  it('counts the real gap for the live Sunday case', () => {
    // The Sunday Kitchen shift that went open on 18 August was five days out.
    // The weekly alert would not have mentioned it until 18:00 on the day.
    expect(daysUntil('2026-08-18', '2026-08-23')).toBe(5)
    expect(daysUntil('2026-08-18', '2026-08-23')).toBeLessThanOrEqual(URGENT_UNFILLED_HORIZON_DAYS)
  })

  it('survives the spring clock change, when a day is 23 hours long', () => {
    // 29 March 2026 is the British Summer Time changeover. Doing this in local
    // time would round to zero and drop a day.
    expect(daysUntil('2026-03-28', '2026-03-30')).toBe(2)
    expect(addDaysIso('2026-03-28', 2)).toBe('2026-03-30')
  })

  it('survives the autumn clock change, when a day is 25 hours long', () => {
    expect(daysUntil('2026-10-24', '2026-10-26')).toBe(2)
    expect(addDaysIso('2026-10-24', 2)).toBe('2026-10-26')
  })

  it('walks across a month boundary', () => {
    expect(addDaysIso('2026-08-28', 7)).toBe('2026-09-04')
    expect(daysUntil('2026-08-28', '2026-09-04')).toBe(7)
  })

  it('keeps the urgent horizon at one week', () => {
    // The weekly alert covers 56 days. This one must stay short, or the daily
    // email repeats the weekly one and gets ignored.
    expect(URGENT_UNFILLED_HORIZON_DAYS).toBe(7)
  })
})
