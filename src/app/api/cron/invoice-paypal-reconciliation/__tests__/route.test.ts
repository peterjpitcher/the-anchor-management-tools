import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockAuthorizeCronRequest = vi.fn()
vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: mockAuthorizeCronRequest,
}))

const mockGetPayPalOrder = vi.fn()
const mockIsPayPalOrderNotFoundError = vi.fn()
vi.mock('@/lib/paypal', () => ({
  getPayPalOrder: mockGetPayPalOrder,
  isPayPalOrderNotFoundError: mockIsPayPalOrderNotFoundError,
  PayPalApiError: class PayPalApiError extends Error {
    status = 500
  },
}))

const mockReportCronFailure = vi.fn()
vi.mock('@/lib/cron/alerting', () => ({
  reportCronFailure: mockReportCronFailure,
}))

vi.mock('@/lib/invoices/paypal-capture', () => ({
  settleInvoicePayPalOrder: vi.fn(),
}))

const mockLoggerError = vi.fn()
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: mockLoggerError },
}))

let invoiceRows: unknown[] = []
const mockUpdate = vi.fn()
const updateEqCalls: Array<[string, unknown]> = []

function makeSelectChain() {
  const chain: Record<string, unknown> = {}
  for (const method of ['not', 'in', 'is', 'eq']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.limit = vi.fn(() => Promise.resolve({ data: invoiceRows, error: null }))
  return chain
}

function makeUpdateChain() {
  const chain: Record<string, unknown> = {}
  chain.eq = vi.fn((column: string, value: unknown) => {
    updateEqCalls.push([column, value])
    return chain
  })
  chain.then = (resolve: (value: { error: null }) => unknown) => resolve({ error: null })
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== 'invoices') throw new Error(`Unexpected table: ${table}`)
      return {
        select: vi.fn(() => makeSelectChain()),
        update: vi.fn((payload: unknown) => {
          mockUpdate(payload)
          return makeUpdateChain()
        }),
      }
    },
  }),
}))

const HOUR_MS = 60 * 60 * 1000

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    invoice_number: 'INV-001',
    paypal_order_id: 'ORDER-1',
    total_amount: 120,
    paid_amount: 0,
    status: 'sent',
    sent_at: new Date(Date.now() - 3 * 24 * HOUR_MS).toISOString(),
    updated_at: new Date(Date.now() - 2 * HOUR_MS).toISOString(),
    paypal_reconciliation_attempts: 0,
    vendor: { paypal_payments_enabled: true },
    ...overrides,
  }
}

async function runRoute() {
  const { GET } = await import('../route')
  const response = await GET(new NextRequest('https://example.test/api/cron/invoice-paypal-reconciliation'))
  return { status: response.status, body: await response.json() }
}

describe('invoice-paypal-reconciliation: orders PayPal no longer has', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    invoiceRows = []
    updateEqCalls.length = 0
    mockAuthorizeCronRequest.mockReturnValue({ authorized: true })
    mockIsPayPalOrderNotFoundError.mockImplementation(
      (error: unknown) => (error as { status?: number })?.status === 404
    )
  })

  it('clears an abandoned order quietly instead of alerting and returning 500', async () => {
    invoiceRows = [invoice()]
    mockGetPayPalOrder.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))

    const { status, body } = await runRoute()

    expect(status).toBe(200)
    expect(body).toMatchObject({ success: true, cleared: 1, failed: 0 })
    expect(mockReportCronFailure).not.toHaveBeenCalled()
    expect(mockLoggerError).not.toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ paypal_order_id: null, paypal_reconciliation_last_error: 'Order no longer exists at PayPal' })
    )
    // Guarded on the order id so a newer order attached since is left alone.
    expect(updateEqCalls).toContainEqual(['paypal_order_id', 'ORDER-1'])
  })

  it('leaves an order attached within the last hour alone', async () => {
    invoiceRows = [invoice({ updated_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() })]
    mockGetPayPalOrder.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }))

    const { status, body } = await runRoute()

    expect(status).toBe(200)
    expect(body).toMatchObject({ cleared: 0, failed: 0 })
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockReportCronFailure).not.toHaveBeenCalled()
  })

  it('still alerts on a genuine PayPal failure and keeps the order', async () => {
    invoiceRows = [invoice()]
    mockGetPayPalOrder.mockRejectedValue(Object.assign(new Error('timeout'), { status: 503 }))

    const { status, body } = await runRoute()

    expect(status).toBe(500)
    expect(body).toMatchObject({ failed: 1, cleared: 0 })
    expect(mockReportCronFailure).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ paypal_reconciliation_attempts: 1 }))
    expect(mockUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ paypal_order_id: null }))
  })
})

/**
 * These run the real receipt sweep against the client above, which throws on any table but
 * `invoices`. That makes it a tripwire: with the switch off the sweep must not touch the
 * database at all, and with it on a sweep that falls over must not take the job with it.
 */
describe('invoice-paypal-reconciliation: the receipt switch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    invoiceRows = []
    updateEqCalls.length = 0
    mockAuthorizeCronRequest.mockReturnValue({ authorized: true })
    vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reads no table but invoices, and reports nothing about receipts, while the switch is off', async () => {
    const { status, body } = await runRoute()

    expect(status).toBe(200)
    expect(body).toEqual({ success: true, checked: 0, settled: 0, cleared: 0, failed: 0 })
    expect(mockLoggerError).not.toHaveBeenCalled()
    expect(mockReportCronFailure).not.toHaveBeenCalled()
  })

  it('stays a success when the switch is on and the sweep cannot read its tables', async () => {
    vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', '2026-10-12')

    const { status, body } = await runRoute()

    expect(status).toBe(200)
    expect(body).toEqual({
      success: true, checked: 0, settled: 0, cleared: 0, failed: 0,
      receipts: { error: 'Receipt sweep failed' },
    })
    // The fault is not swallowed: it is logged and raised under its own name.
    expect(mockLoggerError).toHaveBeenCalledTimes(1)
    expect(mockReportCronFailure).toHaveBeenCalledTimes(1)
    expect(mockReportCronFailure.mock.calls[0][0]).toBe('invoice-paypal-receipt')
    expect(String(mockReportCronFailure.mock.calls[0][1])).toContain('Unexpected table: invoice_payments')
  })
})
