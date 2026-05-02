import { describe, expect, it } from 'vitest'

import { hasUnpaidRequiredDeposit } from '@/lib/foh/bookings'

describe('FOH booking deposit guards', () => {
  it('does not block seating for confirmed under-10 bookings with stale pending payment state', () => {
    expect(
      hasUnpaidRequiredDeposit({
        status: 'confirmed',
        payment_status: 'pending',
        deposit_waived: false,
        party_size: 7,
        committed_party_size: 7,
        paypal_deposit_capture_id: null,
      }),
    ).toBe(false)
  })

  it('blocks seating for 10+ bookings that still owe the required deposit', () => {
    expect(
      hasUnpaidRequiredDeposit({
        status: 'confirmed',
        payment_status: 'pending',
        deposit_waived: false,
        party_size: 10,
        committed_party_size: 10,
        paypal_deposit_capture_id: null,
      }),
    ).toBe(true)
  })

  it('does not block when a required deposit is waived or already captured', () => {
    expect(
      hasUnpaidRequiredDeposit({
        status: 'pending_payment',
        payment_status: 'pending',
        deposit_waived: true,
        party_size: 12,
        committed_party_size: 12,
        paypal_deposit_capture_id: null,
      }),
    ).toBe(false)

    expect(
      hasUnpaidRequiredDeposit({
        status: 'confirmed',
        payment_status: 'pending',
        deposit_waived: false,
        party_size: 12,
        committed_party_size: 12,
        paypal_deposit_capture_id: 'PAYPAL-CAPTURE-1',
      }),
    ).toBe(false)
  })
})
