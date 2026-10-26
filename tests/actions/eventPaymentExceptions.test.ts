import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../helpers/fakeSupabase'

/**
 * BK-018: open payment exceptions (PayPal took the money, the booking could not be confirmed)
 * were written and never read. A manager now confirms the booking anyway or refunds it from the
 * event page; either way the exception is resolved with who and when.
 */

const state = vi.hoisted(() => ({ db: null as unknown, user: { id: 'manager-1', email: 'boss@example.test' }, roles: ['manager'] }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.db }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn(async () => true) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn(async () => undefined) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example.test' }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/events/manage-booking', () => ({ processEventRefund: vi.fn() }))
vi.mock('@/lib/events/event-payments', () => ({ sendEventPaymentConfirmationSms: vi.fn(async () => ({ success: true })) }))
vi.mock('@/lib/email/event-ticket-emails', () => ({
  sendEventPaymentConfirmationEmail: vi.fn(async () => ({ success: true })),
  sendEventBookingCancelledEmail: vi.fn(async () => ({ success: true })),
}))
vi.mock('@/lib/events/payment-alerts', () => ({ alertEventPaymentNeedsAPerson: vi.fn(async () => undefined) }))

import { resolveEventPaymentException } from '@/app/actions/event-payment-exceptions'
import { processEventRefund } from '@/lib/events/manage-booking'
import { sendEventPaymentConfirmationSms } from '@/lib/events/event-payments'
import { sendEventBookingCancelledEmail, sendEventPaymentConfirmationEmail } from '@/lib/email/event-ticket-emails'
import { alertEventPaymentNeedsAPerson } from '@/lib/events/payment-alerts'

const EXCEPTION = '1e0e5be9-7f27-4c6b-8f36-0d0f2e2b6c01'
const BOOKING = '2e0e5be9-7f27-4c6b-8f36-0d0f2e2b6c02'

function seed(bookingStatus = 'pending_payment') {
  const db = createFakeSupabase({
    event_payment_exceptions: [{ id: EXCEPTION, event_booking_id: BOOKING, reason: 'capacity_unavailable_after_capture', status: 'open' }],
    bookings: [{ id: BOOKING, event_id: 'event-1', customer_id: 'customer-1', seats: 2, status: bookingStatus, hold_expires_at: '2026-10-26T10:00:00.000Z' }],
    payments: [{ id: 'payment-1', event_booking_id: BOOKING, charge_type: 'prepaid_event', status: 'succeeded', amount: 80 }],
    booking_holds: [{ id: 'hold-1', event_booking_id: BOOKING, hold_type: 'payment_hold', status: 'active' }],
    table_bookings: [],
  })
  ;(db as unknown as { rpc: unknown }).rpc = vi.fn(async () => ({ data: state.roles.map((role_name) => ({ role_name })), error: null }))
  state.db = db
  return db
}

beforeEach(() => {
  vi.clearAllMocks()
  state.user = { id: 'manager-1', email: 'boss@example.test' }
  state.roles = ['manager']
})

describe('resolveEventPaymentException', () => {
  it('only lets a manager decide', async () => {
    const db = seed()
    state.roles = ['staff']

    const result = await resolveEventPaymentException({ exceptionId: EXCEPTION, resolution: 'confirmed' })

    expect(result).toEqual({ error: 'Only a manager can resolve a paid booking that needs action.' })
    expect(db.tables.bookings[0].status).toBe('pending_payment')
  })

  it('confirms the booking anyway, resolves the exception with who and when, and tells the guest', async () => {
    const db = seed()

    const result = await resolveEventPaymentException({ exceptionId: EXCEPTION, resolution: 'confirmed' })

    expect(result).toEqual({ success: true, data: { resolution: 'confirmed' } })
    expect(db.tables.bookings[0]).toMatchObject({ status: 'confirmed', hold_expires_at: null })
    expect(db.tables.booking_holds[0].status).toBe('consumed')
    expect(db.tables.event_payment_exceptions[0]).toMatchObject({
      status: 'resolved', resolution: 'confirmed', resolved_by: 'manager-1', resolved_at: expect.any(String),
    })
    expect(sendEventPaymentConfirmationSms).toHaveBeenCalledTimes(1)
    expect(sendEventPaymentConfirmationEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ bookingId: BOOKING, amount: 80 }))
  })

  it('refunds what was paid once per exception, cancels the booking and resolves the exception', async () => {
    const db = seed()
    vi.mocked(processEventRefund).mockResolvedValue({ status: 'succeeded', amount: 80, currency: 'GBP' })

    const result = await resolveEventPaymentException({ exceptionId: EXCEPTION, resolution: 'refunded' })

    expect(result).toEqual({ success: true, data: { resolution: 'refunded', refundAmount: 80, refundStatus: 'succeeded' } })
    expect(processEventRefund).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      bookingId: BOOKING,
      amount: 80,
      metadata: expect.objectContaining({ idempotency_key: `payment-exception-refund:${EXCEPTION}` }),
    }))
    expect(db.tables.bookings[0].status).toBe('cancelled')
    expect(db.tables.event_payment_exceptions[0]).toMatchObject({ status: 'resolved', resolution: 'refunded', resolved_by: 'manager-1' })
    expect(sendEventBookingCancelledEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ bookingId: BOOKING, refundStatus: 'succeeded', paymentTaken: true }))
  })

  it('leaves the booking and the exception as they are, and tells a manager, when the refund does not go through', async () => {
    const db = seed()
    vi.mocked(processEventRefund).mockResolvedValue({ status: 'failed', amount: 80, currency: 'GBP', reason: 'paypal_refund_failed' })

    const result = await resolveEventPaymentException({ exceptionId: EXCEPTION, resolution: 'refunded' })

    expect(result.error).toContain('The refund did not go through')
    expect(db.tables.bookings[0].status).toBe('pending_payment')
    expect(db.tables.event_payment_exceptions[0].status).toBe('open')
    expect(alertEventPaymentNeedsAPerson).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ bookingId: BOOKING, kind: 'refund_failed' }))
  })

  it('refuses an exception that is already resolved', async () => {
    const db = seed()
    db.tables.event_payment_exceptions[0].status = 'resolved'

    const result = await resolveEventPaymentException({ exceptionId: EXCEPTION, resolution: 'confirmed' })

    expect(result).toEqual({ error: 'This has already been resolved.' })
  })
})
