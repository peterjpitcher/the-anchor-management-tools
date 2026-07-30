import { describe, it, expect } from 'vitest'
import { ageBucket, completedLondonDaysSince, humaniseAge } from '../age'

describe('completedLondonDaysSince', () => {
  it('returns 0 on the day of issue', () => {
    expect(
      completedLondonDaysSince('2026-01-05T09:00:00.000Z', new Date('2026-01-05T22:00:00.000Z'))
    ).toBe(0)
  })

  it('counts completed London calendar days, not 24-hour periods', () => {
    // Issued 23:00 London, checked 01:00 London the next day: 1 completed day
    expect(
      completedLondonDaysSince('2026-01-05T23:00:00.000Z', new Date('2026-01-06T01:00:00.000Z'))
    ).toBe(1)
  })

  it('uses the London date of the issue instant, not the UTC date', () => {
    // 23:30 UTC in July is 00:30 BST the NEXT London day
    expect(
      completedLondonDaysSince('2026-07-01T23:30:00.000Z', new Date('2026-07-02T12:00:00.000Z'))
    ).toBe(0)
  })

  it.each([
    ['2026-02-04T12:00:00.000Z', 30],
    ['2026-02-05T12:00:00.000Z', 31],
    ['2026-04-05T12:00:00.000Z', 90],
    ['2026-04-06T12:00:00.000Z', 91],
    ['2026-07-04T12:00:00.000Z', 180],
    ['2026-07-05T12:00:00.000Z', 181],
  ])('issued 2026-01-05, now %s is %i completed days', (now, expected) => {
    expect(completedLondonDaysSince('2026-01-05T12:00:00.000Z', new Date(now))).toBe(expected)
  })

  it('is exact across the BST to GMT change (clocks back 2026-10-25)', () => {
    // Issued 2026-10-20 (BST), checked 2026-10-27 (GMT): 7 London days even
    // though only 6 days 23 hours of wall-clock UTC difference tricks exist
    expect(
      completedLondonDaysSince('2026-10-20T18:00:00.000Z', new Date('2026-10-27T18:00:00.000Z'))
    ).toBe(7)
    // Issued 23:30 UTC on 2026-10-20 is 00:30 BST on 2026-10-21 in London
    expect(
      completedLondonDaysSince('2026-10-20T23:30:00.000Z', new Date('2026-10-27T00:30:00.000Z'))
    ).toBe(6)
  })

  it('is exact across the GMT to BST change (clocks forward 2026-03-29)', () => {
    expect(
      completedLondonDaysSince('2026-03-25T12:00:00.000Z', new Date('2026-04-01T12:00:00.000Z'))
    ).toBe(7)
    // 23:30 UTC on 2026-03-31 is 00:30 BST on 2026-04-01 in London: same London day as now
    expect(
      completedLondonDaysSince('2026-03-31T23:30:00.000Z', new Date('2026-04-01T10:00:00.000Z'))
    ).toBe(0)
  })
})

describe('ageBucket boundaries (F39, mutually exclusive)', () => {
  it.each([
    [0, '0-30'],
    [30, '0-30'],
    [31, '31-90'],
    [90, '31-90'],
    [91, '91-180'],
    [180, '91-180'],
    [181, '181+'],
    [400, '181+'],
  ])('%i days is bucket %s', (days, expected) => {
    expect(ageBucket(days)).toBe(expected)
  })
})

describe('humaniseAge', () => {
  it.each([
    [0, '0 days'],
    [1, '1 day'],
    [3, '3 days'],
    [13, '13 days'],
    [14, '2 weeks'],
    [42, '6 weeks'],
    [60, '9 weeks'],
    [61, '2 months'],
    [120, '4 months'],
    [200, '7 months'],
    [365, '12 months'],
  ])('%i days reads as %s', (days, expected) => {
    expect(humaniseAge(days)).toBe(expected)
  })

  it('never goes negative', () => {
    expect(humaniseAge(-2)).toBe('0 days')
  })
})
