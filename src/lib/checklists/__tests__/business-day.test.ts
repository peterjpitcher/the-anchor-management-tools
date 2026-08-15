import { describe, expect, it } from 'vitest'
import { businessDateOf, msUntilNextBoundary } from '@/lib/checklists/business-day'

// Instants are written in UTC and annotated with the London wall clock they
// produce, because the whole point of these tests is the gap between the two.

describe('businessDateOf', () => {
  describe('ordinary BST day', () => {
    it('is still yesterday at 04:59 London', () => {
      // 2026-08-15 03:59Z = 04:59 BST
      expect(businessDateOf(new Date('2026-08-15T03:59:00Z'), 5)).toBe('2026-08-14')
    })

    it('flips exactly on the boundary', () => {
      // 2026-08-15 04:00Z = 05:00 BST
      expect(businessDateOf(new Date('2026-08-15T04:00:00Z'), 5)).toBe('2026-08-15')
    })

    it('is today at 05:01 London', () => {
      expect(businessDateOf(new Date('2026-08-15T04:01:00Z'), 5)).toBe('2026-08-15')
    })

    it('is today late in the evening', () => {
      // 2026-08-15 22:30Z = 23:30 BST
      expect(businessDateOf(new Date('2026-08-15T22:30:00Z'), 5)).toBe('2026-08-15')
    })

    it('is still yesterday just after midnight', () => {
      // 2026-08-16 00:30Z = 01:30 BST on the 16th
      expect(businessDateOf(new Date('2026-08-15T23:30:00Z'), 5)).toBe('2026-08-15')
    })
  })

  describe('ordinary GMT day', () => {
    it('is still yesterday at 04:59 London', () => {
      expect(businessDateOf(new Date('2026-01-15T04:59:00Z'), 5)).toBe('2026-01-14')
    })

    it('is today at 05:01 London', () => {
      expect(businessDateOf(new Date('2026-01-15T05:01:00Z'), 5)).toBe('2026-01-15')
    })
  })

  // These three are the reason this helper exists. Subtracting `startHour`
  // elapsed hours from the instant, which is what the code did before, gets all
  // three wrong.
  describe('clock-change mornings', () => {
    it('rolls over at 05:01 on spring-forward Sunday', () => {
      // Clocks go 01:00 GMT -> 02:00 BST on 2026-03-29.
      // 04:01Z = 05:01 BST. The subtract method returns 2026-03-28 here.
      expect(businessDateOf(new Date('2026-03-29T04:01:00Z'), 5)).toBe('2026-03-29')
    })

    it('has not rolled over at 04:59 on autumn-back Sunday', () => {
      // Clocks go 02:00 BST -> 01:00 GMT on 2026-10-25.
      // 04:59Z = 04:59 GMT. The subtract method returns 2026-10-25 here.
      expect(businessDateOf(new Date('2026-10-25T04:59:00Z'), 5)).toBe('2026-10-24')
    })

    it('rolls over at 05:01 on autumn-back Sunday', () => {
      expect(businessDateOf(new Date('2026-10-25T05:01:00Z'), 5)).toBe('2026-10-25')
    })

    it('treats the repeated hour as still yesterday', () => {
      // 01:30 occurs twice on 2026-10-25. Both are before the boundary.
      expect(businessDateOf(new Date('2026-10-25T00:30:00Z'), 5)).toBe('2026-10-24')
      expect(businessDateOf(new Date('2026-10-25T01:30:00Z'), 5)).toBe('2026-10-24')
    })
  })

  describe('other boundary hours', () => {
    it('honours a 6am boundary, the value before this change', () => {
      expect(businessDateOf(new Date('2026-08-15T04:30:00Z'), 6)).toBe('2026-08-14')
      expect(businessDateOf(new Date('2026-08-15T05:30:00Z'), 6)).toBe('2026-08-15')
    })

    it('honours a midnight boundary as a plain calendar date', () => {
      expect(businessDateOf(new Date('2026-08-15T00:30:00Z'), 0)).toBe('2026-08-15')
    })

    it('crosses a month boundary', () => {
      // 2026-09-01 03:00Z = 04:00 BST, before the boundary
      expect(businessDateOf(new Date('2026-09-01T03:00:00Z'), 5)).toBe('2026-08-31')
    })

    it('crosses a year boundary', () => {
      expect(businessDateOf(new Date('2027-01-01T04:00:00Z'), 5)).toBe('2026-12-31')
    })
  })
})

describe('msUntilNextBoundary', () => {
  it('counts to this morning when before the boundary', () => {
    // 03:00 BST, boundary 05:00 BST the same day, so two hours
    const ms = msUntilNextBoundary(new Date('2026-08-15T02:00:00Z'), 5)
    expect(ms).toBe(2 * 60 * 60 * 1000)
  })

  it('counts to tomorrow when after the boundary', () => {
    // 23:00 BST, boundary 05:00 BST next day, so six hours
    const ms = msUntilNextBoundary(new Date('2026-08-15T22:00:00Z'), 5)
    expect(ms).toBe(6 * 60 * 60 * 1000)
  })

  it('is never negative', () => {
    expect(msUntilNextBoundary(new Date('2026-08-15T04:00:00Z'), 5)).toBeGreaterThanOrEqual(0)
  })

  it('accounts for the short spring-forward night', () => {
    // 2026-03-28 23:00Z = 23:00 GMT. The next 05:00 London is 04:00Z on the 29th
    // because an hour is skipped, so five hours rather than six.
    const ms = msUntilNextBoundary(new Date('2026-03-28T23:00:00Z'), 5)
    expect(ms).toBe(5 * 60 * 60 * 1000)
  })

  it('accounts for the long autumn-back night', () => {
    // 2026-10-24 22:00Z = 23:00 BST. The next 05:00 London is 05:00Z on the 25th
    // because an hour repeats, so seven hours rather than six.
    const ms = msUntilNextBoundary(new Date('2026-10-24T22:00:00Z'), 5)
    expect(ms).toBe(7 * 60 * 60 * 1000)
  })
})
