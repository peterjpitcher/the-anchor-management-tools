import { describe, expect, it } from 'vitest'
import { formatPhoneForStorage, generatePhoneVariants } from '@/lib/utils'

describe('formatPhoneForStorage', () => {
  it('normalizes UK local numbers to E.164 by default', () => {
    expect(formatPhoneForStorage('07700 900123')).toBe('+447700900123')
  })

  it('keeps explicit international numbers in E.164 format', () => {
    expect(formatPhoneForStorage('+1 (415) 555-2671')).toBe('+14155552671')
  })

  it('converts 00-prefixed international numbers to E.164', () => {
    expect(formatPhoneForStorage('0049 1512 3456789')).toBe('+4915123456789')
  })

  it('throws for malformed input', () => {
    expect(() => formatPhoneForStorage('hello')).toThrow('Invalid phone number format')
  })
})

describe('generatePhoneVariants', () => {
  it('includes common UK legacy forms for matching', () => {
    const variants = generatePhoneVariants('+447700900123')
    expect(variants).toContain('+447700900123')
    expect(variants).toContain('447700900123')
    expect(variants).toContain('07700900123')
    expect(variants).toContain('00447700900123')
  })

  it('includes common international forms', () => {
    const variants = generatePhoneVariants('+14155552671')
    expect(variants).toContain('+14155552671')
    expect(variants).toContain('14155552671')
    expect(variants).toContain('0014155552671')
  })
})
