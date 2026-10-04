import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  auth: vi.fn(),
  get: vi.fn(),
  settle: vi.fn(),
  update: vi.fn(),
  select: vi.fn(),
  limit: vi.fn(),
  sweep: vi.fn(),
}))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: mocks.alert }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/cron-auth', () => ({ authorizeCronRequest: mocks.auth }))
vi.mock('@/lib/paypal', () => ({ getPayPalOrder: mocks.get, PayPalApiError: class extends Error {} }))
vi.mock('@/lib/invoices/paypal-capture', () => ({ settleInvoicePayPalOrder: mocks.settle }))
vi.mock('@/lib/invoices/receipt-email', () => ({ sweepPayPalReceipts: mocks.sweep }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => {
  const select = { not: () => select, in: () => select, is: () => select, limit: mocks.limit }
  mocks.select.mockReturnValue(select)
  return { select: mocks.select, update: mocks.update }
} }) }))
import { GET } from '@/app/api/cron/invoice-paypal-reconciliation/route'

const invoice = {
  id: 'INVOICE-1', invoice_number: 'INV-003WK', paypal_order_id: 'ORDER-1',
  status: 'partially_paid', total_amount: 994.8, paid_amount: 250, paypal_reconciliation_attempts: 5,
  vendor: { paypal_payments_enabled: true },
}
const request = () => new NextRequest('https://management.orangejelly.co.uk/api/cron/invoice-paypal-reconciliation')
beforeEach(() => {
  vi.clearAllMocks()
  mocks.alert.mockResolvedValue(undefined)
  mocks.auth.mockReturnValue({ authorized: true })
  mocks.limit.mockResolvedValue({ data: [invoice], error: null })
  mocks.get.mockResolvedValue({ status: 'COMPLETED' })
  mocks.settle.mockResolvedValue({ success: true })
  // Null is what the sweep returns while INVOICE_PAYPAL_RECEIPTS_FROM is unset.
  mocks.sweep.mockResolvedValue(null)
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
  it('leaves a disabled vendor approved order untouched without raising a failure', async () => {
    const disabledInvoice = {
      ...invoice,
      vendor: { paypal_payments_enabled: false },
    }
    mocks.limit.mockResolvedValue({ data: [disabledInvoice], error: null })
    mocks.get.mockResolvedValue({ status: 'APPROVED' })

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ checked: 1, settled: 0, failed: 0 })
    expect(mocks.select).toHaveBeenCalledWith(
      expect.stringContaining('vendor:invoice_vendors(paypal_payments_enabled)'),
    )
    expect(mocks.settle).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.alert).not.toHaveBeenCalled()
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

/**
 * The receipt sweep rides on this job and must never be able to change its result. The job
 * exists to get money PayPal has taken onto the invoice; a receipt is a courtesy after that.
 */
describe('invoice PayPal reconciliation: the receipt sweep', () => {
  const swept = { owed: 2, sent: 1, skipped: 0, refused: 1, unknown: 0 }

  it('says nothing about receipts while the switch is off', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, checked: 1, settled: 1, cleared: 0, failed: 0 })
  })
  it('reports the sweep beside the reconciliation figures without changing them', async () => {
    mocks.sweep.mockResolvedValue(swept)
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, checked: 1, settled: 1, cleared: 0, failed: 0, receipts: swept })
    expect(mocks.sweep).toHaveBeenCalledTimes(1)
    // A deadline, so a queue of receipts cannot run the job out of time.
    expect(mocks.sweep.mock.calls[0][1]).toEqual({ deadline: expect.any(Number) })
    expect(mocks.alert).not.toHaveBeenCalled()
  })
  it('sweeps after the money has been dealt with, not before', async () => {
    const order: string[] = []
    mocks.settle.mockImplementation(async () => { order.push('settle'); return { success: true } })
    mocks.sweep.mockImplementation(async () => { order.push('sweep'); return swept })
    await GET(request())
    expect(order).toEqual(['settle', 'sweep'])
  })
  it('stays a success when the sweep throws, and raises the sweep fault as its own alert', async () => {
    mocks.sweep.mockRejectedValue(new Error('Could not read PayPal payments: timeout'))
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true, checked: 1, settled: 1, cleared: 0, failed: 0,
      receipts: { error: 'Receipt sweep failed' },
    })
    expect(mocks.alert).toHaveBeenCalledTimes(1)
    expect(mocks.alert.mock.calls[0][0]).toBe('invoice-paypal-receipt')
  })
  it('keeps a failed reconciliation failed whatever the sweep did', async () => {
    mocks.settle.mockResolvedValue({ error: 'Payment could not be recorded' })
    mocks.sweep.mockResolvedValue(swept)
    const response = await GET(request())
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ success: false, failed: 1, receipts: swept })
  })
  it('still sweeps when the reconciliation could not run at all', async () => {
    mocks.limit.mockResolvedValue({ data: null, error: new Error('Database unavailable') })
    mocks.sweep.mockResolvedValue(swept)
    const response = await GET(request())
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ success: false, error: 'Reconciliation failed', receipts: swept })
    expect(mocks.sweep).toHaveBeenCalledTimes(1)
  })
  it('does not sweep without cron authorisation', async () => {
    mocks.auth.mockReturnValue({ authorized: false })
    expect((await GET(request())).status).toBe(401)
    expect(mocks.sweep).not.toHaveBeenCalled()
  })
})
