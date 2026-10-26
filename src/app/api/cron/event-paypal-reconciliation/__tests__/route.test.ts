import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockAuthorizeCronRequest = vi.fn()
vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: mockAuthorizeCronRequest,
}))

const mockGetPayPalOrder = vi.fn()
const mockGetPayPalRefund = vi.fn()
const mockIsPayPalOrderNotFoundError = vi.fn()
vi.mock('@/lib/paypal', () => ({
  getPayPalOrder: mockGetPayPalOrder,
  getPayPalRefund: mockGetPayPalRefund,
  isPayPalOrderNotFoundError: mockIsPayPalOrderNotFoundError,
}))

vi.mock('@/lib/events/event-payments', () => ({
  sendEventPaymentConfirmationSms: vi.fn(),
  sendEventPaymentManualReviewSms: vi.fn(),
}))

vi.mock('@/lib/email/event-ticket-emails', () => ({
  sendEventPaymentConfirmationEmail: vi.fn(),
  sendEventPaymentManualReviewEmail: vi.fn(),
}))

vi.mock('@/lib/events/refund-reconciliation', () => ({
  reconcileEventRefund: vi.fn(),
}))

const mockLoggerError = vi.fn()
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: mockLoggerError,
  },
}))

// Queued results for the two `.limit()` reads the route performs: pending
// prepaid payments first, then pending refunds.
let selectResults: Array<{ data: unknown[] | null; error: unknown }> = []
const mockUpdate = vi.fn()
let updateResult: { error: unknown } = { error: null }

function makeSelectChain() {
  const chain: Record<string, unknown> = {}
  for (const method of ['eq', 'not', 'order', 'is', 'in']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.limit = vi.fn(() => Promise.resolve(selectResults.shift() ?? { data: [], error: null }))
  return chain
}

function makeUpdateChain() {
  const chain: Record<string, unknown> = {}
  chain.eq = vi.fn(() => chain)
  chain.then = (resolve: (value: { error: unknown }) => unknown) => resolve(updateResult)
  return chain
}

const mockFrom = vi.fn((table: string) => {
  if (table !== 'payments') throw new Error(`Unexpected table: ${table}`)
  return {
    select: vi.fn(() => makeSelectChain()),
    update: vi.fn((payload: unknown) => {
      mockUpdate(payload)
      return makeUpdateChain()
    }),
  }
})

const mockRpc = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mockFrom, rpc: mockRpc }),
}))

const DAY_MS = 24 * 60 * 60 * 1000

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay-1',
    event_booking_id: 'booking-1',
    paypal_order_id: 'ORDER-1',
    created_at: new Date(Date.now() - 3 * DAY_MS).toISOString(),
    metadata: { source: 'booking_id' },
    ...overrides,
  }
}

async function runRoute() {
  const { GET } = await import('../route')
  const response = await GET(new NextRequest('https://example.test/api/cron/event-paypal-reconciliation'))
  return response.json()
}

describe('event-paypal-reconciliation: abandoned PayPal orders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    selectResults = []
    updateResult = { error: null }
    mockAuthorizeCronRequest.mockReturnValue({ authorized: true })
    mockIsPayPalOrderNotFoundError.mockImplementation(
      (error: unknown) => (error as { status?: number })?.status === 404
    )
  })

  it('writes off a stale pending payment whose order PayPal has purged, without logging an error', async () => {
    selectResults = [
      { data: [pendingRow()], error: null },
      { data: [], error: null },
    ]
    mockGetPayPalOrder.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))

    const body = await runRoute()

    expect(body.abandoned).toBe(1)
    expect(body.abandonedWrittenOff).toBe(1)
    expect(body.failed).toBe(0)
    expect(mockLoggerError).not.toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        metadata: expect.objectContaining({ abandoned_reason: 'paypal_order_not_found' }),
      })
    )
  })

  it('leaves a payment younger than a day alone so a live checkout is never written off', async () => {
    selectResults = [
      { data: [pendingRow({ created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() })], error: null },
      { data: [], error: null },
    ]
    mockGetPayPalOrder.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))

    const body = await runRoute()

    expect(body.abandoned).toBe(1)
    expect(body.abandonedWrittenOff).toBe(0)
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockLoggerError).not.toHaveBeenCalled()
  })

  it('still reports a genuine PayPal failure as an error', async () => {
    selectResults = [
      { data: [pendingRow()], error: null },
      { data: [], error: null },
    ]
    mockGetPayPalOrder.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))

    const body = await runRoute()

    expect(body.failed).toBe(1)
    expect(body.abandoned).toBe(0)
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Failed to reconcile event PayPal payment',
      expect.anything()
    )
  })

  it('keeps the row pending and stays noisy when the write-off itself fails', async () => {
    selectResults = [
      { data: [pendingRow()], error: null },
      { data: [], error: null },
    ]
    updateResult = { error: { message: 'permission denied' } }
    mockGetPayPalOrder.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))

    const body = await runRoute()

    expect(body.abandoned).toBe(1)
    expect(body.abandonedWrittenOff).toBe(0)
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Failed to write off an abandoned event PayPal payment',
      expect.anything()
    )
  })
})

// BK-019: the sweep confirmed any order with a capture, including one PayPal was still holding
// (PENDING) and one it had refused (DECLINED).
describe('event-paypal-reconciliation: captures PayPal has not completed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    selectResults = []
    updateResult = { error: null }
    mockAuthorizeCronRequest.mockReturnValue({ authorized: true })
    mockIsPayPalOrderNotFoundError.mockReturnValue(false)
  })

  function orderWithCapture(status: string) {
    return {
      status: 'COMPLETED',
      purchase_units: [{ payments: { captures: [{ id: 'CAPTURE-1', status, status_details: { reason: 'PENDING_REVIEW' }, amount: { value: '80.00', currency_code: 'GBP' } }] } }],
    }
  }

  it('confirms nothing and marks the payment as held when the capture is PENDING', async () => {
    selectResults = [{ data: [pendingRow()], error: null }, { data: [], error: null }]
    mockGetPayPalOrder.mockResolvedValue(orderWithCapture('PENDING'))

    const body = await runRoute()

    expect(mockRpc).not.toHaveBeenCalled()
    expect(body.confirmed).toBe(0)
    expect(body.capturePending).toBe(1)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      paypal_capture_id: 'CAPTURE-1',
      metadata: expect.objectContaining({ capture_status: 'PENDING', source: 'booking_id' }),
    }))
    expect(mockUpdate.mock.calls[0][0]).not.toHaveProperty('status')
  })

  it('confirms nothing and marks the payment failed when the capture was DECLINED', async () => {
    selectResults = [{ data: [pendingRow()], error: null }, { data: [], error: null }]
    mockGetPayPalOrder.mockResolvedValue(orderWithCapture('DECLINED'))

    const body = await runRoute()

    expect(mockRpc).not.toHaveBeenCalled()
    expect(body.captureDeclined).toBe(1)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      metadata: expect.objectContaining({ capture_status: 'DECLINED' }),
    }))
  })

  it('still confirms a COMPLETED capture', async () => {
    selectResults = [{ data: [pendingRow()], error: null }, { data: [], error: null }]
    mockGetPayPalOrder.mockResolvedValue(orderWithCapture('COMPLETED'))
    mockRpc.mockResolvedValue({ data: { state: 'confirmed' }, error: null })

    const body = await runRoute()

    expect(mockRpc).toHaveBeenCalledWith('confirm_event_paypal_payment_v01', expect.objectContaining({ p_paypal_capture_id: 'CAPTURE-1', p_amount: 80 }))
    expect(body.confirmed).toBe(1)
  })
})

