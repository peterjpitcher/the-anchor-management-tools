import { describe, expect, it } from 'vitest'
import {
  hashTimeclockPin,
  isValidTimeclockPin,
  phoneLastFourMatchesPin,
  verifyTimeclockPin,
} from '@/lib/timeclock/pin'

describe('timeclock PIN helpers', () => {
  it('hashes and verifies a four-digit PIN', () => {
    const hash = hashTimeclockPin('1234')

    expect(hash).toMatch(/^scrypt:/)
    expect(verifyTimeclockPin('1234', hash)).toBe(true)
    expect(verifyTimeclockPin('4321', hash)).toBe(false)
  })

  it('validates exactly four digits', () => {
    expect(isValidTimeclockPin('1234')).toBe(true)
    expect(isValidTimeclockPin('12 34')).toBe(true)
    expect(isValidTimeclockPin('123')).toBe(false)
    expect(isValidTimeclockPin('12345')).toBe(false)
  })

  it('supports phone last-four fallback', () => {
    expect(phoneLastFourMatchesPin('1234', '07700 901234')).toBe(true)
    expect(phoneLastFourMatchesPin('1234', '07700 905555')).toBe(false)
  })
})
