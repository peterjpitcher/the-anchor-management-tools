import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockAuthorizeCronRequest = vi.fn()
vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: mockAuthorizeCronRequest,
}))

const mockIsPayPalOrderNotFoundError = vi.fn()
vi.mock('@/lib/paypal', () => ({
  isPayPalOrderNotFoundError: mockIsPayPalOrderNotFoundError,
}))

const mockReconcileCapturedParkingPayment = vi.fn()
vi.mock('@/lib/parking/payments', () => ({
  reconcileCapturedParkingPayment: mockReconcileCapturedParkingPayment,
}))

const mockLoggerError = vi.fn()
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: mockLoggerError },
}))

let pendingRows: unknown[] = []
let updateResult: { error: unknown } = { error: null }
const mockUpdate = vi.fn()
const updateEqCalls: Array<[string, unknown]> = []

function makePendingChain() {
  const chain: Record<string, unknown> = {}
  for (const method of ['eq', 'not', 'order']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.limit = vi.fn(() => Promise.resolve({ data: pendingRows, error: null }))
  return chain
}

function makeUpdateChain() {
  const chain: Record<string, unknown> = {}
  chain.eq = vi.fn((column: string, value: unknown) => {
    updateEqCalls.push([column, value])
    return chain
  })
  chain.then = (resolve: (value: { error: unknown }) => unknown) => resolve(updateResult)
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'parking_booking_payments') {
        return {
          select: vi.fn(() => makePendingChain()),
          update: vi.fn((payload: unknown) => {
            mockUpdate(payload)
            return makeUpdateChain()
          }),
        }
      }
      if (table === 'parking_bookings') {
        const chain: Record<string, unknown> = {}
        chain.select = vi.fn(() => chain)
        chain.eq = vi.fn(() => chain)
        chain.maybeSingle = vi.fn(() => Promise.resolve({ data: { id: 'booking-1', status: 'expired' }, error: null }))
        return chain
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  }),
}))

const HOUR_MS = 60 * 60 * 1000

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay-1',
    booking_id: 'booking-1',
    paypal_order_id: 'ORDER-1',
    created_at: new Date(Date.now() - 48 * HOUR_MS).toISOString(),
    metadata: { approve_url: 'https://www.paypal.com/checkoutnow?token=ORDER-1' },
    ...overrides,
  }
}

const notFound = () => Object.assign(new Error('not found'), { status: 404 })

async function runRoute() {
  const { GET } = await import('../route')
  const response = await GET(new NextRequest('https://example.test/api/cron/parking-paypal-reconciliation'))
  return response.json()
}

describe('parking-paypal-reconciliation: orders PayPal no longer has', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    pendingRows = []
    updateResult = { error: null }
    updateEqCalls.length = 0
    mockAuthorizeCronRequest.mockReturnValue({ authorized: true })
    mockIsPayPalOrderNotFoundError.mockImplementation(
      (error: unknown) => (error as { status?: number })?.status === 404
    )
  })

  it('expires a pending payment whose order PayPal has purged, keeping its metadata', async () => {
    pendingRows = [pendingRow()]
    mockReconcileCapturedParkingPayment.mockRejectedValue(notFound())

    const body = await runRoute()

    expect(body).toMatchObject({ success: true, expired: 1, failed: 0 })
    expect(mockLoggerError).not.toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalledWith({
      status: 'expired',
      metadata: expect.objectContaining({
        approve_url: 'https://www.paypal.com/checkoutnow?token=ORDER-1',
        abandoned_reason: 'paypal_order_not_found',
      }),
    })
    // Guarded on pending so a capture recorded at the same moment is never overwritten.
    expect(updateEqCalls).toContainEqual(['status', 'pending'])
  })

  it('leaves a payment created within the last hour alone', async () => {
    pendingRows = [pendingRow({ created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() })]
    mockReconcileCapturedParkingPayment.mockRejectedValue(notFound())

    const body = await runRoute()

    expect(body).toMatchObject({ expired: 0, failed: 0 })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('still reports a genuine failure as an error', async () => {
    pendingRows = [pendingRow()]
    mockReconcileCapturedParkingPayment.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }))

    const body = await runRoute()

    expect(body).toMatchObject({ failed: 1, expired: 0 })
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockLoggerError).toHaveBeenCalledWith('[parking-reconciliation] could not reconcile a payment', expect.anything())
  })

  it('stays visible when the expiry write itself fails', async () => {
    pendingRows = [pendingRow()]
    updateResult = { error: { message: 'permission denied' } }
    mockReconcileCapturedParkingPayment.mockRejectedValue(notFound())

    const body = await runRoute()

    expect(body).toMatchObject({ expired: 0 })
    expect(mockLoggerError).toHaveBeenCalledWith('[parking-reconciliation] could not expire an abandoned payment', expect.anything())
  })
})
