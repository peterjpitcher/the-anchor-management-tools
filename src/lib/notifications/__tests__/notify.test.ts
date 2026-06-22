import { beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyCustomer } from '../notify'
import { sendEmail } from '@/lib/email/emailService'
import { isEmailSuppressed } from '@/lib/email/logging'
import {
  isCustomerSmsSendAllowed,
  isCustomerWhatsAppSendAllowed,
  sendSMS,
  sendWhatsApp,
} from '@/lib/twilio'
import { createAdminClient } from '@/lib/supabase/admin'

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/email/logging', () => ({
  isEmailSuppressed: vi.fn(),
}))

vi.mock('@/lib/twilio', () => ({
  isCustomerSmsSendAllowed: vi.fn(),
  isCustomerWhatsAppSendAllowed: vi.fn(),
  sendSMS: vi.fn(),
  sendWhatsApp: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

function buildAuditDbMock() {
  const chain: Record<string, any> = {}
  chain.from = vi.fn().mockReturnValue(chain)
  chain.insert = vi.fn().mockReturnValue(chain)
  chain.select = vi.fn().mockReturnValue(chain)
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'delivery-1' }, error: null })
  chain.update = vi.fn().mockReturnValue(chain)
  chain.eq = vi.fn().mockResolvedValue({ data: null, error: null })
  return chain
}

const customer = {
  id: 'customer-1',
  email: 'guest@example.com',
  mobile_e164: '+447700900001',
  mobile_number: '+447700900001',
  sms_status: 'active',
  sms_opt_in: true,
  whatsapp_status: 'active',
  whatsapp_opt_in: true,
}

describe('notifyCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createAdminClient).mockReturnValue(buildAuditDbMock() as any)
    vi.mocked(isEmailSuppressed).mockResolvedValue(false)
    vi.mocked(isCustomerSmsSendAllowed).mockResolvedValue({ allowed: true })
    vi.mocked(isCustomerWhatsAppSendAllowed).mockResolvedValue({ allowed: true })
    vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: 'email-1' })
    vi.mocked(sendWhatsApp).mockResolvedValue({ success: true, sid: 'wa-1' })
    vi.mocked(sendSMS).mockResolvedValue({ success: true, sid: 'sms-1' })
  })

  it('stops the cascade after a successful email for both policy', async () => {
    const result = await notifyCustomer({
      policy: 'both',
      urgency: 'standard',
      customer,
      email: {
        to: customer.email,
        subject: 'Booking confirmed',
        text: 'Confirmed',
        commType: 'ad_hoc',
      },
      whatsapp: {
        body: 'Confirmed',
        options: { templateKey: 'booking_confirmed' },
      },
      sms: {
        body: 'Confirmed',
      },
    })

    expect(result.attempts).toEqual([
      expect.objectContaining({ channel: 'email', success: true }),
    ])
    expect(sendWhatsApp).not.toHaveBeenCalled()
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('passes WhatsApp template metadata into eligibility checks', async () => {
    await notifyCustomer({
      policy: 'both',
      urgency: 'standard',
      customer,
      whatsapp: {
        body: 'Confirmed',
        options: {
          metadata: { template_key: 'event_booking_confirmed' },
        },
      },
    })

    expect(isCustomerWhatsAppSendAllowed).toHaveBeenCalledWith(
      customer.id,
      customer.mobile_e164,
      {
        marketing: false,
        templateKey: 'event_booking_confirmed',
      }
    )
    expect(sendWhatsApp).toHaveBeenCalledTimes(1)
  })
})
