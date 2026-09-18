import { beforeEach, describe, expect, it, vi } from 'vitest'
import { settleInvoicePayPalOrder } from '../paypal-capture'
import { capturePayPalPayment, getPayPalOrder } from '@/lib/paypal'
import { createAdminClient } from '@/lib/supabase/admin'
import { invoicePaymentCustomId } from '../paypal-custom-id'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/paypal', () => ({ capturePayPalPayment: vi.fn(), getPayPalOrder: vi.fn(), isPayPalOrderAlreadyCapturedError: vi.fn(() => false), PAYPAL_DEFAULT_CURRENCY: 'GBP' }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))

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
