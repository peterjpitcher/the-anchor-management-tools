import { describe, expect, it } from 'vitest'
import { daysUntilHoldExpiry, londonCalendarDaysBetween } from '@/lib/private-bookings/hold-deadline'
import { classifyDepositReminderWindow } from '@/services/private-bookings/scheduled-sms'
import { computeHoldExpiry } from '@/services/private-bookings/types'
import { toLocalIsoDate } from '@/lib/dateUtils'

/**
 * The deposit hold deadline, and the words the guest is given about it (review PB-BR-1).
 *
 * This suite runs under TEST_TZ=Europe/London (npm test) and TEST_TZ=UTC (npm run test:utc),
 * which is the zone the serverless runtime runs in. Every answer here must be the same in both.
 */

describe('how long is left on a hold', () => {
  it('counts London calendar days, not elapsed hours', () => {
    // A hold ending at the close of 25 September, read at 09:00 on 20 September: 5.56 elapsed
    // days, which rounded up to 6 and contradicted the date printed beside it.
    const now = new Date('2026-09-20T09:00:00.000Z')
    expect(daysUntilHoldExpiry('2026-09-25T22:30:00.000Z', now)).toBe(5)
    expect(daysUntilHoldExpiry('2026-09-25T22:59:59.000Z', now)).toBe(5)
  })

  it('says tomorrow the day before, and today on the day itself', () => {
    const expiry = '2026-09-17T22:59:59.000Z'
    expect(daysUntilHoldExpiry(expiry, new Date('2026-09-16T09:00:00.000Z'))).toBe(1)
    expect(daysUntilHoldExpiry(expiry, new Date('2026-09-17T09:00:00.000Z'))).toBe(0)
    // Day 0 belongs to the expire-holds cron, so no reminder claims "expires tomorrow" on the day.
    expect(classifyDepositReminderWindow(1)).toBe('deposit_reminder_1day')
    expect(classifyDepositReminderWindow(0)).toBeNull()
  })

  it('is unmoved by the clock change', () => {
    // 25 October 2026 is the day the clocks go back.
    expect(daysUntilHoldExpiry('2026-10-26T23:59:59.000Z', new Date('2026-10-24T09:00:00.000Z'))).toBe(2)
    expect(londonCalendarDaysBetween('2026-10-24', '2026-10-26')).toBe(2)
  })

  it('has no answer without a deadline', () => {
    expect(daysUntilHoldExpiry(null, new Date())).toBeNull()
    expect(daysUntilHoldExpiry('not a date', new Date())).toBeNull()
  })
})

describe('the deadline a new booking is given', () => {
  it('runs to the end of the London day, not its first instant', () => {
    // The guest is told "a £250 deposit secures it by 20 September". The expire-holds cron runs at
    // 06:00 UTC and cancels a draft whose hold_expiry has passed, so a midnight-UTC deadline was
    // cancelled at 07:00 on the morning of the day the guest was given.
    const now = new Date('2026-09-06T12:00:00.000Z')
    const expiry = computeHoldExpiry(new Date('2026-10-04'), now)
    expect(toLocalIsoDate(expiry)).toBe('2026-09-20')
    // The last instant of 20 September in London (BST, so 22:59:59Z).
    expect(expiry.toISOString()).toBe('2026-09-20T22:59:59.000Z')
    // And the whole of that day is still ahead of the 06:00 UTC run on the 20th.
    expect(expiry.getTime()).toBeGreaterThan(Date.parse('2026-09-20T06:00:00.000Z'))
  })

  it('gives a short-notice booking the rest of its second day', () => {
    const now = new Date('2026-09-11T09:00:00.000Z')
    const expiry = computeHoldExpiry(new Date('2026-09-20'), now)
    expect(toLocalIsoDate(expiry)).toBe('2026-09-13')
    expect(expiry.toISOString()).toBe('2026-09-13T22:59:59.000Z')
  })

  it('never runs past the event itself', () => {
    const now = new Date('2026-09-18T09:00:00.000Z')
    const eventDate = new Date('2026-09-19')
    const expiry = computeHoldExpiry(eventDate, now)
    expect(expiry.getTime()).toBeLessThanOrEqual(eventDate.getTime())
  })

  it('gives the same deadline in London and in UTC', () => {
    // The assertions above are absolute instants, so this suite passing in both zones is the
    // check. Restated here so a future reader does not have to infer it.
    // 1 November plus the standard 14 days is 15 November, well inside the 6 December balance
    // deadline, and 15 November is in GMT so the day ends at 23:59:59Z.
    const expiry = computeHoldExpiry(new Date('2026-12-20'), new Date('2026-11-01T12:00:00.000Z'))
    expect(expiry.toISOString()).toBe('2026-11-15T23:59:59.000Z')
  })
})
