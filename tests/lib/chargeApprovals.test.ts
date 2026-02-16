import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/payments/stripe', () => ({
  isStripeConfigured: vi.fn().mockReturnValue(false),
  createStripeOffSessionCharge: vi.fn(),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
}))

import { attemptApprovedChargeFromDecision } from '@/lib/table-bookings/charge-approvals'

describe('approved charge persistence guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when failed charge-request persistence affects no rows', async () => {
    const updateMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const update = vi.fn().mockReturnValue({ eq: updateEq })

    const insert = vi.fn().mockResolvedValue({ error: null })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'charge_requests') {
          return { update }
        }

        if (table === 'payments') {
          return { insert }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    await expect(
      attemptApprovedChargeFromDecision(supabase as any, {
        state: 'decision_applied',
        charge_request_id: 'charge-request-1',
        table_booking_id: 'booking-1',
        customer_id: 'customer-1',
        type: 'late_cancel',
        amount: 32.5,
        currency: 'GBP',
      })
    ).rejects.toThrow('Charge request not found while persisting failure state')

    expect(updateEq).toHaveBeenCalledWith('id', 'charge-request-1')
    expect(insert).not.toHaveBeenCalled()
  })
})
