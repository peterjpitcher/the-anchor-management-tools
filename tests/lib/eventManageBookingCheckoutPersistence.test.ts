import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/payments/stripe', () => ({
  createStripeCheckoutSession: vi.fn(),
}))

import { createStripeCheckoutSession } from '@/lib/payments/stripe'
import { createSeatIncreaseCheckoutByManageToken } from '@/lib/events/manage-booking'

type BuildSupabaseOptions = {
  existingLookupError?: { message: string } | null
  existingPayment?: { id: string } | null
  insertResult?: { data: { id: string } | null; error: { message: string; code?: string } | null }
  concurrentLookupError?: { message: string } | null
  concurrentPayment?: { id: string } | null
}

function buildSupabase(options: BuildSupabaseOptions = {}) {
  const preview = {
    state: 'ready',
    booking_id: 'booking-1',
    event_id: 'event-1',
    event_name: 'Live Music Night',
    event_start_datetime: '2030-01-01T20:00:00.000Z',
    status: 'confirmed',
    seats: 2,
    payment_mode: 'prepaid',
    price_per_seat: 25,
    can_change_seats: true,
  }

  const paymentsLookupMaybeSingle = vi.fn().mockResolvedValueOnce({
    data: options.existingPayment ?? null,
    error: options.existingLookupError ?? null,
  })

  if (
    Object.prototype.hasOwnProperty.call(options, 'concurrentLookupError')
    || Object.prototype.hasOwnProperty.call(options, 'concurrentPayment')
  ) {
    paymentsLookupMaybeSingle.mockResolvedValueOnce({
      data: options.concurrentPayment ?? null,
      error: options.concurrentLookupError ?? null,
    })
  }

  const paymentsLookupLimit = vi.fn().mockReturnValue({ maybeSingle: paymentsLookupMaybeSingle })
  const paymentsLookupEq = vi.fn().mockReturnValue({ limit: paymentsLookupLimit })
  const paymentsSelect = vi.fn().mockReturnValue({ eq: paymentsLookupEq })

  const paymentsInsertMaybeSingle = vi.fn().mockResolvedValue(
    options.insertResult ?? {
      data: { id: 'payment-1' },
      error: null,
    }
  )
  const paymentsInsertSelect = vi.fn().mockReturnValue({ maybeSingle: paymentsInsertMaybeSingle })
  const paymentsInsert = vi.fn().mockReturnValue({ select: paymentsInsertSelect })

  const supabase = {
    rpc: vi.fn(async (fn: string) => {
      if (fn === 'get_event_booking_manage_preview_v05') {
        return { data: preview, error: null }
      }

      throw new Error(`Unexpected rpc: ${fn}`)
    }),
    from: vi.fn((table: string) => {
      if (table === 'payments') {
        return {
          select: paymentsSelect,
          insert: paymentsInsert,
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    }),
  }

  return {
    supabase,
    spies: {
      paymentsInsert,
      paymentsLookupMaybeSingle,
    },
  }
}

describe('event manage seat-increase checkout payment persistence guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(createStripeCheckoutSession as unknown as vi.Mock).mockResolvedValue({
      id: 'cs_test_1',
      url: 'https://stripe.test/checkout/cs_test_1',
      payment_intent: 'pi_test_1',
    })
  })

  it('fails closed when seat-increase payment lookup errors before insert', async () => {
    const { supabase, spies } = buildSupabase({
      existingLookupError: { message: 'payments lookup unavailable' },
    })

    await expect(
      createSeatIncreaseCheckoutByManageToken(supabase as any, {
        rawToken: 'raw-token',
        targetSeats: 4,
        appBaseUrl: 'https://example.com',
      })
    ).rejects.toThrow(
      'Failed to verify existing seat-increase payment row before checkout persistence: payments lookup unavailable'
    )

    expect(spies.paymentsInsert).not.toHaveBeenCalled()
  })

  it('fails closed when seat-increase payment insert affects no rows', async () => {
    const { supabase } = buildSupabase({
      insertResult: {
        data: null,
        error: null,
      },
    })

    await expect(
      createSeatIncreaseCheckoutByManageToken(supabase as any, {
        rawToken: 'raw-token',
        targetSeats: 4,
        appBaseUrl: 'https://example.com',
      })
    ).rejects.toThrow('Seat-increase payment insert affected no rows')
  })

  it('allows duplicate-key insert races when concurrent seat-increase payment row is resolvable', async () => {
    const { supabase, spies } = buildSupabase({
      insertResult: {
        data: null,
        error: { message: 'duplicate key value violates unique constraint', code: '23505' },
      },
      concurrentPayment: { id: 'payment-concurrent-1' },
    })

    const result = await createSeatIncreaseCheckoutByManageToken(supabase as any, {
      rawToken: 'raw-token',
      targetSeats: 4,
      appBaseUrl: 'https://example.com',
    })

    expect(result).toMatchObject({
      state: 'created',
      checkoutUrl: 'https://stripe.test/checkout/cs_test_1',
      bookingId: 'booking-1',
      targetSeats: 4,
    })
    expect(spies.paymentsLookupMaybeSingle).toHaveBeenCalledTimes(2)
  })

  it('fails closed when duplicate-key insert race cannot resolve concurrent payment row', async () => {
    const { supabase } = buildSupabase({
      insertResult: {
        data: null,
        error: { message: 'duplicate key value violates unique constraint', code: '23505' },
      },
      concurrentPayment: null,
    })

    await expect(
      createSeatIncreaseCheckoutByManageToken(supabase as any, {
        rawToken: 'raw-token',
        targetSeats: 4,
        appBaseUrl: 'https://example.com',
      })
    ).rejects.toThrow('Failed to resolve concurrent seat-increase payment row after duplicate insert')
  })
})
