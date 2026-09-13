import { describe, expect, it } from 'vitest'

import { hasBeenSeated, isWithinReviewSendWindow } from './review-window'

/**
 * The two gates on a table booking review request, both asserted on the London clock so the
 * answers are the same under `npm test` (Europe/London) and `npm run test:utc`.
 */

describe('the review sending window', () => {
  it.each([
    // British Summer Time: the instant is an hour behind the London clock.
    ['2026-07-11T08:30:00.000Z', true, '09:30 London, just inside'],
    ['2026-07-11T07:30:00.000Z', false, '08:30 London, too early'],
    ['2026-07-11T19:30:00.000Z', true, '20:30 London, the last half hour'],
    ['2026-07-11T20:30:00.000Z', false, '21:30 London, too late'],
    // GMT: the instant and the London clock agree.
    ['2026-12-05T09:00:00.000Z', true, '09:00 London, the first minute'],
    ['2026-12-05T08:59:00.000Z', false, '08:59 London, one minute early'],
    ['2026-12-05T21:00:00.000Z', false, '21:00 London, one minute late'],
    ['2026-12-05T00:30:00.000Z', false, 'half past midnight, which is when an evening table used to be asked'],
  ])('%s is %s (%s)', (iso, expected) => {
    expect(isWithinReviewSendWindow(new Date(iso))).toBe(expected)
  })
})

describe('whether a party was actually seated', () => {
  it('is true only for a booking with a readable seated_at', () => {
    expect(hasBeenSeated({ seated_at: '2026-12-05T19:05:00.000Z' })).toBe(true)
    expect(hasBeenSeated({ seated_at: null })).toBe(false)
    expect(hasBeenSeated({})).toBe(false)
    expect(hasBeenSeated({ seated_at: 'not a date' })).toBe(false)
  })
})
