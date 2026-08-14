import { describe, expect, it } from 'vitest'
import { isFohWalkInDateAllowed, shouldSeatFohWalkIn } from './walk-in'

describe('isFohWalkInDateAllowed', () => {
  it('allows a walk-in for today', () => {
    expect(isFohWalkInDateAllowed({
      walkIn: true,
      bookingDate: '2026-08-14',
      todayIso: '2026-08-14',
    })).toBe(true)
  })

  it('rejects a future walk-in', () => {
    expect(isFohWalkInDateAllowed({
      walkIn: true,
      bookingDate: '2026-08-15',
      todayIso: '2026-08-14',
    })).toBe(false)
  })

  it('allows a normal future booking', () => {
    expect(isFohWalkInDateAllowed({
      walkIn: false,
      bookingDate: '2026-08-15',
      todayIso: '2026-08-14',
    })).toBe(true)
  })
})

describe('shouldSeatFohWalkIn', () => {
  it('seats a walk-in for today', () => {
    expect(shouldSeatFohWalkIn({
      walkIn: true,
      bookingDate: '2026-08-14',
      todayIso: '2026-08-14',
    })).toBe(true)
  })

  it('never seats a future walk-in', () => {
    expect(shouldSeatFohWalkIn({
      walkIn: true,
      bookingDate: '2026-08-15',
      todayIso: '2026-08-14',
    })).toBe(false)
  })

  it('does not seat a normal booking', () => {
    expect(shouldSeatFohWalkIn({
      walkIn: false,
      bookingDate: '2026-08-14',
      todayIso: '2026-08-14',
    })).toBe(false)
  })
})
