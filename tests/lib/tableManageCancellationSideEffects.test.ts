import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  recordAnalyticsEvent: vi.fn(),
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: mocks.recordAnalyticsEvent,
}))

vi.mock('@/lib/logger', () => ({
  logger: mocks.logger,
}))

import { updateTableBookingByRawToken } from '@/lib/table-bookings/manage-booking'

/**
 * A guest cancelling ten hours before their table used to be the late-cancel
 * case: a `charge_requests` row and an approval email to the manager. That was
 * removed on 2026-08-06 because no card is held for any customer, so the charge
 * could never be taken.
 *
 * The `from` map below deliberately omits `charge_requests` and
 * `system_settings`. Both are needed to price and raise a fee, so touching
 * either fails the test loudly rather than quietly re-introducing the machinery.
 *
 * There is deliberately no spy asserting the manager approval email is unsent.
 * The runtime that sent it was deleted outright on 2026-08-10, so a spy would
 * have to mock a module that no longer exists and could never be called, which
 * passes whatever the code does. The table assertions above are the real guard:
 * no fee can be raised without reading `system_settings` and writing
 * `charge_requests`, and both throw here.
 */
function buildSupabaseForLateCancellation() {
  const guestTokenMaybeSingle = vi.fn().mockResolvedValue({
    data: {
      customer_id: 'customer-1',
      table_booking_id: 'booking-1',
      expires_at: '2030-06-04T23:00:00.000Z',
      consumed_at: null,
    },
    error: null,
  })
  // The action_type filter is `.in(...)` rather than `.eq(...)`, because the 24h confirm
  // link reaches this same cancel path with a 'booking_confirm' token. Both terminators
  // are offered so this double does not care which the query uses.
  const guestTokenSecondEq = vi.fn().mockReturnValue({ maybeSingle: guestTokenMaybeSingle })
  const guestTokenIn = vi.fn().mockReturnValue({ maybeSingle: guestTokenMaybeSingle })
  const guestTokenFirstEq = vi
    .fn()
    .mockReturnValue({ eq: guestTokenSecondEq, in: guestTokenIn })
  const guestTokenSelect = vi.fn().mockReturnValue({ eq: guestTokenFirstEq, in: guestTokenIn })

  const bookingPreviewMaybeSingle = vi.fn().mockResolvedValue({
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
  const bookingPreviewEq = vi.fn().mockReturnValue({ maybeSingle: bookingPreviewMaybeSingle })
  const bookingSelect = vi.fn().mockReturnValue({ eq: bookingPreviewEq })

  const cancelMaybeSingle = vi.fn().mockResolvedValue({
    data: { id: 'booking-1' },
    error: null,
  })
  const cancelSelect = vi.fn().mockReturnValue({ maybeSingle: cancelMaybeSingle })
  const cancelSecondEq = vi.fn().mockReturnValue({ select: cancelSelect })
  const cancelFirstEq = vi.fn().mockReturnValue({ eq: cancelSecondEq })
  const bookingUpdate = vi.fn().mockReturnValue({ eq: cancelFirstEq })

  const assignmentEq = vi.fn().mockResolvedValue({ data: [], error: null })
  const assignmentSelect = vi.fn().mockReturnValue({ eq: assignmentEq })

  const tablesTouched: string[] = []

  return {
    supabase: {
      from: vi.fn((table: string) => {
        tablesTouched.push(table)
        if (table === 'guest_tokens') return { select: guestTokenSelect }
        if (table === 'table_bookings') {
          return {
            select: bookingSelect,
            update: bookingUpdate,
          }
        }
        if (table === 'booking_table_assignments') return { select: assignmentSelect }
        throw new Error(`Unexpected table: ${table}`)
      }),
    },
    spies: {
      bookingUpdate,
      tablesTouched,
    },
  }
}

describe('table manage cancellation side effects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    // Ten hours before the booking, so this is well inside the old 24-hour
    // late-cancel window. It must still be an ordinary cancellation.
    vi.setSystemTime(new Date('2026-06-04T10:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('cancels without raising a charge request when the guest cancels late', async () => {
    const { supabase, spies } = buildSupabaseForLateCancellation()

    const result = await updateTableBookingByRawToken(supabase as any, {
      rawToken: 'raw-token',
      action: 'cancel',
      appBaseUrl: 'https://example.com',
    })

    expect(result).toMatchObject({
      state: 'cancelled',
      table_booking_id: 'booking-1',
      customer_id: 'customer-1',
      status: 'cancelled',
      charge_request_id: null,
      charge_amount: null,
    })
    expect(spies.bookingUpdate).toHaveBeenCalled()
  })

  it('reads neither the fee setting nor the charge_requests table', async () => {
    const { supabase, spies } = buildSupabaseForLateCancellation()

    await updateTableBookingByRawToken(supabase as any, {
      rawToken: 'raw-token',
      action: 'cancel',
      appBaseUrl: 'https://example.com',
    })

    expect(spies.tablesTouched).not.toContain('system_settings')
    expect(spies.tablesTouched).not.toContain('charge_requests')
  })
})
