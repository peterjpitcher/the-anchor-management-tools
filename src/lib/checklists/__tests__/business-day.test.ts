import { describe, expect, it } from 'vitest'
import {
  businessDateOf,
  hourLabel,
  londonClockLabel,
  msUntilNextBoundary,
  msUntilNextRefresh,
} from '@/lib/checklists/business-day'

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

// The staff screen renders a snapshot and has to know when that snapshot goes stale. It
// used to know only about the 05:00 boundary, so a tab last rendered before the closing
// window opened never showed the closing list at all.
describe('msUntilNextRefresh', () => {
  // 2026-08-28 19:13Z = 20:13 BST, the real instant of the last tick on the night the
  // whole closing checklist went missing. The closing window opened at 21:00 BST.
  const lastTick = new Date('2026-08-28T19:13:00Z')

  it('waits for the task window when it comes before the boundary', () => {
    const { ms, reason } = msUntilNextRefresh(lastTick, '2026-08-28T20:00:00Z', 5)
    expect(reason).toBe('window')
    expect(ms).toBe(47 * 60 * 1000)
  })

  it('falls back to the boundary when nothing else is due today', () => {
    const { ms, reason } = msUntilNextRefresh(lastTick, null, 5)
    expect(reason).toBe('boundary')
    // 20:13 BST to 05:00 BST the next morning.
    expect(ms).toBe(msUntilNextBoundary(lastTick, 5))
  })

  it('uses the boundary when the next window falls after it', () => {
    const { reason } = msUntilNextRefresh(lastTick, '2026-08-30T12:00:00Z', 5)
    expect(reason).toBe('boundary')
  })

  it('never returns a negative wait for a window that has already opened', () => {
    const { ms, reason } = msUntilNextRefresh(lastTick, '2026-08-28T18:00:00Z', 5)
    expect(reason).toBe('window')
    expect(ms).toBe(0)
  })

  it('ignores an unparseable window rather than trusting it', () => {
    const { ms, reason } = msUntilNextRefresh(lastTick, 'not-a-date', 5)
    expect(reason).toBe('boundary')
    expect(ms).toBe(msUntilNextBoundary(lastTick, 5))
  })

  it('is correct on the autumn clock change, where the boundary is seven hours away', () => {
    // 2026-10-24 22:00Z = 23:00 BST. The boundary is seven hours off, not six, because
    // an hour repeats. A window at 23:30 BST still wins.
    const beforeTheChange = new Date('2026-10-24T22:00:00Z')
    expect(msUntilNextRefresh(beforeTheChange, null, 5)).toEqual({
      ms: 7 * 60 * 60 * 1000,
      reason: 'boundary',
    })
    expect(msUntilNextRefresh(beforeTheChange, '2026-10-24T22:30:00Z', 5)).toEqual({
      ms: 30 * 60 * 1000,
      reason: 'window',
    })
  })
})

describe('clock labels', () => {
  it('names hours the way staff say them', () => {
    expect(hourLabel(0)).toBe('12am')
    expect(hourLabel(5)).toBe('5am')
    expect(hourLabel(12)).toBe('12pm')
    expect(hourLabel(21)).toBe('9pm')
  })

  it('labels an instant in London wall-clock time', () => {
    // 2026-08-28 20:00Z = 21:00 BST, the closing window on the night in question.
    expect(londonClockLabel(new Date('2026-08-28T20:00:00Z'))).toBe('9pm')
    expect(londonClockLabel(new Date('2026-08-28T20:30:00Z'))).toBe('9:30pm')
    // 04:00Z = 05:00 BST, the business-day boundary.
    expect(londonClockLabel(new Date('2026-08-29T04:00:00Z'))).toBe('5am')
  })

  it('renders midday as 12pm, not the 0pm en-GB hour12 produces on this Node', () => {
    // 2026-08-28 11:00Z = 12:00 BST.
    expect(londonClockLabel(new Date('2026-08-28T11:00:00Z'))).toBe('12pm')
    // 2026-08-28 23:00Z = 00:00 BST the next day.
    expect(londonClockLabel(new Date('2026-08-28T23:00:00Z'))).toBe('12am')
  })

  it('reads GMT instants against the winter clock', () => {
    // 2026-12-01 21:00Z = 21:00 GMT.
    expect(londonClockLabel(new Date('2026-12-01T21:00:00Z'))).toBe('9pm')
  })
})
