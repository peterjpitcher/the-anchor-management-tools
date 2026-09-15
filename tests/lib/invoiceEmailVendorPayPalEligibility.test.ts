import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InvoiceWithDetails } from '@/types/invoices'

const mocks = vi.hoisted(() => ({
  generateInvoicePDF: vi.fn(),
  generateQuotePDF: vi.fn(),
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/pdf-generator', () => ({
  generateInvoicePDF: mocks.generateInvoicePDF,
  generateQuotePDF: mocks.generateQuotePDF,
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: mocks.sendEmail,
}))

vi.mock('@/lib/email/invoice-sender', () => ({
  invoiceSenderIdentity: vi.fn(() => 'Orange Jelly Limited <billing@example.com>'),
  invoiceReplyToAddress: vi.fn(() => 'billing@example.com'),
}))

import { sendInvoiceEmail } from '@/lib/microsoft-graph'

const PDF_BYTES = Buffer.from('invoice-pdf')

function invoice(paypalSetting: boolean | 'missing'): InvoiceWithDetails {
  const vendor = {
    id: 'vendor-1',
    name: 'Example Vendor Limited',
    contact_name: 'Alex',
    email: 'accounts@example.com',
    is_active: true,
    created_at: '2026-09-15T09:00:00.000Z',
    updated_at: '2026-09-15T09:00:00.000Z',
    ...(paypalSetting === 'missing' ? {} : { paypal_payments_enabled: paypalSetting }),
  }

  return {
    id: 'invoice-1',
    invoice_number: 'INV-001',
    vendor_id: vendor.id,
    invoice_date: '2026-09-15',
    due_date: '2026-09-29',
    status: 'sent',
    invoice_discount_percentage: 0,
    subtotal_amount: 100,
    discount_amount: 0,
    vat_amount: 20,
    total_amount: 120,
    paid_amount: 0,
    created_at: '2026-09-15T09:00:00.000Z',
    updated_at: '2026-09-15T09:00:00.000Z',
    vendor,
    line_items: [],
    payments: [],
  } as unknown as InvoiceWithDetails
}

function sentPayload(): Record<string, unknown> {
  expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
  return mocks.sendEmail.mock.calls[0][0] as Record<string, unknown>
}

function expectInvoicePdfAttachment(payload: Record<string, unknown>): void {
  expect(payload.attachments).toEqual([
    {
      name: 'invoice-INV-001.pdf',
      contentType: 'application/pdf',
      content: PDF_BYTES,
    },
  ])
}

describe('sendInvoiceEmail vendor PayPal eligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.PRIVATE_BOOKING_TOKEN_SECRET = 'test-secret'
    process.env.NEXT_PUBLIC_APP_URL = 'https://management.orangejelly.co.uk'
    mocks.generateInvoicePDF.mockResolvedValue(PDF_BYTES)
    mocks.sendEmail.mockResolvedValue({ success: true, messageId: 'message-1' })
  })

  it('sends an enabled vendor the portal link and invoice PDF', async () => {
    const result = await sendInvoiceEmail(invoice(true), 'accounts@example.com')

    expect(result).toMatchObject({ success: true, pdfBuffer: PDF_BYTES })
    const payload = sentPayload()
    expect(String(payload.text)).toContain('Prefer to pay online?')
    expect(String(payload.text)).toContain('/invoice-portal/')
    expectInvoicePdfAttachment(payload)
  })

  it.each([
    ['disabled', false],
    ['missing', 'missing'],
  ] as const)('sends a %s vendor the invoice PDF without a PayPal block', async (_case, setting) => {
    const result = await sendInvoiceEmail(invoice(setting), 'accounts@example.com')

    expect(result).toMatchObject({ success: true, pdfBuffer: PDF_BYTES })
    const payload = sentPayload()
    expect(String(payload.text)).not.toContain('Prefer to pay online?')
    expect(String(payload.text)).not.toContain('/invoice-portal/')
    expect(String(payload.text)).not.toContain('card or PayPal')
    expectInvoicePdfAttachment(payload)
  })
})
