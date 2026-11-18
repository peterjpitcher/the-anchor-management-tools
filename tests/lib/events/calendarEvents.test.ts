import { describe, expect, it } from 'vitest'
import {
  calendarParkingStartFrom,
  defaultCalendarEventsWindow,
  resolveCalendarEventsWindow,
} from '@/lib/events/calendar-events'

describe('events calendar window', () => {
  it('runs from the first of the month twelve months back to the last day twelve months ahead', () => {
    expect(defaultCalendarEventsWindow('2026-11-18')).toEqual({ dateFrom: '2025-11-01', dateTo: '2027-11-30' })
  })

  it('handles the turn of a year and a short month', () => {
    expect(defaultCalendarEventsWindow('2027-01-31')).toEqual({ dateFrom: '2026-01-01', dateTo: '2028-01-31' })
    expect(defaultCalendarEventsWindow('2027-02-28')).toEqual({ dateFrom: '2026-02-01', dateTo: '2028-02-29' })
  })

  it('keeps a valid caller window and replaces a malformed one', () => {
    expect(resolveCalendarEventsWindow({ dateFrom: '2026-05-01', dateTo: '2026-05-31' }, '2026-11-18')).toEqual({
      dateFrom: '2026-05-01',
      dateTo: '2026-05-31',
    })
    expect(resolveCalendarEventsWindow({ dateFrom: 'nope', dateTo: '2026-02-30' }, '2026-11-18')).toEqual({
      dateFrom: '2025-11-01',
      dateTo: '2027-11-30',
    })
  })
})

describe('events calendar parking start', () => {
  it('is midnight London time on the first day of last month (GMT)', () => {
    expect(calendarParkingStartFrom('2026-12-15')).toBe('2026-11-01T00:00:00.000Z')
  })

  it('is 23:00 UTC the evening before when that first day is in summer time', () => {
    expect(calendarParkingStartFrom('2026-08-15')).toBe('2026-06-30T23:00:00.000Z')
  })

  it('crosses a year boundary', () => {
    expect(calendarParkingStartFrom('2027-01-10')).toBe('2026-12-01T00:00:00.000Z')
  })
})
