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

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mockFrom, rpc: vi.fn() }),
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
