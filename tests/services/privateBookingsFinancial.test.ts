import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import {
  getPrivateBookingPaidTotals,
  getPrivateBookingCancellationOutcome,
} from '@/services/private-bookings/financial'

const mockedCreateAdminClient = createAdminClient as unknown as Mock

type BookingRow = {
  deposit_amount: number | null
  deposit_paid_date: string | null
}

type PaymentRow = {
  amount: number | null
  notes: string | null
}

function mockSupabase(opts: {
  booking?: BookingRow | null
  bookingError?: { message: string } | null
  payments?: PaymentRow[]
  paymentsError?: { message: string } | null
}): void {
  const bookingSingle = vi.fn().mockResolvedValue({
    data: opts.booking ?? null,
    error: opts.bookingError ?? (opts.booking ? null : { message: 'not found' }),
  })
  const bookingEq = vi.fn().mockReturnValue({ single: bookingSingle })
  const bookingSelect = vi.fn().mockReturnValue({ eq: bookingEq })

  const paymentsEq = vi.fn().mockResolvedValue({
    data: opts.payments ?? [],
    error: opts.paymentsError ?? null,
  })
  const paymentsSelect = vi.fn().mockReturnValue({ eq: paymentsEq })

  mockedCreateAdminClient.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'private_bookings') {
        return { select: bookingSelect }
      }
      if (table === 'private_booking_payments') {
        return { select: paymentsSelect }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })
}

describe('getPrivateBookingPaidTotals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns zeros when no deposit and no payments', async () => {
    mockSupabase({
      booking: { deposit_amount: 150, deposit_paid_date: null },
      payments: [],
    })

    const totals = await getPrivateBookingPaidTotals('booking-1')

    expect(totals).toEqual({
      deposit_paid: 0,
      balance_payments_total: 0,
      total_paid: 0,
      has_open_dispute: false,
    })
  })

  it('includes deposit_amount when deposit_paid_date is set', async () => {
    mockSupabase({
      booking: { deposit_amount: 150, deposit_paid_date: '2026-01-10' },
      payments: [],
    })

    const totals = await getPrivateBookingPaidTotals('booking-2')

    expect(totals.deposit_paid).toBe(150)
    expect(totals.total_paid).toBe(150)
    expect(totals.balance_payments_total).toBe(0)
    expect(totals.has_open_dispute).toBe(false)
  })

  it('sums balance payments from private_booking_payments', async () => {
    mockSupabase({
      booking: { deposit_amount: 150, deposit_paid_date: '2026-01-10' },
      payments: [
        { amount: 100, notes: null },
        { amount: 50, notes: 'topped up' },
      ],
    })

    const totals = await getPrivateBookingPaidTotals('booking-3')

    expect(totals.deposit_paid).toBe(150)
    expect(totals.balance_payments_total).toBe(150)
    expect(totals.total_paid).toBe(300)
    expect(totals.has_open_dispute).toBe(false)
  })

  it('flags has_open_dispute when a payment note mentions "dispute"', async () => {
    mockSupabase({
      booking: { deposit_amount: 150, deposit_paid_date: '2026-01-10' },
      payments: [
        { amount: 100, notes: 'opened a dispute via Stripe' },
      ],
    })

    const totals = await getPrivateBookingPaidTotals('booking-d1')

    expect(totals.has_open_dispute).toBe(true)
  })

  it('flags has_open_dispute when a payment note mentions "chargeback"', async () => {
    mockSupabase({
      booking: { deposit_amount: 150, deposit_paid_date: '2026-01-10' },
      payments: [
        { amount: 100, notes: 'Chargeback received from the bank' },
      ],
    })

    const totals = await getPrivateBookingPaidTotals('booking-d2')

    expect(totals.has_open_dispute).toBe(true)
  })

  it('does not flag dispute for tangentially similar strings', async () => {
    mockSupabase({
      booking: { deposit_amount: 150, deposit_paid_date: '2026-01-10' },
      payments: [
        { amount: 100, notes: 'indisputable payment reference 123' },
      ],
    })

    const totals = await getPrivateBookingPaidTotals('booking-d3')

    expect(totals.has_open_dispute).toBe(false)
  })

  it('returns safe zeros when booking cannot be loaded', async () => {
    mockSupabase({
      booking: null,
      bookingError: { message: 'not found' },
    })

    const totals = await getPrivateBookingPaidTotals('missing-booking')

    expect(totals).toEqual({
      deposit_paid: 0,
      balance_payments_total: 0,
      total_paid: 0,
      has_open_dispute: false,
    })
  })
})

describe('getPrivateBookingCancellationOutcome', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns no_money when nothing paid', async () => {
    mockSupabase({
      booking: { deposit_amount: 150, deposit_paid_date: null },
      payments: [],
    })

    const outcome = await getPrivateBookingCancellationOutcome('booking-1')

    expect(outcome.outcome).toBe('no_money')
    expect(outcome.refund_amount).toBe(0)
    expect(outcome.retained_amount).toBe(0)
  })

  it('returns non_refundable_retained when only deposit paid (policy: deposit non-refundable)', async () => {
    mockSupabase({
      booking: { deposit_amount: 150, deposit_paid_date: '2026-01-10' },
      payments: [],
    })

    const outcome = await getPrivateBookingCancellationOutcome('booking-4')

    expect(outcome.outcome).toBe('non_refundable_retained')
    expect(outcome.retained_amount).toBe(150)
    expect(outcome.refund_amount).toBe(0)
  })

  it('returns refundable when balance paid AND no dispute', async () => {
    mockSupabase({
      booking: { deposit_amount: 150, deposit_paid_date: '2026-01-10' },
      payments: [
        { amount: 200, notes: null },
        { amount: 250, notes: 'top-up' },
      ],
    })

    const outcome = await getPrivateBookingCancellationOutcome('booking-5')

    expect(outcome.outcome).toBe('refundable')
    expect(outcome.refund_amount).toBe(450)
    expect(outcome.retained_amount).toBe(150)
  })

  it('returns manual_review when has_open_dispute is true', async () => {
    mockSupabase({
      booking: { deposit_amount: 150, deposit_paid_date: '2026-01-10' },
      payments: [
        { amount: 200, notes: 'customer filed a dispute' },
      ],
    })

    const outcome = await getPrivateBookingCancellationOutcome('booking-6')

    expect(outcome.outcome).toBe('manual_review')
    expect(outcome.refund_amount).toBe(0)
    // retained_amount mirrors total_paid in manual review so ops know what's at stake
    expect(outcome.retained_amount).toBe(350)
  })

  it('manual_review takes precedence over other outcomes even when no money was paid', async () => {
    // Edge case: a dispute note can only exist on a payment row, so if there
    // is a dispute there must be a payment. This test just guards the
    // precedence ordering if that assumption changes later.
    mockSupabase({
      booking: { deposit_amount: 0, deposit_paid_date: null },
      payments: [
        { amount: 0, notes: 'chargeback in progress' },
      ],
    })

    const outcome = await getPrivateBookingCancellationOutcome('booking-7')

    expect(outcome.outcome).toBe('manual_review')
  })
})
