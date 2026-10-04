import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { after } from 'next/server'
import { applyInvoicePayPalCapture, settleInvoicePayPalOrder } from '../paypal-capture'
import { sendReceiptForPayPalCapture } from '../receipt-email'
import { capturePayPalPayment, getPayPalOrder } from '@/lib/paypal'
import { createAdminClient } from '@/lib/supabase/admin'
import { invoicePaymentCustomId } from '../paypal-custom-id'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/lib/paypal', () => ({ capturePayPalPayment: vi.fn(), getPayPalOrder: vi.fn(), isPayPalOrderAlreadyCapturedError: vi.fn(() => false), PAYPAL_DEFAULT_CURRENCY: 'GBP' }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/invoices/receipt-email', () => ({ sendReceiptForPayPalCapture: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

const invoice = { id: 'invoice', status: 'sent', total_amount: 120, paid_amount: 20, credits: [{ status: 'issued', amount_inc_vat: 30 }], vendor: { paypal_payments_enabled: true } }
const order = (amount: string, completed = false) => ({ id: 'order', status: completed ? 'COMPLETED' : 'APPROVED', purchase_units: [{ reference_id: invoice.id, custom_id: invoicePaymentCustomId(invoice.id), amount: { value: amount, currency_code: 'GBP' }, ...(completed ? { payments: { captures: [{ id: 'capture', status: 'COMPLETED', create_time: '2026-09-18T12:00:00Z', amount: { value: amount, currency_code: 'GBP' } }] } } : {}) }] })
let rpc: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.clearAllMocks()
  rpc = vi.fn().mockResolvedValue({ data: { recorded: true, already_recorded: false, status: 'paid', invoice_number: 'INV-1', private_booking_id: 'booking' }, error: null })
  vi.mocked(createAdminClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createAdminClient>)
})

describe('credited invoice PayPal capture', () => {
  it('does not capture an approved order for the pre-credit balance', async () => {
    expect(await settleInvoicePayPalOrder(invoice, 'order', 'portal', order('100.00'))).toMatchObject({ error: expect.stringContaining('amount due has changed') })
    expect(capturePayPalPayment).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
  it('captures only the balance after issued credits and records its source identity', async () => {
    vi.mocked(getPayPalOrder).mockResolvedValue(order('70.00', true))
    expect(await settleInvoicePayPalOrder(invoice, 'order', 'portal', order('70.00'))).toMatchObject({ success: true })
    expect(capturePayPalPayment).toHaveBeenCalledWith('order', 'GBP')
    expect(rpc).toHaveBeenCalledWith('record_invoice_paypal_payment_atomic', expect.objectContaining({ p_invoice_id: 'invoice', p_amount: 70, p_capture_id: 'capture' }))
  })
  it('records an already completed capture despite a later credit so real money cannot disappear', async () => {
    expect(await settleInvoicePayPalOrder(invoice, 'order', 'webhook', order('100.00', true))).toMatchObject({ success: true })
    expect(capturePayPalPayment).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('record_invoice_paypal_payment_atomic', expect.objectContaining({ p_amount: 100 }))
  })
})

/**
 * The receipt rides on the capture and must never be able to hurt it. Every one of the three
 * capture paths (payment page, PayPal's notification, the 15 minute check) ends in
 * `applyInvoicePayPalCapture`, so this is the one place the rule has to hold.
 */
describe('the receipt after a PayPal capture', () => {
  const capture = { invoiceId: 'invoice', amount: 70, captureId: 'capture', orderId: 'order', source: 'webhook' as const, capturedAt: '2026-10-12T12:00:00Z' }
  const recordedResult = { success: true, alreadyRecorded: false }

  beforeEach(() => {
    vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', '')
    vi.mocked(sendReceiptForPayPalCapture).mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does nothing about a receipt while the switch is off', async () => {
    expect(await applyInvoicePayPalCapture(capture)).toEqual(recordedResult)

    expect(after).not.toHaveBeenCalled()
    expect(sendReceiptForPayPalCapture).not.toHaveBeenCalled()
    // The only thing asked of the database is the payment itself.
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('queues one receipt, to run after the response, when this call recorded the payment', async () => {
    vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', '2026-10-12')

    expect(await applyInvoicePayPalCapture(capture)).toEqual(recordedResult)

    // Queued, not run: the capture has answered without waiting for the email.
    expect(after).toHaveBeenCalledTimes(1)
    expect(sendReceiptForPayPalCapture).not.toHaveBeenCalled()

    const queued = vi.mocked(after).mock.calls[0][0] as () => Promise<void>
    await queued()

    expect(sendReceiptForPayPalCapture).toHaveBeenCalledTimes(1)
    expect(sendReceiptForPayPalCapture).toHaveBeenCalledWith(
      expect.objectContaining({ rpc }),
      { invoiceId: 'invoice', captureId: 'capture', source: 'webhook' },
    )
  })

  it('queues nothing when the payment had already been recorded by another path', async () => {
    vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', '2026-10-12')
    rpc.mockResolvedValue({ data: { recorded: false, already_recorded: true, status: 'paid', invoice_number: 'INV-1' }, error: null })

    expect(await applyInvoicePayPalCapture(capture)).toEqual({ success: true, alreadyRecorded: true })

    expect(after).not.toHaveBeenCalled()
    expect(sendReceiptForPayPalCapture).not.toHaveBeenCalled()
  })

  it('queues nothing when the payment could not be recorded', async () => {
    vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', '2026-10-12')
    rpc.mockResolvedValue({ data: null, error: { message: 'invoice_not_payable' } })

    expect(await applyInvoicePayPalCapture(capture)).toMatchObject({ error: expect.stringContaining('could not record it') })

    expect(after).not.toHaveBeenCalled()
  })

  it('returns exactly the same result when the receipt throws, rejects or cannot be queued', async () => {
    vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', '2026-10-12')

    // Queued and then fails: the response has already gone by the time it runs.
    vi.mocked(sendReceiptForPayPalCapture).mockRejectedValue(new Error('mailbox on fire'))
    vi.mocked(after).mockImplementationOnce((task) => {
      void Promise.resolve().then(task as () => Promise<void>).catch(() => {})
    })
    expect(await applyInvoicePayPalCapture(capture)).toEqual(recordedResult)

    // Cannot be queued at all: `after` throws when there is no request to run after.
    vi.mocked(after).mockImplementationOnce(() => {
      throw new Error('`after` was called outside a request scope')
    })
    expect(await applyInvoicePayPalCapture(capture)).toEqual(recordedResult)

    // A receipt that never finishes does not hold the capture up.
    vi.mocked(after).mockImplementationOnce((task) => {
      void (task as () => Promise<void>)()
    })
    vi.mocked(sendReceiptForPayPalCapture).mockReturnValue(new Promise<void>(() => {}))
    expect(await applyInvoicePayPalCapture(capture)).toEqual(recordedResult)
  })

  it('still reports an overpayment exactly as before when a receipt is queued', async () => {
    vi.stubEnv('INVOICE_PAYPAL_RECEIPTS_FROM', '2026-10-12')
    rpc.mockResolvedValue({ data: { recorded: true, already_recorded: false, status: 'paid', invoice_number: 'INV-1', overpaid_amount: '10.00' }, error: null })

    expect(await applyInvoicePayPalCapture(capture)).toEqual({ success: true, alreadyRecorded: false, overpaidAmount: 10 })
    expect(after).toHaveBeenCalledTimes(1)
  })
})
