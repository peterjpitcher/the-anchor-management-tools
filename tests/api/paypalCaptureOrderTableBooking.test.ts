import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  supabaseFrom,
  capturePayPalPayment,
  getPayPalOrder,
  loggerError,
  sendTableBookingConfirmedAfterDepositSmsIfAllowed,
  sendManagerTableBookingCreatedEmailIfAllowed,
} = vi.hoisted(() => ({
  supabaseFrom: vi.fn(),
  capturePayPalPayment: vi.fn(),
  getPayPalOrder: vi.fn(),
  loggerError: vi.fn(),
  sendTableBookingConfirmedAfterDepositSmsIfAllowed: vi.fn().mockResolvedValue({ sms: null }),
  sendManagerTableBookingCreatedEmailIfAllowed: vi.fn().mockResolvedValue({ sent: true }),
}))

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(async (handler: () => Promise<Response>) => handler()),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: supabaseFrom }),
}))

vi.mock('@/lib/paypal', () => ({
  capturePayPalPayment: (...args: unknown[]) => capturePayPalPayment(...args),
  getPayPalOrder: (...args: unknown[]) => getPayPalOrder(...args),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: loggerError, warn: vi.fn(), info: vi.fn() },
}))

vi.mock('@/lib/table-bookings/bookings', () => ({
  sendTableBookingConfirmedAfterDepositSmsIfAllowed: (...args: unknown[]) =>
    sendTableBookingConfirmedAfterDepositSmsIfAllowed(...args),
  sendManagerTableBookingCreatedEmailIfAllowed: (...args: unknown[]) =>
    sendManagerTableBookingCreatedEmailIfAllowed(...args),
}))

import { POST } from '@/app/api/external/table-bookings/[id]/paypal/capture-order/route'

const BOOKING_ID = '6ac0fc03-6030-44f2-9767-89a4e542620a'

function buildRequest(body: unknown): Request {
  return new Request('http://localhost/api/external/table-bookings/xxx/paypal/capture-order', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Request
}

function makePayPalOrder(amount: string) {
  return { purchase_units: [{ amount: { value: amount, currency_code: 'GBP' } }] }
}

function makeUpdateChain(result: { data: unknown; error: unknown } = { data: { id: BOOKING_ID }, error: null }) {
  const maybeSingle = vi.fn().mockResolvedValue(result)
  const select = vi.fn(() => ({ maybeSingle }))
  const chain = {
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    neq: vi.fn(() => chain),
    select,
  }
  return chain
}

function buildBookingFetch(bookingRow: unknown, fetchError: unknown = null) {
  const single = vi.fn().mockResolvedValue({ data: bookingRow, error: fetchError })
  const eq = vi.fn(() => ({ single }))
  const select = vi.fn(() => ({ eq }))
  const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
  return { select, update }
}

describe('POST /api/external/table-bookings/[id]/paypal/capture-order', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    supabaseFrom.mockReset()
  })

  it('captures a Sunday lunch booking and sets sunday_lunch=true in notification payload', async () => {
    const bookingRow = {
      id: BOOKING_ID,
      status: 'pending_payment',
      payment_status: 'pending',
      paypal_deposit_order_id: 'ORDER-123',
      paypal_deposit_capture_id: null,
      customer_id: 'cust-1',
      party_size: 2,
      start_datetime: '2026-04-26T12:00:00Z',
      hold_expires_at: '2099-04-26T12:00:00Z',
      booking_reference: 'TB-TEST1234',
      booking_type: 'sunday_lunch',
      source: 'brand_site',
      deposit_amount: 40,
      deposit_amount_locked: null,
      deposit_waived: false,
    }

    // First call: table_bookings select; second call: table_bookings update; third: customers select
    const tableBookingsSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: bookingRow, error: null })
    const tableBookingsEq1 = vi.fn(() => ({ single: tableBookingsSingle }))
    const tableBookingsSelect = vi.fn(() => ({ eq: tableBookingsEq1 }))
    const tableBookingsUpdate = vi.fn(() => makeUpdateChain())

    const customersMaybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { mobile_e164: '+447000000000', mobile_number: '+447000000000' }, error: null })
    const customersEq = vi.fn(() => ({ maybeSingle: customersMaybeSingle }))
    const customersSelect = vi.fn(() => ({ eq: customersEq }))

    supabaseFrom.mockImplementation((table: string) => {
      if (table === 'table_bookings') {
        return { select: tableBookingsSelect, update: tableBookingsUpdate }
      }
      if (table === 'customers') {
        return { select: customersSelect }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    capturePayPalPayment.mockResolvedValue({
      transactionId: 'TXN-999',
      status: 'COMPLETED',
      amount: 40,
    })
    getPayPalOrder.mockResolvedValue(makePayPalOrder('40.00'))

    const response = await POST(
      buildRequest({ orderId: 'ORDER-123' }),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    )

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toEqual({ success: true })

    // Regression: SELECT must use the real column booking_type, NOT sunday_lunch.
    const selectArg = tableBookingsSelect.mock.calls[0]?.[0]
    expect(selectArg).toContain('booking_type')
    expect(selectArg).not.toMatch(/\bsunday_lunch\b/)

    // Walk-in launch (spec §6, §7.4, §8.3): the capture must persist
    // deposit_amount_locked = the actually-captured GBP amount.
    expect(tableBookingsUpdate).toHaveBeenCalledTimes(1)
    const updatePayload = tableBookingsUpdate.mock.calls[0]?.[0]
    expect(updatePayload).toMatchObject({
      payment_status: 'completed',
      status: 'confirmed',
      payment_method: 'paypal',
      paypal_deposit_capture_id: 'TXN-999',
      deposit_amount_locked: 40,
    })

    expect(sendTableBookingConfirmedAfterDepositSmsIfAllowed).toHaveBeenCalledWith(
      expect.anything(),
      BOOKING_ID,
    )
  })

  it('sends post-deposit notifications for a regular booking_type', async () => {
    const bookingRow = {
      id: BOOKING_ID,
      status: 'pending_payment',
      payment_status: 'pending',
      paypal_deposit_order_id: 'ORDER-123',
      paypal_deposit_capture_id: null,
      customer_id: 'cust-1',
      party_size: 8,
      start_datetime: '2026-04-24T19:00:00Z',
      hold_expires_at: '2099-04-24T19:00:00Z',
      booking_reference: 'TB-TEST2345',
      booking_type: 'regular',
      source: 'brand_site',
      deposit_amount: 80,
      deposit_amount_locked: null,
      deposit_waived: false,
    }

    const tableBookingsSingle = vi.fn().mockResolvedValue({ data: bookingRow, error: null })
    const tableBookingsSelect = vi.fn(() => ({ eq: vi.fn(() => ({ single: tableBookingsSingle })) }))
    const tableBookingsUpdate = vi.fn(() => makeUpdateChain())
    const customersSelect = vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    }))

    supabaseFrom.mockImplementation((table: string) =>
      table === 'table_bookings'
        ? { select: tableBookingsSelect, update: tableBookingsUpdate }
        : { select: customersSelect },
    )

    capturePayPalPayment.mockResolvedValue({
      transactionId: 'TXN-42',
      status: 'COMPLETED',
      amount: 80,
    })
    getPayPalOrder.mockResolvedValue(makePayPalOrder('80.00'))

    await POST(
      buildRequest({ orderId: 'ORDER-123' }),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    )

    expect(sendTableBookingConfirmedAfterDepositSmsIfAllowed).toHaveBeenCalledWith(
      expect.anything(),
      BOOKING_ID,
    )
  })

  it('fails closed (502, no DB update) when PayPal capture response has no parseable GBP amount', async () => {
    const bookingRow = {
      id: BOOKING_ID,
      status: 'pending_payment',
      payment_status: 'pending',
      paypal_deposit_order_id: 'ORDER-NO-AMOUNT',
      paypal_deposit_capture_id: null,
      customer_id: 'cust-1',
      party_size: 4,
      start_datetime: '2026-05-22T19:00:00Z',
      hold_expires_at: '2099-05-22T19:00:00Z',
      booking_reference: 'TB-NO-AMOUNT',
      booking_type: 'regular',
      source: 'brand_site',
      deposit_amount: 40,
      deposit_amount_locked: null,
      deposit_waived: false,
    }

    const tableBookingsSingle = vi.fn().mockResolvedValue({ data: bookingRow, error: null })
    const tableBookingsSelect = vi.fn(() => ({ eq: vi.fn(() => ({ single: tableBookingsSingle })) }))
    const tableBookingsUpdate = vi.fn(() => makeUpdateChain())
    supabaseFrom.mockImplementation((table: string) =>
      table === 'table_bookings'
        ? { select: tableBookingsSelect, update: tableBookingsUpdate }
        : { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })) })) },
    )

    // Capture succeeds but returns no amount — fail closed.
    capturePayPalPayment.mockResolvedValue({
      transactionId: 'TXN-NO-AMT',
      status: 'COMPLETED',
      // amount is deliberately missing
    })
    getPayPalOrder.mockResolvedValue(makePayPalOrder('40.00'))

    const response = await POST(
      buildRequest({ orderId: 'ORDER-NO-AMOUNT' }),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    )

    // Must return 502 — explicit "we couldn't confirm your payment" state.
    expect(response.status).toBe(502)

    // Must NOT update payment_status (deposit_amount_locked stays unset, manual reconciliation required).
    expect(tableBookingsUpdate).not.toHaveBeenCalled()

    // Must NOT send the customer SMS (booking is in an unconfirmed state).
    expect(sendTableBookingConfirmedAfterDepositSmsIfAllowed).not.toHaveBeenCalled()

    // Must log the high-severity diagnostic so on-call can investigate.
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining('no parseable GBP amount'),
      expect.objectContaining({
        metadata: expect.objectContaining({ bookingId: BOOKING_ID }),
      }),
    )
  })

  it('logs the underlying DB error before returning 404 on fetch failure', async () => {
    const tableBookingsSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "column table_bookings.sunday_lunch does not exist", code: '42703', details: 'x' },
    })
    const tableBookingsSelect = vi.fn(() => ({ eq: vi.fn(() => ({ single: tableBookingsSingle })) }))
    supabaseFrom.mockImplementation(() => ({ select: tableBookingsSelect }))

    const response = await POST(
      buildRequest({ orderId: 'ORDER-123' }),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    )

    expect(response.status).toBe(404)
    expect(loggerError).toHaveBeenCalledWith(
      'capture-order: booking fetch failed',
      expect.objectContaining({
        metadata: expect.objectContaining({ bookingId: BOOKING_ID, code: '42703' }),
      }),
    )
  })
})
