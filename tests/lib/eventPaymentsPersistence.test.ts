import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/payments/stripe', () => ({
  computeStripeCheckoutExpiresAtUnix: vi.fn(() => 1_900_000_000),
  createStripeCheckoutSession: vi.fn(),
}))

import { createStripeCheckoutSession } from '@/lib/payments/stripe'
import { createEventCheckoutSessionByRawToken } from '@/lib/events/event-payments'

type BuildSupabaseOptions = {
  existingLookupError?: { message: string } | null
  existingPayment?: { id: string } | null
  insertResult?: { data: { id: string } | null; error: { message: string; code?: string } | null }
  concurrentLookupError?: { message: string } | null
  concurrentPayment?: { id: string } | null
}

function buildSupabase(options: BuildSupabaseOptions = {}) {
  const tokenMaybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: 'token-1',
      customer_id: 'customer-1',
      event_booking_id: 'booking-1',
      expires_at: '2030-01-01T00:00:00.000Z',
      consumed_at: null,
    },
    error: null,
  })
  const tokenEqActionType = vi.fn().mockReturnValue({ maybeSingle: tokenMaybeSingle })
  const tokenEqHash = vi.fn().mockReturnValue({ eq: tokenEqActionType })
  const tokenSelect = vi.fn().mockReturnValue({ eq: tokenEqHash })

  const bookingMaybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: 'booking-1',
      customer_id: 'customer-1',
      event_id: 'event-1',
      seats: 2,
      status: 'pending_payment',
      hold_expires_at: '2030-01-02T00:00:00.000Z',
    },
    error: null,
  })
  const bookingEq = vi.fn().mockReturnValue({ maybeSingle: bookingMaybeSingle })
  const bookingSelect = vi.fn().mockReturnValue({ eq: bookingEq })

  const eventMaybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: 'event-1',
      name: 'Live Music',
      price_per_seat: 10,
      price: null,
    },
    error: null,
  })
  const eventEq = vi.fn().mockReturnValue({ maybeSingle: eventMaybeSingle })
  const eventSelect = vi.fn().mockReturnValue({ eq: eventEq })

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
    from: vi.fn((table: string) => {
      if (table === 'guest_tokens') {
        return { select: tokenSelect }
      }
      if (table === 'bookings') {
        return { select: bookingSelect }
      }
      if (table === 'events') {
        return { select: eventSelect }
      }
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

describe('event checkout payment persistence guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(createStripeCheckoutSession as unknown as vi.Mock).mockResolvedValue({
      id: 'cs_test_1',
      url: 'https://stripe.test/checkout/cs_test_1',
      payment_intent: 'pi_test_1',
    })
  })

  it('fails closed when pending payment lookup errors before insert', async () => {
    const { supabase, spies } = buildSupabase({
      existingLookupError: { message: 'payments lookup unavailable' },
    })

    await expect(
      createEventCheckoutSessionByRawToken(supabase as any, {
        rawToken: 'raw-token',
        appBaseUrl: 'https://example.com',
      })
    ).rejects.toThrow(
      'Failed to verify pending event payment row before checkout persistence: payments lookup unavailable'
    )

    expect(spies.paymentsInsert).not.toHaveBeenCalled()
  })

  it('fails closed when pending payment insert affects no rows', async () => {
    const { supabase } = buildSupabase({
      insertResult: {
        data: null,
        error: null,
      },
    })

    await expect(
      createEventCheckoutSessionByRawToken(supabase as any, {
        rawToken: 'raw-token',
        appBaseUrl: 'https://example.com',
      })
    ).rejects.toThrow('Pending event payment insert affected no rows')
  })

  it('allows duplicate-key insert races when concurrent payment row is resolvable', async () => {
    const { supabase, spies } = buildSupabase({
      insertResult: {
        data: null,
        error: { message: 'duplicate key value violates unique constraint', code: '23505' },
      },
      concurrentPayment: { id: 'payment-concurrent-1' },
    })

    const result = await createEventCheckoutSessionByRawToken(supabase as any, {
      rawToken: 'raw-token',
      appBaseUrl: 'https://example.com',
    })

    expect(result).toMatchObject({
      state: 'created',
      checkoutUrl: 'https://stripe.test/checkout/cs_test_1',
      bookingId: 'booking-1',
    })
    expect(spies.paymentsLookupMaybeSingle).toHaveBeenCalledTimes(2)
  })

  it('fails closed when duplicate-key insert race cannot resolve a concurrent row', async () => {
    const { supabase } = buildSupabase({
      insertResult: {
        data: null,
        error: { message: 'duplicate key value violates unique constraint', code: '23505' },
      },
      concurrentPayment: null,
    })

    await expect(
      createEventCheckoutSessionByRawToken(supabase as any, {
        rawToken: 'raw-token',
        appBaseUrl: 'https://example.com',
      })
    ).rejects.toThrow('Failed to resolve concurrent pending event payment row after duplicate insert')
  })
})
