import { describe, expect, it } from 'vitest'
import { resolveTextLandingDay, resolveTextLandingTime } from '@/lib/sms/landing-day'

describe('resolveTextLandingTime', () => {
  it('is now outside quiet hours', () => {
    const now = new Date('2026-09-15T13:00:00Z') // 14:00 BST
    expect(resolveTextLandingTime(now).toISOString()).toBe('2026-09-15T13:00:00.000Z')
  })

  it.each([
    // Sent, lands (09:00 London the next allowed morning).
    ['2026-09-15T21:00:00Z', '2026-09-16T08:00:00.000Z'], // 22:00 BST, lands 09:00 BST next day
    ['2026-09-16T01:00:00Z', '2026-09-16T08:00:00.000Z'], // 02:00 BST, lands 09:00 BST same day
    ['2026-10-24T20:30:00Z', '2026-10-25T09:00:00.000Z'], // 21:30 BST, lands 09:00 GMT after the clocks go back
    ['2027-03-27T21:30:00Z', '2027-03-28T08:00:00.000Z'], // 21:30 GMT, lands 09:00 BST after the clocks go forward
  ])('holds a text sent at %s until %s', (sent, lands) => {
    expect(resolveTextLandingTime(new Date(sent)).toISOString()).toBe(lands)
  })
})

describe('resolveTextLandingDay', () => {
  it('is tomorrow when the text arrives the day before', () => {
    // 10:00 BST on Tuesday 15 September, for a 10:00 deadline on the Wednesday.
    expect(resolveTextLandingDay(new Date('2026-09-16T09:00:00Z'), new Date('2026-09-15T09:00:00Z'))).toBe('tomorrow')
  })

  it('is today when quiet hours hold it until the morning of the deadline', () => {
    // 22:00 BST on the Tuesday, for a 22:00 deadline on the Wednesday: it lands at 09:00 Wednesday.
    expect(resolveTextLandingDay(new Date('2026-09-16T21:00:00Z'), new Date('2026-09-15T21:00:00Z'))).toBe('today')
  })

  it('is tomorrow for a deadline in the small hours when the text lands at 09:00 the day before', () => {
    // 02:00 BST on the Tuesday, for a 02:00 deadline on the Wednesday: it lands at 09:00 Tuesday.
    expect(resolveTextLandingDay(new Date('2026-09-16T01:00:00Z'), new Date('2026-09-15T01:00:00Z'))).toBe('tomorrow')
  })

  it('is null when the text would only arrive at or after the moment', () => {
    // 02:00 BST on the Wednesday, for an 08:00 deadline that morning: it would land at 09:00.
    expect(resolveTextLandingDay(new Date('2026-09-16T07:00:00Z'), new Date('2026-09-16T01:00:00Z'))).toBeNull()
    expect(resolveTextLandingDay(new Date('2026-09-16T08:00:00Z'), new Date('2026-09-16T01:00:00Z'))).toBeNull()
  })

  it('is null two London days out, which neither word covers', () => {
    expect(resolveTextLandingDay(new Date('2026-09-17T09:00:00Z'), new Date('2026-09-15T09:00:00Z'))).toBeNull()
  })

  it('is null for a moment that cannot be read', () => {
    expect(resolveTextLandingDay(new Date('not a date'), new Date('2026-09-15T09:00:00Z'))).toBeNull()
  })
})
