import { describe, expect, it } from 'vitest'
import { computeStripeCheckoutExpiresAtUnix } from '@/lib/payments/stripe'

describe('computeStripeCheckoutExpiresAtUnix', () => {
  const nowMs = Date.parse('2026-02-23T07:14:00.000Z')

  it('returns undefined for invalid timestamps', () => {
    expect(computeStripeCheckoutExpiresAtUnix(null, { nowMs })).toBeUndefined()
    expect(computeStripeCheckoutExpiresAtUnix('', { nowMs })).toBeUndefined()
    expect(computeStripeCheckoutExpiresAtUnix('not-a-date', { nowMs })).toBeUndefined()
  })

  it('returns undefined when the effective window is below the minimum threshold', () => {
    const tooClose = new Date(nowMs + 30 * 60 * 1000).toISOString()
    expect(computeStripeCheckoutExpiresAtUnix(tooClose, { nowMs })).toBeUndefined()
  })

  it('preserves the provided hold expiry when it is within Stripe limits', () => {
    const holdExpiresAtIso = '2026-02-23T09:30:00.000Z'
    expect(computeStripeCheckoutExpiresAtUnix(holdExpiresAtIso, { nowMs })).toBe(
      Math.floor(Date.parse(holdExpiresAtIso) / 1000)
    )
  })

  it('clamps long holds to under 24 hours from now', () => {
    const holdExpiresAtIso = '2026-02-24T09:00:00.000Z'
    const expectedClampedMs = nowMs + 24 * 60 * 60 * 1000 - 60 * 1000

    expect(computeStripeCheckoutExpiresAtUnix(holdExpiresAtIso, { nowMs })).toBe(
      Math.floor(expectedClampedMs / 1000)
    )
  })
})
