import { describe, expect, it } from 'vitest'
import { formatHoldUntilLondon } from '@/lib/events/event-when'

/** When a payment hold ends, on the London clock (BK-100). Runs under London and UTC. */
describe('formatHoldUntilLondon', () => {
  it('gives the time alone when the hold ends today in London (summer time)', () => {
    expect(formatHoldUntilLondon('2026-07-03T18:42:00Z', new Date('2026-07-03T18:27:00Z'))).toBe('7:42pm')
  })

  it('gives the time alone in winter', () => {
    expect(formatHoldUntilLondon('2026-11-20T19:15:00Z', new Date('2026-11-20T19:00:00Z'))).toBe('7:15pm')
  })

  it('uses the London date, not UTC, just after midnight in summer', () => {
    // 00:20 BST on 4 July is still 3 July in UTC: the hold ends "today" in London.
    expect(formatHoldUntilLondon('2026-07-03T23:35:00Z', new Date('2026-07-03T23:20:00Z'))).toBe('12:35am')
  })

  it('adds the day for a hold that ends on another day', () => {
    expect(formatHoldUntilLondon('2026-10-29T19:42:00Z', new Date('2026-10-28T19:42:00Z'))).toBe('Thu 29 Oct at 7:42pm')
  })

  it('returns null for a missing or broken value', () => {
    expect(formatHoldUntilLondon(null)).toBeNull()
    expect(formatHoldUntilLondon('not a date')).toBeNull()
  })
})
