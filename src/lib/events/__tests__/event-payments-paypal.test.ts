import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The code that takes a guest's money for event tickets, run for real against a fake database
 * and a mocked PayPal (BK-124, customer bookings review of 24 October 2026). Every earlier test
 * swapped this module for a fake, so the amount checks, the recovery from a double capture and
 * the confirm step had never run under test.
 */

const paypal = vi.hoisted(() => ({
  capturePayPalPayment: vi.fn(),
  createInlinePayPalOrder: vi.fn(),
  getPayPalOrder: vi.fn(),
  isPayPalOrderAlreadyCapturedError: vi.fn((error: unknown) => (error as { alreadyCaptured?: boolean })?.alreadyCaptured === true),
  isPayPalOrderNotFoundError: vi.fn(() => false),
}))
vi.mock('@/lib/paypal', () => paypal)

const log = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: log }))

vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example.test' }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn() }))
vi.mock('@/lib/events/manage-booking', () => ({ createEventManageToken: vi.fn() }))
// No booking items: the charge is the event price times the seats (the single-ticket path).
vi.mock('@/lib/events/ticket-type-queries', () => ({
  loadBookingItems: vi.fn(async () => []),
  loadBookingItemsWithTypes: vi.fn(async () => new Map()),
  getDefaultTicketTypeId: vi.fn(async () => null),
  bookingItemsAreMultiType: vi.fn(() => false),
}))

import {
  captureEventPayPalOrderByBookingId,
  captureEventPayPalOrderByRawToken,
  createEventPayPalOrderByBookingId,
} from '@/lib/events/event-payments'
import { hashGuestToken } from '@/lib/guest/tokens'

const BOOKING = '11111111-1111-4111-8111-111111111111'
const CUSTOMER = '22222222-2222-4222-8222-222222222222'
const EVENT = '33333333-3333-4333-8333-333333333333'
const ORDER = 'ORDER-1'

type Filter = [string, string, unknown]
type Call = { table: string; action: 'select' | 'update' | 'insert'; filters: Filter[]; payload?: unknown }
type Result = { data: unknown; error: unknown }

/**
 * A chainable stand-in for the Supabase client. Each query resolves through `answer`, which sees
 * the table, the action, the filters and any payload; every call is kept for assertions.
 */
function fakeSupabase(answer: (call: Call) => Result, rpc: (fn: string, args: Record<string, unknown>) => Result) {
  const calls: Call[] = []
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []
  const client = {
    from(table: string) {
      const call: Call = { table, action: 'select', filters: [] }
      const settle = () => { calls.push(call); return Promise.resolve(answer(call)) }
      const chain: Record<string, unknown> = {}
      const filter = (op: string) => (column: string, value: unknown) => { call.filters.push([op, column, value]); return chain }
      Object.assign(chain, {
        select: () => chain,
        update: (payload: unknown) => { call.action = 'update'; call.payload = payload; return chain },
        insert: (payload: unknown) => { call.action = 'insert'; call.payload = payload; return chain },
        eq: filter('eq'), neq: filter('neq'), in: filter('in'), is: filter('is'), not: filter('not'),
        order: () => chain, limit: () => chain,
        maybeSingle: settle, single: settle,
        then: (resolve: (value: Result) => unknown, reject: (error: unknown) => unknown) => settle().then(resolve, reject),
      })
      return chain
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args })
      return Promise.resolve(rpc(fn, args))
    },
  }
  return { client: client as any, calls, rpcCalls }
}

const filterValue = (call: Call, column: string) => call.filters.find(([, name]) => name === column)?.[2]

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING,
    customer_id: CUSTOMER,
    event_id: EVENT,
    seats: 2,
    status: 'pending_payment',
    hold_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    expired_at: null,
    ticket_price_locked: false,
    ...overrides,
  }
}

const eventRow = { id: EVENT, name: 'Quiz night', payment_mode: 'prepaid', price_per_seat: 40, price: 40, online_discount_type: null, online_discount_value: null, online_discount_ends_at: null }

function paypalOrder(overrides: { amount?: string; currency?: string; customId?: string; status?: string } = {}) {
  return {
    id: ORDER,
    status: overrides.status ?? 'APPROVED',
    purchase_units: [{
      custom_id: overrides.customId ?? `event_booking:${BOOKING}`,
      amount: { value: overrides.amount ?? '80.00', currency_code: overrides.currency ?? 'GBP' },
    }],
  }
}

/** A database holding one pending booking for two £40 seats and, optionally, its payment row. */
function database(options: {
  booking?: Record<string, unknown>
  payment?: Record<string, unknown> | null
  recheckPayment?: Record<string, unknown> | null
  confirm?: Result
} = {}) {
  const payment = options.payment === undefined
    ? { id: 'payment-1', paypal_order_id: ORDER, paypal_capture_id: null, amount: 80, currency: 'GBP', status: 'pending' }
    : options.payment
  let paymentReads = 0
  return fakeSupabase(
    (call) => {
      if (call.table === 'bookings') return { data: bookingRow(options.booking), error: null }
      if (call.table === 'events') return { data: eventRow, error: null }
      if (call.table === 'guest_tokens') {
        return { data: { id: 'token-1', customer_id: CUSTOMER, event_booking_id: BOOKING, expires_at: new Date(Date.now() + 60_000).toISOString(), consumed_at: null }, error: null }
      }
      if (call.table === 'payments' && call.action === 'select') {
        paymentReads++
        // The second read is the recovery read after PayPal says the order was already captured.
        if (paymentReads > 1 && options.recheckPayment !== undefined) return { data: options.recheckPayment, error: null }
        return { data: payment, error: null }
      }
      return { data: null, error: null }
    },
    () => options.confirm ?? { data: { state: 'confirmed', payment_id: 'payment-1' }, error: null },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('creating the PayPal order for an event booking', () => {
  it.each(['CREATED', 'APPROVED'])('reuses an existing %s order for the same amount, currency and booking', async (status) => {
    const db = database()
    paypal.getPayPalOrder.mockResolvedValueOnce(paypalOrder({ status }))

    const result = await createEventPayPalOrderByBookingId(db.client, { bookingId: BOOKING })

    expect(result).toMatchObject({ state: 'created', orderId: ORDER, amount: 80, currency: 'GBP' })
    expect(paypal.createInlinePayPalOrder).not.toHaveBeenCalled()
    expect(db.calls.some((call) => call.table === 'payments' && call.action !== 'select')).toBe(false)
  })

  it('makes a new order and moves the payment row onto it when the amount has changed', async () => {
    const db = database()
    paypal.getPayPalOrder.mockResolvedValueOnce(paypalOrder({ amount: '70.00' }))
    paypal.createInlinePayPalOrder.mockResolvedValueOnce({ orderId: 'ORDER-2' })

    const result = await createEventPayPalOrderByBookingId(db.client, { bookingId: BOOKING })

    expect(result).toMatchObject({ state: 'created', orderId: 'ORDER-2', amount: 80 })
    expect(paypal.createInlinePayPalOrder).toHaveBeenCalledWith(expect.objectContaining({
      amount: 80, currency: 'GBP', customId: `event_booking:${BOOKING}`,
    }))
    const update = db.calls.find((call) => call.table === 'payments' && call.action === 'update')
    expect(update?.payload).toMatchObject({ paypal_order_id: 'ORDER-2', amount: 80, status: 'pending' })
    expect(filterValue(update!, 'id')).toBe('payment-1')
  })

  it('refuses a booking whose payment has already been captured', async () => {
    const db = database({ payment: { id: 'payment-1', paypal_order_id: ORDER, paypal_capture_id: 'CAPTURE-1', amount: 80, currency: 'GBP', status: 'pending' } })

    const result = await createEventPayPalOrderByBookingId(db.client, { bookingId: BOOKING })

    expect(result).toEqual({ state: 'blocked', reason: 'booking_not_pending_payment' })
    expect(paypal.getPayPalOrder).not.toHaveBeenCalled()
    expect(paypal.createInlinePayPalOrder).not.toHaveBeenCalled()
  })
})

describe('capturing the PayPal order for an event booking', () => {
  it.each([
    ['the amount', { amount: '79.99' }],
    ['the currency', { currency: 'EUR' }],
    ['the booking reference', { customId: 'event_booking:someone-else' }],
  ])('refuses before capture when %s does not match', async (_label, order) => {
    const db = database()
    paypal.getPayPalOrder.mockResolvedValueOnce(paypalOrder(order))

    const result = await captureEventPayPalOrderByBookingId(db.client, { bookingId: BOOKING, orderId: ORDER })

    expect(result).toEqual({ state: 'blocked', reason: 'amount_or_reference_mismatch' })
    expect(paypal.capturePayPalPayment).not.toHaveBeenCalled()
    expect(db.rpcCalls).toHaveLength(0)
  })

  it('refuses an order that is not the one stored for the booking', async () => {
    const db = database()

    const result = await captureEventPayPalOrderByBookingId(db.client, { bookingId: BOOKING, orderId: 'ORDER-OTHER' })

    expect(result).toEqual({ state: 'blocked', reason: 'order_mismatch' })
    expect(paypal.getPayPalOrder).not.toHaveBeenCalled()
  })

  it('captures and confirms through the confirm function with what PayPal captured', async () => {
    const db = database()
    paypal.getPayPalOrder.mockResolvedValueOnce(paypalOrder())
    paypal.capturePayPalPayment.mockResolvedValueOnce({ transactionId: 'CAPTURE-1', status: 'COMPLETED', amount: '80.00', currency: 'GBP', customId: `event_booking:${BOOKING}` })

    const result = await captureEventPayPalOrderByBookingId(db.client, { bookingId: BOOKING, orderId: ORDER })

    expect(result).toMatchObject({ state: 'confirmed', bookingId: BOOKING, amount: 80, currency: 'GBP', paymentId: 'payment-1' })
    expect(db.rpcCalls).toEqual([{
      fn: 'confirm_event_paypal_payment_v01',
      args: {
        p_event_booking_id: BOOKING,
        p_paypal_order_id: ORDER,
        p_paypal_capture_id: 'CAPTURE-1',
        p_amount: 80,
        p_currency: 'GBP',
        p_source: 'external_capture',
      },
    }])
  })

  it('reports already confirmed when PayPal says the order was captured and our payment row succeeded', async () => {
    const db = database({ recheckPayment: { id: 'payment-1', amount: 80, currency: 'GBP', status: 'succeeded' } })
    paypal.getPayPalOrder.mockResolvedValueOnce(paypalOrder())
    paypal.capturePayPalPayment.mockRejectedValueOnce({ alreadyCaptured: true })

    const result = await captureEventPayPalOrderByBookingId(db.client, { bookingId: BOOKING, orderId: ORDER })

    expect(result).toMatchObject({ state: 'already_confirmed', bookingId: BOOKING, amount: 80, paymentId: 'payment-1' })
    expect(db.rpcCalls).toHaveLength(0)
  })

  it('sends it to manual review when PayPal says the order was captured but our payment row has not caught up', async () => {
    const db = database({ recheckPayment: { id: 'payment-1', amount: 80, currency: 'GBP', status: 'pending' } })
    paypal.getPayPalOrder.mockResolvedValueOnce(paypalOrder())
    paypal.capturePayPalPayment.mockRejectedValueOnce({ alreadyCaptured: true })

    const result = await captureEventPayPalOrderByBookingId(db.client, { bookingId: BOOKING, orderId: ORDER })

    expect(result).toMatchObject({ state: 'manual_review', reason: 'capture_already_captured_pending_confirmation' })
  })

  it('refuses a capture whose amount does not match, without confirming the booking', async () => {
    const db = database()
    paypal.getPayPalOrder.mockResolvedValueOnce(paypalOrder())
    paypal.capturePayPalPayment.mockResolvedValueOnce({ transactionId: 'CAPTURE-1', status: 'COMPLETED', amount: '8.00', currency: 'GBP', customId: `event_booking:${BOOKING}` })

    const result = await captureEventPayPalOrderByBookingId(db.client, { bookingId: BOOKING, orderId: ORDER })

    expect(result).toEqual({ state: 'blocked', reason: 'capture_amount_mismatch' })
    expect(db.rpcCalls).toHaveLength(0)
  })

  // Before this change a failed confirm threw: the website route answered 500 "Internal server
  // error", the guest page answered with a bare crash, and nothing was logged, though PayPal had
  // already taken the money.
  it('keeps the guest out of "try again" and logs an error when PayPal took the money but the booking could not be confirmed', async () => {
    const db = database({ confirm: { data: null, error: { message: 'connection reset', code: '08006' } } })
    paypal.getPayPalOrder.mockResolvedValueOnce(paypalOrder())
    paypal.capturePayPalPayment.mockResolvedValueOnce({ transactionId: 'CAPTURE-1', status: 'COMPLETED', amount: '80.00', currency: 'GBP', customId: `event_booking:${BOOKING}` })

    const result = await captureEventPayPalOrderByBookingId(db.client, { bookingId: BOOKING, orderId: ORDER })

    expect(result).toMatchObject({ state: 'manual_review', bookingId: BOOKING, amount: 80, reason: 'confirmation_failed_after_capture' })
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('could not be confirmed'),
      expect.objectContaining({ metadata: expect.objectContaining({ bookingId: BOOKING, orderId: ORDER, captureId: 'CAPTURE-1' }) }),
    )
  })

  it('confirms a guest payment-link capture with the guest source', async () => {
    const db = database()
    paypal.getPayPalOrder.mockResolvedValueOnce(paypalOrder())
    paypal.capturePayPalPayment.mockResolvedValueOnce({ transactionId: 'CAPTURE-1', status: 'COMPLETED', amount: '80.00', currency: 'GBP', customId: `event_booking:${BOOKING}` })

    const result = await captureEventPayPalOrderByRawToken(db.client, { rawToken: 'raw-token', orderId: ORDER })

    expect(result).toMatchObject({ state: 'confirmed', bookingId: BOOKING })
    const tokenRead = db.calls.find((call) => call.table === 'guest_tokens')
    expect(filterValue(tokenRead!, 'hashed_token')).toBe(hashGuestToken('raw-token'))
    expect(db.rpcCalls[0]?.args.p_source).toBe('guest_capture')
  })
})
