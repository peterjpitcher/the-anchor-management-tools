import { describe, expect, it } from 'vitest'

// Updated: the original POST route at @/app/g/[token]/table-payment/checkout/route
// was deleted when table booking deposits switched from Stripe checkout to PayPal.
// This test now verifies the blocked-reason mapping utility that was used by that route,
// ensuring the stripe_unavailable and internal_error reasons produce correct messages.
import { tablePaymentBlockedReasonMessage } from '@/lib/table-bookings/table-payment-blocked-reason'

describe('table payment checkout blocked-reason mapping', () => {
  it('maps stripe_unavailable to a user-facing message about payment service', () => {
    const message = tablePaymentBlockedReasonMessage('stripe_unavailable')

    expect(message).toContain('payment service')
    expect(message).toContain('temporarily unavailable')
  })

  it('maps internal_error to a user-facing message about an internal error', () => {
    const message = tablePaymentBlockedReasonMessage('internal_error')

    expect(message).toContain('internal error')
  })

  it('maps unknown reasons to a generic fallback message', () => {
    const message = tablePaymentBlockedReasonMessage('some_unknown_reason')

    expect(message).toBeTruthy()
    expect(message.length).toBeGreaterThan(10)
  })

  it('maps undefined reason to a generic fallback message', () => {
    const message = tablePaymentBlockedReasonMessage(undefined)

    expect(message).toBeTruthy()
    expect(message.length).toBeGreaterThan(10)
  })
})
