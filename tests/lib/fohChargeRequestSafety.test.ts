import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
}))

vi.mock('@/lib/table-bookings/charge-approvals', () => ({
  sendManagerChargeApprovalEmail: vi.fn().mockResolvedValue({ sent: true }),
}))

import { createChargeRequestForBooking } from '@/lib/foh/bookings'

type BuildSupabaseOptions = {
  bookingResult?: { data: { committed_party_size: number; party_size: number } | null; error: { message: string } | null }
  existingChargeRowsResult?: { data: Array<{ amount: number; manager_decision: string | null; charge_status: string | null }> | null; error: { message: string } | null }
}

function buildSupabase(options: BuildSupabaseOptions = {}) {
  const bookingMaybeSingle = vi.fn().mockResolvedValue(
    options.bookingResult ?? {
      data: { committed_party_size: 4, party_size: 4 },
      error: null,
    }
  )
  const bookingEq = vi.fn().mockReturnValue({ maybeSingle: bookingMaybeSingle })
  const bookingSelect = vi.fn().mockReturnValue({ eq: bookingEq })

  const settingsLimit = vi.fn().mockResolvedValue({
    data: [{ value: 15 }],
    error: null,
  })
  const settingsOrder = vi.fn().mockReturnValue({ limit: settingsLimit })
  const settingsIn = vi.fn().mockReturnValue({ order: settingsOrder })
  const settingsSelect = vi.fn().mockReturnValue({ in: settingsIn })

  const existingChargeIn = vi.fn().mockResolvedValue(
    options.existingChargeRowsResult ?? {
      data: [],
      error: null,
    }
  )
  const existingChargeEq = vi.fn().mockReturnValue({ in: existingChargeIn })
  const existingChargeSelect = vi.fn().mockReturnValue({ eq: existingChargeEq })

  const chargeInsertMaybeSingle = vi.fn().mockResolvedValue({
    data: { id: 'charge-1' },
    error: null,
  })
  const chargeInsertSelect = vi.fn().mockReturnValue({ maybeSingle: chargeInsertMaybeSingle })
  const chargeInsert = vi.fn().mockReturnValue({ select: chargeInsertSelect })

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'table_bookings') {
        return { select: bookingSelect }
      }

      if (table === 'system_settings') {
        return { select: settingsSelect }
      }

      if (table === 'charge_requests') {
        return {
          select: existingChargeSelect,
          insert: chargeInsert,
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    }),
  }

  return {
    supabase,
    spies: {
      chargeInsert,
      bookingMaybeSingle,
      existingChargeIn,
    },
  }
}

describe('foh charge request cap safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails closed when booking cap-context lookup errors', async () => {
    const { supabase, spies } = buildSupabase({
      bookingResult: {
        data: null,
        error: { message: 'booking lookup unavailable' },
      },
    })

    await expect(
      createChargeRequestForBooking(supabase as any, {
        bookingId: 'booking-1',
        type: 'no_show',
        amount: 60,
        requestedByUserId: 'user-1',
      })
    ).rejects.toThrow('Failed to load booking charge-cap context: booking lookup unavailable')

    expect(spies.chargeInsert).not.toHaveBeenCalled()
  })

  it('fails closed when booking row is missing while applying cap', async () => {
    const { supabase, spies } = buildSupabase({
      bookingResult: {
        data: null,
        error: null,
      },
    })

    await expect(
      createChargeRequestForBooking(supabase as any, {
        bookingId: 'booking-2',
        type: 'late_cancel',
        amount: 30,
        requestedByUserId: 'user-2',
      })
    ).rejects.toThrow('Booking not found while preparing charge request cap: booking-2')

    expect(spies.chargeInsert).not.toHaveBeenCalled()
  })

  it('fails closed when existing capped charge lookup errors before insert', async () => {
    const { supabase, spies } = buildSupabase({
      existingChargeRowsResult: {
        data: null,
        error: { message: 'charge request lookup unavailable' },
      },
    })

    await expect(
      createChargeRequestForBooking(supabase as any, {
        bookingId: 'booking-3',
        type: 'reduction_fee',
        amount: 50,
        requestedByUserId: 'user-3',
      })
    ).rejects.toThrow('Failed to load existing capped charge requests: charge request lookup unavailable')

    expect(spies.existingChargeIn).toHaveBeenCalled()
    expect(spies.chargeInsert).not.toHaveBeenCalled()
  })
})
