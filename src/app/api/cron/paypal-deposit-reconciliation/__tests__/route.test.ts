import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockAuthorizeCronRequest = vi.fn()
vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: mockAuthorizeCronRequest,
}))

const mockGetPayPalOrder = vi.fn()
const mockCapturePayPalPayment = vi.fn()
const mockIsPayPalOrderNotFoundError = vi.fn()
vi.mock('@/lib/paypal', () => ({
  getPayPalOrder: mockGetPayPalOrder,
  capturePayPalPayment: mockCapturePayPalPayment,
  isPayPalOrderNotFoundError: mockIsPayPalOrderNotFoundError,
}))

vi.mock('@/services/private-bookings', () => ({
  finalizeDepositPayment: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

const mockFetchLimit = vi.fn()
const fetchBookingsChain = {
  not: vi.fn(() => fetchBookingsChain),
  is: vi.fn(() => fetchBookingsChain),
  in: vi.fn(() => fetchBookingsChain),
  limit: mockFetchLimit,
}

const mockClearMaybeSingle = vi.fn()
const clearOrderChain = {
  eq: vi.fn(() => clearOrderChain),
  is: vi.fn(() => clearOrderChain),
  select: vi.fn(() => ({ maybeSingle: mockClearMaybeSingle })),
}

const mockSelect = vi.fn(() => fetchBookingsChain)
const mockUpdate = vi.fn(() => clearOrderChain)
const mockAuditInsert = vi.fn()
const mockFrom = vi.fn((table: string) => {
  if (table === 'private_bookings') {
    return {
      select: mockSelect,
      update: mockUpdate,
    }
  }

  if (table === 'audit_logs') {
    return {
      insert: mockAuditInsert,
    }
  }

  throw new Error(`Unexpected table: ${table}`)
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: mockFrom,
  })),
}))

async function callRoute() {
  const { GET } = await import('../route')
  const request = new NextRequest('http://localhost/api/cron/paypal-deposit-reconciliation')
  return GET(request)
}

describe('PayPal deposit reconciliation cron', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockAuthorizeCronRequest.mockReturnValue({ authorized: true })
    mockFetchLimit.mockResolvedValue({
      data: [{
        id: 'booking-1',
        paypal_deposit_order_id: 'ORDER-STALE',
        deposit_amount: 100,
        status: 'confirmed',
      }],
      error: null,
    })
    mockClearMaybeSingle.mockResolvedValue({ data: { id: 'booking-1' }, error: null })
    mockAuditInsert.mockResolvedValue({ error: null })
  })

  it('clears a stale PayPal order id when PayPal no longer recognizes the order', async () => {
    const notFoundError = Object.assign(new Error('PayPal order not found'), { status: 404 })
    mockGetPayPalOrder.mockRejectedValueOnce(notFoundError)
    mockIsPayPalOrderNotFoundError.mockReturnValueOnce(true)

    const response = await callRoute()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.results).toEqual([{ bookingId: 'booking-1', outcome: 'cleared_missing_order' }])
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      paypal_deposit_order_id: null,
      updated_at: expect.any(String),
    }))
    expect(clearOrderChain.eq).toHaveBeenCalledWith('id', 'booking-1')
    expect(clearOrderChain.eq).toHaveBeenCalledWith('paypal_deposit_order_id', 'ORDER-STALE')
    expect(clearOrderChain.is).toHaveBeenCalledWith('deposit_paid_date', null)
    expect(mockAuditInsert).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'paypal_deposit_order_cleared',
      resource_type: 'private_booking',
      resource_id: 'booking-1',
      operation_status: 'success',
      additional_info: expect.objectContaining({
        order_id: 'ORDER-STALE',
        reason: 'paypal_order_not_found',
        source: 'reconciliation_cron',
      }),
    }))
    expect(mockCapturePayPalPayment).not.toHaveBeenCalled()
  })
})
