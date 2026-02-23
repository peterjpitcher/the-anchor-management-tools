import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createStripeTableDepositCheckoutSessionMock } = vi.hoisted(() => ({
  createStripeTableDepositCheckoutSessionMock: vi.fn(),
}))

vi.mock('@/lib/payments/stripe', async () => {
  const actual = await vi.importActual<typeof import('@/lib/payments/stripe')>('@/lib/payments/stripe')
  return {
    ...actual,
    createStripeTableDepositCheckoutSession: createStripeTableDepositCheckoutSessionMock,
  }
})

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

vi.mock('@/lib/sms/support', () => ({
  ensureReplyInstruction: vi.fn((body: string) => body),
}))

vi.mock('@/lib/table-bookings/manage-booking', () => ({
  createTableManageToken: vi.fn(),
}))

vi.mock('@/lib/table-bookings/sunday-preorder', () => ({
  createSundayPreorderToken: vi.fn(),
}))

import { createTableCheckoutSessionByRawToken } from '@/lib/table-bookings/bookings'

function buildSupabase() {
  const guestTokenMaybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: 'token-1',
      customer_id: 'customer-1',
      table_booking_id: 'table-booking-1',
      expires_at: '2026-02-24T09:00:00.000Z',
      consumed_at: null,
    },
    error: null,
  })
  const guestTokenEqActionType = vi.fn().mockReturnValue({ maybeSingle: guestTokenMaybeSingle })
  const guestTokenEqHash = vi.fn().mockReturnValue({ eq: guestTokenEqActionType })
  const guestTokenSelect = vi.fn().mockReturnValue({ eq: guestTokenEqHash })

  const bookingMaybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: 'table-booking-1',
      customer_id: 'customer-1',
      status: 'pending_payment',
      hold_expires_at: '2026-02-24T09:00:00.000Z',
      party_size: 2,
      committed_party_size: 2,
      booking_reference: 'TB-123',
      booking_date: '2026-03-08',
      booking_time: '16:30:00',
      start_datetime: '2026-03-08T16:30:00.000Z',
      booking_type: 'sunday_lunch',
    },
    error: null,
  })
  const bookingEq = vi.fn().mockReturnValue({ maybeSingle: bookingMaybeSingle })
  const bookingSelect = vi.fn().mockReturnValue({ eq: bookingEq })

  const paymentsMaybeSingle = vi.fn().mockResolvedValue({
    data: { id: 'payment-existing' },
    error: null,
  })
  const paymentsLimit = vi.fn().mockReturnValue({ maybeSingle: paymentsMaybeSingle })
  const paymentsEq = vi.fn().mockReturnValue({ limit: paymentsLimit })
  const paymentsSelect = vi.fn().mockReturnValue({ eq: paymentsEq })

  return {
    from: vi.fn((table: string) => {
      if (table === 'guest_tokens') {
        return { select: guestTokenSelect }
      }
      if (table === 'table_bookings') {
        return { select: bookingSelect }
      }
      if (table === 'payments') {
        return { select: paymentsSelect }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  }
}

describe('createTableCheckoutSessionByRawToken expiry handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-23T07:14:00.000Z'))
    createStripeTableDepositCheckoutSessionMock.mockResolvedValue({
      id: 'cs_test_1',
      url: 'https://stripe.test/checkout/cs_test_1',
      payment_intent: 'pi_test_1',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('clamps long hold windows to a Stripe-safe expires_at value', async () => {
    const result = await createTableCheckoutSessionByRawToken(buildSupabase() as any, {
      rawToken: 'raw-token',
      appBaseUrl: 'https://management.orangejelly.co.uk',
    })

    expect(result).toMatchObject({
      state: 'created',
      checkoutUrl: 'https://stripe.test/checkout/cs_test_1',
      tableBookingId: 'table-booking-1',
    })

    const call = createStripeTableDepositCheckoutSessionMock.mock.calls[0]?.[0]
    expect(call).toBeDefined()

    const expectedClampedMs = Date.parse('2026-02-23T07:14:00.000Z') + 24 * 60 * 60 * 1000 - 60 * 1000
    expect(call.expiresAtUnix).toBe(Math.floor(expectedClampedMs / 1000))
  })
})
