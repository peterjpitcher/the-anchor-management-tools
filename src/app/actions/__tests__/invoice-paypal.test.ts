import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))
vi.mock('@/lib/errors', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e as Error)?.message || String(e)),
}))
vi.mock('@/lib/paypal', () => ({
  PAYPAL_DEFAULT_CURRENCY: 'GBP',
  createSimplePayPalOrder: vi.fn(),
  capturePayPalPayment: vi.fn(),
  getPayPalOrder: vi.fn(),
  isPayPalOrderAlreadyCapturedError: vi.fn().mockReturnValue(false),
}))
vi.mock('@/lib/email/invoice-payment-emails', () => ({
  sendInvoicePaymentLinkEmail: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('@/lib/invoice-recipients', () => ({
  resolveVendorInvoiceRecipients: vi.fn().mockResolvedValue({ to: 'kim@example.com', cc: [] }),
}))

import {
  getInvoicePortalLink,
  sendInvoicePaymentLink,
  createInvoicePaymentOrderByToken,
  captureInvoicePaymentByToken,
} from '@/app/actions/invoicePayPalActions'
import { applyInvoicePayPalCapture } from '@/lib/invoices/paypal-capture'
import { logger } from '@/lib/logger'
import { logAuditEvent } from '@/app/actions/audit'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { createSimplePayPalOrder, getPayPalOrder, capturePayPalPayment, isPayPalOrderAlreadyCapturedError } from '@/lib/paypal'
import { generateInvoiceToken } from '@/lib/invoices/invoice-token'
import { sendInvoicePaymentLinkEmail } from '@/lib/email/invoice-payment-emails'

const INVOICE_ID = '7f06990b-7636-4d72-b610-460168da18ec'

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: INVOICE_ID,
    invoice_number: 'INV-003WJ',
    status: 'overdue',
    total_amount: 975.6,
    paid_amount: 250,
    due_date: '2026-09-10',
    vendor_id: 'vendor-1',
    paypal_order_id: null,
    sent_at: '2026-09-01T12:05:00Z',
    updated_at: '2026-09-01T12:00:00Z',
    vendor: { name: 'Kim Renyard', email: 'kim@example.com' },
    ...overrides,
  }
}

function mockAdmin(row: Record<string, unknown> | null, rpcResult?: unknown) {
  const update = vi.fn(() => {
    const chain: Record<string, unknown> = {}
    for (const m of ['eq', 'in', 'is', 'not', 'select']) chain[m] = vi.fn().mockReturnValue(chain)
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: INVOICE_ID }, error: null })
    // A bare update with no .select() is awaited directly.
    ;(chain as any).then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null })
    return chain
  })

  const insert = vi.fn().mockResolvedValue({ data: null, error: null })

  const from = vi.fn(() => {
    const chain: Record<string, unknown> = { update, insert }
    for (const m of ['select', 'eq', 'is', 'in', 'not', 'limit']) {
      chain[m] = vi.fn().mockReturnValue(chain)
    }
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null })
    return chain
  })

  const rpc = vi.fn().mockResolvedValue({
    data: rpcResult ?? {
      recorded: true,
      already_recorded: false,
      status: 'paid',
      invoice_number: 'INV-003WJ',
    },
    error: null,
  })

  return { from, rpc, update, insert } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.PRIVATE_BOOKING_TOKEN_SECRET = 'test-secret'
  process.env.NEXT_PUBLIC_APP_URL = 'https://management.orangejelly.co.uk'
  vi.mocked(checkUserPermission).mockResolvedValue(true)
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
  } as any)
  vi.mocked(createSimplePayPalOrder).mockResolvedValue({
    orderId: 'ORDER-1',
    approveUrl: 'https://paypal.com/checkoutnow?token=ORDER-1',
  } as any)
})

describe('getInvoicePortalLink', () => {
  it('returns a portal URL on our own domain, never a raw PayPal link', async () => {
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin(invoice()))

    const result = await getInvoicePortalLink(INVOICE_ID)

    expect(result.error).toBeUndefined()
    expect(result.url).toMatch(/^https:\/\/management\.orangejelly\.co\.uk\/invoice-portal\/[A-Za-z0-9_-]{88}$/)
    expect(result.url).not.toContain('paypal')
  })

  it('refuses when the caller cannot view invoices', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(false)
    const result = await getInvoicePortalLink(INVOICE_ID)
    expect(result.error).toMatch(/permission/i)
  })

  it.each([
    ['void', 'cancelled'],
    ['written_off', 'written off'],
    ['paid', 'already paid'],
  ])('refuses a %s invoice', async (status, message) => {
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin(invoice({ status })))
    const result = await getInvoicePortalLink(INVOICE_ID)
    expect(result.error).toContain(message)
  })

  it('refuses a draft that has never been emailed', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      mockAdmin(invoice({ status: 'draft', sent_at: null })),
    )
    const result = await getInvoicePortalLink(INVOICE_ID)
    expect(result.error).toContain('not been issued')
  })

  it('allows a draft that HAS reached the customer, so a failed status flip does not strand them', async () => {
    // The manual send flips draft -> sent straight after the email goes out,
    // and that flip can fail while the email has already landed.
    vi.mocked(createAdminClient).mockReturnValue(
      mockAdmin(invoice({ status: 'draft', sent_at: '2026-09-01T12:05:00Z' })),
    )
    const result = await getInvoicePortalLink(INVOICE_ID)
    expect(result.error).toBeUndefined()
    expect(result.url).toContain('/invoice-portal/')
  })

  it('refuses when nothing is outstanding even if the status still says overdue', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      mockAdmin(invoice({ total_amount: 500, paid_amount: 500 })),
    )
    const result = await getInvoicePortalLink(INVOICE_ID)
    expect(result.error).toMatch(/nothing left to pay/i)
  })
})

describe('sendInvoicePaymentLink', () => {
  it('charges only what is outstanding, not the invoice total', async () => {
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin(invoice()))

    const result = await sendInvoicePaymentLink(INVOICE_ID)

    expect(result.error).toBeUndefined()
    expect(createSimplePayPalOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 725.6,
        customId: `inv-pay-${INVOICE_ID}`,
        reference: INVOICE_ID,
        currency: 'GBP',
      }),
    )
    expect(sendInvoicePaymentLinkEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'kim@example.com', amountDue: 725.6 }),
    )
  })

  it('reports a failed email rather than claiming it was sent', async () => {
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin(invoice()))
    vi.mocked(sendInvoicePaymentLinkEmail).mockResolvedValueOnce({
      success: false,
      error: 'Mailbox unavailable',
    })

    const result = await sendInvoicePaymentLink(INVOICE_ID)

    expect(result.success).toBeUndefined()
    expect(result.error).toBe('Mailbox unavailable')
  })
})

describe('createInvoicePaymentOrderByToken', () => {
  it('rejects a token that is not a valid invoice token', async () => {
    const result = await createInvoicePaymentOrderByToken('not-a-real-token')
    expect(result.error).toMatch(/expired/i)
    expect(createSimplePayPalOrder).not.toHaveBeenCalled()
  })

  it('mints a fresh order for a valid token', async () => {
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin(invoice()))

    const result = await createInvoicePaymentOrderByToken(generateInvoiceToken(INVOICE_ID))

    expect(result.error).toBeUndefined()
    expect(result.approveUrl).toContain('paypal.com')
  })

  it('reuses an in-flight order when the amount still matches', async () => {
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin(invoice({ paypal_order_id: 'ORDER-EXISTING' })))
    vi.mocked(getPayPalOrder).mockResolvedValue({
      status: 'APPROVED',
      purchase_units: [{
        reference_id: INVOICE_ID,
        custom_id: `inv-pay-${INVOICE_ID}`,
        amount: { value: '725.60', currency_code: 'GBP' },
      }],
      links: [{ rel: 'approve', href: 'https://paypal.com/checkoutnow?token=ORDER-EXISTING' }],
    } as any)

    const result = await createInvoicePaymentOrderByToken(generateInvoiceToken(INVOICE_ID))

    expect(result.approveUrl).toContain('ORDER-EXISTING')
    expect(createSimplePayPalOrder).not.toHaveBeenCalled()
  })

  it('opens a new order when the outstanding amount has moved since', async () => {
    const admin = mockAdmin(invoice({ paypal_order_id: 'ORDER-STALE' }))
    vi.mocked(createAdminClient).mockReturnValue(admin)
    vi.mocked(getPayPalOrder).mockResolvedValue({
      status: 'CREATED',
      purchase_units: [{
        reference_id: INVOICE_ID,
        custom_id: `inv-pay-${INVOICE_ID}`,
        // A part payment was recorded by hand after this order was made.
        amount: { value: '975.60', currency_code: 'GBP' },
      }],
      links: [{ rel: 'approve', href: 'https://paypal.com/checkoutnow?token=ORDER-STALE' }],
    } as any)

    const result = await createInvoicePaymentOrderByToken(generateInvoiceToken(INVOICE_ID))

    expect(createSimplePayPalOrder).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 725.6 }),
    )
    expect(result.approveUrl).toContain('ORDER-1')
    expect(admin.update).toHaveBeenCalledTimes(1)
  })

  it('refuses to bill an order belonging to a different invoice', async () => {
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin(invoice({ paypal_order_id: 'ORDER-OTHER' })))
    vi.mocked(getPayPalOrder).mockResolvedValue({
      status: 'APPROVED',
      purchase_units: [{
        reference_id: 'some-other-invoice',
        custom_id: 'inv-pay-some-other-invoice',
        amount: { value: '725.60', currency_code: 'GBP' },
      }],
      links: [{ rel: 'approve', href: 'https://paypal.com/checkoutnow?token=ORDER-OTHER' }],
    } as any)

    await createInvoicePaymentOrderByToken(generateInvoiceToken(INVOICE_ID))

    // Keep uncertain references available for investigation.
    expect(createSimplePayPalOrder).not.toHaveBeenCalled()
  })
})

describe('applyInvoicePayPalCapture', () => {
  it('records through the atomic RPC, keyed on the capture id', async () => {
    const admin = mockAdmin(invoice())
    vi.mocked(createAdminClient).mockReturnValue(admin)

    const result = await applyInvoicePayPalCapture({
      invoiceId: INVOICE_ID,
      amount: 725.6,
      captureId: 'CAPTURE-1',
      orderId: 'ORDER-1',
      source: 'webhook',
    })

    expect(result.success).toBe(true)
    expect(admin.rpc).toHaveBeenCalledWith('record_invoice_paypal_payment_atomic', {
      p_invoice_id: INVOICE_ID,
      p_amount: 725.6,
      p_capture_id: 'CAPTURE-1',
      p_order_id: 'ORDER-1',
      p_captured_at: null,
    })
  })

  it('reports a second arrival of the same capture as already recorded', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      mockAdmin(invoice(), {
        recorded: false,
        already_recorded: true,
        status: 'paid',
        invoice_number: 'INV-003WJ',
      }),
    )

    const result = await applyInvoicePayPalCapture({
      invoiceId: INVOICE_ID,
      amount: 725.6,
      captureId: 'CAPTURE-1',
      source: 'reconciliation',
    })

    expect(result.success).toBe(true)
    expect(result.alreadyRecorded).toBe(true)
  })
})

function paypalOrder(status = 'APPROVED', amount = '725.60', captureStatus = 'COMPLETED') {
  return {
    id: 'ORDER-1', status,
    purchase_units: [{
      reference_id: INVOICE_ID, custom_id: `inv-pay-${INVOICE_ID}`,
      amount: { value: amount, currency_code: 'GBP' },
      ...(status === 'COMPLETED' ? { payments: { captures: [{
        id: 'CAPTURE-1', status: captureStatus,
        create_time: '2026-09-04T13:38:30Z',
        amount: { value: amount, currency_code: 'GBP' },
      }] } } : {}),
    }],
  }
}

describe('invoice capture recovery and guards', () => {
  it.each(['void', 'written_off', 'paid', 'draft'])('does not capture an approved order for a %s invoice', async status => {
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin(invoice({ status, sent_at: null })))
    vi.mocked(getPayPalOrder).mockResolvedValue(paypalOrder())
    const result = await captureInvoicePaymentByToken(generateInvoiceToken(INVOICE_ID), 'ORDER-1')
    expect(result.error).toBeTruthy()
    expect(capturePayPalPayment).not.toHaveBeenCalled()
  })

  it('refuses even a one penny stale amount before capture', async () => {
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin(invoice()))
    vi.mocked(getPayPalOrder).mockResolvedValue(paypalOrder('APPROVED', '725.61'))
    const result = await captureInvoicePaymentByToken(generateInvoiceToken(INVOICE_ID), 'ORDER-1')
    expect(result.error).toContain('amount due has changed')
    expect(capturePayPalPayment).not.toHaveBeenCalled()
  })

  it('recovers an already captured payment without taking money again', async () => {
    const admin = mockAdmin(invoice())
    vi.mocked(createAdminClient).mockReturnValue(admin)
    vi.mocked(getPayPalOrder).mockResolvedValue(paypalOrder('COMPLETED'))
    const result = await captureInvoicePaymentByToken(generateInvoiceToken(INVOICE_ID), 'ORDER-1')
    expect(result.success).toBe(true)
    expect(capturePayPalPayment).not.toHaveBeenCalled()
    expect(admin.rpc).toHaveBeenCalledWith('record_invoice_paypal_payment_atomic', expect.objectContaining({
      p_capture_id: 'CAPTURE-1', p_amount: 725.6, p_captured_at: '2026-09-04T13:38:30Z',
    }))
  })

  it('does not credit a pending capture on a completed order', async () => {
    const admin = mockAdmin(invoice())
    vi.mocked(createAdminClient).mockReturnValue(admin)
    vi.mocked(getPayPalOrder).mockResolvedValue(paypalOrder('COMPLETED', '725.60', 'PENDING'))
    const result = await captureInvoicePaymentByToken(generateInvoiceToken(INVOICE_ID), 'ORDER-1')
    expect(result.error).toBeTruthy()
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('re-reads the actual capture after taking an approved payment', async () => {
    const admin = mockAdmin(invoice())
    vi.mocked(createAdminClient).mockReturnValue(admin)
    vi.mocked(getPayPalOrder).mockResolvedValueOnce(paypalOrder()).mockResolvedValueOnce(paypalOrder('COMPLETED'))
    vi.mocked(capturePayPalPayment).mockResolvedValue({ transactionId: 'CAPTURE-1', amount: '725.60', status: 'COMPLETED' } as never)
    const result = await captureInvoicePaymentByToken(generateInvoiceToken(INVOICE_ID), 'ORDER-1')
    expect(result.success).toBe(true)
    expect(capturePayPalPayment).toHaveBeenCalledTimes(1)
    expect(getPayPalOrder).toHaveBeenCalledTimes(2)
  })

  it('recovers when another path captured the same order first', async () => {
    const admin = mockAdmin(invoice())
    vi.mocked(createAdminClient).mockReturnValue(admin)
    vi.mocked(getPayPalOrder).mockResolvedValueOnce(paypalOrder()).mockResolvedValueOnce(paypalOrder('COMPLETED'))
    vi.mocked(capturePayPalPayment).mockRejectedValueOnce(new Error('ORDER_ALREADY_CAPTURED'))
    vi.mocked(isPayPalOrderAlreadyCapturedError).mockReturnValueOnce(true)
    const result = await captureInvoicePaymentByToken(generateInvoiceToken(INVOICE_ID), 'ORDER-1')
    expect(result.success).toBe(true)
    expect(admin.rpc).toHaveBeenCalledTimes(1)
  })

  it.each(['PENDING', 'REFUNDED', 'DECLINED'])('does not credit a %s capture returned after approval', async status => {
    const admin = mockAdmin(invoice())
    vi.mocked(createAdminClient).mockReturnValue(admin)
    vi.mocked(getPayPalOrder).mockResolvedValueOnce(paypalOrder()).mockResolvedValueOnce(paypalOrder('COMPLETED', '725.60', status))
    vi.mocked(capturePayPalPayment).mockResolvedValue({ status: 'COMPLETED' } as never)
    const result = await captureInvoicePaymentByToken(generateInvoiceToken(INVOICE_ID), 'ORDER-1')
    expect(result.error).toBeTruthy()
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('retains all money from an already completed overpayment and flags the excess', async () => {
    const admin = mockAdmin(invoice(), {
      recorded: true, already_recorded: false, status: 'paid', invoice_number: 'INV-003WJ', overpaid_amount: 74.4,
    })
    vi.mocked(createAdminClient).mockReturnValue(admin)
    vi.mocked(getPayPalOrder).mockResolvedValue(paypalOrder('COMPLETED', '800.00'))
    const result = await captureInvoicePaymentByToken(generateInvoiceToken(INVOICE_ID), 'ORDER-1')
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
    expect(admin.rpc).toHaveBeenCalledWith('record_invoice_paypal_payment_atomic', expect.objectContaining({ p_amount: 800 }))
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('exceeds the invoice total'), expect.objectContaining({ metadata: expect.objectContaining({ overpaidAmount: 74.4 }) }))
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ new_values: expect.objectContaining({ overpaid_amount: 74.4 }) }))
    expect(capturePayPalPayment).not.toHaveBeenCalled()
  })

  it('does not raise the excess alert again on an idempotent replay', async () => {
    const admin = mockAdmin(invoice(), {
      recorded: false, already_recorded: true, status: 'paid', invoice_number: 'INV-003WJ', overpaid_amount: 74.4,
    })
    vi.mocked(createAdminClient).mockReturnValue(admin)
    const result = await applyInvoicePayPalCapture({ invoiceId: INVOICE_ID, amount: 800, captureId: 'CAPTURE-1', source: 'webhook' })
    expect(result.success).toBe(true)
    expect(result.overpaidAmount).toBeUndefined()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('reports a recording failure after capture without offering another payment', async () => {
    const admin = mockAdmin(invoice())
    admin.rpc.mockResolvedValue({ data: null, error: { message: 'constraint failed' } })
    vi.mocked(createAdminClient).mockReturnValue(admin)
    vi.mocked(getPayPalOrder).mockResolvedValue(paypalOrder('COMPLETED'))
    const result = await captureInvoicePaymentByToken(generateInvoiceToken(INVOICE_ID), 'ORDER-1')
    expect(result.error).toContain('could not record')
    expect(capturePayPalPayment).not.toHaveBeenCalled()
  })

  it('records a completed old order before allowing any new payment link', async () => {
    const admin = mockAdmin(invoice({ paypal_order_id: 'ORDER-1' }))
    vi.mocked(createAdminClient).mockReturnValue(admin)
    vi.mocked(getPayPalOrder).mockResolvedValue(paypalOrder('COMPLETED'))
    const result = await createInvoicePaymentOrderByToken(generateInvoiceToken(INVOICE_ID))
    expect(result.error).toContain('previous payment has been recorded')
    expect(admin.rpc).toHaveBeenCalledTimes(1)
    expect(createSimplePayPalOrder).not.toHaveBeenCalled()
  })

  it('does not replace an approved order with a changed amount', async () => {
    const admin = mockAdmin(invoice({ paypal_order_id: 'ORDER-1' }))
    vi.mocked(createAdminClient).mockReturnValue(admin)
    vi.mocked(getPayPalOrder).mockResolvedValue(paypalOrder('APPROVED', '975.60'))
    const result = await createInvoicePaymentOrderByToken(generateInvoiceToken(INVOICE_ID))
    expect(result.error).toContain('previous payment needs checking')
    expect(admin.update).not.toHaveBeenCalled()
    expect(createSimplePayPalOrder).not.toHaveBeenCalled()
  })

  it('retains the existing reference on a provider lookup failure', async () => {
    const admin = mockAdmin(invoice({ paypal_order_id: 'ORDER-1' }))
    vi.mocked(createAdminClient).mockReturnValue(admin)
    vi.mocked(getPayPalOrder).mockRejectedValueOnce(new Error('PayPal unavailable'))
    const result = await createInvoicePaymentOrderByToken(generateInvoiceToken(INVOICE_ID))
    expect(result.error).toContain('could not check')
    expect(admin.update).not.toHaveBeenCalled()
    expect(createSimplePayPalOrder).not.toHaveBeenCalled()
  })
})
