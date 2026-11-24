import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from '../../helpers/fakeSupabaseDb'

// Spec tasks/spec-2026-11-24-parking-change-time-and-settle.md, section 7: a booking can hold a
// second payment (a top-up after its dates grew). These run the real payment code against an
// in-memory database; only PayPal, the SMS sender and email are stand-ins.

vi.mock('@/lib/paypal', () => ({
  PAYPAL_DEFAULT_CURRENCY: 'GBP',
  createSimplePayPalOrder: vi.fn(),
  capturePayPalPayment: vi.fn(),
  getPayPalOrder: vi.fn(),
}))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn() }))
vi.mock('@/lib/parking/sms-safety', () => ({ resolveParkingSmsEligibility: vi.fn() }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
// notifyCustomer as it behaves for a customer with a usable address: email first, a text only
// without one (its own tests cover suppression, opt-outs and fallback).
vi.mock('@/lib/notifications/notify', () => ({
  notifyCustomer: vi.fn(async (input: { email?: Record<string, unknown> & { to?: string | null }; sms?: { to: string; body: string; options: unknown } }) => {
    const { sendEmail: email } = await import('@/lib/email/emailService')
    const { sendSMS: text } = await import('@/lib/twilio')
    if (input.email?.to) {
      const r = (await (email as unknown as (o: unknown) => Promise<{ success: boolean; messageId?: string }>)(input.email)) ?? { success: false }
      const attempt = { channel: 'email', success: r.success, code: null, logFailure: false, messageId: r.messageId ?? null, error: null }
      return { selectedChannels: ['email', 'sms'], attempts: [attempt], finalStatus: r.success ? 'sent' : 'failed', sentChannel: r.success ? 'email' : null, fallbackUsed: false }
    }
    const r = (await (text as unknown as (...a: unknown[]) => Promise<{ success: boolean; sid?: string }>)(input.sms?.to, input.sms?.body, input.sms?.options)) ?? { success: false }
    const attempt = { channel: 'sms', success: r.success, code: null, logFailure: false, messageId: r.sid ?? null, error: null }
    return { selectedChannels: ['sms'], attempts: [attempt], finalStatus: r.success ? 'sent' : 'failed', sentChannel: r.success ? 'sms' : null, fallbackUsed: false }
  }),
}))

import { capturePayPalPayment, createSimplePayPalOrder, getPayPalOrder } from '@/lib/paypal'
import { sendSMS } from '@/lib/twilio'
import { resolveParkingSmsEligibility } from '@/lib/parking/sms-safety'
import { sendEmail } from '@/lib/email/emailService'
import {
  captureParkingPayment,
  createParkingPaymentOrder,
  ParkingTopUpAmountChangedError,
  reconcileCapturedParkingPayment,
} from '@/lib/parking/payments'
import { enforcePendingPaymentRule, keepParkingBalanceAfterRefund, parkingAmountDue } from '@/lib/parking/payment-due'
import { handlePaymentCompleted, handlePaymentDenied } from '@/lib/paypal-domains/parking'
import type { ParkingBooking } from '@/types/parking'

const BOOKING_ID = 'booking-1'

function booking(overrides: Partial<ParkingBooking> = {}): ParkingBooking {
  return {
    id: BOOKING_ID,
    reference: 'PAR-20261201-0001',
    customer_id: 'customer-1',
    customer_first_name: 'Sam',
    customer_last_name: 'Jones',
    customer_mobile: '+447700900123',
    customer_email: 'sam@example.com',
    vehicle_registration: 'AB12CDE',
    start_at: '2026-12-01T10:00:00.000Z',
    end_at: '2026-12-10T10:00:00.000Z',
    duration_minutes: 9 * 24 * 60,
    calculated_price: 105,
    override_price: null,
    status: 'confirmed',
    payment_status: 'paid',
    payment_due_at: '2026-09-02T10:00:00.000Z',
    updated_at: '2026-09-01T09:00:00.000Z',
    ...overrides,
  } as ParkingBooking
}

function paidRow(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  }
}

function pendingTopUp(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay-topup',
    booking_id: BOOKING_ID,
    status: 'pending',
    amount: 30,
    currency: 'GBP',
    provider: 'paypal',
    transaction_id: null,
    paypal_order_id: 'ORDER-TOPUP',
    paid_at: null,
    created_at: '2026-09-02T09:00:00.000Z',
    metadata: { approve_url: 'https://paypal.test/approve/topup', purpose: 'top_up' },
    ...overrides,
  }
}

function seed(rows: { booking?: ParkingBooking; payments?: Record<string, unknown>[]; refunds?: Record<string, unknown>[] } = {}): FakeDb {
  return createFakeDb({
    parking_bookings: [{ ...(rows.booking ?? booking()) }],
    parking_booking_payments: (rows.payments ?? [paidRow(), pendingTopUp()]).map((row) => ({ ...row })),
    payment_refunds: (rows.refunds ?? []).map((row) => ({ ...row })),
    parking_booking_notifications: [],
  })
}

function paymentsOf(db: FakeDb) {
  return db.rows('parking_booking_payments')
}

function orderFor(amount: number, customId = BOOKING_ID) {
  return { status: 'APPROVED', purchase_units: [{ custom_id: customId, amount: { value: amount.toFixed(2), currency_code: 'GBP' } }] }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveParkingSmsEligibility).mockResolvedValue({ allowed: true } as never)
  vi.mocked(sendSMS).mockResolvedValue({ success: true, sid: 'SM1' } as never)
  vi.mocked(sendEmail).mockResolvedValue({ success: true } as never)
})

describe('parkingAmountDue', () => {
  it('is the whole price for a booking waiting for its first payment', () => {
    expect(parkingAmountDue(booking({ status: 'pending_payment', payment_status: 'pending' }), [], [])).toEqual({
      amount: 105,
      purpose: 'booking',
    })
  })

  it('is the positive balance for a confirmed, paid booking', () => {
    expect(parkingAmountDue(booking(), [paidRow()], [])).toEqual({ amount: 30, purpose: 'top_up' })
  })

  it('is nothing for a settled, refund-due, cancelled or completed booking', () => {
    expect(parkingAmountDue(booking({ calculated_price: 75 }), [paidRow()], [])).toBeNull()
    expect(parkingAmountDue(booking({ calculated_price: 60 }), [paidRow()], [])).toBeNull()
    expect(parkingAmountDue(booking({ status: 'cancelled' }), [paidRow()], [])).toBeNull()
    expect(parkingAmountDue(booking({ status: 'completed' }), [paidRow()], [])).toBeNull()
  })
})

describe('the pending-payment rule', () => {
  it('keeps a pending top-up for exactly the balance', async () => {
    const db = seed()
    const result = await enforcePendingPaymentRule(db.client as never, booking())
    expect(result.pending?.id).toBe('pay-topup')
    expect(result.expired).toEqual([])
  })

  it('expires a top-up link once the balance has changed', async () => {
    const db = seed({ booking: booking({ calculated_price: 90 }) })
    const result = await enforcePendingPaymentRule(db.client as never, booking({ calculated_price: 90 }))
    expect(result.due).toEqual({ amount: 15, purpose: 'top_up' })
    expect(result.pending).toBeNull()
    expect(paymentsOf(db).find((row) => row.id === 'pay-topup')?.status).toBe('expired')
  })

  it('expires a top-up link once nothing is owed (paid at the venue or waived)', async () => {
    const settled = booking({ override_price: 75 })
    const db = seed({ booking: settled })
    const result = await enforcePendingPaymentRule(db.client as never, settled)
    expect(result.due).toBeNull()
    expect(paymentsOf(db).find((row) => row.id === 'pay-topup')?.status).toBe('expired')
    // The paid row is never touched.
    expect(paymentsOf(db).find((row) => row.id === 'pay-first')?.status).toBe('paid')
  })
})

describe('createParkingPaymentOrder', () => {
  beforeEach(() => {
    vi.mocked(createSimplePayPalOrder).mockResolvedValue({ orderId: 'ORDER-NEW', approveUrl: 'https://paypal.test/approve/new' } as never)
  })

  it('reuses a pending order only when it is for the same amount', async () => {
    const db = seed()
    const result = await createParkingPaymentOrder(booking(), {
      returnUrl: 'r',
      cancelUrl: 'c',
      client: db.client as never,
      amount: 30,
      purpose: 'top_up',
    })
    expect(result.approveUrl).toBe('https://paypal.test/approve/topup')
    expect(createSimplePayPalOrder).not.toHaveBeenCalled()
  })

  it('retires a pending order for an old amount and makes one for the new amount', async () => {
    const db = seed()
    const result = await createParkingPaymentOrder(booking({ calculated_price: 90 }), {
      returnUrl: 'r',
      cancelUrl: 'c',
      client: db.client as never,
      amount: 15,
      purpose: 'top_up',
    })
    expect(result.approveUrl).toBe('https://paypal.test/approve/new')
    expect(vi.mocked(createSimplePayPalOrder).mock.calls[0][0]).toMatchObject({ amount: 15, customId: BOOKING_ID })
    const rows = paymentsOf(db)
    expect(rows.find((row) => row.id === 'pay-topup')?.status).toBe('expired')
    const fresh = rows.find((row) => row.paypal_order_id === 'ORDER-NEW')
    expect(fresh).toMatchObject({ status: 'pending', amount: 15 })
    // A top-up has no offer deadline: its row lapses at the end of the stay.
    expect(fresh?.expires_at).toBe('2026-12-10T10:00:00.000Z')
    expect((fresh?.metadata as Record<string, unknown>).purpose).toBe('top_up')
  })

  it('still charges the whole price for a booking waiting for its first payment', async () => {
    const unpaid = booking({ status: 'pending_payment', payment_status: 'pending' })
    const db = seed({ booking: unpaid, payments: [] })
    await createParkingPaymentOrder(unpaid, { returnUrl: 'r', cancelUrl: 'c', client: db.client as never })
    expect(vi.mocked(createSimplePayPalOrder).mock.calls[0][0]).toMatchObject({ amount: 105 })
    expect(paymentsOf(db)[0]).toMatchObject({ status: 'pending', amount: 105, expires_at: unpaid.payment_due_at })
  })
})

describe('captureParkingPayment on a top-up', () => {
  beforeEach(() => {
    vi.mocked(getPayPalOrder).mockResolvedValue(orderFor(30) as never)
    vi.mocked(capturePayPalPayment).mockResolvedValue({ transactionId: 'CAPTURE-TOPUP', amount: '30.00' } as never)
  })

  it('captures it, marks the row paid, leaves the booking alone and sends the top-up receipt', async () => {
    const db = seed()
    const result = await captureParkingPayment(booking(), 'ORDER-TOPUP', { client: db.client as never })

    expect(result.status).toBe('confirmed')
    expect(paymentsOf(db).find((row) => row.id === 'pay-topup')).toMatchObject({ status: 'paid', transaction_id: 'CAPTURE-TOPUP' })
    // Status, confirmation time and reminder flags: nothing written to the booking.
    expect(db.writes.filter((write) => write.table === 'parking_bookings')).toEqual([])
    // The customer has an email address, so the receipt goes by email and no text is sent.
    expect(sendSMS).not.toHaveBeenCalled()
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const sent = vi.mocked(sendEmail).mock.calls[0][0] as unknown as Record<string, unknown>
    expect(sent).toMatchObject({ to: 'sam@example.com', subject: 'Thanks for your payment, PAR-20261201-0001', parkingBookingId: BOOKING_ID })
    expect(String(sent.text)).toContain('thanks, we have your payment of £30.00')
    expect(String(sent.text)).not.toContain('confirmed')
    expect(sent.metadata).toMatchObject({ event_type: 'top_up_received', payment_id: 'pay-topup' })
    expect(String(sent.idempotencyKey)).toContain('payment_id=pay-topup')
    const logged = db.rows('parking_booking_notifications')
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatchObject({ event_type: 'top_up_received', status: 'sent', channel: 'email' })
  })

  it('refuses, taking no money, when the link no longer matches what is owed', async () => {
    const settled = booking({ override_price: 75 })
    const db = seed({ booking: settled })
    await expect(captureParkingPayment(settled, 'ORDER-TOPUP', { client: db.client as never })).rejects.toBeInstanceOf(
      ParkingTopUpAmountChangedError
    )
    expect(capturePayPalPayment).not.toHaveBeenCalled()
    expect(paymentsOf(db).find((row) => row.id === 'pay-topup')?.status).toBe('expired')
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('still records the money when the link was retired while the customer was at PayPal', async () => {
    const db = seed()
    // Staff record the debt as paid at the venue just after the pre-capture check.
    let retired = false
    db.beforeUpdate((table, matched) => {
      if (!retired && table === 'parking_booking_payments' && matched.some((row) => row.id === 'pay-topup' && row.status === 'pending')) {
        const row = db.rows('parking_booking_payments').find((candidate) => candidate.id === 'pay-topup')
        if (row && vi.mocked(capturePayPalPayment).mock.calls.length > 0) {
          row.status = 'expired'
          retired = true
        }
      }
    })
    await captureParkingPayment(booking(), 'ORDER-TOPUP', { client: db.client as never })
    const row = paymentsOf(db).find((candidate) => candidate.id === 'pay-topup')
    expect(row).toMatchObject({ status: 'paid', transaction_id: 'CAPTURE-TOPUP' })
    expect((row?.metadata as Record<string, unknown>).recorded_after_expiry).toBe(true)
  })

  it('a first payment still confirms the booking and sends the confirmation (website path)', async () => {
    const unpaid = booking({ status: 'pending_payment', payment_status: 'pending', calculated_price: 75 })
    const db = seed({ booking: unpaid, payments: [paidRow({ status: 'pending', transaction_id: null, paid_at: null })] })
    vi.mocked(getPayPalOrder).mockResolvedValue(orderFor(75) as never)
    vi.mocked(capturePayPalPayment).mockResolvedValue({ transactionId: 'CAPTURE-FIRST', amount: '75.00' } as never)

    const result = await captureParkingPayment(unpaid, 'ORDER-FIRST', { client: db.client as never })

    expect(result).toMatchObject({ status: 'confirmed', payment_status: 'paid' })
    const subjects = vi.mocked(sendEmail).mock.calls.map((call) => (call[0] as unknown as { subject: string }).subject)
    expect(subjects).toContain('Your parking is confirmed, PAR-20261201-0001')
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('texts the receipt to a customer with no email address', async () => {
    const noEmail = booking({ customer_email: null })
    const db = seed({ booking: noEmail })
    await captureParkingPayment(noEmail, 'ORDER-TOPUP', { client: db.client as never })
    expect(sendEmail).not.toHaveBeenCalled()
    const [, body, options] = vi.mocked(sendSMS).mock.calls[0]
    expect(body).toContain('thanks, we have your £30.00')
    expect((options as { metadata: Record<string, unknown> }).metadata).toMatchObject({ event_type: 'top_up_received', payment_id: 'pay-topup' })
    expect(db.rows('parking_booking_notifications')[0]).toMatchObject({ channel: 'sms', status: 'sent' })
  })
})

describe('reconcileCapturedParkingPayment on a top-up', () => {
  it('records a top-up PayPal took, sends the receipt and leaves the booking status alone', async () => {
    const db = seed()
    vi.mocked(getPayPalOrder).mockResolvedValue({
      status: 'COMPLETED',
      purchase_units: [
        {
          custom_id: BOOKING_ID,
          payments: { captures: [{ id: 'CAPTURE-TOPUP', amount: { value: '30.00', currency_code: 'GBP' } }] },
        },
      ],
    } as never)

    const result = await reconcileCapturedParkingPayment(booking(), 'ORDER-TOPUP', { client: db.client as never })

    expect(result?.status).toBe('confirmed')
    expect(paymentsOf(db).find((row) => row.id === 'pay-topup')).toMatchObject({ status: 'paid', transaction_id: 'CAPTURE-TOPUP' })
    expect(db.writes.filter((write) => write.table === 'parking_bookings')).toEqual([])
    expect(String((vi.mocked(sendEmail).mock.calls[0][0] as unknown as { text: string }).text)).toContain('£30.00')
  })
})

describe('the PayPal webhook with two payments on a booking', () => {
  function captureEvent(captureId: string, orderId: string, amount: number) {
    return {
      id: `WH-${captureId}`,
      resource: {
        id: captureId,
        custom_id: BOOKING_ID,
        amount: { value: amount.toFixed(2), currency_code: 'GBP' },
        supplementary_data: { related_ids: { order_id: orderId } },
      },
    }
  }

  it('a late event for the first payment, after a top-up exists, is placed on its own row and changes nothing', async () => {
    const db = seed()
    db.rows('audit_logs')
    await expect(handlePaymentCompleted(db.client as never, captureEvent('CAPTURE-FIRST', 'ORDER-FIRST', 75))).resolves.toBeUndefined()
    expect(paymentsOf(db).find((row) => row.id === 'pay-topup')?.status).toBe('pending')
    expect(db.writes.filter((write) => write.table === 'parking_bookings')).toEqual([])
  })

  it('a completed top-up capture marks its own row paid and leaves the booking status alone', async () => {
    const db = seed()
    await handlePaymentCompleted(db.client as never, captureEvent('CAPTURE-TOPUP', 'ORDER-TOPUP', 30))
    expect(paymentsOf(db).find((row) => row.id === 'pay-topup')).toMatchObject({ status: 'paid', transaction_id: 'CAPTURE-TOPUP' })
    expect(paymentsOf(db).find((row) => row.id === 'pay-first')?.status).toBe('paid')
    expect(db.writes.filter((write) => write.table === 'parking_bookings')).toEqual([])
  })

  it('an event it cannot place is acknowledged, not thrown', async () => {
    const db = seed()
    await expect(handlePaymentCompleted(db.client as never, captureEvent('CAPTURE-ELSE', 'ORDER-ELSE', 12))).resolves.toBeUndefined()
    expect(db.writes).toEqual([])
  })

  it('a late denial for the first order never fails the pending top-up', async () => {
    const db = seed()
    await handlePaymentDenied(db.client as never, {
      id: 'WH-DENIED',
      resource: { custom_id: BOOKING_ID, supplementary_data: { related_ids: { order_id: 'ORDER-FIRST' } } },
    })
    expect(paymentsOf(db).find((row) => row.id === 'pay-topup')?.status).toBe('pending')
    expect(db.rows('parking_bookings')[0].payment_status).toBe('paid')
  })
})

describe('keepParkingBalanceAfterRefund', () => {
  const refund = (amount: number) => ({ source_type: 'parking', source_id: 'pay-first', amount, status: 'completed' })

  it('a goodwill refund on a settled booking lowers the price, so nothing reads as owed', async () => {
    const settled = booking({ calculated_price: 75 })
    const db = seed({ booking: settled, payments: [paidRow()], refunds: [refund(5)] })
    expect(await keepParkingBalanceAfterRefund(db.client as never, { paymentId: 'pay-first', refundAmount: 5 })).toBe(true)
    expect(db.rows('parking_bookings')[0]).toMatchObject({ override_price: 70 })
  })

  it('a refund that pays off a refund due changes nothing', async () => {
    const due = booking({ calculated_price: 70 })
    const db = seed({ booking: due, payments: [paidRow()], refunds: [refund(5)] })
    expect(await keepParkingBalanceAfterRefund(db.client as never, { paymentId: 'pay-first', refundAmount: 5 })).toBe(false)
    expect(db.rows('parking_bookings')[0].override_price).toBeNull()
  })

  it('a refund larger than the refund due lowers the price by the excess only', async () => {
    const due = booking({ calculated_price: 70 })
    const db = seed({ booking: due, payments: [paidRow()], refunds: [refund(8)] })
    await keepParkingBalanceAfterRefund(db.client as never, { paymentId: 'pay-first', refundAmount: 8 })
    expect(db.rows('parking_bookings')[0].override_price).toBe(67)
  })

  it('a goodwill refund while a top-up is owed keeps the top-up owed', async () => {
    const db = seed({ payments: [paidRow()], refunds: [refund(5)] })
    await keepParkingBalanceAfterRefund(db.client as never, { paymentId: 'pay-first', refundAmount: 5 })
    // £105 price, £70 net paid: lowered to £100, so the £30 top-up is still owed.
    expect(db.rows('parking_bookings')[0].override_price).toBe(100)
  })

  it('leaves a cancelled booking alone', async () => {
    const cancelled = booking({ status: 'cancelled', calculated_price: 75 })
    const db = seed({ booking: cancelled, payments: [paidRow()], refunds: [refund(5)] })
    expect(await keepParkingBalanceAfterRefund(db.client as never, { paymentId: 'pay-first', refundAmount: 5 })).toBe(false)
  })
})
