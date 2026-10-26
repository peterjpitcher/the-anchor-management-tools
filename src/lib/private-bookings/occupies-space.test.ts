import { describe, expect, it } from 'vitest'
import { privateBookingOccupiesSpace } from './occupies-space'

/**
 * The app's copy of private_booking_occupies_space (BK-005, BK-160). The Postgres harness
 * private-hire-occupies-space-postgres.py checks the database side with the same cases.
 */
const NOW = new Date('2026-10-26T12:00:00Z')
const base = { status: 'draft', deposit_paid_date: null, hold_expiry: null, date_tbd: false }

describe('privateBookingOccupiesSpace', () => {
  it.each([
    ['a confirmed hire', { ...base, status: 'confirmed' }, true],
    ['a draft whose deposit is paid, with its hold cleared', { ...base, deposit_paid_date: '2026-10-09T10:00:00Z' }, true],
    ['a draft with a live hold', { ...base, hold_expiry: '2026-11-01T23:59:00Z' }, true],
    ['an unpaid draft whose hold has lapsed', { ...base, hold_expiry: '2026-10-20T23:59:00Z' }, false],
    ['an unpaid draft with no hold (an enquiry)', base, false],
    ['a confirmed hire whose date is to be confirmed', { ...base, status: 'confirmed', date_tbd: true }, false],
    ['a paid draft whose date is to be confirmed', { ...base, deposit_paid_date: '2026-10-09T10:00:00Z', date_tbd: true }, false],
    ['a cancelled hire', { ...base, status: 'cancelled', deposit_paid_date: '2026-10-09T10:00:00Z' }, false],
    ['a draft with an unreadable hold', { ...base, hold_expiry: 'not a date' }, false],
  ])('%s: %s', (_label, booking, expected) => {
    expect(privateBookingOccupiesSpace(booking, NOW)).toBe(expected)
  })
})
