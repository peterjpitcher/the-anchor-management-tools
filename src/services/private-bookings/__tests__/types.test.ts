import { describe, it, expect } from 'vitest'
import { balanceDueMoment, computeHoldExpiry, computeBalanceDueDateIso, BALANCE_DUE_DAYS_BEFORE_EVENT } from '../types'

const iso = (d: Date) => d.toISOString().slice(0, 10)

describe('balanceDueMoment', () => {
  it('should be 14 calendar days before the event (SOP pack acceptance test)', () => {
    // Pack §10: event Sunday 19 July 2026 → due Sunday 5 July 2026 (NOT 12 July)
    const due = balanceDueMoment(new Date('2026-07-19T00:00:00Z'))
    expect(iso(due)).toBe('2026-07-05')
    expect(BALANCE_DUE_DAYS_BEFORE_EVENT).toBe(14)
  })

  it('should cross month boundaries correctly', () => {
    const due = balanceDueMoment(new Date('2026-08-10T00:00:00Z'))
    expect(iso(due)).toBe('2026-07-27')
  })
})

describe('computeHoldExpiry', () => {
  const event = new Date('2026-07-19T00:00:00Z')

  it('should give the standard 14-day hold when the event is far away', () => {
    const expiry = computeHoldExpiry(event, new Date('2026-06-01T00:00:00Z'))
    expect(iso(expiry)).toBe('2026-06-15')
  })

  it('should cap the hold at the balance & final-details due date (event - 14 days)', () => {
    // now + 14 = 15 July, but the due date is 5 July — hold must not pass it
    const expiry = computeHoldExpiry(event, new Date('2026-07-01T00:00:00Z'))
    expect(iso(expiry)).toBe('2026-07-05')
  })

  it('should give a 48-hour hold when created inside the 14-day window', () => {
    const expiry = computeHoldExpiry(event, new Date('2026-07-10T00:00:00Z'))
    expect(iso(expiry)).toBe('2026-07-12')
  })

  it('should cap a short-notice hold at the event start', () => {
    const expiry = computeHoldExpiry(event, new Date('2026-07-18T00:00:00Z'))
    expect(expiry.getTime()).toBe(event.getTime())
  })
})

describe('computeBalanceDueDateIso', () => {
  it('should be event - 14 days when the event is far away', () => {
    expect(computeBalanceDueDateIso('2026-07-19', new Date('2026-06-01T12:00:00Z'))).toBe('2026-07-05')
  })

  it('should clamp to today when computed inside the 14-day window (never a past date)', () => {
    // Paula regression: backfill/reschedule inside the window must land on
    // "today", not a date already gone.
    expect(computeBalanceDueDateIso('2026-07-19', new Date('2026-07-08T12:00:00Z'))).toBe('2026-07-08')
  })

  it('should accept a Date event input', () => {
    expect(computeBalanceDueDateIso(new Date('2026-08-10T00:00:00Z'), new Date('2026-06-01T12:00:00Z'))).toBe('2026-07-27')
  })

  it('should never return a date after the event itself (past-dated event)', () => {
    // Clamping forward to "today" must not push the deadline past the event —
    // that would leave the cron chasing a balance for an event already held.
    expect(computeBalanceDueDateIso('2026-07-01', new Date('2026-07-08T12:00:00Z'))).toBe('2026-07-01')
  })

  it('should return the event date when the event is today', () => {
    expect(computeBalanceDueDateIso('2026-07-08', new Date('2026-07-08T12:00:00Z'))).toBe('2026-07-08')
  })
})
