import { describe, expect, it, vi, afterEach } from 'vitest'
import { calendarMonthWindow, isCalendarMonth } from '@/lib/calendar/month-window'

afterEach(() => {
  vi.useRealTimers()
})

describe('calendarMonthWindow', () => {
  it('pads a month out to whole Monday-to-Sunday weeks', () => {
    // 1 November 2026 is a Sunday and 30 November a Monday.
    const window = calendarMonthWindow('2026-11')
    expect(window).toMatchObject({ month: '2026-11', startIso: '2026-10-26', endIso: '2026-12-06' })
  })

  it('needs no padding when the month starts on a Monday and ends on a Sunday', () => {
    // February 2027 starts on Monday 1 and ends on Sunday 28.
    expect(calendarMonthWindow('2027-02')).toMatchObject({ startIso: '2027-02-01', endIso: '2027-02-28' })
  })

  it('uses London midnight for the instants, across the clocks going back', () => {
    // October 2026: the window runs from Monday 28 September (BST) to Sunday 1 November (GMT).
    const window = calendarMonthWindow('2026-10')
    expect(window?.startIso).toBe('2026-09-28')
    expect(window?.startInstant).toBe('2026-09-27T23:00:00.000Z')
    expect(window?.endIso).toBe('2026-11-01')
    expect(window?.endInstant).toBe('2026-11-02T00:00:00.000Z')
  })

  it('refuses a malformed month or one outside the range the calendar pages to', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-27T12:00:00Z'))
    expect(calendarMonthWindow('2026-13')).toBeNull()
    expect(calendarMonthWindow('2026-1')).toBeNull()
    expect(calendarMonthWindow('2023-12')).toBeNull()
    expect(calendarMonthWindow('2029-01')).toBeNull()
    expect(isCalendarMonth('2028-12')).toBe(true)
    expect(isCalendarMonth('2024-01')).toBe(true)
  })
})
