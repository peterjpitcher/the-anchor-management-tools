import { describe, expect, it } from 'vitest'
import {
  hasSeasonalRefundTerms,
  resolveSeasonalDepositRefund,
  type SeasonalRefundDecision,
} from './deposit-refund'
import { describeRefundPolicy } from './period-deposit'

/**
 * The boundary is where the money is. Every test below names an instant in Europe/London and the
 * answer the guest was promised at that instant.
 *
 * `at` builds a real UTC instant from a London wall-clock time, so the offset is written out rather
 * than assumed. Getting this wrong in the test would hide exactly the bug the test exists to catch.
 */
function at(utcIso: string): Date {
  const parsed = new Date(utcIso)
  if (Number.isNaN(parsed.getTime())) throw new Error(`Bad instant in test: ${utcIso}`)
  return parsed
}

function decide(overrides: Partial<Parameters<typeof resolveSeasonalDepositRefund>[0]> = {}): SeasonalRefundDecision {
  return resolveSeasonalDepositRefund({
    bookingDate: '2026-12-05',
    refundCutoffDays: 7,
    depositAmount: 120,
    ...overrides,
  })
}

describe('the seven-day boundary, to the minute', () => {
  // Booking on Saturday 5 December 2026. Seven days before is Saturday 28 November 2026.
  // GMT is in force in December, so London time equals UTC.

  it('refunds in full at the very start of the day seven days out', () => {
    const result = decide({ now: at('2026-11-28T00:00:00Z') })
    expect(result.entitled).toBe(true)
    expect(result.amount).toBe(120)
    expect(result.daysBefore).toBe(7)
  })

  it('EXACTLY seven days: refunds in full', () => {
    // 7 x 24 hours before midnight on the booking date.
    const result = decide({ now: at('2026-11-28T00:00:00Z') })
    expect(result.daysBefore).toBe(7)
    expect(result.entitled).toBe(true)
  })

  it('still refunds in full one minute before that day ends', () => {
    // The promise is stated in whole days against the booking DATE, so the guest owns the whole of
    // the day seven days out. 11:59pm on it is still a full refund.
    const result = decide({ now: at('2026-11-28T23:59:00Z') })
    expect(result.entitled).toBe(true)
    expect(result.amount).toBe(120)
  })

  it('SEVEN DAYS MINUS A MINUTE: one minute later the window has closed and nothing is refunded', () => {
    // 00:00 on 29 November. The guest is now inside seven days and gets nothing back.
    const result = decide({ now: at('2026-11-29T00:00:00Z') })
    expect(result.entitled).toBe(false)
    expect(result.amount).toBe(0)
    expect(result.daysBefore).toBe(6)
    expect(result.reason).toContain('inside the 7-day window')
  })

  it('refunds nothing on the booking day itself', () => {
    expect(decide({ now: at('2026-12-05T10:00:00Z') })).toMatchObject({ entitled: false, amount: 0, daysBefore: 0 })
  })

  it('refunds nothing after the booking date has passed', () => {
    expect(decide({ now: at('2026-12-08T10:00:00Z') })).toMatchObject({ entitled: false, daysBefore: -3 })
  })

  it('refunds in full a long way out', () => {
    expect(decide({ now: at('2026-10-01T10:00:00Z') })).toMatchObject({ entitled: true, amount: 120 })
  })
})

describe('Europe/London, not the server clock', () => {
  /**
   * The machine this runs on is not necessarily in London and Vercel is in UTC. During BST the
   * London date rolls over an hour before the UTC date does, so for that hour every night a UTC
   * day count puts the boundary a full day out.
   */
  it('uses the London date, not UTC, in the hour after London midnight during BST', () => {
    // 23:30 UTC on 13 June is already 00:30 on 14 June in London.
    // Booking on 21 June: from 14 June that is exactly 7 days, so a full refund.
    const result = decide({
      bookingDate: '2026-06-21',
      now: at('2026-06-13T23:30:00Z'),
    })
    expect(result.daysBefore).toBe(7)
    expect(result.entitled).toBe(true)
  })

  it('closes the window an hour earlier than a UTC reading would, on the London boundary', () => {
    // 23:30 UTC on 14 June is 00:30 on 15 June in London: 6 days out, so nothing.
    const result = decide({
      bookingDate: '2026-06-21',
      now: at('2026-06-14T23:30:00Z'),
    })
    expect(result.daysBefore).toBe(6)
    expect(result.entitled).toBe(false)
  })
})

describe('the clocks changing does not move the boundary', () => {
  /**
   * A millisecond subtraction divided by 86,400,000 gives 6.958 across the spring change and 7.042
   * across the autumn one. Round or floor it and one of the two silently robs a guest of a refund
   * they were promised. Both changes are crossed here.
   */
  it('spring forward: the 23-hour day still counts as one day', () => {
    // BST begins 29 March 2026. Booking 1 April 2026, cancelling on 25 March: 7 calendar days.
    // Naive milliseconds give 6 days 23 hours, which floors to 6 and would refuse the refund.
    const result = decide({
      bookingDate: '2026-04-01',
      now: at('2026-03-25T12:00:00Z'),
    })
    expect(result.daysBefore).toBe(7)
    expect(result.entitled).toBe(true)
    expect(result.amount).toBe(120)
  })

  it('spring forward: the day after is still correctly inside the window', () => {
    const result = decide({
      bookingDate: '2026-04-01',
      now: at('2026-03-26T12:00:00Z'),
    })
    expect(result.daysBefore).toBe(6)
    expect(result.entitled).toBe(false)
  })

  it('autumn back: the 25-hour day still counts as one day', () => {
    // GMT resumes 25 October 2026. Booking 28 October 2026, cancelling on 21 October: 7 days.
    const result = decide({
      bookingDate: '2026-10-28',
      now: at('2026-10-21T12:00:00Z'),
    })
    expect(result.daysBefore).toBe(7)
    expect(result.entitled).toBe(true)
  })

  it('autumn back: the day after is still correctly inside the window', () => {
    const result = decide({
      bookingDate: '2026-10-28',
      now: at('2026-10-22T12:00:00Z'),
    })
    expect(result.daysBefore).toBe(6)
    expect(result.entitled).toBe(false)
  })
})

describe('cutoffs other than seven days', () => {
  it('honours a fourteen-day period', () => {
    expect(decide({ refundCutoffDays: 14, now: at('2026-11-21T09:00:00Z') })).toMatchObject({
      entitled: true,
      daysBefore: 14,
    })
    expect(decide({ refundCutoffDays: 14, now: at('2026-11-22T09:00:00Z') })).toMatchObject({
      entitled: false,
      daysBefore: 13,
    })
  })

  it('treats a zero-day cutoff as never refundable, matching the wording the guest was shown', () => {
    const result = decide({ refundCutoffDays: 0, now: at('2026-01-01T09:00:00Z') })
    expect(result.entitled).toBe(false)
    expect(result.amount).toBe(0)
    expect(describeRefundPolicy(0)).toContain('not refundable')
  })

  it('refunds the whole deposit, never a proportion', () => {
    // The seasonal promise is all or nothing. A per-booking period at GBP 25 refunds GBP 25.
    expect(decide({ depositAmount: 25, now: at('2026-10-01T09:00:00Z') }).amount).toBe(25)
  })
})

describe('bad input never reads as a generous refund', () => {
  it('refuses to work out a refund from an unreadable booking date', () => {
    const result = decide({ bookingDate: 'next Tuesday', now: at('2026-01-01T09:00:00Z') })
    expect(result.entitled).toBe(false)
    expect(result.amount).toBe(0)
  })

  it('never returns a negative amount', () => {
    expect(decide({ depositAmount: -50, now: at('2026-01-01T09:00:00Z') }).amount).toBe(0)
  })
})

describe('which bookings this rule governs', () => {
  it('governs a booking that snapshotted a refund cutoff', () => {
    expect(hasSeasonalRefundTerms({ booking_date: '2026-12-05', deposit_refund_cutoff_days: 7 })).toBe(true)
    expect(hasSeasonalRefundTerms({ booking_date: '2026-12-05', deposit_refund_cutoff_days: 0 })).toBe(true)
  })

  it('leaves an ordinary large-group booking on the tiering it has always had', () => {
    expect(hasSeasonalRefundTerms({ booking_date: '2026-12-05' })).toBe(false)
    expect(hasSeasonalRefundTerms({ booking_date: '2026-12-05', deposit_refund_cutoff_days: null })).toBe(false)
  })
})

describe('the arithmetic and the sentence the guest was shown agree', () => {
  it('the promise names the same number of days the arithmetic enforces', () => {
    const policy = describeRefundPolicy(7)
    expect(policy).toContain('7 days')

    // Promised "full refund up to 7 days before": prove that is what actually happens.
    expect(decide({ now: at('2026-11-28T12:00:00Z') }).entitled).toBe(true)
    // Promised "inside 7 days the deposit is not refunded": prove that too.
    expect(decide({ now: at('2026-11-29T12:00:00Z') }).entitled).toBe(false)
  })
})
