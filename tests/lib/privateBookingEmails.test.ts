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
import { sendDepositPaymentLinkEmail } from '@/lib/email/private-booking-emails'

const mockedSendEmail = sendEmail as unknown as Mock

describe('private booking deposit emails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedSendEmail.mockResolvedValue({ success: true })
  })

  it('states PayPal link expiry and includes the fresh-link recovery option', async () => {
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
      'https://management.example.com/booking-portal/token?fresh_payment_link=1'
    )

    expect(mockedSendEmail).toHaveBeenCalledTimes(1)
    const payload = mockedSendEmail.mock.calls[0][0]
    expect(payload.html).toContain('PayPal payment links usually expire 6 hours after this email is sent')
    expect(payload.html).toContain('Get a fresh payment link')
    expect(payload.html).toContain('https://management.example.com/booking-portal/token?fresh_payment_link=1')
  })
})
