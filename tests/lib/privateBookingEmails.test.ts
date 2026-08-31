import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/email/calendar-invite', () => ({
  generateBookingCalendarInvite: vi.fn(),
}))

import { sendEmail } from '@/lib/email/emailService'
import { sendDepositPaymentLinkEmail, sendContractEmailToCustomer } from '@/lib/email/private-booking-emails'

const mockedSendEmail = sendEmail as unknown as Mock

describe('private booking deposit emails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedSendEmail.mockResolvedValue({ success: true })
  })

  it('uses a scanner-safe portal link for payment recovery', async () => {
    await sendDepositPaymentLinkEmail(
      {
        id: 'booking-1',
        contact_email: 'customer@example.com',
        customer_first_name: 'Jane',
        customer_name: 'Jane Customer',
        event_date: '2026-08-15',
        event_type: 'Birthday',
        deposit_amount: 250,
      },
      'https://paypal.test/checkout?token=ORDER-123',
      'https://management.example.com/booking-portal/token'
    )

    expect(mockedSendEmail).toHaveBeenCalledTimes(1)
    const payload = mockedSendEmail.mock.calls[0][0]
    expect(payload.html).toContain('PayPal payment links usually expire 6 hours after this email is sent')
    expect(payload.html).toContain('Open your booking and pay')
    expect(payload.html).toContain('https://management.example.com/booking-portal/token')
    expect(payload.html).not.toContain('fresh_payment_link=1')
  })
})

describe('contract email deposit wording', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedSendEmail.mockResolvedValue({ success: true })
  })

  const booking = (extra: Record<string, unknown>) => ({
    id: 'booking-1',
    contact_email: 'guest@example.com',
    customer_first_name: 'Sam',
    customer_name: 'Sam Example',
    event_date: '2026-11-14',
    event_type: 'Birthday Party',
    deposit_amount: 250,
    ...extra,
  })

  const contract = { version: 1, pdf: Buffer.from('pdf') }

  const bodyOf = () => String(mockedSendEmail.mock.calls[0][0].html)

  it('says the deposit was received, and when, once it has been paid', async () => {
    await sendContractEmailToCustomer(booking({ deposit_paid_date: '2026-08-25T09:00:00Z' }), contract)

    const html = bodyOf()
    expect(html).toContain('We received your £250.00 booking and damage deposit on')
    expect(html).toContain('25 August 2026')
    expect(html).toContain("nothing to pay to hold your date")
    // The bug: the old copy asked for a deposit that was already paid, which
    // reads to the customer as though we have lost their money.
    expect(html).not.toContain('Paying the £250.00 booking and damage deposit confirms')
  })

  it('still asks for the deposit when it has not been paid', async () => {
    await sendContractEmailToCustomer(booking({ deposit_paid_date: null }), contract)

    const html = bodyOf()
    expect(html).toContain('Paying the £250.00 booking and damage deposit confirms')
    expect(html).not.toContain('We received your')
  })

  it('mentions no deposit at all when none is due', async () => {
    await sendContractEmailToCustomer(booking({ deposit_amount: 0, deposit_paid_date: null }), contract)

    const html = bodyOf()
    expect(html).toContain("Please have a read and let us know that you're happy")
    expect(html).not.toContain('booking and damage deposit')
  })
})
