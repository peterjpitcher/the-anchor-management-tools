/**
 * Walk-in launch (spec §6, §7.3, §7.4, §8.3): the legacy SMS payment link
 * (path: /g/<token>/table-payment) always charges the canonical deposit:
 *   1. If deposit_amount_locked is set, charge that.
 *   2. Else if deposit_amount is set, charge that.
 *   3. Else compute fresh.
 *
 * If none resolves to a positive amount, the link must fail with a
 * `state: 'blocked'` reason that staff can recognise (`invalid_amount`),
 * NOT silently fall back to the legacy 7+ rule. This is the
 * staff-recovery-friendly contract the spec requires.
 */
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
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn() }))
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

function buildSupabase(bookingOverrides: Record<string, unknown> = {}) {
  const guestTokenMaybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: 'token-legacy',
      customer_id: 'customer-1',
      table_booking_id: 'tb-legacy',
      expires_at: '2026-06-30T09:00:00.000Z',
      consumed_at: null,
    },
    error: null,
  })
  const guestTokenSelect = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: guestTokenMaybeSingle,
      }),
    }),
  })

  const bookingMaybeSingle = vi.fn().mockResolvedValue({
    data: {
      id: 'tb-legacy',
      customer_id: 'customer-1',
      status: 'pending_payment',
      payment_status: 'pending',
      hold_expires_at: '2026-06-30T09:00:00.000Z',
      party_size: 12,
      committed_party_size: 12,
      booking_reference: 'TB-LEGACY',
      booking_date: '2026-06-28',
      booking_time: '13:00:00',
      start_datetime: '2026-06-28T13:00:00.000Z',
      booking_type: 'regular',
      deposit_amount: null,
      deposit_amount_locked: null,
      deposit_waived: false,
      ...bookingOverrides,
    },
    error: null,
  })
  const bookingSelect = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({ maybeSingle: bookingMaybeSingle }),
  })

  const paymentsSelect = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'payment-row' }, error: null }),
      }),
    }),
  })

  return {
    from: vi.fn((table: string) => {
      if (table === 'guest_tokens') return { select: guestTokenSelect }
      if (table === 'table_bookings') return { select: bookingSelect }
      if (table === 'payments') return { select: paymentsSelect }
      throw new Error(`Unexpected table: ${table}`)
    }),
  }
}

describe('Legacy payment link — canonical deposit charging (walk-in launch)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-27T07:14:00.000Z'))
    createStripeTableDepositCheckoutSessionMock.mockResolvedValue({
      id: 'cs_legacy_1',
      url: 'https://stripe.test/checkout/cs_legacy_1',
      payment_intent: 'pi_legacy_1',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('charges the locked amount when deposit_amount_locked is set (legacy paid booking)', async () => {
    const result = await createTableCheckoutSessionByRawToken(
      buildSupabase({
        deposit_amount_locked: 60,
        deposit_amount: 100,
      }) as any,
      { rawToken: 'raw-legacy-token', appBaseUrl: 'https://example.invalid' }
    )

    expect(result).toMatchObject({ state: 'created' })

    const stripeArgs = createStripeTableDepositCheckoutSessionMock.mock.calls[0]?.[0]
    // formatPence converts £60 → 6000p
    expect(stripeArgs.unitAmountMinor).toBe(6000)
  })

  it('charges deposit_amount when locked is null (existing pending booking)', async () => {
    const result = await createTableCheckoutSessionByRawToken(
      buildSupabase({
        deposit_amount_locked: null,
        deposit_amount: 80,
      }) as any,
      { rawToken: 'raw-legacy-token', appBaseUrl: 'https://example.invalid' }
    )

    expect(result).toMatchObject({ state: 'created' })

    const stripeArgs = createStripeTableDepositCheckoutSessionMock.mock.calls[0]?.[0]
    expect(stripeArgs.unitAmountMinor).toBe(8000)
  })

  it('fails with state: blocked + reason: invalid_amount when no canonical deposit resolves', async () => {
    // party_size below threshold and no stored/locked deposit → 0
    const result = await createTableCheckoutSessionByRawToken(
      buildSupabase({
        party_size: 4,
        committed_party_size: 4,
        deposit_amount_locked: null,
        deposit_amount: null,
      }) as any,
      { rawToken: 'raw-legacy-token', appBaseUrl: 'https://example.invalid' }
    )

    expect(result).toMatchObject({ state: 'blocked', reason: 'invalid_amount' })

    // Must NOT call Stripe with a zero/invalid amount.
    expect(createStripeTableDepositCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it('fails with state: blocked + reason: hold_expired when the hold window has lapsed', async () => {
    const result = await createTableCheckoutSessionByRawToken(
      buildSupabase({
        hold_expires_at: '2026-06-26T09:00:00.000Z', // already past per fake clock
        deposit_amount_locked: 60,
      }) as any,
      { rawToken: 'raw-legacy-token', appBaseUrl: 'https://example.invalid' }
    )

    expect(result).toMatchObject({ state: 'blocked', reason: 'hold_expired' })
    expect(createStripeTableDepositCheckoutSessionMock).not.toHaveBeenCalled()
  })
})
