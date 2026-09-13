import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// notifyCustomer through the REAL sendEmail, with only the Resend SDK, the email log and the
// SMS transport mocked. notify.test.ts mocks sendEmail outright; these tests pin the contract
// between the two, which is where "sent but unlogged" and the kill switch actually meet.

const resendSend = vi.hoisted(() => vi.fn())

vi.mock('resend', () => ({
  Resend: vi.fn(function Resend() {
    return { emails: { send: resendSend } }
  }),
}))

vi.mock('@/lib/microsoft-graph', () => ({
  isGraphConfigured: vi.fn(() => false),
}))

vi.mock('@microsoft/microsoft-graph-client', () => ({
  Client: { initWithMiddleware: vi.fn() },
}))

vi.mock('@azure/identity', () => ({
  ClientSecretCredential: vi.fn(),
}))

vi.mock('@/lib/email/logging', () => ({
  getEmailSuppressionStatus: vi.fn(),
  isEmailSuppressed: vi.fn(),
  recordEmailMessage: vi.fn(),
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

vi.mock('@/lib/cron/alerting', () => ({
  reportCronFailure: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { notifyCustomer } from '../notify'
import { getEmailSuppressionStatus, isEmailSuppressed, recordEmailMessage } from '@/lib/email/logging'
import { isCustomerSmsSendAllowed, sendSMS } from '@/lib/twilio'
import { createAdminClient } from '@/lib/supabase/admin'
import { reportCronFailure } from '@/lib/cron/alerting'

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
}

function cancellationNotice(email: { idempotencyKey?: string } = {}) {
  return notifyCustomer({
    policy: 'email_first',
    urgency: 'standard',
    category: 'transactional',
    customer,
    email: {
      to: customer.email,
      subject: 'Your booking has been cancelled',
      text: 'Cancelled',
      commType: 'table_booking_cancelled',
      tableBookingId: 'booking-1',
      ...email,
    },
    sms: {
      body: 'The Anchor: your booking has been cancelled.',
      options: { metadata: { template_key: 'table_booking_cancelled' } },
    },
  })
}

describe('notifyCustomer with the real sendEmail', () => {
  const originalEnv = { ...process.env }
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.EMAIL_PROVIDER = 'resend'
    process.env.RESEND_API_KEY = 're_test'
    process.env.EMAIL_FROM_ADDRESS = 'The Anchor <noreply@auth.orangejelly.co.uk>'
    delete process.env.SUSPEND_ALL_EMAIL
    delete process.env.SUSPEND_ALL_COMMS
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    vi.mocked(createAdminClient).mockReturnValue(buildAuditDbMock() as any)
    vi.mocked(getEmailSuppressionStatus).mockResolvedValue('clear')
    vi.mocked(isEmailSuppressed).mockResolvedValue(false)
    vi.mocked(recordEmailMessage).mockResolvedValue('email-log-1')
    vi.mocked(isCustomerSmsSendAllowed).mockResolvedValue({ allowed: true })
    vi.mocked(sendSMS).mockResolvedValue({ success: true, sid: 'sms-1' } as any)
    resendSend.mockResolvedValue({ data: { id: 'resend-email-1' }, error: null })
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    warnSpy.mockRestore()
  })

  it('texts the customer instead when SUSPEND_ALL_EMAIL is on, without calling the provider', async () => {
    process.env.SUSPEND_ALL_EMAIL = 'true'

    const result = await cancellationNotice()

    expect(resendSend).not.toHaveBeenCalled()
    expect(getEmailSuppressionStatus).not.toHaveBeenCalled()
    expect(recordEmailMessage).not.toHaveBeenCalled()
    expect(sendSMS).toHaveBeenCalledTimes(1)
    expect(result.attempts[0]).toEqual(expect.objectContaining({
      channel: 'email',
      success: false,
      code: 'email_suspended',
    }))
    expect(result).toEqual(expect.objectContaining({ finalStatus: 'sent', sentChannel: 'sms', fallbackUsed: true }))
  })

  it('hands the idempotency key to the Resend call', async () => {
    const result = await cancellationNotice({ idempotencyKey: 'table_booking_cancelled:booking-1' })

    expect(resendSend).toHaveBeenCalledTimes(1)
    expect(resendSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'guest@example.com', subject: 'Your booking has been cancelled' }),
      { idempotencyKey: 'table_booking_cancelled:booking-1' },
    )
    expect(sendSMS).not.toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({ finalStatus: 'sent', sentChannel: 'email', fallbackUsed: false }))
  })

  it('does not text the customer when Resend accepted the email but its log row was not written', async () => {
    // recordEmailMessage answering null with requireLog set is exactly how sendEmail reaches
    // "success: false, messageId: <provider id>".
    vi.mocked(recordEmailMessage).mockResolvedValue(null)
    resendSend.mockResolvedValue({ data: { id: 'resend-accepted-1' }, error: null })

    const result = await cancellationNotice()

    expect(resendSend).toHaveBeenCalledTimes(1)
    expect(sendSMS).not.toHaveBeenCalled()
    expect(result.attempts).toEqual([
      expect.objectContaining({
        channel: 'email',
        success: true,
        logFailure: true,
        messageId: 'resend-accepted-1',
      }),
    ])
    expect(result).toEqual(expect.objectContaining({ finalStatus: 'sent', sentChannel: 'email', fallbackUsed: false }))
    expect(reportCronFailure).toHaveBeenCalledTimes(1)
  })

  it('texts the customer when Resend itself refuses the email', async () => {
    resendSend.mockResolvedValue({ data: null, error: { message: 'Resend 500: internal server error' } })

    const result = await cancellationNotice()

    expect(sendSMS).toHaveBeenCalledTimes(1)
    expect(result.attempts).toEqual([
      expect.objectContaining({ channel: 'email', success: false, error: 'Resend 500: internal server error', messageId: null }),
      expect.objectContaining({ channel: 'sms', success: true }),
    ])
    expect(result).toEqual(expect.objectContaining({ finalStatus: 'sent', sentChannel: 'sms', fallbackUsed: true }))
    expect(reportCronFailure).not.toHaveBeenCalled()
  })
})
