import { describe, expect, it } from 'vitest'
import { addDays, computeWindows, daysBetween, londonDateOf, mondayOf, rangeInstants, weekdayOf } from '@/lib/insights/windows'

describe('insights windows', () => {
  it('builds the Friday 06:00 windows from London dates', () => {
    // Friday 25 September 2026, 06:00 BST = 05:00 UTC.
    const windows = computeWindows(new Date('2026-09-25T05:00:00Z'))
    expect(windows.today).toBe('2026-09-25')
    expect(windows.yesterday).toBe('2026-09-24')
    expect(windows.thisWeek).toEqual({ start: '2026-09-18', end: '2026-09-24', days: 7 })
    expect(windows.lastWeek).toEqual({ start: '2026-09-11', end: '2026-09-17', days: 7 })
    expect(windows.previous4Weeks).toEqual({ start: '2026-08-21', end: '2026-09-17', days: 28 })
    expect(windows.previous13Weeks).toEqual({ start: '2026-06-19', end: '2026-09-17', days: 91 })
    expect(windows.next7).toEqual({ start: '2026-09-25', end: '2026-10-01', days: 7 })
    expect(windows.next14).toEqual({ start: '2026-09-25', end: '2026-10-08', days: 14 })
    expect(windows.last28).toEqual({ start: '2026-08-28', end: '2026-09-24', days: 28 })
    expect(windows.last91).toEqual({ start: '2026-06-26', end: '2026-09-24', days: 91 })
  })

  it('uses the London date just after midnight BST, when UTC is still the previous day', () => {
    const windows = computeWindows(new Date('2026-09-24T23:30:00Z'))
    expect(windows.today).toBe('2026-09-25')
  })

  it('keeps a week containing the October clock change at seven whole days', () => {
    // Clocks go back on Sunday 25 October 2026.
    const windows = computeWindows(new Date('2026-10-30T06:00:00Z'))
    expect(windows.thisWeek).toEqual({ start: '2026-10-23', end: '2026-10-29', days: 7 })
    const bounds = rangeInstants(windows.thisWeek)
    expect(bounds.from).toBe('2026-10-22T23:00:00.000Z')
    expect(bounds.toExclusive).toBe('2026-10-30T00:00:00.000Z')
  })

  it('keeps a week containing the March clock change at seven whole days', () => {
    // Clocks go forward on Sunday 28 March 2027.
    const windows = computeWindows(new Date('2027-04-02T05:00:00Z'))
    expect(windows.thisWeek).toEqual({ start: '2027-03-26', end: '2027-04-01', days: 7 })
    const bounds = rangeInstants(windows.thisWeek)
    expect(bounds.from).toBe('2027-03-26T00:00:00.000Z')
    expect(bounds.toExclusive).toBe('2027-04-01T23:00:00.000Z')
  })

  it('converts timestamps to London dates and counts calendar days', () => {
    expect(londonDateOf('2026-09-24T23:30:00Z')).toBe('2026-09-25')
    expect(londonDateOf('2026-12-24T23:30:00Z')).toBe('2026-12-24')
    expect(daysBetween('2026-09-25', '2026-10-01')).toBe(6)
    expect(daysBetween('2026-10-01', '2026-09-25')).toBe(-6)
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2)
    expect(addDays('2026-09-25', 7)).toBe('2026-10-02')
    expect(weekdayOf('2026-09-25')).toBe(5)
    expect(mondayOf('2026-09-27')).toBe('2026-09-21')
  })

  it('rejects an invalid instant', () => {
    expect(() => computeWindows(new Date('nope'))).toThrow('Report time is invalid')
  })
})
