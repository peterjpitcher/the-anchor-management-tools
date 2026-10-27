import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/guest/tokens', () => ({
  createGuestToken: vi.fn(async () => ({ rawToken: 'raw', hashedToken: 'hash' })),
  hashGuestToken: vi.fn(() => 'hash'),
}))

import { createBookingConfirmToken } from '@/lib/table-bookings/manage-booking'
import { bookingStartInstant } from '@/lib/table-bookings/confirm-token'

// BK-207: a confirm link lasts until 48 hours after the sitting starts. The sweep used to build
// the start as `${date}T${time}:00`, which with the database's 'HH:MM:SS' time never parsed, so
// every link fell back to 14 days from sending.
describe('booking confirm link expiry', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // Saturday 24 October 2026, 11:00 BST: the sweep for Sunday's bookings.
    vi.setSystemTime(new Date('2026-10-24T10:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('expires 48 hours after the start, worked out from the database time form', async () => {
    // Sunday 25 October is the day the clocks go back: 19:00 is GMT, so 19:00 UTC.
    const start = bookingStartInstant({ startDateTime: null, bookingDate: '2026-10-25', bookingTime: '19:00:00' })
    expect(start?.toISOString()).toBe('2026-10-25T19:00:00.000Z')

    const token = await createBookingConfirmToken({} as never, {
      customerId: 'cust-1',
      tableBookingId: 'tb-1',
      bookingStartIso: start?.toISOString() ?? null,
      appBaseUrl: 'https://management.example.test',
    })

    expect(token.expiresAt).toBe('2026-10-27T19:00:00.000Z')
  })

  it('reads a summer-time booking as London time', () => {
    expect(
      bookingStartInstant({ startDateTime: null, bookingDate: '2026-09-12', bookingTime: '19:30:00' })?.toISOString()
    ).toBe('2026-09-12T18:30:00.000Z')
  })

  it('prefers the stored start', () => {
    expect(
      bookingStartInstant({ startDateTime: '2026-09-12T17:00:00Z', bookingDate: '2026-09-12', bookingTime: '19:30:00' })?.toISOString()
    ).toBe('2026-09-12T17:00:00.000Z')
  })

  it('returns null when nothing can be read', () => {
    expect(bookingStartInstant({ startDateTime: null, bookingDate: '2026-09-12', bookingTime: null })).toBeNull()
  })
})
