import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { generateInvoiceToken, verifyInvoiceToken } from '../invoice-token'
import { generateBookingToken } from '@/lib/private-bookings/booking-token'

const INVOICE_ID = '7f06990b-7636-4d72-b610-460168da18ec'

beforeEach(() => {
  process.env.PRIVATE_BOOKING_TOKEN_SECRET = 'test-secret-for-invoice-tokens'
})

afterEach(() => {
  vi.useRealTimers()
})

describe('invoice portal token', () => {
  it('round trips the invoice id', () => {
    expect(verifyInvoiceToken(generateInvoiceToken(INVOICE_ID))).toBe(INVOICE_ID)
  })

  it('produces a URL-safe token with no dot for Next to read as a file extension', () => {
    const token = generateInvoiceToken(INVOICE_ID)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(token).toHaveLength(88)
  })

  it('rejects a tampered signature', () => {
    const token = generateInvoiceToken(INVOICE_ID)
    const flipped = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a')
    expect(verifyInvoiceToken(flipped)).toBeNull()
  })

  it('rejects a token whose embedded expiry has been edited', () => {
    const token = generateInvoiceToken(INVOICE_ID)
    const tampered = token.slice(0, 48) + 'ffffffff' + token.slice(56)
    expect(verifyInvoiceToken(tampered)).toBeNull()
  })

  it('rejects a token signed with a different secret', () => {
    const token = generateInvoiceToken(INVOICE_ID)
    process.env.PRIVATE_BOOKING_TOKEN_SECRET = 'a-different-secret'
    expect(verifyInvoiceToken(token)).toBeNull()
  })

  it('stops accepting the token once it expires', () => {
    const token = generateInvoiceToken(INVOICE_ID)
    expect(verifyInvoiceToken(token)).toBe(INVOICE_ID)

    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.now() + 91 * 24 * 60 * 60 * 1000))
    expect(verifyInvoiceToken(token)).toBeNull()
  })

  it('refuses a booking portal token, so one cannot be replayed as the other', () => {
    // Same secret, same length, different signed prefix.
    const bookingToken = generateBookingToken(INVOICE_ID)
    expect(bookingToken).toHaveLength(88)
    expect(verifyInvoiceToken(bookingToken)).toBeNull()
  })

  it('rejects malformed input rather than throwing', () => {
    for (const bad of ['', 'nope', 'x'.repeat(88), 'x'.repeat(80)]) {
      expect(verifyInvoiceToken(bad)).toBeNull()
    }
  })
})
