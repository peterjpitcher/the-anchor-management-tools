import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

// Spec tasks/spec-2026-11-24-parking-change-time-and-settle.md, section 7: Send payment link and
// Mark paid on a confirmed booking that owes a balance, run against an in-memory database.

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/current-user', () => ({ getCurrentUser: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example.test' }))
vi.mock('@/lib/paypal', () => ({
  PAYPAL_DEFAULT_CURRENCY: 'GBP',
  createSimplePayPalOrder: vi.fn(),
  capturePayPalPayment: vi.fn(),
  getPayPalOrder: vi.fn(),
}))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { checkUserPermission } from '@/app/actions/rbac'
import { getCurrentUser } from '@/lib/supabase/current-user'
import { createAdminClient } from '@/lib/supabase/admin'
import { createSimplePayPalOrder } from '@/lib/paypal'
import { sendSMS } from '@/lib/twilio'
import { generateParkingPaymentLink, markParkingBookingPaid } from '@/app/actions/parking'

const BOOKING_ID = 'booking-1'

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING_ID,
    reference: 'PAR-20261201-0001',
    customer_id: 'customer-1',
    customer_first_name: 'Sam',
    customer_mobile: '+447700900123',
    start_at: '2026-12-01T10:00:00.000Z',
    end_at: '2026-12-10T10:00:00.000Z',
    calculated_price: 105,
    override_price: null,
    status: 'confirmed',
    payment_status: 'paid',
    payment_due_at: '2026-09-02T10:00:00.000Z',
    expires_at: '2026-09-02T10:00:00.000Z',
    updated_at: '2026-09-01T09:00:00.000Z',
    ...overrides,
  }
}

const firstPayment = {
  id: 'pay-first',
  booking_id: BOOKING_ID,
  status: 'paid',
  amount: 75,
  currency: 'GBP',
  provider: 'paypal',
  transaction_id: 'CAPTURE-FIRST',
  paypal_order_id: 'ORDER-FIRST',
  paid_at: '2026-09-01T09:00:00.000Z',
  created_at: '2026-09-01T09:00:00.000Z',
  metadata: {},
}

const pendingTopUp = {
  id: 'pay-topup',
  booking_id: BOOKING_ID,
  status: 'pending',
  amount: 30,
  currency: 'GBP',
  provider: 'paypal',
  paypal_order_id: 'ORDER-TOPUP',
  created_at: '2026-09-02T09:00:00.000Z',
  metadata: { approve_url: 'https://paypal.test/approve/topup', purpose: 'top_up' },
}

let db: FakeDb

function seed(booking = bookingRow(), payments: Record<string, unknown>[] = [firstPayment]) {
  db = createFakeDb({
    parking_bookings: [{ ...booking }],
    parking_booking_payments: payments.map((row) => ({ ...row })),
    payment_refunds: [],
  })
  ;(createAdminClient as unknown as Mock).mockReturnValue(db.client)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(checkUserPermission as unknown as Mock).mockResolvedValue(true)
  ;(getCurrentUser as unknown as Mock).mockResolvedValue({ user: { id: 'user-1' } })
  vi.mocked(createSimplePayPalOrder).mockResolvedValue({ orderId: 'ORDER-NEW', approveUrl: 'https://paypal.test/approve/new' } as never)
})

describe('generateParkingPaymentLink on a confirmed booking with a balance', () => {
  it('charges the balance only and never touches the booking status or deadline', async () => {
    seed()
    const result = await generateParkingPaymentLink(BOOKING_ID)

    expect(result).toMatchObject({ success: true, approveUrl: 'https://paypal.test/approve/new', amount: 30 })
    expect(vi.mocked(createSimplePayPalOrder).mock.calls[0][0]).toMatchObject({ amount: 30 })
    // A fresh PayPal request id, so PayPal cannot hand back the booking's first order.
    const requestId = vi.mocked(createSimplePayPalOrder).mock.calls[0][0].requestId
    expect(requestId).not.toBe(`parking-${BOOKING_ID}`)
    expect(requestId).toMatch(new RegExp(`^parking-${BOOKING_ID}-\\d+-3000$`))
    const saved = db.rows('parking_bookings')[0]
    expect(saved).toMatchObject({ status: 'confirmed', payment_status: 'paid', payment_due_at: '2026-09-02T10:00:00.000Z' })
    expect(db.writes.filter((write) => write.table === 'parking_bookings')).toEqual([])
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('refuses when nothing is owed', async () => {
    seed(bookingRow({ calculated_price: 75 }))
    const result = await generateParkingPaymentLink(BOOKING_ID)
    expect(result.error).toMatch(/Nothing is owed/)
    expect(createSimplePayPalOrder).not.toHaveBeenCalled()
  })
})

describe('markParkingBookingPaid', () => {
  it('records the balance as a manual top-up, retires the PayPal link and never rewrites the paid row', async () => {
    seed(bookingRow(), [firstPayment, pendingTopUp])
    const result = await markParkingBookingPaid(BOOKING_ID, { method: 'card_terminal' })

    expect(result).toMatchObject({ success: true, amount: 30 })
    const rows = db.rows('parking_booking_payments')
    expect(rows.find((row) => row.id === 'pay-first')).toMatchObject({ status: 'paid', amount: 75, provider: 'paypal' })
    expect(rows.find((row) => row.id === 'pay-topup')?.status).toBe('expired')
    const manual = rows.find((row) => row.provider === 'manual')
    expect(manual).toMatchObject({ status: 'paid', amount: 30 })
    expect((manual?.metadata as Record<string, unknown>)).toMatchObject({ method: 'card_terminal', purpose: 'top_up', settled_by: 'user-1' })
    expect(db.rows('parking_bookings')[0]).toMatchObject({ status: 'confirmed', payment_status: 'paid' })
  })

  it('a second press records nothing', async () => {
    seed()
    const first = await markParkingBookingPaid(BOOKING_ID)
    expect(first.success).toBe(true)
    const second = await markParkingBookingPaid(BOOKING_ID)
    expect(second.error).toMatch(/Nothing is owed/)
    expect(db.rows('parking_booking_payments').filter((row) => row.provider === 'manual')).toHaveLength(1)
  })

  it('a second request that reads the booking after the first one claimed it records nothing', async () => {
    seed()
    // The review's case: the other request's venue payment lands after our claim and before we
    // check what is still owed.
    let interleaved = false
    db.beforeUpdate((table) => {
      if (table === 'parking_bookings' && !interleaved) {
        interleaved = true
        db.rows('parking_booking_payments').push({
          id: 'pay-other-venue',
          booking_id: BOOKING_ID,
          status: 'paid',
          amount: 30,
          currency: 'GBP',
          provider: 'manual',
          paid_at: '2026-09-02T10:00:00.000Z',
          created_at: '2026-09-02T10:00:00.000Z',
          metadata: { manual_settlement: true, purpose: 'top_up' },
        })
      }
    })
    const result = await markParkingBookingPaid(BOOKING_ID)
    expect(result.error).toMatch(/just been paid/)
    const manualPaid = db.rows('parking_booking_payments').filter((row) => row.provider === 'manual' && row.status === 'paid')
    expect(manualPaid.map((row) => row.id)).toEqual(['pay-other-venue'])
    expect(db.rows('parking_booking_payments').some((row) => row.provider === 'manual' && row.status === 'pending')).toBe(false)
  })

  it('refuses when the booking changed after it was read', async () => {
    seed()
    // Another writer gets in between the read and the claim.
    db.beforeUpdate((table, matched) => {
      if (table === 'parking_bookings' && matched.length > 0) matched[0].updated_at = '2026-09-03T00:00:00.000Z'
    })
    const result = await markParkingBookingPaid(BOOKING_ID)
    expect(result.error).toMatch(/just changed/)
    expect(db.rows('parking_booking_payments').filter((row) => row.provider === 'manual')).toHaveLength(0)
  })

  it('an unpaid booking records its whole price as a manual payment and is confirmed', async () => {
    const unpaid = bookingRow({ status: 'pending_payment', payment_status: 'pending', calculated_price: 45 })
    seed(unpaid, [{ ...pendingTopUp, amount: 45, metadata: { approve_url: 'x', purpose: 'booking' } }])
    const result = await markParkingBookingPaid(BOOKING_ID)
    expect(result.success).toBe(true)
    const rows = db.rows('parking_booking_payments')
    expect(rows.find((row) => row.id === 'pay-topup')?.status).toBe('expired')
    expect(rows.find((row) => row.provider === 'manual')).toMatchObject({ status: 'paid', amount: 45 })
    expect(db.rows('parking_bookings')[0]).toMatchObject({ status: 'confirmed', payment_status: 'paid' })
  })
})
