import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  recordAnalyticsEvent: vi.fn(),
  sendManagerChargeApprovalEmail: vi.fn(),
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

vi.mock('@/lib/table-bookings/charge-approvals', () => ({
  sendManagerChargeApprovalEmail: mocks.sendManagerChargeApprovalEmail,
}))

vi.mock('@/lib/logger', () => ({
  logger: mocks.logger,
}))

import { updateTableBookingByRawToken } from '@/lib/table-bookings/manage-booking'

function buildSupabaseWithFailingFeeLookup() {
  const guestTokenMaybeSingle = vi.fn().mockResolvedValue({
    data: {
      customer_id: 'customer-1',
      table_booking_id: 'booking-1',
      expires_at: '2030-06-04T23:00:00.000Z',
      consumed_at: null,
    },
    error: null,
  })
  const guestTokenSecondEq = vi.fn().mockReturnValue({ maybeSingle: guestTokenMaybeSingle })
  const guestTokenFirstEq = vi.fn().mockReturnValue({ eq: guestTokenSecondEq })
  const guestTokenSelect = vi.fn().mockReturnValue({ eq: guestTokenFirstEq })

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

  const systemSettingsSelect = vi.fn(() => {
    throw new Error('settings unavailable')
  })

  return {
    supabase: {
      from: vi.fn((table: string) => {
        if (table === 'guest_tokens') return { select: guestTokenSelect }
        if (table === 'table_bookings') {
          return {
            select: bookingSelect,
            update: bookingUpdate,
          }
        }
        if (table === 'booking_table_assignments') return { select: assignmentSelect }
        if (table === 'system_settings') return { select: systemSettingsSelect }
        throw new Error(`Unexpected table: ${table}`)
      }),
    },
    spies: {
      bookingUpdate,
      systemSettingsSelect,
    },
  }
}

describe('table manage cancellation side effects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-04T10:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns cancelled after the booking update when late-cancel charge evaluation fails', async () => {
    const { supabase, spies } = buildSupabaseWithFailingFeeLookup()

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
    expect(spies.systemSettingsSelect).toHaveBeenCalled()
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Failed to evaluate late-cancel charge after guest cancellation',
      expect.any(Object)
    )
  })
})
