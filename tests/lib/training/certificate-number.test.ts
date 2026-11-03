import { describe, expect, it } from 'vitest'
import {
  CERTIFICATE_NUMBER_ALPHABET,
  CERTIFICATE_NUMBER_PATTERN,
  generateCertificateNumber,
  isCertificateNumber,
} from '@/lib/training/certificate-number'

describe('certificate numbers', () => {
  it('maps each random byte to one base32 character, with no bias', () => {
    const bytes = Uint8Array.from([0, 1, 31, 32, 33, 63, 64, 255, 128, 10])
    expect(generateCertificateNumber(() => bytes)).toBe('AT-01Z01Z0Z0A')
  })

  it('uses only the 32 unambiguous characters (no I, L, O or U)', () => {
    expect(CERTIFICATE_NUMBER_ALPHABET).toHaveLength(32)
    expect(new Set(CERTIFICATE_NUMBER_ALPHABET).size).toBe(32)
    expect(CERTIFICATE_NUMBER_ALPHABET).not.toMatch(/[ILOU]/)
    for (let byte = 0; byte < 32; byte += 1) {
      const number = generateCertificateNumber(() => new Uint8Array(10).fill(byte))
      expect(number).toMatch(CERTIFICATE_NUMBER_PATTERN)
    }
  })

  it('draws from crypto by default, so numbers differ and keep their shape', () => {
    const numbers = new Set(Array.from({ length: 200 }, () => generateCertificateNumber()))
    expect(numbers.size).toBe(200)
    for (const number of numbers) expect(isCertificateNumber(number)).toBe(true)
  })

  it('refuses a short random source rather than issuing a short number', () => {
    expect(() => generateCertificateNumber(() => new Uint8Array(4))).toThrow(/10 random bytes/)
  })

  it('recognises the shape and nothing else', () => {
    expect(isCertificateNumber('AT-0123456789')).toBe(true)
    expect(isCertificateNumber('AT-ABCDEFGHJK')).toBe(true)
    expect(isCertificateNumber('at-0123456789')).toBe(false)
    expect(isCertificateNumber('AT-012345678')).toBe(false)
    expect(isCertificateNumber('AT-01234567IO')).toBe(false)
    expect(isCertificateNumber(' AT-0123456789')).toBe(false)
    expect(isCertificateNumber('XX-0123456789')).toBe(false)
  })
})
