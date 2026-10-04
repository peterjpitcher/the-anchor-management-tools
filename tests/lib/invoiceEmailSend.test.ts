/**
 * `sendInvoiceEmail`, the one function every invoice, chase and receipt goes through.
 *
 * Four things are pinned here, each from the invoice email spec of 4 October 2026 (R1):
 *
 *  1. THE SENDER SWITCH. Every invoice email since 25 June 2026 left from the Resend
 *     address, not the Orange Jelly mailbox. `INVOICE_EMAIL_PROVIDER=graph` pins them back
 *     to the mailbox. Unset, the send must be exactly what it was: no `provider` at all.
 *  2. COPIED ADDRESSES. `sendEmail` checks its block list for the To address only, so a
 *     copied address that had bounced kept being mailed. They are checked here now.
 *  3. THE DEFAULT WORDING comes from the shared module and never greets a company.
 *  4. SENT IS NOT THE SAME AS RECORDED. An email the provider accepted counts as sent even
 *     when its log row could not be written. Reporting it as failed makes a caller send it
 *     again, and the customer gets the invoice twice.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InvoiceWithDetails } from '@/types/invoices'

// env.ts reads the app URL once, when it is first imported, so it is set before any import.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://management.orangejelly.co.uk'
})

const mocks = vi.hoisted(() => ({
  generateInvoicePDF: vi.fn(),
  sendEmail: vi.fn(),
  getEmailSuppressionStatus: vi.fn(),
  recordEmailMessage: vi.fn(),
  resendSend: vi.fn(),
}))

vi.mock('@/lib/pdf-generator', () => ({
  generateInvoicePDF: mocks.generateInvoicePDF,
  generateQuotePDF: vi.fn(),
}))

// The real module with `sendEmail` swapped for a spy. The last block hands the spy the real
// implementation, so "sent but not recorded" is tested through `sendEmail` itself.
vi.mock('@/lib/email/emailService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email/emailService')>()),
  sendEmail: mocks.sendEmail,
}))

vi.mock('@/lib/email/logging', () => ({
  getEmailSuppressionStatus: mocks.getEmailSuppressionStatus,
  recordEmailMessage: mocks.recordEmailMessage,
}))

vi.mock('resend', () => ({
  Resend: vi.fn(function Resend() {
    return { emails: { send: mocks.resendSend } }
  }),
}))

import { sendInvoiceEmail } from '@/lib/microsoft-graph'
import { INVOICE_SIGN_OFF } from '@/lib/invoices/email-copy'

const PDF_BYTES = Buffer.from('invoice-pdf')

function invoice(overrides: Record<string, unknown> = {}): InvoiceWithDetails {
  return {
    id: 'invoice-1',
    invoice_number: 'INV-003WD',
    vendor_id: 'vendor-1',
    invoice_date: '2026-09-25',
    due_date: '2026-10-09',
    status: 'sent',
    invoice_discount_percentage: 0,
    subtotal_amount: 600,
    discount_amount: 0,
    vat_amount: 120,
    total_amount: 720,
    paid_amount: 0,
    created_at: '2026-09-25T09:00:00.000Z',
    updated_at: '2026-09-25T09:00:00.000Z',
    vendor: {
      id: 'vendor-1',
      name: 'Golden Barrels Limited',
      contact_name: 'Golden Barrels Accounts',
      paypal_payments_enabled: false,
    },
    line_items: [],
    payments: [],
    ...overrides,
  } as unknown as InvoiceWithDetails
}

function sentPayload(): Record<string, unknown> {
  expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
  return mocks.sendEmail.mock.calls[0][0] as Record<string, unknown>
}

const originalEnv = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  process.env = { ...originalEnv }
  process.env.PRIVATE_BOOKING_TOKEN_SECRET = 'test-secret'
  process.env.EMAIL_FROM_ADDRESS = 'The Anchor <noreply@auth.orangejelly.co.uk>'
  process.env.MICROSOFT_USER_EMAIL = 'peter@orangejelly.co.uk'
  delete process.env.INVOICE_EMAIL_PROVIDER
  delete process.env.INVOICE_EMAIL_FROM_ADDRESS
  delete process.env.INVOICE_EMAIL_REPLY_TO
  delete process.env.SUSPEND_ALL_EMAIL
  delete process.env.SUSPEND_ALL_COMMS

  mocks.generateInvoicePDF.mockResolvedValue(PDF_BYTES)
  mocks.sendEmail.mockReset()
  mocks.sendEmail.mockResolvedValue({ success: true, messageId: 'message-1', emailMessageId: 'row-1' })
  mocks.getEmailSuppressionStatus.mockResolvedValue('clear')
  mocks.recordEmailMessage.mockResolvedValue('row-1')
})

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('sendInvoiceEmail sender switch', () => {
  it('passes no provider while INVOICE_EMAIL_PROVIDER is unset, with the sender and reply-to as before', async () => {
    await sendInvoiceEmail(invoice(), 'accounts@example.com', 'Subject', 'Body')

    const payload = sentPayload()
    expect(payload).not.toHaveProperty('provider')
    expect(payload.from).toBe('Orange Jelly Limited <noreply@auth.orangejelly.co.uk>')
    expect(payload.replyTo).toBe('peter@orangejelly.co.uk')
  })

  it.each(['resend', 'Graph API', 'true', ''])('passes no provider for the mistyped value %j', async (value) => {
    process.env.INVOICE_EMAIL_PROVIDER = value

    await sendInvoiceEmail(invoice(), 'accounts@example.com', 'Subject', 'Body')

    expect(sentPayload()).not.toHaveProperty('provider')
  })

  it('pins Microsoft Graph when the switch is on, for an invoice and for a receipt', async () => {
    process.env.INVOICE_EMAIL_PROVIDER = 'graph'

    await sendInvoiceEmail(invoice(), 'accounts@example.com', 'Subject', 'Body')
    await sendInvoiceEmail(invoice({ paid_amount: 720, status: 'paid' }), 'accounts@example.com', 'Subject', 'Body', undefined, undefined, {
      documentKind: 'remittance_advice',
    })

    expect(mocks.sendEmail).toHaveBeenCalledTimes(2)
    for (const [payload] of mocks.sendEmail.mock.calls as Array<[Record<string, unknown>]>) {
      expect(payload.provider).toBe('graph')
      // The reply still comes back to the Orange Jelly mailbox either way.
      expect(payload.replyTo).toBe('peter@orangejelly.co.uk')
    }
  })
})

describe('sendInvoiceEmail copied addresses', () => {
  it('drops a copied address that is on the block list and records all three lists', async () => {
    mocks.getEmailSuppressionStatus.mockImplementation(async (address: string) =>
      address === 'bounced@example.com' ? 'suppressed' : 'clear',
    )

    const result = await sendInvoiceEmail(invoice(), 'accounts@example.com', 'Subject', 'Body', [
      'ops@example.com',
      'bounced@example.com',
    ])

    expect(result.success).toBe(true)
    const payload = sentPayload()
    expect(payload.to).toBe('accounts@example.com')
    expect(payload.cc).toEqual(['ops@example.com'])
    expect(payload.metadata).toMatchObject({
      cc_proposed: ['ops@example.com', 'bounced@example.com'],
      cc_dropped: ['bounced@example.com'],
      cc: ['ops@example.com'],
    })
  })

  it('keeps a copied address when the block list cannot be read', async () => {
    mocks.getEmailSuppressionStatus.mockResolvedValue('unavailable')

    await sendInvoiceEmail(invoice(), 'accounts@example.com', 'Subject', 'Body', ['ops@example.com'])

    const payload = sentPayload()
    expect(payload.cc).toEqual(['ops@example.com'])
    expect(payload.metadata).toMatchObject({ cc_dropped: [], cc: ['ops@example.com'] })
  })

  it('keeps a copied address and still sends when the check itself throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.getEmailSuppressionStatus.mockRejectedValue(new Error('connection reset'))

    const result = await sendInvoiceEmail(invoice(), 'accounts@example.com', 'Subject', 'Body', ['ops@example.com'])

    expect(result.success).toBe(true)
    expect(sentPayload().cc).toEqual(['ops@example.com'])
    warn.mockRestore()
  })

  it('judges each copied address on its own: one failed check does not keep a blocked one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.getEmailSuppressionStatus.mockImplementation(async (address: string) => {
      if (address === 'unknown@example.com') throw new Error('connection reset')
      return address === 'bounced@example.com' ? 'suppressed' : 'clear'
    })

    await sendInvoiceEmail(invoice(), 'accounts@example.com', 'Subject', 'Body', [
      'unknown@example.com',
      'bounced@example.com',
      'ops@example.com',
    ])

    expect(sentPayload().cc).toEqual(['unknown@example.com', 'ops@example.com'])
    expect(sentPayload().metadata).toMatchObject({ cc_dropped: ['bounced@example.com'] })
    warn.mockRestore()
  })

  it('never checks or changes the To address: that is sendEmail\'s own job', async () => {
    mocks.getEmailSuppressionStatus.mockResolvedValue('suppressed')

    await sendInvoiceEmail(invoice(), 'accounts@example.com', 'Subject', 'Body', ['ops@example.com'])

    expect(mocks.getEmailSuppressionStatus).toHaveBeenCalledTimes(1)
    expect(mocks.getEmailSuppressionStatus).toHaveBeenCalledWith('ops@example.com')
    const payload = sentPayload()
    expect(payload.to).toBe('accounts@example.com')
    expect(payload.cc).toEqual([])
  })

  it('records empty lists and makes no check when nobody is copied', async () => {
    await sendInvoiceEmail(invoice(), 'accounts@example.com', 'Subject', 'Body')

    expect(mocks.getEmailSuppressionStatus).not.toHaveBeenCalled()
    const payload = sentPayload()
    expect(payload.cc).toBeUndefined()
    expect(payload.metadata).toMatchObject({ cc_proposed: [], cc_dropped: [], cc: [] })
  })

  it('does not put a copied address in the server log when it drops one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.getEmailSuppressionStatus.mockResolvedValue('suppressed')

    await sendInvoiceEmail(invoice(), 'accounts@example.com', 'Subject', 'Body', ['bounced@example.com'])

    expect(warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(warn.mock.calls)).not.toContain('bounced@example.com')
    warn.mockRestore()
  })
})

describe('sendInvoiceEmail default wording and label', () => {
  it('uses the shared invoice wording, greeted by first name, when no body is passed', async () => {
    await sendInvoiceEmail(invoice(), 'accounts@example.com', undefined, undefined, undefined, undefined, {
      greetingName: 'Mihiir',
    })

    const payload = sentPayload()
    expect(payload.subject).toBe('Invoice INV-003WD from Orange Jelly')
    expect(String(payload.text).startsWith('Hi Mihiir,\n\n')).toBe(true)
    expect(String(payload.text)).toContain('Invoice INV-003WD is attached: £720.00, due Friday 9 October.')
    expect(String(payload.text).endsWith(INVOICE_SIGN_OFF)).toBe(true)
  })

  it('says "Hi there" with no greeting, never the company name or the legacy contact_name', async () => {
    await sendInvoiceEmail(invoice(), 'accounts@example.com')

    const text = String(sentPayload().text)
    expect(text.startsWith('Hi there,\n\n')).toBe(true)
    expect(text).not.toContain('Golden')
  })

  it('does not read COMPANY_CONTACT_PHONE, which holds the pub landline in production', async () => {
    process.env.COMPANY_CONTACT_PHONE = '01753 682707'
    process.env.COMPANY_CONTACT_NAME = 'The Anchor'

    await sendInvoiceEmail(invoice(), 'accounts@example.com')
    const text = String(sentPayload().text)

    expect(text).toContain('07990 587315')
    expect(text).not.toContain('01753')
  })

  it('asks only for what is still to pay on a part-paid invoice', async () => {
    await sendInvoiceEmail(invoice({ paid_amount: 250, status: 'partially_paid' }), 'accounts@example.com')

    const text = String(sentPayload().text)
    expect(text).toContain('is attached: £470.00, due Friday 9 October.')
    expect(text).toContain('Balance due: £470.00')
  })

  it('keeps the caller\'s own subject and body exactly as given', async () => {
    await sendInvoiceEmail(invoice(), 'accounts@example.com', 'My subject', 'My body')

    const payload = sentPayload()
    expect(payload.subject).toBe('My subject')
    expect(payload.text).toBe('My body')
  })

  it('gives a default receipt the shared wording and no pay online P.S.', async () => {
    const paid = invoice({
      paid_amount: 720,
      status: 'paid',
      vendor: { id: 'vendor-1', name: 'Golden Barrels Limited', paypal_payments_enabled: true },
    })

    await sendInvoiceEmail(paid, 'accounts@example.com', undefined, undefined, undefined, undefined, {
      documentKind: 'remittance_advice',
      greetingName: 'Mihiir',
      remittance: { paymentDate: '2026-10-05', paymentAmount: 720, paymentMethod: 'bank_transfer', paymentReference: null },
    })

    const payload = sentPayload()
    expect(payload.subject).toBe('Payment received for invoice INV-003WD')
    expect(String(payload.text)).toContain("I've received your payment of £720.00 for invoice INV-003WD, thank you. That settles the invoice in full.")
    expect(String(payload.text)).not.toContain('P.S.')
    expect(payload.commType).toBe('invoice_receipt')
  })

  it('never appends a pay online P.S. to a receipt, even with a balance still to pay', async () => {
    const partPaid = invoice({
      paid_amount: 250,
      status: 'partially_paid',
      vendor: { id: 'vendor-1', name: 'Golden Barrels Limited', paypal_payments_enabled: true },
    })

    await sendInvoiceEmail(partPaid, 'accounts@example.com', undefined, undefined, undefined, undefined, {
      documentKind: 'remittance_advice',
      remittance: { paymentDate: '2026-10-05', paymentAmount: 250, paymentMethod: 'bank_transfer', paymentReference: null },
    })

    const text = String(sentPayload().text)
    expect(text).toContain('That leaves £470.00 still to pay.')
    expect(text).not.toContain('/invoice-portal/')
  })

  it.each([
    ['an invoice by default', undefined, undefined, 'invoice'],
    ['a chase when the caller says so', 'chase', undefined, 'chase'],
    ['a receipt for a receipt', undefined, 'remittance_advice', 'receipt'],
  ] as const)('labels the email as %s', async (_case, emailKind, documentKind, expected) => {
    await sendInvoiceEmail(invoice(), 'accounts@example.com', 'Subject', 'Body', undefined, undefined, {
      emailKind,
      documentKind,
    })

    expect(sentPayload().metadata).toMatchObject({ email_kind: expected, invoice_number: 'INV-003WD' })
  })
})

describe('sendInvoiceEmail: sent is not the same as recorded', () => {
  it('never asks sendEmail to fail the send over its log row', async () => {
    await sendInvoiceEmail(invoice(), 'accounts@example.com', 'Subject', 'Body')

    const payload = sentPayload()
    expect(payload.requireLog).not.toBe(true)
  })

  it('reports success when sendEmail sent the email but could not record it', async () => {
    mocks.sendEmail.mockResolvedValue({ success: true, messageId: 'message-1', emailMessageId: null })

    const result = await sendInvoiceEmail(invoice(), 'accounts@example.com', 'Subject', 'Body')

    expect(result).toMatchObject({ success: true, messageId: 'message-1', pdfBuffer: PDF_BYTES })
    expect(result.error).toBeUndefined()
  })

  it('reports success through the real sendEmail when the provider accepts and the log write fails', async () => {
    // The whole path, with only the provider and the log table stood in: Resend accepts the
    // email, then the email_messages write fails (recordEmailMessage answers null).
    const actual = await vi.importActual<typeof import('@/lib/email/emailService')>('@/lib/email/emailService')
    mocks.sendEmail.mockImplementation(actual.sendEmail)
    process.env.EMAIL_PROVIDER = 'resend'
    process.env.RESEND_API_KEY = 're_test'
    mocks.resendSend.mockResolvedValue({ data: { id: 'resend-1' }, error: null })
    mocks.recordEmailMessage.mockResolvedValue(null)

    const result = await sendInvoiceEmail(invoice(), 'accounts@example.com', 'Subject', 'Body')

    expect(mocks.resendSend).toHaveBeenCalledTimes(1)
    expect(mocks.recordEmailMessage).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ success: true, messageId: 'resend-1' })
  })

  it('still reports a failure when the provider itself refuses the email', async () => {
    const actual = await vi.importActual<typeof import('@/lib/email/emailService')>('@/lib/email/emailService')
    mocks.sendEmail.mockImplementation(actual.sendEmail)
    process.env.EMAIL_PROVIDER = 'resend'
    process.env.RESEND_API_KEY = 're_test'
    mocks.resendSend.mockResolvedValue({ data: null, error: { message: 'Domain is not verified' } })

    const result = await sendInvoiceEmail(invoice(), 'accounts@example.com', 'Subject', 'Body')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Domain is not verified')
  })
})
