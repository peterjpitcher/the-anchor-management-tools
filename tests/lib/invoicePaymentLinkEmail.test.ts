/**
 * The invoice payment-link email.
 *
 * It asks for money against a VAT invoice, so the party asking has to be the party on the
 * invoice. It signed off "The Anchor / Orange Jelly Limited, trading as The Anchor" over the
 * venue's postal address and the venue manager's complaints mailbox, and its subject carried
 * a banned em dash.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendEmail = vi.hoisted(() => vi.fn())
vi.mock('@/lib/email/emailService', () => ({ sendEmail }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))

const BANNED_DASHES = [String.fromCharCode(0x2013), String.fromCharCode(0x2014)]

async function send() {
  const { sendInvoicePaymentLinkEmail } = await import('@/lib/email/invoice-payment-emails')
  return sendInvoicePaymentLinkEmail({
    to: 'vendor@example.com',
    invoiceNumber: 'INV-1042',
    customerName: 'Jane Smith',
    amountDue: 480,
    dueDate: '2026-07-31',
    paypalApproveUrl: 'https://paypal.example/approve/1',
    portalUrl: 'https://management.orangejelly.co.uk/pay/abc',
  })
}

describe('invoice payment link email', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    process.env.EMAIL_FROM_ADDRESS = 'The Anchor <noreply@auth.orangejelly.co.uk>'
    process.env.MICROSOFT_USER_EMAIL = 'peter@orangejelly.co.uk'
    sendEmail.mockResolvedValue({ success: true })
  })

  it('comes from Orange Jelly Limited, not the venue', async () => {
    await send()

    const options = sendEmail.mock.calls[0][0]
    expect(options.from).toBe('Orange Jelly Limited <noreply@auth.orangejelly.co.uk>')
    expect(options.replyTo).toBe('peter@orangejelly.co.uk')
  })

  it('signs off and footers as the company on the invoice', async () => {
    await send()

    const html = String(sendEmail.mock.calls[0][0].html)
    expect(html).toContain('<strong>Orange Jelly Limited</strong>')
    expect(html).toContain('Trading as The Anchor')
    expect(html).toContain('Company number 10537179')
    expect(html).toContain('VAT GB315203647')
    // The venue's own complaints mailbox is the wrong desk for a VAT question.
    expect(html).not.toContain('manager@the-anchor.pub')
  })

  it('uses a colon in the subject, not a banned dash', async () => {
    await send()

    const subject = String(sendEmail.mock.calls[0][0].subject)
    expect(subject).toBe('Invoice INV-1042: £480.00 due')
    for (const dash of BANNED_DASHES) {
      expect(subject.includes(dash)).toBe(false)
    }
  })

  it('renders no broken values', async () => {
    await send()

    const { html, subject } = sendEmail.mock.calls[0][0]
    for (const part of [String(html), String(subject)]) {
      expect(part).not.toMatch(/undefined|Invalid Date|NaN|£0\.00/)
      for (const dash of BANNED_DASHES) {
        expect(part.includes(dash)).toBe(false)
      }
    }
    expect(String(html)).toContain('31 July 2026')
  })
})
