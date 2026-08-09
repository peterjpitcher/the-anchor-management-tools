import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
}))

import { recordAnalyticsEvent } from '@/lib/analytics/events'
import { recordWalkoutForBooking } from '@/lib/foh/bookings'
import * as fohBookings from '@/lib/foh/bookings'

/**
 * Replaces tests/lib/fohChargeRequestSafety.test.ts. Charge requests were
 * withdrawn: nothing raises them, and none could ever be charged because no
 * card is held for a table booking. Flagging a walkout now only records the
 * incident.
 */
describe('recordWalkoutForBooking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('records the walkout against the customer', async () => {
    const result = await recordWalkoutForBooking({} as never, {
      bookingId: 'booking-1',
      customerId: 'customer-1',
      amount: 42.505,
      recordedByUserId: 'user-1',
      notes: 'Left through the garden',
    })

    expect(result).toEqual({ amount: 42.51 })
    expect(recordAnalyticsEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        customerId: 'customer-1',
        tableBookingId: 'booking-1',
        eventType: 'walkout_recorded',
      }),
    )
  })

  it('ignores a non-positive amount without recording anything', async () => {
    const result = await recordWalkoutForBooking({} as never, {
      bookingId: 'booking-2',
      customerId: 'customer-2',
      amount: 0,
      recordedByUserId: 'user-1',
    })

    expect(result).toEqual({ amount: 0 })
    expect(recordAnalyticsEvent).not.toHaveBeenCalled()
  })

  it('still succeeds when the analytics write fails', async () => {
    vi.mocked(recordAnalyticsEvent).mockRejectedValueOnce(new Error('analytics down'))

    const result = await recordWalkoutForBooking({} as never, {
      bookingId: 'booking-3',
      customerId: 'customer-3',
      amount: 10,
      recordedByUserId: 'user-1',
    })

    // Losing the analytics row must not fail the FOH action the staff member took.
    expect(result).toEqual({ amount: 10 })
  })

  it('no longer exposes any charge-request creation', () => {
    expect('createChargeRequestForBooking' in fohBookings).toBe(false)
  })
})
