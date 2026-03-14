import { describe, it, expect } from 'vitest'
import { formatPhoneForStorage, generatePhoneVariants } from '../index'

// ---------------------------------------------------------------------------
// formatPhoneForStorage
// ---------------------------------------------------------------------------

describe('formatPhoneForStorage', () => {
  describe('UK mobile numbers in various formats', () => {
    it('should normalise a standard UK mobile with leading zero to E.164', () => {
      expect(formatPhoneForStorage('07700900123')).toBe('+447700900123')
    })

    it('should normalise a UK mobile with spaces to E.164', () => {
      expect(formatPhoneForStorage('07700 900 123')).toBe('+447700900123')
    })

    it('should normalise a UK mobile with dashes to E.164', () => {
      expect(formatPhoneForStorage('07700-900-123')).toBe('+447700900123')
    })

    it('should normalise a UK mobile with brackets and spaces to E.164', () => {
      expect(formatPhoneForStorage('(07700) 900 123')).toBe('+447700900123')
    })

    it('should normalise a UK mobile already in E.164 format', () => {
      expect(formatPhoneForStorage('+447700900123')).toBe('+447700900123')
    })

    it('should normalise a UK mobile with international 0044 prefix to E.164', () => {
      expect(formatPhoneForStorage('00447700900123')).toBe('+447700900123')
    })

    it('should normalise a UK mobile with the country code but no plus', () => {
      expect(formatPhoneForStorage('447700900123')).toBe('+447700900123')
    })
  })

  describe('UK landline numbers', () => {
    it('should normalise a London 020 landline with leading zero to E.164', () => {
      expect(formatPhoneForStorage('02079460000')).toBe('+442079460000')
    })

    it('should normalise a Leeds 0113 landline to E.164', () => {
      expect(formatPhoneForStorage('01132345678')).toBe('+441132345678')
    })

    it('should normalise a landline with spaces', () => {
      expect(formatPhoneForStorage('020 7946 0000')).toBe('+442079460000')
    })
  })

  describe('already-normalised numbers', () => {
    it('should pass through a fully valid E.164 UK number unchanged', () => {
      expect(formatPhoneForStorage('+447911123456')).toBe('+447911123456')
    })

    it('should pass through a non-UK E.164 number unchanged', () => {
      // US number
      expect(formatPhoneForStorage('+12025550123')).toBe('+12025550123')
    })
  })

  describe('international numbers with country code', () => {
    it('should handle a US number passed with + prefix', () => {
      expect(formatPhoneForStorage('+12025550123')).toBe('+12025550123')
    })

    it('should handle a number with 00 international exit code', () => {
      expect(formatPhoneForStorage('0012025550123')).toBe('+12025550123')
    })
  })

  describe('invalid / empty inputs', () => {
    it('should throw on an empty string', () => {
      expect(() => formatPhoneForStorage('')).toThrow('Invalid phone number format')
    })

    it('should throw on a whitespace-only string', () => {
      expect(() => formatPhoneForStorage('   ')).toThrow('Invalid phone number format')
    })

    it('should throw on a clearly invalid number (too short)', () => {
      expect(() => formatPhoneForStorage('123')).toThrow('Invalid phone number format')
    })

    it('should throw on a non-numeric string', () => {
      expect(() => formatPhoneForStorage('not-a-phone')).toThrow('Invalid phone number format')
    })
  })

  describe('numbers with mixed formatting', () => {
    it('should strip mixed spaces and dashes', () => {
      expect(formatPhoneForStorage('07700 900-123')).toBe('+447700900123')
    })

    it('should strip leading/trailing whitespace before parsing', () => {
      expect(formatPhoneForStorage('  07700900123  ')).toBe('+447700900123')
    })
  })
})

// ---------------------------------------------------------------------------
// generatePhoneVariants
// ---------------------------------------------------------------------------

describe('generatePhoneVariants', () => {
  it('should include the canonical E.164 form in the variants', () => {
    const variants = generatePhoneVariants('07700900123')
    expect(variants).toContain('+447700900123')
  })

  it('should include the local format (0…) for UK numbers', () => {
    const variants = generatePhoneVariants('07700900123')
    // Legacy UK variant: 0 + national number
    expect(variants.some((v) => v.startsWith('0') && v.length === 11)).toBe(true)
  })

  it('should include the 00-prefixed international form', () => {
    const variants = generatePhoneVariants('+447700900123')
    expect(variants).toContain('00447700900123')
  })

  it('should include the raw input in the variants', () => {
    const raw = '07700900123'
    const variants = generatePhoneVariants(raw)
    expect(variants).toContain(raw)
  })

  it('should return an array with no duplicate entries', () => {
    const variants = generatePhoneVariants('+447700900123')
    const unique = new Set(variants)
    expect(variants.length).toBe(unique.size)
  })

  it('should still return partial variants even for an invalid number', () => {
    // Raw input will be preserved, but canonical formatting will fail gracefully
    const variants = generatePhoneVariants('notaphone')
    expect(variants.length).toBeGreaterThan(0)
    expect(variants).toContain('notaphone')
  })

  it('should return an array for an empty string without throwing', () => {
    // Empty string: raw variant not added (falsy), cleaned variant empty, so result may be empty
    const variants = generatePhoneVariants('')
    expect(Array.isArray(variants)).toBe(true)
  })
})
