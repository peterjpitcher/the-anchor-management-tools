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

// The link is paid through PayPal on the guest payment page, which prices it from this preview.
// The old Stripe checkout builder had no caller and is gone (BK-129), so these cases now hold the
// preview to the same contract.

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
import { getTablePaymentPreviewByRawToken } from '@/lib/table-bookings/bookings'

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
      party_size: 16,
      committed_party_size: 16,
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
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('charges the locked amount when deposit_amount_locked is set (legacy paid booking)', async () => {
    const result = await getTablePaymentPreviewByRawToken(
      buildSupabase({
        deposit_amount_locked: 60,
        deposit_amount: 100,
      }) as any,
      'raw-legacy-token'
    )

    expect(result).toMatchObject({ state: 'ready', totalAmount: 60 })
  })

  it('charges deposit_amount when locked is null (existing pending booking)', async () => {
    const result = await getTablePaymentPreviewByRawToken(
      buildSupabase({
        deposit_amount_locked: null,
        deposit_amount: 80,
      }) as any,
      'raw-legacy-token'
    )

    expect(result).toMatchObject({ state: 'ready', totalAmount: 80 })
  })

  it('uses London end-of-day for confirmed-booking fallback hold expiry', async () => {
    const result = await getTablePaymentPreviewByRawToken(
      buildSupabase({
        hold_expires_at: null,
        booking_date: '2026-07-15',
      }) as any,
      'raw-legacy-token'
    )

    expect(result).toMatchObject({ state: 'ready' })
    if (result.state !== 'ready') throw new Error('Expected ready preview')
    expect(result.holdExpiresAt).toBe('2026-07-15T22:59:59.000Z')
  })

  it('fails with state: blocked + reason: invalid_amount when no canonical deposit resolves', async () => {
    // party_size below threshold and no stored/locked deposit → 0
    const result = await getTablePaymentPreviewByRawToken(
      buildSupabase({
        party_size: 4,
        committed_party_size: 4,
        deposit_amount_locked: null,
        deposit_amount: null,
      }) as any,
      'raw-legacy-token'
    )

    expect(result).toMatchObject({ state: 'blocked', reason: 'invalid_amount' })
  })

  it('fails with state: blocked + reason: hold_expired when the hold window has lapsed', async () => {
    const result = await getTablePaymentPreviewByRawToken(
      buildSupabase({
        hold_expires_at: '2026-06-26T09:00:00.000Z', // already past per fake clock
        deposit_amount_locked: 60,
      }) as any,
      'raw-legacy-token'
    )

    expect(result).toMatchObject({ state: 'blocked', reason: 'hold_expired' })
  })
})
