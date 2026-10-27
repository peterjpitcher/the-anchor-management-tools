import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fakeSupabase'

const logAuditEvent = vi.fn(async () => undefined)
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: (...args: unknown[]) => logAuditEvent(...(args as [])) }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/table-bookings/paypal-deposit-reconcile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/table-bookings/paypal-deposit-reconcile')>()),
  reconcileTableDepositOrder: vi.fn(async () => ({ outcome: 'not_paid' })),
}))
// For the timeout cron run below.
vi.mock('@/lib/cron-auth', () => ({ authorizeCronRequest: vi.fn(() => ({ authorized: true })) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/table-bookings/bookings', () => ({
  sendTableBookingCancelledSmsIfAllowed: vi.fn(async () => ({ status: 'sent', channel: 'email', fallbackUsed: false, error: null })),
}))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: vi.fn() }))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn() }))
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: vi.fn(async () => false) }))

import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { reconcileTableDepositOrder } from '@/lib/table-bookings/paypal-deposit-reconcile'
import { runStaffDepositAction } from '@/lib/table-bookings/staff-deposit-actions'
import { hasUnpaidRequiredDeposit } from '@/lib/foh/bookings'
import { GET as runDepositTimeout } from '@/app/api/cron/table-booking-deposit-timeout/route'

/**
 * BK-045 (owner decision D18): once a booking owes a deposit, a manager can waive it, record it as
 * taken at the bar, or give the guest longer. Before this there was no way to do any of the three,
 * so a group paying at the bar could not be seated and the timeout cron cancelled them.
 */

const BOOKING_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const START = '2026-11-14T19:00:00.000Z'
const HOLD = '2026-11-02T10:00:00.000Z'

type Db = FakeSupabase & { rpc: ReturnType<typeof vi.fn> }

function seed(overrides: Record<string, unknown> = {}): Db {
  const db = createFakeSupabase({
    table_bookings: [{
      id: BOOKING_ID,
      booking_reference: 'TB-OWED',
      customer_id: 'customer-1',
      status: 'pending_payment',
      payment_status: 'pending',
      payment_method: null,
      paypal_deposit_order_id: null,
      paypal_deposit_capture_id: null,
      party_size: 16,
      committed_party_size: 16,
      deposit_amount: 160,
      deposit_amount_locked: null,
      deposit_waived: false,
      booking_type: 'regular',
      booking_date: '2026-11-14',
      booking_time: '19:00:00',
      hold_expires_at: HOLD,
      start_datetime: START,
      ...overrides,
    }],
    guest_tokens: [
      { id: 'token-1', table_booking_id: BOOKING_ID, action_type: 'payment', consumed_at: null, expires_at: HOLD },
      { id: 'token-2', table_booking_id: BOOKING_ID, action_type: 'manage', consumed_at: null, expires_at: START },
    ],
    booking_holds: [{ id: 'hold-1', table_booking_id: BOOKING_ID, hold_type: 'payment_hold', status: 'active', expires_at: HOLD }],
  }) as Db
  db.rpc = vi.fn(async (fn: string) =>
    fn === 'record_table_cash_deposit_v05'
      ? { data: { state: 'confirmed', table_booking_id: BOOKING_ID }, error: null }
      : { data: null, error: { message: `unexpected rpc ${fn}` } })
  return db
}

const row = (db: Db) => db.tables.table_bookings[0]
const token = (db: Db, id: string) => db.tables.guest_tokens.find((entry) => entry.id === id)

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-01T12:00:00.000Z'))
})
afterEach(() => vi.useRealTimers())

describe('waive', () => {
  it('confirms the booking with no deposit, stops the payment link and records why', async () => {
    const db = seed()

    const result = await runStaffDepositAction(db as never, {
      bookingId: BOOKING_ID,
      userId: 'manager-1',
      request: { action: 'waive', reason: 'Regulars, the landlord said so' },
    })

    expect(result).toEqual({ ok: true, message: 'Deposit of £160.00 waived.' })
    expect(row(db)).toMatchObject({
      status: 'confirmed',
      deposit_waived: true,
      deposit_rule: 'waived',
      payment_status: null,
      hold_expires_at: null,
      deposit_amount: null,
    })
    expect(token(db, 'token-1')?.consumed_at).toBeTruthy()
    expect(token(db, 'token-2')?.consumed_at).toBeNull()
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'manager-1',
      operation_type: 'table_booking.deposit_waived',
      additional_info: expect.objectContaining({ reason: 'manager_waiver', note: 'Regulars, the landlord said so' }),
    }))
    // The floor can now seat them.
    expect(hasUnpaidRequiredDeposit(row(db) as never)).toBe(false)
  })

  it('is skipped by the timeout cron once waived, though the old hold has passed', async () => {
    const db = seed({ hold_expires_at: '2026-11-01T10:00:00.000Z' })
    vi.mocked(createAdminClient).mockReturnValue(db as never)
    await runStaffDepositAction(db as never, { bookingId: BOOKING_ID, userId: 'manager-1', request: { action: 'waive', reason: 'Pub event' } })

    const response = await runDepositTimeout(new NextRequest('https://management.orangejelly.co.uk/api/cron/table-booking-deposit-timeout'))

    expect(response.status).toBe(200)
    expect(row(db).status).toBe('confirmed')
  })

  it('(control) the same lapsed hold, not waived, is cancelled by the cron', async () => {
    const db = seed({ hold_expires_at: '2026-11-01T10:00:00.000Z' })
    vi.mocked(createAdminClient).mockReturnValue(db as never)

    await runDepositTimeout(new NextRequest('https://management.orangejelly.co.uk/api/cron/table-booking-deposit-timeout'))

    expect(row(db).status).toBe('cancelled')
  })

  it('refuses a deposit that has already been paid', async () => {
    const db = seed({ paypal_deposit_capture_id: 'CAPTURE-1', payment_status: 'completed', status: 'confirmed' })

    const result = await runStaffDepositAction(db as never, { bookingId: BOOKING_ID, userId: 'manager-1', request: { action: 'waive', reason: 'Too late' } })

    expect(result).toEqual({ ok: false, status: 409, error: 'This booking has no unpaid deposit to settle.' })
    expect(row(db).deposit_waived).toBe(false)
  })
})

describe('deposit taken at the bar', () => {
  it('records the cash, locks the amount and confirms a booking waiting for its deposit', async () => {
    const db = seed()

    const result = await runStaffDepositAction(db as never, { bookingId: BOOKING_ID, userId: 'manager-1', request: { action: 'cash', reason: 'Card at the bar, Sam' } })

    expect(result).toMatchObject({ ok: true, message: '£160.00 deposit taken at the bar. The booking is confirmed.' })
    expect(db.rpc).toHaveBeenCalledWith('record_table_cash_deposit_v05', { p_table_booking_id: BOOKING_ID, p_amount: 160, p_currency: 'GBP' })
    expect(row(db)).toMatchObject({ payment_status: 'completed', payment_method: 'cash', deposit_amount_locked: 160, hold_expires_at: null })
    expect(hasUnpaidRequiredDeposit({ ...row(db), status: 'confirmed' } as never)).toBe(false)
  })

  it('marks a confirmed booking that owes its deposit (D20) as paid, then writes the cash row', async () => {
    const db = seed({ status: 'confirmed', hold_expires_at: START })

    const result = await runStaffDepositAction(db as never, { bookingId: BOOKING_ID, userId: 'manager-1', request: { action: 'cash', reason: 'Cash, Sam' } })

    expect(result).toMatchObject({ ok: true })
    expect(row(db)).toMatchObject({ status: 'confirmed', payment_status: 'completed', payment_method: 'cash', deposit_amount_locked: 160 })
    expect(db.rpc).toHaveBeenCalledWith('record_table_cash_deposit_v05', expect.objectContaining({ p_amount: 160 }))
    expect(token(db, 'token-1')?.consumed_at).toBeTruthy()
  })

  it('takes nothing when the guest has just paid online', async () => {
    const db = seed({ paypal_deposit_order_id: 'ORDER-1' })
    vi.mocked(reconcileTableDepositOrder).mockResolvedValueOnce({ outcome: 'recorded', amountGbp: 160 })

    const result = await runStaffDepositAction(db as never, { bookingId: BOOKING_ID, userId: 'manager-1', request: { action: 'cash', reason: 'Cash' } })

    expect(result).toMatchObject({ ok: false, status: 409 })
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('takes nothing when PayPal cannot be reached to check for an online payment', async () => {
    const db = seed({ paypal_deposit_order_id: 'ORDER-1' })
    vi.mocked(reconcileTableDepositOrder).mockResolvedValueOnce({ outcome: 'lookup_failed' })

    const result = await runStaffDepositAction(db as never, { bookingId: BOOKING_ID, userId: 'manager-1', request: { action: 'cash', reason: 'Cash' } })

    expect(result).toMatchObject({ ok: false, status: 503 })
    expect(db.rpc).not.toHaveBeenCalled()
    // The order stays on the booking, so the payment can still be found.
    expect(row(db)).toMatchObject({ paypal_deposit_order_id: 'ORDER-1', payment_status: 'pending', payment_method: null })
  })

  it('writes no cash row when the deposit was paid online after the booking was read', async () => {
    const db = seed({ paypal_deposit_order_id: 'ORDER-1' })
    // PayPal's capture lands between this request reading the booking and recording the cash.
    vi.mocked(reconcileTableDepositOrder).mockImplementationOnce(async () => {
      Object.assign(row(db), { status: 'confirmed', payment_status: 'completed', payment_method: 'paypal', paypal_deposit_capture_id: 'CAP-1' })
      return { outcome: 'not_paid' }
    })

    const result = await runStaffDepositAction(db as never, { bookingId: BOOKING_ID, userId: 'manager-1', request: { action: 'cash', reason: 'Cash' } })

    expect(result).toMatchObject({ ok: false, status: 409 })
    expect(db.rpc).not.toHaveBeenCalled()
    expect(row(db)).toMatchObject({ payment_method: 'paypal', paypal_deposit_order_id: 'ORDER-1' })
  })

  it('hands the claim back when the cash row cannot be written', async () => {
    const db = seed()
    db.rpc.mockResolvedValueOnce({ data: null, error: { message: 'connection reset' } })

    const result = await runStaffDepositAction(db as never, { bookingId: BOOKING_ID, userId: 'manager-1', request: { action: 'cash', reason: 'Cash' } })

    expect(result).toMatchObject({ ok: false, status: 500 })
    expect(row(db)).toMatchObject({ payment_status: 'pending', payment_method: null, deposit_amount_locked: null, hold_expires_at: HOLD })
  })
})

describe('give longer to pay', () => {
  it('moves the hold, and the guest\'s existing payment link with it', async () => {
    const db = seed()
    const newHold = '2026-11-10T18:00:00.000Z'

    const result = await runStaffDepositAction(db as never, {
      bookingId: BOOKING_ID,
      userId: 'manager-1',
      request: { action: 'extend', reason: 'Guest away until Monday', hold_until: newHold },
    })

    expect(result).toMatchObject({ ok: true })
    expect(row(db)).toMatchObject({ status: 'pending_payment', hold_expires_at: newHold })
    expect(token(db, 'token-1')?.expires_at).toBe(newHold)
    expect(token(db, 'token-2')?.expires_at).toBe(START)
    expect(db.tables.booking_holds[0].expires_at).toBe(newHold)
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'table_booking.deposit_hold_extended',
      old_values: { hold_expires_at: HOLD },
      new_values: { hold_expires_at: newHold },
    }))
  })

  it('never past the booking start, and never in the next few minutes', async () => {
    const db = seed()
    const later = await runStaffDepositAction(db as never, {
      bookingId: BOOKING_ID,
      userId: 'manager-1',
      request: { action: 'extend', reason: 'Too far', hold_until: '2026-11-15T10:00:00.000Z' },
    })
    const tooSoon = await runStaffDepositAction(db as never, {
      bookingId: BOOKING_ID,
      userId: 'manager-1',
      request: { action: 'extend', reason: 'Too soon', hold_until: '2026-11-01T12:05:00.000Z' },
    })

    expect(later).toMatchObject({ ok: false, status: 400 })
    expect(tooSoon).toMatchObject({ ok: false, status: 400 })
    expect(row(db).hold_expires_at).toBe(HOLD)
  })
})
