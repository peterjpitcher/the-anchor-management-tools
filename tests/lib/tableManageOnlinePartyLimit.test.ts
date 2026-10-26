import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import { updateTableBookingByRawToken } from '@/lib/table-bookings/manage-booking'

/**
 * BK-129: a guest changing their own party size was refused at a hard-coded 21, so lowering
 * table_booking_max_party_online (the limit the booking function applies online) never reached the
 * guest's own manage link. The limit is now read from the setting, with the booking function's
 * default of 20 when it is missing or unreadable.
 */
function buildSupabase(onlineLimit: { value: unknown } | 'missing' | 'error') {
  const tokenMaybeSingle = vi.fn().mockResolvedValue({
    data: { customer_id: 'customer-1', table_booking_id: 'booking-1', expires_at: '2030-06-04T23:00:00.000Z', consumed_at: null },
    error: null,
  })
  const tokenChain = { eq: vi.fn(), in: vi.fn(), maybeSingle: tokenMaybeSingle }
  tokenChain.eq.mockReturnValue(tokenChain)
  tokenChain.in.mockReturnValue(tokenChain)

  const bookingMaybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: 'booking-1',
      customer_id: 'customer-1',
      booking_reference: 'TB-1',
      status: 'confirmed',
      party_size: 4,
      committed_party_size: 4,
      special_requirements: null,
      booking_type: 'regular',
      booking_purpose: 'food',
      start_datetime: '2026-06-04T20:00:00.000Z',
      end_datetime: '2026-06-04T22:00:00.000Z',
    },
    error: null,
  })

  const settingMaybeSingle = vi.fn().mockResolvedValue(
    onlineLimit === 'error'
      ? { data: null, error: { code: '57014', message: 'timeout' } }
      : { data: onlineLimit === 'missing' ? null : { value: onlineLimit }, error: null },
  )

  return {
    from: vi.fn((table: string) => {
      if (table === 'guest_tokens') return { select: vi.fn(() => tokenChain) }
      if (table === 'table_bookings') return { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: bookingMaybeSingle })) })) }
      if (table === 'booking_table_assignments') return { select: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) })) }
      if (table === 'system_settings') return { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: settingMaybeSingle })) })) }
      throw new Error(`Unexpected table: ${table}`)
    }),
  }
}

async function grow(supabase: ReturnType<typeof buildSupabase>, newPartySize: number) {
  return updateTableBookingByRawToken(supabase as never, {
    rawToken: 'raw-token',
    action: 'update',
    newPartySize,
    appBaseUrl: 'https://example.com',
  })
}

describe('a guest party-size change is held to the online party limit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T10:00:00.000Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('refuses a party above a lowered setting', async () => {
    expect(await grow(buildSupabase({ value: 12 }), 13)).toEqual({ state: 'blocked', reason: 'too_large_party' })
  })

  it('refuses 21 under the default setting of 20', async () => {
    expect(await grow(buildSupabase({ value: 20 }), 21)).toEqual({ state: 'blocked', reason: 'too_large_party' })
  })

  it.each(['missing', 'error'] as const)('falls back to 20 when the setting is %s', async (state) => {
    expect(await grow(buildSupabase(state), 21)).toEqual({ state: 'blocked', reason: 'too_large_party' })
  })
})
