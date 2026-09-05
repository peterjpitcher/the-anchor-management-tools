import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ alert: vi.fn(), auth: vi.fn(), get: vi.fn(), settle: vi.fn(), update: vi.fn(), limit: vi.fn() }))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: mocks.alert }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/cron-auth', () => ({ authorizeCronRequest: mocks.auth }))
vi.mock('@/lib/paypal', () => ({ getPayPalOrder: mocks.get, PayPalApiError: class extends Error {} }))
vi.mock('@/lib/invoices/paypal-capture', () => ({ settleInvoicePayPalOrder: mocks.settle }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => {
  const select = { not: () => select, in: () => select, is: () => select, limit: mocks.limit }
  return { select: () => select, update: mocks.update }
} }) }))
import { GET } from '@/app/api/cron/invoice-paypal-reconciliation/route'

const invoice = {
  id: 'INVOICE-1', invoice_number: 'INV-003WK', paypal_order_id: 'ORDER-1',
  status: 'partially_paid', total_amount: 994.8, paid_amount: 250, paypal_reconciliation_attempts: 5,
}
const request = () => new NextRequest('https://management.orangejelly.co.uk/api/cron/invoice-paypal-reconciliation')
beforeEach(() => {
  vi.clearAllMocks()
  mocks.alert.mockResolvedValue(undefined)
  mocks.auth.mockReturnValue({ authorized: true })
  mocks.limit.mockResolvedValue({ data: [invoice], error: null })
  mocks.get.mockResolvedValue({ status: 'COMPLETED' })
  mocks.settle.mockResolvedValue({ success: true })
  mocks.update.mockImplementation(() => {
    const chain = { eq: () => chain, then: (resolve: (value: unknown) => void) => resolve({ error: null }) }
    return chain
  })
})

describe('invoice PayPal reconciliation', () => {
  it('recovers a completed payment through the validated shared path', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ settled: 1, failed: 0 })
    expect(mocks.settle).toHaveBeenCalledWith(invoice, 'ORDER-1', 'reconciliation', { status: 'COMPLETED' })
  })
  it('alerts on captured excess while keeping the successful settlement', async () => {
    mocks.settle.mockResolvedValue({ success: true, overpaidAmount: 10 })
    const response = await GET(request())
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ settled: 1, failed: 1 })
    expect(mocks.alert).toHaveBeenCalledTimes(1)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.settle).toHaveBeenCalledTimes(1)
  })
  it('preserves the order after more than five provider failures', async () => {
    mocks.get.mockRejectedValue(new Error('PayPal timeout'))
    const response = await GET(request())
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ failed: 1, cleared: 0 })
    expect(mocks.alert).toHaveBeenCalledTimes(1)
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ paypal_reconciliation_attempts: 6 }))
    expect(mocks.update.mock.calls[0][0]).not.toHaveProperty('paypal_order_id')
  })
  it('preserves a completed order whose ledger write failed and reports failure', async () => {
    mocks.settle.mockResolvedValue({ error: 'Payment could not be recorded' })
    expect((await GET(request())).status).toBe(500)
    expect(mocks.update.mock.calls[0][0]).not.toHaveProperty('paypal_order_id')
  })
  it('runs approved orders through the same amount and ownership checks', async () => {
    mocks.get.mockResolvedValue({ status: 'APPROVED' })
    mocks.settle.mockResolvedValue({ error: 'The amount due has changed' })
    expect((await GET(request())).status).toBe(500)
    expect(mocks.settle).toHaveBeenCalledTimes(1)
  })
  it('alerts when the initial database read fails', async () => {
    mocks.limit.mockResolvedValue({ data: null, error: new Error('Database unavailable') })
    expect((await GET(request())).status).toBe(500)
    expect(mocks.alert).toHaveBeenCalledTimes(1)
    expect(mocks.settle).not.toHaveBeenCalled()
  })
  it('requires cron authorisation before any processing or notification', async () => {
    mocks.auth.mockReturnValue({ authorized: false })
    expect((await GET(request())).status).toBe(401)
    expect(mocks.limit).not.toHaveBeenCalled()
    expect(mocks.alert).not.toHaveBeenCalled()
  })
  it('does not write or capture an order the customer has not approved', async () => {
    mocks.get.mockResolvedValue({ status: 'CREATED' })
    expect((await GET(request())).status).toBe(200)
    expect(mocks.settle).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
