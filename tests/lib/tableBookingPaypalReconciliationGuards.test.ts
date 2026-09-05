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
      for (const m of ['select', 'not', 'is', 'gte', 'limit', 'eq', 'neq']) {
        chain[m] = vi.fn().mockReturnValue(chain)
      }
      ;(chain as any).then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null })
      chain.update = vi.fn((payload: Record<string, unknown>) => {
        lastUpdate = payload
        const u: Record<string, unknown> = {}
        for (const m of ['eq', 'is', 'neq', 'select']) u[m] = vi.fn().mockReturnValue(u)
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
})
