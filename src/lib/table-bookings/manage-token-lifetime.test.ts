import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createGuestToken: vi.fn(async () => ({ rawToken: 'raw-token' })),
  hashGuestToken: vi.fn(() => 'hashed'),
  recordAnalyticsEvent: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/guest/tokens', () => ({
  createGuestToken: mocks.createGuestToken,
  hashGuestToken: mocks.hashGuestToken,
}))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: mocks.recordAnalyticsEvent }))
vi.mock('@/lib/logger', () => ({ logger: mocks.logger }))

import {
  createBookingConfirmToken,
  createTableManageToken,
  getTableManagePreviewByRawToken,
} from './manage-booking'

/**
 * How long a manage link lasts, and what the guest is told when it has run out.
 *
 * The expiry used to be capped at `now + 30 days`, so a booking taken more than a month ahead
 * went out with a link that died before the sitting: a 5 December booking made on 11 September
 * lost its link on 11 October. Six confirmations in the last 90 days did that.
 */

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function tokenSupabase() {
  return { from: vi.fn(() => ({ select: vi.fn() })) } as never
}

describe('manage token lifetime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-12T10:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lasts until 48 hours after the booking, however far ahead the booking is', async () => {
    const bookingStartIso = '2026-12-05T19:00:00.000Z'
    const result = await createTableManageToken(tokenSupabase(), {
      customerId: 'cust-1',
      tableBookingId: 'booking-1',
      bookingStartIso,
    })

    expect(result.expiresAt).toBe(new Date(Date.parse(bookingStartIso) + 48 * HOUR).toISOString())
    // Well past the old cap, which is the whole point.
    expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now() + 30 * DAY)
  })

  it('gives the confirm link the same life as the manage link', async () => {
    const bookingStartIso = '2026-12-20T18:30:00.000Z'
    const result = await createBookingConfirmToken(tokenSupabase(), {
      customerId: 'cust-1',
      tableBookingId: 'booking-1',
      bookingStartIso,
    })

    expect(result.expiresAt).toBe(new Date(Date.parse(bookingStartIso) + 48 * HOUR).toISOString())
  })

  it('still gives a link an hour of life when the booking is already long past', async () => {
    // Three days ago, so 48 hours past the start is itself in the past. The floor keeps the link
    // usable for an hour rather than issuing one that is dead on arrival.
    const result = await createTableManageToken(tokenSupabase(), {
      customerId: 'cust-1',
      tableBookingId: 'booking-1',
      bookingStartIso: '2026-09-09T19:00:00.000Z',
    })

    expect(result.expiresAt).toBe(new Date(Date.now() + HOUR).toISOString())
  })

  it('falls back to a fortnight when the booking has no readable start', async () => {
    const result = await createTableManageToken(tokenSupabase(), {
      customerId: 'cust-1',
      tableBookingId: 'booking-1',
      bookingStartIso: null,
    })

    expect(result.expiresAt).toBe(new Date(Date.now() + 14 * DAY).toISOString())
  })
})

describe('an expired manage link', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-12T10:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function supabaseWithToken(row: Record<string, unknown> | null) {
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null })
    const inFilter = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ in: inFilter, maybeSingle })
    const select = vi.fn().mockReturnValue({ eq, in: inFilter })
    return { from: vi.fn(() => ({ select })) } as never
  }

  it('is told apart from a link that never worked', async () => {
    const preview = await getTableManagePreviewByRawToken(
      supabaseWithToken({
        customer_id: 'cust-1',
        table_booking_id: 'booking-1',
        expires_at: '2026-09-11T10:00:00.000Z',
        consumed_at: null,
      }),
      'raw-token'
    )

    expect(preview).toEqual({ state: 'blocked', reason: 'expired_token' })
  })

  it('still answers invalid_token for a link nobody ever issued', async () => {
    const preview = await getTableManagePreviewByRawToken(supabaseWithToken(null), 'raw-token')

    expect(preview).toEqual({ state: 'blocked', reason: 'invalid_token' })
  })
})
