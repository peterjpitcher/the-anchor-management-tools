import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  supabaseFrom,
  capturePayPalPayment,
  loggerError,
  sendTableBookingCreatedSmsIfAllowed,
  sendManagerTableBookingCreatedEmailIfAllowed,
} = vi.hoisted(() => ({
  supabaseFrom: vi.fn(),
  capturePayPalPayment: vi.fn(),
  loggerError: vi.fn(),
  sendTableBookingCreatedSmsIfAllowed: vi.fn().mockResolvedValue({ sms: null }),
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
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: loggerError, warn: vi.fn(), info: vi.fn() },
}))

vi.mock('@/lib/table-bookings/bookings', () => ({
  sendTableBookingCreatedSmsIfAllowed: (...args: unknown[]) =>
    sendTableBookingCreatedSmsIfAllowed(...args),
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
      booking_reference: 'TB-TEST1234',
      booking_type: 'sunday_lunch',
      source: 'brand_site',
    }

    // First call: table_bookings select; second call: table_bookings update; third: customers select
    const tableBookingsSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: bookingRow, error: null })
    const tableBookingsEq1 = vi.fn(() => ({ single: tableBookingsSingle }))
    const tableBookingsSelect = vi.fn(() => ({ eq: tableBookingsEq1 }))
    const tableBookingsUpdateEq = vi.fn().mockResolvedValue({ error: null })
    const tableBookingsUpdate = vi.fn(() => ({ eq: tableBookingsUpdateEq }))

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
    })

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

    // The notification payload must derive sunday_lunch from booking_type.
    expect(sendTableBookingCreatedSmsIfAllowed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bookingResult: expect.objectContaining({ sunday_lunch: true }),
      }),
    )
  })

  it('derives sunday_lunch=false for a regular booking_type', async () => {
    const bookingRow = {
      id: BOOKING_ID,
      status: 'pending_payment',
      payment_status: 'pending',
      paypal_deposit_order_id: 'ORDER-123',
      paypal_deposit_capture_id: null,
      customer_id: 'cust-1',
      party_size: 8,
      start_datetime: '2026-04-24T19:00:00Z',
      booking_reference: 'TB-TEST2345',
      booking_type: 'regular',
      source: 'brand_site',
    }

    const tableBookingsSingle = vi.fn().mockResolvedValue({ data: bookingRow, error: null })
    const tableBookingsSelect = vi.fn(() => ({ eq: vi.fn(() => ({ single: tableBookingsSingle })) }))
    const tableBookingsUpdate = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
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

    capturePayPalPayment.mockResolvedValue({ transactionId: 'TXN-42', status: 'COMPLETED' })

    await POST(
      buildRequest({ orderId: 'ORDER-123' }),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    )

    expect(sendTableBookingCreatedSmsIfAllowed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bookingResult: expect.objectContaining({ sunday_lunch: false }),
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
