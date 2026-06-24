import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const PIN_PATTERN = /^\d{4}$/

export function normalizeTimeclockPin(pin: string | null | undefined): string {
  return String(pin ?? '').replace(/\D/g, '')
}

export function isValidTimeclockPin(pin: string | null | undefined): boolean {
  return PIN_PATTERN.test(normalizeTimeclockPin(pin))
}

export function hashTimeclockPin(pin: string): string {
  const normalized = normalizeTimeclockPin(pin)
  if (!PIN_PATTERN.test(normalized)) {
    throw new Error('Timeclock PIN must be exactly 4 digits')
  }

  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(normalized, salt, 32).toString('hex')
  return `scrypt:${salt}:${hash}`
}

export function verifyTimeclockPin(pin: string, storedHash: string | null | undefined): boolean {
  const normalized = normalizeTimeclockPin(pin)
  if (!PIN_PATTERN.test(normalized) || !storedHash) {
    return false
  }

  const [scheme, salt, expectedHash] = storedHash.split(':')
  if (scheme !== 'scrypt' || !salt || !expectedHash) {
    return false
  }

  const actual = Buffer.from(scryptSync(normalized, salt, 32).toString('hex'), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function phoneLastFourMatchesPin(pin: string, ...phones: Array<string | null | undefined>): boolean {
  const normalized = normalizeTimeclockPin(pin)
  if (!PIN_PATTERN.test(normalized)) {
    return false
  }

  return phones.some((phone) => {
    const digits = normalizeTimeclockPin(phone)
    return digits.length >= 4 && digits.slice(-4) === normalized
  })
}
