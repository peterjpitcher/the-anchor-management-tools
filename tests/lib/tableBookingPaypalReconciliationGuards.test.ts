/**
 * The reconciliation sweep writes money figures onto a booking without a human
 * in the loop, so it must not trust PayPal's response any further than the
 * browser capture path does. These tests pin the three checks that keep it
 * honest: the order belongs to this booking, the money is sterling, and the
 * amount matches what the booking actually owes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/cron-auth', () => ({ authorizeCronRequest: vi.fn(() => ({ authorized: true })) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/paypal', () => ({
  getPayPalOrder: vi.fn(),
  isPayPalOrderNotFoundError: vi.fn(() => false),
}))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: vi.fn().mockResolvedValue(undefined) }))
// The first time a booking needs a person; tests below that model a repeat say so.
vi.mock('@/lib/money-alerts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/money-alerts')>()),
  alertMoneyNeedsAPerson: vi.fn().mockResolvedValue({ sent: true, duplicate: false }),
}))
// BK-047: what happens to a closed booking is late-deposit.ts's job, tested on its own; here only
// that the sweep hands it over and never confirms.
vi.mock('@/lib/table-bookings/late-deposit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/table-bookings/late-deposit')>()),
  settleDepositOnClosedBooking: vi.fn().mockResolvedValue({ outcome: 'refunded', amountGbp: 100 }),
}))
vi.mock('@/lib/table-bookings/paypal-deposit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/table-bookings/paypal-deposit')>()
  return {
    ...actual,
    sendTableBookingDepositCapturedNotifications: vi.fn().mockResolvedValue(undefined),
  }
})

import { GET } from '@/app/api/cron/table-booking-paypal-reconciliation/route'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPayPalOrder } from '@/lib/paypal'
import { logAuditEvent } from '@/app/actions/audit'
import { sendTableBookingDepositCapturedNotifications } from '@/lib/table-bookings/paypal-deposit'
import { alertMoneyNeedsAPerson } from '@/lib/money-alerts'
import { settleDepositOnClosedBooking } from '@/lib/table-bookings/late-deposit'

const BOOKING_ID = 'b1111111-1111-4111-8111-111111111111'

/** 20 covers at the GBP 5pp deposit the canonical calculator applies. */
function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING_ID,
    booking_reference: 'TB-274EB223',
    customer_id: 'cust-1',
    status: 'pending_payment',
    payment_status: 'pending',
    paypal_deposit_order_id: 'ORDER-1',
    paypal_deposit_capture_id: null,
    party_size: 20,
    deposit_amount: 100,
    deposit_amount_locked: null,
    deposit_waived: false,
    booking_type: null,
    ...overrides,
  }
}

function order(opts: { amount?: string; currency?: string; customId?: string } = {}) {
  return {
    status: 'COMPLETED',
    purchase_units: [{
      custom_id: opts.customId ?? BOOKING_ID,
      payments: {
        captures: [{
          id: 'CAPTURE-1',
          status: 'COMPLETED',
          amount: { value: opts.amount ?? '100.00', currency_code: opts.currency ?? 'GBP' },
        }],
      },
    }],
  }
}

/** Captures what, if anything, was written to the booking. */
let lastUpdate: Record<string, unknown> | null = null

function mockDb(rows: Record<string, unknown>[]) {
  lastUpdate = null
  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn(() => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'not', 'is', 'gte', 'order', 'limit', 'eq', 'neq']) {
        chain[m] = vi.fn().mockReturnValue(chain)
      }
      ;(chain as any).then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null })
      chain.update = vi.fn((payload: Record<string, unknown>) => {
        lastUpdate = payload
        const u: Record<string, unknown> = {}
        for (const m of ['eq', 'is', 'neq', 'not', 'in', 'select']) u[m] = vi.fn().mockReturnValue(u)
        u.maybeSingle = vi.fn().mockResolvedValue({ data: { id: BOOKING_ID }, error: null })
        return u
      })
      return chain
    }),
  } as any)
}

const request = () =>
  new Request('https://x/api/cron/table-booking-paypal-reconciliation') as any

function auditCalls(operationType: string) {
  return vi.mocked(logAuditEvent).mock.calls.filter(
    ([arg]) => (arg as { operation_type?: string })?.operation_type === operationType,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('table booking reconciliation guards', () => {
  it('records a capture that passes every check', async () => {
    mockDb([booking()])
    vi.mocked(getPayPalOrder).mockResolvedValue(order() as any)

    await GET(request())

    expect(lastUpdate).toMatchObject({
      payment_status: 'completed',
      paypal_deposit_capture_id: 'CAPTURE-1',
      deposit_amount_locked: 100,
    })
    expect(sendTableBookingDepositCapturedNotifications).toHaveBeenCalled()
  })

  it('refuses an order whose custom_id is a different booking', async () => {
    mockDb([booking()])
    vi.mocked(getPayPalOrder).mockResolvedValue(order({ customId: 'someone-elses-booking' }) as any)

    await GET(request())

    expect(lastUpdate).toBeNull()
    expect(auditCalls('payment.capture_booking_mismatch')).toHaveLength(1)
    expect(sendTableBookingDepositCapturedNotifications).not.toHaveBeenCalled()
  })

  it('refuses an order carrying no custom_id at all', async () => {
    mockDb([booking()])
    const o = order()
    delete (o.purchase_units[0] as { custom_id?: string }).custom_id
    vi.mocked(getPayPalOrder).mockResolvedValue(o as any)

    await GET(request())

    expect(lastUpdate).toBeNull()
    expect(auditCalls('payment.capture_booking_mismatch')).toHaveLength(1)
  })

  it.each(['USD', 'EUR'])('refuses a capture in %s, which would be stored as sterling', async (currency) => {
    mockDb([booking()])
    vi.mocked(getPayPalOrder).mockResolvedValue(order({ currency }) as any)

    await GET(request())

    expect(lastUpdate).toBeNull()
    expect(auditCalls('payment.capture_currency_mismatch')).toHaveLength(1)
  })

  it('refuses a capture for less than the booking owes', async () => {
    mockDb([booking()])
    vi.mocked(getPayPalOrder).mockResolvedValue(order({ amount: '5.00' }) as any)

    await GET(request())

    expect(lastUpdate).toBeNull()
    expect(auditCalls('payment.capture_amount_mismatch')).toHaveLength(1)
  })

  it('refuses a capture for more than the booking owes', async () => {
    mockDb([booking()])
    vi.mocked(getPayPalOrder).mockResolvedValue(order({ amount: '500.00' }) as any)

    await GET(request())

    expect(lastUpdate).toBeNull()
    expect(auditCalls('payment.capture_amount_mismatch')).toHaveLength(1)
  })

  it('honours a locked deposit, so a later party-size change cannot invalidate a paid figure', async () => {
    // deposit_amount_locked is what the guest was actually asked for.
    mockDb([booking({ party_size: 40, deposit_amount_locked: 100 })])
    vi.mocked(getPayPalOrder).mockResolvedValue(order({ amount: '100.00' }) as any)

    await GET(request())

    expect(lastUpdate).toMatchObject({ deposit_amount_locked: 100 })
    expect(auditCalls('payment.capture_amount_mismatch')).toHaveLength(0)
  })

  it('still ignores an order with no completed capture', async () => {
    mockDb([booking()])
    vi.mocked(getPayPalOrder).mockResolvedValue({
      status: 'APPROVED',
      purchase_units: [{ custom_id: BOOKING_ID, payments: { captures: [] } }],
    } as any)

    await GET(request())

    expect(lastUpdate).toBeNull()
    expect(auditCalls('payment.capture_booking_mismatch')).toHaveLength(0)
  })

  // BK-114: every case above leaves the booking a candidate, so the sweep used to write a fresh
  // audit row every hour for the same booking and tell nobody.
  it('tells a manager about a mismatched amount, once, with one audit row however many runs see it', async () => {
    mockDb([booking()])
    vi.mocked(getPayPalOrder).mockResolvedValue(order({ amount: '80.00' }) as any)

    await GET(request())
    expect(alertMoneyNeedsAPerson).toHaveBeenCalledTimes(1)
    expect(alertMoneyNeedsAPerson).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      domain: 'table_bookings',
      bookingId: BOOKING_ID,
      kind: 'capture_amount_mismatch',
    }))
    expect(auditCalls('payment.capture_amount_mismatch')).toHaveLength(1)

    // The next hour: the alert is already claimed, so neither an email nor another audit row.
    vi.mocked(alertMoneyNeedsAPerson).mockResolvedValueOnce({ sent: false, duplicate: true })
    await GET(request())
    expect(auditCalls('payment.capture_amount_mismatch')).toHaveLength(1)
  })

  // BK-047 (owner decision D19): a payment that lands after the booking closed used to mark it paid
  // and "confirmed", keep its cancelled stamps and send the guest a "deposit confirmed" message.
  it.each(['cancelled', 'no_show', 'completed'])(
    'never confirms a %s booking: hands the capture to the closed-booking settle step',
    async (status) => {
      mockDb([booking({ status })])
      vi.mocked(getPayPalOrder).mockResolvedValue(order() as any)

      const response = await GET(request())
      const body = await response.json()

      expect(lastUpdate).toBeNull()
      expect(sendTableBookingDepositCapturedNotifications).not.toHaveBeenCalled()
      expect(settleDepositOnClosedBooking).toHaveBeenCalledWith(expect.anything(), {
        bookingId: BOOKING_ID,
        captureId: 'CAPTURE-1',
        orderId: 'ORDER-1',
        amountGbp: 100,
        capturedAtIso: null,
        source: 'reconciliation_cron',
      })
      expect(body.needsAttention).toEqual(['TB-274EB223'])
    }
  )

  it('settles a closed booking whatever the captured amount, since all of it goes back', async () => {
    mockDb([booking({ status: 'cancelled' })])
    vi.mocked(getPayPalOrder).mockResolvedValue(order({ amount: '80.00' }) as any)

    await GET(request())

    expect(settleDepositOnClosedBooking).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ amountGbp: 80 }))
    expect(auditCalls('payment.capture_amount_mismatch')).toHaveLength(0)
  })

  it('looks for candidates by activity, not by when the booking was made', async () => {
    mockDb([])
    await GET(request())

    const chain = vi.mocked(createAdminClient).mock.results[0].value.from.mock.results[0].value
    expect(chain.gte).toHaveBeenCalledWith('updated_at', expect.any(String))
    expect(chain.gte).not.toHaveBeenCalledWith('created_at', expect.any(String))
  })
})
